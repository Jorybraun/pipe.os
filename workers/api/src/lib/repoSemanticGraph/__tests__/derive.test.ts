import { describe, expect, it } from 'vitest';
import {
  deriveRepoSemantics,
  type ChallengePacket,
  type NormalizedPullRequestInput,
} from '../index';

describe('deriveRepoSemantics', () => {
  it('builds episodes, assertions, open facets, and signals from packet data', async () => {
    const snapshot = {
      schemaVersion: '1.0.0' as const,
      id: 'snapshot-1',
      repository: {
        provider: 'github' as const,
        owner: 'pipe',
        name: 'repo',
        canonicalUrl: 'https://github.com/pipe/repo',
      },
      commitSha: 'abc',
      defaultBranch: 'main',
      observedAt: '2026-06-12T00:00:00.000Z',
      parentCommitShas: [],
      contentHash: 'sha256:snapshot' as const,
    };
    const sourceSpan = {
      schemaVersion: '1.0.0' as const,
      id: 'span-1',
      repoSnapshotId: snapshot.id,
      artifactId: 'artifact-1',
      artifactVersionId: 'version-1',
      contentHash: 'sha256:content' as const,
      start: { byteOffset: 0, line: 1, column: 1 },
      end: { byteOffset: 4, line: 1, column: 5 },
      exactText: 'code',
      exactTextHash: 'sha256:exact' as const,
      prSide: 'head' as const,
    };
    const pullRequest: NormalizedPullRequestInput = {
      repoSnapshot: snapshot,
      number: 9,
      url: 'https://github.com/pipe/repo/pull/9',
      title: 'Add temporal compensation',
      author: 'engineer',
      primaryLanguage: 'typescript',
      baseSha: 'base',
      headSha: 'head',
      mergedAt: snapshot.observedAt,
      metadataSourceSpanIds: [sourceSpan.id],
      sourceSpans: [sourceSpan],
      changedFiles: [],
      tests: [],
    };
    const packet: ChallengePacket = {
      schemaVersion: '1.0.0',
      policyVersion: 'repo-challenge-v1',
      id: 'packet-1',
      repoSnapshotId: snapshot.id,
      repository: snapshot.repository,
      pullRequest: {
        number: 9,
        url: pullRequest.url,
        title: pullRequest.title,
        author: pullRequest.author,
        baseSha: pullRequest.baseSha,
        headSha: pullRequest.headSha,
        mergedAt: pullRequest.mergedAt,
      },
      languageSupport: {
        language: 'typescript',
        normalizedLanguage: 'typescript',
        level: 'production',
        parser: 'typescript-compiler-api',
        challengePacketsAllowed: true,
        reason: 'test',
      },
      changedFilePaths: [],
      changedSymbolIds: [],
      sourceSpanIds: [sourceSpan.id],
      testChanges: [],
      demands: [{
        id: 'demand-1',
        family: 'previously-unseen-demand-family',
        narrative: 'Review the temporal compensation behavior.',
        conceptKeys: ['novel-namespace:temporal-compensation'],
        sourceSpanIds: [sourceSpan.id],
        changedSymbolIds: [],
        weight: 1,
        contentHash: 'sha256:demand' as const,
      }],
      demandFamilies: ['previously-unseen-demand-family'],
      quality: {
        score: 1,
        eligible: true,
        metrics: {
          provenanceCoverage: 1,
          reviewableSize: 1,
          testCoverage: 1,
          issueContext: 1,
          demandDiversity: 1,
        },
        gates: [],
      },
      contentHash: 'sha256:packet' as const,
    };

    const result = await deriveRepoSemantics({
      pullRequest,
      packet,
      structuralFacts: [],
    });

    expect(result.episodes).toHaveLength(1);
    expect(result.facets).toHaveLength(1);
    expect(result.facets[0]).toMatchObject({
      kind: 'novel-namespace',
      key: 'novel-namespace:temporal-compensation',
    });
    expect(result.assertions[0]).toMatchObject({
      episodeId: result.episodes[0]!.id,
      predicate: 'review_demand:previously-unseen-demand-family',
      facetIds: [result.facets[0]!.id],
    });
    expect(result.signals[0]).toMatchObject({
      key: 'novel-namespace:temporal-compensation',
      assertionIds: [result.assertions[0]!.id],
      facetIds: [result.facets[0]!.id],
      sourceSpanIds: [sourceSpan.id],
    });
  });
});
