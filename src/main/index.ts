// ============================================================================
// BiBox Downloader — Electron Main Process Entry Point
// ============================================================================

import { app, BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { registerIpcHandlers, setMainWindow } from './ipc/handlers';
import { etagCache } from './api/etag-cache';
import { logger } from './logging/logger';

// ---------------------------------------------------------------------------
// Global error handlers — registered BEFORE anything else so no crash is silent
// ---------------------------------------------------------------------------
process.on('uncaughtException', (error) => {
  const msg = `Unhandled Error:\n${error.message}\n\n${error.stack || ''}`;
  try { logger.error('App', msg); } catch { /* logger might not be initialized */ }
  try { dialog.showErrorBox('BiBox Downloader — Fehler', msg); } catch { /* ignore */ }
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error
    ? `Unhandled Rejection:\n${reason.message}\n${reason.stack || ''}`
    : `Unhandled Rejection:\n${String(reason)}`;
  try { logger.error('App', msg); } catch { /* ignore */ }
  try { dialog.showErrorBox('BiBox Downloader — Fehler', msg); } catch { /* ignore */ }
});

let mainWindow: BrowserWindow | null = null;

/**
 * Determine the app's data root directory.
 * - Portable .exe: uses PORTABLE_EXECUTABLE_DIR (set by NSIS) so logs/cache
 *   persist next to the .exe, NOT in the temp extraction directory.
 * - Packaged (non-portable): directory of the executable.
 * - Dev: project root.
 */
function getAppRoot(): string {
  if (app.isPackaged) {
    // [K2-FIX] Portable apps: validate PORTABLE_EXECUTABLE_DIR exists and is writable
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) {
      try {
        if (fs.existsSync(portableDir)) {
          // Quick writability test
          const testFile = path.join(portableDir, '.bibox-write-test');
          fs.writeFileSync(testFile, '');
          fs.unlinkSync(testFile);
          return portableDir;
        }
      } catch { /* not writable — fall through */ }
    }

    // Installed app: use exe directory
    const exeDir = path.dirname(process.execPath);
    try {
      const testFile = path.join(exeDir, '.bibox-write-test');
      fs.writeFileSync(testFile, '');
      fs.unlinkSync(testFile);
      return exeDir;
    } catch { /* exe dir not writable (e.g., Program Files) */ }

    // Final fallback: userData directory (always writable)
    return app.getPath('userData');
  }
  return path.resolve(__dirname, '..', '..', '..');
}

function createWindow(): void {
  // Resolve icon path — use app resources path for packaged, app root for dev
  const iconPath = app.isPackaged
    ? path.join(path.dirname(app.getAppPath()), 'app', 'assets', 'icons', 'icon.ico')
    : path.join(getAppRoot(), 'assets', 'icons', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'BiBox Downloader',
    icon: iconPath,
    backgroundColor: '#0f172a', // Match app background — no white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Needed for preload to access Node APIs
    },
    // [BugD-FIX] Don't show until renderer has painted — prevents white flash.
    // The native splash window provides visual feedback during load.
    // Once did-finish-load fires, React's SplashScreen overlay is already rendered.
    show: false,
  });

  // Catch renderer load failures
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error('App', `Renderer load failed: [${errorCode}] ${errorDescription} — URL: ${validatedURL}`);
  });

  // Log renderer console messages for debugging
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) { // 2 = warning, 3 = error
      logger.warn('Renderer', `[${level === 3 ? 'ERROR' : 'WARN'}] ${message} (${sourceId}:${line})`);
    }
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the renderer
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const rendererPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');
    logger.info('App', `Loading renderer from: ${rendererPath}`);
    mainWindow.loadFile(rendererPath).catch((err) => {
      logger.error('App', `Failed to load renderer: ${err.message}`);
      dialog.showErrorBox(
        'BiBox Downloader — Renderer-Fehler',
        `Die Benutzeroberfläche konnte nicht geladen werden.\n\nPfad: ${rendererPath}\nFehler: ${err.message}`
      );
    });
  }

  // Store reference for IPC handlers (so they don't need getFocusedWindow)
  setMainWindow(mainWindow);

  mainWindow.on('closed', () => {
    setMainWindow(null);
    mainWindow = null;
  });
}

// Single instance lock — only one instance of the app
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Initialize logger first — before anything else
    logger.initialize(getAppRoot());

    // [Bug1] Show a lightweight native splash window IMMEDIATELY.
    // This gives instant visual feedback while the heavier React renderer loads.
    // Especially important for portable .exe where NSIS extraction adds ~15s delay.
    let splashWindow: BrowserWindow | null = null;
    try {
      splashWindow = new BrowserWindow({
        width: 380,
        height: 260,
        frame: false,
        transparent: true,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        center: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      const splashHtml = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: transparent; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-app-region: drag; }
  .card { background: #0f172a; border: 1px solid #334155; border-radius: 16px; padding: 40px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
  .title { font-size: 24px; font-weight: 700; color: #3b82f6; margin-bottom: 4px; }
  .sub { font-size: 16px; color: #94a3b8; font-weight: 400; margin-bottom: 24px; }
  .track { width: 160px; height: 3px; background: #1e293b; border-radius: 2px; margin: 0 auto 12px; overflow: hidden; }
  .bar { width: 40%; height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); border-radius: 2px; animation: slide 1.5s ease-in-out infinite; }
  .msg { font-size: 12px; color: #475569; }
  @keyframes slide { 0% { transform: translateX(-100%); } 50% { transform: translateX(150%); } 100% { transform: translateX(-100%); } }
</style></head><body><div class="card">
  <div class="title">BiBox <span style="color:#94a3b8;font-weight:400;font-size:18px">Downloader</span></div>
  <div class="sub"></div>
  <div class="track"><div class="bar"></div></div>
  <div class="msg">Wird geladen...</div>
</div></body></html>`)}`;
      splashWindow.loadURL(splashHtml);
    } catch {
      // Splash is non-critical — continue without it
      splashWindow = null;
    }

    registerIpcHandlers(getAppRoot);
    createWindow();

    // [K2-FIX] Show main window after renderer loads — MUST always run, even without splash
    if (mainWindow) {
      const showMainAndCloseSplash = () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close();
          splashWindow = null;
        }
        // Show main window (created with show:false to prevent white flash)
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
          mainWindow.show();
        }
      };
      mainWindow.webContents.on('did-finish-load', showMainAndCloseSplash);
      // Safety: show after 20s regardless (covers renderer load failure)
      setTimeout(showMainAndCloseSplash, 20000);
    }
  });

  // Save caches and flush logs before quitting
  app.on('before-quit', () => {
    logger.info('App', 'Application shutting down');
    etagCache.dispose();
    logger.dispose();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    }
  });
}

export { getAppRoot, mainWindow };
