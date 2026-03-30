// ============================================================================
// BiBox Downloader — IPC Handlers (Main ↔ Renderer Bridge)
// ============================================================================

import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  IPC_CHANNELS,
  DownloadConfig,
  BIBOX_CONSTANTS,
} from '../../shared/types';
import { performLogin, trySilentLogin } from '../auth/oauth';
import { tokenStore } from '../auth/token-store';
import { etagCache } from '../api/etag-cache';
import { fetchBooks, fetchPageData, fetchSyncData } from '../api/bibox-api';
import { startDownloadFlow, pauseDownload, resumeDownload, cancelDownload } from '../download/engine';
import { checkDiskSpace } from '../storage/disk-check';
import { logger } from '../logging/logger';

let getAppRoot: () => string;
let mainWindowRef: BrowserWindow | null = null;

/** Store main window reference — never rely on getFocusedWindow alone */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

function getMainWindow(): BrowserWindow | null {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) return mainWindowRef;
  return BrowserWindow.getFocusedWindow(); // fallback
}

export function registerIpcHandlers(appRootGetter: () => string): void {
  getAppRoot = appRootGetter;

  // Initialize ETag cache
  const cacheDir = path.join(getAppRoot(), 'cache');
  etagCache.initialize(cacheDir);

  // --- Auth ---

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async () => {
    return performLogin();
  });

  // [BugD-FIX] Silent auto-login — try to reuse existing Westermann SSO session
  ipcMain.handle(IPC_CHANNELS.AUTH_SILENT_LOGIN, async () => {
    return trySilentLogin();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, async () => {
    return {
      status: tokenStore.getStatus(),
      expiresAt: tokenStore.getExpiresAt(),
      remainingSeconds: tokenStore.getRemainingSeconds(),
    };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    tokenStore.clear();
  });

  // --- Books ---

  ipcMain.handle(IPC_CHANNELS.BOOKS_LIST, async () => {
    const books = await fetchBooks();
    return books;
  });

  ipcMain.handle(IPC_CHANNELS.BOOKS_ESTIMATE, async (_event: unknown, bookIds: unknown) => {
    // [M11-FIX] Validate input — prevent crashes from malformed IPC args
    if (!Array.isArray(bookIds)) {
      throw new Error('Invalid bookIds: expected number[]');
    }
    const bookIdList = bookIds as number[];
    const estimates = [];
    for (const bookId of bookIdList) {
      try {
        // Use sync endpoint — it contains the actual page list and materials
        const syncData = await fetchSyncData(bookId);
        const pageCount = syncData.pages.length;
        const materialCount = syncData.materials.length;
        const estimatedMB = Math.ceil(
          (pageCount * BIBOX_CONSTANTS.AVG_PAGE_SIZE_KB / 1024) * BIBOX_CONSTANTS.PDF_OVERHEAD_FACTOR
          + (materialCount > 0 ? BIBOX_CONSTANTS.MATERIAL_ESTIMATE_MB : 0)
        );
        estimates.push({ bookId, estimatedMB, pageCount });
      } catch {
        // Fallback: lighter pageData endpoint
        try {
          const pageData = await fetchPageData(bookId);
          const pageCount = pageData.pageCount || 0;
          const estimatedMB = pageCount > 0
            ? Math.ceil((pageCount * BIBOX_CONSTANTS.AVG_PAGE_SIZE_KB / 1024) * BIBOX_CONSTANTS.PDF_OVERHEAD_FACTOR + BIBOX_CONSTANTS.MATERIAL_ESTIMATE_MB)
            : 0;
          estimates.push({ bookId, estimatedMB, pageCount });
        } catch {
          estimates.push({ bookId, estimatedMB: 0, pageCount: 0 });
        }
      }
    }
    return estimates;
  });

  // --- Download ---

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_START, async (_event: unknown, config: unknown) => {
    // [Review2] Runtime validation of IPC args
    const cfg = config as DownloadConfig;
    if (!cfg || !Array.isArray(cfg.bookIds) || typeof cfg.outputDir !== 'string') {
      throw new Error('Invalid download config: bookIds (array) and outputDir (string) required');
    }
    const mainWindow = getMainWindow();
    // Run in background — don't block IPC
    startDownloadFlow(cfg, mainWindow).catch((err) => {
      logger.error('IPC', 'Download flow error:', err);
    });
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_RESUME, async (_event: unknown, bookId: unknown, outputDir: unknown) => {
    // [Review2] Runtime validation
    if (typeof bookId !== 'number' || typeof outputDir !== 'string') {
      throw new Error('Invalid resume args: bookId (number) and outputDir (string) required');
    }
    const bid = bookId;
    const dir = outputDir;
    // Check for existing checkpoint and resume
    const books = await fetchBooks();
    const book = books.find((b) => b.id === bid);
    if (!book) throw new Error(`Book ${bid} not found`);

    const mainWindow = getMainWindow();
    // Resume is effectively a start with existing checkpoint
    startDownloadFlow(
      {
        bookIds: [bid],
        outputDir: dir,
        options: {
          downloadPdf: true,
          keepOriginalPngs: true,
          downloadMaterials: true,
          downloadHtml5: true,
          exportMaterialsPdf: false,
          enableOcr: false,
          maxParallel: BIBOX_CONSTANTS.DEFAULT_PARALLEL_CDN,
          pdfCompression: 'none',
        },
      },
      mainWindow
    ).catch((err) => {
      logger.error('IPC', 'Resume error:', err);
    });
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_PAUSE, async (_event: unknown, bookId: unknown) => {
    if (typeof bookId !== 'number') throw new Error('Invalid bookId: expected number');
    pauseDownload(bookId);
  });

  // [Bug7] Unpause — resume throttle without restarting from checkpoint
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_UNPAUSE, async (_event: unknown, bookId: unknown) => {
    if (typeof bookId !== 'number') throw new Error('Invalid bookId: expected number');
    resumeDownload(bookId);
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CANCEL, async (_event: unknown, bookId: unknown) => {
    if (typeof bookId !== 'number') throw new Error('Invalid bookId: expected number');
    cancelDownload(bookId);
  });

  // --- Disk ---

  ipcMain.handle(IPC_CHANNELS.DISK_CHECK, async (_event: unknown, dirPath: unknown) => {
    if (typeof dirPath !== 'string') throw new Error('Invalid dirPath: expected string');
    return checkDiskSpace(dirPath);
  });

  // --- Dialogs ---

  ipcMain.handle(IPC_CHANNELS.SELECT_DIRECTORY, async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Download-Ordner wählen',
      defaultPath: path.join(getAppRoot(), 'Downloads'),
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_DIRECTORY, async (_event: unknown, dirPath: unknown) => {
    if (typeof dirPath !== 'string') return;
    await shell.openPath(dirPath);
  });

  // --- Logging ---

  ipcMain.handle(IPC_CHANNELS.LOG_EXPORT, async () => {
    const logPath = logger.getLogFilePath();
    if (!logPath) return { success: false, error: 'Logger not initialized' };
    if (!fs.existsSync(logPath)) return { success: false, error: 'No log file found' };

    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false, error: 'No window' };

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Log-Datei exportieren',
      defaultPath: `bibox-downloader-log_${new Date().toISOString().slice(0, 10)}.log`,
      filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }],
    });

    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };

    try {
      fs.copyFileSync(logPath, result.filePath);
      return { success: true, path: result.filePath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle(IPC_CHANNELS.LOG_OPEN_DIR, async () => {
    const logDir = logger.getLogDir();
    if (logDir) {
      shell.openPath(logDir);
    }
  });

  // --- External URLs ---

  ipcMain.handle(IPC_CHANNELS.OPEN_URL, async (_event: unknown, url: unknown) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
    }
  });

  // --- Materials PDF Export ---

  ipcMain.handle(IPC_CHANNELS.MATERIALS_EXPORT_PDF, async (_event: unknown, bookDir: unknown) => {
    if (typeof bookDir !== 'string') return { success: false, error: 'Invalid bookDir' };
    const dir = bookDir;
    try {
      const { buildMaterialsPdf } = await import('../pdf/materials-pdf-builder');
      const result = await buildMaterialsPdf(dir);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('IPC', `Materials PDF export failed: ${msg}`, err);
      return { success: false, error: msg };
    }
  });

  // [Bug8][K4-FIX] Calculate actual folder size recursively — fully async to avoid blocking Main
  ipcMain.handle(IPC_CHANNELS.FOLDER_SIZE, async (_event: unknown, dirPath: unknown) => {
    if (typeof dirPath !== 'string') return 0;
    const dir = dirPath;
    try {
      const fsP = fs.promises;
      let totalSize = 0;
      const walkDir = async (p: string): Promise<void> => {
        let entries: fs.Dirent[];
        try {
          entries = await fsP.readdir(p, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
          const fullPath = path.join(p, entry.name);
          if (entry.isDirectory()) {
            await walkDir(fullPath);
          } else {
            try {
              const stat = await fsP.stat(fullPath);
              totalSize += stat.size;
            } catch { /* skip inaccessible files */ }
          }
        }
      };
      await walkDir(dir);
      return totalSize;
    } catch {
      return 0;
    }
  });

  // [Bug9][K5-FIX][BugB-FIX] Check which books have already been fully downloaded — fully async.
  // Manifest.json is the definitive completion marker (checkpoint file is removed after success).
  // If a .download-state.json exists with status != 'completed', the download is still in progress.
  ipcMain.handle(IPC_CHANNELS.CHECK_COMPLETED_BOOKS, async (_event: unknown, dirPath: unknown) => {
    if (typeof dirPath !== 'string') return [];
    const dir = dirPath;
    const completedBookIds: number[] = [];
    const fsP = fs.promises;
    try {
      let entries: fs.Dirent[];
      try {
        entries = await fsP.readdir(dir, { withFileTypes: true });
      } catch { return completedBookIds; }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
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
          } catch { /* no checkpoint → completed (checkpoint removed after success) */ }
          if (isComplete && manifest.bookId) {
            completedBookIds.push(Number(manifest.bookId));
          }
        } catch { /* no manifest or unreadable → skip */ }
      }
    } catch (err) {
      logger.warn('IPC', `Check completed books failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return completedBookIds;
  });

  // --- Settings Persistence ---
  // Saves user preferences (outputDir, download options) to a JSON file in the app root.
  // This allows settings to survive app restarts.

  const settingsPath = path.join(getAppRoot(), 'bibox-settings.json');

  ipcMain.handle(IPC_CHANNELS.SETTINGS_LOAD, async () => {
    try {
      if (fs.existsSync(settingsPath)) {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      logger.warn('IPC', `Failed to load settings: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, async (_event: unknown, settings: unknown) => {
    try {
      if (settings && typeof settings === 'object') {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      }
    } catch (err) {
      logger.warn('IPC', `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
