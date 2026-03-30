// ============================================================================
// BiBox Downloader — Preload Script (Context Bridge)
// ============================================================================

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, DownloadConfig, DownloadProgressUpdate } from '../shared/types';

type ProgressCallback = (update: DownloadProgressUpdate) => void;
type CompleteCallback = (result: { bookId: number; success: boolean; error?: string; bookDir?: string }) => void;

const api = {
  // --- Auth ---
  login: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN) as Promise<{ success: boolean; error?: string }>,

  // [BugD-FIX] Silent auto-login via existing SSO session
  trySilentLogin: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_SILENT_LOGIN) as Promise<boolean>,

  getAuthStatus: (): Promise<{ status: string; expiresAt?: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_STATUS) as Promise<{ status: string; expiresAt?: number }>,

  logout: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT) as Promise<void>,

  // --- Books ---
  listBooks: (): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.BOOKS_LIST) as Promise<unknown[]>,

  estimateSize: (bookIds: number[]): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.BOOKS_ESTIMATE, bookIds) as Promise<unknown[]>,

  // --- Download ---
  startDownload: (config: DownloadConfig): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_START, config) as Promise<void>,

  resumeDownload: (bookId: number, outputDir: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_RESUME, bookId, outputDir) as Promise<void>,

  pauseDownload: (bookId: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_PAUSE, bookId) as Promise<void>,

  // [Bug7] Unpause — resume throttle without restarting from checkpoint
  unpauseDownload: (bookId: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_UNPAUSE, bookId) as Promise<void>,

  cancelDownload: (bookId: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_CANCEL, bookId) as Promise<void>,

  onDownloadProgress: (callback: ProgressCallback): void => {
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_PROGRESS, (_event: unknown, ...args: unknown[]) => {
      callback(args[0] as DownloadProgressUpdate);
    });
  },

  onDownloadComplete: (callback: CompleteCallback): void => {
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_COMPLETE, (_event: unknown, ...args: unknown[]) => {
      callback(args[0] as { bookId: number; success: boolean; error?: string; bookDir?: string });
    });
  },

  removeDownloadListeners: (): void => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.DOWNLOAD_PROGRESS);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.DOWNLOAD_COMPLETE);
  },

  // --- Disk ---
  checkDiskSpace: (dirPath: string): Promise<{ available: number; total: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.DISK_CHECK, dirPath) as Promise<{ available: number; total: number }>,

  // --- Dialogs ---
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_DIRECTORY) as Promise<string | null>,

  openDirectory: (dirPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_DIRECTORY, dirPath) as Promise<void>,

  // --- Logging ---
  exportLog: (): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.LOG_EXPORT) as Promise<{ success: boolean; path?: string; error?: string }>,

  openLogDir: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.LOG_OPEN_DIR) as Promise<void>,

  // --- External URLs ---
  openUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_URL, url) as Promise<void>,

  // --- Materials PDF Export ---
  exportMaterialsPdf: (bookDir: string): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.MATERIALS_EXPORT_PDF, bookDir) as Promise<{ success: boolean; path?: string; error?: string }>,

  // [Bug8] Get actual folder size in bytes
  getFolderSize: (dirPath: string): Promise<number> =>
    ipcRenderer.invoke(IPC_CHANNELS.FOLDER_SIZE, dirPath) as Promise<number>,

  // [Bug9] Check which books are already fully downloaded in target dir
  checkCompletedBooks: (dirPath: string): Promise<number[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.CHECK_COMPLETED_BOOKS, dirPath) as Promise<number[]>,

  // --- Settings Persistence ---
  loadSettings: (): Promise<Record<string, unknown> | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_LOAD) as Promise<Record<string, unknown> | null>,

  saveSettings: (settings: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings) as Promise<void>,
};

contextBridge.exposeInMainWorld('bibox', api);

export type BiboxAPI = typeof api;
