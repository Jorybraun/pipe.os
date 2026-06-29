import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Send, TriangleAlert } from 'lucide-react';
import {
  buildCommitSubmissionPayload,
  buildCommitSubmissionDefaults,
  type CommitSubmissionFormFields,
} from '../lib/commitSubmission';
import type {
  RoomCommitSubmissionRequest,
  RoomCommitSubmissionResponse,
  RoomAssessmentProgressSnapshot,
  RoomWorkspaceChallengePacket,
} from '../types';

interface CommitSubmissionWindowProps {
  defaultRepositoryUrl: string | null;
  challengePacket?: RoomWorkspaceChallengePacket | null;
  disabledReason?: string | null;
  onSubmit: (payload: RoomCommitSubmissionRequest) => Promise<RoomCommitSubmissionResponse>;
  onProgressChange?: (progress: RoomAssessmentProgressSnapshot) => void;
}

const EMPTY_FIELDS: CommitSubmissionFormFields = {
  narrative: '',
  repositoryUrl: '',
  forkRepositoryUrl: '',
  branchName: '',
  baseCommitSha: '',
  commitSha: '',
  commitUrl: '',
  upstreamPullRequestUrl: '',
  upstreamPrConsent: false,
  changedFilesText: '',
  commitEvidenceText: '',
  diffText: '',
  testEvidenceText: '',
  verificationNotesText: '',
};

function formatProgressLabel(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return 'Unknown';
  return normalized
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatEvidenceKind(kind: string): string {
  return kind.trim().replace(/[_-]+/g, ' ').toLowerCase();
}

function shortSha(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 12) : null;
}

function evidenceFlagLabel(value: boolean): string {
  return value ? 'Captured' : 'Missing';
}

