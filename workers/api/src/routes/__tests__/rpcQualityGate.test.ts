import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { CandidateReviewChallengeMatch } from '../../lib/challengeMatching';
import {
  matchStandaloneDevContainerAssessment,
  qualityGateFor,
  selectPreferredMatchExplanation,
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
});
