import { describe, expect, it } from 'vitest';
import { materializeChallengePacketForMatching } from '../d1Matcher';
import type { ChallengePacket as RepoChallengePacket } from '../../repoSemanticGraph';

type SpanMap = Parameters<typeof materializeChallengePacketForMatching>[2];

function repoPacket(overrides: Partial<RepoChallengePacket> = {}): RepoChallengePacket {
  return {
    schemaVersion: '1.0.0',
    policyVersion: 'repo-challenge-v1',
    id: 'packet-1',
    repoSnapshotId: 'snapshot-1',
    repository: {
      provider: 'github',
      owner: 'pipe',
      name: 'orders',
      canonicalUrl: 'https://github.com/pipe/orders',
    },
    pullRequest: {
      number: 42,
      url: 'https://github.com/pipe/orders/pull/42',
      title: 'Retry Kafka events idempotently',
      author: 'engineer',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mergedAt: '2026-06-14T08:00:00.000Z',
    },
    languageSupport: {
      language: 'TypeScript',
      normalizedLanguage: 'typescript',
      level: 'production',
      parser: 'typescript-compiler-api',
      challengePacketsAllowed: true,
      reason: 'typescript has a validated semantic extraction adapter',
    },
    changedFilePaths: ['src/orders.ts'],
    changedSymbolIds: [],
    sourceSpanIds: ['span-1'],
    testChanges: [],
    demands: [
      {
        id: 'demand-1',
        family: 'artifact:source',
        narrative: 'Review Kafka idempotency implementation.',
        conceptKeys: ['term:kafka'],
        mechanisms: ['term:kafka'],
        sourceSpanIds: ['span-1'],
        changedSymbolIds: [],
        weight: 1,
        contentHash: 'sha256:demand-1',
      },
    ],
    demandFamilies: ['artifact:source'],
    quality: {
      score: 1,
      metrics: {
        provenanceCoverage: 1,
        reviewableSize: 1,
        testCoverage: 1,
        issueContext: 1,
        demandDiversity: 1,
      },
      gates: [],
      eligible: true,
    },
    contentHash: 'sha256:packet-1',
    ...overrides,
  };
}

function spanMap(): SpanMap {
  return new Map([
    ['span-1', {
      id: 'span-1',
      artifact_version_id: 'repo-version-1',
      content_hash: 'sha256:repo-span-1',
      byte_start: 4,
      byte_end: 28,
      exact_text: 'processKafkaRetry(order)',
      path: 'src/orders.ts',
    }],
  ]) as SpanMap;
}

describe('materializeChallengePacketForMatching', () => {
  it('excludes a packet before recall when a demand references a missing repo span', () => {
    const loaded = materializeChallengePacketForMatching(7, repoPacket(), new Map() as SpanMap);

    expect(loaded).toEqual({
      exclusion: {
        id: 'packet-1',
        repoId: '7',
        prNumber: 42,
        packetContentHash: 'sha256:packet-1',
        reason: 'MISSING_DEMAND_SOURCE_SPANS',
        demandIds: ['demand-1'],
        missingSourceSpanIds: ['span-1'],
      },
    });
  });

  it('excludes a packet before recall when a demand has no source spans', () => {
    const loaded = materializeChallengePacketForMatching(7, repoPacket({
      sourceSpanIds: [],
      demands: [{
        ...repoPacket().demands[0]!,
        sourceSpanIds: [],
      }],
    }), new Map() as SpanMap);

    expect(loaded).toEqual({
      exclusion: {
        id: 'packet-1',
        repoId: '7',
        prNumber: 42,
        packetContentHash: 'sha256:packet-1',
        reason: 'DEMAND_WITHOUT_SOURCE_SPANS',
        demandIds: ['demand-1'],
        missingSourceSpanIds: [],
      },
    });
  });

  it('materializes only fully source-backed demands into matcher packets', () => {
    const loaded = materializeChallengePacketForMatching(7, repoPacket(), spanMap(), ['term:kafka']);

    expect('packet' in loaded ? loaded.packet : null).toEqual(expect.objectContaining({
      id: 'packet-1',
      repoId: '7',
      prNumber: 42,
      packetContentHash: 'sha256:packet-1',
      challengeReady: true,
      concepts: ['term:kafka'],
      demands: [expect.objectContaining({
        id: 'demand-1',
        roleRequirement: true,
        highWeightRoleRequirement: true,
        sourceRefs: [expect.objectContaining({
          artifactId: 'repo-version-1',
          artifactVersion: 'repo-version-1',
          contentHash: 'sha256:repo-span-1',
          startOffset: 4,
          endOffset: 28,
          locator: 'src/orders.ts:4-28',
          exactText: 'processKafkaRetry(order)',
        })],
      })],
    }));
  });
});
