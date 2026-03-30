"use strict";
// ============================================================================
// BiBox Downloader — In-Memory Token Store
// ============================================================================
// JWT tokens are NEVER persisted to disk — only held in RAM.
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenStore = void 0;
class TokenStore {
    tokens = null;
    setTokens(tokens) {
        this.tokens = tokens;
    }
    getAccessToken() {
        if (!this.tokens)
            return null;
        if (this.isExpired())
            return null;
        return this.tokens.accessToken;
    }
    getTokens() {
        return this.tokens;
    }
    isExpired() {
        if (!this.tokens)
            return true;
        const elapsed = (Date.now() - this.tokens.obtainedAt) / 1000;
        // Consider expired 60 seconds early for safety margin
        return elapsed >= (this.tokens.expiresIn - 60);
    }
    getStatus() {
        if (!this.tokens)
            return 'logged_out';
        if (this.isExpired())
            return 'expired';
        return 'logged_in';
    }
    getExpiresAt() {
        if (!this.tokens)
            return null;
        return this.tokens.obtainedAt + this.tokens.expiresIn * 1000;
    }
    getRemainingSeconds() {
        if (!this.tokens)
            return 0;
        const remaining = (this.tokens.expiresIn * 1000 - (Date.now() - this.tokens.obtainedAt)) / 1000;
        return Math.max(0, Math.floor(remaining));
    }
    clear() {
        this.tokens = null;
    }
}
exports.tokenStore = new TokenStore();
//# sourceMappingURL=token-store.js.map