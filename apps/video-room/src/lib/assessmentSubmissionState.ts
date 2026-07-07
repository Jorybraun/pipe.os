import type { RoomAssessmentProgressSnapshot } from '../types';

export function assessmentSubmissionCaptured(
  progress: RoomAssessmentProgressSnapshot | null | undefined,
): boolean {
  return Boolean(progress?.hasCommitSubmission && progress.commit?.commitSha);
}

export function assessmentSubmissionLocked(
  progress: RoomAssessmentProgressSnapshot | null | undefined,
): boolean {
  if (!assessmentSubmissionCaptured(progress)) return false;
  return progress?.nextAction !== 'SUBMIT_COMMIT';
}

export function assessmentSubmissionActionLabel(
  progress: RoomAssessmentProgressSnapshot | null | undefined,
  fallback = 'Submit Work',
): string {
  if (!assessmentSubmissionLocked(progress)) return fallback;
  if (progress?.evaluation?.status === 'EVALUATED' || progress?.stage === 'EVALUATED') {
    return 'Report Ready';
  }
  if (progress?.stage === 'NEEDS_ATTENTION' || progress?.nextAction === 'RESOLVE_DIAGNOSTIC') {
    return 'Review Status';
  }
  return 'Review Submission';
}

export function assessmentSubmissionLockedReason(
  progress: RoomAssessmentProgressSnapshot | null | undefined,
): string | null {
  if (!assessmentSubmissionLocked(progress)) return null;
  if (progress?.evaluation?.status === 'EVALUATED' || progress?.stage === 'EVALUATED') {
    return 'Assessment report is ready. The submitted commit is locked for recruiter review.';
  }
  if (progress?.stage === 'NEEDS_ATTENTION' || progress?.nextAction === 'RESOLVE_DIAGNOSTIC') {
    return 'Submission is captured. Review the diagnostic before changing assessment evidence.';
  }
  return 'Submission is captured. The assessment commit is locked for source-backed evaluation.';
}
