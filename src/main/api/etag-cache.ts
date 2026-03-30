// ============================================================================
// BiBox Downloader — JSON-based ETag Cache
// ============================================================================
// [v2] Uses JSON files instead of SQLite for portability (no native deps)

import * as fs from 'fs';
import * as path from 'path';
import { ETagCache, ETagEntry } from '../../shared/types';
import { logger } from '../logging/logger';

class EtagCacheManager {
  private cache: ETagCache = { entries: {} };
  private filePath: string | null = null;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  initialize(cacheDir: string): void {
    this.filePath = path.join(cacheDir, 'etags.json');

    // Ensure cache directory exists
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Load existing cache
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.cache = JSON.parse(raw);
      } catch {
        // Corrupt cache file — start fresh
        this.cache = { entries: {} };
      }
    }
  }

  get(url: string): ETagEntry | null {
    return this.cache.entries[url] || null;
  }

  set(url: string, etag: string, data: unknown): void {
    this.cache.entries[url] = {
      url,
      etag,
      data,
      cachedAt: Date.now(),
    };
    this.dirty = true;
    this.scheduleSave();
  }

  delete(url: string): void {
    delete this.cache.entries[url];
    this.dirty = true;
    this.scheduleSave();
  }

  clear(): void {
    this.cache = { entries: {} };
    this.dirty = true;
    this.saveNow();
  }

  // Debounced save — batches multiple writes
  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveNow();
      this.saveTimer = null;
    }, 2000);
  }

  saveNow(): void {
    if (!this.dirty || !this.filePath) return;

    try {
      // Atomic write: write to .tmp then rename
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.cache, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
    } catch (err) {
      logger.error('ETagCache', 'Save failed', err);
    }
  }

  // Cleanup on app exit
  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
  }
}

export const etagCache = new EtagCacheManager();
