import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from './stores/auth-store';
import { useDownloadStore } from './stores/download-store';
import { DEFAULT_DOWNLOAD_OPTIONS, DownloadOptions } from '@shared/types';
import SplashScreen from './components/SplashScreen';
import LoginScreen from './components/LoginScreen';
import LibraryGrid from './components/LibraryGrid';
import ProgressView from './components/ProgressView';
import ResultView from './components/ResultView';

const DONATE_URL = 'http://paypal.me/stephanbuettig/10';

const App: React.FC = () => {
  const authStatus = useAuthStore((s) => s.status);
  const screen = useDownloadStore((s) => s.screen);
  const setScreen = useDownloadStore((s) => s.setScreen);
  const showSplash = useDownloadStore((s) => s.showSplash);
  const hideSplash = useDownloadStore((s) => s.hideSplash);
  const outputDir = useDownloadStore((s) => s.outputDir);
  const options = useDownloadStore((s) => s.options);
  // [Bug2] Track whether the initial auth check has completed.
  // Don't show LoginScreen until we KNOW the user is logged out.
  const [authChecked, setAuthChecked] = useState(false);
  const settingsLoaded = useRef(false);

  // Load persisted settings on startup, then check auth
  useEffect(() => {
    const init = async () => {
      // Load saved settings (outputDir, download options)
      try {
        const saved = await window.bibox.loadSettings();
        if (saved) {
          if (typeof saved.outputDir === 'string' && saved.outputDir) {
            useDownloadStore.getState().setOutputDir(saved.outputDir);
          }
          if (saved.options && typeof saved.options === 'object') {
            const opts = saved.options as Partial<DownloadOptions>;
            const store = useDownloadStore.getState();
            for (const key of Object.keys(DEFAULT_DOWNLOAD_OPTIONS) as (keyof DownloadOptions)[]) {
              if (key in opts && opts[key] !== undefined) {
                store.setOption(key, opts[key] as never);
              }
            }
          }
        }
      } catch { /* settings load failed — use defaults */ }
      settingsLoaded.current = true;

      // Check auth status and attempt silent re-login.
      // IMPORTANT: Do NOT set authChecked until ALL attempts are finished.
      // This prevents the login screen + header buttons from flashing.
      await useAuthStore.getState().checkStatus();
      const currentStatus = useAuthStore.getState().status;
      if (currentStatus === 'logged_out' || currentStatus === 'expired') {
        try {
          const success = await window.bibox.trySilentLogin();
          if (success) {
            await useAuthStore.getState().checkStatus();
          }
        } catch {
          // Silent login failed — will show login screen
        }
      }
      // Only NOW reveal the UI — auth state is fully determined
      setAuthChecked(true);
    };
    init();
  }, []);

  // Persist settings whenever outputDir or options change
  useEffect(() => {
    if (!settingsLoaded.current) return; // Don't save until initial load completes
    window.bibox.saveSettings({ outputDir, options }).catch(() => {});
  }, [outputDir, options]);

  // [Bug2] Navigate based on auth status — skip login screen if already logged in.
  // Only navigate to login AFTER the auth check has completed (authChecked === true).
  useEffect(() => {
    if (authStatus === 'logged_in' && screen === 'login') {
      setScreen('library');
    } else if (authChecked && (authStatus === 'logged_out' || authStatus === 'expired')) {
      if (screen !== 'downloading' && screen !== 'results') {
        setScreen('login');
      }
    }
  }, [authStatus, authChecked, screen, setScreen]);

  const handleSplashReady = useCallback(() => {
    hideSplash();
  }, [hideSplash]);

  const openDonate = () => {
    window.bibox.openUrl(DONATE_URL);
  };

  return (
    <div style={styles.app}>
      {/* Splash overlay — rendered on top of everything, fades out */}
      {showSplash && <SplashScreen onReady={handleSplashReady} />}

      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>BiBox</span>
          <span style={styles.logoSub}>Downloader</span>
        </div>
        <div style={styles.headerRight}>
          {/* [Bug6] Donate button with heart icon + "Spenden" text — visible on library and results screens */}
          {/* Only show after auth check completes to prevent flash */}
          {authChecked && authStatus === 'logged_in' && (screen === 'library' || screen === 'results') && (
            <button
              onClick={openDonate}
              style={styles.donateBtn}
              title="Entwicklung unterstützen"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#e879aa" stroke="none">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              <span style={{ marginLeft: '6px', color: '#e2a4c0', fontSize: '13px', fontWeight: 600 }}>Spenden</span>
            </button>
          )}
          {/* [Review4] FIX K3: Hide logout during active download to prevent auth cascade */}
          {authChecked && authStatus === 'logged_in' && screen !== 'downloading' && (
            <button
              onClick={() => {
                useAuthStore.getState().logout();
                setScreen('login');
              }}
              style={styles.logoutBtn}
            >
              Abmelden
            </button>
          )}
        </div>
      </header>

      <main style={styles.main}>
        {/* [Bug2] Only show login screen after auth check completes to prevent flash */}
        {screen === 'login' && authChecked && <LoginScreen />}
        {screen === 'library' && <LibraryGrid />}
        {screen === 'downloading' && <ProgressView />}
        {screen === 'results' && <ResultView />}
      </main>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0f172a',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 24px',
    background: '#1e293b',
    borderBottom: '1px solid #334155',
    // @ts-expect-error Electron-specific CSS property
    WebkitAppRegion: 'drag',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    // @ts-expect-error Electron-specific CSS property
    WebkitAppRegion: 'no-drag',
  },
  logo: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#3b82f6',
    letterSpacing: '-0.5px',
  },
  logoSub: {
    fontSize: '16px',
    color: '#94a3b8',
    fontWeight: 400,
  },
  donateBtn: {
    background: 'transparent',
    border: '1px solid #4a3560',
    cursor: 'pointer',
    padding: '5px 12px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    opacity: 0.85,
    transition: 'opacity 0.2s',
  },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid #475569',
    color: '#94a3b8',
    padding: '6px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  main: {
    flex: 1,
    overflow: 'auto',
  },
};

export default App;
