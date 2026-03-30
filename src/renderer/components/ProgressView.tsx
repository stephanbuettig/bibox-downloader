// ============================================================================
// BiBox Downloader — Progress View (Complete Rewrite for Bug 7)
// ============================================================================
// [Bug7] Improvements:
// - Single unified progress bar (pages + materials = 100%), no reset between phases
// - Real downloaded bytes shown
// - Pause/Resume button per book
// - PDF phase shows animated status message (no ANR feeling)
// - Phase label shows current activity clearly

import React, { useEffect, useState } from 'react';
import { useDownloadStore } from '../stores/download-store';

const phaseLabels: Record<string, string> = {
  discovery: 'Daten abrufen...',
  pages: 'Seiten herunterladen',
  materials: 'Materialien herunterladen',
  pdf: 'PDF wird erstellt...',
  done: 'Abgeschlossen',
};

function formatSpeed(bps: number): string {
  if (bps > 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  if (bps > 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')} min`;
}

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

const ProgressView: React.FC = () => {
  // [K2-FIX] pausedBooks now lives in Zustand store — survives unmount/remount
  const { progress, bookTitles, pausedBooks, setPaused } = useDownloadStore();

  const bookDirs = useDownloadStore((s) => s.bookDirs);
  const entries = Array.from(progress.values());
  const totalCompleted = entries.filter((p) => p.done).length;
  const totalBooks = entries.length;

  // Fetch actual folder sizes for completed books
  const [folderSizes, setFolderSizes] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    const fetchSizes = async () => {
      const newSizes = new Map<number, number>();
      for (const [bookId, dir] of bookDirs.entries()) {
        try {
          const size = await window.bibox.getFolderSize(dir);
          if (size > 0) newSizes.set(bookId, size);
        } catch { /* ignore */ }
      }
      if (newSizes.size > 0) setFolderSizes(newSizes);
    };
    if (bookDirs.size > 0) fetchSizes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookDirs.size]);

  const handlePauseResume = async (bookId: number) => {
    try {
      const isPaused = pausedBooks.has(bookId);
      if (isPaused) {
        await window.bibox.unpauseDownload(bookId);
        setPaused(bookId, false);
      } else {
        await window.bibox.pauseDownload(bookId);
        setPaused(bookId, true);
      }
    } catch (err) {
      console.error('Pause/Resume failed:', err);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.heading}>Download läuft</h2>
        <span style={styles.overallCount}>
          {totalCompleted}/{totalBooks} {totalBooks === 1 ? 'Buch' : 'Bücher'} fertig
        </span>
      </div>

      {/* [M4-FIX] Global keyframes — defined once, not per-book */}
      <style>{`
        @keyframes pdf-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={styles.list}>
        {entries.map((p) => {
          // [Bug7] Unified progress: pages + materials = 100%
          const totalItems = p.totalPages + p.totalMaterials;
          const completedItems = p.completedPages + p.completedMaterials;
          let overallPercent = totalItems > 0
            ? Math.round((completedItems / totalItems) * 100)
            : 0;

          // During PDF phase, all downloads are done — keep bar at 100%
          if (p.phase === 'pdf') {
            overallPercent = 100;
          }
          if (p.done) overallPercent = 100;

          const isPaused = pausedBooks.has(p.bookId);
          const isActive = !p.done && p.phase !== 'discovery';
          const isPdfPhase = p.phase === 'pdf';

          return (
            <div key={p.bookId} style={{
              ...styles.bookCard,
              // [K1-FIX] Visual distinction for failed books
              ...(p.done && !p.success ? { borderColor: '#7f1d1d' } : {}),
            }}>
              <div style={styles.bookHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, marginRight: '12px' }}>
                  {/* [K1-FIX] Status icon for completed/failed books */}
                  {p.done && p.success && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                  {p.done && !p.success && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  )}
                  <span style={styles.bookTitle}>
                    {bookTitles.get(p.bookId) || `Buch #${p.bookId}`}
                  </span>
                </div>
                <span style={{
                    ...styles.phaseTag,
                    background: p.done
                      ? (p.success ? '#064e3b' : '#450a0a')
                      : isPdfPhase ? '#3b1f56' : '#1e3a5f',
                    color: p.done
                      ? (p.success ? '#34d399' : '#fca5a5')
                      : isPdfPhase ? '#c084fc' : '#93c5fd',
                  }}>
                    {p.done && !p.success ? 'Fehlgeschlagen' : isPaused ? 'Pausiert' : (phaseLabels[p.phase] || p.phase)}
                  </span>
              </div>

              {/* [Bug7] Unified Progress Bar — never resets between phases */}
              <div style={styles.progressTrack}>
                <div style={{
                  ...styles.progressFill,
                  width: `${overallPercent}%`,
                  background: p.done
                    ? (p.success ? '#22c55e' : '#ef4444')
                    : isPdfPhase
                      ? 'linear-gradient(90deg, #8b5cf6, #a78bfa)'
                      : '#3b82f6',
                }} />
              </div>

              {/* Percent label — right-aligned below progress bar */}
              <div style={styles.progressFooter}>
                <div style={{ flex: 1 }} />
                <div style={styles.percentLabel}>{overallPercent}%</div>
              </div>

              {/* [Bug7] PDF phase: animated status instead of frozen UI */}
              {isPdfPhase && !p.done && (
                <div style={styles.pdfStatus}>
                  <div style={styles.pdfSpinner} />
                  <span>PDF wird erstellt — bitte warten...</span>
                </div>
              )}

              {/* [Bug7] Bottom section: stats left, pause button right — consistent layout */}
              <div style={styles.bottomRow}>
                {/* Left: stats + bytes + current item */}
                <div style={styles.bottomLeft}>
                  <div style={styles.stats}>
                    <span>Seiten: {p.completedPages}/{p.totalPages}</span>
                    <span>Materialien: {p.completedMaterials}/{p.totalMaterials}</span>
                    {p.speedBps > 0 && !isPdfPhase && <span>{formatSpeed(p.speedBps)}</span>}
                    {p.etaSeconds > 0 && !isPdfPhase && <span>geschätzte Dauer: {formatEta(p.etaSeconds)}</span>}
                  </div>

                  {(() => {
                    const actualSize = folderSizes.get(p.bookId);
                    const displayBytes = p.done && actualSize ? actualSize : p.bytesDownloaded;
                    return displayBytes > 0 ? (
                      <div style={styles.bytesInfo}>
                        {formatBytes(displayBytes)} {p.done ? 'Gesamtgröße' : 'heruntergeladen'}
                      </div>
                    ) : null;
                  })()}

                  {p.currentItem && !isPdfPhase && (
                    <div style={styles.currentItem}>{p.currentItem}</div>
                  )}
                </div>

                {/* Right: Pause/Resume button — always occupies space for layout consistency */}
                <div style={styles.bottomRight}>
                  {isActive && !isPdfPhase && (
                    <button
                      onClick={() => handlePauseResume(p.bookId)}
                      style={{
                        ...styles.pauseBtnLarge,
                        background: isPaused ? '#064e3b' : '#1e3a5f',
                        color: isPaused ? '#34d399' : '#93c5fd',
                        borderColor: isPaused ? '#065f46' : '#1d4ed8',
                      }}
                    >
                      {isPaused ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                            <polygon points="5,3 19,12 5,21" />
                          </svg>
                          Fortsetzen
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                            <rect x="4" y="3" width="6" height="18" rx="1" />
                            <rect x="14" y="3" width="6" height="18" rx="1" />
                          </svg>
                          Pausieren
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {p.errors.length > 0 && (
                <div style={styles.errorsBox}>
                  {p.errors.slice(-3).map((e, i) => (
                    <div key={i} style={styles.errorLine}>{e}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
    height: '100%',
    overflow: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  heading: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#f1f5f9',
  },
  overallCount: {
    fontSize: '14px',
    color: '#94a3b8',
    fontWeight: 600,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  bookCard: {
    background: '#1e293b',
    borderRadius: '10px',
    padding: '16px 20px',
    border: '1px solid #334155',
  },
  bookHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  bookTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#f1f5f9',
    flex: 1,
    marginRight: '12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  phaseTag: {
    fontSize: '12px',
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: '12px',
    whiteSpace: 'nowrap',
  },
  pauseBtnLarge: {
    border: '1px solid',
    padding: '6px 16px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
    transition: 'all 0.2s ease',
  },
  progressTrack: {
    width: '100%',
    height: '10px',
    background: '#0f172a',
    borderRadius: '5px',
    overflow: 'hidden',
    marginBottom: '6px',
  },
  progressFill: {
    height: '100%',
    borderRadius: '5px',
    transition: 'width 0.4s ease',
    minWidth: '2px',
  },
  progressFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  percentLabel: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 600,
  },
  pdfStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    background: '#1a1033',
    borderRadius: '8px',
    marginBottom: '10px',
    fontSize: '13px',
    color: '#c084fc',
    fontWeight: 500,
  },
  pdfSpinner: {
    width: '16px',
    height: '16px',
    border: '2px solid #4a3560',
    borderTopColor: '#c084fc',
    borderRadius: '50%',
    animation: 'pdf-spin 0.8s linear infinite',
    flexShrink: 0,
  },
  bottomRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '16px',
  },
  bottomLeft: {
    flex: 1,
    minWidth: 0,
  },
  bottomRight: {
    flexShrink: 0,
    minHeight: '32px',
    display: 'flex',
    alignItems: 'flex-end',
  },
  stats: {
    display: 'flex',
    gap: '16px',
    fontSize: '12px',
    color: '#94a3b8',
    flexWrap: 'wrap',
  },
  bytesInfo: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '6px',
  },
  currentItem: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '4px',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  errorsBox: {
    marginTop: '8px',
    padding: '8px',
    background: '#450a0a',
    borderRadius: '6px',
  },
  errorLine: {
    fontSize: '11px',
    color: '#fca5a5',
    lineHeight: '1.4',
  },
};

export default ProgressView;
