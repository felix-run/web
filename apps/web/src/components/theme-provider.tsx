import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

/**
 * Minimal light/dark/system theme provider. Toggles the `.dark` class on <html>
 * (the selector the shadcn tokens in index.css key off), persists the choice,
 * and tracks the OS preference live while `system` is selected. The control
 * that sets it is the header menu's View → Theme radio group.
 */

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  /** The concrete theme actually applied (system resolved to light/dark). */
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'felix.theme';
/** `--background` per theme as sRGB, because `theme-color` is read by browser chrome
 *  that does not take `oklch()`. */
const THEME_COLOR = { light: '#ffffff', dark: '#09090b' } as const;

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function readStored(): Theme {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Track the OS preference so `system` stays live without a reload.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
    // Browser chrome follows the applied theme, not only the OS one the metas' media
    // queries read. Same values as index.html, which sets them before first paint.
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', THEME_COLOR[resolved]);
    }
  }, [resolved]);

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
