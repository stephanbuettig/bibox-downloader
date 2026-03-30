"use strict";
// ============================================================================
// BiBox Downloader — Materials PDF Builder
// ============================================================================
// Combines all downloadable document materials (PDF, DOCX, DOC, images) into
// a single combined PDF for convenient offline access.
//
// Conversion strategy (priority order):
//   PDF    → merge directly via pdf-lib
//     Encrypted PDFs → decrypt via Electron's Chromium (BrowserWindow + printToPDF)
//   DOC/DOCX:
//     1. MS Word COM via PowerShell (best quality, requires Word installed)
//     2. Raw text extraction + pdf-lib rendering (last resort, basic quality)
//   Images → embed as full-page images via pdf-lib
//   Other  → skip, listed on cover page
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
exports.buildMaterialsPdf = buildMaterialsPdf;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const zlib = __importStar(require("zlib"));
const electron_1 = require("electron");
const pdf_lib_1 = require("pdf-lib");
const logger_1 = require("../logging/logger");
const word_to_pdf_converter_1 = require("./word-to-pdf-converter");
// word-extractor is a CommonJS module — require() for Electron compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WordExtractor = require('word-extractor');
// A4 dimensions in PDF points (72 dpi)
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 50;
const LINE_HEIGHT = 14;
const BODY_SIZE = 10;
const MAX_LINE_WIDTH = A4_WIDTH - 2 * MARGIN;
/**
 * Sanitize text for pdf-lib's WinAnsi encoding.
 * Replaces characters outside the WinAnsi (Windows-1252) range with safe equivalents.
 */
