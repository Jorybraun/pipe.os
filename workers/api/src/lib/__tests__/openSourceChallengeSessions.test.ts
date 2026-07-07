import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  ensureMatchedOpenSourceChallengeAssessmentSession,
  materializeMatchedOpenSourcePacket,
  type OpenSourceChallengeSessionStore,
} from '../openSourceChallengeSessions';

function challengePacketJson(): string {
  return JSON.stringify({
    schemaVersion: 'repo-semantic-graph-v1',
    policyVersion: 'repo-challenge-v1',
    id: 'challenge-packet-973',
    repoSnapshotId: 'repo-snapshot-1',
    repository: {
      id: 41,
      fullName: 'mui/base-ui',
      url: 'https://github.com/mui/base-ui',
      defaultBranch: 'main',
    },
    pullRequest: {
      number: 973,
      url: 'https://github.com/mui/base-ui/pull/973',
      title: 'Fix popover retry scheduling',
      body: 'Source-backed PR body.',
      author: 'pipe-bot',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mergedAt: '2026-06-15T00:00:00.000Z',
    },
    languageSupport: { supported: true, language: 'typescript', reason: 'Supported.' },
    changedFilePaths: ['packages/react/src/popover.ts'],
    changedSymbolIds: ['symbol-1'],
    sourceSpanIds: ['repo-source-span-1'],
    testChanges: [],
    demands: [{
      id: 'demand-1',
      family: 'runtime_reliability',
      narrative: 'Repair retry scheduling so terminal events are emitted exactly once.',
      sourceSpanIds: ['repo-source-span-1'],
      changedSymbolIds: ['symbol-1'],
      weight: 1,
      contentHash: 'sha256:demand-1',
    }],
    demandFamilies: ['runtime_reliability'],
    quality: {
      score: 0.91,
      metrics: {
        provenanceCoverage: 1,
        reviewableSize: 1,
        testCoverage: 0.8,
        issueContext: 0.8,
        demandDiversity: 0.8,
      },
      gates: [],
      eligible: true,
    },
    reviewProfile: {
      source: 'deterministic_engineering_prior',
      difficultyBand: 'focused',
      expectedSeniority: 'senior',
      expectedTimeMinutes: 90,
      basis: {
        changedFileCount: 1,
        changedLineCount: 12,
        sourceHunkCount: 1,
        testChangeCount: 0,
        demandFamilyCount: 1,
        hasIssueContext: true,
      },
      rationale: 'Focused runtime reliability patch.',
    },
    contentHash: 'sha256:challenge-packet-973',
  });
}

