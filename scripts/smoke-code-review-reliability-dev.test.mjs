import { describe, expect, it } from 'vitest';

import {
  buildReliabilityLanes,
  extractMatrixSummary,
  resolveAppDevDatabaseId,
  selectedLaneIds,
  summarizeLaneProof,
  validateLaneSummary,
} from './smoke-code-review-reliability-dev.mjs';

describe('CODE_REVIEW reliability suite contract', () => {
  it('builds the default reliability lanes in the expected order', () => {
    const lanes = buildReliabilityLanes({
      env: {},
      databaseId: 'app-dev-d1',
    });

    expect(lanes.map((lane) => lane.id)).toEqual([
      'manual-ready',
      'no-cv-handoff',
      'blocked-handoff',
      'role-backed-full-submit',
      'workers-sdk-matrix',
      'match-quality-readiness',
    ]);
    expect(lanes[0].command.join(' ')).toBe('npm run smoke:code-review-assess-dev');
    expect(lanes[0].env).toEqual({
      CODE_REVIEW_SMOKE_RECRUITER_CANDIDATE_LINK: '1',
    });
    expect(lanes[1].command.join(' ')).toBe('npm run smoke:code-review-assess-dev:no-cv-boundary');
    expect(lanes[2].command.join(' ')).toBe('npm run smoke:code-review-assess-dev:blocked');
    expect(lanes[3].command.join(' ')).toBe('npm run smoke:code-review-assess-dev:role-backed-full-submit');
    expect(lanes[4].command.join(' ')).toBe('npm run smoke:code-review-assess-dev:workers-matrix');
    expect(lanes[5].command).toEqual([
      'npm',
      '--prefix',
      'workers/api',
      'run',
      'living-context:match-quality:readiness',
      '--',
      '--database-id',
      'app-dev-d1',
    ]);
  });

  it('allows bounded lane subsets for focused troubleshooting', () => {
    expect(selectedLaneIds({
      CODE_REVIEW_RELIABILITY_LANES: 'blocked-handoff, workers-sdk-matrix',
    })).toEqual(['blocked-handoff', 'workers-sdk-matrix']);
    expect(() => buildReliabilityLanes({
      env: { CODE_REVIEW_RELIABILITY_LANES: 'not-a-lane' },
      databaseId: 'app-dev-d1',
    })).toThrow(/Unknown CODE_REVIEW reliability lane/);
  });

  it('resolves the CODE_REVIEW evaluation D1 without falling back to production', () => {
    expect(resolveAppDevDatabaseId({
      env: {
        CODE_REVIEW_RELIABILITY_D1_DATABASE_ID: 'explicit-suite-db',
        MATCHING_EVALUATION_D1_DATABASE_ID: 'matching-db',
      },
    })).toBe('explicit-suite-db');

    expect(resolveAppDevDatabaseId({
      env: {
        MATCHING_EVALUATION_D1_DATABASE_ID: 'matching-db',
      },
    })).toBe('matching-db');

    expect(resolveAppDevDatabaseId({
      env: {},
      readFile: () => '{"database_name":"pipe-db-test","database_id":"dev-db-from-wrangler"}',
    })).toBe('dev-db-from-wrangler');
  });

  it('summarizes manual ready, blocked handoff, and role-backed full-submit smoke proof', () => {
    const manualReady = summarizeLaneProof('assess-smoke', JSON.stringify({
      ok: true,
      interviewId: 'manual-ready-interview',
      matchMode: 'manual_override',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'USABLE',
      candidateLinkProof: {
        verified: true,
        state: 'active',
        sessionStatus: 'INVITED',
        setupStatus: 'reviewable_task_assigned',
      },
    }, null, 2));

    expect(manualReady).toMatchObject({
      parsed: true,
      summary: {
        ok: true,
        interviewId: 'manual-ready-interview',
        matchMode: 'manual_override',
        repoUrl: 'https://github.com/mui/base-ui',
        prNumber: 973,
        matchStatus: 'MATCHED',
        qualityGate: 'PASSED',
        assessmentQuality: 'USABLE',
        candidateLinkState: 'active',
        candidateLinkSessionStatus: 'INVITED',
        candidateLinkSetupStatus: 'reviewable_task_assigned',
      },
    });

    const blocked = summarizeLaneProof('assess-smoke', JSON.stringify({
      ok: true,
      interviewId: 'blocked-interview',
      matchMode: 'auto_match',
      candidateHandoff: {
        type: 'PROFILE_RECEIVED',
        stageId: 'candidate-intake-queued',
      },
    }, null, 2));

    expect(blocked).toMatchObject({
      parsed: true,
      summary: {
        ok: true,
        interviewId: 'blocked-interview',
        matchMode: 'auto_match',
        candidateHandoffType: 'PROFILE_RECEIVED',
        candidateHandoffStageId: 'candidate-intake-queued',
      },
    });

    const fullSubmit = summarizeLaneProof('assess-smoke', JSON.stringify({
      ok: true,
      interviewId: 'ready-interview',
      matchMode: 'role_backed_auto_match',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'STRONG',
      submissionSmoke: {
        reviewSessionId: 'review-session-1',
        scorePersistence: {
          reviewStatus: 'scored',
          reviewScore: 71,
          reviewBand: 'adequate',
        },
        recruiterResults: {
          evidenceHyperedgeCount: 4,
          personRoleRepoHyperedge: true,
        },
      },
    }, null, 2));

    expect(fullSubmit.summary).toMatchObject({
      ok: true,
      interviewId: 'ready-interview',
      matchMode: 'role_backed_auto_match',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      reviewSessionId: 'review-session-1',
      reviewScore: 71,
      scoreStatus: 'scored',
      evidenceHyperedgeCount: 4,
      personRoleRepoHyperedge: true,
    });
  });

  it('extracts and summarizes matrix and match-quality proof', () => {
    const matrixText = [
      'noise',
      '===== CODE_REVIEW app-dev profile matrix summary =====',
      JSON.stringify({
        ok: true,
        profileCount: 1,
        passed: 1,
        failed: 0,
        summaries: [{
          profileId: 'workers-sdk-runtime',
          interviewId: 'workers-interview',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          prNumber: 14118,
          matchStatus: 'MATCHED',
          qualityGate: 'PASSED',
          assessmentQuality: 'STRONG',
          contrastScore: 2,
        }],
      }, null, 2),
    ].join('\n');

    expect(extractMatrixSummary(matrixText).summaries[0].repoUrl)
      .toBe('https://github.com/cloudflare/workers-sdk');
    expect(summarizeLaneProof('matrix', matrixText).summary).toMatchObject({
      ok: true,
      profileCount: 1,
      profileId: 'workers-sdk-runtime',
      repoUrl: 'https://github.com/cloudflare/workers-sdk',
      prNumber: 14118,
      contrastScore: 2,
    });

    expect(summarizeLaneProof('match-quality', JSON.stringify({
      corpusId: 'expert-corpus',
      passed: true,
      metrics: {
        totalPairs: 6,
        verdictAccuracy: 1,
        falsePositiveCount: 0,
        falseNegativeCount: 0,
        averageScoreSeparation: 0.65,
        usableChallengeRate: 1,
      },
      gateFailures: [],
    }, null, 2)).summary).toMatchObject({
      ok: true,
      corpusId: 'expert-corpus',
      totalPairs: 6,
      accuracy: 1,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      usableChallengeRate: 1,
      gateFailures: [],
    });
  });

  it('validates lane summaries against lane-specific CODE_REVIEW proof contracts', () => {
    expect(validateLaneSummary('manual-ready', {
      ok: true,
      matchMode: 'manual_override',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'USABLE',
      candidateLinkState: 'active',
      candidateLinkSessionStatus: 'INVITED',
      candidateLinkSetupStatus: 'reviewable_task_assigned',
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('no-cv-handoff', {
      ok: true,
      matchMode: 'auto_match',
      repoUrl: null,
      prNumber: null,
      candidateHandoffType: 'PROFILE_RECEIVED',
      candidateHandoffStageId: 'candidate-intake-queued',
      reviewSessionId: null,
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('blocked-handoff', {
      ok: true,
      matchMode: 'auto_match',
      repoUrl: null,
      prNumber: null,
      candidateHandoffType: 'PROFILE_RECEIVED',
      candidateHandoffStageId: 'candidate-intake-queued',
      reviewSessionId: null,
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('role-backed-full-submit', {
      ok: true,
      matchMode: 'role_backed_auto_match',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'STRONG',
      reviewSessionId: 'review-session-1',
      reviewScore: 47,
      reviewBand: 'adequate',
      scoreStatus: 'scored',
      evidenceHyperedgeCount: 4,
      personRoleRepoHyperedge: true,
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('workers-sdk-matrix', {
      ok: true,
      profileId: 'workers-sdk-runtime',
      repoUrl: 'https://github.com/cloudflare/workers-sdk',
      prNumber: 14118,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'STRONG',
      contrastScore: 2,
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('match-quality-readiness', {
      ok: true,
      corpusId: 'expert-corpus',
      totalPairs: 6,
      accuracy: 1,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      usableChallengeRate: 1,
      gateFailures: [],
    })).toEqual({ ok: true, failures: [] });
  });

  it('rejects parsed lane summaries that do not prove the expected lane behavior', () => {
    expect(validateLaneSummary('no-cv-handoff', {
      ok: true,
      matchMode: 'auto_match',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      candidateHandoffType: null,
      candidateHandoffStageId: null,
      reviewSessionId: null,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'no-cv-handoff must return PROFILE_RECEIVED',
        'no-cv-handoff stage must be candidate-intake-queued',
        'no-cv-handoff must not assign a repo',
        'no-cv-handoff must not assign a PR',
      ]),
    });

    expect(validateLaneSummary('workers-sdk-matrix', {
      ok: true,
      profileId: 'workers-sdk-runtime',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'STRONG',
      contrastScore: 2,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'workers-sdk-matrix must select cloudflare/workers-sdk',
      ]),
    });
  });
});
