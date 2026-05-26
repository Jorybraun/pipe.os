/**
 * Culture Interview — Deterministic Phase Controller (zero LLM).
 *
 * Given the current v2 state, returns the next phase and a human-readable
 * reason. All decisions are based on turn counts, coverage, and drill budget.
 */

import type { InterviewStateV2, InterviewPhase } from './cultureInterviewState';

export interface PhaseDirective {
  nextPhase: InterviewPhase;
  reason: string;
}

function seedQuestionsAsked(state: InterviewStateV2): number {
  const ids = new Set<string>();
  for (const turn of state.turns) {
    if (turn.probeOf === null) ids.add(turn.questionId);
  }
  return ids.size;
}

function rapportTurnsCount(state: InterviewStateV2): number {
  return state.turns.filter((t) => t.phase === 'rapport_building' && t.probeOf === null).length;
}

function wrapUpTurnsCount(state: InterviewStateV2): number {
  return state.turns.filter((t) => t.phase === 'wrap_up' && t.probeOf === null).length;
}

export function buildPhaseDirective(state: InterviewStateV2): PhaseDirective {
  const { phase, currentDrill, coverage, config } = state;
  const seeds = seedQuestionsAsked(state);

  switch (phase) {
    case 'rapport_building': {
      if (rapportTurnsCount(state) >= 2) {
        return {
          nextPhase: 'probing',
          reason: 'Rapport building complete (2 turns).',
        };
      }
      return {
        nextPhase: 'rapport_building',
        reason: 'Still in rapport building.',
      };
    }

    case 'probing': {
      if (currentDrill) {
        return {
          nextPhase: 'drilling',
          reason: 'Active drill in progress.',
        };
      }
      if (seeds >= config.maxQuestions) {
        return {
          nextPhase: 'wrap_up',
          reason: `Hard cap reached (${seeds}/${config.maxQuestions}).`,
        };
      }
      if (seeds >= config.minQuestions && coverage.isComplete) {
        return {
          nextPhase: 'wrap_up',
          reason: `Coverage complete after ${seeds} questions.`,
        };
      }
      return {
        nextPhase: 'probing',
        reason: 'Continue probing.',
      };
    }

    case 'drilling': {
      if (currentDrill && currentDrill.attempts >= currentDrill.maxAttempts) {
        return {
          nextPhase: 'probing',
          reason: `Drill max attempts reached (${currentDrill.attempts}/${currentDrill.maxAttempts}).`,
        };
      }
      return {
        nextPhase: 'drilling',
        reason: 'Continue drilling.',
      };
    }

    case 'wrap_up': {
      if (wrapUpTurnsCount(state) >= 2) {
        return {
          nextPhase: 'scoring',
          reason: 'Wrap-up complete (2 turns).',
        };
      }
      return {
        nextPhase: 'wrap_up',
        reason: 'Still in wrap-up.',
      };
    }

    case 'scoring':
    case 'complete':
      return {
        nextPhase: phase,
        reason: 'Terminal phase.',
      };

    case 'consent':
      return {
        nextPhase: 'rapport_building',
        reason: 'Begin interview.',
      };

    default:
      return {
        nextPhase: 'probing',
        reason: 'Unknown phase; default to probing.',
      };
  }
}
