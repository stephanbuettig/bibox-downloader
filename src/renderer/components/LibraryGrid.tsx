import React, { useEffect, useRef, useState } from 'react';
import { useBooksStore } from '../stores/books-store';
import { useDownloadStore } from '../stores/download-store';
import BookCard from './BookCard';
import DownloadConfig from './DownloadConfig';

const LibraryGrid: React.FC = () => {
  const { books, loading, error, loadBooks, checkCompletedBooks, toggleBook, selectAll, deselectAll, getSelectedIds } = useBooksStore();
  const { startDownload, outputDir } = useDownloadStore();
  const [showConfig, setShowConfig] = useState(false);
  // [K3-FIX] Track whether we already checked for this outputDir to avoid duplicate IPC calls
  const checkedDirRef = useRef<string>('');

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  // [Bug9][K3-FIX] Check for already-downloaded books — only once per outputDir change
  useEffect(() => {
    if (outputDir && books.length > 0 && checkedDirRef.current !== outputDir) {
      checkedDirRef.current = outputDir;
      checkCompletedBooks(outputDir);
    }
  }, [outputDir, books.length, checkCompletedBooks]);

  const selectedIds = getSelectedIds();
  // [Bug4] Calculate total pages for selected books instead of arbitrary MB estimate
  const totalPages = books.filter((b) => b.selected).reduce((sum, b) => sum + (b.pageCount || 0), 0);

  const handleStartDownload = async () => {
    if (selectedIds.length === 0) return;
    let targetDir = outputDir;
    if (!targetDir) {
      const dir = await window.bibox.selectDirectory();
      if (!dir) return;
      targetDir = dir;
      useDownloadStore.getState().setOutputDir(dir);
    }
    // [Review3] Pass book titles to download store for ProgressView display
    const titles = new Map<number, string>();
    for (const id of selectedIds) {
      const book = books.find((b) => b.id === id);
      if (book) titles.set(id, book.title);
    }
    useDownloadStore.getState().setBookTitles(titles);

    // FIX: Ensure outputDir is set in store BEFORE startDownload reads it
    // Zustand set() is synchronous, so this is safe after setOutputDir above
    await startDownload(selectedIds);
  };

  if (loading) {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Bücher werden geladen...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.center}>
        <div style={styles.errorBox}>
          <p>{error}</p>
          <button onClick={loadBooks} style={styles.retryBtn}>Erneut versuchen</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          <h2 style={styles.heading}>Meine Bibliothek</h2>
          <span style={styles.count}>{books.length} Bücher</span>
        </div>
        <div style={styles.toolbarRight}>
          <button onClick={selectAll} style={styles.selectBtn}>Alle auswählen</button>
          <button onClick={deselectAll} style={styles.selectBtn}>Alle abwählen</button>
          <button onClick={() => setShowConfig(!showConfig)} style={styles.configBtn}>
            Optionen {showConfig ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Config Panel */}
      {showConfig && <DownloadConfig />}

      {/* Books Grid */}
      <div style={styles.grid}>
        {books.map((book) => (
          <BookCard
            key={book.id}
            id={book.id}
            title={book.title}
            isbn={book.isbn}
            pageCount={book.pageCount}
            materialCount={book.materialCount}
            coverUrl={book.coverUrl}
            selected={book.selected}
            completed={book.completed}
            onToggle={toggleBook}
          />
        ))}
      </div>

      {/* Bottom Bar */}
      {selectedIds.length > 0 && (
        <div style={styles.bottomBar}>
          <div style={styles.summary}>
            <span style={styles.summaryText}>
              {selectedIds.length} {selectedIds.length === 1 ? 'Buch' : 'Bücher'} ausgewählt
            </span>
            <span style={styles.summarySize}>insgesamt {totalPages} {totalPages === 1 ? 'Seite' : 'Seiten'}</span>
          </div>
          <button onClick={handleStartDownload} style={styles.downloadBtn}>
            Download starten
          </button>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: '0 24px',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '16px',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #334155',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: '14px',
  },
  errorBox: {
    background: '#450a0a',
    padding: '24px',
    borderRadius: '10px',
    textAlign: 'center',
    color: '#fca5a5',
  },
  retryBtn: {
    marginTop: '12px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    padding: '8px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 0 12px',
    borderBottom: '1px solid #334155',
    marginBottom: '16px',
  },
  toolbarLeft: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
  },
  heading: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#f1f5f9',
  },
  count: {
    fontSize: '13px',
    color: '#64748b',
  },
  toolbarRight: {
    display: 'flex',
    gap: '8px',
  },
  selectBtn: {
    background: 'transparent',
    border: '1px solid #475569',
    color: '#94a3b8',
    padding: '6px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  configBtn: {
    background: '#334155',
    border: 'none',
    color: '#f1f5f9',
    padding: '6px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: '12px',
    flex: 1,
    overflow: 'auto',
    paddingBottom: '80px',
  },
  bottomBar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 24px',
    background: '#1e293b',
    borderTop: '1px solid #334155',
  },
  summary: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
  },
  summaryText: {
    color: '#f1f5f9',
    fontSize: '14px',
    fontWeight: 600,
  },
  summarySize: {
    color: '#f59e0b',
    fontSize: '13px',
    fontWeight: 600,
  },
  downloadBtn: {
    background: '#22c55e',
    color: '#fff',
    border: 'none',
    padding: '12px 28px',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};

export default LibraryGrid;
