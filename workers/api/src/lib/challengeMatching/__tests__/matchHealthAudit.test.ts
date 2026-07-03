import { describe, expect, it } from 'vitest';

import {
  auditCodeReviewMatchHealth,
  type CodeReviewMatchHealthRow,
  type CodeReviewPacketHealthRow,
} from '../matchHealthAudit';

function packet(index: number, repoId = `repo-${index}`): CodeReviewPacketHealthRow {
  return {
    packetId: `packet-${index}`,
    repoId,
    repoUrl: `https://github.com/example/${repoId}`,
    prNumber: 1000 + index,
    productionReady: true,
  };
}

function match(
  index: number,
  packetId: string,
  overrides: Partial<CodeReviewMatchHealthRow> = {},
): CodeReviewMatchHealthRow {
  return {
    matchRunId: `match-${index}`,
    roleContextId: `role-${index}`,
    selectedPacketId: packetId,
    status: 'MATCHED',
    contrastScore: 1,
    ...overrides,
  };
}

describe('auditCodeReviewMatchHealth', () => {
  it('passes when the packet corpus is broad and role-backed matches are safe', () => {
    const audit = auditCodeReviewMatchHealth({
      packets: [
        packet(1, 'repo-a'),
        packet(2, 'repo-a'),
        packet(3, 'repo-b'),
        packet(4, 'repo-b'),
        packet(5, 'repo-c'),
        packet(6, 'repo-c'),
        packet(7, 'repo-d'),
        packet(8, 'repo-d'),
      ],
      matches: [
        match(1, 'packet-1'),
        match(2, 'packet-2'),
        match(3, 'packet-3'),
        match(4, 'packet-4'),
      ],
    });

    expect(audit.ok).toBe(true);
    expect(audit.failures).toEqual([]);
    expect(audit.nextAction).toBe('run_labelled_evaluation');
  });

  it('fails when role-backed matched rows have no contrast separation', () => {
    const audit = auditCodeReviewMatchHealth({
      packets: Array.from({ length: 8 }, (_, index) => packet(index + 1, `repo-${index % 3}`)),
      matches: [
        match(1, 'packet-1', { contrastScore: 0 }),
        match(2, 'packet-2', { contrastScore: 1 }),
      ],
    });

    expect(audit.ok).toBe(false);
    expect(audit.roleBackedUnsafeMatchCount).toBe(1);
    expect(audit.nextAction).toBe('demote_unsafe_role_backed_matches');
  });

  it('allows roleless contrast-zero matches but still checks packet breadth', () => {
    const audit = auditCodeReviewMatchHealth({
      packets: [packet(1, 'repo-a'), packet(2, 'repo-b')],
      matches: [
        match(1, 'packet-1', { roleContextId: null, contrastScore: 0 }),
      ],
    });

    expect(audit.roleBackedUnsafeMatchCount).toBe(0);
    expect(audit.ok).toBe(false);
    expect(audit.nextAction).toBe('add_source_backed_challenge_packets');
  });

  it('fails when one packet dominates automatic matched runs', () => {
    const audit = auditCodeReviewMatchHealth({
      packets: Array.from({ length: 9 }, (_, index) => packet(index + 1, `repo-${index % 3}`)),
      matches: [
        match(1, 'packet-1', { recalledPacketCount: 9 }),
        match(2, 'packet-1', { recalledPacketCount: 9 }),
        match(3, 'packet-1', { recalledPacketCount: 9 }),
        match(4, 'packet-1', { recalledPacketCount: 9 }),
        match(5, 'packet-2', { recalledPacketCount: 9 }),
      ],
      thresholds: { maxSelectedPacketShare: 0.75 },
    });

    expect(audit.ok).toBe(false);
    expect(audit.selectedPacketSkew).toEqual({
      packetId: 'packet-1',
      count: 4,
      share: 0.8,
    });
    expect(audit.selectedPacketDistribution.slice(0, 2)).toEqual([
      {
        packetId: 'packet-1',
        count: 4,
        share: 0.8,
        repoId: 'repo-0',
        repoUrl: 'https://github.com/example/repo-0',
        prNumber: 1001,
        productionReady: true,
      },
      {
        packetId: 'packet-2',
        count: 1,
        share: 0.2,
        repoId: 'repo-1',
        repoUrl: 'https://github.com/example/repo-1',
        prNumber: 1002,
        productionReady: true,
      },
    ]);
    expect(audit.nextAction).toBe('rebalance_challenge_corpus');
  });

  it('does not fail current health on historical matches that used a narrower packet corpus', () => {
    const audit = auditCodeReviewMatchHealth({
      packets: Array.from({ length: 8 }, (_, index) => packet(index + 1, `repo-${index % 3}`)),
      matches: [
        ...Array.from({ length: 10 }, (_, index) =>
          match(index + 1, 'packet-1', {
            recalledPacketCount: 5,
            roleContextId: null,
          })
        ),
        match(11, 'packet-1', {
          recalledPacketCount: 8,
          roleContextId: null,
        }),
      ],
      thresholds: {
        maxSelectedPacketShare: 0.75,
        minCurrentBreadthMatchesForSkew: 5,
      },
    });

    expect(audit.ok).toBe(true);
    expect(audit.failures).toEqual([]);
    expect(audit.currentBreadthSelectedMatchCount).toBe(1);
    expect(audit.staleOrNarrowSelectedMatchCount).toBe(10);
    expect(audit.selectedPacketSkew).toEqual({
      packetId: 'packet-1',
      count: 1,
      share: 1,
    });
    expect(audit.warnings).toContain(
      '10 matched run(s) recalled fewer than the current 8 production-ready packet(s) and were excluded from selected-packet skew analysis.',
    );
    expect(audit.warnings).toContain(
      'Only 1 current-breadth matched run(s) were available for selected-packet skew analysis; need at least 5 to fail skew.',
    );
    expect(audit.nextAction).toBe('run_labelled_evaluation');
  });
});
