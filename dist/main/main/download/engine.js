"use strict";
// ============================================================================
// BiBox Downloader — Download Engine (Orchestrator)
// ============================================================================
// Orchestrates the complete download pipeline per book:
// Phase 1: Discovery → Phase 2: Disk check → Phase 3: Pages →
// Phase 4: Materials → Phase 5: PDF → Phase 6: Finalize
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDownloadFlow = startDownloadFlow;
exports.pauseDownload = pauseDownload;
exports.resumeDownload = resumeDownload;
exports.cancelDownload = cancelDownload;
exports.hasActiveDownload = hasActiveDownload;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("../../shared/types");
const logger_1 = require("../logging/logger");
const bibox_api_1 = require("../api/bibox-api");
const checkpoint_1 = require("./checkpoint");
const throttle_1 = require("./throttle");
const page_downloader_1 = require("./page-downloader");
const material_downloader_1 = require("./material-downloader");
const builder_1 = require("../pdf/builder");
const disk_check_1 = require("../storage/disk-check");
// Active downloads map — for pause/cancel
const activeDownloads = new Map();
async function startDownloadFlow(config, mainWindow) {
    const { bookIds, outputDir, options } = config;
    // FIX: Fetch book list ONCE for all books (not per-book)
    // [Review2] Type is always Book[] after try/catch — removed misleading `| null`
    let cachedBooks;
    try {
        cachedBooks = await (0, bibox_api_1.fetchBooks)();
    }
    catch {
        cachedBooks = [];
    }
    for (const bookId of bookIds) {
        try {
            await downloadBook(bookId, outputDir, options, mainWindow, cachedBooks);
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger_1.logger.error('Engine', `Book ${bookId} failed: ${errorMsg}`, err);
            // Clean up activeDownloads entry on failure (prevents memory leak + stale entries)
            activeDownloads.delete(bookId);
            // [Review3] FIX: Send phase 'done' with error flag rather than misleading zeros.
            // The renderer's markComplete (via DOWNLOAD_COMPLETE) sets the actual success state.
            sendProgress(mainWindow, {
                bookId,
                phase: 'done',
                completedPages: 0,
                totalPages: 0,
                completedMaterials: 0,
                totalMaterials: 0,
                bytesDownloaded: 0,
                speedBps: 0,
                etaSeconds: 0,
                errors: [errorMsg],
                currentItem: `Fehler: ${errorMsg}`,
            });
            mainWindow?.webContents.send(types_1.IPC_CHANNELS.DOWNLOAD_COMPLETE, {
                bookId,
                success: false,
                error: errorMsg,
            });
        }
    }
}
async function downloadBook(bookId, outputDir, options, mainWindow, cachedBooks) {
    const abortSignal = { aborted: false };
    const throttle = new throttle_1.AdaptiveThrottle(options.maxParallel);
    const startTime = Date.now();
    let totalBytes = 0;
    // --- Phase 1: Discovery ---
    sendProgress(mainWindow, {
        bookId, phase: 'discovery',
        completedPages: 0, totalPages: 0,
        completedMaterials: 0, totalMaterials: 0,
        bytesDownloaded: 0, speedBps: 0, etaSeconds: 0, errors: [],
        currentItem: 'Buchdaten abrufen...',
    });
    logger_1.logger.info('Engine', `Book ${bookId}: Starting discovery phase`);
    const syncData = await (0, bibox_api_1.fetchSyncData)(bookId);
    const isbn = await (0, bibox_api_1.fetchIsbn)(bookId) || '';
    const pageData = await (0, bibox_api_1.fetchPageData)(bookId);
    logger_1.logger.info('Engine', `Book ${bookId}: Discovery done — ${syncData.pages.length} pages, ${syncData.materials.length} materials, ISBN=${isbn || 'n/a'}`);
    // Merge SAKT materials (supplementary)
    const saktMaterials = await (0, bibox_api_1.fetchSaktMaterials)(bookId);
    const allMaterialIds = new Set(syncData.materials.map((m) => m.materialId));
    let saktAdded = 0;
    for (const sakt of saktMaterials) {
        if (!allMaterialIds.has(sakt.materialId)) {
            syncData.materials.push(sakt);
            saktAdded++;
        }
    }
    if (saktAdded > 0) {
        logger_1.logger.info('Engine', `Book ${bookId}: Merged ${saktAdded} SAKT supplementary materials`);
    }
    // Use cached book list (fetched once in startDownloadFlow)
    const bookInfo = cachedBooks.find((b) => b.id === bookId);
    const title = bookInfo?.title || `Buch_${bookId}`;
    // Build folder name
    const folderName = sanitizeFolderName(`${title}${isbn ? ` (ISBN ${isbn})` : ''}`);
    const bookDir = path.join(outputDir, folderName);
    logger_1.logger.info('Engine', `Book ${bookId}: Output dir → ${bookDir}`);
    const pagesDir = path.join(bookDir, 'Seiten');
    const materialsDir = path.join(bookDir, 'Materialien');
    // Ensure directories exist
    // [BugC-FIX] Only create materialsDir if there are materials to download
    const hasMaterials = options.downloadMaterials && syncData.materials.length > 0;
    for (const dir of [bookDir, pagesDir]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    if (hasMaterials) {
        if (!fs.existsSync(materialsDir)) {
            fs.mkdirSync(materialsDir, { recursive: true });
        }
    }
    // Setup checkpoint
    const checkpoint = checkpoint_1.CheckpointManager.exists(bookDir)
        ? checkpoint_1.CheckpointManager.load(bookDir, bookId)
        : new checkpoint_1.CheckpointManager(bookDir, bookId);
    // Validate existing files if resuming
    if (checkpoint_1.CheckpointManager.exists(bookDir)) {
        logger_1.logger.info('Engine', `Book ${bookId}: Resuming — validating existing files`);
        checkpoint.validateCompletedFiles(bookDir);
    }
    // Store for pause/cancel
    activeDownloads.set(bookId, { abort: abortSignal, throttle, checkpoint });
    const totalPages = syncData.pages.length || pageData.pageCount || 0;
    // Filter out HTML5 materials early so totalMaterials count is accurate
    if (!options.downloadHtml5) {
        syncData.materials = syncData.materials.filter((m) => m.type !== 'html5');
    }
    const totalMaterials = syncData.materials.length;
    const estimatedSizeMB = Math.ceil((totalPages * types_1.BIBOX_CONSTANTS.AVG_PAGE_SIZE_KB / 1024) * types_1.BIBOX_CONSTANTS.PDF_OVERHEAD_FACTOR
        + types_1.BIBOX_CONSTANTS.MATERIAL_ESTIMATE_MB);
    checkpoint.setPlan({
        totalPages,
        totalMaterials,
        estimatedSizeMB,
    });
    // --- Phase 2: Disk Space Check ---
    const diskInfo = await (0, disk_check_1.checkDiskSpace)(outputDir);
    const requiredBytes = estimatedSizeMB * 1024 * 1024;
    const bufferRequired = requiredBytes * (1 + types_1.BIBOX_CONSTANTS.DISK_BUFFER_RATIO);
    if (diskInfo.available < bufferRequired) {
        const availableMB = Math.floor(diskInfo.available / 1024 / 1024);
        logger_1.logger.error('Engine', `Book ${bookId}: Insufficient disk space — need ~${estimatedSizeMB} MB, available ${availableMB} MB`);
        throw new Error(`Insufficient disk space: need ~${estimatedSizeMB} MB but only ${availableMB} MB available at ${outputDir}`);
    }
    logger_1.logger.info('Engine', `Book ${bookId}: Disk check passed — ~${estimatedSizeMB} MB needed, ${Math.floor(diskInfo.available / 1024 / 1024)} MB available`);
    // --- Phase 3: Download Pages ---
    if (syncData.pages.length > 0) {
        sendProgress(mainWindow, {
            bookId, phase: 'pages',
            completedPages: checkpoint.getCompletedPageCount(), totalPages,
            completedMaterials: 0, totalMaterials,
            bytesDownloaded: 0, speedBps: 0, etaSeconds: 0, errors: [],
            currentItem: 'Seiten herunterladen...',
        });
        const pageResult = await (0, page_downloader_1.downloadPages)(syncData.pages, pagesDir, checkpoint, throttle, (progress) => {
            totalBytes = progress.bytesDownloaded;
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? totalBytes / elapsed : 0;
            const remaining = totalPages - progress.completed;
            const eta = speed > 0 ? (remaining * types_1.BIBOX_CONSTANTS.AVG_PAGE_SIZE_KB * 1024) / speed : 0;
            sendProgress(mainWindow, {
                bookId, phase: 'pages',
                completedPages: progress.completed, totalPages,
                completedMaterials: 0, totalMaterials,
                bytesDownloaded: totalBytes, speedBps: speed,
                etaSeconds: Math.ceil(eta), errors: progress.errors,
                currentItem: progress.currentFile,
            });
        }, abortSignal);
        if (abortSignal.aborted) {
            logger_1.logger.info('Engine', `Book ${bookId}: Download aborted during pages phase`);
            await cleanupPngsIfNeeded(pagesDir, options, checkpoint);
            checkpoint.saveNow();
            activeDownloads.delete(bookId);
            return;
        }
        logger_1.logger.info('Engine', `Book ${bookId}: Pages phase complete — ${pageResult.completed} downloaded, ${pageResult.failed} failed, ${pageResult.errors.length} errors`);
        // [Bug3-FIX] Keep actual totalBytes from page download callbacks — don't overwrite with approximation
    }
    // --- Phase 4: Download Materials ---
    if (options.downloadMaterials && syncData.materials.length > 0) {
        sendProgress(mainWindow, {
            bookId, phase: 'materials',
            completedPages: totalPages, totalPages,
            completedMaterials: checkpoint.getCompletedMaterialCount(), totalMaterials,
            bytesDownloaded: totalBytes, speedBps: 0, etaSeconds: 0, errors: [],
            currentItem: 'Materialien herunterladen...',
        });
        const matStartBytes = totalBytes;
        const matStartTime = Date.now();
        const matResult = await (0, material_downloader_1.downloadMaterials)(syncData.materials, bookId, materialsDir, checkpoint, (progress) => {
            const currentTotalBytes = matStartBytes + progress.bytesDownloaded;
            totalBytes = currentTotalBytes; // Keep totalBytes up to date for final report
            const matElapsed = (Date.now() - matStartTime) / 1000;
            const matSpeed = matElapsed > 0 ? progress.bytesDownloaded / matElapsed : 0;
            const matRemaining = totalMaterials - progress.completed;
            // Estimate avg bytes per material from what we've downloaded so far
            const avgBytesPerMat = progress.completed > 0 ? progress.bytesDownloaded / progress.completed : 0;
            const matEta = matSpeed > 0 && avgBytesPerMat > 0
                ? (matRemaining * avgBytesPerMat) / matSpeed
                : 0;
            sendProgress(mainWindow, {
                bookId, phase: 'materials',
                completedPages: totalPages, totalPages,
                completedMaterials: progress.completed, totalMaterials,
                bytesDownloaded: currentTotalBytes,
                speedBps: matSpeed, etaSeconds: Math.ceil(matEta),
                errors: progress.errors,
                currentItem: progress.currentMaterial,
            });
        }, abortSignal, throttle, // [Bug2-FIX] Pass throttle for pause support
        { downloadHtml5: options.downloadHtml5 });
        if (abortSignal.aborted) {
            logger_1.logger.info('Engine', `Book ${bookId}: Download aborted during materials phase`);
            await cleanupPngsIfNeeded(pagesDir, options, checkpoint);
            checkpoint.saveNow();
            activeDownloads.delete(bookId);
            return;
        }
        logger_1.logger.info('Engine', `Book ${bookId}: Materials phase complete — ${matResult.completed} downloaded, ${matResult.failed} failed`);
    }
    // --- Phase 5: PDF Assembly ---
    if (options.downloadPdf && syncData.pages.length > 0) {
        sendProgress(mainWindow, {
            bookId, phase: 'pdf',
            completedPages: totalPages, totalPages,
            completedMaterials: totalMaterials, totalMaterials,
            bytesDownloaded: totalBytes, speedBps: 0, etaSeconds: 0, errors: [],
            currentItem: 'PDF wird erstellt...',
        });
        checkpoint.setPdfStatus('in_progress');
        try {
            const pdfFilename = sanitizeBookFilename(title, isbn) + '.pdf';
            const pdfPath = path.join(bookDir, pdfFilename);
            await (0, builder_1.buildPdf)(pagesDir, pdfPath, {
                title,
                author: 'Westermann Verlag',
                isbn,
                pageCount: totalPages,
            });
            logger_1.logger.info('Engine', `Book ${bookId}: PDF saved as "${pdfFilename}"`);
            checkpoint.setPdfStatus('completed');
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            checkpoint.setPdfStatus('failed');
            logger_1.logger.error('Engine', `PDF build failed: ${errorMsg}`, err);
        }
    }
    // --- Phase 5b: Materials PDF Export (optional) ---
    if (options.exportMaterialsPdf && options.downloadMaterials) {
        try {
            sendProgress(mainWindow, {
                bookId, phase: 'pdf',
                completedPages: totalPages, totalPages,
                completedMaterials: totalMaterials, totalMaterials,
                bytesDownloaded: totalBytes, speedBps: 0, etaSeconds: 0, errors: [],
                currentItem: 'Materialien-PDF wird erstellt...',
            });
            const { buildMaterialsPdf } = await Promise.resolve().then(() => __importStar(require('../pdf/materials-pdf-builder')));
            const matPdfResult = await buildMaterialsPdf(bookDir);
            if (matPdfResult.success) {
                logger_1.logger.info('Engine', `Book ${bookId}: Materials PDF exported → ${matPdfResult.path}`);
            }
            else {
                logger_1.logger.warn('Engine', `Book ${bookId}: Materials PDF export failed: ${matPdfResult.error}`);
            }
        }
        catch (err) {
            logger_1.logger.warn('Engine', `Book ${bookId}: Materials PDF export error`, err);
        }
    }
    // --- Phase 6: Finalize ---
    // Write manifest (ensure bookDir still exists after potential pagesDir cleanup)
    try {
        if (!fs.existsSync(bookDir)) {
            fs.mkdirSync(bookDir, { recursive: true });
        }
        const manifest = {
            bookId,
            title,
            isbn,
            totalPages,
            totalMaterials: syncData.materials.length,
            downloadedAt: new Date().toISOString(),
            pages: syncData.pages.map((p) => ({
                number: p.pageNumber,
                filename: p.filename,
            })),
            materials: syncData.materials.map((m) => ({
                id: m.materialId,
                title: m.title,
                type: m.type,
                pageRef: m.pageRef,
            })),
        };
        fs.writeFileSync(path.join(bookDir, 'Manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    }
    catch (err) {
        logger_1.logger.warn('Engine', `Book ${bookId}: Failed to write Manifest.json: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Clean up original PNGs if not wanted
    // Guard: Only delete if PDF was successfully built (or PDF wasn't requested)
    await cleanupPngsIfNeeded(pagesDir, options, checkpoint);
    // [K1-FIX] Clean up empty Materialien/ subdirectories AND parent
    // material-downloader creates 5 subdirs unconditionally; remove any that are empty
    try {
        if (fs.existsSync(materialsDir)) {
            const subdirs = fs.readdirSync(materialsDir, { withFileTypes: true });
            for (const sub of subdirs) {
                if (!sub.isDirectory())
                    continue;
                const subPath = path.join(materialsDir, sub.name);
                try {
                    const entries = fs.readdirSync(subPath);
                    if (entries.length === 0) {
                        fs.rmdirSync(subPath);
                        logger_1.logger.info('Engine', `Book ${bookId}: Removed empty subdir Materialien/${sub.name}`);
                    }
                }
                catch { /* skip locked/inaccessible subdirs */ }
            }
            // Now try removing parent if it became empty
            const remaining = fs.readdirSync(materialsDir);
            if (remaining.length === 0) {
                fs.rmdirSync(materialsDir);
                logger_1.logger.info('Engine', `Book ${bookId}: Removed empty Materialien/ directory`);
            }
        }
    }
    catch { /* non-critical */ }
    // Mark as complete
    checkpoint.setStatus('completed');
    checkpoint.saveNow();
    // 2. Remove .download-state.json — Manifest.json is the definitive completion marker
    try {
        const checkpointFile = path.join(bookDir, '.download-state.json');
        if (fs.existsSync(checkpointFile)) {
            fs.unlinkSync(checkpointFile);
            logger_1.logger.info('Engine', `Book ${bookId}: Removed .download-state.json (Manifest.json is completion marker)`);
        }
    }
    catch { /* non-critical */ }
    activeDownloads.delete(bookId);
    const elapsedSec = Math.ceil((Date.now() - startTime) / 1000);
    logger_1.logger.info('Engine', `Book ${bookId}: Download COMPLETE — "${title}" — ${totalPages} pages, ${syncData.materials.length} materials — ${elapsedSec}s total`);
    sendProgress(mainWindow, {
        bookId, phase: 'done',
        completedPages: totalPages, totalPages,
        completedMaterials: totalMaterials, totalMaterials,
        bytesDownloaded: totalBytes, speedBps: 0, etaSeconds: 0, errors: [],
    });
    mainWindow?.webContents.send(types_1.IPC_CHANNELS.DOWNLOAD_COMPLETE, {
        bookId,
        success: true,
        bookDir, // [BugA-FIX] Send actual book folder path for accurate size calculation
    });
}
// --- Pause / Cancel ---
function pauseDownload(bookId) {
    const dl = activeDownloads.get(bookId);
    if (dl) {
        dl.throttle.pause();
    }
}
function resumeDownload(bookId) {
    const dl = activeDownloads.get(bookId);
    if (dl) {
        dl.throttle.resume();
    }
}
function cancelDownload(bookId) {
    const dl = activeDownloads.get(bookId);
    if (dl) {
        dl.abort.aborted = true;
        dl.checkpoint.saveNow();
        activeDownloads.delete(bookId);
    }
}
// [Review4] Kept for future use (e.g., Resume UI integration)
function hasActiveDownload(bookId) {
    return activeDownloads.has(bookId);
}
// --- Helpers ---
function sendProgress(mainWindow, update) {
    mainWindow?.webContents.send(types_1.IPC_CHANNELS.DOWNLOAD_PROGRESS, update);
}
function sanitizeFolderName(name) {
    return name
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
}
/**
 * Generate a descriptive PDF filename from book metadata.
 * Pattern: "{Title} (ISBN {isbn})" — truncated to max 220 chars to stay under filesystem limits.
 */
function sanitizeBookFilename(title, isbn) {
    const maxLen = 220; // Leave room for extension + filesystem limits (255)
    const base = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
    const isbnPart = isbn ? ` (ISBN ${isbn})` : '';
    const combined = base + isbnPart;
    if (combined.length <= maxLen)
        return combined;
    // Truncate title but always preserve ISBN
    const available = maxLen - isbnPart.length;
    const truncated = base.slice(0, Math.max(50, available)).trimEnd();
    return truncated + isbnPart;
}
/**
 * Clean up PNGs (Seiten/ folder) if user opted out of keeping originals.
 * Guards:
 *   - Only deletes if keepOriginalPngs is false
 *   - Only deletes if PDF was successfully built (or PDF download wasn't requested)
 *   - Retries on failure (Windows file locks) with async delay
 *   - Logs all outcomes
 */
/**
 * [Bug10] Robust PNG cleanup with individual file deletion + longer delays.
 * Windows file locks (EPERM) are caused by:
 * - pdf-lib holding buffers in memory (GC hasn't collected them yet)
 * - Windows thumbnail cache locking image files
 * - Antivirus scanners scanning newly-created files
 *
 * Strategy:
 * 1. Wait for GC pressure to release pdf-lib buffers
 * 2. Delete files individually (skip locked ones)
 * 3. Retry locked files with escalating delays
 * 4. Finally try to remove the empty directory
 */
async function cleanupPngsIfNeeded(pagesDir, options, checkpoint) {
    if (options.keepOriginalPngs)
        return;
    // If PDF was requested, only delete PNGs after successful PDF build
    if (options.downloadPdf) {
        const pdfStatus = checkpoint.getState().pdf.status;
        if (pdfStatus !== 'completed') {
            logger_1.logger.debug('Engine', `PNG cleanup skipped — PDF status is "${pdfStatus}", not "completed"`);
            return;
        }
    }
    if (!fs.existsSync(pagesDir))
        return;
    // [Bug10] Step 1: Initial delay to let Windows release file handles
    // pdf-lib buffers + Windows thumbnail cache need time to release
    await new Promise((resolve) => setTimeout(resolve, 2000));
    // [Bug10] Step 2: Try individual file deletion first — more resilient than rmSync recursive
    const files = fs.readdirSync(pagesDir);
    const failedFiles = [];
    for (const file of files) {
        const filePath = path.join(pagesDir, file);
        try {
            fs.unlinkSync(filePath);
        }
        catch {
            failedFiles.push(filePath);
        }
    }
    if (failedFiles.length > 0) {
        logger_1.logger.warn('Engine', `PNG cleanup: ${failedFiles.length}/${files.length} files locked — retrying with delay`);
        // [Bug10] Step 3: Retry locked files with escalating delays (2s, 4s, 6s)
        for (let attempt = 1; attempt <= 3; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
            const stillFailed = [];
            for (const filePath of failedFiles) {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
                catch {
                    stillFailed.push(filePath);
                }
            }
            failedFiles.length = 0;
            failedFiles.push(...stillFailed);
            if (failedFiles.length === 0)
                break;
            logger_1.logger.warn('Engine', `PNG cleanup retry ${attempt}/3: ${failedFiles.length} files still locked`);
        }
    }
    // [Bug10] Step 4: Try to remove the directory (may still contain locked files)
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            fs.rmSync(pagesDir, { recursive: true, force: true });
            logger_1.logger.info('Engine', `PNG cleanup: Seiten/ directory removed successfully`);
            return;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger_1.logger.warn('Engine', `PNG cleanup dir removal attempt ${attempt}/3 failed: ${msg}`);
            if (attempt < 3) {
                await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
            }
        }
    }
    // [Bug10] Final fallback: if directory can't be removed, at least log how many files remain
    try {
        const remaining = fs.readdirSync(pagesDir).length;
        if (remaining === 0) {
            // Directory is empty but can't be deleted — likely locked by Explorer thumbnail
            fs.rmdirSync(pagesDir);
            logger_1.logger.info('Engine', `PNG cleanup: Empty Seiten/ directory removed on final attempt`);
        }
        else {
            logger_1.logger.error('Engine', `PNG cleanup FAILED — ${remaining} files remain in Seiten/ folder`);
        }
    }
    catch {
        logger_1.logger.error('Engine', `PNG cleanup FAILED — Seiten/ folder remains (possibly locked by system)`);
    }
}
//# sourceMappingURL=engine.js.map