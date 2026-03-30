// ============================================================================
// BiBox Downloader — JSON File Persistence
// ============================================================================
// [v2] Uses JSON files instead of SQLite for portability

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logging/logger';

export class JsonStore<T = unknown> {
  private filePath: string;
  private data: T;
  private dirty = false;

  constructor(filePath: string, defaultValue: T) {
    this.filePath = filePath;
    this.data = defaultValue;

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing data
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        this.data = JSON.parse(raw) as T;
      } catch {
        // Corrupt file — use default
        this.data = defaultValue;
      }
    }
  }

  get(): T {
    return this.data;
  }

  set(data: T): void {
    this.data = data;
    this.dirty = true;
    this.save();
  }

  update(updater: (current: T) => T): void {
    this.data = updater(this.data);
    this.dirty = true;
    this.save();
  }

  save(): void {
    if (!this.dirty) return;
    try {
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
    } catch (err) {
      logger.error('JsonStore', `Save failed for ${this.filePath}`, err);
    }
  }

  delete(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch { /* ignore */ }
  }
}
