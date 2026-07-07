import { describe, expect, it } from 'vitest';
import {
  assessmentSubmissionActionLabel,
  assessmentSubmissionCaptured,
  assessmentSubmissionLocked,
  assessmentSubmissionLockedReason,
} from './assessmentSubmissionState';
import type { RoomAssessmentProgressSnapshot } from '../types';

function progress(input: Partial<RoomAssessmentProgressSnapshot> = {}): RoomAssessmentProgressSnapshot {
  return {
    mode: 'OPEN_SOURCE_BUG_FIX',
    state: 'FINAL_SUBMITTED',
    stage: 'READY_FOR_EVALUATION',
    nextAction: 'START_EVALUATION',
    nextActionLabel: 'Start source-backed evaluation.',
    hasChallengePacket: true,
    hasWorkEvidence: true,
    hasCommitSubmission: true,
    hasFinalSubmission: false,
    hasAiInteraction: false,
    hasTranscriptEvidence: false,
    hasTestEvidence: true,
    evidenceCounts: [],
    sourceRefCounts: [],
    latestEvent: null,
    commit: {
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: null,
      branchName: 'pipe-assessment',
      baseCommitSha: 'd'.repeat(40),
      commitSha: 'c'.repeat(40),
      commitUrl: null,
      changedFiles: [],
      occurredAt: '2026-07-03T20:00:00.000Z',
    },
    evaluation: null,
    ...input,
  };
}

describe('assessmentSubmissionState', () => {
  it('keeps pre-submit assessments open for Submit Work', () => {
    const pending = progress({
      stage: 'WORK_IN_PROGRESS',
      nextAction: 'SUBMIT_COMMIT',
      hasCommitSubmission: false,
      commit: null,
    });

    expect(assessmentSubmissionCaptured(pending)).toBe(false);
    expect(assessmentSubmissionLocked(pending)).toBe(false);
    expect(assessmentSubmissionActionLabel(pending)).toBe('Submit Work');
    expect(assessmentSubmissionLockedReason(pending)).toBeNull();
  });

  it('locks captured commits while evaluation or human review owns the next step', () => {
    const submitted = progress();

    expect(assessmentSubmissionCaptured(submitted)).toBe(true);
    expect(assessmentSubmissionLocked(submitted)).toBe(true);
    expect(assessmentSubmissionActionLabel(submitted)).toBe('Review Submission');
    expect(assessmentSubmissionLockedReason(submitted)).toContain('locked for source-backed evaluation');
  });

  it('uses final-state labels for evaluated reports and diagnostics', () => {
    expect(assessmentSubmissionActionLabel(progress({
      stage: 'EVALUATED',
      nextAction: 'REVIEW_EVALUATION',
      evaluation: {
        status: 'EVALUATED',
        summary: 'Source-backed report ready.',
        createdAt: '2026-07-03T20:02:00.000Z',
      },
    }))).toBe('Report Ready');

    expect(assessmentSubmissionActionLabel(progress({
      stage: 'NEEDS_ATTENTION',
      nextAction: 'RESOLVE_DIAGNOSTIC',
    }))).toBe('Review Status');
  });
});
