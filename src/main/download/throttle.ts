// ============================================================================
// BiBox Downloader — Adaptive Throttle Manager
// ============================================================================
// [v2 NEW] Dynamic concurrency: start at 3, scale up to 6 on success,
// drop to 2 on errors, recover slowly.

import { BIBOX_CONSTANTS } from '../../shared/types';

export class AdaptiveThrottle {
  private current: number;
  private min: number;
  private max: number;
  private successCount = 0;
  private errorCount = 0;
  private lastErrorTime = 0;
  private paused = false;

  // Thresholds for scaling
  private readonly SCALE_UP_AFTER = 20;    // Scale up after N successes
  private readonly SCALE_UP_STEP2 = 50;    // Scale up again after N successes
  private readonly RECOVERY_DELAY_MS = 30000; // Wait 30s after error to recover

  constructor(
    initial: number = BIBOX_CONSTANTS.DEFAULT_PARALLEL_CDN,
    min = 2,
    max: number = BIBOX_CONSTANTS.MAX_PARALLEL_CDN
  ) {
    this.current = initial;
    this.min = min;
    this.max = max;
  }

  getConcurrency(): number {
    return this.paused ? 0 : this.current;
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  reportSuccess(): void {
    this.successCount++;
    this.errorCount = 0;

    // Scale up logic
    if (this.successCount >= this.SCALE_UP_STEP2 && this.current < this.max) {
      this.current = Math.min(this.current + 1, this.max);
      this.successCount = 0; // Reset for next scaling step
    } else if (this.successCount >= this.SCALE_UP_AFTER && this.current < this.max - 1) {
      this.current = Math.min(this.current + 1, this.max - 1);
    }

    // Recovery from previous error
    const timeSinceError = Date.now() - this.lastErrorTime;
    if (this.lastErrorTime > 0 && timeSinceError > this.RECOVERY_DELAY_MS) {
      if (this.current < BIBOX_CONSTANTS.DEFAULT_PARALLEL_CDN) {
        this.current++;
      }
      this.lastErrorTime = 0;
    }
  }

  reportError(statusCode?: number): { shouldPause: boolean; pauseMs: number } {
    this.errorCount++;
    this.successCount = 0;
    this.lastErrorTime = Date.now();

    // Rate limited or server overload
    if (statusCode === 429 || statusCode === 503) {
      this.current = this.min;
      return { shouldPause: true, pauseMs: 5000 };
    }

    // Other errors — reduce slightly
    if (this.current > this.min) {
      this.current--;
    }

    // Too many consecutive errors — pause
    if (this.errorCount >= 5) {
      return { shouldPause: true, pauseMs: 10000 };
    }

    return { shouldPause: false, pauseMs: 0 };
  }

  getStats(): { current: number; successCount: number; errorCount: number } {
    return {
      current: this.current,
      successCount: this.successCount,
      errorCount: this.errorCount,
    };
  }
}
