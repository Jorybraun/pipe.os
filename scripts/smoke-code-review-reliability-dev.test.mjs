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
      'token-lifecycle',
      'no-cv-handoff',
      'blocked-handoff',
      'role-backed-full-submit',
      'person-boundary',
      'judge-example-readiness',
      'workers-sdk-matrix',
      'packet-catalog-readiness',
      'match-quality-readiness',
    ]);
    expect(lanes[0].command.join(' ')).toBe('npm run smoke:code-review-assess-dev');
    expect(lanes[0].env).toEqual({
      CODE_REVIEW_SMOKE_RECRUITER_CANDIDATE_LINK: '1',
    });
    expect(lanes[1].command.join(' ')).toBe('npm run smoke:assess-token-lifecycle-dev');
    expect(lanes[2].command.join(' ')).toBe('npm run smoke:code-review-assess-dev:no-cv-boundary');
    expect(lanes[3].command.join(' ')).toBe('npm run smoke:code-review-assess-dev:blocked');
    expect(lanes[4].command.join(' ')).toBe('npm run smoke:code-review-assess-dev:role-backed-full-submit');
    expect(lanes[5].command.join(' ')).toBe('npm run smoke:code-review-assess-dev:person-boundary');
    expect(lanes[6].command).toEqual([
      'npm',
      '--prefix',
      'workers/api',
      'run',
      'review-judge:verify',
      '--',
      '--remote',
      '--database-id',
      'app-dev-d1',
      '--limit',
      '20',
      '--require-calibration',
      '--json',
    ]);
    expect(lanes[7].command).toEqual([
      'npm',
      'run',
      'smoke:code-review-assess-dev:workers-matrix',
    ]);
    expect(lanes[8].command).toEqual([
      'npm',
      'run',
      'smoke:code-review-packet-catalog-dev',
      '--',
      '--database-id',
      'app-dev-d1',
      '--require-pass',
    ]);
    expect(lanes[9].command).toEqual([
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
      browserSmoke: {
        skipped: false,
        surfaceContract: 'source-backed-code-review-challenge',
      },
      recruiterBrowserSmoke: {
        skipped: false,
        readoutContract: 'matched-code-review-hiring-manager-readout',
        readiness: {
          ready: true,
          assessmentSetupStatus: 'reviewable_task_assigned',
        },
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
        candidateBrowserSmokeSkipped: false,
        candidateSurfaceContract: 'source-backed-code-review-challenge',
        recruiterBrowserSmokeSkipped: false,
        recruiterReadoutContract: 'matched-code-review-hiring-manager-readout',
        recruiterReadinessReady: true,
        recruiterAssessmentSetupStatus: 'reviewable_task_assigned',
      },
    });

    const blocked = summarizeLaneProof('assess-smoke', JSON.stringify({
      ok: true,
      interviewId: 'blocked-interview',
      matchMode: 'auto_match',
      candidateHandoff: {
        type: 'PROFILE_RECEIVED',
        stageId: 'candidate-intake-queued',
        stageTitle: 'Profile received',
        challengeCount: 0,
      },
      browserSmoke: {
        skipped: false,
        surfaceContract: 'profile-received-candidate-handoff',
      },
      recruiterBrowserSmoke: {
        skipped: false,
        readoutContract: 'blocked-code-review-action-readout',
        readiness: {
          ready: true,
          assessmentSetupStatus: 'waiting_for_source_backed_match',
        },
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
        candidateHandoffStageTitle: 'Profile received',
        candidateHandoffChallengeCount: 0,
        candidateBrowserSmokeSkipped: false,
        candidateSurfaceContract: 'profile-received-candidate-handoff',
        recruiterBrowserSmokeSkipped: false,
        recruiterReadoutContract: 'blocked-code-review-action-readout',
        recruiterReadinessReady: true,
        recruiterAssessmentSetupStatus: 'waiting_for_source_backed_match',
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
      browserSmoke: {
        skipped: false,
        surfaceContract: 'source-backed-code-review-with-review-round',
      },
      recruiterBrowserSmoke: {
        skipped: false,
        readoutContract: 'scored-code-review-hiring-manager-readout',
        readiness: {
          ready: true,
          assessmentSetupStatus: 'reviewable_task_assigned',
        },
      },
      submissionSmoke: {
        reviewSessionId: 'review-session-1',
        agentResponseCount: 1,
        threadCount: 1,
        scorePersistence: {
          reviewStatus: 'scored',
          reviewScore: 71,
          reviewBand: 'adequate',
          challengeSubmissionScore: 71,
          assessmentScore: 71,
          d1Target: 'remote',
        },
        reviewStatusPipeline: {
          phase: 'scoring',
          currentRound: 2,
          maxRounds: 4,
          scoreOverall: 71,
          scoreBand: 'adequate',
          pipeline: [
            { id: 'review', status: 'complete' },
            { id: 'scoring', status: 'complete' },
          ],
        },
        recruiterResults: {
          interviewStatus: 'COMPLETED',
          profileInterviewStatus: 'COMPLETED',
          profileSubmitted: true,
          codeReviewMatchStatus: 'MATCHED',
          validatorVerdict: 'PASSED',
          roleSourceCount: 1,
          evidenceHyperedgeCount: 4,
          personRoleRepoHyperedge: true,
        },
      },
      relatedBoundaryProfile: {
        verified: true,
        selectedInterviewId: 'ready-interview',
        relatedInterviewId: 'related-interview',
        relatedSource: 'interview_detail',
        selectedRepoUrl: 'https://github.com/mui/base-ui',
        selectedPrNumber: 973,
        relatedRepoUrl: 'https://github.com/facebook/react',
        relatedPrNumber: 1,
        scheduledCodeReviewCount: 1,
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
      candidateBrowserSmokeSkipped: false,
      candidateSurfaceContract: 'source-backed-code-review-with-review-round',
      recruiterBrowserSmokeSkipped: false,
      recruiterReadoutContract: 'scored-code-review-hiring-manager-readout',
      recruiterReadinessReady: true,
      recruiterAssessmentSetupStatus: 'reviewable_task_assigned',
      recruiterInterviewStatus: 'COMPLETED',
      recruiterProfileInterviewStatus: 'COMPLETED',
      recruiterProfileSubmitted: true,
      recruiterMatchStatus: 'MATCHED',
      validatorVerdict: 'PASSED',
      roleSourceCount: 1,
      evidenceHyperedgeCount: 4,
      personRoleRepoHyperedge: true,
      relatedBoundaryVerified: true,
      relatedBoundarySelectedInterviewId: 'ready-interview',
      relatedBoundaryRelatedInterviewId: 'related-interview',
      relatedBoundarySelectedRepoUrl: 'https://github.com/mui/base-ui',
      relatedBoundarySelectedPrNumber: 973,
      relatedBoundaryRelatedRepoUrl: 'https://github.com/facebook/react',
      relatedBoundaryRelatedPrNumber: 1,
      relatedBoundarySource: 'interview_detail',
      relatedBoundaryScheduledCodeReviewCount: 1,
      agentResponseCount: 1,
      threadCount: 1,
      challengeSubmissionScore: 71,
      assessmentScore: 71,
      scoreD1Target: 'remote',
      reviewStatusPhase: 'scoring',
      reviewStatusCurrentRound: 2,
      reviewStatusMaxRounds: 4,
      reviewStatusScoreOverall: 71,
      reviewStatusScoreBand: 'adequate',
      reviewPipelineReviewStatus: 'complete',
      reviewPipelineScoringStatus: 'complete',
    });
  });

  it('extracts and summarizes token lifecycle, matrix, judge, and match-quality proof', () => {
    expect(summarizeLaneProof('token-lifecycle', JSON.stringify({
      ok: true,
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      tokenA: {
        interviewId: 'token-a-interview',
        candidateId: 'token-a-candidate',
        candidateName: 'Token A Lifecycle Candidate',
        deliveredUrl: 'https://app-dev.hire-pipe.com/assess/<token>',
      },
      tokenB: {
        interviewId: 'token-b-interview',
        candidateId: 'token-b-candidate',
        candidateName: 'Token B Lifecycle Candidate',
        deliveredUrl: 'https://app-dev.hire-pipe.com/assess/<token>',
      },
      browserSmoke: {
        skipped: false,
      },
    }, null, 2)).summary).toMatchObject({
      ok: true,
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      tokenAInterviewId: 'token-a-interview',
      tokenACandidateId: 'token-a-candidate',
      tokenACandidateName: 'Token A Lifecycle Candidate',
      tokenADeliveredUrl: 'https://app-dev.hire-pipe.com/assess/<token>',
      tokenBInterviewId: 'token-b-interview',
      tokenBCandidateId: 'token-b-candidate',
      tokenBCandidateName: 'Token B Lifecycle Candidate',
      tokenBDeliveredUrl: 'https://app-dev.hire-pipe.com/assess/<token>',
      browserSmokeSkipped: false,
    });

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
          candidateBrowserSmokeSkipped: false,
          candidateSurfaceContract: 'source-backed-code-review-challenge',
          recruiterBrowserSmokeSkipped: false,
          recruiterReadoutContract: 'matched-code-review-hiring-manager-readout',
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
      candidateBrowserSmokeSkipped: false,
      candidateSurfaceContract: 'source-backed-code-review-challenge',
      recruiterBrowserSmokeSkipped: false,
      recruiterReadoutContract: 'matched-code-review-hiring-manager-readout',
    });

    expect(summarizeLaneProof('match-quality', JSON.stringify({
      corpusId: 'expert-corpus',
      passed: true,
      metrics: {
        totalPairs: 6,
        successfulPairs: 6,
        failedPairs: 0,
        negativeCaseCount: 2,
        insufficientEvidenceCaseCount: 1,
        contrastCaseCount: 2,
        reasonCategoryExpectationCount: 6,
        verdictAccuracy: 1,
        falsePositiveCount: 0,
        falseNegativeCount: 0,
        averageScoreSeparation: 0.65,
        usableChallengeRate: 1,
      },
      gateFailures: [],
      failedCases: [],
      caseResults: [
        {
          expectedVerdict: 'strong_match',
          sourceBackedPr: true,
          candidateEvidencePresent: true,
          repoEvidencePresent: true,
          usableChallenge: true,
        },
        {
          expectedVerdict: 'likely_match',
          sourceBackedPr: true,
          candidateEvidencePresent: true,
          repoEvidencePresent: true,
          usableChallenge: true,
        },
        {
          expectedVerdict: 'needs_review',
          sourceBackedPr: true,
          candidateEvidencePresent: false,
          repoEvidencePresent: true,
          usableChallenge: true,
        },
        {
          expectedVerdict: 'weak_match',
          sourceBackedPr: true,
          candidateEvidencePresent: false,
          repoEvidencePresent: true,
          usableChallenge: true,
        },
        {
          expectedVerdict: 'insufficient_evidence',
          sourceBackedPr: true,
          candidateEvidencePresent: false,
          repoEvidencePresent: true,
          usableChallenge: true,
        },
        {
          expectedVerdict: 'insufficient_evidence',
          sourceBackedPr: true,
          candidateEvidencePresent: false,
          repoEvidencePresent: true,
          usableChallenge: true,
        },
      ],
    }, null, 2)).summary).toMatchObject({
      ok: true,
      corpusId: 'expert-corpus',
      totalPairs: 6,
      successfulPairs: 6,
      failedPairs: 0,
      negativeCaseCount: 2,
      insufficientEvidenceCaseCount: 1,
      contrastCaseCount: 2,
      reasonCategoryExpectationCount: 6,
      accuracy: 1,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      usableChallengeRate: 1,
      caseResultsCount: 6,
      failedCaseCount: 0,
      positiveCaseCount: 2,
      sourceBackedPrCaseCount: 6,
      candidateEvidencePositiveCaseCount: 2,
      repoEvidenceCaseCount: 6,
      usableChallengeCaseCount: 6,
      gateFailures: [],
    });

    expect(summarizeLaneProof('judge-examples', JSON.stringify({
      databases: [{
        databasePath: 'remote:app-dev-d1',
        audit: {
          status: 'calibration_ready',
          replayReady: true,
          calibrationReady: true,
          counts: {
            total: 20,
            ready: 0,
            labelled: 20,
            archived: 0,
            invalidStatus: 0,
            replayable: 20,
            calibrationReady: 20,
          },
          failureModes: ['severity_calibration_wrong'],
          examples: [{
            id: 'code_review_judge_example_1',
            sessionId: 'review-session-1',
            status: 'LABELLED',
            replayable: true,
            labelled: true,
            calibrationReady: true,
            commentCount: 2,
            pushbackCount: 2,
            missing: [],
          }],
          failures: [],
          nextActions: [],
        },
      }],
    }, null, 2)).summary).toMatchObject({
      ok: true,
      databasePath: 'remote:app-dev-d1',
      status: 'calibration_ready',
      replayReady: true,
      calibrationReady: true,
      totalExamples: 20,
      labelledExamples: 20,
      replayableExamples: 20,
      calibrationReadyExamples: 20,
      invalidStatusExamples: 0,
      failureModes: ['severity_calibration_wrong'],
      failures: [],
      nextActions: [],
      exampleId: 'code_review_judge_example_1',
      exampleSessionId: 'review-session-1',
      exampleCommentCount: 2,
      examplePushbackCount: 2,
      exampleReplayable: true,
      exampleCalibrationReady: true,
    });

    expect(summarizeLaneProof('packet-catalog', JSON.stringify({
      ok: true,
      databaseId: 'app-dev-d1',
      metrics: {
        totalPackets: 10,
        productionReadyPackets: 8,
        productionReadyRepoCount: 3,
        productionReadyPullRequestCount: 8,
        reviewProfileReadyPackets: 5,
      },
      repos: [
        { repoName: 'mui/base-ui' },
        { repoName: 'cloudflare/workers-sdk' },
        { repoName: 'vercel/swr' },
      ],
      failures: [],
    }, null, 2)).summary).toMatchObject({
      ok: true,
      databaseId: 'app-dev-d1',
      productionReadyPackets: 8,
      productionReadyRepoCount: 3,
      productionReadyPullRequestCount: 8,
      reviewProfileReadyPackets: 5,
      repoNames: ['mui/base-ui', 'cloudflare/workers-sdk', 'vercel/swr'],
      failures: [],
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
      candidateBrowserSmokeSkipped: false,
      candidateSurfaceContract: 'source-backed-code-review-challenge',
      recruiterBrowserSmokeSkipped: false,
      recruiterReadoutContract: 'matched-code-review-hiring-manager-readout',
      recruiterReadinessReady: true,
      recruiterAssessmentSetupStatus: 'reviewable_task_assigned',
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('token-lifecycle', {
      ok: true,
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      tokenAInterviewId: 'token-a-interview',
      tokenACandidateId: 'token-a-candidate',
      tokenACandidateName: 'Token A Lifecycle Candidate',
      tokenADeliveredUrl: 'https://app-dev.hire-pipe.com/assess/<token>',
      tokenBInterviewId: 'token-b-interview',
      tokenBCandidateId: 'token-b-candidate',
      tokenBCandidateName: 'Token B Lifecycle Candidate',
      tokenBDeliveredUrl: 'https://app-dev.hire-pipe.com/assess/<token>',
      browserSmokeSkipped: false,
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('no-cv-handoff', {
      ok: true,
      matchMode: 'auto_match',
      repoUrl: null,
      prNumber: null,
      candidateHandoffType: 'PROFILE_RECEIVED',
      candidateHandoffStageId: 'candidate-intake-queued',
      candidateHandoffStageTitle: 'Profile received',
      candidateHandoffChallengeCount: 0,
      candidateBrowserSmokeSkipped: false,
      candidateSurfaceContract: 'profile-received-candidate-handoff',
      recruiterBrowserSmokeSkipped: false,
      recruiterReadoutContract: 'blocked-code-review-action-readout',
      recruiterReadinessReady: true,
      recruiterAssessmentSetupStatus: 'waiting_for_source_backed_match',
      reviewSessionId: null,
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('blocked-handoff', {
      ok: true,
      matchMode: 'auto_match',
      repoUrl: null,
      prNumber: null,
      candidateHandoffType: 'PROFILE_RECEIVED',
      candidateHandoffStageId: 'candidate-intake-queued',
      candidateBrowserSmokeSkipped: false,
      candidateSurfaceContract: 'profile-received-candidate-handoff',
      recruiterBrowserSmokeSkipped: false,
      recruiterReadoutContract: 'blocked-code-review-action-readout',
      recruiterReadinessReady: true,
      recruiterAssessmentSetupStatus: 'waiting_for_source_backed_match',
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
      candidateBrowserSmokeSkipped: false,
      candidateSurfaceContract: 'source-backed-code-review-with-review-round',
      recruiterBrowserSmokeSkipped: false,
      recruiterReadoutContract: 'scored-code-review-hiring-manager-readout',
      recruiterReadinessReady: true,
      recruiterAssessmentSetupStatus: 'reviewable_task_assigned',
      recruiterInterviewStatus: 'COMPLETED',
      recruiterProfileInterviewStatus: 'COMPLETED',
      recruiterProfileSubmitted: true,
      recruiterMatchStatus: 'MATCHED',
      validatorVerdict: 'PASSED',
      roleSourceCount: 1,
      reviewSessionId: 'review-session-1',
      agentResponseCount: 1,
      threadCount: 1,
      reviewScore: 47,
      reviewBand: 'adequate',
      scoreStatus: 'scored',
      challengeSubmissionScore: 47,
      assessmentScore: 47,
      scoreD1Target: 'remote',
      reviewStatusPhase: 'scoring',
      reviewStatusCurrentRound: 2,
      reviewStatusMaxRounds: 4,
      reviewStatusScoreOverall: 47,
      reviewStatusScoreBand: 'adequate',
      reviewPipelineReviewStatus: 'complete',
      reviewPipelineScoringStatus: 'complete',
      evidenceHyperedgeCount: 4,
      personRoleRepoHyperedge: true,
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('person-boundary', {
      ok: true,
      interviewId: 'selected-interview',
      matchMode: 'manual_override',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'USABLE',
      candidateBrowserSmokeSkipped: false,
      candidateSurfaceContract: 'source-backed-code-review-with-review-round',
      recruiterBrowserSmokeSkipped: false,
      recruiterReadoutContract: 'scored-code-review-hiring-manager-readout',
      recruiterInterviewStatus: 'COMPLETED',
      recruiterProfileInterviewStatus: 'COMPLETED',
      recruiterProfileSubmitted: true,
      recruiterMatchStatus: 'MATCHED',
      validatorVerdict: 'PASSED',
      reviewSessionId: 'review-session-1',
      agentResponseCount: 1,
      threadCount: 2,
      reviewScore: 50,
      scoreStatus: 'scored',
      scoreD1Target: 'remote',
      reviewPipelineReviewStatus: 'complete',
      reviewPipelineScoringStatus: 'complete',
      relatedBoundaryVerified: true,
      relatedBoundarySelectedInterviewId: 'selected-interview',
      relatedBoundaryRelatedInterviewId: 'related-interview',
      relatedBoundarySelectedRepoUrl: 'https://github.com/mui/base-ui',
      relatedBoundarySelectedPrNumber: 973,
      relatedBoundaryRelatedRepoUrl: 'https://github.com/facebook/react',
      relatedBoundaryRelatedPrNumber: 1,
      relatedBoundaryScheduledCodeReviewCount: 1,
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('judge-example-readiness', {
      ok: true,
      databasePath: 'remote:app-dev-d1',
      status: 'calibration_ready',
      replayReady: true,
      calibrationReady: true,
      totalExamples: 20,
      labelledExamples: 20,
      invalidStatusExamples: 0,
      replayableExamples: 20,
      calibrationReadyExamples: 20,
      failures: [],
      nextActions: [],
      exampleId: 'code_review_judge_example_1',
      exampleSessionId: 'review-session-1',
      exampleReplayable: true,
      exampleCalibrationReady: true,
      exampleCommentCount: 2,
      examplePushbackCount: 2,
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('workers-sdk-matrix', {
      ok: true,
      profileCount: 1,
      passed: 1,
      failed: 0,
      profileId: 'workers-sdk-runtime',
      repoUrl: 'https://github.com/cloudflare/workers-sdk',
      prNumber: 14118,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'STRONG',
      contrastScore: 2,
      candidateBrowserSmokeSkipped: false,
      candidateSurfaceContract: 'source-backed-code-review-challenge',
      recruiterBrowserSmokeSkipped: false,
      recruiterReadoutContract: 'matched-code-review-hiring-manager-readout',
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('packet-catalog-readiness', {
      ok: true,
      databaseId: 'app-dev-d1',
      totalPackets: 10,
      productionReadyPackets: 8,
      productionReadyRepoCount: 3,
      productionReadyPullRequestCount: 8,
      reviewProfileReadyPackets: 5,
      repoNames: ['mui/base-ui', 'cloudflare/workers-sdk', 'vercel/swr'],
      failures: [],
    })).toEqual({ ok: true, failures: [] });

    expect(validateLaneSummary('match-quality-readiness', {
      ok: true,
      corpusId: 'expert-corpus',
      totalPairs: 6,
      successfulPairs: 6,
      failedPairs: 0,
      negativeCaseCount: 2,
      insufficientEvidenceCaseCount: 1,
      contrastCaseCount: 2,
      reasonCategoryExpectationCount: 6,
      accuracy: 1,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      averageScoreSeparation: 0.65,
      usableChallengeRate: 1,
      caseResultsCount: 6,
      failedCaseCount: 0,
      positiveCaseCount: 2,
      sourceBackedPrCaseCount: 6,
      candidateEvidencePositiveCaseCount: 2,
      repoEvidenceCaseCount: 6,
      usableChallengeCaseCount: 6,
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
      candidateBrowserSmokeSkipped: true,
      recruiterBrowserSmokeSkipped: false,
      reviewSessionId: null,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'no-cv-handoff must return PROFILE_RECEIVED',
        'no-cv-handoff stage must be candidate-intake-queued',
        'no-cv-handoff candidate browser smoke must run',
        'no-cv-handoff must not assign a repo',
        'no-cv-handoff must not assign a PR',
      ]),
    });

    expect(validateLaneSummary('token-lifecycle', {
      ok: true,
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      tokenAInterviewId: 'same-interview',
      tokenACandidateId: 'same-candidate',
      tokenACandidateName: 'Same Candidate',
      tokenADeliveredUrl: 'https://app-dev.hire-pipe.com/assess/<token>',
      tokenBInterviewId: 'same-interview',
      tokenBCandidateId: 'same-candidate',
      tokenBCandidateName: 'Same Candidate',
      tokenBDeliveredUrl: 'https://app-dev.hire-pipe.com/not-assess/<token>',
      browserSmokeSkipped: true,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'token-lifecycle token A and token B interview ids must differ',
        'token-lifecycle token A and token B candidate ids must differ',
        'token-lifecycle token A and token B candidate names must differ',
        'token-lifecycle token B URL must be a redacted /assess link',
        'token-lifecycle browser smoke must run',
      ]),
    });

    expect(validateLaneSummary('judge-example-readiness', {
      ok: true,
      databasePath: 'remote:app-dev-d1',
      status: 'replay_ready',
      replayReady: true,
      calibrationReady: false,
      totalExamples: 1,
      labelledExamples: 0,
      invalidStatusExamples: 0,
      replayableExamples: 1,
      calibrationReadyExamples: 0,
      failures: ['fewer than 1 calibration-ready judge example(s) are available'],
      nextActions: ['Apply recruiter score overrides or human labels until at least one replay-ready example is LABELLED.'],
      exampleId: 'code_review_judge_example_1',
      exampleSessionId: 'review-session-1',
      exampleReplayable: true,
      exampleCalibrationReady: false,
      exampleCommentCount: 1,
      examplePushbackCount: 0,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'judge-example-readiness status must be calibration_ready',
        'judge-example-readiness must be calibration-ready',
        'judge-example-readiness must include labelled examples',
        'judge-example-readiness must include calibration-ready examples',
        'judge-example-readiness failures must be empty',
        'judge-example-readiness next actions must be empty',
        'judge-example-readiness first example must be calibration-ready',
        'judge-example-readiness first example must include AI pushback',
      ]),
    });

    expect(validateLaneSummary('workers-sdk-matrix', {
      ok: true,
      profileCount: 1,
      passed: 1,
      failed: 0,
      profileId: 'workers-sdk-runtime',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'STRONG',
      contrastScore: 2,
      candidateBrowserSmokeSkipped: false,
      recruiterBrowserSmokeSkipped: false,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'workers-sdk-matrix must select cloudflare/workers-sdk',
      ]),
    });

    expect(validateLaneSummary('workers-sdk-matrix', {
      ok: true,
      profileCount: 2,
      passed: 1,
      failed: 1,
      profileId: 'workers-sdk-runtime',
      repoUrl: 'https://github.com/cloudflare/workers-sdk',
      prNumber: 14118,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'STRONG',
      contrastScore: 2,
      candidateBrowserSmokeSkipped: false,
      recruiterBrowserSmokeSkipped: false,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'workers-sdk-matrix failed profile count must be 0',
        'workers-sdk-matrix must pass every evaluated profile',
      ]),
    });

    expect(validateLaneSummary('match-quality-readiness', {
      ok: true,
      corpusId: 'expert-corpus',
      totalPairs: 6,
      successfulPairs: 6,
      failedPairs: 0,
      negativeCaseCount: 2,
      insufficientEvidenceCaseCount: 1,
      contrastCaseCount: 2,
      reasonCategoryExpectationCount: 6,
      accuracy: 1,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      averageScoreSeparation: 0,
      usableChallengeRate: 1,
      caseResultsCount: 6,
      failedCaseCount: 0,
      positiveCaseCount: 2,
      sourceBackedPrCaseCount: 6,
      candidateEvidencePositiveCaseCount: 2,
      repoEvidenceCaseCount: 6,
      usableChallengeCaseCount: 6,
      gateFailures: [],
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'match-quality-readiness averageScoreSeparation must be positive',
      ]),
    });

    expect(validateLaneSummary('match-quality-readiness', {
      ok: true,
      corpusId: 'expert-corpus',
      totalPairs: 6,
      successfulPairs: 6,
      failedPairs: 0,
      negativeCaseCount: 2,
      insufficientEvidenceCaseCount: 1,
      contrastCaseCount: 2,
      reasonCategoryExpectationCount: 6,
      accuracy: 1,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      averageScoreSeparation: 0.65,
      usableChallengeRate: 1,
      caseResultsCount: 6,
      failedCaseCount: 1,
      positiveCaseCount: 2,
      sourceBackedPrCaseCount: 5,
      candidateEvidencePositiveCaseCount: 1,
      repoEvidenceCaseCount: 6,
      usableChallengeCaseCount: 5,
      gateFailures: [],
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'match-quality-readiness failedCases must be empty',
        'match-quality-readiness every labelled case must use a source-backed PR challenge',
        'match-quality-readiness every labelled case must be usable as a challenge',
        'match-quality-readiness every positive labelled case must include candidate-side evidence',
      ]),
    });

    expect(validateLaneSummary('packet-catalog-readiness', {
      ok: true,
      databaseId: 'app-dev-d1',
      totalPackets: 2,
      productionReadyPackets: 2,
      productionReadyRepoCount: 1,
      productionReadyPullRequestCount: 2,
      reviewProfileReadyPackets: 1,
      repoNames: ['mui/base-ui'],
      failures: ['catalog too thin'],
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'packet-catalog-readiness must have at least 3 production-ready packets',
        'packet-catalog-readiness must have at least 3 production-ready repos',
        'packet-catalog-readiness must have at least 3 production-ready PRs',
        'packet-catalog-readiness must have at least 2 persisted reviewProfile-ready packets',
        'packet-catalog-readiness must list at least 3 production-ready repo names',
        'packet-catalog-readiness failures must be empty',
      ]),
    });

    expect(validateLaneSummary('person-boundary', {
      ok: true,
      interviewId: 'selected-interview',
      matchMode: 'manual_override',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'USABLE',
      candidateBrowserSmokeSkipped: false,
      candidateSurfaceContract: 'source-backed-code-review-with-review-round',
      recruiterBrowserSmokeSkipped: false,
      recruiterReadoutContract: 'scored-code-review-hiring-manager-readout',
      recruiterInterviewStatus: 'COMPLETED',
      recruiterProfileInterviewStatus: 'COMPLETED',
      recruiterProfileSubmitted: true,
      recruiterMatchStatus: 'MATCHED',
      validatorVerdict: 'PASSED',
      reviewSessionId: 'review-session-1',
      agentResponseCount: 1,
      threadCount: 2,
      reviewScore: 50,
      scoreStatus: 'scored',
      scoreD1Target: 'remote',
      reviewPipelineReviewStatus: 'complete',
      reviewPipelineScoringStatus: 'complete',
      relatedBoundaryVerified: true,
      relatedBoundarySelectedInterviewId: 'related-interview',
      relatedBoundaryRelatedInterviewId: 'related-interview',
      relatedBoundarySelectedRepoUrl: 'https://github.com/facebook/react',
      relatedBoundarySelectedPrNumber: 1,
      relatedBoundaryRelatedRepoUrl: 'https://github.com/facebook/react',
      relatedBoundaryRelatedPrNumber: 1,
      relatedBoundaryScheduledCodeReviewCount: 1,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'person-boundary selected profile decision must point at the submitted interview',
        'person-boundary selected profile repo must match the submitted review repo',
        'person-boundary selected profile PR must match the submitted review PR',
      ]),
    });

    expect(validateLaneSummary('person-boundary', {
      ok: true,
      interviewId: 'selected-interview',
      matchMode: 'manual_override',
      repoUrl: 'https://github.com/facebook/react',
      prNumber: 1,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'USABLE',
      candidateBrowserSmokeSkipped: false,
      candidateSurfaceContract: 'source-backed-code-review-with-review-round',
      recruiterBrowserSmokeSkipped: false,
      recruiterReadoutContract: 'scored-code-review-hiring-manager-readout',
      recruiterInterviewStatus: 'COMPLETED',
      recruiterProfileInterviewStatus: 'COMPLETED',
      recruiterProfileSubmitted: true,
      recruiterMatchStatus: 'MATCHED',
      validatorVerdict: 'PASSED',
      reviewSessionId: 'review-session-1',
      agentResponseCount: 1,
      threadCount: 2,
      reviewScore: 50,
      scoreStatus: 'scored',
      scoreD1Target: 'remote',
      reviewPipelineReviewStatus: 'complete',
      reviewPipelineScoringStatus: 'complete',
      relatedBoundaryVerified: true,
      relatedBoundarySelectedInterviewId: 'selected-interview',
      relatedBoundaryRelatedInterviewId: 'related-interview',
      relatedBoundarySelectedRepoUrl: 'https://github.com/facebook/react',
      relatedBoundarySelectedPrNumber: 1,
      relatedBoundaryRelatedRepoUrl: 'https://github.com/facebook/react',
      relatedBoundaryRelatedPrNumber: 1,
      relatedBoundaryScheduledCodeReviewCount: 1,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'person-boundary related interview must not be promoted as the selected recommendation',
      ]),
    });

    expect(validateLaneSummary('role-backed-full-submit', {
      ok: true,
      matchMode: 'role_backed_auto_match',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
      matchStatus: 'MATCHED',
      qualityGate: 'PASSED',
      assessmentQuality: 'STRONG',
      candidateBrowserSmokeSkipped: false,
      recruiterBrowserSmokeSkipped: false,
      recruiterReadinessReady: true,
      recruiterAssessmentSetupStatus: 'reviewable_task_assigned',
      reviewSessionId: 'review-session-1',
      reviewScore: 47,
      reviewBand: 'adequate',
      scoreStatus: 'scored',
      evidenceHyperedgeCount: 4,
      personRoleRepoHyperedge: true,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'role-backed-full-submit recruiter interview status must be COMPLETED',
        'role-backed-full-submit recruiter profile must expose submitted result',
        'role-backed-full-submit recruiter validator verdict must be PASSED',
        'role-backed-full-submit must include author pushback response',
        'role-backed-full-submit review pipeline scoring step must be complete',
      ]),
    });
  });
});
