import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export type ThemeMode = 'dark' | 'light';

export interface ThemeSettings {
  mode: ThemeMode;
}

const DEFAULTS: ThemeSettings = {
  mode: 'dark',
};

const MODE_TOKENS: Record<ThemeMode, Record<string, string>> = {
  dark: {
    '--pipe-bg': '#0c0c0e',
    '--pipe-text': '#ffffff',
    '--pipe-text-muted': 'rgba(255,255,255,0.65)',
    '--pipe-text-dim': 'rgba(255,255,255,0.45)',
    '--pipe-border': 'rgba(255,255,255,0.08)',
    '--pipe-border-light': 'rgba(255,255,255,0.04)',
    '--pipe-surface': 'rgba(255,255,255,0.04)',
    '--pipe-surface-hover': 'rgba(255,255,255,0.08)',
    '--pipe-surface-solid': '#1e1e25',
    '--pipe-surface-solid-hover': '#26262e',
    '--pipe-surface-elevated': '#1e1e25',
    '--pipe-overlay': 'rgba(12,12,14,0.93)',
    '--pipe-shadow': 'rgba(0,0,0,0.3)',
    '--pipe-accent': '#ffffff',
    '--pipe-accent-surface': 'rgba(255,255,255,0.08)',
    '--pipe-accent-border': 'rgba(255,255,255,0.2)',
  },
  light: {
    '--pipe-bg': '#f5f5f7',
    '--pipe-text': '#1a1a1a',
    '--pipe-text-muted': 'rgba(0,0,0,0.60)',
    '--pipe-text-dim': 'rgba(0,0,0,0.40)',
    '--pipe-border': 'rgba(0,0,0,0.10)',
    '--pipe-border-light': 'rgba(0,0,0,0.06)',
    '--pipe-surface': 'rgba(0,0,0,0.03)',
    '--pipe-surface-hover': 'rgba(0,0,0,0.07)',
    '--pipe-surface-solid': '#ffffff',
    '--pipe-surface-solid-hover': '#fafafa',
    '--pipe-surface-elevated': '#ffffff',
    '--pipe-overlay': 'rgba(245,245,247,0.88)',
    '--pipe-shadow': 'rgba(0,0,0,0.06)',
    '--pipe-accent': '#1a1a1a',
    '--pipe-accent-surface': 'rgba(0,0,0,0.06)',
    '--pipe-accent-border': 'rgba(0,0,0,0.15)',
  },
};

function applyModeTokens(mode: ThemeMode): void {
  const root = document.documentElement;
  const tokens = MODE_TOKENS[mode];
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
  root.setAttribute('data-theme', mode);
}

interface ThemeContextValue {
  theme: ThemeSettings;
  setMode: (mode: ThemeMode) => void;
}

const Ctx = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, forceMode }: { children: ReactNode; forceMode?: ThemeMode }): JSX.Element {
  const [theme, setTheme] = useState<ThemeSettings>(DEFAULTS);

  useEffect(() => {
    applyModeTokens(forceMode ?? theme.mode);
  }, [theme.mode, forceMode]);

  const setMode = useCallback((mode: ThemeMode) => {
    setTheme((prev) => ({ ...prev, mode }));
  }, []);

  return (
    <Ctx.Provider value={{ theme, setMode }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
