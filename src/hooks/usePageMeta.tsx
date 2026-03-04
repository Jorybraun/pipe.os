import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/**
 * Lightweight context for sharing page-level metadata with the SubHeader
 * so it doesn't need to make redundant API calls. Pages call setPageMeta()
 * after fetching their data; SubHeader reads it.
 */
interface PageMeta {
  title: string;
  candidateCount: number;
}

interface PageMetaContextValue {
  meta: PageMeta;
  setPageMeta: (meta: Partial<PageMeta>) => void;
  resetPageMeta: () => void;
}

const DEFAULT_META: PageMeta = { title: 'PIPE_OS', candidateCount: 0 };

const PageMetaContext = createContext<PageMetaContextValue>({
  meta: DEFAULT_META,
  setPageMeta: () => {},
  resetPageMeta: () => {},
});

export function PageMetaProvider({ children }: { children: ReactNode }): JSX.Element {
  const [meta, setMeta] = useState<PageMeta>(DEFAULT_META);

  const setPageMeta = useCallback((partial: Partial<PageMeta>) => {
    setMeta(prev => ({ ...prev, ...partial }));
  }, []);

  const resetPageMeta = useCallback(() => {
    setMeta(DEFAULT_META);
  }, []);

  return (
    <PageMetaContext.Provider value={{ meta, setPageMeta, resetPageMeta }}>
      {children}
    </PageMetaContext.Provider>
  );
}

export function usePageMeta(): PageMetaContextValue {
  return useContext(PageMetaContext);
}
