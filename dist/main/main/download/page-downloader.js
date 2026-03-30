"use strict";
// ============================================================================
// BiBox Downloader — Page Downloader (CDN PNG Downloads)
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadPages = downloadPages;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("../../shared/types");
const utils_1 = require("../../shared/utils");
const client_1 = require("../api/client");
const logger_1 = require("../logging/logger");
const p_queue_1 = __importDefault(require("p-queue"));
async function downloadPages(pages, pagesDir, checkpoint, throttle, onProgress, abortSignal) {
    // Ensure output directory
    if (!fs.existsSync(pagesDir)) {
        fs.mkdirSync(pagesDir, { recursive: true });
    }
    // Initialize checkpoint for all pages
    checkpoint.initPages(pages.map((p) => p.filename));
    // Filter to only pending/failed pages
    const pendingFilenames = new Set(checkpoint.getPendingPages());
    const pendingPages = pages.filter((p) => pendingFilenames.has(p.filename));
    logger_1.logger.info('PageDL', `Starting: ${pendingPages.length} pending of ${pages.length} total pages (${pages.length - pendingPages.length} already done)`);
    let completed = checkpoint.getCompletedPageCount();
    const total = pages.length;
    let bytesDownloaded = 0;
    const errors = [];
    // Create queue with adaptive concurrency
    const queue = new p_queue_1.default({ concurrency: throttle.getConcurrency() });
    // [Bug2-FIX] Update queue concurrency periodically — clamp to 1 minimum
    // PQueue does not support concurrency=0; actual pausing is handled by the
    // isPaused() busy-wait inside each task function.
    const concurrencyInterval = setInterval(() => {
        const newConcurrency = Math.max(1, throttle.getConcurrency());
        if (newConcurrency !== queue.concurrency) {
            queue.concurrency = newConcurrency;
        }
    }, 2000);
    const downloadTasks = pendingPages.map((page) => async () => {
        if (abortSignal?.aborted)
            return;
        if (throttle.isPaused()) {
            // Wait for throttle to resume
            while (throttle.isPaused() && !abortSignal?.aborted) {
                await (0, utils_1.sleep)(500);
            }
            if (abortSignal?.aborted)
                return;
        }
        const outputPath = path.join(pagesDir, page.filename);
        const tmpPath = outputPath + '.tmp';
        checkpoint.setPageStatus(page.filename, 'in_progress');
        try {
            // [PERF] Stream directly to disk — no RAM buffering for PNGs
            const { size } = await (0, client_1.downloadFileToPath)(page.cdnPath, outputPath, {
                timeoutMs: 30000,
            });
            checkpoint.setPageStatus(page.filename, 'completed', { size });
            throttle.reportSuccess();
            completed++;
            bytesDownloaded += size;
            onProgress({
                completed,
                total,
                currentFile: page.filename,
                bytesDownloaded,
                errors,
            });
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger_1.logger.warn('PageDL', `Failed: ${page.filename} — ${errorMsg}`);
            const statusCode = extractStatusCode(errorMsg);
            const { shouldPause, pauseMs } = throttle.reportError(statusCode);
            // Clean up temp files (downloadFileToPath uses .dl.tmp internally, but clean both patterns)
            for (const tmp of [tmpPath, outputPath + '.dl.tmp']) {
                if (fs.existsSync(tmp)) {
                    try {
                        fs.unlinkSync(tmp);
                    }
                    catch { /* ignore */ }
                }
            }
            const retries = (checkpoint.getPageStatus(page.filename)?.retries || 0) + 1;
            checkpoint.setPageStatus(page.filename, 'failed', {
                error: errorMsg,
                retries,
            });
            // Retry up to RETRY_COUNT times
            if (retries <= types_1.BIBOX_CONSTANTS.RETRY_COUNT) {
                checkpoint.setPageStatus(page.filename, 'pending', { retries });
                // Re-queue with delay
                await (0, utils_1.sleep)(types_1.BIBOX_CONSTANTS.RETRY_BASE_MS * Math.pow(2, retries - 1));
                // FIX: Use pendingPages index (downloadTasks built from pendingPages, NOT pages)
                const taskIdx = pendingPages.indexOf(page);
                if (taskIdx >= 0) {
                    queue.add(downloadTasks[taskIdx]);
                }
            }
            else {
                logger_1.logger.error('PageDL', `Giving up on ${page.filename} after ${retries} retries: ${errorMsg}`);
                errors.push(`Page ${page.filename}: ${errorMsg}`);
            }
            if (shouldPause) {
                await (0, utils_1.sleep)(pauseMs);
            }
        }
    });
    // Add all tasks to queue
    for (const task of downloadTasks) {
        queue.add(task);
    }
    try {
        await queue.onIdle();
    }
    finally {
        clearInterval(concurrencyInterval);
    }
    const failed = Object.values(checkpoint.getState().pages)
        .filter((s) => s.status === 'failed').length;
    return { completed, failed, errors };
}
function extractStatusCode(errorMsg) {
    const match = errorMsg.match(/\((\d{3})\)/);
    return match ? parseInt(match[1], 10) : undefined;
}
//# sourceMappingURL=page-downloader.js.map