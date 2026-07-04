import { describe, expect, it } from 'vitest';
import {
  summarizeAssessmentChallenge,
  summarizeResolvedAssessmentAssignment,
} from './assessmentChallenge';
import type { AssessmentProgressSnapshot, AssessmentSetupProjection } from './types';

const manualSetup: AssessmentSetupProjection = {
  status: 'reviewable_task_assigned',
  kind: 'manual_open_source_task',
  source: 'recruiter_manual_override',
  blocksPositiveAssessment: false,
  message: 'A concrete open-source task packet was assigned by the recruiter.',
  nextAction: 'OPEN_ROOM_OR_WORKSPACE',
  nextActionLabel: 'Open the assessment room.',
};

describe('summarizeResolvedAssessmentAssignment', () => {
  it('keeps source-backed auto-match quality proof in matched assignment summaries', () => {
    const assignment = summarizeResolvedAssessmentAssignment({
      setup: {
        status: 'reviewable_task_assigned',
        kind: 'github_pr',
        source: 'matched_repo_id',
        blocksPositiveAssessment: false,
        message: 'PIPE found a source-backed candidate challenge at https://github.com/mui/base-ui #973. It passed the auto-assignment quality gate. Assessment quality: USABLE 9/12. It leads the next comparable challenge by 2%.',
        nextAction: 'OPEN_ROOM_OR_WORKSPACE',
        nextActionLabel: 'Review the latest match run before starting.',
      },
      assignmentTrust: null,
    });

    expect(assignment).toEqual({
      label: 'PIPE-matched challenge',
      detail: 'PIPE found a source-backed candidate challenge at https://github.com/mui/base-ui #973. It passed the auto-assignment quality gate. Assessment quality: USABLE 9/12. It leads the next comparable challenge by 2%.',
      tone: 'matched',
    });
  });

  it('lets matched durable assessment trust override stale manual setup labels', () => {
    const assignment = summarizeResolvedAssessmentAssignment({
      setup: manualSetup,
      assignmentTrust: {
        state: 'matched_challenge',
        label: 'PIPE-matched challenge',
        detail: 'PIPE selected this task from source-backed candidate evidence, role context, and repository demand.',
        tone: 'matched',
      } satisfies NonNullable<AssessmentProgressSnapshot['assignmentTrust']>,
    });

    expect(assignment).toEqual({
      label: 'PIPE-matched challenge',
      detail: 'PIPE selected this task from source-backed candidate evidence, role context, and repository demand.',
      tone: 'matched',
    });
  });

  it('combines durable matched trust with richer matched setup proof when both agree', () => {
    const assignment = summarizeResolvedAssessmentAssignment({
      setup: {
        status: 'reviewable_task_assigned',
        kind: 'auto_match',
        source: 'candidate_challenge_assignment',
        blocksPositiveAssessment: false,
        message: 'PIPE found a source-backed candidate challenge at https://github.com/mui/base-ui #973. It passed the auto-assignment quality gate. Assessment quality: USABLE 9/12.',
      },
      assignmentTrust: {
        state: 'matched_challenge',
        label: 'PIPE-matched challenge',
        detail: 'PIPE selected this task from source-backed candidate evidence, role context, and repository demand.',
        tone: 'matched',
      } satisfies NonNullable<AssessmentProgressSnapshot['assignmentTrust']>,
    });

    expect(assignment).toEqual({
      label: 'PIPE-matched challenge',
      detail: 'PIPE selected this task from source-backed candidate evidence, role context, and repository demand. PIPE found a source-backed candidate challenge at https://github.com/mui/base-ui #973. It passed the auto-assignment quality gate. Assessment quality: USABLE 9/12.',
      tone: 'matched',
    });
  });

  it('keeps manual setup visible when the durable session is also manual', () => {
    const assignment = summarizeResolvedAssessmentAssignment({
      setup: manualSetup,
      assignmentTrust: {
        state: 'manual_challenge',
        label: 'Manual task assignment',
        detail: 'A recruiter supplied the task packet.',
        tone: 'manual',
      } satisfies NonNullable<AssessmentProgressSnapshot['assignmentTrust']>,
    });

    expect(assignment).toEqual({
      label: 'Manual task assignment',
      detail: 'A concrete open-source task packet was assigned by the recruiter.',
      tone: 'manual',
    });
  });
});

describe('summarizeAssessmentChallenge', () => {
  it('uses list-safe challenge summaries when full packet source text is omitted', () => {
    const summary = summarizeAssessmentChallenge({
      exactText: null,
      locator: {
        repositoryUrl: 'https://github.com/mui/base-ui',
        baseCommitSha: '1111111111111111111111111111111111111111',
        githubPrNumber: 973,
      },
      summary: {
        task: 'Fix Base UI popover impatient click handling',
        assessmentFit: [
          'focused review calibrated for senior candidates.',
          '45 minute target from deterministic engineering prior.',
        ],
        matchProof: ['Review packet quality 92% from source-backed repo analysis.'],
        successCriteria: ['Regression is fixed without weakening normal click behavior.'],
        expectedEvidence: ['Commit diff plus targeted test or explicit verification note.'],
        verificationCommand: 'npm test -- popover',
      },
    });

    expect(summary).toEqual({
      repositoryUrl: 'https://github.com/mui/base-ui',
      githubPrNumber: 973,
      baseCommitSha: '1111111111111111111111111111111111111111',
      task: 'Fix Base UI popover impatient click handling',
      verificationCommand: 'npm test -- popover',
      assessmentFit: [
        'focused review calibrated for senior candidates.',
        '45 minute target from deterministic engineering prior.',
      ],
      matchProof: ['Review packet quality 92% from source-backed repo analysis.'],
      successCriteria: ['Regression is fixed without weakening normal click behavior.'],
      expectedEvidence: ['Commit diff plus targeted test or explicit verification note.'],
    });
  });

  it('keeps verification command from exact packet text when summary metadata is absent', () => {
    const summary = summarizeAssessmentChallenge({
      exactText: [
        'Repo: https://github.com/pipe/source-backed-worker',
        'Base commit: 2222222222222222222222222222222222222222',
        'Task: Fix deterministic retry handling.',
        'Verification command: npm test -- retry-order',
      ].join('\n'),
      locator: {},
      summary: null,
    });

    expect(summary?.verificationCommand).toBe('npm test -- retry-order');
    expect(summary?.task).toBe('Fix deterministic retry handling.');
  });
});
