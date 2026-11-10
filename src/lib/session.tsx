import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api.ts';
import type { AuthUser } from './types.ts';

type Theme = 'dark' | 'light';

interface SessionContextValue {
  user: AuthUser | null;
  loading: boolean;
  theme: Theme;
  setUser: (user: AuthUser | null) => void;
  refresh: () => Promise<void>;
  login: (email: string, password: string, remember: boolean) => Promise<AuthUser>;
  register: (payload: {
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const THEME_KEY = 'nerd.theme';

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#1C1811' : '#FFF8E8');
}

function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ user: AuthUser }>('/auth/me')
      .then((data) => {
        if (cancelled) return;
        setUserState(data.user);
        setThemeState(data.user.theme);
        localStorage.setItem(THEME_KEY, data.user.theme);
      })
      .catch(() => {
        if (!cancelled) setUserState(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setUser = useCallback((next: AuthUser | null) => {
    setUserState(next);
    if (next) {
      setThemeState(next.theme);
      localStorage.setItem(THEME_KEY, next.theme);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: AuthUser }>('/auth/me');
      setUser(data.user);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setUser(null);
    }
  }, [setUser]);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const data = await api.post<{ user: AuthUser }>('/auth/login', { email, password, remember });
      setUser(data.user);
      return data.user;
    },
    [setUser],
  );

  const register = useCallback(
    async (payload: { username: string; email: string; password: string; confirmPassword: string }) => {
      const data = await api.post<{ user: AuthUser }>('/auth/register', payload);
      setUser(data.user);
      return data.user;
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUserState(null);
    }
  }, []);

  const setTheme = useCallback(async (next: Theme) => {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    try {
      const data = await api.patch<{ user: AuthUser }>('/settings', { theme: next });
      setUserState(data.user);
    } catch {
      // الخادم غير متاح: يبقى الاختيار محفوظًا محليًا ليُطبَّق عند عودة الاتصال
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ user, loading, theme, setUser, refresh, login, register, logout, setTheme }),
    [user, loading, theme, setUser, refresh, login, register, logout, setTheme],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession يجب أن يُستخدم داخل SessionProvider');
  return context;
}
