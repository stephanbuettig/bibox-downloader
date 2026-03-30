"use strict";
// ============================================================================
// BiBox Downloader — OAuth 2.0 + PKCE Authentication
// ============================================================================
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
exports.trySilentLogin = trySilentLogin;
exports.performLogin = performLogin;
const electron_1 = require("electron");
const crypto = __importStar(require("crypto"));
const types_1 = require("../../shared/types");
const token_store_1 = require("./token-store");
const undici_1 = require("undici");
const logger_1 = require("../logging/logger");
// --- PKCE Helpers ---
function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}
function generateState() {
    return crypto.randomBytes(20).toString('hex').slice(0, 20);
}
function createPKCEParams() {
    const codeVerifier = generateCodeVerifier();
    return {
        codeVerifier,
        codeChallenge: generateCodeChallenge(codeVerifier),
        state: generateState(),
    };
}
// --- Silent Auto-Login ---
// [BugD-FIX] Attempt a background OAuth login using existing Westermann SSO session cookies.
// If the user's browser session is still valid, the SSO will auto-redirect without user interaction.
// This avoids showing the login screen on every app restart.
async function trySilentLogin() {
    const pkce = createPKCEParams();
    const authUrl = new URL(`${types_1.BIBOX_CONSTANTS.SSO_BASE}/auth/login`);
    authUrl.searchParams.set('client_id', types_1.BIBOX_CONSTANTS.CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', types_1.BIBOX_CONSTANTS.SCOPE);
    authUrl.searchParams.set('redirect_uri', types_1.BIBOX_CONSTANTS.REDIRECT_URI);
    authUrl.searchParams.set('state', pkce.state);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', pkce.codeChallenge);
    logger_1.logger.info('Auth', 'Attempting silent auto-login via existing SSO session');
    return new Promise((resolve) => {
        const authWindow = new electron_1.BrowserWindow({
            width: 1, height: 1,
            show: false, // Invisible — completely in background
            webPreferences: { contextIsolation: true, nodeIntegration: false },
        });
        let resolved = false;
        // [M8-FIX] Centralized cleanup — removes all listeners, clears timeout, closes window
        const finish = (result) => {
            if (resolved)
                return;
            resolved = true;
            clearTimeout(timeout);
            if (!authWindow.isDestroyed()) {
                authWindow.removeAllListeners();
                authWindow.webContents.removeAllListeners();
                authWindow.close();
            }
            resolve(result);
        };
        const timeout = setTimeout(() => {
            logger_1.logger.info('Auth', 'Silent login timed out — SSO session likely expired');
            finish(false);
        }, 8000);
        authWindow.webContents.on('will-redirect', async (...args) => {
            if (resolved)
                return;
            let urlStr;
            let preventDefault;
            if (args.length >= 2 && typeof args[1] === 'string') {
                urlStr = args[1];
                preventDefault = args[0].preventDefault.bind(args[0]);
            }
            else {
                const details = args[0];
                urlStr = details.url;
                preventDefault = details.preventDefault.bind(details);
            }
            if (urlStr.startsWith(types_1.BIBOX_CONSTANTS.REDIRECT_URI)) {
                preventDefault();
                const redirectUrl = new URL(urlStr);
                const code = redirectUrl.searchParams.get('code');
                const state = redirectUrl.searchParams.get('state');
                if (state !== pkce.state || !code) {
                    finish(false);
                    return;
                }
                try {
                    const tokens = await exchangeCodeForToken(code, pkce.codeVerifier);
                    token_store_1.tokenStore.setTokens(tokens);
                    logger_1.logger.info('Auth', `Silent auto-login successful — token expires in ${tokens.expiresIn}s`);
                    finish(true);
                }
                catch (err) {
                    logger_1.logger.warn('Auth', `Silent login token exchange failed: ${err instanceof Error ? err.message : String(err)}`);
                    finish(false);
                }
            }
        });
        // If the SSO shows a login form (user interaction needed), the silent attempt fails
        authWindow.webContents.on('did-finish-load', () => {
            if (resolved)
                return;
            const currentUrl = authWindow.webContents.getURL();
            if (currentUrl.includes(types_1.BIBOX_CONSTANTS.SSO_BASE) && !currentUrl.includes('code=')) {
                // Wait a bit more — the redirect might still happen
                setTimeout(() => {
                    if (!resolved) {
                        logger_1.logger.info('Auth', 'Silent login: SSO form loaded — user interaction needed');
                        finish(false);
                    }
                }, 2000);
            }
        });
        authWindow.on('closed', () => {
            finish(false);
        });
        authWindow.loadURL(authUrl.toString());
    });
}
// --- OAuth Flow ---
async function performLogin() {
    const pkce = createPKCEParams();
    // Build SSO authorization URL
    const authUrl = new URL(`${types_1.BIBOX_CONSTANTS.SSO_BASE}/auth/login`);
    authUrl.searchParams.set('client_id', types_1.BIBOX_CONSTANTS.CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', types_1.BIBOX_CONSTANTS.SCOPE);
    authUrl.searchParams.set('redirect_uri', types_1.BIBOX_CONSTANTS.REDIRECT_URI);
    authUrl.searchParams.set('state', pkce.state);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', pkce.codeChallenge);
    logger_1.logger.info('Auth', 'Starting OAuth 2.0 + PKCE login flow');
    return new Promise((resolve) => {
        const authWindow = new electron_1.BrowserWindow({
            width: 500,
            height: 700,
            title: 'BiBox Login — Westermann SSO',
            autoHideMenuBar: true,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        let resolved = false;
        const cleanup = () => {
            if (!authWindow.isDestroyed()) {
                authWindow.close();
            }
        };
        // [v2] CRITICAL: Use will-redirect to intercept BEFORE navigation
        // This prevents the bibox2 SPA from consuming the auth code
        // [Review2] Electron ≥26 uses a single `details` object instead of (event, url).
        // We handle BOTH signatures for forward compatibility:
        //   Legacy: (event, url: string)
        //   Modern: (details: { url: string, preventDefault(): void })
        authWindow.webContents.on('will-redirect', async (...args) => {
            if (resolved)
                return;
            // Detect signature: modern Electron passes 1 arg (details object),
            // legacy passes 2 args (event, url string)
            let urlStr;
            let preventDefault;
            if (args.length >= 2 && typeof args[1] === 'string') {
                // Legacy signature: (event, url)
                urlStr = args[1];
                preventDefault = args[0].preventDefault.bind(args[0]);
            }
            else {
                // Modern signature: (details) where details = { url, preventDefault() }
                const details = args[0];
                urlStr = details.url;
                preventDefault = details.preventDefault.bind(details);
            }
            if (urlStr.startsWith(types_1.BIBOX_CONSTANTS.REDIRECT_URI)) {
                preventDefault(); // Stop the redirect!
                const redirectUrl = new URL(urlStr);
                const code = redirectUrl.searchParams.get('code');
                const state = redirectUrl.searchParams.get('state');
                // Validate state (CSRF protection)
                if (state !== pkce.state) {
                    resolved = true;
                    cleanup();
                    resolve({ success: false, error: 'State mismatch — possible CSRF attack' });
                    return;
                }
                if (!code) {
                    resolved = true;
                    cleanup();
                    resolve({ success: false, error: 'No authorization code received' });
                    return;
                }
                // Exchange code for token
                try {
                    logger_1.logger.info('Auth', 'Authorization code received, exchanging for token');
                    const tokens = await exchangeCodeForToken(code, pkce.codeVerifier);
                    token_store_1.tokenStore.setTokens(tokens);
                    logger_1.logger.info('Auth', `Login successful — token expires in ${tokens.expiresIn}s`);
                    resolved = true;
                    cleanup();
                    resolve({ success: true });
                }
                catch (err) {
                    logger_1.logger.error('Auth', `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`, err);
                    resolved = true;
                    cleanup();
                    resolve({
                        success: false,
                        error: `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
                    });
                }
            }
        });
        // Handle SSO errors via URL query params
        // [Review3] Same dual-signature handling as will-redirect for Electron ≥26 compat
        authWindow.webContents.on('did-navigate', (...navArgs) => {
            if (resolved)
                return;
            let urlStr;
            if (navArgs.length >= 2 && typeof navArgs[1] === 'string') {
                // Legacy: (event, url, httpResponseCode, httpStatusText)
                urlStr = navArgs[1];
            }
            else {
                // Modern: (details) where details = { url, ... }
                const details = navArgs[0];
                urlStr = details.url;
            }
            try {
                const parsed = new URL(urlStr);
                const error = parsed.searchParams.get('error');
                if (error) {
                    resolved = true;
                    cleanup();
                    resolve({ success: false, error: `SSO error: ${error}` });
                }
            }
            catch {
                // Invalid URL — ignore
            }
        });
        // Handle user closing the window
        authWindow.on('closed', () => {
            if (!resolved) {
                resolved = true;
                resolve({ success: false, error: 'Login cancelled by user' });
            }
        });
        // Load the SSO page
        authWindow.loadURL(authUrl.toString());
    });
}
// --- Token Exchange ---
async function exchangeCodeForToken(code, codeVerifier) {
    const body = JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: types_1.BIBOX_CONSTANTS.REDIRECT_URI,
        client_id: types_1.BIBOX_CONSTANTS.CLIENT_ID,
        code_verifier: codeVerifier,
    });
    const { statusCode, body: responseBody } = await (0, undici_1.request)(`${types_1.BIBOX_CONSTANTS.BACKEND_BASE}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Origin': types_1.BIBOX_CONSTANTS.FRONTEND_BASE,
            'Referer': `${types_1.BIBOX_CONSTANTS.FRONTEND_BASE}/`,
        },
        body,
    });
    const data = (await responseBody.json());
    if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`Token endpoint returned ${statusCode}: ${JSON.stringify(data)}`);
    }
    if (!data.access_token || typeof data.access_token !== 'string') {
        throw new Error('No access_token in response');
    }
    // [M7-FIX] Validate expires_in — protect against NaN, 0, or string values
    const rawExpiresIn = data.expires_in;
    const expiresIn = typeof rawExpiresIn === 'number' && rawExpiresIn > 0
        ? rawExpiresIn
        : types_1.BIBOX_CONSTANTS.TOKEN_VALIDITY_SECONDS;
    return {
        accessToken: data.access_token,
        tokenType: data.token_type || 'Bearer',
        expiresIn,
        obtainedAt: Date.now(),
    };
}
//# sourceMappingURL=oauth.js.map