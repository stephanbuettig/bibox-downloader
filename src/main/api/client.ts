// ============================================================================
// BiBox Downloader — HTTP Client (undici-based)
// ============================================================================
// [v2] Uses Node.js native undici instead of got (ESM-only incompatible)

import { request, Dispatcher } from 'undici';
import * as fs from 'fs';
import { BIBOX_CONSTANTS } from '../../shared/types';
import { sleep } from '../../shared/utils';
import { tokenStore } from '../auth/token-store';
import { etagCache } from './etag-cache';
import { logger } from '../logging/logger';

export interface ApiRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  useEtag?: boolean;
  retries?: number;
  timeoutMs?: number;
}

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string>;
  cached: boolean;
}

export async function apiRequest<T = unknown>(
  url: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    body,
    useEtag = true,
    retries = BIBOX_CONSTANTS.RETRY_COUNT,
    timeoutMs = 30000,
  } = options;

  const token = tokenStore.getAccessToken();
  if (!token) {
    throw new Error('Not authenticated — no valid access token');
  }

  const requestHeaders: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Origin': BIBOX_CONSTANTS.FRONTEND_BASE,
    'Referer': `${BIBOX_CONSTANTS.FRONTEND_BASE}/`,
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ...options.headers,
  };

  // Add ETag for conditional requests
  if (useEtag && method === 'GET') {
    const cached = etagCache.get(url);
    if (cached?.etag) {
      requestHeaders['If-None-Match'] = cached.etag;
    }
  }

  if (body) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { statusCode, headers: respHeaders, body: respBody } = await request(url, {
        method: method as Dispatcher.HttpMethod,
        headers: requestHeaders,
        body: body || undefined,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });

      // 304 Not Modified — use cached data
      if (statusCode === 304 && useEtag) {
        const cached = etagCache.get(url);
        if (cached) {
          return {
            status: 304,
            data: cached.data as T,
            headers: flattenHeaders(respHeaders),
            cached: true,
          };
        }
      }

      // Rate limited — back off
      if (statusCode === 429 || statusCode === 503) {
        logger.warn('HTTP', `Rate limited (${statusCode}) on ${url} — attempt ${attempt + 1}/${retries + 1}`);
        const retryAfter = parseInt(String(respHeaders['retry-after'] || '0'), 10);
        const backoff = retryAfter > 0
          ? retryAfter * 1000
          : BIBOX_CONSTANTS.RETRY_BASE_MS * Math.pow(2, attempt);

        // Consume the body to prevent memory leaks
        await respBody.text();

        if (attempt < retries) {
          await sleep(backoff);
          continue;
        }
        throw new Error(`Rate limited (${statusCode}) after ${retries + 1} attempts`);
      }

      // 401 — token expired
      if (statusCode === 401) {
        logger.warn('HTTP', `Auth expired (401) on ${url}`);
        await respBody.text();
        throw new Error('AUTH_EXPIRED');
      }

      // Read the body
      const text = await respBody.text();
      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }

      // Store ETag for future conditional requests
      if (useEtag && method === 'GET' && statusCode === 200) {
        const etag = respHeaders['etag'] as string | undefined;
        if (etag) {
          etagCache.set(url, etag, data);
        }
      }

      // Client/server errors
      if (statusCode >= 400) {
        throw new Error(`HTTP ${statusCode}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
      }

      return {
        status: statusCode,
        data,
        headers: flattenHeaders(respHeaders),
        cached: false,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry auth errors
      if (lastError.message === 'AUTH_EXPIRED') throw lastError;

      // Retry on network errors
      if (attempt < retries) {
        await sleep(BIBOX_CONSTANTS.RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw lastError || new Error(`Request failed after ${retries + 1} attempts`);
}

// Download raw binary data (for CDN assets)
export async function downloadFile(
  url: string,
  options: { timeoutMs?: number } = {}
): Promise<{ data: Buffer; contentType: string; size: number }> {
  const { timeoutMs = 60000 } = options;

  const token = tokenStore.getAccessToken();
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };

  // CDN requests may not need auth, but API material downloads do
  if (token && url.includes(BIBOX_CONSTANTS.BACKEND_BASE)) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['Origin'] = BIBOX_CONSTANTS.FRONTEND_BASE;
    headers['Referer'] = `${BIBOX_CONSTANTS.FRONTEND_BASE}/`;
  }

  // [Review4] FIX S4: Follow redirects (CDN/signed URLs may redirect)
  const { statusCode, headers: respHeaders, body } = await request(url, {
    method: 'GET',
    headers,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    maxRedirections: 5,
  });

  if (statusCode !== 200) {
    const text = await body.text();
    throw new Error(`Download failed (${statusCode}): ${text.slice(0, 200)}`);
  }

  const buffer = Buffer.from(await body.arrayBuffer());
  const contentType = (respHeaders['content-type'] as string) || 'application/octet-stream';

  return {
    data: buffer,
    contentType,
    size: buffer.length,
  };
}

// [Review2] Stream download directly to file — for large files (videos, etc.)
// Avoids loading entire file into RAM.
export async function downloadFileToPath(
  url: string,
  outputPath: string,
  options: { timeoutMs?: number } = {}
): Promise<{ contentType: string; size: number }> {
  const { timeoutMs = 120000 } = options;

  const token = tokenStore.getAccessToken();
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };

  if (token && url.includes(BIBOX_CONSTANTS.BACKEND_BASE)) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['Origin'] = BIBOX_CONSTANTS.FRONTEND_BASE;
    headers['Referer'] = `${BIBOX_CONSTANTS.FRONTEND_BASE}/`;
  }

  // [Review4] FIX S4: Follow redirects (signed URLs may redirect)
  const { statusCode, headers: respHeaders, body } = await request(url, {
    method: 'GET',
    headers,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    maxRedirections: 5,
  });

  if (statusCode !== 200) {
    const text = await body.text();
    throw new Error(`Download failed (${statusCode}): ${text.slice(0, 200)}`);
  }

  const contentType = (respHeaders['content-type'] as string) || 'application/octet-stream';
  const tmpPath = outputPath + '.dl.tmp';

  // Stream body directly to disk — never hold full file in memory
  let size = 0;
  const fileStream = fs.createWriteStream(tmpPath);

  try {
    // Track stream errors that occur during writes/drains
    let streamError: Error | null = null;
    fileStream.on('error', (err) => { streamError = err; });

    for await (const chunk of body) {
      if (streamError) throw streamError;
      size += chunk.length;
      if (!fileStream.write(chunk)) {
        // Wait for drain, but also reject on stream error to avoid hanging
        await new Promise<void>((resolve, reject) => {
          fileStream.once('drain', resolve);
          fileStream.once('error', reject);
        });
      }
    }
    if (streamError) throw streamError;
    fileStream.end();
    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });
  } catch (err) {
    fileStream.destroy();
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }

  // Atomic rename
  fs.renameSync(tmpPath, outputPath);

  return { contentType, size };
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      flat[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return flat;
}
