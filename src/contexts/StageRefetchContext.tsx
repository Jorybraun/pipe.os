/**
 * StageRefetchContext — Lets sibling components trigger a stage data refetch.
 *
 * StageDetailPage registers its refetch function.
 * StageConfigPanel (in Layout aside) calls it after mutations.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface StageRefetchContextValue {
  /** Register a refetch function (called by StageDetailPage) */
  registerRefetch: (fn: () => Promise<void>) => void;
  /** Trigger the registered refetch (called by StageConfigPanel) */
  triggerRefetch: () => Promise<void>;
}

const Context = createContext<StageRefetchContextValue | null>(null);

export function StageRefetchProvider({ children }: { children: ReactNode }): JSX.Element {
  const [refetchFn, setRefetchFn] = useState<(() => Promise<void>) | null>(null);

  const registerRefetch = useCallback((fn: () => Promise<void>) => {
    setRefetchFn(() => fn);
  }, []);

  const triggerRefetch = useCallback(async () => {
    if (refetchFn) await refetchFn();
  }, [refetchFn]);

  return (
    <Context.Provider value={{ registerRefetch, triggerRefetch }}>
      {children}
    </Context.Provider>
  );
}

export function useStageRefetch(): StageRefetchContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useStageRefetch must be used within StageRefetchProvider');
  return ctx;
}
