/**
 * Culture Interview — V2 State Machine Types + Migration Helpers.
 *
 * Defines the explicit InterviewStateV2 shape, actions, and helpers to
 * reconstruct v2 state from a v1 transcript (backward compat).
 */

import type { StarSlot } from './cultureQuestionBank';
import type { CoverageState, StarCoverageTurn } from './candidateCoverage';
import { computeCoverageState } from './candidateCoverage';
import { COMPETENCY_DIMENSIONS, getQuestionById } from './cultureQuestionBank';
import { PROFILE_PROBE_DIMENSIONS, getProfileProbeById } from './profileProbeBank';

// ─── Types ───────────────────────────────────────────────────────────────────

export type InterviewPhase =
  | 'consent'
  | 'rapport_building'
  | 'probing'
  | 'drilling'
  | 'wrap_up'
  | 'scoring'
  | 'complete';

export interface CandidateNodeDraft {
  id: string;
  label: string;
  dimension: string;
  evidenceTurnIndex: number;
}

export interface ScoreReport {
  scoredAt: string;
  [key: string]: unknown;
}

export interface CultureTurnV2 {
  idx: number;
  questionId: string;
  questionText: string;
  probeOf: string | null;
  candidateResponse: string | null;
  starSlots: Record<StarSlot, { present: boolean; specificity: number }> | null;
  timestamp: string;
  phase: InterviewPhase;
}

export interface CultureScratchpadV2 {
  dimensionCoverage: Record<string, number>;
  probesUsedForCurrentQ: number;
  runningThemes: string[];
  mode?: 'profile_builder' | 'role_fit';
  questionMetadata?: Array<{
    questionText: string;
    targetDimension: string;
    personalizationAnchors: string[];
  }>;
}

export interface InterviewStateV2 {
  version: 'v2';
  turns: CultureTurnV2[];
  scratchpad: CultureScratchpadV2;
  phase: InterviewPhase;
  phaseHistory: Array<{ phase: InterviewPhase; enteredAt: number }>;
  coverage: CoverageState;
  currentDrill: { targetTurnIndex: number; attempts: number; maxAttempts: number } | null;
  pendingNodes: CandidateNodeDraft[];
  config: {
    mode: 'profile_builder' | 'role_fit';
    minQuestions: number;
    maxQuestions: number;
    maxDrills: number;
  };
}

export type InterviewAction =
  | { type: 'START' }
  | { type: 'ANSWER'; answer: string; turnIndex: number; starSlots: CultureTurnV2['starSlots'] }
  | { type: 'DRILL'; targetTurnIndex: number }
  | { type: 'DRILL_ANSWER'; answer: string; starSlots: CultureTurnV2['starSlots'] }
  | { type: 'ADVANCE_PHASE'; nextPhase: InterviewPhase }
  | { type: 'SCORE_COMPLETE'; scoreReport: ScoreReport }
  | { type: 'NODES_PERSISTED' };

// ─── V1 transcript compatibility ─────────────────────────────────────────────

