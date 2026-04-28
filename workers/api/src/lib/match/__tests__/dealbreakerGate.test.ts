/**
 * Dealbreaker gate tests — pre-Neo4j shim.
 */

import { describe, it, expect } from 'vitest';
import { runDealbreakerGates } from '../dealbreakerGate';
import type { DealbreakerRecord } from '../../../types';

function makeMockDb(fixture: {
  dealbreakers?: DealbreakerRecord[];
  profile?: string | null;
}): D1Database {
  const rcdJson = fixture.dealbreakers
    ? JSON.stringify({ dealbreakers: fixture.dealbreakers })
    : null;
  const profile = fixture.profile ?? null;

  const prepare = (sql: string): unknown => {
    const statement = {
      bind: (...args: unknown[]) => {
        return {
          first: async <T>(): Promise<T | null> => {
            if (sql.includes('role_contexts')) {
              return { rcd_json: rcdJson } as T | null;
            }
            if (sql.includes('candidate_ingestion')) {
              return { candidate_searchable_profile: profile } as T | null;
            }
            return null;
          },
        };
      },
    };
    return statement;
  };

  return { prepare } as unknown as D1Database;
}

const MOCK_DEALBREAKERS: DealbreakerRecord[] = [
  {
    id: 'db-strong',
    label: 'Must know Rust',
    pattern: 'rust',
    source_stakeholder: 'HIRING_MANAGER',
    source_chain_id: 'sc-1',
    job_relatedness_note: 'Core systems team requires Rust for performance-critical work.',
    job_relatedness_strength: 'strong',
    evidence_quote: 'We need someone who can write unsafe Rust confidently.',
  },
  {
    id: 'db-moderate',
    label: 'On-call experience preferred',
    pattern: 'on-call',
    source_stakeholder: 'HIRING_MANAGER',
    source_chain_id: 'sc-2',
    job_relatedness_note: 'Team runs a 24/7 rotation.',
    job_relatedness_strength: 'moderate',
    evidence_quote: 'PagerDuty rotation is part of the role.',
  },
  {
    id: 'db-weak',
    label: 'Open source contributions nice-to-have',
    pattern: 'open source',
    source_stakeholder: 'TEAM_MEMBER',
    source_chain_id: 'sc-3',
    job_relatedness_note: 'We value community engagement.',
    job_relatedness_strength: 'weak',
    evidence_quote: 'Would be cool if they had a GitHub side project.',
  },
];

describe('runDealbreakerGates', () => {
  it('returns autoFail=true when strong dealbreaker has no evidence', async () => {
    const db = makeMockDb({
      dealbreakers: [MOCK_DEALBREAKERS[0]!],
      profile: 'Experienced Python and TypeScript engineer.',
    });

    const result = await runDealbreakerGates(db, 'role-1', 'cand-1');

    expect(result.autoFail).toBe(true);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.dealbreakerId).toBe('db-strong');
    expect(result.warnings).toHaveLength(0);
  });

  it('returns warning when moderate dealbreaker has no evidence', async () => {
    const db = makeMockDb({
      dealbreakers: [MOCK_DEALBREAKERS[1]!],
      profile: 'Backend engineer with 5 years experience.',
    });

    const result = await runDealbreakerGates(db, 'role-1', 'cand-1');

    expect(result.autoFail).toBe(false);
    expect(result.failures).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.dealbreakerId).toBe('db-moderate');
  });

  it('passes when strong dealbreaker has evidence in profile', async () => {
    const db = makeMockDb({
      dealbreakers: [MOCK_DEALBREAKERS[0]!],
      profile: 'Senior systems engineer with deep rust expertise.',
    });

    const result = await runDealbreakerGates(db, 'role-1', 'cand-1');

    expect(result.autoFail).toBe(false);
    expect(result.failures).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('ignores weak dealbreakers (advisory only)', async () => {
    const db = makeMockDb({
      dealbreakers: [MOCK_DEALBREAKERS[2]!],
      profile: 'Backend engineer.',
    });

    const result = await runDealbreakerGates(db, 'role-1', 'cand-1');

    expect(result.autoFail).toBe(false);
    expect(result.failures).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('handles empty dealbreakers gracefully', async () => {
    const db = makeMockDb({ dealbreakers: [], profile: 'Any profile text.' });

    const result = await runDealbreakerGates(db, 'role-1', 'cand-1');

    expect(result.autoFail).toBe(false);
    expect(result.failures).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('handles missing RCD gracefully', async () => {
    const db = makeMockDb({ profile: 'Any profile text.' });

    const result = await runDealbreakerGates(db, 'role-1', 'cand-1');

    expect(result.autoFail).toBe(false);
    expect(result.failures).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('handles missing candidate profile gracefully', async () => {
    const db = makeMockDb({
      dealbreakers: [MOCK_DEALBREAKERS[0]!],
      profile: null,
    });

    const result = await runDealbreakerGates(db, 'role-1', 'cand-1');

    expect(result.autoFail).toBe(true);
    expect(result.failures).toHaveLength(1);
  });

  it('handles malformed RCD JSON gracefully', async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async <T>(): Promise<T | null> => {
            if (sql.includes('role_contexts')) {
              return { rcd_json: 'not json' } as T | null;
            }
            return { candidate_searchable_profile: 'profile' } as T | null;
          },
        }),
      }),
    } as unknown as D1Database;

    const result = await runDealbreakerGates(db, 'role-1', 'cand-1');

    expect(result.autoFail).toBe(false);
    expect(result.failures).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
