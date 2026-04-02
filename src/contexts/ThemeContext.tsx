/**
 * ThemeContext — User-configurable display/theme settings.
 *
 * Persisted to localStorage so preferences survive page reloads.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// ── Background shader settings ──────────────────────────────────────────────

export interface BackgroundSettings {
  shader: 'liquid-metal' | 'heatmap';
  opacity: number;
  speed: number;
  scale: number;
}

// ── Full theme ──────────────────────────────────────────────────────────────

export interface ThemeSettings {
  background: BackgroundSettings;
}

const DEFAULTS: ThemeSettings = {
  background: {
    shader: 'liquid-metal',
    opacity: 0.4,
    speed: 0.3,
    scale: 0.6,
  },
};

const STORAGE_KEY = 'pipe-theme';

function loadTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return {
      background: { ...DEFAULTS.background, ...parsed.background },
    };
  } catch {
    return DEFAULTS;
  }
}

function saveTheme(theme: ThemeSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
}

// ── Context ─────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: ThemeSettings;
  updateBackground: (partial: Partial<BackgroundSettings>) => void;
  resetTheme: () => void;
}

const Ctx = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setTheme] = useState<ThemeSettings>(loadTheme);

  const updateBackground = useCallback((partial: Partial<BackgroundSettings>) => {
    setTheme((prev) => {
      const next = { ...prev, background: { ...prev.background, ...partial } };
      saveTheme(next);
      return next;
    });
  }, []);

  const resetTheme = useCallback(() => {
    setTheme(DEFAULTS);
    saveTheme(DEFAULTS);
  }, []);

  return (
    <Ctx.Provider value={{ theme, updateBackground, resetTheme }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
