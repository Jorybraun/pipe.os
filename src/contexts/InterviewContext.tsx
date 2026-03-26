import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import type { StageConfig, ChallengeNode, RunState } from '../lib/challenge/types';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface InterviewState {
  // Stage config
  stageConfig: StageConfig;

  // Current challenge (derived from stageConfig + currentIndex)
  currentChallenge: ChallengeNode;
  currentIndex: number;
  isLastChallenge: boolean;

  // Submission (local state — panel writes go here)
  submission: Record<string, unknown>;
  updateSubmission: (patch: Record<string, unknown>) => void;

  // Navigation
  canAdvance: boolean;
  submit: () => void;

  // Run state (CODE_IMPLEMENTATION)
  runState: RunState;
  setRunState: (state: RunState) => void;
}

const InterviewContext = createContext<InterviewState | undefined>(undefined);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInterview(): InterviewState {
  const ctx = useContext(InterviewContext);
  if (!ctx) throw new Error('useInterview must be used within InterviewProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
//
// Navigation is CONTROLLED — currentIndex comes from the parent (useAssessment).
// The provider owns submission state for the current challenge. When the
// challenge changes (currentIndex prop changes), submission resets from
// the node's initialSubmission.
// ---------------------------------------------------------------------------

interface InterviewProviderProps {
  stageConfig: StageConfig;
  /** Controlled by parent (useAssessment manages navigation) */
  currentIndex: number;
  /** Called when candidate submits — parent handles API + navigation */
  onSubmit: (submission: Record<string, unknown>) => void;
  /** Called when submission changes — parent uses for external state sync */
  onSubmissionChange?: (submission: Record<string, unknown>) => void;
  children: ReactNode;
}

export function InterviewProvider({
  stageConfig,
  currentIndex,
  onSubmit,
  onSubmissionChange,
  children,
}: InterviewProviderProps): JSX.Element {
  const currentChallenge: ChallengeNode = stageConfig.challenges[currentIndex] ?? stageConfig.challenges[0]!;
  const isLastChallenge = currentIndex === stageConfig.challenges.length - 1;

  const [submission, setSubmission] = useState<Record<string, unknown>>(
    () => ({ ...currentChallenge.initialSubmission }),
  );
  const [runState, setRunState] = useState<RunState>({ status: 'idle', logs: [] });

  // Reset submission when challenge changes
  useEffect(() => {
    setSubmission({ ...currentChallenge.initialSubmission });
    setRunState({ status: 'idle', logs: [] });
  }, [currentChallenge.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSubmission = useCallback((patch: Record<string, unknown>) => {
    setSubmission((prev) => {
      const next = { ...prev, ...patch };
      onSubmissionChange?.(next);
      return next;
    });
  }, [onSubmissionChange]);

  const canAdvance = currentChallenge.isComplete(submission);

  const submit = useCallback(() => {
    onSubmit(submission);
  }, [onSubmit, submission]);

  const value = useMemo<InterviewState>(() => ({
    stageConfig,
    currentChallenge,
    currentIndex,
    isLastChallenge,
    submission,
    updateSubmission,
    canAdvance,
    submit,
    runState,
    setRunState,
  }), [
    stageConfig, currentChallenge, currentIndex, isLastChallenge,
    submission, updateSubmission, canAdvance, submit, runState,
  ]);

  return (
    <InterviewContext.Provider value={value}>
      {children}
    </InterviewContext.Provider>
  );
}
