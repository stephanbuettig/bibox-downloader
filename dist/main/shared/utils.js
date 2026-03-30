"use strict";
// ============================================================================
// BiBox Downloader — Shared Utility Functions
// ============================================================================
// [Review3] Extracted from client.ts, page-downloader.ts, material-downloader.ts
// to avoid redundant definitions.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = sleep;
/**
 * Promise-based sleep for delays, retry backoff, etc.
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=utils.js.map