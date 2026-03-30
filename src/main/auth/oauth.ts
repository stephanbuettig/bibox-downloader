// ============================================================================
// BiBox Downloader — OAuth 2.0 + PKCE Authentication
// ============================================================================

import { BrowserWindow } from 'electron';
import * as crypto from 'crypto';
import { BIBOX_CONSTANTS, PKCEParams, AuthTokens } from '../../shared/types';
import { tokenStore } from './token-store';
import { request } from 'undici';
import { logger } from '../logging/logger';

// --- PKCE Helpers ---

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(20).toString('hex').slice(0, 20);
}

function createPKCEParams(): PKCEParams {
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

export async function trySilentLogin(): Promise<boolean> {
  const pkce = createPKCEParams();
  const authUrl = new URL(`${BIBOX_CONSTANTS.SSO_BASE}/auth/login`);
  authUrl.searchParams.set('client_id', BIBOX_CONSTANTS.CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', BIBOX_CONSTANTS.SCOPE);
  authUrl.searchParams.set('redirect_uri', BIBOX_CONSTANTS.REDIRECT_URI);
  authUrl.searchParams.set('state', pkce.state);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', pkce.codeChallenge);

  logger.info('Auth', 'Attempting silent auto-login via existing SSO session');

  return new Promise((resolve) => {
    const authWindow = new BrowserWindow({
      width: 1, height: 1,
      show: false,  // Invisible — completely in background
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });

    let resolved = false;

    // [M8-FIX] Centralized cleanup — removes all listeners, clears timeout, closes window
    const finish = (result: boolean) => {
      if (resolved) return;
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
      logger.info('Auth', 'Silent login timed out — SSO session likely expired');
      finish(false);
    }, 8000);

    authWindow.webContents.on('will-redirect', async (...args: unknown[]) => {
      if (resolved) return;
      let urlStr: string;
      let preventDefault: () => void;
      if (args.length >= 2 && typeof args[1] === 'string') {
        urlStr = args[1] as string;
        preventDefault = (args[0] as { preventDefault: () => void }).preventDefault.bind(args[0]);
      } else {
        const details = args[0] as { url: string; preventDefault: () => void };
        urlStr = details.url;
        preventDefault = details.preventDefault.bind(details);
      }

      if (urlStr.startsWith(BIBOX_CONSTANTS.REDIRECT_URI)) {
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
          tokenStore.setTokens(tokens);
          logger.info('Auth', `Silent auto-login successful — token expires in ${tokens.expiresIn}s`);
          finish(true);
        } catch (err) {
          logger.warn('Auth', `Silent login token exchange failed: ${err instanceof Error ? err.message : String(err)}`);
          finish(false);
        }
      }
    });

    // If the SSO shows a login form (user interaction needed), the silent attempt fails
    authWindow.webContents.on('did-finish-load', () => {
      if (resolved) return;
      const currentUrl = authWindow.webContents.getURL();
      if (currentUrl.includes(BIBOX_CONSTANTS.SSO_BASE) && !currentUrl.includes('code=')) {
        // Wait a bit more — the redirect might still happen
        setTimeout(() => {
          if (!resolved) {
            logger.info('Auth', 'Silent login: SSO form loaded — user interaction needed');
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

export async function performLogin(): Promise<{ success: boolean; error?: string }> {
  const pkce = createPKCEParams();

  // Build SSO authorization URL
  const authUrl = new URL(`${BIBOX_CONSTANTS.SSO_BASE}/auth/login`);
  authUrl.searchParams.set('client_id', BIBOX_CONSTANTS.CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', BIBOX_CONSTANTS.SCOPE);
  authUrl.searchParams.set('redirect_uri', BIBOX_CONSTANTS.REDIRECT_URI);
  authUrl.searchParams.set('state', pkce.state);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', pkce.codeChallenge);

  logger.info('Auth', 'Starting OAuth 2.0 + PKCE login flow');

  return new Promise((resolve) => {
    const authWindow = new BrowserWindow({
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
    authWindow.webContents.on('will-redirect', async (...args: unknown[]) => {
      if (resolved) return;

      // Detect signature: modern Electron passes 1 arg (details object),
      // legacy passes 2 args (event, url string)
      let urlStr: string;
      let preventDefault: () => void;

      if (args.length >= 2 && typeof args[1] === 'string') {
        // Legacy signature: (event, url)
        urlStr = args[1] as string;
        preventDefault = (args[0] as { preventDefault: () => void }).preventDefault.bind(args[0]);
      } else {
        // Modern signature: (details) where details = { url, preventDefault() }
        const details = args[0] as { url: string; preventDefault: () => void };
        urlStr = details.url;
        preventDefault = details.preventDefault.bind(details);
      }

      if (urlStr.startsWith(BIBOX_CONSTANTS.REDIRECT_URI)) {
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
          logger.info('Auth', 'Authorization code received, exchanging for token');
          const tokens = await exchangeCodeForToken(code, pkce.codeVerifier);
          tokenStore.setTokens(tokens);
          logger.info('Auth', `Login successful — token expires in ${tokens.expiresIn}s`);
          resolved = true;
          cleanup();
          resolve({ success: true });
        } catch (err) {
          logger.error('Auth', `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`, err);
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
    authWindow.webContents.on('did-navigate', (...navArgs: unknown[]) => {
      if (resolved) return;

      let urlStr: string;
      if (navArgs.length >= 2 && typeof navArgs[1] === 'string') {
        // Legacy: (event, url, httpResponseCode, httpStatusText)
        urlStr = navArgs[1] as string;
      } else {
        // Modern: (details) where details = { url, ... }
        const details = navArgs[0] as { url: string };
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
      } catch {
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

async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<AuthTokens> {
  const body = JSON.stringify({
    grant_type: 'authorization_code',
    code,
    redirect_uri: BIBOX_CONSTANTS.REDIRECT_URI,
    client_id: BIBOX_CONSTANTS.CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const { statusCode, body: responseBody } = await request(
    `${BIBOX_CONSTANTS.BACKEND_BASE}/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': BIBOX_CONSTANTS.FRONTEND_BASE,
        'Referer': `${BIBOX_CONSTANTS.FRONTEND_BASE}/`,
      },
      body,
    }
  );

  const data = (await responseBody.json()) as Record<string, unknown>;

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
    : BIBOX_CONSTANTS.TOKEN_VALIDITY_SECONDS;

  return {
    accessToken: data.access_token as string,
    tokenType: (data.token_type as string) || 'Bearer',
    expiresIn,
    obtainedAt: Date.now(),
  };
}
