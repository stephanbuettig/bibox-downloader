"use strict";
// ============================================================================
// BiBox Downloader — HTTP Client (undici-based)
// ============================================================================
// [v2] Uses Node.js native undici instead of got (ESM-only incompatible)
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRequest = apiRequest;
exports.downloadFile = downloadFile;
exports.downloadFileToPath = downloadFileToPath;
const undici_1 = require("undici");
const fs = __importStar(require("fs"));
const types_1 = require("../../shared/types");
const utils_1 = require("../../shared/utils");
const token_store_1 = require("../auth/token-store");
const etag_cache_1 = require("./etag-cache");
const logger_1 = require("../logging/logger");
async function apiRequest(url, options = {}) {
    const { method = 'GET', body, useEtag = true, retries = types_1.BIBOX_CONSTANTS.RETRY_COUNT, timeoutMs = 30000, } = options;
    const token = token_store_1.tokenStore.getAccessToken();
    if (!token) {
        throw new Error('Not authenticated — no valid access token');
    }
    const requestHeaders = {
        'Authorization': `Bearer ${token}`,
        'Origin': types_1.BIBOX_CONSTANTS.FRONTEND_BASE,
        'Referer': `${types_1.BIBOX_CONSTANTS.FRONTEND_BASE}/`,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...options.headers,
    };
    // Add ETag for conditional requests
    if (useEtag && method === 'GET') {
        const cached = etag_cache_1.etagCache.get(url);
        if (cached?.etag) {
            requestHeaders['If-None-Match'] = cached.etag;
        }
    }
    if (body) {
        requestHeaders['Content-Type'] = 'application/json';
    }
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const { statusCode, headers: respHeaders, body: respBody } = await (0, undici_1.request)(url, {
                method: method,
                headers: requestHeaders,
                body: body || undefined,
                headersTimeout: timeoutMs,
                bodyTimeout: timeoutMs,
            });
            // 304 Not Modified — use cached data
            if (statusCode === 304 && useEtag) {
                const cached = etag_cache_1.etagCache.get(url);
                if (cached) {
                    return {
                        status: 304,
                        data: cached.data,
                        headers: flattenHeaders(respHeaders),
                        cached: true,
                    };
                }
            }
            // Rate limited — back off
            if (statusCode === 429 || statusCode === 503) {
                logger_1.logger.warn('HTTP', `Rate limited (${statusCode}) on ${url} — attempt ${attempt + 1}/${retries + 1}`);
                const retryAfter = parseInt(String(respHeaders['retry-after'] || '0'), 10);
                const backoff = retryAfter > 0
                    ? retryAfter * 1000
                    : types_1.BIBOX_CONSTANTS.RETRY_BASE_MS * Math.pow(2, attempt);
                // Consume the body to prevent memory leaks
                await respBody.text();
                if (attempt < retries) {
                    await (0, utils_1.sleep)(backoff);
                    continue;
                }
                throw new Error(`Rate limited (${statusCode}) after ${retries + 1} attempts`);
            }
            // 401 — token expired
            if (statusCode === 401) {
                logger_1.logger.warn('HTTP', `Auth expired (401) on ${url}`);
                await respBody.text();
                throw new Error('AUTH_EXPIRED');
            }
            // Read the body
            const text = await respBody.text();
            let data;
            try {
                data = JSON.parse(text);
            }
            catch {
                data = text;
            }
            // Store ETag for future conditional requests
            if (useEtag && method === 'GET' && statusCode === 200) {
                const etag = respHeaders['etag'];
                if (etag) {
                    etag_cache_1.etagCache.set(url, etag, data);
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
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            // Don't retry auth errors
            if (lastError.message === 'AUTH_EXPIRED')
                throw lastError;
            // Retry on network errors
            if (attempt < retries) {
                await (0, utils_1.sleep)(types_1.BIBOX_CONSTANTS.RETRY_BASE_MS * Math.pow(2, attempt));
                continue;
            }
        }
    }
    throw lastError || new Error(`Request failed after ${retries + 1} attempts`);
}
// Download raw binary data (for CDN assets)
async function downloadFile(url, options = {}) {
    const { timeoutMs = 60000 } = options;
    const token = token_store_1.tokenStore.getAccessToken();
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    // CDN requests may not need auth, but API material downloads do
    if (token && url.includes(types_1.BIBOX_CONSTANTS.BACKEND_BASE)) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['Origin'] = types_1.BIBOX_CONSTANTS.FRONTEND_BASE;
        headers['Referer'] = `${types_1.BIBOX_CONSTANTS.FRONTEND_BASE}/`;
    }
    // [Review4] FIX S4: Follow redirects (CDN/signed URLs may redirect)
    const { statusCode, headers: respHeaders, body } = await (0, undici_1.request)(url, {
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
    const contentType = respHeaders['content-type'] || 'application/octet-stream';
    return {
        data: buffer,
        contentType,
        size: buffer.length,
    };
}
// [Review2] Stream download directly to file — for large files (videos, etc.)
// Avoids loading entire file into RAM.
async function downloadFileToPath(url, outputPath, options = {}) {
    const { timeoutMs = 120000 } = options;
    const token = token_store_1.tokenStore.getAccessToken();
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (token && url.includes(types_1.BIBOX_CONSTANTS.BACKEND_BASE)) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['Origin'] = types_1.BIBOX_CONSTANTS.FRONTEND_BASE;
        headers['Referer'] = `${types_1.BIBOX_CONSTANTS.FRONTEND_BASE}/`;
    }
    // [Review4] FIX S4: Follow redirects (signed URLs may redirect)
    const { statusCode, headers: respHeaders, body } = await (0, undici_1.request)(url, {
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
    const contentType = respHeaders['content-type'] || 'application/octet-stream';
    const tmpPath = outputPath + '.dl.tmp';
    // Stream body directly to disk — never hold full file in memory
    let size = 0;
    const fileStream = fs.createWriteStream(tmpPath);
    try {
        // Track stream errors that occur during writes/drains
        let streamError = null;
        fileStream.on('error', (err) => { streamError = err; });
        for await (const chunk of body) {
            if (streamError)
                throw streamError;
            size += chunk.length;
            if (!fileStream.write(chunk)) {
                // Wait for drain, but also reject on stream error to avoid hanging
                await new Promise((resolve, reject) => {
                    fileStream.once('drain', resolve);
                    fileStream.once('error', reject);
                });
            }
        }
        if (streamError)
            throw streamError;
        fileStream.end();
        await new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
        });
    }
    catch (err) {
        fileStream.destroy();
        try {
            fs.unlinkSync(tmpPath);
        }
        catch { /* ignore */ }
        throw err;
    }
    // Atomic rename
    fs.renameSync(tmpPath, outputPath);
    return { contentType, size };
}
function flattenHeaders(headers) {
    const flat = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined) {
            flat[key] = Array.isArray(value) ? value.join(', ') : value;
        }
    }
    return flat;
}
//# sourceMappingURL=client.js.map