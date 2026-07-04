import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { CandidateReviewChallengeMatch } from '../../lib/challengeMatching';
import {
  matchStandaloneDevContainerAssessment,
  qualityGateFor,
  repairStandaloneReviewAssignmentFromMatchRun,
  selectPreferredMatchExplanation,
  waitingStageConfigForGate,
} from '../rpc';

const passedValidator = {
  agentName: 'source_backed_match_validator',
  agentVersion: 'v1',
  mode: 'deterministic' as const,
  verdict: 'PASSED' as const,
  rationale: 'Selected PR has source-backed evidence.',
  checks: [],
  sourceBridge: {
    prNumber: 973,
    candidateSourceCount: 2,
    repoSourceCount: 3,
    roleSourceCount: 1,
    alignedDemandCount: 2,
    stretchCount: 0,
    provenanceComplete: true,
  },
};

const usableQualityWithoutComparableChallenge = {
  verdict: 'USABLE',
  score: 9,
  maxScore: 12,
  metrics: [
    {
      id: 'skill_stack_overlap',
      label: 'Skill/stack overlap',
      score: 2,
      maxScore: 2,
      reason: 'Candidate evidence overlaps with the selected PR.',
    },
    {
      id: 'contrast_separation',
      label: 'Contrast separation',
      score: 0,
      maxScore: 2,
      reason: 'No second eligible challenge was available in this explanation context.',
    },
  ],
};

describe('qualityGateFor', () => {
  it('requires review for role-backed automatic matches without contrast separation', () => {
    expect(qualityGateFor(
      'MATCHED',
      2,
      3,
      1,
      passedValidator,
      usableQualityWithoutComparableChallenge,
    )).toEqual({
      verdict: 'NEEDS_REVIEW',
      checks: [
        'candidate_source_evidence',
        'repo_source_spans',
        'role_context_alignment',
        'assessment_quality_verified',
        'agent_validated_match',
      ],
      diagnostics: ['CONTRAST_SEPARATION_UNVERIFIED'],
    });
  });

  it('passes roleless source-backed matches without contrast separation', () => {
    expect(qualityGateFor(
      'MATCHED',
      2,
      3,
      0,
      {
        ...passedValidator,
        sourceBridge: {
          ...passedValidator.sourceBridge,
          roleSourceCount: 0,
        },
      },
      usableQualityWithoutComparableChallenge,
    )).toEqual({
      verdict: 'PASSED',
      checks: [
        'candidate_source_evidence',
        'repo_source_spans',
        'assessment_quality_verified',
        'contrast_separation_not_required_roleless',
        'agent_validated_match',
      ],
      diagnostics: [],
    });
  });
});

describe('selectPreferredMatchExplanation', () => {
  const needsReviewExplanation = {
    status: 'MATCHED' as const,
    summary: 'Matched but contrast was not measured.',
    score: 0.69,
    qualityGate: {
      verdict: 'NEEDS_REVIEW' as const,
      checks: ['candidate_source_evidence', 'repo_source_spans'],
    },
    candidateSourceCount: 2,
    repoSourceCount: 3,
    roleSourceCount: 1,
    evidence: [],
    evidenceHyperedges: [],
  };
  const passedExplanation = {
    ...needsReviewExplanation,
    summary: 'Matched with measured contrast.',
    qualityGate: {
      verdict: 'PASSED' as const,
      checks: ['candidate_source_evidence', 'repo_source_spans', 'contrast_separation_verified'],
    },
  };

  it('preserves NEEDS_REVIEW proof instead of hiding the match explanation', () => {
    expect(selectPreferredMatchExplanation([null, needsReviewExplanation])).toEqual(needsReviewExplanation);
  });

  it('still prefers a PASSED proof when one is available', () => {
    expect(selectPreferredMatchExplanation([needsReviewExplanation, passedExplanation])).toEqual(passedExplanation);
  });
});

