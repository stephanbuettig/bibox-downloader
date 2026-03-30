"use strict";
// ============================================================================
// BiBox Downloader — Preload Script (Context Bridge)
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const types_1 = require("../shared/types");
const api = {
    // --- Auth ---
    login: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.AUTH_LOGIN),
    // [BugD-FIX] Silent auto-login via existing SSO session
    trySilentLogin: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.AUTH_SILENT_LOGIN),
    getAuthStatus: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.AUTH_STATUS),
    logout: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.AUTH_LOGOUT),
    // --- Books ---
    listBooks: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.BOOKS_LIST),
    estimateSize: (bookIds) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.BOOKS_ESTIMATE, bookIds),
    // --- Download ---
    startDownload: (config) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOWNLOAD_START, config),
    resumeDownload: (bookId, outputDir) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOWNLOAD_RESUME, bookId, outputDir),
    pauseDownload: (bookId) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOWNLOAD_PAUSE, bookId),
    // [Bug7] Unpause — resume throttle without restarting from checkpoint
    unpauseDownload: (bookId) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOWNLOAD_UNPAUSE, bookId),
    cancelDownload: (bookId) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DOWNLOAD_CANCEL, bookId),
    onDownloadProgress: (callback) => {
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.DOWNLOAD_PROGRESS, (_event, ...args) => {
            callback(args[0]);
        });
    },
    onDownloadComplete: (callback) => {
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.DOWNLOAD_COMPLETE, (_event, ...args) => {
            callback(args[0]);
        });
    },
    removeDownloadListeners: () => {
        electron_1.ipcRenderer.removeAllListeners(types_1.IPC_CHANNELS.DOWNLOAD_PROGRESS);
        electron_1.ipcRenderer.removeAllListeners(types_1.IPC_CHANNELS.DOWNLOAD_COMPLETE);
    },
    // --- Disk ---
    checkDiskSpace: (dirPath) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DISK_CHECK, dirPath),
    // --- Dialogs ---
    selectDirectory: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.SELECT_DIRECTORY),
    openDirectory: (dirPath) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.OPEN_DIRECTORY, dirPath),
    // --- Logging ---
    exportLog: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.LOG_EXPORT),
    openLogDir: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.LOG_OPEN_DIR),
    // --- External URLs ---
    openUrl: (url) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.OPEN_URL, url),
    // --- Materials PDF Export ---
    exportMaterialsPdf: (bookDir) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.MATERIALS_EXPORT_PDF, bookDir),
    // [Bug8] Get actual folder size in bytes
    getFolderSize: (dirPath) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.FOLDER_SIZE, dirPath),
    // [Bug9] Check which books are already fully downloaded in target dir
    checkCompletedBooks: (dirPath) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.CHECK_COMPLETED_BOOKS, dirPath),
    // --- Settings Persistence ---
    loadSettings: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.SETTINGS_LOAD),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.SETTINGS_SAVE, settings),
};
electron_1.contextBridge.exposeInMainWorld('bibox', api);
//# sourceMappingURL=preload.js.map