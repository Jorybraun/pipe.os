/**
 * useRoleDiscoveryDraft — persistence adapter for the role discovery scripted phase.
 *
 * Isolates all storage I/O so the persistence backend is trivially swappable:
 *   - Local-only:  replace localStorage with sessionStorage
 *   - Server-side: swap load/save/clear to fetch() calls
 *   - Disabled:    return a no-op stub
 *
 * The component (RoleDiscoveryPage) calls this hook and receives {load, save, clear}.
 * It never touches storage directly.
 */

import { useCallback } from 'react';
import type { PastExchange } from './useRoleDiscovery';

// ─── Draft shape (public — imported by the page) ──────────────────────────────

export interface RoleDiscoveryDraft {
  scriptedIdx: number;
  scriptedAnswers: Record<string, string>;
  scriptedExchanges: PastExchange[];
  completed: boolean;
  defaultLiveMode: boolean;
}

// ─── Storage key ──────────────────────────────────────────────────────────────
// Change this (or scope it per-user) without touching the component.

const STORAGE_KEY = 'pipe:rd-draft';

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseRoleDiscoveryDraftResult {
  /** Load saved draft, or null if none / corrupt. */
  load: () => RoleDiscoveryDraft | null;
  /** Persist the current draft state. */
  save: (draft: RoleDiscoveryDraft) => void;
  /** Erase the saved draft. */
  clear: () => void;
}

export function useRoleDiscoveryDraft(): UseRoleDiscoveryDraftResult {
  const load = useCallback((): RoleDiscoveryDraft | null => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as RoleDiscoveryDraft;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }, []);

  const save = useCallback((draft: RoleDiscoveryDraft): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Storage quota exceeded or private-browsing block — silently ignore.
    }
  }, []);

  const clear = useCallback((): void => {
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { load, save, clear };
}