export interface CultureTranscriptLike {
  turns: Array<{
    idx: number;
    questionId: string;
    questionText: string;
    probeOf: string | null;
    candidateResponse: string | null;
    starSlots: Record<StarSlot, { present: boolean; specificity: number }> | null;
    timestamp: string;
  }>;
  scratchpad: {
    dimensionCoverage: Record<string, number>;
    probesUsedForCurrentQ: number;
    runningThemes: string[];
    mode?: 'profile_builder' | 'role_fit';
    questionMetadata?: Array<{
      questionText: string;
      targetDimension: string;
      personalizationAnchors: string[];
    }>;
    /** V2 FSM fields (optional — added by culture-agent redesign). */
    phase?: InterviewPhase;
    phaseHistory?: Array<{ phase: InterviewPhase; enteredAt: number }>;
    currentDrill?: { targetTurnIndex: number; attempts: number; maxAttempts: number } | null;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTurnDimension(
  turn: { questionId: string; questionText: string },
  mode: 'profile_builder' | 'role_fit',
): string {
  if (turn.questionId.startsWith('gen-')) {
    const parts = turn.questionId.split('-');
    return parts[1] ?? 'ownership';
  }

  if (mode === 'profile_builder') {
    const probe = getProfileProbeById(turn.questionId);
    return probe?.dimension ?? 'career_history';
  }

  const q = getQuestionById(turn.questionId);
  return q?.dimensions[0] ?? 'ownership';
}

function buildCoverageTurns(
  turns: CultureTurnV2[],
  mode: 'profile_builder' | 'role_fit',
): StarCoverageTurn[] {
  const coverageTurns: StarCoverageTurn[] = [];
  for (const turn of turns) {
    if (turn.probeOf !== null || !turn.starSlots) continue;
    coverageTurns.push({
      questionId: turn.questionId,
      probeOf: turn.probeOf,
      dimension: getTurnDimension(turn, mode),
      starSlots: turn.starSlots,
    });
  }
  return coverageTurns;
}

export function recomputeCoverage(state: InterviewStateV2): CoverageState {
  const dimensions =
    state.config.mode === 'profile_builder'
      ? (PROFILE_PROBE_DIMENSIONS as string[])
      : (COMPETENCY_DIMENSIONS as string[]);
  const turns = buildCoverageTurns(state.turns, state.config.mode);
  return computeCoverageState(turns, dimensions);
}

/** Count distinct seed questions asked in the state. */
export function seedQuestionsAsked(state: InterviewStateV2): number {
  const ids = new Set<string>();
  for (const turn of state.turns) {
    if (turn.probeOf === null) ids.add(turn.questionId);
  }
  return ids.size;
}

/** Find the index of the last pending turn (candidateResponse === null). */
export function findPendingTurnIndex(state: InterviewStateV2): number {
  for (let i = state.turns.length - 1; i >= 0; i--) {
    if (state.turns[i]!.candidateResponse === null) return i;
  }
  return -1;
}

// ─── Migration: v1 → v2 ──────────────────────────────────────────────────────

export function reconstructStateFromTranscript(
  transcript: CultureTranscriptLike,
): InterviewStateV2 {
  const mode = transcript.scratchpad.mode ?? 'profile_builder';
  const dimensions =
    mode === 'profile_builder'
      ? (PROFILE_PROBE_DIMENSIONS as string[])
      : (COMPETENCY_DIMENSIONS as string[]);

  const rawScratchpad = transcript.scratchpad as Record<string, unknown>;
  const savedPhase = rawScratchpad.phase as InterviewPhase | undefined;
  const savedHistory = rawScratchpad.phaseHistory as
    | Array<{ phase: InterviewPhase; enteredAt: number }>
    | undefined;
  const savedDrill = rawScratchpad.currentDrill as
    | { targetTurnIndex: number; attempts: number; maxAttempts: number }
    | null
    | undefined;

  const turns: CultureTurnV2[] = transcript.turns.map((t) => ({
    idx: t.idx,
    questionId: t.questionId,
    questionText: t.questionText,
    probeOf: t.probeOf,
    candidateResponse: t.candidateResponse,
    starSlots: t.starSlots,
    timestamp: t.timestamp,
    phase: savedPhase ?? 'probing',
  }));

  const scratchpad: CultureScratchpadV2 = {
    dimensionCoverage: { ...transcript.scratchpad.dimensionCoverage },
    probesUsedForCurrentQ: transcript.scratchpad.probesUsedForCurrentQ,
    runningThemes: [...transcript.scratchpad.runningThemes],
    mode,
    questionMetadata: transcript.scratchpad.questionMetadata
      ? [...transcript.scratchpad.questionMetadata]
      : undefined,
  };

  const coverage = computeCoverageState(
    buildCoverageTurns(turns, mode),
    dimensions,
  );

  const phase = savedPhase ?? (turns.length === 0 ? 'consent' : 'probing');
  const phaseHistory =
    savedHistory ??
    (phase !== 'consent' ? [{ phase, enteredAt: Date.now() }] : []);
  const currentDrill = savedDrill ?? null;

  return {
    version: 'v2',
    turns,
    scratchpad,
    phase,
    phaseHistory,
    coverage,
    currentDrill,
    pendingNodes: [],
    config: {
      mode,
      minQuestions: 5,
      maxQuestions:
        mode === 'profile_builder'
          ? PROFILE_PROBE_DIMENSIONS.length
          : COMPETENCY_DIMENSIONS.length,
      maxDrills: 2,
    },
  };
}

// ─── Serialization: v2 → v1-compatible transcript ────────────────────────────

export function serializeStateToTranscript(
  state: InterviewStateV2,
): CultureTranscriptLike {
  const turns = state.turns.map((t) => ({
    idx: t.idx,
    questionId: t.questionId,
    questionText: t.questionText,
    probeOf: t.probeOf,
    candidateResponse: t.candidateResponse,
    starSlots: t.starSlots,
    timestamp: t.timestamp,
  }));

  const scratchpad: CultureTranscriptLike['scratchpad'] = {
    dimensionCoverage: { ...state.scratchpad.dimensionCoverage },
    probesUsedForCurrentQ: state.scratchpad.probesUsedForCurrentQ,
    runningThemes: [...state.scratchpad.runningThemes],
    mode: state.scratchpad.mode,
    questionMetadata: state.scratchpad.questionMetadata
      ? [...state.scratchpad.questionMetadata]
      : undefined,
    phase: state.phase,
    phaseHistory: [...state.phaseHistory],
    currentDrill: state.currentDrill,
  };

  return { turns, scratchpad };
}
