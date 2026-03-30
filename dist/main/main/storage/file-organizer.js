"use strict";
// ============================================================================
// BiBox Downloader — File Organizer & Three-Level Type Detection
// ============================================================================
// [v2] Material type detection cascade:
// 1. Sync data type → 2. Content-Type header → 3. URL extension
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyMaterialType = classifyMaterialType;
exports.getTargetSubdir = getTargetSubdir;
exports.sanitizeFilename = sanitizeFilename;
exports.contentTypeToExtension = contentTypeToExtension;
// --- Three-Level Material Type Classification ---
function classifyMaterialType(syncType, // Level 1: from sync data
contentType, // Level 2: from Content-Type header (may be undefined)
downloadUrl // Level 3: from URL extension
) {
    // Level 1: Trust sync data if available and specific
    if (syncType && syncType !== 'unknown') {
        return syncType;
    }
    // Level 2: Content-Type header (guard against undefined)
    const ct = (contentType || '').toLowerCase().split(';')[0].trim();
    if (ct.startsWith('audio/'))
        return 'audio';
    if (ct.startsWith('video/'))
        return 'video';
    if (ct === 'application/pdf')
        return 'pdf';
    if (ct.startsWith('image/'))
        return 'image';
    if (ct === 'text/html' || ct === 'application/xhtml+xml')
        return 'html5';
    if (ct === 'application/zip' || ct === 'application/x-zip-compressed')
        return 'html5';
    if (ct === 'application/xml' || ct === 'text/xml')
        return 'xml';
    if (ct === 'application/octet-stream') {
        // Generic binary — fall through to URL extension detection
    }
    if (ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        return 'pdf'; // docx → Arbeitsblätter
    if (ct === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        return 'pdf'; // xlsx → Arbeitsblätter
    if (ct === 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
        return 'pdf'; // pptx → Arbeitsblätter
    if (ct === 'application/msword' || ct === 'application/vnd.ms-excel' || ct === 'application/vnd.ms-powerpoint')
        return 'pdf'; // Office → Arbeitsblätter
    // Level 3: URL extension fallback
    const ext = extractExtension(downloadUrl);
    switch (ext) {
        case 'mp3':
        case 'ogg':
        case 'wav':
        case 'flac':
        case 'aac':
        case 'm4a':
            return 'audio';
        case 'mp4':
        case 'webm':
        case 'avi':
        case 'mkv':
        case 'mov':
            return 'video';
        case 'pdf':
            return 'pdf';
        case 'zip':
        case 'html':
        case 'htm':
            return 'html5';
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'svg':
        case 'webp':
            return 'image';
        case 'xml':
            return 'xml';
        default:
            return 'unknown';
    }
}
// --- Target Subdirectory Mapping ---
function getTargetSubdir(type) {
    switch (type) {
        case 'audio': return 'Audio';
        case 'video': return 'Video';
        case 'pdf': return 'Arbeitsblätter';
        case 'html5': return 'Interaktiv';
        case 'image': return 'Sonstige';
        case 'xml': return 'Sonstige'; // Should be skipped before reaching here
        case 'unknown':
        default: return 'Sonstige';
    }
}
// --- Filename Sanitization ---
function sanitizeFilename(name) {
    return name
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Remove invalid chars
        .replace(/\s+/g, '_') // Spaces to underscores
        .replace(/_+/g, '_') // Collapse multiple underscores
        .replace(/^_|_$/g, '') // Trim underscores
        .slice(0, 150); // Limit length
}
// --- Content-Type to Extension Mapping ---
function contentTypeToExtension(contentType) {
    if (!contentType)
        return null;
    const ct = contentType.toLowerCase().split(';')[0].trim();
    const map = {
        'application/pdf': 'pdf',
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/ogg': 'ogg',
        'audio/wav': 'wav',
        'audio/flac': 'flac',
        'audio/aac': 'aac',
        'audio/mp4': 'm4a',
        'audio/x-m4a': 'm4a',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/x-msvideo': 'avi',
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/svg+xml': 'svg',
        'image/webp': 'webp',
        'text/html': 'html',
        'application/xhtml+xml': 'html',
        'application/zip': 'zip',
        'application/x-zip-compressed': 'zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'application/msword': 'doc',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.ms-powerpoint': 'ppt',
        'audio/midi': 'mid',
        'audio/x-midi': 'mid',
        'application/xml': 'xml',
        'text/xml': 'xml',
        'text/plain': 'txt',
        'application/json': 'json',
        'application/rtf': 'rtf',
    };
    return map[ct] || null;
}
// --- Helpers ---
function extractExtension(url) {
    try {
        const pathname = new URL(url).pathname;
        const match = pathname.match(/\.(\w{2,5})$/);
        return match ? match[1].toLowerCase() : '';
    }
    catch {
        const match = url.match(/\.(\w{2,5})(?:\?|$)/);
        return match ? match[1].toLowerCase() : '';
    }
}
//# sourceMappingURL=file-organizer.js.map