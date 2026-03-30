// ============================================================================
// BiBox Downloader — Material Downloader (URL-on-Demand)
// ============================================================================
// [v2] Each material: get URL → immediately download → save
// Never batch-collect URLs (they expire!)

import * as fs from 'fs';
import * as path from 'path';
import { MaterialInfo, MaterialType, BIBOX_CONSTANTS } from '../../shared/types';
import { sleep } from '../../shared/utils';
import { fetchMaterialDownloadUrl } from '../api/bibox-api';
import { downloadFile, downloadFileToPath } from '../api/client';
import { CheckpointManager } from './checkpoint';
import { AdaptiveThrottle } from './throttle';
import { classifyMaterialType, getTargetSubdir, sanitizeFilename, contentTypeToExtension } from '../storage/file-organizer';
import { htmlToMhtml } from '../storage/mhtml-converter';
import { logger } from '../logging/logger';

import PQueue from 'p-queue';

/**
 * Detect MIME type from file magic bytes (first bytes of file content).
 * Used to identify audio/video files served as application/octet-stream.
 */
function detectMimeByMagicBytes(buf: Buffer, bytesRead: number): string | null {
  if (bytesRead < 4) return null;

  // MP3: ID3 tag header
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'audio/mpeg';
  // MP3: MPEG audio frame sync (0xFFEx or 0xFFFx)
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return 'audio/mpeg';

  // WAV: RIFF....WAVE
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      bytesRead >= 12 && buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) {
    return 'audio/wav';
  }

  // FLAC: fLaC
  if (buf[0] === 0x66 && buf[1] === 0x4C && buf[2] === 0x61 && buf[3] === 0x43) return 'audio/flac';

  // OGG: OggS
  if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'audio/ogg';

  // MIDI: MThd
  if (buf[0] === 0x4D && buf[1] === 0x54 && buf[2] === 0x68 && buf[3] === 0x64) return 'audio/midi';

  // M4A/MP4/AAC: ftyp at offset 4
  if (bytesRead >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    // Check sub-type: M4A vs MP4
    if (bytesRead >= 12) {
      const brand = buf.slice(8, 12).toString('ascii');
      if (brand === 'M4A ' || brand === 'M4B ') return 'audio/mp4';
    }
    return 'video/mp4';  // Generic MP4 container — could be video or audio
  }

  // PDF: %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';

  // ZIP: PK
  if (buf[0] === 0x50 && buf[1] === 0x4B) return 'application/zip';

  // PNG: \x89PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';

  // JPEG: \xFF\xD8\xFF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';

  // GIF: GIF8
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';

  // WebM: \x1A\x45\xDF\xA3 (EBML header — Matroska/WebM)
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'video/webm';

  return null;
}

export interface MaterialDownloadProgress {
  completed: number;
  total: number;
  currentMaterial: string;
  bytesDownloaded: number;
  errors: string[];
}

export type MaterialProgressCallback = (progress: MaterialDownloadProgress) => void;

export interface MaterialDownloadOptions {
  /** If false, skip any material detected as HTML5 (even after download). Default: false */
  downloadHtml5?: boolean;
}

