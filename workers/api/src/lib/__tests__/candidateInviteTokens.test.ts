import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureUsableCandidateInviteToken,
  isClaimedInviteToken,
} from '../candidateInviteTokens';

function recordingDb(): D1Database & { updates: unknown[][] } {
  const updates: unknown[][] = [];
  const prepare = (): D1PreparedStatement => {
    const statement = {
      bind: (...params: unknown[]) => {
        updates.push(params);
        return statement;
      },
      run: async () => ({ success: true, meta: { changes: 1 } }),
      first: async () => null,
      all: async () => ({ results: [], success: true, meta: {} }),
      raw: async () => [],
    } as unknown as D1PreparedStatement;
    return statement;
  };

  return {
    prepare,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    updates,
  } as unknown as D1Database & { updates: unknown[][] };
}

describe('candidate invite tokens', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects claimed one-time invite tokens', () => {
    expect(isClaimedInviteToken('CLAIMED::abc')).toBe(true);
    expect(isClaimedInviteToken('abc')).toBe(false);
    expect(isClaimedInviteToken(null)).toBe(false);
  });

  it('keeps an active invite token without updating the candidate', async () => {
    const db = recordingDb();

    const token = await ensureUsableCandidateInviteToken(db, 'candidate-1', 'active-token');

    expect(token).toBe('active-token');
    expect(db.updates).toEqual([]);
  });

  it('replaces a claimed invite token before it is emailed again', async () => {
    const randomUuidSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('fresh-token');
    const db = recordingDb();

    const token = await ensureUsableCandidateInviteToken(db, 'candidate-1', 'CLAIMED::old-token');

    expect(token).toBe('fresh-token');
    expect(randomUuidSpy).toHaveBeenCalledTimes(1);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0][0]).toBe('fresh-token');
    expect(db.updates[0][2]).toBe('candidate-1');
  });
});