function sanitizeWinAnsi(text) {
    return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, (ch) => {
        const code = ch.charCodeAt(0);
        switch (code) {
            case 0x2018:
            case 0x2019:
            case 0x201A: return "'";
            case 0x201C:
            case 0x201D:
            case 0x201E: return '"';
            case 0x2026: return '...';
            case 0x2013: return '-';
            case 0x2014: return '--';
            case 0x2022: return '*';
            case 0x20AC: return 'EUR';
            case 0x2122: return 'TM';
            case 0x0152: return 'OE';
            case 0x0153: return 'oe';
            default:
                if (code < 0x20)
                    return '';
                return '?';
        }
    });
}
// Reference page dimensions — determined from book's cover page
let refPageWidth = A4_WIDTH;
let refPageHeight = A4_HEIGHT;
// Note: detectCoverPageSize was removed — materials PDF always uses A4 for
// consistent page dimensions. The book's cover PNG has pixel-based dimensions
// (e.g. 2244×3071) that don't translate well to PDF points, causing imported
// A4 PDFs to appear tiny in comparison.
// ============================================================================
// Main entry point
// ============================================================================
async function buildMaterialsPdf(bookDir) {
    const materialsDir = path.join(bookDir, 'Materialien');
    if (!fs.existsSync(materialsDir)) {
        return { success: false, error: 'Materialien-Ordner nicht gefunden' };
    }
    let bookTitle = path.basename(bookDir);
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(bookDir, 'Manifest.json'), 'utf-8'));
        if (manifest.title)
            bookTitle = manifest.title;
    }
    catch { /* use folder name */ }
    logger_1.logger.info('MatPDF', `Starting materials PDF build for "${bookTitle}"`);
    // Materials PDF always uses A4 dimensions for consistent layout.
    // The book's cover PNG may have pixel dimensions (e.g. 2244×3071) that are
    // far too large for PDF points, causing mismatched page sizes.
    refPageWidth = A4_WIDTH;
    refPageHeight = A4_HEIGHT;
    const files = collectDocumentFiles(materialsDir);
    if (files.length === 0) {
        return { success: false, error: 'Keine druckbaren Materialien gefunden' };
    }
    const docFiles = files.filter((f) => f.type !== 'skip');
    const skippedFiles = files.filter((f) => f.type === 'skip');
    const wordFiles = docFiles.filter((f) => f.type === 'doc' || f.type === 'docx');
    logger_1.logger.info('MatPDF', `Found ${docFiles.length} convertible files (${wordFiles.length} DOC/DOCX), ${skippedFiles.length} skipped`);
    try {
        // ================================================================
        // Phase 1: Pre-convert all DOC/DOCX files to PDF
        // ================================================================
        const convertedPdfs = await preConvertWordFiles(wordFiles, bookDir);
        // ================================================================
        // Phase 2: Assemble the combined PDF
        // ================================================================
        const mergedPdf = await pdf_lib_1.PDFDocument.create();
        mergedPdf.setTitle(`${bookTitle} — Materialien`);
        mergedPdf.setAuthor('Westermann Verlag');
        mergedPdf.setSubject('Zusammengefasste Lernmaterialien');
        mergedPdf.setKeywords(['BiBox', 'Materialien', bookTitle]);
        mergedPdf.setCreator('BiBox Downloader v1.0');
        mergedPdf.setCreationDate(new Date());
        const font = await mergedPdf.embedFont(pdf_lib_1.StandardFonts.Helvetica);
        const fontBold = await mergedPdf.embedFont(pdf_lib_1.StandardFonts.HelveticaBold);
        createCoverPage(mergedPdf, fontBold, font, bookTitle, docFiles, skippedFiles);
        // Temp directory for decrypting protected PDFs via Chromium printToPDF
        const decryptDir = path.join(bookDir, '.tmp-pdf-convert', 'decrypt');
        fs.mkdirSync(decryptDir, { recursive: true });
        let processedCount = 0;
        let failedCount = 0;
        for (const file of docFiles) {
            try {
                addSeparatorPage(mergedPdf, fontBold, font, file.filename, processedCount + 1, docFiles.length);
                if (file.type === 'pdf') {
                    await mergePdfFile(mergedPdf, file.filePath, decryptDir);
                }
                else if (file.type === 'doc' || file.type === 'docx') {
                    const convertedPdfPath = convertedPdfs.get(file.filePath);
                    if (convertedPdfPath) {
                        await mergePdfFile(mergedPdf, convertedPdfPath, decryptDir);
                    }
                    else {
                        throw new Error('Konvertierung fehlgeschlagen');
                    }
                }
                else if (file.type === 'image') {
                    await embedImageAsPage(mergedPdf, file.filePath);
                }
                processedCount++;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger_1.logger.warn('MatPDF', `Failed to process "${file.filename}": ${msg}`);
                addErrorPage(mergedPdf, font, file.filename, msg);
                failedCount++;
            }
        }
        logger_1.logger.info('MatPDF', `Processed ${processedCount} files, ${failedCount} failed`);
        // ================================================================
        // Phase 3: Save the combined PDF
        // ================================================================
        const outputFilename = sanitizeFilename(`${bookTitle} — Materialien`) + '.pdf';
        const outputPath = path.join(bookDir, outputFilename);
        const pdfBytes = await mergedPdf.save();
        const tmpPath = outputPath + '.tmp';
        fs.writeFileSync(tmpPath, pdfBytes);
        fs.renameSync(tmpPath, outputPath);
        const sizeMB = (pdfBytes.length / 1024 / 1024).toFixed(1);
        logger_1.logger.info('MatPDF', `Materials PDF saved: "${outputFilename}" (${sizeMB} MB, ${mergedPdf.getPageCount()} pages)`);
        cleanupTempDir(bookDir);
        return { success: true, path: outputPath };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger_1.logger.error('MatPDF', `Materials PDF build failed: ${msg}`, err);
        cleanupTempDir(bookDir);
        return { success: false, error: msg };
    }
}
// ============================================================================
// Phase 1: Pre-convert all DOC/DOCX → PDF
// ============================================================================
/**
 * Pre-converts all Word files to individual PDFs.
 * Strategy:
 *   1. MS Word COM via PowerShell (best quality, requires Word)
 *   2. Raw text extraction + pdf-lib (last resort, basic quality)
 */
