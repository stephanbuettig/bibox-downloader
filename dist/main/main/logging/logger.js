"use strict";
// ============================================================================
// BiBox Downloader — Structured File Logger
// ============================================================================
// Writes timestamped, leveled log entries to a rotating log file.
// - Log files live next to the executable (portable) or in project root (dev)
// - Automatic rotation: max 5 MB per file, keeps last 3 rotated copies
// - All output also goes to console (for DevTools in dev mode)
// - Structured format: [ISO-TIMESTAMP] [LEVEL] [TAG] message
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
exports.logger = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LEVEL_PRIORITY = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};
// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROTATED_FILES = 3;
const LOG_FILENAME = 'bibox-downloader.log';
// ---------------------------------------------------------------------------
// Logger implementation
// ---------------------------------------------------------------------------
class Logger {
    logDir = null;
    logFilePath = null;
    writeStream = null;
    currentFileSize = 0;
    minLevel = 'DEBUG';
    initialized = false;
    pendingLines = [];
    /**
     * Initialize the logger with a base directory.
     * Call once during app startup, passing the app root directory.
     */
    initialize(appRoot) {
        this.logDir = path.join(appRoot, 'logs');
        // Ensure log directory exists
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
        this.logFilePath = path.join(this.logDir, LOG_FILENAME);
        // Check existing file size for rotation tracking
        if (fs.existsSync(this.logFilePath)) {
            try {
                const stat = fs.statSync(this.logFilePath);
                this.currentFileSize = stat.size;
            }
            catch {
                this.currentFileSize = 0;
            }
        }
        // Open write stream in append mode
        this.openStream();
        this.initialized = true;
        // Flush any lines that were logged before initialization
        for (const line of this.pendingLines) {
            this.writeLine(line);
        }
        this.pendingLines = [];
        // Write startup marker
        this.info('Logger', '========================================');
        this.info('Logger', `BiBox Downloader started — Log level: ${this.minLevel}`);
        this.info('Logger', `Log file: ${this.logFilePath}`);
        this.info('Logger', `Platform: ${process.platform} ${process.arch}, Node ${process.version}, Electron ${process.versions.electron || 'N/A'}`);
        this.info('Logger', '========================================');
    }
    /**
     * Set the minimum log level (messages below this level are suppressed in file).
     * Console output always shows WARN and above regardless.
     */
    setLevel(level) {
        this.minLevel = level;
    }
    /** Get the path to the current log file (for "Export Logs" feature) */
    getLogFilePath() {
        return this.logFilePath;
    }
    /** Get the log directory path */
    getLogDir() {
        return this.logDir;
    }
    // -----------------------------------------------------------------------
    // Public log methods
    // -----------------------------------------------------------------------
    debug(tag, message, ...extra) {
        this.log('DEBUG', tag, message, extra);
    }
    info(tag, message, ...extra) {
        this.log('INFO', tag, message, extra);
    }
    warn(tag, message, ...extra) {
        this.log('WARN', tag, message, extra);
    }
    error(tag, message, ...extra) {
        this.log('ERROR', tag, message, extra);
    }
    // -----------------------------------------------------------------------
    // Core logging
    // -----------------------------------------------------------------------
    log(level, tag, message, extra) {
        const timestamp = new Date().toISOString();
        const extraStr = extra.length > 0
            ? ' ' + extra.map((e) => {
                if (e instanceof Error)
                    return `${e.message}\n${e.stack || ''}`;
                if (typeof e === 'object') {
                    try {
                        return JSON.stringify(e);
                    }
                    catch {
                        return String(e);
                    }
                }
                return String(e);
            }).join(' ')
            : '';
        const line = `[${timestamp}] [${level.padEnd(5)}] [${tag}] ${message}${extraStr}`;
        // Always write to console (in dev, DevTools shows these)
        switch (level) {
            case 'ERROR':
                console.error(line);
                break;
            case 'WARN':
                console.warn(line);
                break;
            case 'DEBUG':
                console.debug(line);
                break;
            default: console.log(line);
        }
        // Write to file if level is sufficient
        if (LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel]) {
            if (this.initialized) {
                this.writeLine(line);
            }
            else {
                // Buffer until initialize() is called
                this.pendingLines.push(line);
            }
        }
    }
    // -----------------------------------------------------------------------
    // File I/O
    // -----------------------------------------------------------------------
    writeLine(line) {
        if (!this.writeStream || !this.logFilePath)
            return;
        const data = line + '\n';
        const bytes = Buffer.byteLength(data, 'utf-8');
        // Check if rotation needed BEFORE writing
        if (this.currentFileSize + bytes > MAX_FILE_SIZE) {
            this.rotate();
        }
        try {
            this.writeStream.write(data);
            this.currentFileSize += bytes;
        }
        catch {
            // If write fails, try to re-open the stream once
            try {
                this.openStream();
                this.writeStream?.write(data);
                this.currentFileSize += bytes;
            }
            catch {
                // Give up on file logging for this entry
            }
        }
    }
    openStream() {
        if (this.writeStream) {
            try {
                this.writeStream.end();
            }
            catch { /* ignore */ }
        }
        if (this.logFilePath) {
            this.writeStream = fs.createWriteStream(this.logFilePath, {
                flags: 'a',
                encoding: 'utf-8',
            });
            this.writeStream.on('error', () => {
                // Swallow stream errors — logging must never crash the app
            });
        }
    }
    rotate() {
        if (!this.logFilePath || !this.logDir)
            return;
        // Close current stream
        if (this.writeStream) {
            try {
                this.writeStream.end();
            }
            catch { /* ignore */ }
            this.writeStream = null;
        }
        // Shift existing rotated files: .3 → delete, .2 → .3, .1 → .2, current → .1
        for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
            const src = i === 1
                ? this.logFilePath
                : `${this.logFilePath}.${i - 1}`;
            const dest = `${this.logFilePath}.${i}`;
            if (fs.existsSync(src)) {
                try {
                    if (i === MAX_ROTATED_FILES && fs.existsSync(dest)) {
                        fs.unlinkSync(dest);
                    }
                    fs.renameSync(src, dest);
                }
                catch {
                    // Best-effort rotation
                }
            }
        }
        // Re-open fresh log file
        this.currentFileSize = 0;
        this.openStream();
    }
    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------
    /** Flush and close the log file. Call on app quit. */
    dispose() {
        if (this.writeStream) {
            try {
                this.writeStream.end();
            }
            catch { /* ignore */ }
            this.writeStream = null;
        }
    }
}
// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map