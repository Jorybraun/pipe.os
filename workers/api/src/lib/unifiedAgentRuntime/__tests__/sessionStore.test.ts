import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySessionStore } from '../sessionStore';
import type { AgentTurn } from '../types';

function makeTurn(text: string): AgentTurn {
  return {
    idx: 0,
    questionText: text,
    timestamp: '2024-01-01T00:00:00Z',
    questionId: undefined,
    candidateResponse: undefined,
    metadata: undefined,
  };
}

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it('creates a session in consent state', async () => {
    const session = await store.createSession('role_discovery', undefined, undefined);
    expect(session.id).toBeDefined();
    expect(session.agentType).toBe('role_discovery');
    expect(session.state).toBe('consent');
    expect(session.transcript.turns).toHaveLength(0);
  });

  it('gets a session by id', async () => {
    const created = await store.createSession('code_review', 'challenge-1', 'candidate-1');
    const fetched = await store.getSession(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.challengeId).toBe('challenge-1');
    expect(fetched!.candidateId).toBe('candidate-1');
  });

  it('returns null for missing session', async () => {
    const fetched = await store.getSession('nonexistent');
    expect(fetched).toBeNull();
  });

  it('updates session state', async () => {
    const created = await store.createSession('culture_interview', undefined, undefined);
    const updated = await store.updateSession(created.id, { state: 'in_progress', consentAt: new Date().toISOString() });
    expect(updated.state).toBe('in_progress');
    expect(updated.consentAt).toBeDefined();
  });

  it('throws when updating missing session', async () => {
    await expect(store.updateSession('missing', { state: 'complete' })).rejects.toThrow('Session not found');
  });

  it('appends a turn', async () => {
    const created = await store.createSession('role_discovery', undefined, undefined);
    const turn = makeTurn('Hello?');
    const updated = await store.appendTurn(created.id, turn);
    expect(updated.transcript.turns).toHaveLength(1);
    expect(updated.transcript.turns[0]!.questionText).toBe('Hello?');
  });

  it('throws when appending to missing session', async () => {
    const turn = makeTurn('Hello?');
    await expect(store.appendTurn('missing', turn)).rejects.toThrow('Session not found');
  });

  it('getSession returns a copy (mutation safe)', async () => {
    const created = await store.createSession('role_discovery', undefined, undefined);
    const fetched1 = await store.getSession(created.id);
    fetched1!.transcript.turns.push(makeTurn('mutated'));
    const fetched2 = await store.getSession(created.id);
    expect(fetched2!.transcript.turns).toHaveLength(0);
  });
});
