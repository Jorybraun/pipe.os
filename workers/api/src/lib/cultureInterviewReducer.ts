/**
 * Culture Interview — Pure Reducer (zero LLM, zero side effects).
 *
 * 100% immutable. Every action returns a new state object.
 */

import type { InterviewStateV2, InterviewAction, CultureTurnV2 } from './cultureInterviewState';
import { recomputeCoverage } from './cultureInterviewState';

export function cultureInterviewReducer(
  state: InterviewStateV2,
  action: InterviewAction,
): InterviewStateV2 {
  switch (action.type) {
    case 'START': {
      const now = Date.now();
      return {
        ...state,
        phase: 'rapport_building',
        phaseHistory: [
          ...state.phaseHistory,
          { phase: 'rapport_building', enteredAt: now },
        ],
      };
    }

    case 'ANSWER': {
      const turns = state.turns.map((t, i) =>
        i === action.turnIndex
          ? {
              ...t,
              candidateResponse: action.answer,
              starSlots: action.starSlots,
              phase: t.phase ?? state.phase,
            }
          : t,
      );
      const next: InterviewStateV2 = {
        ...state,
        turns,
      };
      const coverage = recomputeCoverage(next);
      return {
        ...next,
        coverage,
        scratchpad: {
          ...next.scratchpad,
          dimensionCoverage: coverageToRecord(coverage),
        },
      };
    }

    case 'DRILL': {
      return {
        ...state,
        currentDrill: {
          targetTurnIndex: action.targetTurnIndex,
          attempts: 0,
          maxAttempts: state.config.maxDrills,
        },
      };
    }

    case 'DRILL_ANSWER': {
      // Find the last pending turn and update it with the drill answer.
      const pendingIdx = findLastPendingTurnIndex(state.turns);
      let turns: CultureTurnV2[];
      if (pendingIdx >= 0) {
        turns = state.turns.map((t, i) =>
          i === pendingIdx
            ? {
                ...t,
                candidateResponse: action.answer,
                starSlots: action.starSlots,
                phase: t.phase ?? 'drilling',
              }
            : t,
        );
      } else {
        // No pending turn found — defensive append. Should not happen in normal flow.
        turns = [
          ...state.turns,
          {
            idx: state.turns.length,
            questionId: `drill-${state.currentDrill?.targetTurnIndex ?? 0}`,
            questionText: '',
            probeOf: state.currentDrill?.targetTurnIndex != null
              ? state.turns[state.currentDrill.targetTurnIndex]?.questionId ?? null
              : null,
            candidateResponse: action.answer,
            starSlots: action.starSlots,
            timestamp: new Date().toISOString(),
            phase: 'drilling',
          },
        ];
      }
      const next: InterviewStateV2 = {
        ...state,
        turns,
        currentDrill: state.currentDrill
          ? { ...state.currentDrill, attempts: state.currentDrill.attempts + 1 }
          : null,
      };
      const coverage = recomputeCoverage(next);
      return {
        ...next,
        coverage,
        scratchpad: {
          ...next.scratchpad,
          dimensionCoverage: coverageToRecord(coverage),
        },
      };
    }

    case 'ADVANCE_PHASE': {
      const now = Date.now();
      return {
        ...state,
        phase: action.nextPhase,
        phaseHistory: [
          ...state.phaseHistory,
          { phase: action.nextPhase, enteredAt: now },
        ],
        currentDrill:
          action.nextPhase === 'probing' ? null : state.currentDrill,
      };
    }

    case 'SCORE_COMPLETE': {
      return {
        ...state,
        phase: 'complete',
        pendingNodes: [],
      };
    }

    case 'NODES_PERSISTED': {
      return {
        ...state,
        pendingNodes: [],
      };
    }

    default:
      return state;
  }
}

function findLastPendingTurnIndex(turns: CultureTurnV2[]): number {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]!.candidateResponse === null) return i;
  }
  return -1;
}

function coverageToRecord(
  coverage: InterviewStateV2['coverage'],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const dim of coverage.dimensions) {
    out[dim.dimension] = dim.depthScore;
  }
  return out;
}
