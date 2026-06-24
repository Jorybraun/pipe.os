import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackfillCliReport } from './backfillReviewChallengePackets';
import {
  parseArgs,
  prepareLiveReviewPacketE2EEnv,
  selectLiveReviewPacketId,
} from './prepareLiveReviewPacketE2EEnv';

function report(overrides: Partial<BackfillCliReport> = {}): BackfillCliReport {
  return {
    status: 'completed',
    mode: 'write',
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
        repoId: 973,
        repoFullName: 'mui/base-ui',
        repoUrl: 'https://github.com/mui/base-ui',
        prNumber: 973,
        prUrl: 'https://github.com/mui/base-ui/pull/973',
        title: '[popover] Better handle impatient clicks',
        status: 'persisted',
        packetId: 'challenge_packet_live',
        repoSnapshotId: 'snapshot_live',
        packetContentHash: 'sha256:packet',
        eligible: true,
        qualityScore: 0.9,
        productionReady: true,
        demandCount: 6,
        sourceSpanCount: 192,
        changedFileCount: 3,
        structuralFactCount: 178,
        contextRecordId: 'context_record_live',
        repoSourceRefCount: 29,
        conceptLinkCount: 88,
        persistedContextReady: true,
        error: null,
      },
    ],
    ...overrides,
  };
}

describe('prepareLiveReviewPacketE2EEnv', () => {
  let tmpDir: string | null = null;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it('selects the persisted context-ready packet for the expected live PR', () => {
    expect(selectLiveReviewPacketId(report())).toBe('challenge_packet_live');
  });

  it('rejects dry-run reports because browser E2E needs a persisted packet row', () => {
    expect(() => selectLiveReviewPacketId(report({ mode: 'dry-run' }))).toThrow(
      'backfill report mode must be write',
    );
  });

  it('rejects persisted packets that are missing context coverage', () => {
    const incomplete = report({
      outcomes: [{
        ...report().outcomes[0]!,
        contextRecordId: null,
        repoSourceRefCount: 0,
        persistedContextReady: false,
      }],
    });

    expect(() => selectLiveReviewPacketId(incomplete)).toThrow(
      'No persisted context-ready mui/base-ui#973 packet found',
    );
  });

  it('appends the packet id to a GitHub env file', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipe-live-packet-env-'));
    const envFile = join(tmpDir, 'github-env');

    const prepared = prepareLiveReviewPacketE2EEnv({
      report: report(),
      githubEnv: envFile,
    });

    expect(prepared).toMatchObject({
      envName: 'E2E_EXISTING_REVIEW_PACKET_ID',
      packetId: 'challenge_packet_live',
      repoFullName: 'mui/base-ui',
      prNumber: 973,
    });
    expect(readFileSync(envFile, 'utf8')).toBe(
      'E2E_EXISTING_REVIEW_PACKET_ID=challenge_packet_live\n',
    );
  });

  it('parses explicit repo, PR, env name, and GitHub env options', () => {
    expect(parseArgs([
      '--file', 'backfill.json',
      '--repo', 'owner/repo',
      '--pr', '42',
      '--env-name', 'PACKET_ID',
      '--github-env', 'github.env',
    ])).toMatchObject({
      file: 'backfill.json',
      repoFullName: 'owner/repo',
      prNumber: 42,
      envName: 'PACKET_ID',
      githubEnv: 'github.env',
    });
  });
});
