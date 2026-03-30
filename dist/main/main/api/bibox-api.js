"use strict";
// ============================================================================
// BiBox Downloader — BiBox-Specific API Wrapper
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchBooks = fetchBooks;
exports.fetchIsbn = fetchIsbn;
exports.fetchPageData = fetchPageData;
exports.fetchSyncData = fetchSyncData;
exports.fetchMaterialDownloadUrl = fetchMaterialDownloadUrl;
exports.fetchSaktMaterials = fetchSaktMaterials;
const types_1 = require("../../shared/types");
const client_1 = require("./client");
const logger_1 = require("../logging/logger");
const API = types_1.BIBOX_CONSTANTS.BACKEND_BASE;
const CDN = types_1.BIBOX_CONSTANTS.STATIC_CDN;
// --- Books ---
async function fetchBooks() {
    const { data } = await (0, client_1.apiRequest)(`${API}/api/books`);
    // The /api/books response structure needs to be mapped.
    // Based on the HAR data, it's ~35 KB — likely an array of book objects.
    // We defensively handle both array and object wrapper formats.
    const booksArray = Array.isArray(data) ? data : data.books || [];
    // [DEBUG] Log raw first book to understand API shape
    if (Array.isArray(booksArray) && booksArray.length > 0) {
        logger_1.logger.debug('API', `fetchBooks raw sample: ${JSON.stringify(booksArray[0]).slice(0, 500)}`);
    }
    return booksArray.map((b) => ({
        id: Number(b.id || b.bookId),
        title: String(b.title || b.name || `Book ${b.id}`),
        isbn: b.isbn ? String(b.isbn) : undefined,
        coverUrl: b.coverUrl ? String(b.coverUrl) : undefined,
        // Try multiple possible property names for page count
        pageCount: extractNumber(b, ['pageCount', 'page_count', 'pages', 'numPages', 'totalPages']),
        materialCount: extractNumber(b, ['materialCount', 'material_count', 'materials', 'numMaterials']),
    }));
}
function extractNumber(obj, keys) {
    for (const key of keys) {
        if (key in obj && obj[key] != null) {
            const val = Number(obj[key]);
            if (!isNaN(val) && val > 0)
                return val;
        }
    }
    return undefined;
}
async function fetchIsbn(bookId) {
    try {
        const { data } = await (0, client_1.apiRequest)(`${API}/api/books/${bookId}/getIsbn`);
        if (typeof data === 'string')
            return data;
        if (typeof data === 'object' && data !== null) {
            const obj = data;
            return String(obj.isbn || obj.value || '');
        }
        return null;
    }
    catch {
        return null;
    }
}
async function fetchPageData(bookId) {
    try {
        const { data } = await (0, client_1.apiRequest)(`${API}/api/books/${bookId}/pageData`);
        logger_1.logger.debug('API', `pageData for book ${bookId}: ${JSON.stringify(data).slice(0, 300)}`);
        // Try multiple property names
        const count = extractNumber(data, ['pageCount', 'pages', 'totalPages', 'numPages', 'page_count', 'count']);
        // Also check if data itself is a number or the response is an array (count = length)
        if (count)
            return { pageCount: count };
        if (typeof data === 'number')
            return { pageCount: data };
        if (Array.isArray(data))
            return { pageCount: data.length };
        return {};
    }
    catch {
        return {};
    }
}
// --- Sync (PRIMARY DATA SOURCE) ---
async function fetchSyncData(bookId) {
    const { data } = await (0, client_1.apiRequest)(`${API}/v1/api/sync/${bookId}`);
    // The sync response is ~657 KB and is the CENTRAL data source.
    // We need to extract:
    // 1. Page information (base64 CDN paths)
    // 2. Material information (IDs, types, page associations)
    //
    // The exact structure must be discovered through live API exploration.
    // This implementation provides flexible extraction that handles
    // multiple possible structures.
    const syncData = data;
    const pages = extractPages(syncData, bookId);
    const materials = extractMaterials(syncData, bookId);
    return {
        bookId,
        pages,
        materials,
        raw: data,
    };
}
function extractPages(syncData, _bookId) {
    const pages = [];
    // Strategy: Search for base64 CDN path patterns in the sync data.
    // The sync response likely contains a structure like:
    //   { pages: [ { number: 1, path: "base64..." }, ... ] }
    // or the base64 path may be at a top level with pages as numbers.
    // Attempt 1: Look for a "pages" or "bookpages" array
    const possiblePageKeys = ['pages', 'bookpages', 'pageList', 'page_data', 'content'];
    for (const key of possiblePageKeys) {
        const value = deepFind(syncData, key);
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                const item = value[i];
                if (typeof item === 'object' && item !== null) {
                    const pageObj = item;
                    const pageNum = Number(pageObj.number || pageObj.page || pageObj.pageNumber || i);
                    const cdnPath = findCdnPathInObj(pageObj) || '';
                    if (cdnPath) {
                        pages.push({
                            pageNumber: pageNum,
                            filename: pageNum === 0 ? 'cover.png' : `${pageNum}.png`,
                            cdnPath,
                        });
                    }
                }
            }
            if (pages.length > 0)
                return pages;
        }
    }
    // Attempt 2: Look for a base64 path string and a page count
    const base64Path = findBase64Path(syncData);
    if (base64Path) {
        // Find page count from the sync data
        const pageCount = findPageCount(syncData);
        if (pageCount > 0) {
            // Cover
            pages.push({
                pageNumber: 0,
                filename: 'cover.png',
                cdnPath: `${CDN}/bookpages/${base64Path}/cover.png`,
            });
            // Pages
            for (let i = 1; i <= pageCount; i++) {
                pages.push({
                    pageNumber: i,
                    filename: `${i}.png`,
                    cdnPath: `${CDN}/bookpages/${base64Path}/${i}.png`,
                });
            }
            return pages;
        }
    }
    // Attempt 3: Walk the entire object tree looking for URL patterns
    const urls = findAllStringsMatching(syncData, /\/bookpages\/[A-Za-z0-9+/=]+\/\d+\.png/);
    for (const url of urls) {
        const match = url.match(/\/bookpages\/[A-Za-z0-9+/=]+\/(\d+|cover)\.png/);
        if (match) {
            const pageStr = match[1];
            const pageNum = pageStr === 'cover' ? 0 : parseInt(pageStr, 10);
            pages.push({
                pageNumber: pageNum,
                filename: pageStr === 'cover' ? 'cover.png' : `${pageNum}.png`,
                cdnPath: url.startsWith('http') ? url : `${CDN}${url}`,
            });
        }
    }
    return pages;
}
function extractMaterials(syncData, _bookId) {
    const materials = [];
    const seen = new Set();
    // Strategy: Search for material/resource arrays in the sync data
    const possibleKeys = ['materials', 'resources', 'media', 'attachments', 'materialList', 'supplements'];
    for (const key of possibleKeys) {
        const value = deepFind(syncData, key);
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === 'object' && item !== null) {
                    const obj = item;
                    const id = Number(obj.id || obj.materialId || obj.material_id);
                    if (id && !seen.has(id)) {
                        seen.add(id);
                        materials.push({
                            materialId: id,
                            title: obj.title ? String(obj.title) : obj.name ? String(obj.name) : undefined,
                            type: inferMaterialType(obj),
                            pageRef: obj.page ? Number(obj.page) : obj.pageRef ? Number(obj.pageRef) : undefined,
                            description: obj.description ? String(obj.description) : undefined,
                        });
                    }
                }
            }
        }
    }
    // Also walk the tree for material ID patterns
    if (materials.length === 0) {
        const allObjects = collectObjects(syncData);
        for (const obj of allObjects) {
            const id = Number(obj.materialId || obj.material_id || obj.matId);
            if (id && !seen.has(id)) {
                seen.add(id);
                materials.push({
                    materialId: id,
                    title: obj.title ? String(obj.title) : undefined,
                    type: inferMaterialType(obj),
                    pageRef: obj.page ? Number(obj.page) : undefined,
                });
            }
        }
    }
    return materials;
}
// --- Material Download URL ---
async function fetchMaterialDownloadUrl(materialId, bookId) {
    const { data } = await (0, client_1.apiRequest)(`${API}/api/materials/${materialId}/${bookId}/download-url?redirect=0`);
    // The response is ~276 bytes JSON — likely { url: "..." } or { downloadUrl: "..." }
    const url = data.url || data.downloadUrl;
    if (!url || typeof url !== 'string') {
        throw new Error(`No download URL in response for material ${materialId}`);
    }
    return url;
}
// --- SAKT Materials (supplementary) ---
async function fetchSaktMaterials(bookId) {
    try {
        const { data } = await (0, client_1.apiRequest)(`${API}/api/sakt-material/${bookId}`);
        if (!Array.isArray(data) || data.length === 0)
            return [];
        return data.map((item) => {
            const obj = item;
            return {
                materialId: Number(obj.id || obj.materialId),
                title: obj.title ? String(obj.title) : undefined,
                type: inferMaterialType(obj),
                pageRef: obj.page ? Number(obj.page) : undefined,
            };
        });
    }
    catch {
        return []; // sakt-material may return empty for some books
    }
}
// --- Helpers ---
function inferMaterialType(obj) {
    const type = String(obj.type || obj.materialType || obj.contentType || '').toLowerCase();
    if (type.includes('pdf') || type === 'worksheet')
        return 'pdf';
    if (type.includes('video') || type === 'mp4')
        return 'video';
    if (type.includes('audio') || type === 'mp3')
        return 'audio';
    if (type.includes('html') || type.includes('interactive') || type === 'h5p')
        return 'html5';
    if (type.includes('image') || type === 'png' || type === 'jpg')
        return 'image';
    if (type.includes('xml'))
        return 'xml';
    return 'unknown';
}
function deepFind(obj, targetKey) {
    if (typeof obj !== 'object' || obj === null)
        return undefined;
    const record = obj;
    if (targetKey in record)
        return record[targetKey];
    for (const value of Object.values(record)) {
        const result = deepFind(value, targetKey);
        if (result !== undefined)
            return result;
    }
    return undefined;
}
function findCdnPathInObj(obj) {
    // Search an object for a string that looks like a CDN path or URL
    for (const value of Object.values(obj)) {
        if (typeof value === 'string') {
            if (value.includes('/bookpages/') || value.includes('static.bibox2.westermann.de')) {
                return value.startsWith('http') ? value : `${CDN}${value}`;
            }
            // Check for a path-like property (e.g. "path", "url", "src", "cdnPath")
        }
    }
    for (const key of ['path', 'url', 'src', 'cdnPath', 'imagePath', 'pagePath']) {
        if (typeof obj[key] === 'string' && obj[key].length > 10) {
            return `${CDN}/bookpages/${obj[key]}`;
        }
    }
    return null;
}
function findBase64Path(obj) {
    // [Review2] More restrictive matching: CDN base64 paths are typically
    // 60-200 chars and valid base64 encoding. Exclude JWT tokens (contain dots),
    // UUIDs (contain hyphens), and short alphanumeric IDs.
    const strings = findAllStrings(obj);
    for (const s of strings) {
        if (s.length >= 40 &&
            s.length <= 200 &&
            /^[A-Za-z0-9+/]+=*$/.test(s) &&
            !s.includes('.') &&
            !s.includes('-') &&
            s.length % 4 === 0 // Valid base64 is always multiple of 4
        ) {
            return s;
        }
    }
    return null;
}
function findPageCount(obj) {
    if (typeof obj !== 'object' || obj === null)
        return 0;
    const record = obj;
    for (const key of ['pageCount', 'pages', 'totalPages', 'numPages', 'page_count']) {
        if (key in record && typeof record[key] === 'number') {
            return record[key];
        }
    }
    for (const value of Object.values(record)) {
        const count = findPageCount(value);
        if (count > 0)
            return count;
    }
    return 0;
}
function findAllStrings(obj, maxDepth = 10) {
    if (maxDepth <= 0)
        return [];
    const strings = [];
    if (typeof obj === 'string') {
        strings.push(obj);
    }
    else if (Array.isArray(obj)) {
        for (const item of obj) {
            strings.push(...findAllStrings(item, maxDepth - 1));
        }
    }
    else if (typeof obj === 'object' && obj !== null) {
        for (const value of Object.values(obj)) {
            strings.push(...findAllStrings(value, maxDepth - 1));
        }
    }
    return strings;
}
function findAllStringsMatching(obj, pattern) {
    return findAllStrings(obj).filter((s) => pattern.test(s));
}
function collectObjects(obj, maxDepth = 10) {
    if (maxDepth <= 0)
        return [];
    const results = [];
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        results.push(obj);
        for (const value of Object.values(obj)) {
            results.push(...collectObjects(value, maxDepth - 1));
        }
    }
    else if (Array.isArray(obj)) {
        for (const item of obj) {
            results.push(...collectObjects(item, maxDepth - 1));
        }
    }
    return results;
}
//# sourceMappingURL=bibox-api.js.map