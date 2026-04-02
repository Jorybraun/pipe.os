/**
 * ThemeContext — User-configurable display/theme settings.
 *
 * Persisted to localStorage so preferences survive page reloads.
 */

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

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

export interface ThemeSettings {
  background: BackgroundSettings;
}

const DEFAULTS: ThemeSettings = {
  background: {
    enabled: true,
    shader: 'liquid-metal',
    heatmapTheme: 'aurora',
    opacity: 0.4,
    speed: 0.3,
    scale: 0.6,
    overlay: 0.93,
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

interface ThemeContextValue {
  theme: ThemeSettings;
  updateBackground: (partial: Partial<BackgroundSettings>) => void;
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
    <Ctx.Provider value={{ theme, updateBackground, resetTheme, bindUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
