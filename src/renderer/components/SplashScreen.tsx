// ============================================================================
// BiBox Downloader — Splash Screen (Loading Overlay)
// ============================================================================
// Shown during app startup while auth check and initialization runs.
// Renders as a full-screen overlay that fades out when ready.

import React, { useEffect, useRef, useState } from 'react';

interface SplashScreenProps {
  onReady: () => void;
  minDisplayMs?: number;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onReady, minDisplayMs = 1800 }) => {
  const [fadeOut, setFadeOut] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    const dismiss = () => {
      // Guard: Only fire once, even if both timers trigger
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      setFadeOut(true);
      // Wait for fade animation to complete before signaling ready
      setTimeout(onReady, 500);
    };

    // Minimum display time for smooth UX (avoids flash)
    const timer = setTimeout(dismiss, minDisplayMs);

    // Safety timeout: force close after 5 seconds no matter what
    const safetyTimer = setTimeout(dismiss, 5000);

    return () => {
      clearTimeout(timer);
      clearTimeout(safetyTimer);
    };
  }, [onReady, minDisplayMs]);

  return (
    <div style={{
      ...styles.overlay,
      opacity: fadeOut ? 0 : 1,
      transition: 'opacity 0.5s ease-out',
    }}>
      <div style={styles.content}>
        {/* Animated Book Icon */}
        <div style={styles.iconContainer}>
          <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <path d="M8 7h8" />
            <path d="M8 11h6" />
          </svg>
        </div>

        {/* Title */}
        <h1 style={styles.title}>
          <span style={styles.titleBibox}>BiBox</span>
          <span style={styles.titleDownloader}>Downloader</span>
        </h1>

        <p style={styles.subtitle}>
          Bücher & Materialien offline verfügbar machen
        </p>

        {/* Loading indicator */}
        <div style={styles.loaderTrack}>
          <div style={styles.loaderBar} />
        </div>

        <p style={styles.loadingText}>Wird geladen...</p>
      </div>

      {/* Inline keyframe animations */}
      <style>{`
        @keyframes splash-pulse {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        @keyframes splash-loader {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
        @keyframes splash-fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: '#0f172a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    pointerEvents: 'all',
  },
  content: {
    textAlign: 'center',
    animation: 'splash-fadeIn 0.6s ease-out',
  },
  iconContainer: {
    width: '120px',
    height: '120px',
    borderRadius: '28px',
    background: 'linear-gradient(135deg, #1e3a5f 0%, #1e293b 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 28px',
    animation: 'splash-pulse 2s ease-in-out infinite',
    boxShadow: '0 8px 32px rgba(59, 130, 246, 0.2)',
  },
  title: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: '10px',
    marginBottom: '8px',
  },
  titleBibox: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#3b82f6',
    letterSpacing: '-1px',
  },
  titleDownloader: {
    fontSize: '28px',
    fontWeight: 400,
    color: '#94a3b8',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748b',
    marginBottom: '36px',
    letterSpacing: '0.3px',
  },
  loaderTrack: {
    width: '200px',
    height: '3px',
    background: '#1e293b',
    borderRadius: '2px',
    margin: '0 auto 16px',
    overflow: 'hidden',
  },
  loaderBar: {
    width: '40%',
    height: '100%',
    background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
    borderRadius: '2px',
    animation: 'splash-loader 1.5s ease-in-out infinite',
  },
  loadingText: {
    fontSize: '12px',
    color: '#475569',
    letterSpacing: '0.5px',
  },
};

export default SplashScreen;