function AssessmentProgressPanel({
  progress,
}: {
  progress: RoomAssessmentProgressSnapshot;
}): JSX.Element {
  const commitSha = shortSha(progress.commit?.commitSha ?? null);
  const baseSha = shortSha(progress.commit?.baseCommitSha ?? null);
  const changedFileCount = progress.commit?.changedFiles.length ?? 0;
  const sourceRefCounts = progress.sourceRefCounts ?? [];
  const hasVerificationGap = progress.hasVerificationGap === true
    || sourceRefCounts.some((evidence) => evidence.kind === 'verification_gap' && evidence.count > 0);
  const latestEventLabel = progress.latestEvent
    ? `${formatProgressLabel(progress.latestEvent.kind)} #${progress.latestEvent.sequence}`
    : null;

  return (
    <section
      className="commit-submission-progress"
      data-testid="commit-submission-progress"
      aria-label="Assessment progress"
    >
      <div className="commit-submission-progress-header">
        <CheckCircle2 size={16} />
        <div>
          <strong>Assessment progress</strong>
          <span>{progress.nextActionLabel}</span>
        </div>
      </div>

      <dl className="commit-submission-progress-grid">
        <dt>Mode</dt>
        <dd>{formatProgressLabel(progress.mode)}</dd>
        <dt>Stage</dt>
        <dd data-testid="commit-submission-progress-stage">{formatProgressLabel(progress.stage)}</dd>
        <dt>State</dt>
        <dd>{formatProgressLabel(progress.state)}</dd>
        {progress.commit && (
          <>
            <dt>Commit</dt>
            <dd data-testid="commit-submission-progress-commit">{commitSha ?? 'Recorded'}</dd>
            <dt>Branch</dt>
            <dd>{progress.commit.branchName ?? 'Recorded'}</dd>
            {baseSha && (
              <>
                <dt>Base</dt>
                <dd>{baseSha}</dd>
              </>
            )}
            <dt>Changed files</dt>
            <dd>{changedFileCount}</dd>
          </>
        )}
        {latestEventLabel && (
          <>
            <dt>Latest event</dt>
            <dd>{latestEventLabel}</dd>
          </>
        )}
        {progress.evaluation && (
          <>
            <dt>Evaluation</dt>
            <dd>
              {formatProgressLabel(progress.evaluation.status)}
              {progress.evaluation.summary ? ` - ${progress.evaluation.summary}` : ''}
            </dd>
          </>
        )}
      </dl>

      <div className="commit-submission-progress-flags">
        <span>Challenge packet: {evidenceFlagLabel(progress.hasChallengePacket)}</span>
        <span>Work evidence: {evidenceFlagLabel(progress.hasWorkEvidence)}</span>
        <span>Commit submission: {evidenceFlagLabel(progress.hasCommitSubmission)}</span>
        <span>AI interaction: {evidenceFlagLabel(progress.hasAiInteraction)}</span>
        <span>Transcript evidence: {evidenceFlagLabel(progress.hasTranscriptEvidence)}</span>
        <span>Test evidence: {evidenceFlagLabel(progress.hasTestEvidence)}</span>
        {hasVerificationGap && <span>Verification gap: Captured</span>}
      </div>

      {progress.evidenceCounts.length > 0 && (
        <ul className="commit-submission-evidence-counts" data-testid="commit-submission-evidence-counts">
          {progress.evidenceCounts.map((evidence) => (
            <li key={evidence.kind}>
              <strong>{evidence.count}</strong>
              <span>{formatEvidenceKind(evidence.kind)}</span>
            </li>
          ))}
        </ul>
      )}
      {sourceRefCounts.length > 0 && (
        <ul className="commit-submission-evidence-counts" data-testid="commit-submission-source-ref-counts">
          {sourceRefCounts.map((evidence) => (
            <li key={evidence.kind}>
              <strong>{evidence.count}</strong>
              <span>{formatEvidenceKind(evidence.kind)} source</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CommitSubmissionWindow({
  defaultRepositoryUrl,
  challengePacket,
  disabledReason,
  onSubmit,
  onProgressChange,
}: CommitSubmissionWindowProps): JSX.Element {
  const submissionDefaults = buildCommitSubmissionDefaults({
    repositoryUrl: defaultRepositoryUrl,
    challengePacket,
  });
  const [fields, setFields] = useState<CommitSubmissionFormFields>({
    ...EMPTY_FIELDS,
    ...submissionDefaults,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RoomCommitSubmissionResponse | null>(null);

  useEffect(() => {
    setFields((current) => (
      {
        ...current,
        repositoryUrl: current.repositoryUrl.trim()
          ? current.repositoryUrl
          : submissionDefaults.repositoryUrl,
        branchName: current.branchName.trim()
          ? current.branchName
          : submissionDefaults.branchName,
        baseCommitSha: current.baseCommitSha.trim()
          ? current.baseCommitSha
          : submissionDefaults.baseCommitSha,
      }
    ));
  }, [
    submissionDefaults.repositoryUrl,
    submissionDefaults.branchName,
    submissionDefaults.baseCommitSha,
  ]);

  const setField = (key: keyof CommitSubmissionFormFields, value: string | boolean): void => {
    setFields((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (disabledReason) {
      setError(disabledReason);
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const payload = await buildCommitSubmissionPayload(fields);
      const response = await onSubmit(payload);
      setResult(response);
      onProgressChange?.(response.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="commit-submission-window" onSubmit={(event) => void handleSubmit(event)}>
      <section className="commit-submission-boundary" data-testid="commit-submission-boundary">
        <strong>Assessment branch first</strong>
        <span>
          Submit the real commit from the assessment branch or fork. Upstream PR tracking is optional and requires explicit approval.
        </span>
      </section>

      <section className="commit-submission-checklist" data-testid="commit-submission-checklist">
        <strong>Paste evidence from the workspace</strong>
        <ol>
          <li><code>git rev-parse HEAD</code> for the submitted commit SHA.</li>
          <li><code>git show --stat --no-patch HEAD</code> for commit evidence.</li>
          <li><code>git diff BASE..HEAD</code> for source-backed diff evidence.</li>
          <li>Run the relevant test command, or explain the exact verification gap.</li>
        </ol>
      </section>

      <div className="commit-submission-grid">
        <label>
          <span>Repository URL</span>
          <input
            value={fields.repositoryUrl}
            onChange={(event) => setField('repositoryUrl', event.target.value)}
            placeholder="https://github.com/org/repo"
            disabled={Boolean(disabledReason) || submitting}
            data-testid="commit-submission-repository-url"
          />
        </label>
        <label>
          <span>Fork URL</span>
          <input
            value={fields.forkRepositoryUrl}
            onChange={(event) => setField('forkRepositoryUrl', event.target.value)}
            placeholder="https://github.com/you/repo"
            disabled={Boolean(disabledReason) || submitting}
          />
        </label>
        <label>
          <span>Branch</span>
          <input
            value={fields.branchName}
            onChange={(event) => setField('branchName', event.target.value)}
            placeholder="pipe-assessment/my-fix"
            disabled={Boolean(disabledReason) || submitting}
            data-testid="commit-submission-branch"
          />
        </label>
        <label>
          <span>Changed files</span>
          <textarea
            value={fields.changedFilesText}
            onChange={(event) => setField('changedFilesText', event.target.value)}
            placeholder="modified src/retry.ts"
            disabled={Boolean(disabledReason) || submitting}
            rows={3}
            data-testid="commit-submission-changed-files"
          />
        </label>
        <label>
          <span>Base commit SHA</span>
          <input
            value={fields.baseCommitSha}
            onChange={(event) => setField('baseCommitSha', event.target.value)}
            placeholder="40-char SHA"
            disabled={Boolean(disabledReason) || submitting}
            data-testid="commit-submission-base-sha"
          />
        </label>
        <label>
          <span>Commit SHA</span>
          <input
            value={fields.commitSha}
            onChange={(event) => setField('commitSha', event.target.value)}
            placeholder="40-char SHA"
            disabled={Boolean(disabledReason) || submitting}
            data-testid="commit-submission-commit-sha"
          />
        </label>
        <label>
          <span>Commit URL</span>
          <input
            value={fields.commitUrl}
            onChange={(event) => setField('commitUrl', event.target.value)}
            placeholder="https://github.com/you/repo/commit/..."
            disabled={Boolean(disabledReason) || submitting}
          />
        </label>
        <label>
          <span>Upstream PR URL</span>
          <input
            value={fields.upstreamPullRequestUrl}
            onChange={(event) => setField('upstreamPullRequestUrl', event.target.value)}
            placeholder="https://github.com/org/repo/pull/123"
            disabled={Boolean(disabledReason) || submitting}
            data-testid="commit-submission-upstream-pr-url"
          />
        </label>
      </div>

      <label className="commit-submission-checkbox">
        <input
          type="checkbox"
          checked={fields.upstreamPrConsent}
          onChange={(event) => setField('upstreamPrConsent', event.target.checked)}
          disabled={Boolean(disabledReason) || submitting}
          data-testid="commit-submission-upstream-consent"
        />
        <span>Candidate approved optional upstream PR tracking</span>
      </label>

      <label>
        <span>Submission note</span>
        <textarea
          value={fields.narrative}
          onChange={(event) => setField('narrative', event.target.value)}
          placeholder="Submitted retry fix; tests passing locally."
          disabled={Boolean(disabledReason) || submitting}
          rows={2}
          data-testid="commit-submission-narrative"
        />
      </label>

      <label>
        <span>Commit evidence</span>
        <textarea
          value={fields.commitEvidenceText}
          onChange={(event) => setField('commitEvidenceText', event.target.value)}
          placeholder="Paste git show --stat --no-patch output"
          disabled={Boolean(disabledReason) || submitting}
          rows={5}
          data-testid="commit-submission-commit-evidence"
        />
      </label>

      <label>
        <span>Diff evidence</span>
        <textarea
          value={fields.diffText}
          onChange={(event) => setField('diffText', event.target.value)}
          placeholder="Paste git diff BASE..COMMIT"
          disabled={Boolean(disabledReason) || submitting}
          rows={7}
          data-testid="commit-submission-diff"
        />
      </label>

      <label>
        <span>Test evidence</span>
        <textarea
          value={fields.testEvidenceText}
          onChange={(event) => setField('testEvidenceText', event.target.value)}
          placeholder="Paste test command output, e.g. npm test -- retry"
          disabled={Boolean(disabledReason) || submitting}
          rows={4}
          data-testid="commit-submission-test-evidence"
        />
      </label>

      <label>
        <span>Missing test note</span>
        <textarea
          value={fields.verificationNotesText}
          onChange={(event) => setField('verificationNotesText', event.target.value)}
          placeholder="If test output is missing, record why and what remains unverified."
          disabled={Boolean(disabledReason) || submitting}
          rows={3}
          data-testid="commit-submission-verification-notes"
        />
      </label>

      {disabledReason && (
        <div className="commit-submission-status is-blocked" data-testid="commit-submission-disabled">
          <TriangleAlert size={16} />
          <span>{disabledReason}</span>
        </div>
      )}
      {error && (
        <div className="commit-submission-status is-error" data-testid="commit-submission-error">
          <TriangleAlert size={16} />
          <span>{error}</span>
        </div>
      )}
      {result && (
        <div className="commit-submission-status is-success" data-testid="commit-submission-success">
          <CheckCircle2 size={16} />
          <span>{result.progress.nextActionLabel}</span>
        </div>
      )}
      {result && (
        <AssessmentProgressPanel progress={result.progress} />
      )}

      <div className="commit-submission-actions">
        <button
          type="submit"
          className="win95-workspace-launch-btn"
          disabled={Boolean(disabledReason) || submitting}
          data-testid="commit-submission-submit"
        >
          {submitting ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          Submit commit
        </button>
      </div>
    </form>
  );
}
