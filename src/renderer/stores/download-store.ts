import { create } from 'zustand';
import { DownloadOptions, DEFAULT_DOWNLOAD_OPTIONS, DownloadProgressUpdate } from '@shared/types';

interface BookProgress {
  bookId: number;
  phase: string;
  completedPages: number;
  totalPages: number;
  completedMaterials: number;
  totalMaterials: number;
  bytesDownloaded: number;
  speedBps: number;
  etaSeconds: number;
  errors: string[];
  currentItem?: string;
  done: boolean;
  success?: boolean;
}

type Screen = 'login' | 'library' | 'downloading' | 'results';

interface DownloadState {
  screen: Screen;
  showSplash: boolean;
  outputDir: string;
  options: DownloadOptions;
  progress: Map<number, BookProgress>;
  bookTitles: Map<number, string>; // [Review3] bookId → title for display
  bookDirs: Map<number, string>;  // [BugA-FIX] bookId → actual book directory path
  pausedBooks: Set<number>;  // [K2-FIX] Persisted in store, survives unmount
  diskAvailableMB: number | null;

  setScreen: (screen: Screen) => void;
  hideSplash: () => void;
  setOutputDir: (dir: string) => void;
  setOption: <K extends keyof DownloadOptions>(key: K, value: DownloadOptions[K]) => void;
  setDiskSpace: (mb: number) => void;
  setBookTitles: (titles: Map<number, string>) => void;
  setPaused: (bookId: number, paused: boolean) => void;  // [K2-FIX]
  startDownload: (bookIds: number[]) => Promise<void>;
  updateProgress: (update: DownloadProgressUpdate) => void;
  markComplete: (bookId: number, success: boolean, error?: string) => void;
  resetProgress: () => void;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  screen: 'login',
  showSplash: true,
  outputDir: '',
  options: { ...DEFAULT_DOWNLOAD_OPTIONS },
  progress: new Map(),
  bookTitles: new Map(),
  bookDirs: new Map(),     // [BugA-FIX]
  pausedBooks: new Set(),  // [K2-FIX]
  diskAvailableMB: null,

  setScreen: (screen) => set({ screen }),
  hideSplash: () => set({ showSplash: false }),
  setOutputDir: (dir) => set({ outputDir: dir }),
  setOption: (key, value) =>
    set((state) => ({ options: { ...state.options, [key]: value } })),
  setDiskSpace: (mb) => set({ diskAvailableMB: mb }),
  setBookTitles: (titles) => set({ bookTitles: titles }),

  // [K2-FIX] Centralized pause state — survives component unmount/remount
  setPaused: (bookId, paused) => set((state) => {
    const next = new Set(state.pausedBooks);
    if (paused) { next.add(bookId); } else { next.delete(bookId); }
    return { pausedBooks: next };
  }),

  startDownload: async (bookIds: number[]) => {
    const { outputDir, options } = get();

    // Initialize progress for each book
    const progress = new Map<number, BookProgress>();
    for (const bookId of bookIds) {
      progress.set(bookId, {
        bookId,
        phase: 'discovery',
        completedPages: 0,
        totalPages: 0,
        completedMaterials: 0,
        totalMaterials: 0,
        bytesDownloaded: 0,
        speedBps: 0,
        etaSeconds: 0,
        errors: [],
        done: false,
      });
    }
    set({ progress, screen: 'downloading' });

    // Setup progress listener
    window.bibox.removeDownloadListeners();
    window.bibox.onDownloadProgress((update) => {
      get().updateProgress(update);
    });
    window.bibox.onDownloadComplete((result) => {
      // [BugA-FIX] Store the bookDir path for accurate size calculation in ResultView
      if (result.bookDir) {
        set((state) => {
          const newDirs = new Map(state.bookDirs);
          newDirs.set(result.bookId, result.bookDir!);
          return { bookDirs: newDirs };
        });
      }
      get().markComplete(result.bookId, result.success, result.error);
    });

    // Start the download — catch IPC errors to prevent UI from getting stuck
    try {
      await window.bibox.startDownload({
        bookIds,
        outputDir,
        options,
      });
    } catch (err) {
      // If IPC call itself fails, mark all books as failed so UI doesn't stay on downloading screen
      const errorMsg = err instanceof Error ? err.message : String(err);
      for (const bookId of bookIds) {
        get().markComplete(bookId, false, `Download-Start fehlgeschlagen: ${errorMsg}`);
      }
    }
  },

  updateProgress: (update) => {
    set((state) => {
      const newProgress = new Map(state.progress);
      const existing = newProgress.get(update.bookId);
      newProgress.set(update.bookId, {
        ...(existing || {}),
        bookId: update.bookId,
        phase: update.phase,
        completedPages: update.completedPages,
        totalPages: update.totalPages,
        completedMaterials: update.completedMaterials,
        totalMaterials: update.totalMaterials,
        bytesDownloaded: update.bytesDownloaded,
        speedBps: update.speedBps,
        etaSeconds: update.etaSeconds,
        errors: update.errors,
        currentItem: update.currentItem,
        // [Review3] FIX: Don't set done:true from progress alone — wait for markComplete
        // which carries the actual success/failure state via DOWNLOAD_COMPLETE IPC.
        done: existing?.done || false,
        success: existing?.success,
      });
      return { progress: newProgress };
    });
  },

  markComplete: (bookId, success, error) => {
    set((state) => {
      const newProgress = new Map(state.progress);
      const existing = newProgress.get(bookId);
      if (existing) {
        newProgress.set(bookId, {
          ...existing,
          done: true,
          success,
          errors: error ? [...existing.errors, error] : existing.errors,
        });
      }

      // Check if all downloads are done
      const allDone = Array.from(newProgress.values()).every((p) => p.done);
      return {
        progress: newProgress,
        screen: allDone ? 'results' : state.screen,
      };
    });
  },

  resetProgress: () => set({ progress: new Map(), pausedBooks: new Set(), bookDirs: new Map() }),
}));
