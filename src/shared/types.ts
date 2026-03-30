// ============================================================================
// BiBox Downloader — Shared TypeScript Types
// ============================================================================

// --- Auth ---

export interface AuthTokens {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  obtainedAt: number; // Date.now() when token was received
}

export interface PKCEParams {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

export type AuthStatus = 'logged_out' | 'logging_in' | 'logged_in' | 'expired';

// --- Books ---

export interface Book {
  id: number;
  title: string;
  isbn?: string;
  coverUrl?: string;
  pageCount?: number;
  materialCount?: number;
  estimatedSizeMB?: number;
}

export interface BookSyncData {
  bookId: number;
  pages: PageInfo[];
  materials: MaterialInfo[];
  raw: unknown; // Full sync response for debugging
}

export interface PageInfo {
  pageNumber: number; // 0 = cover
  filename: string;   // e.g. "cover.png", "1.png", "23.png"
  cdnPath: string;    // Full CDN path: /bookpages/{base64}/{n}.png
}

export interface MaterialInfo {
  materialId: number;
  title?: string;
  type?: MaterialType;
  pageRef?: number;      // Associated page number
  description?: string;
}

export type MaterialType = 'pdf' | 'video' | 'audio' | 'html5' | 'image' | 'xml' | 'unknown';

// --- Download ---

export interface DownloadConfig {
  bookIds: number[];
  outputDir: string;
  options: DownloadOptions;
}

export interface DownloadOptions {
  downloadPdf: boolean;
  keepOriginalPngs: boolean;
  downloadMaterials: boolean;
  downloadHtml5: boolean;
  exportMaterialsPdf: boolean;    // Combine all materials into one PDF
  enableOcr: boolean;             // [Review4] Reserved for future OCR feature
  maxParallel: number;            // 1-6, default 3
  pdfCompression: 'none' | 'low' | 'medium' | 'high'; // [Review4] Reserved for future compression
}

// [Bug5] Defaults: PDF+Materials+MaterialsPDF active, PNGs+HTML5 inactive
export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = {
  downloadPdf: true,
  keepOriginalPngs: false,
  downloadMaterials: true,
  downloadHtml5: false,
  exportMaterialsPdf: true,
  enableOcr: false,
  maxParallel: 3,
  pdfCompression: 'none',
};

// --- Checkpoint / Download State ---

export type ItemStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface PageState {
  status: ItemStatus;
  size?: number;
  error?: string;
  retries?: number;
}

export interface MaterialState {
  status: ItemStatus;
  type?: MaterialType;
  filename?: string;
  size?: number;
  error?: string;
  retries?: number;
}

export interface DownloadPlan {
  totalPages: number;
  totalMaterials: number;
  estimatedSizeMB: number;
}

export interface DownloadState {
  bookId: number;
  version: number;
  startedAt: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  plan: DownloadPlan;
  pages: Record<string, PageState>;      // key = filename (e.g. "cover.png", "001.png")
  materials: Record<string, MaterialState>; // key = materialId
  pdf: {
    status: ItemStatus;
  };
}

// --- IPC ---

export interface DownloadProgressUpdate {
  bookId: number;
  phase: 'discovery' | 'pages' | 'materials' | 'pdf' | 'done';
  currentItem?: string;
  completedPages: number;
  totalPages: number;
  completedMaterials: number;
  totalMaterials: number;
  bytesDownloaded: number;
  speedBps: number;
  etaSeconds: number;
  errors: string[];
}

export interface DiskSpaceInfo {
  available: number;  // bytes
  total: number;      // bytes
  path: string;
}

export interface BookEstimate {
  bookId: number;
  title: string;
  estimatedMB: number;
  pageCount: number;
  materialCount: number;
}

// --- API Responses (raw shapes, refined after live exploration) ---

export interface BooksApiResponse {
  [key: string]: unknown;
}

export interface SyncApiResponse {
  [key: string]: unknown;
}

export interface MaterialDownloadUrlResponse {
  url?: string;
  downloadUrl?: string;
  [key: string]: unknown;
}

// --- ETag Cache ---

export interface ETagEntry {
  url: string;
  etag: string;
  data: unknown;
  cachedAt: number;
}

export interface ETagCache {
  entries: Record<string, ETagEntry>;
}

// --- IPC Channel Names ---

export const IPC_CHANNELS = {
  AUTH_LOGIN: 'auth:login',
  AUTH_SILENT_LOGIN: 'auth:silent-login',  // [BugD-FIX] Background auto-login via existing SSO session
  AUTH_STATUS: 'auth:status',
  AUTH_LOGOUT: 'auth:logout',
  BOOKS_LIST: 'books:list',
  BOOKS_ESTIMATE: 'books:estimate-size',
  DOWNLOAD_START: 'download:start',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_PROGRESS: 'download:progress',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_UNPAUSE: 'download:unpause',  // [Bug7] Throttle unpause (not full resume from checkpoint)
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_COMPLETE: 'download:complete',
  DISK_CHECK: 'disk:check',
  SELECT_DIRECTORY: 'select:directory',
  OPEN_DIRECTORY: 'open:directory',
  LOG_EXPORT: 'log:export',
  LOG_OPEN_DIR: 'log:open-dir',
  OPEN_URL: 'open:url',
  MATERIALS_EXPORT_PDF: 'materials:export-pdf',
  FOLDER_SIZE: 'folder:size',  // [Bug8] Get actual folder size in bytes
  CHECK_COMPLETED_BOOKS: 'books:check-completed',  // [Bug9] Find already-downloaded books in target dir
  SETTINGS_LOAD: 'settings:load',    // Load persisted user settings (outputDir, options)
  SETTINGS_SAVE: 'settings:save',    // Save user settings to disk
} as const;

// --- Constants ---

export const BIBOX_CONSTANTS = {
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
  API_DELAY_MS: 50,    // Reduced from 200ms — no rate-limiting observed at high concurrency
  RETRY_COUNT: 3,
  RETRY_BASE_MS: 1000,
  AVG_PAGE_SIZE_KB: 100,
  PDF_OVERHEAD_FACTOR: 1.1,
  MATERIAL_ESTIMATE_MB: 50,
  DISK_BUFFER_RATIO: 0.2, // 20% buffer
} as const;
