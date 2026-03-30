"use strict";
// ============================================================================
// BiBox Downloader — Shared TypeScript Types
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.BIBOX_CONSTANTS = exports.IPC_CHANNELS = exports.DEFAULT_DOWNLOAD_OPTIONS = void 0;
// [Bug5] Defaults: PDF+Materials+MaterialsPDF active, PNGs+HTML5 inactive
exports.DEFAULT_DOWNLOAD_OPTIONS = {
    downloadPdf: true,
    keepOriginalPngs: false,
    downloadMaterials: true,
    downloadHtml5: false,
    exportMaterialsPdf: true,
    enableOcr: false,
    maxParallel: 3,
    pdfCompression: 'none',
};
// --- IPC Channel Names ---
exports.IPC_CHANNELS = {
    AUTH_LOGIN: 'auth:login',
    AUTH_SILENT_LOGIN: 'auth:silent-login', // [BugD-FIX] Background auto-login via existing SSO session
    AUTH_STATUS: 'auth:status',
    AUTH_LOGOUT: 'auth:logout',
    BOOKS_LIST: 'books:list',
    BOOKS_ESTIMATE: 'books:estimate-size',
    DOWNLOAD_START: 'download:start',
    DOWNLOAD_RESUME: 'download:resume',
    DOWNLOAD_PROGRESS: 'download:progress',
    DOWNLOAD_PAUSE: 'download:pause',
    DOWNLOAD_UNPAUSE: 'download:unpause', // [Bug7] Throttle unpause (not full resume from checkpoint)
    DOWNLOAD_CANCEL: 'download:cancel',
    DOWNLOAD_COMPLETE: 'download:complete',
    DISK_CHECK: 'disk:check',
    SELECT_DIRECTORY: 'select:directory',
    OPEN_DIRECTORY: 'open:directory',
    LOG_EXPORT: 'log:export',
    LOG_OPEN_DIR: 'log:open-dir',
    OPEN_URL: 'open:url',
    MATERIALS_EXPORT_PDF: 'materials:export-pdf',
    FOLDER_SIZE: 'folder:size', // [Bug8] Get actual folder size in bytes
    CHECK_COMPLETED_BOOKS: 'books:check-completed', // [Bug9] Find already-downloaded books in target dir
    SETTINGS_LOAD: 'settings:load', // Load persisted user settings (outputDir, options)
    SETTINGS_SAVE: 'settings:save', // Save user settings to disk
};
// --- Constants ---
exports.BIBOX_CONSTANTS = {
    SSO_BASE: 'https://mein.westermann.de',
    BACKEND_BASE: 'https://backend.bibox2.westermann.de',
    STATIC_CDN: 'https://static.bibox2.westermann.de',
    FRONTEND_BASE: 'https://bibox2.westermann.de',
    CLIENT_ID: 'Nvw0ZA8Z',
    REDIRECT_URI: 'https://bibox2.westermann.de/login',
    SCOPE: 'openid',
    TOKEN_VALIDITY_SECONDS: 86400, // 24h
    DEFAULT_PARALLEL_CDN: 3,
    MAX_PARALLEL_CDN: 6,
    MAX_PARALLEL_API: 6, // Increased from 5 — server handles parallel well
    API_DELAY_MS: 50, // Reduced from 200ms — no rate-limiting observed at high concurrency
    RETRY_COUNT: 3,
    RETRY_BASE_MS: 1000,
    AVG_PAGE_SIZE_KB: 100,
    PDF_OVERHEAD_FACTOR: 1.1,
    MATERIAL_ESTIMATE_MB: 50,
    DISK_BUFFER_RATIO: 0.2, // 20% buffer
};
//# sourceMappingURL=types.js.map