describe('waitingStageConfigForGate', () => {
  it('keeps blocked CODE_REVIEW matching inside an incomplete assessment stage', () => {
    expect(waitingStageConfigForGate({
      candidateId: 'candidate-1',
      stageId: 'stage-code-review',
      stageTitle: 'Code Review',
      stageMode: 'ASYNC',
      timeLimit: null,
      waitingChallenge: {
        id: 'waiting-for-match',
        type: 'WAITING_FOR_MATCH',
        title: 'Challenge needs attention',
        instructions: 'Deterministic challenge matcher returned NO_ROLE_SAFE_CHALLENGE',
        config: {
          autoRefresh: false,
          refreshIntervalSeconds: 30,
          state: 'blocked',
          reason: 'Deterministic challenge matcher returned NO_ROLE_SAFE_CHALLENGE',
        },
      },
    })).toEqual({
      isComplete: false,
      stageId: 'stage-code-review',
      candidateId: 'candidate-1',
      stageTitle: 'Code Review',
      mode: 'ASYNC',
      timeLimit: null,
      challenges: [
        { type: 'WELCOME', order: 0, title: 'Welcome' },
        { type: 'WAITING_FOR_MATCH', order: 1, title: 'Challenge needs attention' },
      ],
      currentIndex: 0,
    });
  });
});

function sourceBackedMatch(): CandidateReviewChallengeMatch {
  return {
    status: 'MATCHED',
    matchRunId: 'match-run-1',
    repoId: 41,
    prNumber: 973,
    explanation: {
      status: 'MATCHED',
      challengeId: 'packet-973',
      repoId: '41',
      prNumber: 973,
      selectedPr: {
        challengeId: 'packet-973',
        repoId: '41',
        prNumber: 973,
        sourceVersion: 'snapshot-1',
      },
      score: 0.91,
      summary: 'Matched from candidate source evidence to source-backed repo spans.',
      assessmentQuality: {
        verdict: 'USABLE',
        score: 10,
        maxScore: 12,
        metrics: [
          {
            id: 'contrast_separation',
            label: 'Contrast separation',
            score: 2,
            maxScore: 2,
            reason: 'Selected packet separates from alternatives.',
          },
        ],
      },
      validatorAgent: {
        agentName: 'source_backed_match_validator',
        agentVersion: 'v1',
        mode: 'deterministic',
        verdict: 'PASSED',
        rationale: 'Candidate source evidence aligns with repository source spans.',
        checks: [],
        sourceBridge: {
          matchRunId: 'match-run-1',
          challengeId: 'packet-973',
          repoId: '41',
          prNumber: 973,
          candidateSourceCount: 1,
          repoSourceCount: 1,
          roleSourceCount: 0,
          alignedDemandCount: 1,
          stretchCount: 0,
          provenanceComplete: true,
        },
      },
      evidence: [{
        atomId: 'candidate-atom-1',
        demandId: 'repo-demand-1',
        purpose: 'validation',
        pairScore: 0.91,
        episodeMultiplier: 1,
        roleSourceRefs: [],
        candidateSourceRefs: [{
          artifactId: 'candidate-artifact-1',
          artifactVersion: 'candidate-artifact-version-1',
          sourceRefType: 'candidate_source_span',
          sourceRefId: 'candidate-span-1',
          locator: 'resume:1',
          exactText: 'Implemented React TypeScript popover handling.',
          contentHash: 'sha256:candidate-span-1',
          startOffset: 0,
          endOffset: 45,
        }],
        challengeSourceRefs: [{
          artifactId: 'repo-artifact-1',
          artifactVersion: 'repo-artifact-version-1',
          sourceRefType: 'repo_source_span',
          sourceRefId: 'repo-span-1',
          locator: 'packages/react/src/popover/root/usePopoverRoot.ts:1',
          exactText: 'Popover trigger click threshold implementation.',
          contentHash: 'sha256:repo-span-1',
          startOffset: 0,
          endOffset: 48,
        }],
      }],
      candidateSpans: [],
      repoSpans: [],
      roleSources: [],
      rejectedPackets: [],
      missingEvidence: [],
      stretchAreas: [],
      unmatchedDemandIds: [],
      rejectionReasons: [],
    },
  };
}

