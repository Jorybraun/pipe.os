/**
 * AgentDrawerContext — global state for the copilot agent drawer.
 *
 * Any component can call openAgent() to open the drawer with optional
 * skill mode and pipeline context pre-set.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface AgentDrawerContextValue {
  isOpen: boolean;
  pipelineId: string | null;
  skillMode: string;
  openAgent: (opts?: { skillMode?: string; pipelineId?: string }) => void;
  closeAgent: () => void;
  setSkillMode: (mode: string) => void;
  setPipelineId: (id: string | null) => void;
}

const AgentDrawerContext = createContext<AgentDrawerContextValue | null>(null);

export function AgentDrawerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [skillMode, setSkillMode] = useState('general');

  const openAgent = useCallback((opts?: { skillMode?: string; pipelineId?: string }) => {
    if (opts?.pipelineId) setPipelineId(opts.pipelineId);
    if (opts?.skillMode) setSkillMode(opts.skillMode);
    setIsOpen(true);
  }, []);

  const closeAgent = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <AgentDrawerContext.Provider value={{
      isOpen,
      pipelineId,
      skillMode,
      openAgent,
      closeAgent,
      setSkillMode,
      setPipelineId,
    }}>
      {children}
    </AgentDrawerContext.Provider>
  );
}

export function useAgentDrawer(): AgentDrawerContextValue {
  const ctx = useContext(AgentDrawerContext);
  if (!ctx) throw new Error('useAgentDrawer must be used within AgentDrawerProvider');
  return ctx;
}
