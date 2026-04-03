/**
 * ChallengeDndContext — Shared state bridge between the DndContext wrapper
 * (which handles drag-and-drop) and StageDetailPage (which owns challenge data).
 *
 * StageDetailPage registers its challenges, stageId, and mutation functions.
 * The DndContext wrapper reads them in handleDragEnd to create/reorder challenges.
 */

import { createContext, useContext, useRef, useCallback, type ReactNode } from 'react';
import type { ChallengeItem, CreateChallengeRequest } from '../lib/api/types';

interface ChallengeDndState {
  challenges: ChallengeItem[];
  stageId: string;
  createChallenge: (stageId: string, payload: CreateChallengeRequest) => Promise<ChallengeItem>;
  reorderChallenges: (stageId: string, challenges: { id: string; order: number }[]) => Promise<void>;
  refetch: () => Promise<void>;
}

interface ChallengeDndContextValue {
  register: (state: ChallengeDndState) => void;
  getState: () => ChallengeDndState | null;
}

const Context = createContext<ChallengeDndContextValue | null>(null);

export function ChallengeDndProvider({ children }: { children: ReactNode }): JSX.Element {
  const stateRef = useRef<ChallengeDndState | null>(null);

  const register = useCallback((state: ChallengeDndState) => {
    stateRef.current = state;
  }, []);

  const getState = useCallback((): ChallengeDndState | null => {
    return stateRef.current;
  }, []);

  return (
    <Context.Provider value={{ register, getState }}>
      {children}
    </Context.Provider>
  );
}

/**
 * Called by StageDetailPage to register its challenge state.
 */
export function useRegisterChallengeList(state: ChallengeDndState): void {
  const ctx = useContext(Context);
  // Register on every render so the ref is always fresh
  ctx?.register(state);
}

/**
 * Called by the DndContext wrapper to read challenge state in handleDragEnd.
 */
export function useChallengeDndState(): () => ChallengeDndState | null {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useChallengeDndState must be used within ChallengeDndProvider');
  return ctx.getState;
}