function embeddingOnlyMatch(): CandidateReviewChallengeMatch {
  const match = sourceBackedMatch();
  return {
    ...match,
    explanation: match.explanation
      ? {
          ...match.explanation,
          summary: 'Embedding recall selected a challenge without source-backed alignment.',
          validatorAgent: {
            ...match.explanation.validatorAgent!,
            rationale: 'Embedding recall did not produce source-backed candidate or repository spans.',
            sourceBridge: {
              ...match.explanation.validatorAgent!.sourceBridge,
              candidateSourceCount: 0,
              repoSourceCount: 0,
              roleSourceCount: 0,
              alignedDemandCount: 0,
              provenanceComplete: false,
            },
          },
          evidence: match.explanation.evidence.map((entry) => ({
            ...entry,
            candidateSourceRefs: [],
            challengeSourceRefs: [],
            roleSourceRefs: [],
          })),
          candidateSpans: [],
          repoSpans: [],
          roleSources: [],
        }
      : undefined,
  };
}

function buildStandaloneAssignmentDb(calls: { updates: unknown[][] }): D1Database {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async first<T>() {
          if (sql.includes('FROM candidates c')) {
            return {
              resume_s3_key: 'resumes/candidate.pdf',
              status: 'embedded',
              current_step: 'embedded',
              error_text: null,
              estimated_completion_at: null,
              updated_at: '2026-06-29T12:00:00.000Z',
              raw_node_count: 3,
              node_count: 2,
            } as T;
          }
          if (sql.includes('FROM qualified_repos')) {
            return { github_url: 'https://github.com/mui/base-ui' } as T;
          }
          return null;
        },
        async run() {
          if (sql.includes('UPDATE scheduled_interviews')) {
            calls.updates.push(bindings);
          }
          return { success: true, results: [], meta: {} };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe('matchStandaloneDevContainerAssessment', () => {
  it('persists a source-backed review-packet repo assignment for evidence-ready dev-container interviews', async () => {
    const calls = { updates: [] as unknown[][] };
    const db = buildStandaloneAssignmentDb(calls);

    const result = await matchStandaloneDevContainerAssessment(
      db,
      'candidate-1',
      {
        id: 'interview-1',
        status: 'INVITED',
        created_at: '2026-06-29T11:00:00.000Z',
        interview_type: 'DEV_CONTAINER_CHALLENGE',
        matched_repo_id: null,
        github_repo_url: null,
        github_pr_number: null,
        submission_json: null,
      },
      async () => sourceBackedMatch(),
    );

    expect(result).toEqual(expect.objectContaining({
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
    }));
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]?.slice(0, 3)).toEqual([
      41,
      'https://github.com/mui/base-ui',
      973,
    ]);
    expect(calls.updates[0]?.[4]).toBe('interview-1');
  });

  it('materializes a matched open-source bug-fix challenge session before returning ready', async () => {
    const calls = { updates: [] as unknown[][] };
    const db = buildStandaloneAssignmentDb(calls);
    const materialized: unknown[] = [];

    const result = await matchStandaloneDevContainerAssessment(
      db,
      'candidate-1',
      {
        id: 'interview-open-source-1',
        status: 'INVITED',
        created_at: '2026-06-29T11:00:00.000Z',
        interview_type: 'OPEN_SOURCE_BUG_FIX',
        matched_repo_id: null,
        github_repo_url: null,
        github_pr_number: null,
        submission_json: null,
      },
      async () => sourceBackedMatch(),
      async (_db, input) => {
        materialized.push(input);
        return {
          hasChallengePacket: true,
          challengePacketContract: { isComplete: true },
        } as never;
      },
    );

    expect(result).toEqual(expect.objectContaining({
      repoId: 41,
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
    }));
    expect(materialized).toHaveLength(1);
    expect(materialized[0]).toMatchObject({
      interviewId: 'interview-open-source-1',
      candidateId: 'candidate-1',
      matchedRepoId: 41,
      repositoryUrl: 'https://github.com/mui/base-ui',
      githubPrNumber: 973,
    });
  });

  it('blocks embedding-only open-source matches before challenge-session materialization', async () => {
    const calls = { updates: [] as unknown[][] };
    const db = buildStandaloneAssignmentDb(calls);
    const materialized: unknown[] = [];

    const result = await matchStandaloneDevContainerAssessment(
      db,
      'candidate-1',
      {
        id: 'interview-open-source-embedding-only',
        status: 'INVITED',
        created_at: '2026-06-29T11:00:00.000Z',
        interview_type: 'OPEN_SOURCE_BUG_FIX',
        matched_repo_id: null,
        github_repo_url: null,
        github_pr_number: null,
        submission_json: null,
      },
      async () => embeddingOnlyMatch(),
      async (_db, input) => {
        materialized.push(input);
        return {
          hasChallengePacket: true,
          challengePacketContract: { isComplete: true },
        } as never;
      },
    );

    expect(result).toBeNull();
    expect(materialized).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });

  it('keeps matched open-source bug-fix assignments blocked when no source-backed session can be materialized', async () => {
    const calls = { updates: [] as unknown[][] };
    const db = buildStandaloneAssignmentDb(calls);

    const result = await matchStandaloneDevContainerAssessment(
      db,
      'candidate-1',
      {
        id: 'interview-open-source-missing-packet',
        status: 'INVITED',
        created_at: '2026-06-29T11:00:00.000Z',
        interview_type: 'OPEN_SOURCE_BUG_FIX',
        matched_repo_id: null,
        github_repo_url: null,
        github_pr_number: null,
        submission_json: null,
      },
      async () => sourceBackedMatch(),
      async () => null,
    );

    expect(result).toBeNull();
    expect(calls.updates).toHaveLength(1);
  });
});

