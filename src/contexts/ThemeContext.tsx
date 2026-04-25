/**
 * ThemeContext — User-configurable display/theme settings.
 *
 * Persisted to localStorage so preferences survive page reloads.
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';

// ── Background shader settings ──────────────────────────────────────────────

export type HeatmapColorTheme = 'aurora' | 'neon' | 'calm';

export interface BackgroundSettings {
  enabled: boolean;
  shader: 'liquid-metal' | 'heatmap' | 'anatomy-spine';
  heatmapTheme: HeatmapColorTheme;
  opacity: number;
  speed: number;
  scale: number;
  overlay: number;
  animateForever: boolean;
}

// ── Full theme ──────────────────────────────────────────────────────────────

export type ThemeMode = 'dark' | 'light' | 'anatomy' | 'anatomy-dark';

export interface ThemeSettings {
  mode: ThemeMode;
  background: BackgroundSettings;
}

const DEFAULTS: ThemeSettings = {
  mode: 'dark',
  background: {
    enabled: false,
    shader: 'liquid-metal',
    heatmapTheme: 'aurora',
    opacity: 0.4,
    speed: 0.3,
    scale: 0.6,
    overlay: 0,
    animateForever: false,
  },
};

const STORAGE_PREFIX = 'pipe-theme';

function storageKey(userId?: string): string {
  return userId ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX;
}

function loadTheme(userId?: string): ThemeSettings {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return {
      mode: parsed.mode ?? DEFAULTS.mode,
      background: { ...DEFAULTS.background, ...parsed.background },
    };
  } catch {
    return DEFAULTS;
  }
}

function saveTheme(theme: ThemeSettings, userId?: string): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(theme));
}

// ── Context ─────────────────────────────────────────────────────────────────

// ── CSS custom properties per mode ─────────────────────────────────────────

const MODE_TOKENS: Record<ThemeMode, Record<string, string>> = {
  anatomy: {
    '--pipe-bg': '#f3ead5',
    '--pipe-text': '#2a1f0e',
    '--pipe-text-muted': 'rgba(42,31,14,0.55)',
    '--pipe-text-dim': 'rgba(42,31,14,0.35)',
    '--pipe-border': 'rgba(42,31,14,0.14)',
    '--pipe-border-light': 'rgba(42,31,14,0.07)',
    '--pipe-surface': 'rgba(42,31,14,0.04)',
    '--pipe-surface-hover': 'rgba(42,31,14,0.09)',
    '--pipe-surface-solid': '#faf6ed',
    '--pipe-surface-solid-hover': '#f5edd8',
    '--pipe-overlay': 'rgba(243,234,213,0.93)',
    '--pipe-shadow': 'rgba(42,31,14,0.10)',
    '--pipe-accent': '#c17d3c',
    '--pipe-accent-surface': 'rgba(193,125,60,0.12)',
    '--pipe-accent-border': 'rgba(193,125,60,0.35)',
  },
  'anatomy-dark': {
    '--pipe-bg': '#1a1208',
    '--pipe-text': '#f3ead5',
    '--pipe-text-muted': 'rgba(243,234,213,0.6)',
    '--pipe-text-dim': 'rgba(243,234,213,0.35)',
    '--pipe-border': 'rgba(243,234,213,0.10)',
    '--pipe-border-light': 'rgba(243,234,213,0.05)',
    '--pipe-surface': 'rgba(243,234,213,0.04)',
    '--pipe-surface-hover': 'rgba(243,234,213,0.08)',
    '--pipe-surface-solid': '#231810',
    '--pipe-surface-solid-hover': '#2e2015',
    '--pipe-overlay': 'rgba(26,18,8,0.93)',
    '--pipe-shadow': 'rgba(0,0,0,0.45)',
    '--pipe-accent': '#d4953a',
    '--pipe-accent-surface': 'rgba(212,149,58,0.12)',
    '--pipe-accent-border': 'rgba(212,149,58,0.35)',
  },
  dark: {
    '--pipe-bg': '#15151b',
    '--pipe-text': '#ffffff',
    '--pipe-text-muted': 'rgba(255,255,255,0.5)',
    '--pipe-text-dim': 'rgba(255,255,255,0.3)',
    '--pipe-border': 'rgba(255,255,255,0.08)',
    '--pipe-border-light': 'rgba(255,255,255,0.04)',
    '--pipe-surface': 'rgba(255,255,255,0.04)',
    '--pipe-surface-hover': 'rgba(255,255,255,0.08)',
    '--pipe-surface-solid': '#1e1e25',
    '--pipe-surface-solid-hover': '#26262e',
    '--pipe-overlay': 'rgba(21,21,27,0.93)',
    '--pipe-shadow': 'rgba(0,0,0,0.3)',
    '--pipe-accent': '#ffffff',
    '--pipe-accent-surface': 'rgba(255,255,255,0.08)',
    '--pipe-accent-border': 'rgba(255,255,255,0.2)',
  },
  light: {
    '--pipe-bg': '#f5f5f7',
    '--pipe-text': '#1a1a1a',
    '--pipe-text-muted': 'rgba(0,0,0,0.55)',
    '--pipe-text-dim': 'rgba(0,0,0,0.45)',
    '--pipe-border': 'rgba(0,0,0,0.15)',
    '--pipe-border-light': 'rgba(0,0,0,0.08)',
    '--pipe-surface': 'rgba(0,0,0,0.05)',
    '--pipe-surface-hover': 'rgba(0,0,0,0.1)',
    '--pipe-surface-solid': '#ffffff',
    '--pipe-surface-solid-hover': '#fafafa',
    '--pipe-overlay': 'rgba(245,245,247,0.88)',
    '--pipe-shadow': 'rgba(0,0,0,0.08)',
    '--pipe-accent': '#1a1a1a',
    '--pipe-accent-surface': 'rgba(0,0,0,0.06)',
    '--pipe-accent-border': 'rgba(0,0,0,0.2)',
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
  updateBackground: (partial: Partial<BackgroundSettings>) => void;
  setMode: (mode: ThemeMode) => void;
  resetTheme: () => void;
  bindUser: (userId: string) => void;
}

const Ctx = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const userIdRef = useRef<string | undefined>(undefined);
  const [theme, setTheme] = useState<ThemeSettings>(() => loadTheme());

  const bindUser = useCallback((uid: string) => {
    if (userIdRef.current === uid) return;
    userIdRef.current = uid;
    setTheme(loadTheme(uid));
  }, []);

  // Apply CSS tokens whenever mode changes
  useEffect(() => {
    applyModeTokens(theme.mode);
  }, [theme.mode]);

  const setMode = useCallback((mode: ThemeMode) => {
    setTheme((prev) => {
      const fromAnatomy = prev.mode === 'anatomy' || prev.mode === 'anatomy-dark';
      const backgroundOverride: Partial<BackgroundSettings> =
        mode === 'anatomy'
          ? { shader: 'anatomy-spine', enabled: true, opacity: 0.09 }
          : mode === 'anatomy-dark'
          ? { shader: 'anatomy-spine', enabled: true, opacity: 0.12 }
          : fromAnatomy
          ? { shader: 'liquid-metal', enabled: true, opacity: 0.4 }
          : {};
      const next = {
        ...prev,
        mode,
        background: { ...prev.background, ...backgroundOverride },
      };
      saveTheme(next, userIdRef.current);
      return next;
    });
  }, []);

  const updateBackground = useCallback((partial: Partial<BackgroundSettings>) => {
    setTheme((prev) => {
      const next = { ...prev, background: { ...prev.background, ...partial } };
      saveTheme(next, userIdRef.current);
      return next;
    });
  }, []);

  const resetTheme = useCallback(() => {
    setTheme(DEFAULTS);
    saveTheme(DEFAULTS, userIdRef.current);
  }, []);

  return (
    <Ctx.Provider value={{ theme, updateBackground, setMode, resetTheme, bindUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
