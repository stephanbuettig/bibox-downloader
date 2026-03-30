// ============================================================================
// BiBox Downloader — Checkpoint Manager (Download Resume)
// ============================================================================
// [v2 NEW] JSON-based download state for crash-safe resume

import * as fs from 'fs';
import * as path from 'path';
import { DownloadState, PageState, MaterialState, DownloadPlan, ItemStatus } from '../../shared/types';
import { logger } from '../logging/logger';

const STATE_FILENAME = '.download-state.json';
const STATE_VERSION = 1;

export class CheckpointManager {
  private state: DownloadState;
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  // [PERF] Cached completed counts — avoids O(n) Object.values().filter() on every progress tick
  private _completedPages = 0;
  private _completedMaterials = 0;
  private _countsDirty = true;

  constructor(bookDir: string, bookId: number) {
    this.filePath = path.join(bookDir, STATE_FILENAME);
    this.state = {
      bookId,
      version: STATE_VERSION,
      startedAt: new Date().toISOString(),
      status: 'pending',
      plan: { totalPages: 0, totalMaterials: 0, estimatedSizeMB: 0 },
      pages: {},
      materials: {},
      pdf: { status: 'pending' },
    };
  }

  // --- Load / Check existing ---

  static exists(bookDir: string): boolean {
    return fs.existsSync(path.join(bookDir, STATE_FILENAME));
  }

  static load(bookDir: string, bookId: number): CheckpointManager {
    const mgr = new CheckpointManager(bookDir, bookId);
    const filePath = path.join(bookDir, STATE_FILENAME);

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const loaded = JSON.parse(raw) as DownloadState;
        if (loaded.bookId === bookId && loaded.version === STATE_VERSION) {
          mgr.state = loaded;
          mgr._countsDirty = true; // Force recount from loaded state
        }
      } catch {
        // Corrupt checkpoint — start fresh
      }
    }
    return mgr;
  }

  // --- Plan ---

  setPlan(plan: DownloadPlan): void {
    this.state.plan = plan;
    this.state.status = 'in_progress';
    this.markDirty();
  }

  // --- Pages ---

  initPages(filenames: string[]): void {
    for (const f of filenames) {
      if (!this.state.pages[f]) {
        this.state.pages[f] = { status: 'pending' };
      }
    }
    this.markDirty();
  }

  setPageStatus(filename: string, status: ItemStatus, extra?: Partial<PageState>): void {
    this.state.pages[filename] = {
      ...this.state.pages[filename],
      status,
      ...extra,
    };
    this.markDirty();
  }

  getPageStatus(filename: string): PageState | undefined {
    return this.state.pages[filename];
  }

  getPendingPages(): string[] {
    return Object.entries(this.state.pages)
      .filter(([_, s]) => s.status === 'pending' || s.status === 'failed')
      .map(([f]) => f);
  }

  getCompletedPageCount(): number {
    this.recalcCounts();
    return this._completedPages;
  }

  // --- Materials ---

  initMaterials(materialIds: number[]): void {
    for (const id of materialIds) {
      const key = String(id);
      if (!this.state.materials[key]) {
        this.state.materials[key] = { status: 'pending' };
      }
    }
    this.markDirty();
  }

  setMaterialStatus(materialId: number, status: ItemStatus, extra?: Partial<MaterialState>): void {
    this.state.materials[String(materialId)] = {
      ...this.state.materials[String(materialId)],
      status,
      ...extra,
    };
    this.markDirty();
  }

  getMaterialStatus(materialId: number): MaterialState | undefined {
    return this.state.materials[String(materialId)];
  }

  getPendingMaterials(): number[] {
    return Object.entries(this.state.materials)
      .filter(([_, s]) => s.status === 'pending' || s.status === 'failed')
      .map(([id]) => Number(id));
  }

  getCompletedMaterialCount(): number {
    this.recalcCounts();
    return this._completedMaterials;
  }

  // --- PDF ---

  setPdfStatus(status: ItemStatus): void {
    this.state.pdf.status = status;
    this.markDirty();
  }

  // --- Overall ---

  setStatus(status: DownloadState['status']): void {
    this.state.status = status;
    this.markDirty();
  }

  getState(): DownloadState {
    return this.state;
  }

  // --- Validate existing files ---

  validateCompletedFiles(bookDir: string): void {
    // Check all "completed" pages — verify file exists and size matches
    for (const [filename, state] of Object.entries(this.state.pages)) {
      if (state.status === 'completed') {
        const filePath = path.join(bookDir, 'Seiten', filename);
        if (!fs.existsSync(filePath)) {
          this.state.pages[filename] = { status: 'pending' };
          continue;
        }
        if (state.size) {
          const stat = fs.statSync(filePath);
          if (stat.size !== state.size) {
            this.state.pages[filename] = { status: 'pending' };
          }
        }
      }
      // Reset in_progress items (may be corrupt from crash)
      if (state.status === 'in_progress') {
        this.state.pages[filename] = { status: 'pending' };
        // Clean up any .tmp files
        const tmpPath = path.join(bookDir, 'Seiten', filename + '.tmp');
        if (fs.existsSync(tmpPath)) {
          try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
      }
    }

    // Same for materials
    for (const [matId, state] of Object.entries(this.state.materials)) {
      if (state.status === 'in_progress') {
        this.state.materials[matId] = { ...state, status: 'pending' };
      }
    }

    this.markDirty();
  }

  // --- Persistence ---

  private invalidateCounts(): void {
    this._countsDirty = true;
  }

  private recalcCounts(): void {
    if (!this._countsDirty) return;
    this._completedPages = 0;
    this._completedMaterials = 0;
    for (const s of Object.values(this.state.pages)) {
      if (s.status === 'completed') this._completedPages++;
    }
    for (const s of Object.values(this.state.materials)) {
      if (s.status === 'completed') this._completedMaterials++;
    }
    this._countsDirty = false;
  }

  private markDirty(): void {
    this.dirty = true;
    this.invalidateCounts();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveNow();
      this.saveTimer = null;
    }, 1000); // Debounce 1s
  }

  saveNow(): void {
    if (!this.dirty) return;
    try {
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
    } catch (err) {
      logger.error('Checkpoint', 'Save failed', err);
    }
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
  }

  delete(): void {
    this.dispose();
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch { /* ignore */ }
  }
}
