// ============================================================================
// BiBox Downloader — Shared Utility Functions
// ============================================================================
// [Review3] Extracted from client.ts, page-downloader.ts, material-downloader.ts
// to avoid redundant definitions.

/**
 * Promise-based sleep for delays, retry backoff, etc.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
