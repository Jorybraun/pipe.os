import { describe, expect, it } from 'vitest';
import {
  toReviewChallengePacketSummary,
  type ReviewChallengePacketRow,
} from '../adminRepos';

function row(overrides: Partial<ReviewChallengePacketRow> = {}): ReviewChallengePacketRow {
  return {
    id: 'packet-1',
    repo_snapshot_id: 'snapshot-1',
    pr_number: 42,
    packet_version: 'repo-challenge-v1',
    source_hash: 'sha256:source-backed',
    language: 'typescript',
    production_ready: 0,
    quality_score: 0.62,
    demand_families_json: JSON.stringify(['artifact:source', 'verification:term:test']),
    packet_json: JSON.stringify({
      quality: {
        gates: [
          { gate: 'complete_provenance', passed: true, reason: 'all evidence resolves' },
          { gate: 'contains_tests', passed: false, reason: '0 normalized test changes available' },
          { gate: 'minimum_quality', passed: false, reason: 'quality score 0.62; minimum 0.7' },
        ],
      },
    }),
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

describe('toReviewChallengePacketSummary', () => {
  it('exposes source-backed packet identity, readiness, demand families, and failed gates', () => {
    expect(toReviewChallengePacketSummary(row())).toEqual({
      id: 'packet-1',
      repoSnapshotId: 'snapshot-1',
      prNumber: 42,
      packetVersion: 'repo-challenge-v1',
      sourceHash: 'sha256:source-backed',
      language: 'typescript',
      productionReady: false,
      qualityScore: 0.62,
      demandFamilies: ['artifact:source', 'verification:term:test'],
      gateFailures: [
        'contains_tests: 0 normalized test changes available',
        'minimum_quality: quality score 0.62; minimum 0.7',
      ],
      updatedAt: 2,
    });
  });

  it('keeps malformed packet JSON visible instead of hiding unsafe packet state', () => {
    const summary = toReviewChallengePacketSummary(row({
      production_ready: 1,
      demand_families_json: 'not-json',
      packet_json: 'not-json',
    }));

    expect(summary.productionReady).toBe(true);
    expect(summary.demandFamilies).toEqual([]);
    expect(summary.gateFailures).toEqual(['packet_json could not be parsed']);
  });
});
