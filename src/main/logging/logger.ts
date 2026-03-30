// ============================================================================
// BiBox Downloader — Structured File Logger
// ============================================================================
// Writes timestamped, leveled log entries to a rotating log file.
// - Log files live next to the executable (portable) or in project root (dev)
// - Automatic rotation: max 5 MB per file, keeps last 3 rotated copies
// - All output also goes to console (for DevTools in dev mode)
// - Structured format: [ISO-TIMESTAMP] [LEVEL] [TAG] message

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
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
  private logDir: string | null = null;
  private logFilePath: string | null = null;
  private writeStream: fs.WriteStream | null = null;
  private currentFileSize = 0;
  private minLevel: LogLevel = 'DEBUG';
  private initialized = false;
  private pendingLines: string[] = [];

  /**
   * Initialize the logger with a base directory.
   * Call once during app startup, passing the app root directory.
   */
  initialize(appRoot: string): void {
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
      } catch {
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
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** Get the path to the current log file (for "Export Logs" feature) */
  getLogFilePath(): string | null {
    return this.logFilePath;
  }

  /** Get the log directory path */
  getLogDir(): string | null {
    return this.logDir;
  }

  // -----------------------------------------------------------------------
  // Public log methods
  // -----------------------------------------------------------------------

  debug(tag: string, message: string, ...extra: unknown[]): void {
    this.log('DEBUG', tag, message, extra);
  }

  info(tag: string, message: string, ...extra: unknown[]): void {
    this.log('INFO', tag, message, extra);
  }

  warn(tag: string, message: string, ...extra: unknown[]): void {
    this.log('WARN', tag, message, extra);
  }

  error(tag: string, message: string, ...extra: unknown[]): void {
    this.log('ERROR', tag, message, extra);
  }

  // -----------------------------------------------------------------------
  // Core logging
  // -----------------------------------------------------------------------

  private log(level: LogLevel, tag: string, message: string, extra: unknown[]): void {
    const timestamp = new Date().toISOString();
    const extraStr = extra.length > 0
      ? ' ' + extra.map((e) => {
          if (e instanceof Error) return `${e.message}\n${e.stack || ''}`;
          if (typeof e === 'object') {
            try { return JSON.stringify(e); } catch { return String(e); }
          }
          return String(e);
        }).join(' ')
      : '';

    const line = `[${timestamp}] [${level.padEnd(5)}] [${tag}] ${message}${extraStr}`;

    // Always write to console (in dev, DevTools shows these)
    switch (level) {
      case 'ERROR': console.error(line); break;
      case 'WARN': console.warn(line); break;
      case 'DEBUG': console.debug(line); break;
      default: console.log(line);
    }

    // Write to file if level is sufficient
    if (LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel]) {
      if (this.initialized) {
        this.writeLine(line);
      } else {
        // Buffer until initialize() is called
        this.pendingLines.push(line);
      }
    }
  }

  // -----------------------------------------------------------------------
  // File I/O
  // -----------------------------------------------------------------------

  private writeLine(line: string): void {
    if (!this.writeStream || !this.logFilePath) return;

    const data = line + '\n';
    const bytes = Buffer.byteLength(data, 'utf-8');

    // Check if rotation needed BEFORE writing
    if (this.currentFileSize + bytes > MAX_FILE_SIZE) {
      this.rotate();
    }

    try {
      this.writeStream.write(data);
      this.currentFileSize += bytes;
    } catch {
      // If write fails, try to re-open the stream once
      try {
        this.openStream();
        this.writeStream?.write(data);
        this.currentFileSize += bytes;
      } catch {
        // Give up on file logging for this entry
      }
    }
  }

  private openStream(): void {
    if (this.writeStream) {
      try { this.writeStream.end(); } catch { /* ignore */ }
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

  private rotate(): void {
    if (!this.logFilePath || !this.logDir) return;

    // Close current stream
    if (this.writeStream) {
      try { this.writeStream.end(); } catch { /* ignore */ }
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
        } catch {
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
  dispose(): void {
    if (this.writeStream) {
      try {
        this.writeStream.end();
      } catch { /* ignore */ }
      this.writeStream = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const logger = new Logger();
