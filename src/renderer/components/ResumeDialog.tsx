import React from 'react';

interface ResumeDialogProps {
  bookTitle: string;
  completedPages: number;
  totalPages: number;
  completedMaterials: number;
  totalMaterials: number;
  onResume: () => void;
  onStartFresh: () => void;
  onCancel: () => void;
}

const ResumeDialog: React.FC<ResumeDialogProps> = ({
  bookTitle, completedPages, totalPages, completedMaterials, totalMaterials,
  onResume, onStartFresh, onCancel,
}) => {
  return (
    <div style={styles.overlay}>
      <div style={styles.dialog}>
        <h2 style={styles.title}>Download fortsetzen?</h2>
        <p style={styles.subtitle}>
          Ein vorheriger Download für <strong>{bookTitle}</strong> wurde unterbrochen.
        </p>

        <div style={styles.statsRow}>
          <div style={styles.stat}>
            <span style={styles.statValue}>{completedPages}/{totalPages}</span>
            <span style={styles.statLabel}>Seiten</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statValue}>{completedMaterials}/{totalMaterials}</span>
            <span style={styles.statLabel}>Materialien</span>
          </div>
        </div>

        <div style={styles.actions}>
          <button onClick={onResume} style={styles.resumeBtn}>
            Fortsetzen
          </button>
          <button onClick={onStartFresh} style={styles.freshBtn}>
            Neu starten
          </button>
          <button onClick={onCancel} style={styles.cancelBtn}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  dialog: {
    background: '#1e293b',
    borderRadius: '12px',
    padding: '32px',
    maxWidth: '420px',
    width: '90%',
    border: '1px solid #334155',
    textAlign: 'center',
  },
  title: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#f1f5f9',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '14px',
    color: '#94a3b8',
    lineHeight: '1.5',
    marginBottom: '20px',
  },
  statsRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: '24px',
    marginBottom: '24px',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '10px 20px',
    background: '#0f172a',
    borderRadius: '8px',
  },
  statValue: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#3b82f6',
  },
  statLabel: {
    fontSize: '12px',
    color: '#94a3b8',
  },
  actions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'center',
  },
  resumeBtn: {
    background: '#22c55e',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  freshBtn: {
    background: '#f59e0b',
    color: '#000',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid #475569',
    color: '#94a3b8',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer',
  },
};

export default ResumeDialog;