function persistedRankedMatch(): string {
  return JSON.stringify([{
    rank: 1,
    challengeId: 'challenge_packet_973',
    repoId: 973,
    prNumber: 973,
    score: 0.84,
    eligible: true,
    assessmentQuality: usableQualityWithoutComparableChallenge,
    validatorAgent: {
      ...passedValidator,
      sourceBridge: {
        ...passedValidator.sourceBridge,
        repoId: '973',
        roleSourceCount: 0,
      },
    },
    alignments: [{
      pairScore: 0.84,
      roleSourceRefs: [],
      candidateSourceRefs: [{
        sourceRefType: 'source_span',
        sourceRefId: 'candidate-source-span-1',
        locator: 'resume:1',
        exactText: 'Built React and TypeScript popover behavior with regression tests.',
        contentHash: 'sha256:candidate-source-span-1',
      }],
      challengeSourceRefs: [{
        sourceRefType: 'repo_source_span',
        sourceRefId: 'repo-source-span-1',
        locator: 'packages/react/src/popover/root/usePopoverRoot.ts:1',
        exactText: 'Popover trigger click threshold implementation.',
        contentHash: 'sha256:repo-source-span-1',
      }],
    }],
    alignedDemandCount: 1,
    stretchCount: 0,
  }]);
}

function buildStandaloneRepairDb(calls: { updates: unknown[][] }): D1Database {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async first<T>() {
          if (sql.includes('SELECT rcp.packet_json')) {
            return { packet_json: JSON.stringify({ id: 'challenge_packet_973' }) } as T;
          }
          return null;
        },
        async all<T>() {
          if (sql.includes('FROM match_runs mr')) {
            return {
              results: [{
                status: 'MATCHED',
                ranked_results_json: persistedRankedMatch(),
                repo_id: 973,
                pr_number: 973,
                github_url: 'https://github.com/mui/base-ui',
              }],
            } as T;
          }
          return { results: [] } as T;
        },
        async run() {
          if (sql.includes('UPDATE scheduled_interviews')) {
            calls.updates.push(bindings);
          }
          return { success: true, results: [], meta: {} };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe('repairStandaloneReviewAssignmentFromMatchRun', () => {
  it('hydrates a missing standalone code-review assignment from the latest passed source-backed match run', async () => {
    const calls = { updates: [] as unknown[][] };
    const db = buildStandaloneRepairDb(calls);

    const result = await repairStandaloneReviewAssignmentFromMatchRun(
      db,
      'candidate-1',
      'interview-1',
    );

    expect(result).toEqual(expect.objectContaining({
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
    }));
    expect(result?.matchExplanation?.qualityGate).toEqual({
      verdict: 'PASSED',
      checks: [
        'candidate_source_evidence',
        'repo_source_spans',
        'assessment_quality_verified',
        'contrast_separation_not_required_roleless',
        'agent_validated_match',
      ],
      diagnostics: [],
    });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]?.slice(0, 3)).toEqual([
      973,
      'https://github.com/mui/base-ui',
      973,
    ]);
    expect(calls.updates[0]?.[4]).toBe('interview-1');
  });
});
