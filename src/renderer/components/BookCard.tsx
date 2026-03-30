import React from 'react';

interface BookCardProps {
  id: number;
  title: string;
  isbn?: string;
  pageCount?: number;
  materialCount?: number;
  coverUrl?: string;
  selected: boolean;
  completed?: boolean;  // [Bug9] Already fully downloaded
  onToggle: (id: number) => void;
}

const BookCard: React.FC<BookCardProps> = ({
  id, title, isbn, pageCount, materialCount, coverUrl, selected, completed, onToggle,
}) => {
  return (
    <div
      onClick={() => onToggle(id)}
      style={{
        ...styles.card,
        borderColor: completed ? '#22c55e' : selected ? '#3b82f6' : '#334155',
        background: completed ? '#0a2e1a' : selected ? '#1e3a5f' : '#1e293b',
      }}
    >
      <div style={styles.checkbox}>
        <div style={{
          ...styles.checkboxInner,
          background: selected ? '#3b82f6' : 'transparent',
          borderColor: selected ? '#3b82f6' : '#64748b',
        }}>
          {selected && <span style={styles.check}>&#10003;</span>}
        </div>
      </div>

      {/* [Bug9] "Vollständig geladen" badge */}
      {completed && (
        <div style={styles.completedBadge}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="3">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span>Vollständig geladen</span>
        </div>
      )}

      <div style={styles.coverWrap}>
        {coverUrl ? (
          <img src={coverUrl} alt={title} style={styles.coverImg} />
        ) : (
          <div style={styles.coverPlaceholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
        )}
      </div>

      <div style={styles.info}>
        <h3 style={styles.title}>{title}</h3>
        {isbn && <p style={styles.isbn}>ISBN: {isbn}</p>}
        {/* [Bug4] Show page count + material count — removed arbitrary size estimates */}
        <div style={styles.meta}>
          {pageCount != null && pageCount > 0 && (
            <span>{pageCount} {pageCount === 1 ? 'Seite' : 'Seiten'}</span>
          )}
          {materialCount != null && materialCount > 0 && (
            <span>{materialCount} {materialCount === 1 ? 'Material' : 'Materialien'}</span>
          )}
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    gap: '14px',
    padding: '14px',
    borderRadius: '10px',
    border: '2px solid #334155',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    position: 'relative',
  },
  checkbox: {
    position: 'absolute',
    top: '12px',
    right: '12px',
  },
  checkboxInner: {
    width: '22px',
    height: '22px',
    borderRadius: '6px',
    border: '2px solid #64748b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  },
  check: {
    color: '#fff',
    fontSize: '14px',
    fontWeight: 700,
  },
  // [Bug9] Completed badge
  completedBadge: {
    position: 'absolute',
    bottom: '8px',
    right: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '10px',
    fontWeight: 600,
    color: '#34d399',
    background: '#064e3b',
    padding: '3px 8px',
    borderRadius: '10px',
  },
  coverWrap: {
    flexShrink: 0,
    width: '80px',
    height: '110px',
    borderRadius: '6px',
    overflow: 'hidden',
    background: '#0f172a',
  },
  coverImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f172a',
  },
  info: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    paddingRight: '28px',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#f1f5f9',
    lineHeight: '1.3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  isbn: {
    fontSize: '11px',
    color: '#64748b',
    fontFamily: 'monospace',
  },
  meta: {
    display: 'flex',
    gap: '12px',
    fontSize: '12px',
    color: '#94a3b8',
    marginTop: '4px',
  },
};

export default BookCard;
