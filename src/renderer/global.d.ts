// Type declarations for the preload-exposed API
import type { DownloadConfig, DownloadProgressUpdate } from '@shared/types';

interface BiboxAPI {
  login: () => Promise<{ success: boolean; error?: string }>;
  trySilentLogin: () => Promise<boolean>;  // [BugD-FIX]
  getAuthStatus: () => Promise<{ status: string; expiresAt?: number }>;
  logout: () => Promise<void>;
  listBooks: () => Promise<unknown[]>;
  estimateSize: (bookIds: number[]) => Promise<unknown[]>;
  startDownload: (config: DownloadConfig) => Promise<void>;
  resumeDownload: (bookId: number, outputDir: string) => Promise<void>;
  pauseDownload: (bookId: number) => Promise<void>;
  unpauseDownload: (bookId: number) => Promise<void>;  // [Bug7]
  cancelDownload: (bookId: number) => Promise<void>;
  onDownloadProgress: (callback: (update: DownloadProgressUpdate) => void) => void;
  onDownloadComplete: (callback: (result: { bookId: number; success: boolean; error?: string; bookDir?: string }) => void) => void;
  removeDownloadListeners: () => void;
  checkDiskSpace: (dirPath: string) => Promise<{ available: number; total: number }>;
  selectDirectory: () => Promise<string | null>;
  openDirectory: (dirPath: string) => Promise<void>;
  exportLog: () => Promise<{ success: boolean; path?: string; error?: string }>;
  openLogDir: () => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  exportMaterialsPdf: (bookDir: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  getFolderSize: (dirPath: string) => Promise<number>;  // [Bug8]
  checkCompletedBooks: (dirPath: string) => Promise<number[]>;  // [Bug9]
  loadSettings: () => Promise<Record<string, unknown> | null>;
  saveSettings: (settings: Record<string, unknown>) => Promise<void>;
}

declare global {
  interface Window {
    bibox: BiboxAPI;
  }
}

export {};
