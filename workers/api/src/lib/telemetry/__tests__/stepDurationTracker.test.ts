import { describe, it, expect, vi } from 'vitest';
import {
  recordStepDuration,
  getP50Duration,
  estimateCompletion,
} from '../stepDurationTracker';

interface FakeD1 extends D1Database {
  __calls: Array<{
    sql: string;
    params: unknown[];
    firstResult: unknown;
    ran: boolean;
  }>;
}

function fakeD1(sampleData: Array<{ step_name: string; duration_ms: number }> = []): FakeD1 {
  const calls: FakeD1['__calls'] = [];

  const prepare = (sql: string): D1PreparedStatement => {
    const call: FakeD1['__calls'][number] = {
      sql,
      params: [],
      firstResult: null,
      ran: false,
    };
    calls.push(call);

    const stmt = {
      bind: (...params: unknown[]) => {
        call.params = params;
        return stmt;
      },
      first: async () => {
        call.firstResult = null;
        return null;
      },
      run: async () => {
        call.ran = true;
        return { success: true, meta: { changes: 1 } };
      },
      all: async <T>() => {
        const stepName = call.params[0];
        const results = sampleData
          .filter((s) => s.step_name === stepName)
          .map((s) => ({ duration_ms: s.duration_ms })) as T[];
        return { results, success: true, meta: { changes: 0 } };
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement;

    return stmt;
  };

  return {
    prepare,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    __calls: calls,
  } as unknown as FakeD1;
}

describe('recordStepDuration', () => {
  it('inserts a step duration with candidate_id', async () => {
    const db = fakeD1();
    await recordStepDuration(db, 'discover_profile', 1200, 'cand-1');

    const call = db.__calls[0]!;
    expect(call.sql).toContain('INSERT INTO step_duration_samples');
    expect(call.params).toEqual(['discover_profile', 1200, 'cand-1']);
    expect(call.ran).toBe(true);
  });

  it('falls back to empty string when candidateId is omitted', async () => {
    const db = fakeD1();
    await recordStepDuration(db, 'embed_profile', 800);

    const call = db.__calls[0]!;
    expect(call.params).toEqual(['embed_profile', 800, '']);
  });
});

describe('getP50Duration', () => {
  it('returns null when no samples exist', async () => {
    const db = fakeD1();
    const result = await getP50Duration(db, 'discover_profile');
    expect(result).toBeNull();
  });

  it('computes median for odd number of samples', async () => {
    const db = fakeD1([
      { step_name: 'discover_profile', duration_ms: 100 },
      { step_name: 'discover_profile', duration_ms: 300 },
      { step_name: 'discover_profile', duration_ms: 200 },
    ]);
    const result = await getP50Duration(db, 'discover_profile');
    expect(result).toBe(200);
  });

  it('computes median for even number of samples', async () => {
    const db = fakeD1([
      { step_name: 'discover_profile', duration_ms: 100 },
      { step_name: 'discover_profile', duration_ms: 400 },
      { step_name: 'discover_profile', duration_ms: 200 },
      { step_name: 'discover_profile', duration_ms: 300 },
    ]);
    const result = await getP50Duration(db, 'discover_profile');
    expect(result).toBe(250);
  });

  it('ignores samples from other steps', async () => {
    const db = fakeD1([
      { step_name: 'embed_profile', duration_ms: 9999 },
      { step_name: 'discover_profile', duration_ms: 500 },
    ]);
    const result = await getP50Duration(db, 'discover_profile');
    expect(result).toBe(500);
  });
});

describe('estimateCompletion', () => {
  it('returns null when any step has fewer than 3 samples', async () => {
    const db = fakeD1([
      { step_name: 'discover_profile', duration_ms: 100 },
      { step_name: 'discover_profile', duration_ms: 200 },
      { step_name: 'persist_profile', duration_ms: 50 },
    ]);
    const result = await estimateCompletion(db, ['discover_profile', 'persist_profile']);
    expect(result).toBeNull();
  });

  it('sums p50 durations for all steps', async () => {
    const db = fakeD1([
      { step_name: 'discover_profile', duration_ms: 100 },
      { step_name: 'discover_profile', duration_ms: 200 },
      { step_name: 'discover_profile', duration_ms: 300 },
      { step_name: 'persist_profile', duration_ms: 50 },
      { step_name: 'persist_profile', duration_ms: 100 },
      { step_name: 'persist_profile', duration_ms: 150 },
    ]);
    // discover_profile p50 = 200, persist_profile p50 = 100
    const result = await estimateCompletion(db, ['discover_profile', 'persist_profile']);
    expect(result).toBe(300);
  });

  it('returns null for empty remainingSteps', async () => {
    const db = fakeD1();
    const result = await estimateCompletion(db, []);
    expect(result).toBe(0);
  });
});
