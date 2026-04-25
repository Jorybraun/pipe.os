import { describe, it, expect } from 'vitest';
import { createFSM } from '../fsm';
import type { AgentSession, FSMConfig } from '../types';

function makeTurn(i: number): AgentSession['transcript']['turns'][number] {
  return {
    idx: i,
    questionText: `q${i}`,
    timestamp: 't',
    questionId: undefined,
    candidateResponse: undefined,
    metadata: undefined,
  };
}

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'test-1',
    agentType: 'role_discovery',
    state: 'in_progress',
    transcript: { turns: [], scratchpad: {} },
    evalResults: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    challengeId: undefined,
    candidateId: undefined,
    consentAt: undefined,
    scoreReport: undefined,
    ...overrides,
  };
}

describe('createFSM', () => {
  it('moves consent → in_progress when consentAt is set', () => {
    const fsm = createFSM({ canAdvance: () => true, canTerminate: () => false, minTurns: 1, maxTurns: 10 });
    const session = makeSession({ state: 'consent', consentAt: new Date().toISOString() });
    expect(fsm.nextState(session)).toBe('in_progress');
  });

  it('stays in consent when consentAt is missing', () => {
    const fsm = createFSM({ canAdvance: () => true, canTerminate: () => false, minTurns: 1, maxTurns: 10 });
    const session = makeSession({ state: 'consent' });
    expect(fsm.nextState(session)).toBe('consent');
  });

  it('stays in_progress when below minTurns', () => {
    const fsm = createFSM({ canAdvance: () => true, canTerminate: () => true, minTurns: 3, maxTurns: 10 });
    const session = makeSession({ transcript: { turns: [makeTurn(0)], scratchpad: {} } });
    expect(fsm.nextState(session)).toBe('in_progress');
  });

  it('moves in_progress → scoring when canTerminate and minTurns met', () => {
    const fsm = createFSM({ canAdvance: () => true, canTerminate: () => true, minTurns: 2, maxTurns: 10 });
    const session = makeSession({
      transcript: {
        turns: [makeTurn(0), makeTurn(1)],
        scratchpad: {},
      },
    });
    expect(fsm.nextState(session)).toBe('scoring');
  });

  it('forces scoring at maxTurns regardless of canTerminate', () => {
    const fsm = createFSM({ canAdvance: () => true, canTerminate: () => false, minTurns: 1, maxTurns: 3 });
    const session = makeSession({
      transcript: {
        turns: [makeTurn(0), makeTurn(1), makeTurn(2)],
        scratchpad: {},
      },
    });
    expect(fsm.nextState(session)).toBe('scoring');
  });

  it('moves scoring → complete', () => {
    const fsm = createFSM({ canAdvance: () => true, canTerminate: () => true, minTurns: 1, maxTurns: 10 });
    const session = makeSession({ state: 'scoring' });
    expect(fsm.nextState(session)).toBe('complete');
  });

  it('stays in complete', () => {
    const fsm = createFSM({ canAdvance: () => true, canTerminate: () => true, minTurns: 1, maxTurns: 10 });
    const session = makeSession({ state: 'complete' });
    expect(fsm.nextState(session)).toBe('complete');
  });

  it('respects agent-specific canTerminate logic', () => {
    const budget = 5;
    const fsm = createFSM({
      canAdvance: () => true,
      canTerminate: (s) => s.transcript.turns.length >= budget,
      minTurns: 1,
      maxTurns: 20,
    });

    const sessionAt4 = makeSession({
      transcript: {
        turns: Array.from({ length: 4 }, (_, i) => makeTurn(i)),
        scratchpad: {},
      },
    });
    expect(fsm.nextState(sessionAt4)).toBe('in_progress');

    const sessionAt5 = makeSession({
      transcript: {
        turns: Array.from({ length: 5 }, (_, i) => makeTurn(i)),
        scratchpad: {},
      },
    });
    expect(fsm.nextState(sessionAt5)).toBe('scoring');
  });
});
