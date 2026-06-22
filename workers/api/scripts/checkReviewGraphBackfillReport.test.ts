import { describe, expect, it } from 'vitest';
import type { BackfillCliReport } from './backfillReviewChallengePackets';
import {
  parseArgs,
  validateBackfillReport,
} from './checkReviewGraphBackfillReport';

function report(overrides: Partial<BackfillCliReport> = {}): BackfillCliReport {
  return {
    status: 'completed',
    mode: 'dry-run',
    target: 'remote',
    filters: {
      repoId: null,
      repo: 'mui/base-ui',
      prNumber: 973,
      force: false,
    },
    batchSize: 1,
    stats: {
      selected: 1,
      built: 1,
      persisted: 0,
      dryRun: 1,
      ineligible: 0,
      skippedExisting: 0,
      skippedFetch: 0,
      skippedNoHunks: 0,
      errors: 0,
    },
    outcomes: [
      {
        repoId: 77,
        repoFullName: 'mui/base-ui',
        repoUrl: 'https://github.com/mui/base-ui',
        prNumber: 973,
        prUrl: 'https://github.com/mui/base-ui/pull/973',
        title: 'Refactor menu focus handling',
        status: 'dry_run_ready',
        packetId: 'challenge_packet_123',
        repoSnapshotId: 'repo_snapshot_123',
        packetContentHash: 'sha256:packet',
        eligible: true,
        qualityScore: 0.92,
        productionReady: null,
        demandCount: 4,
        sourceSpanCount: 12,
        changedFileCount: 3,
        structuralFactCount: 7,
        contextRecordId: null,
        repoSourceRefCount: null,
        conceptLinkCount: null,
        persistedContextReady: null,
        error: null,
      },
    ],
    ...overrides,
  };
}

describe('checkReviewGraphBackfillReport', () => {
  it('passes a dry-run report with an eligible built packet', () => {
    const result = validateBackfillReport(report(), {
      expectedMode: 'dry-run',
    });

    expect(result.ready).toBe(true);
    expect(result.status).toBe('ready');
    expect(result.readyOutcomeCount).toBe(1);
    expect(result.dryRunReadyCount).toBe(1);
    expect(result.persistedContextReadyCount).toBe(0);
    expect(result.readyOutcomes[0]?.packetId).toBe('challenge_packet_123');
  });

  it('passes a write report only when a persisted packet is context-ready', () => {
    const result = validateBackfillReport(report({
      mode: 'write',
      stats: {
        selected: 1,
        built: 1,
        persisted: 1,
        dryRun: 0,
        ineligible: 0,
        skippedExisting: 0,
        skippedFetch: 0,
        skippedNoHunks: 0,
        errors: 0,
      },
      outcomes: [
        {
          repoId: 77,
          repoFullName: 'mui/base-ui',
          repoUrl: 'https://github.com/mui/base-ui',
          prNumber: 973,
          prUrl: 'https://github.com/mui/base-ui/pull/973',
          title: 'Refactor menu focus handling',
          status: 'persisted',
          packetId: 'challenge_packet_123',
          repoSnapshotId: 'repo_snapshot_123',
          packetContentHash: 'sha256:packet',
          eligible: true,
          qualityScore: 0.92,
          productionReady: true,
          demandCount: 4,
          sourceSpanCount: 12,
          changedFileCount: 3,
          structuralFactCount: 7,
          contextRecordId: 'context_record_123',
          repoSourceRefCount: 8,
          conceptLinkCount: 5,
          persistedContextReady: true,
          error: null,
        },
      ],
    }), {
      expectedMode: 'write',
    });

    expect(result.ready).toBe(true);
    expect(result.readyOutcomeCount).toBe(1);
    expect(result.persistedContextReadyCount).toBe(1);
    expect(result.readyOutcomes[0]?.contextRecordId).toBe('context_record_123');
  });

  it('fails dry-run reports that build packets without structural facts', () => {
    const result = validateBackfillReport(report({
      outcomes: [
        {
          ...report().outcomes[0]!,
          structuralFactCount: 0,
        },
      ],
    }), {
      expectedMode: 'dry-run',
    });

    expect(result.ready).toBe(false);
    expect(result.dryRunReadyCount).toBe(0);
    expect(result.failures).toContain(
      'expected at least 1 eligible dry-run packet outcome(s), found 0',
    );
  });

  it('fails write reports that persist context-ready packets without structural facts', () => {
    const result = validateBackfillReport(report({
      mode: 'write',
      stats: {
        selected: 1,
        built: 1,
        persisted: 1,
        dryRun: 0,
        ineligible: 0,
        skippedExisting: 0,
        skippedFetch: 0,
        skippedNoHunks: 0,
        errors: 0,
      },
      outcomes: [
        {
          ...report().outcomes[0]!,
          status: 'persisted',
          productionReady: true,
          contextRecordId: 'context_record_123',
          repoSourceRefCount: 8,
          conceptLinkCount: 5,
          persistedContextReady: true,
          structuralFactCount: 0,
        },
      ],
    }), {
      expectedMode: 'write',
    });

    expect(result.ready).toBe(false);
    expect(result.persistedContextReadyCount).toBe(0);
    expect(result.failures).toContain(
      'expected at least 1 persisted context-ready packet outcome(s), found 0',
    );
  });

  it('fails write reports that persist packets without context coverage', () => {
    const result = validateBackfillReport(report({
      mode: 'write',
      stats: {
        selected: 1,
        built: 1,
        persisted: 1,
        dryRun: 0,
        ineligible: 0,
        skippedExisting: 0,
        skippedFetch: 0,
        skippedNoHunks: 0,
        errors: 0,
      },
      outcomes: [
        {
          ...report().outcomes[0]!,
          status: 'persisted',
          productionReady: true,
          contextRecordId: 'context_record_123',
          repoSourceRefCount: 0,
          conceptLinkCount: 5,
          persistedContextReady: false,
        },
      ],
    }), {
      expectedMode: 'write',
    });

    expect(result.ready).toBe(false);
    expect(result.failures).toContain(
      'expected at least 1 persisted context-ready packet outcome(s), found 0',
    );
  });

  it('fails reports with no outcomes or mode mismatch', () => {
    const result = validateBackfillReport(report({
      outcomes: [],
    }), {
      expectedMode: 'write',
    });

    expect(result.ready).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      'expected write report, received dry-run',
      'backfill report has no PR outcomes',
    ]));
  });

  it('parses CLI options', () => {
    expect(parseArgs([
      '--file',
      'review-graph-backfill.json',
      '--expected-mode=write',
      '--min-ready',
      '2',
      '--json',
    ])).toEqual({
      file: 'review-graph-backfill.json',
      expectedMode: 'write',
      minReadyOutcomes: 2,
      json: true,
    });
  });
});
