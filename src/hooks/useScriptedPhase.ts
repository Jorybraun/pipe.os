/**
 * useScriptedPhase — owns the scripted-question state machine for Role Discovery.
 *
 * Extracted from RoleDiscoveryPage to keep the page focused on rendering and
 * cross-phase orchestration. The hook tracks index / answer / exchanges and
 * persists them via `useRoleDiscoveryDraft`. It never touches init config,
 * pipeline creation, or the AI conversation — those remain on the page, which
 * wires callbacks into the hook.
 *
 * Boundaries:
 *   - Hook owns:   scriptedIdx, scriptedAnswer, scriptedAnswers, scriptedExchanges,
 *                  draft persistence, migration of legacy drafts (sq-mode stripping).
 *   - Hook emits:  onFire (interview can start now), onJdImport (page sets initConfig),
 *                  onLiveEnd (page clears initConfig), onResumeDraftFound (page shows prompt).
 *   - Page owns:   initConfig, defaultLiveMode, TTS, resume UI, pipeline creation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FEATURE_FLAGS } from '../config/featureFlags';
import { useRoleDiscoveryDraft } from './useRoleDiscoveryDraft';
import type { PastExchange } from './useRoleDiscovery';
import type { RoleDiscoveryDraft } from './useRoleDiscoveryDraft';
import type { RoleContextBaseline, ParseJDResponse } from '../lib/api/types';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface ScriptedQuestion {
  id: string;
  text: string;
  optional: boolean;
  placeholder: string;
  inputType?: 'text' | 'tags' | 'choice';
  options?: string[];
}

export interface RolePreset {
  label: string;
  answers: Partial<Record<string, string>>;
}

// ─── Scripted question definitions ────────────────────────────────────────────

const BASELINE_SCRIPTED: ScriptedQuestion[] = [
  {
    id: 'sq-title',
    text: 'What role are you hiring for?',
    optional: false,
    placeholder: 'e.g., Senior Backend Engineer, Head of Product...',
  },
  {
    id: 'sq-company',
    text: 'What company is this for?',
    optional: true,
    placeholder: 'Acme Corp',
  },
  {
    id: 'sq-url',
    text: "Got a company website? I'll research it before asking questions.",
    optional: true,
    placeholder: 'https://acme.com',
  },
  {
    id: 'sq-salary',
    text: "What's the comp range?",
    optional: true,
    placeholder: 'e.g., $150K–$180K base + equity',
  },
  {
    id: 'sq-stack',
    text: 'What technologies do they need on day one?',
    optional: true,
    placeholder: 'e.g., React, TypeScript, PostgreSQL',
    inputType: 'tags',
  },
];

const MODE_QUESTION: ScriptedQuestion = {
  id: 'sq-mode',
  text: 'How do you want to run this interview?',
  optional: false,
  placeholder: '',
  inputType: 'choice',
  options: ['Voice', 'Text'],
};

// sq-mode is only present when the live-voice feature flag is on; otherwise
// the interview always runs in text mode and the mode picker is skipped.
export const SCRIPTED: ScriptedQuestion[] = FEATURE_FLAGS.FEATURE_FLAG_LIVE_VOICE
  ? [...BASELINE_SCRIPTED, MODE_QUESTION]
  : BASELINE_SCRIPTED;

const MODE_Q_IDX = SCRIPTED.findIndex((q) => q.id === 'sq-mode');

// ─── Baseline builder (shared with page's resume path) ────────────────────────

/**
 * Build a `RoleContextBaseline` from a flat `answers` map. Used both when
 * firing the AI interview fresh and when resuming from a saved draft.
 */
