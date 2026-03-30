// ============================================================================
// BiBox Downloader — Result View (Bug 8 Rewrite)
// ============================================================================
// [Bug8] Changes:
// - Show actual folder size from disk (via IPC getFolderSize)
// - Correct singular/plural: Buch/Bücher, Seite/Seiten, Material/Materialien
// - Rename "Bücher erfolgreich" → "Bücher"/"Buch"
// - Rename donation button to "Via PayPal spenden"

import React, { useEffect, useState } from 'react';
import { useDownloadStore } from '../stores/download-store';

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

const ResultView: React.FC = () => {
  const { progress, outputDir, bookDirs, setScreen, resetProgress } = useDownloadStore();
  const [actualSize, setActualSize] = useState<number | null>(null);

  const entries = Array.from(progress.values());
  const successCount = entries.filter((p) => p.success).length;
  const failCount = entries.filter((p) => p.done && !p.success).length;
  const totalPages = entries.reduce((s, p) => s + p.completedPages, 0);
  const totalMaterials = entries.reduce((s, p) => s + p.completedMaterials, 0);
  const allErrors = entries.flatMap((p) => p.errors);

  // [BugA-FIX] Fetch actual folder size for each downloaded book directory (not the whole outputDir).
  // outputDir is the user-selected root (e.g. C:\Users\Downloads) — scanning it would include ALL files.
  // Instead, sum the sizes of only the specific book folders created by this download session.
  useEffect(() => {
    const dirs = Array.from(bookDirs.values());
    if (dirs.length > 0) {
      Promise.all(dirs.map((d) => window.bibox.getFolderSize(d).catch(() => 0)))
        .then((sizes) => {
          const total = sizes.reduce((s, sz) => s + sz, 0);
          if (total > 0) setActualSize(total);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookDirs.size]);

  const openFolder = () => {
    if (outputDir) {
      window.bibox.openDirectory(outputDir);
    }
  };

  const exportLog = async () => {
    const result = await window.bibox.exportLog();
    if (!result.success && result.error && result.error !== 'Cancelled') {
      alert(`Log-Export fehlgeschlagen: ${result.error}`);
    }
  };

  const backToLibrary = () => {
    resetProgress();
    setScreen('library');
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Status Icon */}
        <div style={{
          ...styles.iconCircle,
          background: failCount === 0 ? '#064e3b' : '#451a03',
        }}>
          {failCount === 0 ? (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5">
              <path d="M12 9v4m0 4h.01" />
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          )}
        </div>

        <h1 style={styles.title}>
          {failCount === 0 ? 'Download abgeschlossen!' : 'Download mit Warnungen abgeschlossen'}
        </h1>

        {/* [Bug8] Stats with correct singular/plural */}
        <div style={styles.statsGrid}>
          <div style={styles.stat}>
            <span style={styles.statValue}>{successCount}</span>
            <span style={styles.statLabel}>{successCount === 1 ? 'Buch' : 'Bücher'}</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statValue}>{totalPages}</span>
            <span style={styles.statLabel}>{totalPages === 1 ? 'Seite' : 'Seiten'}</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statValue}>{totalMaterials}</span>
            <span style={styles.statLabel}>{totalMaterials === 1 ? 'Material' : 'Materialien'}</span>
          </div>
          <div style={styles.stat}>
            {/* [Bug8] Show actual folder size from disk */}
            <span style={styles.statValue}>
              {actualSize != null ? formatBytes(actualSize) : '...'}
            </span>
            <span style={styles.statLabel}>Dateigröße</span>
          </div>
        </div>

        {/* Errors */}
        {allErrors.length > 0 && (
          <div style={styles.errorsSection}>
            <h3 style={styles.errorsTitle}>Fehler ({allErrors.length})</h3>
            <div style={styles.errorsList}>
              {allErrors.slice(0, 10).map((e, i) => (
                <div key={i} style={styles.errorItem}>{e}</div>
              ))}
              {allErrors.length > 10 && (
                <div style={styles.moreErrors}>
                  ...und {allErrors.length - 10} weitere Fehler
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={styles.actions}>
          <button onClick={openFolder} style={styles.openBtn}>
            Im Explorer öffnen
          </button>
          <button onClick={exportLog} style={styles.logBtn}>
            Log exportieren
          </button>
          <button onClick={backToLibrary} style={styles.backBtn}>
            Zurück zur Bibliothek
          </button>
        </div>

        {/* [Bug8] Donate section — "Via PayPal spenden" */}
        {successCount > 0 && (
          <div style={styles.donateSection}>
            <p style={styles.donateText}>
              Gefällt dir der BiBox Downloader? Unterstütze die Weiterentwicklung!
            </p>
            <button
              onClick={() => window.bibox.openUrl('http://paypal.me/stephanbuettig/10')}
              style={styles.donateBtn}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#e879aa" stroke="none" style={{ marginRight: '6px' }}>
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              Via PayPal spenden
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    padding: '24px',
  },
  card: {
    background: '#1e293b',
    borderRadius: '12px',
    padding: '48px',
    maxWidth: '560px',
    width: '100%',
    textAlign: 'center',
    border: '1px solid #334155',
  },
  iconCircle: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 24px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#f1f5f9',
    marginBottom: '24px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '12px',
    marginBottom: '24px',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '12px',
    background: '#0f172a',
    borderRadius: '8px',
  },
  statValue: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#3b82f6',
  },
  statLabel: {
    fontSize: '11px',
    color: '#94a3b8',
  },
  errorsSection: {
    textAlign: 'left',
    marginBottom: '24px',
  },
  errorsTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#fbbf24',
    marginBottom: '8px',
  },
  errorsList: {
    background: '#450a0a',
    borderRadius: '8px',
    padding: '12px',
    maxHeight: '160px',
    overflow: 'auto',
  },
  errorItem: {
    fontSize: '12px',
    color: '#fca5a5',
    lineHeight: '1.5',
    paddingBottom: '4px',
  },
  moreErrors: {
    fontSize: '12px',
    color: '#f59e0b',
    fontStyle: 'italic',
    paddingTop: '4px',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
  },
  openBtn: {
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  logBtn: {
    background: 'transparent',
    border: '1px solid #475569',
    color: '#94a3b8',
    padding: '12px 24px',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  backBtn: {
    background: 'transparent',
    border: '1px solid #475569',
    color: '#94a3b8',
    padding: '12px 24px',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  donateSection: {
    marginTop: '24px',
    paddingTop: '20px',
    borderTop: '1px solid #334155',
  },
  donateText: {
    fontSize: '13px',
    color: '#64748b',
    marginBottom: '12px',
    lineHeight: '1.5',
  },
  donateBtn: {
    background: 'linear-gradient(135deg, #1e3a5f 0%, #334155 100%)',
    border: '1px solid #475569',
    color: '#e2e8f0',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    transition: 'all 0.2s',
  },
};

export default ResultView;
