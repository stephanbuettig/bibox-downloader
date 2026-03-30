// Ambient declaration for electron types when @types/electron is not available
// This file is only needed if electron types are missing during development
// In production builds, electron provides its own types

declare module 'electron' {
  export class BrowserWindow {
    constructor(options?: Record<string, unknown>);
    loadURL(url: string): Promise<void>;
    loadFile(path: string): Promise<void>;
    close(): void;
    isDestroyed(): boolean;
    isMinimized(): boolean;
    restore(): void;
    focus(): void;
    show(): void;
    once(event: string, callback: () => void): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
    webContents: WebContents;
    static getFocusedWindow(): BrowserWindow | null;
  }

  export interface WebContents {
    on(event: string, callback: (...args: unknown[]) => void): void;
    openDevTools(options?: Record<string, unknown>): void;
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void;
    send(channel: string, ...args: unknown[]): void;
  }

  export const app: {
    isPackaged: boolean;
    requestSingleInstanceLock(): boolean;
    quit(): void;
    whenReady(): Promise<void>;
    on(event: string, callback: (...args: unknown[]) => void): void;
  };

  export const shell: {
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<string>;
  };

  export const dialog: {
    showOpenDialog(
      window: BrowserWindow,
      options: Record<string, unknown>
    ): Promise<{ canceled: boolean; filePaths: string[] }>;
  };

  export const ipcMain: {
    handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, callback: (event: unknown, ...args: unknown[]) => void): void;
    removeAllListeners(channel: string): void;
  };

  export const contextBridge: {
    exposeInMainWorld(key: string, api: Record<string, unknown>): void;
  };
}
