import { create } from 'zustand';

interface AuthState {
  status: 'logged_out' | 'logging_in' | 'logged_in' | 'expired';
  expiresAt: number | null;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkStatus: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'logged_out',
  expiresAt: null,
  error: null,

  login: async () => {
    set({ status: 'logging_in', error: null });
    try {
      const result = await window.bibox.login();
      if (result.success) {
        const statusInfo = await window.bibox.getAuthStatus();
        set({
          status: 'logged_in',
          expiresAt: statusInfo.expiresAt || null,
          error: null,
        });
      } else {
        set({
          status: 'logged_out',
          error: result.error || 'Login fehlgeschlagen',
        });
      }
    } catch (err) {
      set({
        status: 'logged_out',
        error: err instanceof Error ? err.message : 'Unbekannter Fehler',
      });
    }
  },

  logout: async () => {
    await window.bibox.logout();
    set({ status: 'logged_out', expiresAt: null, error: null });
  },

  checkStatus: async () => {
    try {
      const info = await window.bibox.getAuthStatus();
      set({
        status: info.status as AuthState['status'],
        expiresAt: info.expiresAt || null,
      });
    } catch {
      set({ status: 'logged_out' });
    }
  },
}));
