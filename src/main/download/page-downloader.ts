// ============================================================================
// BiBox Downloader — Page Downloader (CDN PNG Downloads)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { PageInfo, BIBOX_CONSTANTS } from '../../shared/types';
import { sleep } from '../../shared/utils';
import { downloadFileToPath } from '../api/client';
import { CheckpointManager } from './checkpoint';
import { AdaptiveThrottle } from './throttle';
import { logger } from '../logging/logger';

import PQueue from 'p-queue';

export interface PageDownloadProgress {
  completed: number;
  total: number;
  currentFile: string;
  bytesDownloaded: number;
  errors: string[];
}

export type PageProgressCallback = (progress: PageDownloadProgress) => void;

export async function downloadPages(
  pages: PageInfo[],
  pagesDir: string,
  checkpoint: CheckpointManager,
  throttle: AdaptiveThrottle,
  onProgress: PageProgressCallback,
  abortSignal?: { aborted: boolean }
): Promise<{ completed: number; failed: number; errors: string[] }> {
  // Ensure output directory
  if (!fs.existsSync(pagesDir)) {
    fs.mkdirSync(pagesDir, { recursive: true });
  }

  // Initialize checkpoint for all pages
  checkpoint.initPages(pages.map((p) => p.filename));

  // Filter to only pending/failed pages
  const pendingFilenames = new Set(checkpoint.getPendingPages());
  const pendingPages = pages.filter((p) => pendingFilenames.has(p.filename));

  logger.info('PageDL', `Starting: ${pendingPages.length} pending of ${pages.length} total pages (${pages.length - pendingPages.length} already done)`);

  let completed = checkpoint.getCompletedPageCount();
  const total = pages.length;
  let bytesDownloaded = 0;
  const errors: string[] = [];

  // Create queue with adaptive concurrency
  const queue = new PQueue({ concurrency: throttle.getConcurrency() });

  // [Bug2-FIX] Update queue concurrency periodically — clamp to 1 minimum
  // PQueue does not support concurrency=0; actual pausing is handled by the
  // isPaused() busy-wait inside each task function.
  const concurrencyInterval = setInterval(() => {
    const newConcurrency = Math.max(1, throttle.getConcurrency());
    if (newConcurrency !== queue.concurrency) {
      queue.concurrency = newConcurrency;
    }
  }, 2000);

  const downloadTasks = pendingPages.map((page) => async () => {
    if (abortSignal?.aborted) return;
    if (throttle.isPaused()) {
      // Wait for throttle to resume
      while (throttle.isPaused() && !abortSignal?.aborted) {
        await sleep(500);
      }
      if (abortSignal?.aborted) return;
    }

    const outputPath = path.join(pagesDir, page.filename);
    const tmpPath = outputPath + '.tmp';

    checkpoint.setPageStatus(page.filename, 'in_progress');

    try {
      // [PERF] Stream directly to disk — no RAM buffering for PNGs
      const { size } = await downloadFileToPath(page.cdnPath, outputPath, {
        timeoutMs: 30000,
      });

      checkpoint.setPageStatus(page.filename, 'completed', { size });
      throttle.reportSuccess();
      completed++;
      bytesDownloaded += size;

      onProgress({
        completed,
        total,
        currentFile: page.filename,
        bytesDownloaded,
        errors,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn('PageDL', `Failed: ${page.filename} — ${errorMsg}`);
      const statusCode = extractStatusCode(errorMsg);
      const { shouldPause, pauseMs } = throttle.reportError(statusCode);

      // Clean up temp files (downloadFileToPath uses .dl.tmp internally, but clean both patterns)
      for (const tmp of [tmpPath, outputPath + '.dl.tmp']) {
        if (fs.existsSync(tmp)) {
          try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        }
      }

      const retries = (checkpoint.getPageStatus(page.filename)?.retries || 0) + 1;
      checkpoint.setPageStatus(page.filename, 'failed', {
        error: errorMsg,
        retries,
      });

      // Retry up to RETRY_COUNT times
      if (retries <= BIBOX_CONSTANTS.RETRY_COUNT) {
        checkpoint.setPageStatus(page.filename, 'pending', { retries });
        // Re-queue with delay
        await sleep(BIBOX_CONSTANTS.RETRY_BASE_MS * Math.pow(2, retries - 1));
        // FIX: Use pendingPages index (downloadTasks built from pendingPages, NOT pages)
        const taskIdx = pendingPages.indexOf(page);
        if (taskIdx >= 0) {
          queue.add(downloadTasks[taskIdx]);
        }
      } else {
        logger.error('PageDL', `Giving up on ${page.filename} after ${retries} retries: ${errorMsg}`);
        errors.push(`Page ${page.filename}: ${errorMsg}`);
      }

      if (shouldPause) {
        await sleep(pauseMs);
      }
    }
  });

  // Add all tasks to queue
  for (const task of downloadTasks) {
    queue.add(task);
  }

  try {
    await queue.onIdle();
  } finally {
    clearInterval(concurrencyInterval);
  }

  const failed = Object.values(checkpoint.getState().pages)
    .filter((s) => s.status === 'failed').length;

  return { completed, failed, errors };
}

function extractStatusCode(errorMsg: string): number | undefined {
  const match = errorMsg.match(/\((\d{3})\)/);
  return match ? parseInt(match[1], 10) : undefined;
}