async function preConvertWordFiles(wordFiles, bookDir) {
    if (wordFiles.length === 0)
        return new Map();
    const tmpDir = path.join(bookDir, '.tmp-pdf-convert');
    fs.mkdirSync(tmpDir, { recursive: true });
    const resultMap = new Map();
    const startTime = Date.now();
    let remainingFiles = [...wordFiles];
    // --- Strategy 1: MS Word COM via PowerShell (preferred) ---
    const wordAvail = await (0, word_to_pdf_converter_1.isWordAvailable)();
    if (wordAvail) {
        logger_1.logger.info('MatPDF', `MS Word available — converting ${wordFiles.length} Word files via COM`);
        const wordResults = await (0, word_to_pdf_converter_1.convertAllDocsViaWord)(wordFiles.map((f) => f.filePath), path.join(tmpDir, 'word'), {
            timeoutMs: 600_000,
            onProgress: (done, total) => {
                logger_1.logger.debug('MatPDF', `Word COM progress: ${done}/${total}`);
            },
            onStatus: (msg) => {
                logger_1.logger.info('MatPDF', `Word: ${msg}`);
            },
        });
        for (const [inputPath, outputPdfPath] of wordResults.entries()) {
            resultMap.set(inputPath, outputPdfPath);
        }
        remainingFiles = wordFiles.filter((f) => !resultMap.has(f.filePath));
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        logger_1.logger.info('MatPDF', `Word COM: ${resultMap.size}/${wordFiles.length} converted in ${elapsedSec}s, ${remainingFiles.length} remaining`);
    }
    else {
        logger_1.logger.warn('MatPDF', 'MS Word NOT available — falling back to text extraction');
    }
    // --- Strategy 2: Raw text extraction (last resort) ---
    if (remainingFiles.length > 0) {
        const textDir = path.join(tmpDir, 'text');
        fs.mkdirSync(textDir, { recursive: true });
        let textOk = 0;
        for (const file of remainingFiles) {
            try {
                const textPdfPath = await convertViaTextExtraction(file.filePath, textDir);
                if (textPdfPath) {
                    resultMap.set(file.filePath, textPdfPath);
                    textOk++;
                }
            }
            catch (err) {
                logger_1.logger.debug('MatPDF', `Text extraction failed for "${file.filename}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        logger_1.logger.info('MatPDF', `Text extraction: ${textOk} more converted`);
    }
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger_1.logger.info('MatPDF', `All Word conversions done: ${resultMap.size}/${wordFiles.length} in ${totalElapsed}s`);
    return resultMap;
}
// ============================================================================
// Strategy 2: Raw text extraction → pdf-lib
// ============================================================================
/**
 * Last-resort conversion: extract raw text from DOC/DOCX and render
 * as a simple text-based PDF via pdf-lib.
 */
async function convertViaTextExtraction(filePath, outputDir) {
    const headerBuf = Buffer.alloc(4);
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, headerBuf, 0, 4, 0);
    }
    finally {
        if (fd !== undefined)
            try {
                fs.closeSync(fd);
            }
            catch { /* ignore */ }
    }
    const isOLE2 = headerBuf[0] === 0xD0 && headerBuf[1] === 0xCF && headerBuf[2] === 0x11 && headerBuf[3] === 0xE0;
    const isZip = headerBuf[0] === 0x50 && headerBuf[1] === 0x4B;
    let textContent = null;
    if (isOLE2) {
        textContent = await extractTextFromOLE2Doc(filePath);
    }
    else if (isZip) {
        textContent = extractTextFromDocxZip(filePath);
    }
    if (!textContent || textContent.trim().length < 10) {
        return null;
    }
    const doc = await pdf_lib_1.PDFDocument.create();
    const font = await doc.embedFont(pdf_lib_1.StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(pdf_lib_1.StandardFonts.HelveticaBold);
    renderTextToPages(doc, textContent, font, fontBold, path.basename(filePath));
    const pdfBytes = await doc.save();
    const baseName = path.basename(filePath, path.extname(filePath));
    const outPath = path.join(outputDir, baseName + '.pdf');
    fs.writeFileSync(outPath, pdfBytes);
    return outPath;
}
// ============================================================================
// File Collection
// ============================================================================
function collectDocumentFiles(materialsDir) {
    const files = [];
    // First pass: collect all files and build a set of available PDF base names
    // per directory, so we can skip DOC/DOCX when a PDF equivalent exists.
    const pdfBaseNames = new Set(); // "dir/basename" or just "basename"
    const allEntries = fs.readdirSync(materialsDir, { withFileTypes: true });
    // --- Root-level files ---
    const rootFiles = [];
    for (const entry of allEntries) {
        if (entry.isFile() && entry.name !== '.DS_Store') {
            const filePath = path.join(materialsDir, entry.name);
            const stat = fs.statSync(filePath);
            if (stat.size === 0)
                continue;
            rootFiles.push({ name: entry.name, filePath });
            if (path.extname(entry.name).toLowerCase() === '.pdf') {
                pdfBaseNames.add(path.basename(entry.name, '.pdf').toLowerCase());
            }
        }
    }
    // --- Subdirectory files ---
    const subFiles = [];
    for (const entry of allEntries) {
        if (!entry.isDirectory() || entry.name.startsWith('.'))
            continue;
        const dir = path.join(materialsDir, entry.name);
        const subEntries = fs.readdirSync(dir);
        for (const subEntry of subEntries) {
            const filePath = path.join(dir, subEntry);
            const stat = fs.statSync(filePath);
            if (!stat.isFile() || stat.size === 0)
                continue;
            subFiles.push({ name: subEntry, filePath, dirName: entry.name });
            if (path.extname(subEntry).toLowerCase() === '.pdf') {
                pdfBaseNames.add(`${entry.name}/${path.basename(subEntry, '.pdf')}`.toLowerCase());
            }
        }
    }
    // Second pass: add files, skipping DOC/DOCX when a PDF with same base name exists
    let deduped = 0;
    for (const { name, filePath } of rootFiles) {
        const ext = path.extname(name).toLowerCase();
        if ((ext === '.doc' || ext === '.docx') && pdfBaseNames.has(path.basename(name, ext).toLowerCase())) {
            deduped++;
            continue; // skip — PDF version available
        }
        files.push({
            filePath,
            filename: name,
            type: classifyFileType(ext),
            sortKey: extractSortKey(name),
        });
    }
    for (const { name, filePath, dirName } of subFiles) {
        const ext = path.extname(name).toLowerCase();
        const key = `${dirName}/${path.basename(name, ext)}`.toLowerCase();
        if ((ext === '.doc' || ext === '.docx') && pdfBaseNames.has(key)) {
            deduped++;
            continue; // skip — PDF version available
        }
        files.push({
            filePath,
            filename: `${dirName}/${name}`,
            type: classifyFileType(ext),
            sortKey: extractSortKey(name),
        });
    }
    if (deduped > 0) {
        logger_1.logger.info('MatPDF', `Deduplicated: ${deduped} DOC/DOCX files skipped (PDF version available)`);
    }
    files.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'de', { numeric: true }));
    return files;
}
function classifyFileType(ext) {
    switch (ext) {
        case '.pdf': return 'pdf';
        case '.docx': return 'docx';
        case '.doc': return 'doc';
        case '.jpg':
        case '.jpeg':
        case '.png': return 'image';
        default: return 'skip';
    }
}
function extractSortKey(filename) {
    const match = filename.match(/^S(\d{1,4})_/);
    if (match)
        return match[1].padStart(4, '0') + '_' + filename;
    return '9999_' + filename;
}
// ============================================================================
// Cover Page
// ============================================================================
function createCoverPage(doc, fontBold, font, bookTitle, docFiles, skippedFiles) {
    const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    let y = A4_HEIGHT - MARGIN;
    page.drawText('Materialien-Sammlung', {
        x: MARGIN, y, size: 22, font: fontBold, color: (0, pdf_lib_1.rgb)(0.05, 0.09, 0.16),
    });
    y -= 30;
    page.drawText(sanitizeWinAnsi(bookTitle), {
        x: MARGIN, y, size: 14, font: font, color: (0, pdf_lib_1.rgb)(0.23, 0.51, 0.96),
    });
    y -= 24;
    page.drawLine({
        start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y },
        thickness: 1, color: (0, pdf_lib_1.rgb)(0.8, 0.83, 0.87),
    });
    y -= 24;
    const pdfCount = docFiles.filter((f) => f.type === 'pdf').length;
    const docxCount = docFiles.filter((f) => f.type === 'docx' || f.type === 'doc').length;
    const imgCount = docFiles.filter((f) => f.type === 'image').length;
    const stats = [
        `${docFiles.length} Dokumente zusammengefasst`,
        `  ${pdfCount} PDF-Dateien`,
        `  ${docxCount} Word-Dokumente (DOCX/DOC)`,
        `  ${imgCount} Bilder`,
    ];
    if (skippedFiles.length > 0) {
        stats.push('');
        stats.push(`${skippedFiles.length} Dateien uebersprungen (Audio, Video, ZIP, etc.)`);
    }
    for (const line of stats) {
        if (y < MARGIN + 20)
            break;
        page.drawText(line, {
            x: MARGIN, y, size: 11, font: font, color: (0, pdf_lib_1.rgb)(0.3, 0.3, 0.3),
        });
        y -= LINE_HEIGHT + 2;
    }
    y -= 16;
    page.drawText(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`, {
        x: MARGIN, y, size: 9, font: font, color: (0, pdf_lib_1.rgb)(0.5, 0.5, 0.5),
    });
    y -= LINE_HEIGHT;
    page.drawText('Erstellt mit BiBox Downloader', {
        x: MARGIN, y, size: 9, font: font, color: (0, pdf_lib_1.rgb)(0.5, 0.5, 0.5),
    });
}
// ============================================================================
// Separator / Error Pages
// ============================================================================
function addSeparatorPage(doc, fontBold, font, filename, index, total) {
    const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    const startY = A4_HEIGHT / 2 + 40;
    page.drawText(`Dokument ${index} / ${total}`, {
        x: MARGIN, y: startY + 30, size: 11, font, color: (0, pdf_lib_1.rgb)(0.5, 0.5, 0.5),
    });
    const maxW = A4_WIDTH - 2 * MARGIN;
    const wrappedLines = wrapFilename(sanitizeWinAnsi(filename), fontBold, 14, maxW);
    let y = startY;
    for (const line of wrappedLines) {
        page.drawText(line, {
            x: MARGIN, y, size: 14, font: fontBold, color: (0, pdf_lib_1.rgb)(0.05, 0.09, 0.16),
        });
        y -= 20;
    }
    page.drawLine({
        start: { x: MARGIN, y: y + 6 }, end: { x: A4_WIDTH - MARGIN, y: y + 6 },
        thickness: 0.5, color: (0, pdf_lib_1.rgb)(0.8, 0.83, 0.87),
    });
}
function wrapFilename(text, font, size, maxWidth) {
    if (!text)
        return [''];
    const tokens = text.split(/(?<=[\s_\-/])(?!$)|(?=\()/);
    const lines = [];
    let currentLine = '';
    for (const token of tokens) {
        const testLine = currentLine + token;
        let width;
        try {
            width = font.widthOfTextAtSize(testLine, size);
        }
        catch {
            width = testLine.length * size * 0.55;
        }
        if (width > maxWidth && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = token;
        }
        else {
            currentLine = testLine;
        }
    }
    if (currentLine)
        lines.push(currentLine);
    return lines.length > 0 ? lines : [''];
}
function addErrorPage(doc, font, filename, errorMsg) {
    const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    const y = A4_HEIGHT / 2;
    page.drawText('Konvertierung fehlgeschlagen', {
        x: MARGIN, y: y + 20, size: 14, font, color: (0, pdf_lib_1.rgb)(0.8, 0.2, 0.2),
    });
    page.drawText(sanitizeWinAnsi(filename), {
        x: MARGIN, y, size: 11, font, color: (0, pdf_lib_1.rgb)(0.3, 0.3, 0.3),
    });
    const shortError = errorMsg.length > 120 ? errorMsg.slice(0, 117) + '...' : errorMsg;
    page.drawText(sanitizeWinAnsi(shortError), {
        x: MARGIN, y: y - 20, size: 9, font, color: (0, pdf_lib_1.rgb)(0.5, 0.5, 0.5),
    });
}
// ============================================================================
// PDF Merge
// ============================================================================
/**
 * Decrypt a protected PDF using Electron's built-in Chromium PDF renderer.
 * Chromium can natively open PDFs with owner-only encryption (empty user password)
 * and render them. We use a hidden BrowserWindow to load the PDF, then
 * webContents.printToPDF() to produce a decrypted copy.
 *
 * This is a zero-dependency solution — no external tools (qpdf, Ghostscript)
 * or MS Word needed. Verified working with AES-128 (V=4, R=4) encryption.
 *
 * Returns the path to the decrypted PDF file, or null on failure.
 */
async function decryptPdfViaChromium(inputPath, outputDir) {
    const baseName = path.basename(inputPath, '.pdf');
    const outputPath = path.join(outputDir, baseName + '_decrypted.pdf');
    let win = null;
    try {
        win = new electron_1.BrowserWindow({
            width: 800,
            height: 1100,
            show: false,
            webPreferences: {
                plugins: true, // Enable PDF viewer plugin
            },
        });
        // Build file:// URI — Chromium needs forward slashes
        const fileUri = `file://${inputPath.replace(/\\/g, '/')}`;
        logger_1.logger.debug('MatPDF', `Loading encrypted PDF in Chromium: ${fileUri}`);
        await win.loadURL(fileUri);
        // Wait for the PDF viewer to fully render the document
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const pdfData = await win.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
            pageSize: 'A4',
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
        });
        fs.writeFileSync(outputPath, pdfData);
        // Verify the output is non-trivial (>5KB means actual content)
        const stat = fs.statSync(outputPath);
        if (stat.size < 5000) {
            logger_1.logger.warn('MatPDF', `Chromium decrypt produced tiny file (${stat.size} bytes) — likely empty`);
            try {
                fs.unlinkSync(outputPath);
            }
            catch { /* ignore */ }
            return null;
        }
        logger_1.logger.info('MatPDF', `PDF decrypted via Chromium: "${baseName}.pdf" (${(stat.size / 1024).toFixed(1)} KB)`);
        return outputPath;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger_1.logger.warn('MatPDF', `Chromium PDF decrypt failed for "${baseName}.pdf": ${msg}`);
        return null;
    }
    finally {
        if (win && !win.isDestroyed()) {
            win.close();
        }
    }
}
/**
 * Detect if a PDF file is encrypted by checking for an /Encrypt dictionary.
 * Scans the last 4KB of the file (where the trailer usually is) and the
 * cross-reference stream for the /Encrypt keyword.
 */
function isPdfEncrypted(fileBytes) {
    // Check the last 4KB (trailer) and also first 4KB (linearized PDFs)
    const tailStart = Math.max(0, fileBytes.length - 4096);
    const tail = fileBytes.slice(tailStart).toString('latin1');
    const head = fileBytes.slice(0, Math.min(4096, fileBytes.length)).toString('latin1');
    return tail.includes('/Encrypt') || head.includes('/Encrypt');
}
async function mergePdfFile(targetDoc, filePath, decryptDir) {
    const fileBytes = fs.readFileSync(filePath);
    const encrypted = isPdfEncrypted(fileBytes);
    if (encrypted) {
        logger_1.logger.info('MatPDF', `Verschluesseltes PDF erkannt: "${path.basename(filePath)}" — Entschluesselung via Chromium`);
        // Decrypt via Electron's built-in Chromium PDF renderer
        if (decryptDir) {
            const decryptedPath = await decryptPdfViaChromium(filePath, decryptDir);
            if (decryptedPath) {
                const decryptedBytes = fs.readFileSync(decryptedPath);
                try {
                    const srcDoc = await pdf_lib_1.PDFDocument.load(decryptedBytes);
                    const pages = await targetDoc.copyPages(srcDoc, srcDoc.getPageIndices());
                    for (const page of pages) {
                        targetDoc.addPage(page);
                    }
                    logger_1.logger.info('MatPDF', `Verschluesseltes PDF entschluesselt und eingefuegt: "${path.basename(filePath)}" (${pages.length} Seiten)`);
                    return;
                }
                catch (err) {
                    logger_1.logger.warn('MatPDF', `Entschluesseltes PDF nicht lesbar: "${path.basename(filePath)}" — ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
        throw new Error(`Geschuetztes PDF — Entschluesselung fehlgeschlagen`);
    }
    // Non-encrypted PDF: standard merge
    try {
        const srcDoc = await pdf_lib_1.PDFDocument.load(fileBytes, { ignoreEncryption: true });
        const pages = await targetDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        for (const page of pages) {
            targetDoc.addPage(page);
        }
    }
    catch (err) {
        throw new Error(`PDF nicht lesbar: ${err instanceof Error ? err.message : String(err)}`);
    }
}
// ============================================================================
// Raw Text Extraction
// ============================================================================
/**
 * Extract text from OLE2 binary .doc files using the word-extractor library.
 * This properly parses the OLE2 compound document structure and extracts
 * the actual Word document text, instead of scanning for raw byte patterns.
 */
async function extractTextFromOLE2Doc(filePath) {
    const extractor = new WordExtractor();
    const buf = fs.readFileSync(filePath);
    const doc = await extractor.extract(buf);
    // getBody() returns the main document text
    let text = doc.getBody() || '';
    // Also include headers/footers if they contain useful content
    const headers = doc.getHeaders?.({ includeFooters: false }) || '';
    const footers = doc.getFooters?.({ includeHeaders: false }) || '';
    if (headers && headers.trim().length > 0) {
        text = headers.trim() + '\n\n' + text;
    }
    if (footers && footers.trim().length > 0) {
        text = text + '\n\n' + footers.trim();
    }
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 10) {
        throw new Error('Kein lesbarer Text im DOC gefunden');
    }
    return text;
}
function extractTextFromDocxZip(filePath) {
    const buf = fs.readFileSync(filePath);
    const targetName = 'word/document.xml';
    let xml = null;
    let offset = 0;
    while (offset < buf.length - 30) {
        if (buf[offset] !== 0x50 || buf[offset + 1] !== 0x4B ||
            buf[offset + 2] !== 0x03 || buf[offset + 3] !== 0x04) {
            offset++;
            continue;
        }
        const compressionMethod = buf.readUInt16LE(offset + 8);
        const compressedSize = buf.readUInt32LE(offset + 18);
        const fileNameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const fileName = buf.toString('utf-8', offset + 30, offset + 30 + fileNameLen);
        const dataStart = offset + 30 + fileNameLen + extraLen;
        if (dataStart + compressedSize > buf.length)
            break;
        if (fileName === targetName && compressedSize > 0) {
            const compressedData = buf.subarray(dataStart, dataStart + compressedSize);
            if (compressionMethod === 0) {
                xml = compressedData.toString('utf-8');
            }
            else if (compressionMethod === 8) {
                xml = zlib.inflateRawSync(compressedData, { maxOutputLength: 50 * 1024 * 1024 }).toString('utf-8');
            }
            break;
        }
        offset = dataStart + compressedSize;
    }
    if (!xml) {
        throw new Error('DOCX: word/document.xml nicht gefunden');
    }
    const text = xml
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!text) {
        throw new Error('DOCX: Kein Text gefunden');
    }
    return text;
}
// ============================================================================
// Text Rendering to PDF Pages
// ============================================================================
function renderTextToPages(doc, text, font, _fontBold, sourceFilename) {
    const lines = text.split('\n');
    let page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    let y = A4_HEIGHT - MARGIN;
    const drawPageHeader = () => {
        page.drawText(sanitizeWinAnsi(sourceFilename), {
            x: MARGIN, y: A4_HEIGHT - 30, size: 7, font, color: (0, pdf_lib_1.rgb)(0.6, 0.6, 0.6),
        });
        page.drawLine({
            start: { x: MARGIN, y: A4_HEIGHT - 35 },
            end: { x: A4_WIDTH - MARGIN, y: A4_HEIGHT - 35 },
            thickness: 0.3, color: (0, pdf_lib_1.rgb)(0.85, 0.85, 0.85),
        });
    };
    drawPageHeader();
    y = A4_HEIGHT - MARGIN - 10;
    for (const rawLine of lines) {
        const wrappedLines = wrapText(rawLine, font, BODY_SIZE, MAX_LINE_WIDTH);
        for (const line of wrappedLines) {
            if (y < MARGIN + 20) {
                page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
                drawPageHeader();
                y = A4_HEIGHT - MARGIN - 10;
            }
            if (line.trim().length > 0) {
                page.drawText(sanitizeWinAnsi(line), {
                    x: MARGIN, y, size: BODY_SIZE, font, color: (0, pdf_lib_1.rgb)(0.1, 0.1, 0.1),
                });
            }
            y -= LINE_HEIGHT;
        }
    }
}
function wrapText(text, font, size, maxWidth) {
    if (!text || text.trim().length === 0)
        return [''];
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        let width;
        try {
            width = font.widthOfTextAtSize(testLine, size);
        }
        catch {
            width = testLine.length * size * 0.5;
        }
        if (width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        }
        else {
            currentLine = testLine;
        }
    }
    if (currentLine)
        lines.push(currentLine);
    return lines.length > 0 ? lines : [''];
}
// ============================================================================
// Image Embedding
// ============================================================================
async function embedImageAsPage(doc, filePath) {
    const imgBytes = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let img;
    if (ext === '.png') {
        img = await doc.embedPng(imgBytes);
    }
    else if (ext === '.jpg' || ext === '.jpeg') {
        img = await doc.embedJpg(imgBytes);
    }
    else {
        throw new Error(`Bildformat nicht unterstuetzt: ${ext}`);
    }
    const { width: imgW, height: imgH } = img.scale(1);
    const pageW = refPageWidth;
    // Scale image to fill page width exactly (matching cover/Deckblatt width)
    const scale = pageW / imgW;
    const drawW = pageW;
    const drawH = imgH * scale;
    // Page height adapts to image — but never smaller than refPageHeight
    const pageH = Math.max(drawH, refPageHeight);
    const drawX = 0;
    // Center vertically if page is taller than the image
    const drawY = (pageH - drawH) / 2;
    const page = doc.addPage([pageW, pageH]);
    page.drawImage(img, {
        x: drawX, y: drawY,
        width: drawW, height: drawH,
    });
}
// ============================================================================
// Helpers
// ============================================================================
function sanitizeFilename(name) {
    return name
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
}
function cleanupTempDir(bookDir) {
    const tmpDir = path.join(bookDir, '.tmp-pdf-convert');
    try {
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            logger_1.logger.debug('MatPDF', 'Cleaned up temp conversion directory');
        }
    }
    catch (err) {
        logger_1.logger.debug('MatPDF', `Failed to cleanup temp dir: ${err instanceof Error ? err.message : String(err)}`);
    }
}
//# sourceMappingURL=materials-pdf-builder.js.map