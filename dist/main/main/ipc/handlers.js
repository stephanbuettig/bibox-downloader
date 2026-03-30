"use strict";
// ============================================================================
// BiBox Downloader — IPC Handlers (Main ↔ Renderer Bridge)
// ============================================================================
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
exports.setMainWindow = setMainWindow;
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("../../shared/types");
const oauth_1 = require("../auth/oauth");
const token_store_1 = require("../auth/token-store");
const etag_cache_1 = require("../api/etag-cache");
const bibox_api_1 = require("../api/bibox-api");
const engine_1 = require("../download/engine");
const disk_check_1 = require("../storage/disk-check");
const logger_1 = require("../logging/logger");
let getAppRoot;
let mainWindowRef = null;
/** Store main window reference — never rely on getFocusedWindow alone */
function setMainWindow(win) {
    mainWindowRef = win;
}
function getMainWindow() {
    if (mainWindowRef && !mainWindowRef.isDestroyed())
        return mainWindowRef;
    return electron_1.BrowserWindow.getFocusedWindow(); // fallback
}
function registerIpcHandlers(appRootGetter) {
    getAppRoot = appRootGetter;
    // Initialize ETag cache
    const cacheDir = path.join(getAppRoot(), 'cache');
    etag_cache_1.etagCache.initialize(cacheDir);
    // --- Auth ---
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.AUTH_LOGIN, async () => {
        return (0, oauth_1.performLogin)();
    });
    // [BugD-FIX] Silent auto-login — try to reuse existing Westermann SSO session
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.AUTH_SILENT_LOGIN, async () => {
        return (0, oauth_1.trySilentLogin)();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.AUTH_STATUS, async () => {
        return {
            status: token_store_1.tokenStore.getStatus(),
            expiresAt: token_store_1.tokenStore.getExpiresAt(),
            remainingSeconds: token_store_1.tokenStore.getRemainingSeconds(),
        };
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.AUTH_LOGOUT, async () => {
        token_store_1.tokenStore.clear();
    });
    // --- Books ---
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.BOOKS_LIST, async () => {
        const books = await (0, bibox_api_1.fetchBooks)();
        return books;
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.BOOKS_ESTIMATE, async (_event, bookIds) => {
        // [M11-FIX] Validate input — prevent crashes from malformed IPC args
        if (!Array.isArray(bookIds)) {
            throw new Error('Invalid bookIds: expected number[]');
        }
        const bookIdList = bookIds;
        const estimates = [];
        for (const bookId of bookIdList) {
            try {
                // Use sync endpoint — it contains the actual page list and materials
                const syncData = await (0, bibox_api_1.fetchSyncData)(bookId);
                const pageCount = syncData.pages.length;
                const materialCount = syncData.materials.length;
                const estimatedMB = Math.ceil((pageCount * types_1.BIBOX_CONSTANTS.AVG_PAGE_SIZE_KB / 1024) * types_1.BIBOX_CONSTANTS.PDF_OVERHEAD_FACTOR
                    + (materialCount > 0 ? types_1.BIBOX_CONSTANTS.MATERIAL_ESTIMATE_MB : 0));
                estimates.push({ bookId, estimatedMB, pageCount });
            }
            catch {
                // Fallback: lighter pageData endpoint
                try {
                    const pageData = await (0, bibox_api_1.fetchPageData)(bookId);
                    const pageCount = pageData.pageCount || 0;
                    const estimatedMB = pageCount > 0
                        ? Math.ceil((pageCount * types_1.BIBOX_CONSTANTS.AVG_PAGE_SIZE_KB / 1024) * types_1.BIBOX_CONSTANTS.PDF_OVERHEAD_FACTOR + types_1.BIBOX_CONSTANTS.MATERIAL_ESTIMATE_MB)
                        : 0;
                    estimates.push({ bookId, estimatedMB, pageCount });
                }
                catch {
                    estimates.push({ bookId, estimatedMB: 0, pageCount: 0 });
                }
            }
        }
        return estimates;
    });
    // --- Download ---
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOWNLOAD_START, async (_event, config) => {
        // [Review2] Runtime validation of IPC args
        const cfg = config;
        if (!cfg || !Array.isArray(cfg.bookIds) || typeof cfg.outputDir !== 'string') {
            throw new Error('Invalid download config: bookIds (array) and outputDir (string) required');
        }
        const mainWindow = getMainWindow();
        // Run in background — don't block IPC
        (0, engine_1.startDownloadFlow)(cfg, mainWindow).catch((err) => {
            logger_1.logger.error('IPC', 'Download flow error:', err);
        });
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOWNLOAD_RESUME, async (_event, bookId, outputDir) => {
        // [Review2] Runtime validation
        if (typeof bookId !== 'number' || typeof outputDir !== 'string') {
            throw new Error('Invalid resume args: bookId (number) and outputDir (string) required');
        }
        const bid = bookId;
        const dir = outputDir;
        // Check for existing checkpoint and resume
        const books = await (0, bibox_api_1.fetchBooks)();
        const book = books.find((b) => b.id === bid);
        if (!book)
            throw new Error(`Book ${bid} not found`);
        const mainWindow = getMainWindow();
        // Resume is effectively a start with existing checkpoint
        (0, engine_1.startDownloadFlow)({
            bookIds: [bid],
            outputDir: dir,
            options: {
                downloadPdf: true,
                keepOriginalPngs: true,
                downloadMaterials: true,
                downloadHtml5: true,
                exportMaterialsPdf: false,
                enableOcr: false,
                maxParallel: types_1.BIBOX_CONSTANTS.DEFAULT_PARALLEL_CDN,
                pdfCompression: 'none',
            },
        }, mainWindow).catch((err) => {
            logger_1.logger.error('IPC', 'Resume error:', err);
        });
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOWNLOAD_PAUSE, async (_event, bookId) => {
        if (typeof bookId !== 'number')
            throw new Error('Invalid bookId: expected number');
        (0, engine_1.pauseDownload)(bookId);
    });
    // [Bug7] Unpause — resume throttle without restarting from checkpoint
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOWNLOAD_UNPAUSE, async (_event, bookId) => {
        if (typeof bookId !== 'number')
            throw new Error('Invalid bookId: expected number');
        (0, engine_1.resumeDownload)(bookId);
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DOWNLOAD_CANCEL, async (_event, bookId) => {
        if (typeof bookId !== 'number')
            throw new Error('Invalid bookId: expected number');
        (0, engine_1.cancelDownload)(bookId);
    });
    // --- Disk ---
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DISK_CHECK, async (_event, dirPath) => {
        if (typeof dirPath !== 'string')
            throw new Error('Invalid dirPath: expected string');
        return (0, disk_check_1.checkDiskSpace)(dirPath);
    });
    // --- Dialogs ---
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SELECT_DIRECTORY, async () => {
        const mainWindow = getMainWindow();
        if (!mainWindow)
            return null;
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: 'Download-Ordner wählen',
            defaultPath: path.join(getAppRoot(), 'Downloads'),
            properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || result.filePaths.length === 0)
            return null;
        return result.filePaths[0];
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.OPEN_DIRECTORY, async (_event, dirPath) => {
        if (typeof dirPath !== 'string')
            return;
        await electron_1.shell.openPath(dirPath);
    });
    // --- Logging ---
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.LOG_EXPORT, async () => {
        const logPath = logger_1.logger.getLogFilePath();
        if (!logPath)
            return { success: false, error: 'Logger not initialized' };
        if (!fs.existsSync(logPath))
            return { success: false, error: 'No log file found' };
        const mainWindow = getMainWindow();
        if (!mainWindow)
            return { success: false, error: 'No window' };
        const result = await electron_1.dialog.showSaveDialog(mainWindow, {
            title: 'Log-Datei exportieren',
            defaultPath: `bibox-downloader-log_${new Date().toISOString().slice(0, 10)}.log`,
            filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }],
        });
        if (result.canceled || !result.filePath)
            return { success: false, error: 'Cancelled' };
        try {
            fs.copyFileSync(logPath, result.filePath);
            return { success: true, path: result.filePath };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, error: msg };
        }
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.LOG_OPEN_DIR, async () => {
        const logDir = logger_1.logger.getLogDir();
        if (logDir) {
            electron_1.shell.openPath(logDir);
        }
    });
    // --- External URLs ---
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.OPEN_URL, async (_event, url) => {
        if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
            await electron_1.shell.openExternal(url);
        }
    });
    // --- Materials PDF Export ---
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.MATERIALS_EXPORT_PDF, async (_event, bookDir) => {
        if (typeof bookDir !== 'string')
            return { success: false, error: 'Invalid bookDir' };
        const dir = bookDir;
        try {
            const { buildMaterialsPdf } = await Promise.resolve().then(() => __importStar(require('../pdf/materials-pdf-builder')));
            const result = await buildMaterialsPdf(dir);
            return result;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger_1.logger.error('IPC', `Materials PDF export failed: ${msg}`, err);
            return { success: false, error: msg };
        }
    });
    // [Bug8][K4-FIX] Calculate actual folder size recursively — fully async to avoid blocking Main
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.FOLDER_SIZE, async (_event, dirPath) => {
        if (typeof dirPath !== 'string')
            return 0;
        const dir = dirPath;
        try {
            const fsP = fs.promises;
            let totalSize = 0;
            const walkDir = async (p) => {
                let entries;
                try {
                    entries = await fsP.readdir(p, { withFileTypes: true });
                }
                catch {
                    return;
                }
                for (const entry of entries) {
                    const fullPath = path.join(p, entry.name);
                    if (entry.isDirectory()) {
                        await walkDir(fullPath);
                    }
                    else {
                        try {
                            const stat = await fsP.stat(fullPath);
                            totalSize += stat.size;
                        }
                        catch { /* skip inaccessible files */ }
                    }
                }
            };
            await walkDir(dir);
            return totalSize;
        }
        catch {
            return 0;
        }
    });
    // [Bug9][K5-FIX][BugB-FIX] Check which books have already been fully downloaded — fully async.
    // Manifest.json is the definitive completion marker (checkpoint file is removed after success).
    // If a .download-state.json exists with status != 'completed', the download is still in progress.
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.CHECK_COMPLETED_BOOKS, async (_event, dirPath) => {
        if (typeof dirPath !== 'string')
            return [];
        const dir = dirPath;
        const completedBookIds = [];
        const fsP = fs.promises;
        try {
            let entries;
            try {
                entries = await fsP.readdir(dir, { withFileTypes: true });
            }
            catch {
                return completedBookIds;
            }
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const manifestPath = path.join(dir, entry.name, 'Manifest.json');
                const checkpointPath = path.join(dir, entry.name, '.download-state.json');
                try {
                    const manifestRaw = await fsP.readFile(manifestPath, 'utf-8');
                    const manifest = JSON.parse(manifestRaw);
                    // If checkpoint exists, check its status (in-progress downloads still have it)
                    // If checkpoint doesn't exist, Manifest.json alone means completed (BugB cleanup)
                    let isComplete = true;
                    try {
                        const cpRaw = await fsP.readFile(checkpointPath, 'utf-8');
                        const checkpoint = JSON.parse(cpRaw);
                        // Only consider incomplete if checkpoint explicitly says so
                        if (checkpoint.status && checkpoint.status !== 'completed') {
                            isComplete = false;
                        }
                    }
                    catch { /* no checkpoint → completed (checkpoint removed after success) */ }
                    if (isComplete && manifest.bookId) {
                        completedBookIds.push(Number(manifest.bookId));
                    }
                }
                catch { /* no manifest or unreadable → skip */ }
            }
        }
        catch (err) {
            logger_1.logger.warn('IPC', `Check completed books failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return completedBookIds;
    });
    // --- Settings Persistence ---
    // Saves user preferences (outputDir, download options) to a JSON file in the app root.
    // This allows settings to survive app restarts.
    const settingsPath = path.join(getAppRoot(), 'bibox-settings.json');
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SETTINGS_LOAD, async () => {
        try {
            if (fs.existsSync(settingsPath)) {
                const raw = fs.readFileSync(settingsPath, 'utf-8');
                return JSON.parse(raw);
            }
        }
        catch (err) {
            logger_1.logger.warn('IPC', `Failed to load settings: ${err instanceof Error ? err.message : String(err)}`);
        }
        return null;
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SETTINGS_SAVE, async (_event, settings) => {
        try {
            if (settings && typeof settings === 'object') {
                fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
            }
        }
        catch (err) {
            logger_1.logger.warn('IPC', `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
}
//# sourceMappingURL=handlers.js.map