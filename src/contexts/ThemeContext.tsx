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
  shader: 'liquid-metal' | 'heatmap';
  heatmapTheme: HeatmapColorTheme;
  opacity: number;
  speed: number;
  scale: number;
  overlay: number;
  animateForever: boolean;
}

// ── Full theme ──────────────────────────────────────────────────────────────

export type ThemeMode = 'dark' | 'light';

export interface ThemeSettings {
  mode: ThemeMode;
  background: BackgroundSettings;
}

const DEFAULTS: ThemeSettings = {
  mode: 'dark',
  background: {
    enabled: true,
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
    '--pipe-overlay': 'rgba(21, 21, 27, 0.93)',
    '--pipe-shadow': 'rgba(0,0,0,0.3)',
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
    '--pipe-overlay': 'rgba(245, 245, 247, 0.88)',
    '--pipe-shadow': 'rgba(0,0,0,0.08)',
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
      const next = { ...prev, mode };
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
