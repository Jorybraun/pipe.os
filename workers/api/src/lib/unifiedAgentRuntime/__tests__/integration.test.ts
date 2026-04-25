import { describe, it, expect, beforeEach } from 'vitest';
import { registerAllPlugins } from '../../agents';
import { clearPlugins } from '../pluginRegistry';
import { InMemorySessionStore } from '../sessionStore';
import { getPlugin, createFSM, runEvalGate, scoreSession } from '../';
import type { AgentTurn } from '../types';

function makeTurn(i: number): AgentTurn {
  return {
    idx: i,
    questionText: `q${i}`,
    timestamp: 't',
    questionId: undefined,
    candidateResponse: undefined,
    metadata: undefined,
  };
}

describe('Unified Agent Runtime — Swarm Integration', () => {
  beforeEach(() => {
    clearPlugins();
    registerAllPlugins();
  });

  it('registers all three agent plugins', () => {
    expect(getPlugin('role_discovery').type).toBe('role_discovery');
    expect(getPlugin('code_review').type).toBe('code_review');
    expect(getPlugin('culture_interview').type).toBe('culture_interview');
  });

  it('role discovery terminates after budget turns', async () => {
    const plugin = getPlugin('role_discovery');
    const fsm = createFSM(plugin.fsmConfig);
    const store = new InMemorySessionStore();
    const session = await store.createSession('role_discovery', undefined, undefined);

    // Move past consent
    session.state = 'in_progress';
    session.consentAt = new Date().toISOString();
    session.transcript.scratchpad.questionBudget = 3;

    // Below budget → in_progress
    session.transcript.turns = [makeTurn(0), makeTurn(1)];
    expect(fsm.nextState(session)).toBe('in_progress');

    // At budget → scoring
    session.transcript.turns.push(makeTurn(2));
    expect(fsm.nextState(session)).toBe('scoring');
  });

  it('code review terminates on verdict', async () => {
    const plugin = getPlugin('code_review');
    const fsm = createFSM(plugin.fsmConfig);
    const store = new InMemorySessionStore();
    const session = await store.createSession('code_review', undefined, undefined);

    // Move past consent
    session.state = 'in_progress';
    session.consentAt = new Date().toISOString();

    // No verdict, below minTurns → in_progress
    session.transcript.turns = [makeTurn(0)];
    expect(fsm.nextState(session)).toBe('in_progress');

    // Verdict reached + minTurns met → scoring
    session.transcript.scratchpad.verdictReached = true;
    session.transcript.turns.push(makeTurn(1), makeTurn(2));
    expect(fsm.nextState(session)).toBe('scoring');
  });

  it('generates a turn for each agent type', async () => {
    const store = new InMemorySessionStore();

    for (const type of ['role_discovery', 'code_review', 'culture_interview'] as const) {
      const plugin = getPlugin(type);
      const session = await store.createSession(type, undefined, undefined);
      const turn = await plugin.generateTurn(session, {}, null);
      expect(turn.questionText.toLowerCase()).toContain(type.replace('_', ' '));
      expect(turn.idx).toBe(0);
    }
  });

  it('eval gate short-circuits with null provider', async () => {
    const plugin = getPlugin('role_discovery');
    const store = new InMemorySessionStore();
    const session = await store.createSession('role_discovery', undefined, undefined);
    const turn: AgentTurn = {
      idx: 0,
      questionText: 'Hello?',
      timestamp: 't',
      questionId: undefined,
      candidateResponse: undefined,
      metadata: undefined,
    };

    const result = await runEvalGate(null, turn, session, plugin.evalConfig!);
    expect(result.approved).toBe(true);
  });

  it('scorer short-circuits with null provider', async () => {
    const plugin = getPlugin('code_review');
    const store = new InMemorySessionStore();
    const session = await store.createSession('code_review', undefined, undefined);

    const report = await scoreSession(null, session, plugin.scoringConfig!);
    expect(report.dimensions).toHaveLength(0);
  });

  it('full role discovery flow: consent → interview → scoring', async () => {
    const plugin = getPlugin('role_discovery');
    const store = new InMemorySessionStore();
    let session = await store.createSession('role_discovery', undefined, undefined);

    // 1. Consent
    expect(session.state).toBe('consent');
    session = await store.updateSession(session.id, {
      consentAt: new Date().toISOString(),
    });

    const fsm = createFSM(plugin.fsmConfig);
    session = await store.updateSession(session.id, {
      state: fsm.nextState({ ...session, state: 'consent' }),
    });
    expect(session.state).toBe('in_progress');

    // 2. Interview turns
    session.transcript.scratchpad.questionBudget = 2;
    session = await store.updateSession(session.id, { transcript: session.transcript });

    for (let i = 0; i < 2; i++) {
      const current = await store.getSession(session.id);
      const turn = await plugin.generateTurn(current!, {}, null);
      await store.appendTurn(session.id, turn);
    }

    const finalSession = await store.getSession(session.id);
    const finalState = fsm.nextState(finalSession!);
    expect(finalState).toBe('scoring');
  });
});
