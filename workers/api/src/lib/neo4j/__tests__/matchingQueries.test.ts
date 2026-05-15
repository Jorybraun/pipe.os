/**
 * matchingQueries.ts unit tests.
 *
 * Verifies that matching queries read policy from the Role node
 * and contain zero hardcoded thresholds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock factory — must match the pattern in neo4j.test.ts
vi.mock('neo4j-driver', () => {
  const mockSessionRun = vi.fn();
  const mockSessionClose = vi.fn().mockResolvedValue(undefined);
  const mockDriver = {
    session: vi.fn().mockReturnValue({
      run: mockSessionRun,
      close: mockSessionClose,
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    __esModule: true,
    default: {
      driver: vi.fn().mockReturnValue(mockDriver),
      auth: {
        basic: vi.fn().mockReturnValue({ scheme: 'basic', principal: 'neo4j', credentials: 'test' }),
      },
    },
    driver: vi.fn().mockReturnValue(mockDriver),
    auth: {
      basic: vi.fn().mockReturnValue({ scheme: 'basic', principal: 'neo4j', credentials: 'test' }),
    },
    _mockSessionRun: mockSessionRun,
    _mockSessionClose: mockSessionClose,
    _mockDriver: mockDriver,
  };
});

import * as neo4jDriverModule from 'neo4j-driver';
import { matchCandidatesForRole, checkDealbreakersForCandidate, scoreCandidateAgainstRole } from '../matchingQueries';

function getMocks() {
  return neo4jDriverModule as unknown as {
    _mockSessionRun: ReturnType<typeof vi.fn>;
    _mockSessionClose: ReturnType<typeof vi.fn>;
    _mockDriver: { session: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  };
}

describe('matchingQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matchCandidatesForRole passes only role_id (no hardcoded thresholds)', async () => {
    const { _mockSessionRun } = getMocks();
    _mockSessionRun.mockResolvedValue({
      records: [],
      summary: { counters: { updates: () => ({}) } },
    });

    const driver = { session: vi.fn().mockReturnValue({ run: _mockSessionRun, close: vi.fn() }) } as unknown as import('neo4j-driver').Driver;

    await matchCandidatesForRole(driver, 'role_123');

    expect(_mockSessionRun).toHaveBeenCalledOnce();
    const [cypher, params] = _mockSessionRun.mock.calls[0]!;

    // Query should reference role properties, not hardcoded numbers
    expect(cypher).toContain('role.confidence_threshold');
    expect(cypher).toContain('role.similarity_threshold');
    expect(cypher).toContain('role.dealbreaker_threshold');
    expect(cypher).toContain('role.evidence_cap');
    expect(cypher).toContain('role.result_limit');
    expect(cypher).toContain('role.match_philosophy');
    expect(cypher).toContain('role.hybrid_mix_ratio');

    // Query should NOT contain hardcoded thresholds
    expect(cypher).not.toContain('>= 0.6');
    expect(cypher).not.toContain('>= 0.75');
    expect(cypher).not.toContain('[0..3]');
    expect(cypher).not.toContain('LIMIT 50');

    // Params should only contain role_id
    expect(params).toEqual({ role_id: 'role_123' });
  });

  it('matchCandidatesForRole returns mapped results', async () => {
    const { _mockSessionRun } = getMocks();
    _mockSessionRun.mockResolvedValue({
      records: [
        {
          get: (key: string) => {
            if (key === 'candidate_id') return 'cand_1';
            if (key === 'overall_score') return 0.85;
            if (key === 'requirement_matches') return [
              {
                requirement_id: 'req_1',
                score: 0.9,
                evidence: [{ node_id: 'node_1', sim: 0.88, type: 'Skill' }],
                weight: 1.0,
              },
            ];
            return null;
          },
        },
      ],
      summary: { counters: { updates: () => ({}) } },
    });

    const driver = { session: vi.fn().mockReturnValue({ run: _mockSessionRun, close: vi.fn() }) } as unknown as import('neo4j-driver').Driver;

    const results = await matchCandidatesForRole(driver, 'role_123');

    expect(results).toHaveLength(1);
    expect(results[0]!.candidate_id).toBe('cand_1');
    expect(results[0]!.overall_score).toBe(0.85);
    expect(results[0]!.requirement_matches).toHaveLength(1);
    expect(results[0]!.requirement_matches[0]!.evidence[0]!.sim).toBe(0.88);
  });

  it('checkDealbreakersForCandidate reads threshold from Role node', async () => {
    const { _mockSessionRun } = getMocks();
    _mockSessionRun.mockResolvedValue({
      records: [],
      summary: { counters: { updates: () => ({}) } },
    });

    const driver = { session: vi.fn().mockReturnValue({ run: _mockSessionRun, close: vi.fn() }) } as unknown as import('neo4j-driver').Driver;

    await checkDealbreakersForCandidate(driver, 'role_123', 'cand_1');

    expect(_mockSessionRun).toHaveBeenCalledOnce();
    const [cypher, params] = _mockSessionRun.mock.calls[0]!;

    // Should reference role.dealbreaker_threshold, not a hardcoded 0.75
    expect(cypher).toContain('role.dealbreaker_threshold');
    expect(cypher).not.toContain('< 0.75');
    expect(cypher).not.toContain('$threshold');

    expect(params).toEqual({ role_id: 'role_123', candidate_id: 'cand_1' });
  });

  it('scoreCandidateAgainstRole returns score + matches + dealbreaker failures', async () => {
    const { _mockSessionRun } = getMocks();
    let callCount = 0;
    _mockSessionRun.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          records: [
            {
              get: (key: string) => {
                if (key === 'overall_score') return 0.82;
                if (key === 'requirement_matches') return [
                  { requirement_id: 'req_1', score: 0.85, evidence: [], weight: 1.0 },
                ];
                return null;
              },
            },
          ],
          summary: { counters: { updates: () => ({}) } },
        };
      }
      // Second call = checkDealbreakersForCandidate
      return {
        records: [],
        summary: { counters: { updates: () => ({}) } },
      };
    });

    const driver = { session: vi.fn().mockReturnValue({ run: _mockSessionRun, close: vi.fn() }) } as unknown as import('neo4j-driver').Driver;

    const result = await scoreCandidateAgainstRole(driver, 'role_123', 'cand_1');

    expect(result).not.toBeNull();
    expect(result!.score).toBe(0.82);
    expect(result!.matches).toHaveLength(1);
    expect(result!.dealbreakerFailures).toHaveLength(0);
  });

  it('scoreCandidateAgainstRole returns null when no matches', async () => {
    const { _mockSessionRun } = getMocks();
    _mockSessionRun.mockResolvedValue({
      records: [],
      summary: { counters: { updates: () => ({}) } },
    });

    const driver = { session: vi.fn().mockReturnValue({ run: _mockSessionRun, close: vi.fn() }) } as unknown as import('neo4j-driver').Driver;

    const result = await scoreCandidateAgainstRole(driver, 'role_123', 'cand_1');

    expect(result).toBeNull();
  });
});
