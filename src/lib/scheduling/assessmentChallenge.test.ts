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
        successCriteria: ['Regression is fixed without weakening normal click behavior.'],
        expectedEvidence: ['Commit diff plus targeted test or explicit verification note.'],
      },
    });

    expect(summary).toEqual({
      repositoryUrl: 'https://github.com/mui/base-ui',
      githubPrNumber: 973,
      baseCommitSha: '1111111111111111111111111111111111111111',
      task: 'Fix Base UI popover impatient click handling',
      successCriteria: ['Regression is fixed without weakening normal click behavior.'],
      expectedEvidence: ['Commit diff plus targeted test or explicit verification note.'],
    });
  });
});
