"use strict";
// ============================================================================
// BiBox Downloader — MHTML Converter
// ============================================================================
// Wraps HTML content in MHTML (MIME HTML) format for offline viewing.
// MHTML is a single-file archive format supported by most browsers.
Object.defineProperty(exports, "__esModule", { value: true });
exports.htmlToMhtml = htmlToMhtml;
/**
 * Convert raw HTML content to MHTML format.
 * The resulting .mhtml file can be opened directly in browsers like
 * Chrome, Edge, or IE for full offline viewing.
 */
function htmlToMhtml(htmlContent, sourceUrl, title) {
    const html = typeof htmlContent === 'string'
        ? htmlContent
        : htmlContent.toString('utf-8');
    const boundary = '----=_Part_BiBox_' + Date.now().toString(36);
    const date = new Date().toUTCString();
    const subject = title || 'BiBox Material';
    const location = sourceUrl || 'about:blank';
    // Encode HTML as quoted-printable for MHTML compatibility
    const encodedHtml = encodeQuotedPrintable(html);
    const mhtml = [
        `From: <BiBox Downloader>`,
        `Subject: ${subject}`,
        `Date: ${date}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/related;`,
        `\ttype="text/html";`,
        `\tboundary="${boundary}"`,
        ``,
        `This is a multi-part message in MIME format.`,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset="utf-8"`,
        `Content-Transfer-Encoding: quoted-printable`,
        `Content-Location: ${location}`,
        ``,
        encodedHtml,
        ``,
        `--${boundary}--`,
        ``,
    ].join('\r\n');
    return Buffer.from(mhtml, 'utf-8');
}
/**
 * Encode a string in quoted-printable format (RFC 2045).
 * Lines longer than 76 characters are soft-broken with '=\r\n'.
 */
function encodeQuotedPrintable(input) {
    const lines = [];
    let currentLine = '';
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        const code = char.charCodeAt(0);
        let encoded;
        if (char === '\r' && input[i + 1] === '\n') {
            // CRLF — preserve as line break
            lines.push(currentLine);
            currentLine = '';
            i++; // skip \n
            continue;
        }
        else if (char === '\n') {
            // Bare LF — normalize to CRLF
            lines.push(currentLine);
            currentLine = '';
            continue;
        }
        else if (char === '=' || code > 126 || (code < 32 && code !== 9)) {
            // Encode: =, non-ASCII, and control chars (except tab)
            // For multi-byte UTF-8 chars, encode each byte
            const bytes = Buffer.from(char, 'utf-8');
            encoded = '';
            for (const byte of bytes) {
                encoded += '=' + byte.toString(16).toUpperCase().padStart(2, '0');
            }
        }
        else {
            encoded = char;
        }
        // Soft line break if line would exceed 76 chars
        if (currentLine.length + encoded.length > 75) {
            lines.push(currentLine + '=');
            currentLine = encoded;
        }
        else {
            currentLine += encoded;
        }
    }
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }
    return lines.join('\r\n');
}
//# sourceMappingURL=mhtml-converter.js.map