function fakeD1(): D1Database {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async first<T>() {
          if (sql.includes('FROM candidates')) {
            return { owner_id: 'owner-1' } as T;
          }
          return null;
        },
        async all<T>() {
          if (sql.includes('FROM review_challenge_packets')) {
            expect(bindings).toEqual([41, 'https://github.com/mui/base-ui', 973]);
            return {
              success: true,
              results: [{
                id: 'challenge-packet-973',
                repo_snapshot_id: 'repo-snapshot-1',
                pr_number: 973,
                source_hash: 'sha256:challenge-packet-973',
                packet_json: challengePacketJson(),
                quality_score: 0.91,
                github_url: 'https://github.com/mui/base-ui',
                context_record_id: 'context-record-1',
                repo_source_ref_count: 2,
                concept_link_count: 1,
              }],
              meta: {},
            } as T;
          }
          return { success: true, results: [], meta: {} } as T;
        },
        async run() {
          return { success: true, results: [], meta: {} };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe('open-source challenge sessions', () => {
  it('materializes only complete source-backed matched packets', () => {
    const packet = materializeMatchedOpenSourcePacket({
      id: 'challenge-packet-973',
      repo_snapshot_id: 'repo-snapshot-1',
      pr_number: 973,
      source_hash: 'sha256:challenge-packet-973',
      packet_json: challengePacketJson(),
      quality_score: 0.91,
      github_url: 'https://github.com/mui/base-ui',
      context_record_id: 'context-record-1',
      repo_source_ref_count: 2,
      concept_link_count: 1,
    });

    expect(packet).toMatchObject({
      packetId: 'challenge-packet-973',
      repositoryUrl: 'https://github.com/mui/base-ui',
      githubPrNumber: 973,
      baseCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      verificationCommand: 'git diff --check HEAD~1 HEAD && git diff --name-only HEAD~1 HEAD',
      expectedEvidence: expect.arrayContaining([
        'git_commit source ref for the submitted assessment commit',
        'code_diff source ref for the exact baseCommitSha..commitSha candidate patch',
      ]),
      reviewProfile: {
        difficultyBand: 'focused',
        expectedSeniority: 'senior',
        expectedTimeMinutes: 90,
      },
    });
    expect(packet?.instructions).toContain('Source-backed demands:');
    expect(packet?.successCriteria).toContain('The solution addresses packet demands: runtime reliability.');

    expect(materializeMatchedOpenSourcePacket({
      id: 'challenge-packet-973',
      repo_snapshot_id: 'repo-snapshot-1',
      pr_number: 973,
      source_hash: 'sha256:challenge-packet-973',
      packet_json: challengePacketJson(),
      quality_score: 0.91,
      github_url: 'https://github.com/mui/base-ui',
      context_record_id: null,
      repo_source_ref_count: 0,
      concept_link_count: 1,
    })).toBeNull();
  });

  it('creates an idempotent assessment session event from a matched packet', async () => {
    const createCalls: unknown[] = [];
    const eventCalls: unknown[] = [];
    const profileCalls: unknown[] = [];
    const store: OpenSourceChallengeSessionStore = {
      async createSession(input) {
        createCalls.push(input);
        return { id: 'assessment-session-1' };
      },
      async recordEvent(input) {
        eventCalls.push(input);
      },
      async loadProgress() {
        return {
          hasChallengePacket: true,
          challengePacketContract: { isComplete: true },
        } as never;
      },
    };

    const progress = await ensureMatchedOpenSourceChallengeAssessmentSession(fakeD1(), {
      interviewId: 'interview-1',
      candidateId: 'candidate-1',
      matchedRepoId: 41,
      repositoryUrl: 'https://github.com/mui/base-ui',
      githubPrNumber: 973,
      createdAt: '2026-07-02T21:00:00.000Z',
      sessionStore: store,
      recordCandidateProfileEvidence: async (_db, input) => {
        profileCalls.push(input);
        return null;
      },
    });

    expect(progress).toMatchObject({
      hasChallengePacket: true,
      challengePacketContract: { isComplete: true },
    });
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      ingestionKey: 'assessment-session:interview-1:matched-open-source-challenge:challenge-packet-973',
      interviewId: 'interview-1',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-1',
      createdBy: 'owner-1',
      metadata: {
        challengePacketSource: 'matched_review_challenge_packet',
        matchedRepoId: 41,
        repositoryUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        baseCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        challengePacketId: 'challenge-packet-973',
      },
    });
    expect(eventCalls).toHaveLength(1);
    expect(eventCalls[0]).toMatchObject({
      sessionId: 'assessment-session-1',
      ingestionKey: 'assessment-event:assessment-session-1:matched-open-source-challenge:challenge-packet-973',
      kind: 'match_decision',
      actorType: 'system',
      actorId: 'pipe-matcher',
      payload: {
        matchedRepoId: 41,
        repositoryUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        baseCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        challengePacketId: 'challenge-packet-973',
      },
    });
    expect(JSON.stringify(eventCalls[0])).toContain('Expected evidence:');
    expect(JSON.stringify(eventCalls[0])).toContain('Match proof:');
    expect(JSON.stringify(eventCalls[0])).toContain('Review packet quality 91% from source-backed repo analysis.');
    expect(JSON.stringify(eventCalls[0])).toContain('1 source-backed repo demand in the selected PR packet.');
    expect(JSON.stringify(eventCalls[0])).toContain('Demand families: runtime reliability.');
    expect(JSON.stringify(eventCalls[0])).toContain('Assessment fit:');
    expect(JSON.stringify(eventCalls[0])).toContain('focused review calibrated for senior candidates.');
    expect(JSON.stringify(eventCalls[0])).toContain('90 minute target from deterministic engineering prior.');
    expect(JSON.stringify(eventCalls[0])).toContain('Sizing: 1 changed file, 12 changed lines, 1 source hunk, 1 demand family.');
    expect(JSON.stringify(eventCalls[0])).toContain('No test changes in the source-backed PR packet; require candidate verification evidence.');
    expect(eventCalls[0]).toMatchObject({
      sourceRefs: [expect.objectContaining({
        sourceRefType: 'review_challenge_packet',
        sourceRefId: 'challenge-packet-973',
        evidenceRole: 'assigned_challenge',
        contentHash: 'sha256:challenge-packet-973',
        locator: expect.objectContaining({
          matchedRepoId: 41,
          repositoryUrl: 'https://github.com/mui/base-ui',
          githubPrNumber: 973,
          baseCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          headCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        }),
      })],
    });
    expect(profileCalls).toEqual([{
      sessionId: 'assessment-session-1',
      candidateId: 'candidate-1',
      actorId: 'owner-1',
      occurredAt: '2026-07-02T21:00:00.000Z',
    }]);
  });
});
