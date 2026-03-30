// ============================================================================
// BiBox Downloader — In-Memory Token Store
// ============================================================================
// JWT tokens are NEVER persisted to disk — only held in RAM.

import { AuthTokens, AuthStatus, BIBOX_CONSTANTS } from '../../shared/types';

class TokenStore {
  private tokens: AuthTokens | null = null;

  setTokens(tokens: AuthTokens): void {
    this.tokens = tokens;
  }

  getAccessToken(): string | null {
    if (!this.tokens) return null;
    if (this.isExpired()) return null;
    return this.tokens.accessToken;
  }

  getTokens(): AuthTokens | null {
    return this.tokens;
  }

  isExpired(): boolean {
    if (!this.tokens) return true;
    const elapsed = (Date.now() - this.tokens.obtainedAt) / 1000;
    // Consider expired 60 seconds early for safety margin
    return elapsed >= (this.tokens.expiresIn - 60);
  }

  getStatus(): AuthStatus {
    if (!this.tokens) return 'logged_out';
    if (this.isExpired()) return 'expired';
    return 'logged_in';
  }

  getExpiresAt(): number | null {
    if (!this.tokens) return null;
    return this.tokens.obtainedAt + this.tokens.expiresIn * 1000;
  }

  getRemainingSeconds(): number {
    if (!this.tokens) return 0;
    const remaining = (this.tokens.expiresIn * 1000 - (Date.now() - this.tokens.obtainedAt)) / 1000;
    return Math.max(0, Math.floor(remaining));
  }

  clear(): void {
    this.tokens = null;
  }
}

export const tokenStore = new TokenStore();
