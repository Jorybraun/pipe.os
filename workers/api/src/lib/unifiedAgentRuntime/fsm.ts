/**
 * Unified Agent Runtime — Finite State Machine
 *
 * Generic FSM with config-driven transition guards.
 */

import type { AgentSession, FSMConfig, SessionState } from './types';

export interface FSM {
  nextState(session: AgentSession): SessionState;
}

export function createFSM(config: FSMConfig): FSM {
  return {
    nextState(session: AgentSession): SessionState {
      const current = session.state;
      const turnCount = session.transcript.turns.length;

      // consent → in_progress (once consent is given)
      if (current === 'consent' && session.consentAt) {
        return 'in_progress';
      }

      // in_progress → scoring (when termination conditions are met)
      if (current === 'in_progress') {
        // Hard floor: must meet minTurns before any termination
        if (turnCount >= config.minTurns && config.canTerminate(session)) {
          return 'scoring';
        }
        // Hard ceiling: force scoring at maxTurns regardless of canTerminate
        if (turnCount >= config.maxTurns) {
          return 'scoring';
        }
      }

      // scoring → complete
      if (current === 'scoring') {
        return 'complete';
      }

      // Default: stay in current state
      return current;
    },
  };
}
