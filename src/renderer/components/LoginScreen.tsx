import React from 'react';
import { useAuthStore } from '../stores/auth-store';

const LoginScreen: React.FC = () => {
  const { status, error, login } = useAuthStore();

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.iconCircle}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </div>

        <h1 style={styles.title}>BiBox Downloader</h1>
        <p style={styles.subtitle}>
          Lade deine BiBox-Bücher und Lernmaterialien herunter — offline verfügbar, als PDF oder Einzelseiten.
        </p>

        {status === 'logged_in' && (
          <div style={styles.statusOk}>
            <span style={styles.checkmark}>&#10003;</span> Angemeldet
          </div>
        )}

        {error && (
          <div style={styles.errorBox}>
            {error}
          </div>
        )}

        <button
          onClick={login}
          disabled={status === 'logging_in'}
          style={{
            ...styles.loginBtn,
            opacity: status === 'logging_in' ? 0.6 : 1,
          }}
        >
          {status === 'logging_in' ? (
            <span>Anmeldung läuft...</span>
          ) : (
            <span>Mit Westermann-Konto anmelden</span>
          )}
        </button>

        <p style={styles.hint}>
          Die Anmeldung erfolgt direkt bei Westermann (mein.westermann.de). Dein Passwort wird nicht gespeichert.
        </p>

        {/* [Bug3] Prominent donation CTA with heart icon and warm styling */}
        <div style={styles.donateLink}>
          <button
            onClick={() => window.bibox.openUrl('http://paypal.me/stephanbuettig/10')}
            style={styles.donateLinkBtn}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#e879aa" stroke="none" style={{ marginRight: '8px', flexShrink: 0 }}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <span>Dieses Projekt unterstützen</span>
          </button>
        </div>
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
    maxWidth: '440px',
    width: '100%',
    textAlign: 'center',
    border: '1px solid #334155',
  },
  iconCircle: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    background: '#1e3a5f',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 24px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#f1f5f9',
    marginBottom: '12px',
  },
  subtitle: {
    fontSize: '14px',
    color: '#94a3b8',
    lineHeight: '1.6',
    marginBottom: '32px',
  },
  statusOk: {
    background: '#064e3b',
    color: '#34d399',
    padding: '10px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '14px',
    fontWeight: 600,
  },
  checkmark: {
    marginRight: '8px',
  },
  errorBox: {
    background: '#450a0a',
    color: '#fca5a5',
    padding: '10px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '13px',
    lineHeight: '1.5',
  },
  loginBtn: {
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    padding: '14px 28px',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    transition: 'background 0.2s',
  },
  hint: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '16px',
    lineHeight: '1.5',
  },
  donateLink: {
    marginTop: '24px',
    paddingTop: '16px',
    borderTop: '1px solid #334155',
  },
  donateLinkBtn: {
    background: 'linear-gradient(135deg, #1e293b 0%, #2d1f3d 100%)',
    border: '1px solid #4a3560',
    color: '#e2a4c0',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '10px 20px',
    borderRadius: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    letterSpacing: '0.2px',
  },
};

export default LoginScreen;
