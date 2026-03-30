import React, { useEffect } from 'react';
import { useDownloadStore } from '../stores/download-store';

const DownloadConfig: React.FC = () => {
  const { options, outputDir, diskAvailableMB, setOption, setOutputDir, setDiskSpace } = useDownloadStore();

  const selectDir = async () => {
    const dir = await window.bibox.selectDirectory();
    if (dir) {
      setOutputDir(dir);
      try {
        const info = await window.bibox.checkDiskSpace(dir);
        setDiskSpace(Math.floor(info.available / 1024 / 1024));
      } catch { /* ignore */ }
    }
  };

  useEffect(() => {
    if (outputDir) {
      window.bibox.checkDiskSpace(outputDir).then((info) => {
        setDiskSpace(Math.floor(info.available / 1024 / 1024));
      }).catch(() => {});
    }
  }, [outputDir, setDiskSpace]);

  return (
    <div style={styles.panel}>
      {/* Output Directory */}
      <div style={styles.row}>
        <label style={styles.label}>Zielordner</label>
        <div style={styles.dirRow}>
          <span style={styles.dirPath}>{outputDir || 'Nicht gewählt'}</span>
          <button onClick={selectDir} style={styles.browseBtn}>Wählen...</button>
        </div>
        {diskAvailableMB !== null && (
          <span style={styles.diskInfo}>
            {diskAvailableMB > 1024
              ? `${(diskAvailableMB / 1024).toFixed(1)} GB verfügbar`
              : `${diskAvailableMB} MB verfügbar`}
          </span>
        )}
      </div>

      {/* Options Grid */}
      <div style={styles.optionsGrid}>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={options.downloadPdf}
            onChange={(e) => setOption('downloadPdf', e.target.checked)} />
          <span>Buch als PDF erstellen</span>
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={options.keepOriginalPngs}
            onChange={(e) => setOption('keepOriginalPngs', e.target.checked)} />
          <span>Original-PNGs behalten</span>
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={options.downloadMaterials}
            onChange={(e) => setOption('downloadMaterials', e.target.checked)} />
          <span>Materialien herunterladen</span>
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={options.downloadHtml5}
            onChange={(e) => setOption('downloadHtml5', e.target.checked)} />
          <span>HTML5-Interaktionen laden</span>
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={options.exportMaterialsPdf}
            onChange={(e) => setOption('exportMaterialsPdf', e.target.checked)} />
          <span>Materialien-PDF erstellen</span>
        </label>
      </div>

      {/* Parallel Slider */}
      <div style={styles.row}>
        <label style={styles.label}>
          Parallele Downloads: {options.maxParallel}
        </label>
        <input
          type="range"
          min={1} max={6} step={1}
          value={options.maxParallel}
          onChange={(e) => setOption('maxParallel', Number(e.target.value))}
          style={styles.slider}
        />
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '10px',
    padding: '16px 20px',
    marginBottom: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '13px',
    color: '#94a3b8',
    fontWeight: 600,
  },
  dirRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  dirPath: {
    flex: 1,
    fontSize: '13px',
    color: '#f1f5f9',
    background: '#1e293b',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #334155',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  browseBtn: {
    background: '#334155',
    color: '#f1f5f9',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    flexShrink: 0,
  },
  diskInfo: {
    fontSize: '12px',
    color: '#22c55e',
  },
  optionsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: '#f1f5f9',
    cursor: 'pointer',
  },
  slider: {
    width: '100%',
    accentColor: '#3b82f6',
  },
};

export default DownloadConfig;