export async function downloadMaterials(
  materials: MaterialInfo[],
  bookId: number,
  materialsDir: string,
  checkpoint: CheckpointManager,
  onProgress: MaterialProgressCallback,
  abortSignal?: { aborted: boolean },
  throttle?: AdaptiveThrottle,  // [Bug2-FIX] Accept throttle for pause support
  matOptions?: MaterialDownloadOptions,
): Promise<{ completed: number; failed: number; errors: string[] }> {
  // Ensure output directories — only create subdirs needed by the materials we'll download
  const neededSubdirs = new Set<string>();
  for (const m of materials) {
    neededSubdirs.add(getTargetSubdir(m.type || 'unknown'));
  }
  for (const sub of neededSubdirs) {
    const dir = path.join(materialsDir, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Initialize checkpoint
  checkpoint.initMaterials(materials.map((m) => m.materialId));

  // Filter to pending
  const pendingIds = new Set(checkpoint.getPendingMaterials());
  const pendingMaterials = materials.filter((m) => pendingIds.has(m.materialId));

  logger.info('MatDL', `Starting: ${pendingMaterials.length} pending of ${materials.length} total materials`);

  let completed = checkpoint.getCompletedMaterialCount();
  const total = materials.length;
  let bytesDownloaded = 0;
  const errors: string[] = [];

  // Use adaptive concurrency from throttle (default 3, scales to 6)
  const concurrency = throttle ? Math.max(1, throttle.getConcurrency()) : BIBOX_CONSTANTS.MAX_PARALLEL_API;
  const queue = new PQueue({ concurrency });

  // Update queue concurrency periodically from throttle
  const concurrencyInterval = throttle ? setInterval(() => {
    const newC = Math.max(1, throttle.getConcurrency());
    if (newC !== queue.concurrency) queue.concurrency = newC;
  }, 2000) : null;

  // [Review2] Named factory function so failed tasks can be re-queued
  const createMaterialTask = (material: MaterialInfo) => async () => {
    if (abortSignal?.aborted) return;

    // [Bug2-FIX] Wait while paused — same pattern as page-downloader
    if (throttle?.isPaused()) {
      while (throttle.isPaused() && !abortSignal?.aborted) {
        await sleep(500);
      }
      if (abortSignal?.aborted) return;
    }

    const matId = material.materialId;
    checkpoint.setMaterialStatus(matId, 'in_progress');

    try {
      // Step 1: Get temporary download URL (URL-on-Demand)
      const downloadUrl = await fetchMaterialDownloadUrl(matId, bookId);

      // Add small delay between API requests
      await sleep(BIBOX_CONSTANTS.API_DELAY_MS);

      // Step 2+3: Pre-classify type (before download) for streaming decision
      const preType = classifyMaterialType(
        material.type,  // Level 1: from sync data
        undefined,       // Level 2: not known yet
        downloadUrl      // Level 3: from URL extension
      );

      // Stream ALL downloads directly to disk — no RAM buffering
      let size: number;
      let contentType: string;
      const isLargeType = preType === 'video' || preType === 'audio';

      // Download to a temp location first, then determine final name
      const tmpDir = path.join(materialsDir, '.tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      const tmpPath = path.join(tmpDir, `mat_${matId}.tmp`);

      const result = await downloadFileToPath(downloadUrl, tmpPath, {
        timeoutMs: isLargeType ? 300000 : 120000,
      });
      size = result.size;
      contentType = result.contentType;

      // Reject 0-byte downloads — treat as failed
      if (size === 0) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        throw new Error(`Empty response (0 bytes) for material ${matId}`);
      }

      // Content inspection: detect real file type by magic bytes
      // (many BiBox files are served as application/octet-stream)
      let effectiveContentType = contentType;
      {
        let inspFd: number | undefined;
        try {
          inspFd = fs.openSync(tmpPath, 'r');
          const headerBuf = Buffer.alloc(512);
          const bytesRead = fs.readSync(inspFd, headerBuf, 0, 512, 0);

          // XML detection (text-based)
          if (!contentType.includes('xml')) {
            const header = headerBuf.slice(0, bytesRead).toString('utf-8').trimStart();
            if (header.startsWith('<?xml') || header.startsWith('<xml')) {
              effectiveContentType = 'application/xml';
              logger.debug('MatDL', `Detected XML by content inspection: material ${matId}`);
            }
          }

          // Audio/video magic byte detection for application/octet-stream files
          if (effectiveContentType === 'application/octet-stream' && bytesRead >= 4) {
            const detected = detectMimeByMagicBytes(headerBuf, bytesRead);
            if (detected) {
              effectiveContentType = detected;
              logger.debug('MatDL', `Detected ${detected} by magic bytes: material ${matId}`);
            }
          }
        } catch { /* ignore read errors */ } finally {
          if (inspFd !== undefined) try { fs.closeSync(inspFd); } catch { /* ignore */ }
        }
      }

      // Refine type with actual Content-Type header (or content-detected type)
      const detectedType = classifyMaterialType(
        material.type,
        effectiveContentType,
        downloadUrl
      );

      // Skip XML metadata files — these are BiBox internal data, not real materials
      if (detectedType === 'xml') {
        logger.info('MatDL', `Skipping XML metadata file: material ${matId} (${material.title || 'untitled'})`);
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        checkpoint.setMaterialStatus(matId, 'completed', {
          type: detectedType,
          filename: 'SKIPPED_XML_METADATA',
          size: 0,
        });
        completed++;
        onProgress({ completed, total, currentMaterial: `Übersprungen: XML-Metadaten`, bytesDownloaded, errors });
        return;
      }

      // Skip HTML5 materials when the option is disabled (secondary filter)
      // The primary filter in engine.ts catches API-typed html5 materials,
      // but some materials are only detected as html5 after download (by content-type).
      if (detectedType === 'html5' && !matOptions?.downloadHtml5) {
        logger.info('MatDL', `Skipping HTML5 material (option disabled): material ${matId} (${material.title || 'untitled'})`);
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        checkpoint.setMaterialStatus(matId, 'completed', {
          type: detectedType,
          filename: 'SKIPPED_HTML5',
          size: 0,
        });
        completed++;
        onProgress({ completed, total, currentMaterial: `Übersprungen: HTML5-Interaktion`, bytesDownloaded, errors });
        return;
      }

      // Skip truly unknown files (would become useless .bin)
      if (detectedType === 'unknown') {
        logger.info('MatDL', `Skipping unknown file type: material ${matId} (${material.title || 'untitled'}, ct=${contentType})`);
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        checkpoint.setMaterialStatus(matId, 'completed', {
          type: detectedType,
          filename: 'SKIPPED_UNKNOWN_TYPE',
          size: 0,
        });
        completed++;
        onProgress({ completed, total, currentMaterial: `Übersprungen: unbekanntes Format`, bytesDownloaded, errors });
        return;
      }

      // Convert HTML files to MHTML for offline viewing
      if (detectedType === 'html5' && contentType && (contentType.includes('text/html') || contentType.includes('application/xhtml'))) {
        try {
          const htmlContent = fs.readFileSync(tmpPath);
          const mhtmlContent = htmlToMhtml(
            htmlContent,
            downloadUrl,
            material.title || `Material_${matId}`
          );
          fs.writeFileSync(tmpPath, mhtmlContent);
          logger.info('MatDL', `Converted HTML to MHTML: material ${matId}`);
        } catch (convErr) {
          logger.warn('MatDL', `MHTML conversion failed for material ${matId}, keeping as HTML`, convErr);
        }
      }

      // Build filename with the REAL extension from Content-Type
      // For HTML→MHTML converted files, use .mhtml extension
      const isMhtml = detectedType === 'html5' && contentType && (contentType.includes('text/html') || contentType.includes('application/xhtml'));
      const filename = isMhtml
        ? buildMaterialFilename(material, detectedType, downloadUrl, contentType).replace(/\.\w+$/, '.mhtml')
        : buildMaterialFilename(material, detectedType, downloadUrl, contentType);
      const subdir = getTargetSubdir(detectedType);
      const finalPath = path.join(materialsDir, subdir, filename);

      // Move from temp to final location
      if (!fs.existsSync(path.dirname(finalPath))) {
        fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      }
      fs.renameSync(tmpPath, finalPath);

      checkpoint.setMaterialStatus(matId, 'completed', {
        type: detectedType,
        filename,
        size,
      });
      logger.debug('MatDL', `Downloaded: ${filename} (${(size / 1024).toFixed(0)} KB, type=${detectedType}, ct=${contentType})`);

      completed++;
      bytesDownloaded += size;

      onProgress({
        completed,
        total,
        currentMaterial: filename,
        bytesDownloaded,
        errors,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn('MatDL', `Failed material ${matId}: ${errorMsg}`);

      // Handle expired/gone URLs
      if (errorMsg.includes('410') || errorMsg.includes('Gone')) {
        checkpoint.setMaterialStatus(matId, 'failed', {
          error: 'Material no longer available (410 Gone)',
        });
        errors.push(`Material ${matId}: no longer available`);
        return;
      }

      // Handle auth errors — try once with fresh URL
      if (errorMsg.includes('401') || errorMsg.includes('403')) {
        const retries = (checkpoint.getMaterialStatus(matId)?.retries || 0) + 1;
        if (retries <= 2) {
          checkpoint.setMaterialStatus(matId, 'pending', { retries, error: errorMsg });
          // [Review2] FIX: Re-queue the task instead of hoping "next pass" handles it
          await sleep(BIBOX_CONSTANTS.RETRY_BASE_MS * Math.pow(2, retries));
          queue.add(createMaterialTask(material));
        } else {
          checkpoint.setMaterialStatus(matId, 'failed', { error: errorMsg, retries });
          errors.push(`Material ${matId}: ${errorMsg}`);
        }
        return;
      }

      const retries = (checkpoint.getMaterialStatus(matId)?.retries || 0) + 1;
      if (retries <= BIBOX_CONSTANTS.RETRY_COUNT) {
        checkpoint.setMaterialStatus(matId, 'pending', { retries, error: errorMsg });
        // [Review2] FIX: Actually re-queue with exponential backoff
        await sleep(BIBOX_CONSTANTS.RETRY_BASE_MS * Math.pow(2, retries - 1));
        queue.add(createMaterialTask(material));
      } else {
        checkpoint.setMaterialStatus(matId, 'failed', { error: errorMsg, retries });
        errors.push(`Material ${matId}: ${errorMsg}`);
      }
    }
  };

  // Add all pending materials to queue
  for (const material of pendingMaterials) {
    queue.add(createMaterialTask(material));
  }

  try {
    await queue.onIdle();
  } finally {
    if (concurrencyInterval) clearInterval(concurrencyInterval);
  }

  // Clean up temp directory
  const tmpDir = path.join(materialsDir, '.tmp');
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch { /* ignore */ }

  const failed = Object.values(checkpoint.getState().materials)
    .filter((s) => s.status === 'failed').length;

  return { completed, failed, errors };
}

function buildMaterialFilename(
  material: MaterialInfo,
  type: MaterialType,
  downloadUrl: string,
  contentType?: string
): string {
  // Build descriptive filename: S{page}_{title}.{ext}
  const parts: string[] = [];

  // [Review3] FIX: pageRef === 0 (cover page) is falsy — use != null check
  if (material.pageRef != null) {
    parts.push(`S${String(material.pageRef).padStart(3, '0')}`);
  }

  if (material.title) {
    parts.push(sanitizeFilename(material.title));
  } else {
    parts.push(`Material_${material.materialId}`);
  }

  const ext = getExtension(type, downloadUrl, contentType);
  const basename = parts.join('_');

  return `${basename}.${ext}`;
}

function getExtension(type: MaterialType, url: string, contentType?: string): string {
  // Priority 1: Content-Type header (most reliable after download)
  const ctExt = contentTypeToExtension(contentType);
  if (ctExt) return ctExt;

  // Priority 2: URL extension
  const urlMatch = url.match(/\.(\w{2,5})(?:\?|$)/);
  if (urlMatch) {
    const ext = urlMatch[1].toLowerCase();
    if (['mp3', 'mp4', 'pdf', 'webm', 'ogg', 'wav', 'flac', 'aac', 'm4a', 'mid', 'midi', 'zip', 'html', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf'].includes(ext)) {
      return ext;
    }
  }

  // Priority 3: Type-based fallback
  switch (type) {
    case 'pdf': return 'pdf';
    case 'video': return 'mp4';
    case 'audio': return 'mp3';
    case 'html5': return 'zip';
    case 'image': return 'png';
    default: return 'bin';
  }
}
