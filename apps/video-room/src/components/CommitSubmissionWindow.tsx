import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Send, TriangleAlert } from 'lucide-react';
import {
  buildCommitSubmissionPayload,
  type CommitSubmissionFormFields,
} from '../lib/commitSubmission';
import type { RoomCommitSubmissionRequest, RoomCommitSubmissionResponse } from '../types';

interface CommitSubmissionWindowProps {
  defaultRepositoryUrl: string | null;
  disabledReason?: string | null;
  onSubmit: (payload: RoomCommitSubmissionRequest) => Promise<RoomCommitSubmissionResponse>;
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
};

export function CommitSubmissionWindow({
  defaultRepositoryUrl,
  disabledReason,
  onSubmit,
}: CommitSubmissionWindowProps): JSX.Element {
  const [fields, setFields] = useState<CommitSubmissionFormFields>({
    ...EMPTY_FIELDS,
    repositoryUrl: defaultRepositoryUrl ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RoomCommitSubmissionResponse | null>(null);

  useEffect(() => {
    if (!defaultRepositoryUrl) return;
    setFields((current) => (
      current.repositoryUrl.trim()
        ? current
        : { ...current, repositoryUrl: defaultRepositoryUrl }
    ));
  }, [defaultRepositoryUrl]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="commit-submission-window" onSubmit={(event) => void handleSubmit(event)}>
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
          />
        </label>
      </div>

      <label className="commit-submission-checkbox">
        <input
          type="checkbox"
          checked={fields.upstreamPrConsent}
          onChange={(event) => setField('upstreamPrConsent', event.target.checked)}
          disabled={Boolean(disabledReason) || submitting}
        />
        <span>Candidate approved upstream PR tracking</span>
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