export function buildBaseline(answers: Record<string, string>): RoleContextBaseline {
  const techTags = (answers['sq-stack'] ?? '').split('|||').filter(Boolean);
  return {
    title: answers['sq-title']?.trim() || '',
    ...(answers['sq-company']?.trim() ? { companyName: answers['sq-company'].trim() } : {}),
    ...(answers['sq-url']?.trim() ? { companyUrl: answers['sq-url'].trim() } : {}),
    ...(answers['sq-salary']?.trim() ? { salaryRange: answers['sq-salary'].trim() } : {}),
    ...(techTags.length > 0 ? { techStack: techTags } : {}),
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseScriptedPhaseArgs {
  /** Fires the AI interview with the completed answers + live-mode hint. */
  onFire: (answers: Record<string, string>, liveMode: boolean) => void;
  /** Fires after JD import parses — page sets initConfig from the baseline. */
  onJdImport: (baseline: RoleContextBaseline) => void;
  /** Called on every state transition so page-owned TTS can cancel playback. */
  ttsCancel: () => void;
  /** Called when the hook needs the page to clear interview-level state
   *  (`initConfig`, `defaultLiveMode`). Fired from `resetToMode` and `startOver`. */
  clearInterview: () => void;
  /** Called on mount when a COMPLETE draft is found — page shows resume prompt. */
  onResumeDraftFound: (draft: RoleDiscoveryDraft) => void;
}

export interface UseScriptedPhaseResult {
  idx: number;
  answer: string;
  setAnswer: (value: string) => void;
  answers: Record<string, string>;
  exchanges: PastExchange[];
  currentQuestion: ScriptedQuestion | null;
  hasProgress: boolean;
  /** True once every scripted question has been captured in an exchange. */
  isComplete: boolean;

  back: () => void;
  submit: () => void;
  skip: () => void;
  choiceSelect: (choice: string) => void;
  presetSelect: (preset: RolePreset) => void;
  jdImport: (parsed: ParseJDResponse['parsed']) => void;
  resetToMode: () => void;
  startOver: () => void;
  /** Update a previously captured answer without advancing the scripted flow. */
  editAnswer: (qId: string, newRaw: string) => void;
}

interface DraftWrite {
  idx: number;
  answers: Record<string, string>;
  exchanges: PastExchange[];
  completed?: boolean;
  defaultLiveMode?: boolean;
}

export function useScriptedPhase(args: UseScriptedPhaseArgs): UseScriptedPhaseResult {
  const { onFire, onJdImport, ttsCancel, clearInterview, onResumeDraftFound } = args;
  const draft = useRoleDiscoveryDraft();

  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [exchanges, setExchanges] = useState<PastExchange[]>([]);

  // Stable ref to the consumer callbacks — avoids re-running the mount effect
  // if the page re-creates them without useCallback.
  const onResumeDraftFoundRef = useRef(onResumeDraftFound);
  useEffect(() => { onResumeDraftFoundRef.current = onResumeDraftFound; }, [onResumeDraftFound]);

  // Guard: the mount-time draft restore must run exactly once per page load,
  // even if `draft`'s identity briefly destabilises. Re-running fires
  // `onResumeDraftFound` again, which brings the "resume?" banner back after
  // the user already dismissed it.
  const hasRestoredRef = useRef(false);

  // ── Draft persistence helper — collapses the 10+ repeated save shapes ──
  const persistDraft = useCallback((next: DraftWrite): void => {
    draft.save({
      scriptedIdx: next.idx,
      scriptedAnswers: next.answers,
      scriptedExchanges: next.exchanges,
      completed: next.completed ?? false,
      defaultLiveMode: next.defaultLiveMode ?? false,
    });
  }, [draft]);

  // ── Restore draft on mount ──
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    const saved = draft.load();
    if (!saved) return;
    // Migrate drafts written before the live-voice feature flag landed: strip
    // sq-mode remnants and clamp scriptedIdx so we can't point at a question
    // that no longer exists in SCRIPTED.
    const migratedAnswers = { ...saved.scriptedAnswers };
    if (!FEATURE_FLAGS.FEATURE_FLAG_LIVE_VOICE) delete migratedAnswers['sq-mode'];
    const migratedExchanges = FEATURE_FLAGS.FEATURE_FLAG_LIVE_VOICE
      ? saved.scriptedExchanges
      : saved.scriptedExchanges.filter((ex) => ex.questionId !== 'sq-mode');
    const clampedIdx = Math.min(saved.scriptedIdx, Math.max(0, SCRIPTED.length - 1));
    setIdx(clampedIdx);
    setAnswers(migratedAnswers);
    setExchanges(migratedExchanges);
    if (saved.completed) {
      onResumeDraftFoundRef.current({
        ...saved,
        scriptedIdx: clampedIdx,
        scriptedAnswers: migratedAnswers,
        scriptedExchanges: migratedExchanges,
      });
    }
  }, [draft]);

  // ── Back: undo the previous question's answer and exchange ──
  const back = useCallback((): void => {
    if (idx <= 0) return;
    const prevIdx = idx - 1;
    const prevQ = SCRIPTED[prevIdx];
    if (!prevQ) return;
    const prevAnswer = answers[prevQ.id] ?? '';
    const prevExchanges = exchanges.slice(0, -1);
    const prevAnswers = { ...answers };
    delete prevAnswers[prevQ.id];

    setIdx(prevIdx);
    setExchanges(prevExchanges);
    setAnswers(prevAnswers);
    setAnswer(prevAnswer);
    persistDraft({ idx: prevIdx, answers: prevAnswers, exchanges: prevExchanges });
  }, [idx, answers, exchanges, persistDraft]);

  // ── Helper: append answer + exchange for the current question, then advance ──
  const advanceAfterAnswer = useCallback((displayAnswer: string, rawAnswer: string, liveMode: boolean): void => {
    const q = SCRIPTED[idx];
    if (!q) return;
    const newExchanges: PastExchange[] = [
      ...exchanges,
      { questionId: q.id, acknowledgment: '', questionText: q.text, answer: displayAnswer },
    ];
    const newAnswers = { ...answers, [q.id]: rawAnswer };

    setExchanges(newExchanges);
    setAnswers(newAnswers);
    setAnswer('');

    if (idx < SCRIPTED.length - 1) {
      const nextIdx = idx + 1;
      setIdx(nextIdx);
      persistDraft({ idx: nextIdx, answers: newAnswers, exchanges: newExchanges });
    } else {
      persistDraft({ idx, answers: newAnswers, exchanges: newExchanges, completed: true, defaultLiveMode: liveMode });
      onFire(newAnswers, liveMode);
    }
  }, [idx, answers, exchanges, persistDraft, onFire]);

  // ── Submit: user pressed Enter or SEND on a text/tags question ──
  const submit = useCallback((): void => {
    const q = SCRIPTED[idx];
    if (!q) return;
    if (!q.optional && !answer.trim()) return;
    ttsCancel();

    const displayAnswer = q.inputType === 'tags'
      ? (answer.split('|||').filter(Boolean).join(', ') || '(skipped)')
      : (answer.trim() || '(skipped)');
    advanceAfterAnswer(displayAnswer, answer, false);
  }, [idx, answer, ttsCancel, advanceAfterAnswer]);

  // ── Skip: optional question, record as skipped ──
  const skip = useCallback((): void => {
    const q = SCRIPTED[idx];
    if (!q?.optional) return;
    ttsCancel();
    advanceAfterAnswer('(skipped)', '', false);
  }, [idx, ttsCancel, advanceAfterAnswer]);

  // ── Choice select: sq-mode (Voice / Text) ──
  const choiceSelect = useCallback((choice: string): void => {
    const q = SCRIPTED[idx];
    if (!q) return;
    ttsCancel();
    advanceAfterAnswer(choice, choice, choice === 'Voice');
  }, [idx, ttsCancel, advanceAfterAnswer]);

  // ── Preset select: fill baseline answers, jump to mode picker or fire ──
  const presetSelect = useCallback((preset: RolePreset): void => {
    const presetExchanges: PastExchange[] = SCRIPTED
      .filter((q) => q.id !== 'sq-mode')
      .map((q) => {
        const raw = preset.answers[q.id] ?? '';
        const display = q.inputType === 'tags'
          ? (raw.split('|||').filter(Boolean).join(', ') || '(skipped)')
          : (raw.trim() || '(skipped)');
        return { questionId: q.id, acknowledgment: '', questionText: q.text, answer: display };
      });

    const presetAnswers: Record<string, string> = {};
    SCRIPTED.filter((q) => q.id !== 'sq-mode').forEach((q) => {
      presetAnswers[q.id] = preset.answers[q.id] ?? '';
    });

    setAnswers(presetAnswers);
    setExchanges(presetExchanges);
    setAnswer('');

    if (FEATURE_FLAGS.FEATURE_FLAG_LIVE_VOICE) {
      setIdx(MODE_Q_IDX);
      persistDraft({ idx: MODE_Q_IDX, answers: presetAnswers, exchanges: presetExchanges });
    } else {
      // Mirror the idx into local state, not just the draft — otherwise
      // going back from INTERVIEW lands the user on Q1 with 5 past exchanges
      // visible, which looks broken.
      setIdx(SCRIPTED.length - 1);
      persistDraft({ idx: SCRIPTED.length - 1, answers: presetAnswers, exchanges: presetExchanges, completed: true });
      onFire(presetAnswers, false);
    }
  }, [persistDraft, onFire]);

  // ── JD import: replace Q1-Q3 exchanges from parsed JD and hand off to page ──
  const jdImport = useCallback((parsed: ParseJDResponse['parsed']): void => {
    const title = parsed.title ?? '';
    const companyName = parsed.companyName ?? '';
    const companyUrl = parsed.companyUrl ?? '';

    const jdExchanges: PastExchange[] = [];
    if (title) jdExchanges.push({ questionId: 'sq-title', acknowledgment: '', questionText: SCRIPTED[0]!.text, answer: title });
    if (companyName) jdExchanges.push({ questionId: 'sq-company', acknowledgment: '', questionText: SCRIPTED[1]!.text, answer: companyName });
    if (companyUrl) jdExchanges.push({ questionId: 'sq-url', acknowledgment: '', questionText: SCRIPTED[2]!.text, answer: companyUrl });
    setExchanges(jdExchanges);

    onJdImport({
      title,
      ...(companyName ? { companyName } : {}),
      ...(companyUrl ? { companyUrl } : {}),
      ...(parsed.department ? { department: parsed.department } : {}),
      ...(parsed.location ? { location: parsed.location } : {}),
    });
  }, [onJdImport]);

  // ── Reset to mode selection — keeps baseline answers, drops sq-mode ──
  const resetToMode = useCallback((): void => {
    const keptAnswers = { ...answers };
    delete keptAnswers['sq-mode'];
    const keptExchanges = exchanges.filter((ex) => ex.questionId !== 'sq-mode');

    setIdx(MODE_Q_IDX);
    setAnswers(keptAnswers);
    setExchanges(keptExchanges);
    setAnswer('');
    clearInterview();
    persistDraft({ idx: MODE_Q_IDX, answers: keptAnswers, exchanges: keptExchanges });
  }, [answers, exchanges, clearInterview, persistDraft]);

  // ── Start over: clear draft and reset to Q1 ──
  const startOver = useCallback((): void => {
    draft.clear();
    setIdx(0);
    setAnswers({});
    setExchanges([]);
    setAnswer('');
    clearInterview();
  }, [draft, clearInterview]);

  // ── Edit an already-answered question in place ──
  // Used by the "review & edit" view when the user goes back to ROLE after the
  // scripted phase is complete. Updates the answer, rewrites the matching
  // exchange's display text, and persists — without touching idx.
  const editAnswer = useCallback((qId: string, newRaw: string): void => {
    const q = SCRIPTED.find((x) => x.id === qId);
    if (!q) return;
    const display = q.inputType === 'tags'
      ? (newRaw.split('|||').filter(Boolean).join(', ') || '(skipped)')
      : (newRaw.trim() || '(skipped)');
    const newAnswers = { ...answers, [qId]: newRaw };
    const newExchanges = exchanges.map((ex) =>
      ex.questionId === qId ? { ...ex, answer: display } : ex,
    );
    setAnswers(newAnswers);
    setExchanges(newExchanges);
    persistDraft({ idx, answers: newAnswers, exchanges: newExchanges, completed: true });
  }, [answers, exchanges, idx, persistDraft]);

  const currentQuestion: ScriptedQuestion | null = SCRIPTED[idx] ?? null;
  const hasProgress = idx > 0 || Object.keys(answers).length > 0;
  // `isComplete` means every scripted question has been captured in an exchange
  // — the canonical "scripted phase is done" signal used by the page to switch
  // between linear-ask mode and review/edit mode.
  const isComplete = exchanges.length >= SCRIPTED.length;

  return {
    idx,
    answer,
    setAnswer,
    answers,
    exchanges,
    currentQuestion,
    hasProgress,
    isComplete,
    back,
    submit,
    skip,
    choiceSelect,
    presetSelect,
    jdImport,
    resetToMode,
    startOver,
    editAnswer,
  };
}
