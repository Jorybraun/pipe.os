import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Send, TriangleAlert } from 'lucide-react';
import {
  buildCommitSubmissionPayload,
  buildCommitSubmissionDefaults,
  type CommitSubmissionFormFields,
} from '../lib/commitSubmission';
import { summarizeChallengePacket } from '../lib/challengePacketSummary';
import type {
  RoomCommitSubmissionRequest,
  RoomCommitSubmissionResponse,
  RoomAssessmentChallengePacketContract,
  RoomAssessmentProgressSnapshot,
  RoomWorkspaceFinalizeRequest,
  RoomWorkspaceFinalizeResponse,
  RoomWorkspaceChallengePacket,
} from '../types';

interface CommitSubmissionPanelProps {
  defaultRepositoryUrl: string | null;
  challengePacket?: RoomWorkspaceChallengePacket | null;
  assessmentProgress?: RoomAssessmentProgressSnapshot | null;
  disabledReason?: string | null;
  onSubmit: (payload: RoomCommitSubmissionRequest) => Promise<RoomCommitSubmissionResponse>;
  onProgressChange?: (progress: RoomAssessmentProgressSnapshot) => void;
  workspaceFinalizeAvailable?: boolean;
  workspaceFinalizeDisabledReason?: string | null;
  onFinalizeWorkspace?: (payload: RoomWorkspaceFinalizeRequest) => Promise<RoomWorkspaceFinalizeResponse>;
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
const GIT_COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/i;

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

function hasCompleteChallengePacket(progress: RoomAssessmentProgressSnapshot): boolean {
  return progress.challengePacketContract
    ? progress.challengePacketContract.isComplete
    : progress.hasChallengePacket;
}

function challengePacketMissingFields(
  packet: RoomWorkspaceChallengePacket | null | undefined,
  contract: RoomAssessmentChallengePacketContract | null | undefined,
): string[] {
  if (contract) return contract.isComplete ? [] : contract.missingFields;
  if (!packet) return ['repo URL', 'base commit SHA', 'task', 'success criteria', 'expected evidence'];

  const summary = summarizeChallengePacket(packet);
  const missing: string[] = [];
  if (!summary.repositoryUrl) missing.push('repo URL');
  if (!summary.baseCommitSha || !GIT_COMMIT_SHA_PATTERN.test(summary.baseCommitSha)) {
    missing.push('base commit SHA');
  }
  if (!summary.task) missing.push('task');
  if (summary.successCriteria.length === 0) missing.push('success criteria');
  if (summary.expectedEvidence.length === 0) missing.push('expected evidence');
  return missing;
}

function challengePacketDisabledReason(
  packet: RoomWorkspaceChallengePacket | null | undefined,
  progress: RoomAssessmentProgressSnapshot | null | undefined,
): string | null {
  const missing = challengePacketMissingFields(packet, progress?.challengePacketContract);
  if (missing.length === 0) return null;
  return packet
    ? `Complete the source-backed challenge packet before submitting work. Missing ${missing.join(', ')}.`
    : 'Assign a complete source-backed challenge packet before submitting work.';
}

function isDirtyWorkspaceFinalizeError(message: string | null): boolean {
  return message?.toLowerCase().includes('commit or discard uncommitted workspace changes') ?? false;
}

function WorkspaceFinalizeRecovery({
  error,
}: {
  error: string | null;
}): JSX.Element | null {
  if (!isDirtyWorkspaceFinalizeError(error)) return null;

  return (
    <section
      className="workspace-finalize-recovery"
      data-testid="workspace-finalize-recovery"
      aria-label="Workspace finalization recovery"
    >
      <strong>Commit workspace changes first</strong>
      <span>Run these in the workspace terminal, then click Finalize from workspace again.</span>
      <ol>
        <li><code>git status --short</code></li>
        <li><code>git add &lt;files&gt;</code></li>
        <li><code>git commit -m "pipe assessment submission"</code></li>
      </ol>
    </section>
  );
}

function WorkspaceFinalizeTrustContract(): JSX.Element {
  return (
    <div
      className="workspace-finalize-trust-contract"
      data-testid="workspace-finalize-trust-contract"
      aria-label="Workspace finalizer trust contract"
    >
      <strong>Trusted finalizer path</strong>
      <ul>
        <li>Reads the current git HEAD inside the controlled workspace.</li>
        <li>Verifies repository and base commit against the assigned challenge packet.</li>
        <li>Captures changed files, source diff, and configured verification output or an explicit gap.</li>
        <li>Stores source refs for the commit, diff, tests, and workspace state before evaluation.</li>
      </ul>
    </div>
  );
}

function EvidenceStatusChip({
  label,
  captured,
}: {
  label: string;
  captured: boolean;
}): JSX.Element {
  return (
    <span className={captured ? 'is-captured' : 'is-missing'}>
      {label}: {evidenceFlagLabel(captured)}
    </span>
  );
}

function AssessmentReadinessPanel({
  progress,
}: {
  progress: RoomAssessmentProgressSnapshot;
}): JSX.Element | null {
  const readiness = progress.readiness;
  if (!readiness) return null;
  const requiredPreview = readiness.required.slice(0, 5);

  return (
    <section
      className="commit-submission-readiness"
      data-testid="commit-submission-readiness"
      aria-label="Assessment readiness"
    >
      <div className="commit-submission-readiness-header">
        <strong>{readiness.label}</strong>
        <span>
          {readiness.isReadyForEvaluation
            ? 'Ready'
            : `${readiness.missingRequiredCount} missing`}
        </span>
      </div>
      <p>{readiness.detail}</p>
      <ul className="commit-submission-readiness-list">
        {requiredPreview.map((item) => (
          <li key={item.id} className={item.satisfied ? 'is-captured' : 'is-missing'}>
            <span>{item.label}</span>
            <span>{item.satisfied ? 'Captured' : 'Missing'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChallengeCompletionPanel({
  packet,
  progress,
}: {
  packet: RoomWorkspaceChallengePacket | null | undefined;
  progress: RoomAssessmentProgressSnapshot | null;
}): JSX.Element {
  const summary = summarizeChallengePacket(packet);
  const missingFields = challengePacketMissingFields(packet, progress?.challengePacketContract);
  const hasCompletePacket = missingFields.length === 0;
  const hasLocator = Boolean(summary.repositoryUrl || summary.githubPrNumber || summary.baseCommitSha);
  const hasContract = Boolean(
    summary.task
    || summary.successCriteria.length > 0
    || summary.expectedEvidence.length > 0,
  );

  return (
    <section
      className="commit-submission-completion"
      data-testid="commit-submission-completion"
      aria-label="Open-source assessment completion"
    >
      <div className="commit-submission-completion-header">
        <strong>{packet ? 'Assigned open-source challenge' : 'Challenge packet missing'}</strong>
        <span>
          {missingFields.length > 0
            ? `Complete packet before submission: missing ${missingFields.join(', ')}.`
            : progress?.nextActionLabel ?? 'Submit the assessment branch commit with exact source evidence.'}
        </span>
      </div>

      {hasLocator && (
        <dl className="commit-submission-completion-locator">
          {summary.repositoryUrl && (
            <>
              <dt>Repo</dt>
              <dd>{summary.repositoryUrl}</dd>
            </>
          )}
          {summary.githubPrNumber && (
            <>
              <dt>PR</dt>
              <dd>#{summary.githubPrNumber}</dd>
            </>
          )}
          {summary.baseCommitSha && (
            <>
              <dt>Base</dt>
              <dd>{summary.baseCommitSha}</dd>
            </>
          )}
        </dl>
      )}

      {hasContract && (
        <div className="commit-submission-completion-contract">
          {summary.task && (
            <div>
              <strong>Task</strong>
              <p>{summary.task}</p>
            </div>
          )}
          {summary.successCriteria.length > 0 && (
            <div>
              <strong>Success criteria</strong>
              <ul>
                {summary.successCriteria.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
          {summary.expectedEvidence.length > 0 && (
            <div>
              <strong>Expected evidence</strong>
              <ul>
                {summary.expectedEvidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {progress && (
        <div className="commit-submission-completion-flags" data-testid="commit-submission-completion-flags">
          <EvidenceStatusChip label="Complete challenge packet" captured={hasCompletePacket} />
          <EvidenceStatusChip label="Work evidence" captured={progress.hasWorkEvidence} />
          <EvidenceStatusChip label="Chat evidence" captured={Boolean(progress.hasMessageEvidence)} />
          <EvidenceStatusChip label="Workspace telemetry" captured={Boolean(progress.hasDevContainerEvidence)} />
          <EvidenceStatusChip label="Tool activity" captured={Boolean(progress.hasToolUsageEvidence)} />
          <EvidenceStatusChip label="Commit submission" captured={progress.hasCommitSubmission} />
          <EvidenceStatusChip label="Test evidence" captured={progress.hasTestEvidence} />
          <EvidenceStatusChip label="AI interaction" captured={progress.hasAiInteraction} />
          <EvidenceStatusChip label="Transcript evidence" captured={progress.hasTranscriptEvidence} />
        </div>
      )}
      {missingFields.length > 0 && (
        <div className="commit-submission-status is-blocked" data-testid="commit-submission-challenge-warning">
          <TriangleAlert size={16} />
          <span>
            {packet
              ? `Challenge packet incomplete: missing ${missingFields.join(', ')}.`
              : 'Challenge packet missing: assign a repo URL, base commit, task, success criteria, and expected evidence.'}
          </span>
        </div>
      )}
    </section>
  );
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
  const hasCompletePacket = hasCompleteChallengePacket(progress);
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

      <AssessmentReadinessPanel progress={progress} />

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
            <dt>Commit integrity</dt>
            <dd data-testid="commit-submission-progress-source">
              {progress.commit.integrity
                ? `${progress.commit.integrity.label}: ${progress.commit.integrity.detail}`
                : progress.commit.submissionSourceLabel ?? 'Unknown capture source'}
            </dd>
            {progress.commit.challengeBinding && (
              <>
                <dt>Challenge binding</dt>
                <dd data-testid="commit-submission-progress-challenge-binding">
                  {`${progress.commit.challengeBinding.label}: ${progress.commit.challengeBinding.detail}`}
                </dd>
              </>
            )}
            {baseSha && (
              <>
                <dt>Base</dt>
                <dd>{baseSha}</dd>
              </>
            )}
            {progress.commit.upstreamPullRequestUrl && progress.commit.upstreamPrConsent && (
              <>
                <dt>Upstream PR</dt>
                <dd data-testid="commit-submission-progress-upstream-pr">
                  {progress.commit.upstreamPullRequestUrl} · candidate-approved tracking
                </dd>
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
        <span>Complete challenge packet: {evidenceFlagLabel(hasCompletePacket)}</span>
        <span>Work evidence: {evidenceFlagLabel(progress.hasWorkEvidence)}</span>
        <span>Chat evidence: {evidenceFlagLabel(Boolean(progress.hasMessageEvidence))}</span>
        <span>Workspace telemetry: {evidenceFlagLabel(Boolean(progress.hasDevContainerEvidence))}</span>
        <span>Tool activity: {evidenceFlagLabel(Boolean(progress.hasToolUsageEvidence))}</span>
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

export function CommitSubmissionPanel({
  defaultRepositoryUrl,
  challengePacket,
  assessmentProgress = null,
  disabledReason,
  onSubmit,
  onProgressChange,
  workspaceFinalizeAvailable = false,
  workspaceFinalizeDisabledReason = null,
  onFinalizeWorkspace,
}: CommitSubmissionPanelProps): JSX.Element {
  const submissionDefaults = buildCommitSubmissionDefaults({
    repositoryUrl: defaultRepositoryUrl,
    challengePacket,
  });
  const [fields, setFields] = useState<CommitSubmissionFormFields>({
    ...EMPTY_FIELDS,
    ...submissionDefaults,
  });
  const [submitting, setSubmitting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RoomCommitSubmissionResponse | null>(null);
  const [workspaceFinalizeResult, setWorkspaceFinalizeResult] = useState<RoomWorkspaceFinalizeResponse | null>(null);
  const [workspaceFinalizeFields, setWorkspaceFinalizeFields] = useState<Required<RoomWorkspaceFinalizeRequest>>({
    narrative: '',
    testCommand: '',
    verificationNotes: '',
  });
  const displayedProgress = workspaceFinalizeResult?.progress ?? result?.progress ?? assessmentProgress;
  const challengeDisabledReason = challengePacketDisabledReason(challengePacket, displayedProgress);
  const effectiveDisabledReason = disabledReason ?? challengeDisabledReason;
  const workspaceFinalizeBlockedReason = effectiveDisabledReason
    ?? workspaceFinalizeDisabledReason
    ?? (!workspaceFinalizeAvailable ? 'Launch the workspace before finalizing the assessment commit.' : null);

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

  const setWorkspaceFinalizeField = (key: keyof RoomWorkspaceFinalizeRequest, value: string): void => {
    setWorkspaceFinalizeFields((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const handleWorkspaceFinalize = async (): Promise<void> => {
    if (workspaceFinalizeBlockedReason) {
      setError(workspaceFinalizeBlockedReason);
      return;
    }
    if (!onFinalizeWorkspace) {
      setError('Workspace finalizer is not connected for this room.');
      return;
    }
    setFinalizing(true);
    setError(null);
    setResult(null);
    setWorkspaceFinalizeResult(null);
    try {
      const payload: RoomWorkspaceFinalizeRequest = {};
      const narrative = workspaceFinalizeFields.narrative.trim();
      const testCommand = workspaceFinalizeFields.testCommand.trim();
      const verificationNotes = workspaceFinalizeFields.verificationNotes.trim();
      if (narrative) payload.narrative = narrative;
      if (testCommand) payload.testCommand = testCommand;
      if (verificationNotes) payload.verificationNotes = verificationNotes;
      const response = await onFinalizeWorkspace(payload);
      setWorkspaceFinalizeResult(response);
      if (response.progress) onProgressChange?.(response.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workspace finalization failed.');
    } finally {
      setFinalizing(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (effectiveDisabledReason) {
      setError(effectiveDisabledReason);
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const payload = await buildCommitSubmissionPayload(fields);
      const response = await onSubmit(payload);
      setResult(response);
      setWorkspaceFinalizeResult(null);
      onProgressChange?.(response.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="commit-submission-panel" onSubmit={(event) => void handleSubmit(event)}>
      <section className="commit-submission-boundary" data-testid="commit-submission-boundary">
        <strong>Assessment branch first</strong>
        <span>
          Submit the real commit from the assessment branch or fork. Upstream PR tracking is optional and requires explicit approval.
        </span>
      </section>

      <ChallengeCompletionPanel packet={challengePacket} progress={displayedProgress} />

      <section className="commit-submission-workspace-finalize" data-testid="commit-submission-workspace-finalize">
        <div className="commit-submission-workspace-finalize-header">
          <strong>Workspace commit</strong>
          <span>Submit the current assessment branch HEAD with configured verification or an explicit gap.</span>
        </div>
        <WorkspaceFinalizeTrustContract />
        <label>
          <span>Submission note</span>
          <textarea
            value={workspaceFinalizeFields.narrative}
            onChange={(event) => setWorkspaceFinalizeField('narrative', event.target.value)}
            placeholder="Focused retry fix; targeted tests pass."
            disabled={Boolean(workspaceFinalizeBlockedReason) || finalizing || submitting}
            rows={2}
            data-testid="workspace-finalize-narrative"
          />
        </label>
        <label>
          <span>Verification command</span>
          <input
            value={workspaceFinalizeFields.testCommand}
            onChange={(event) => setWorkspaceFinalizeField('testCommand', event.target.value)}
            placeholder="npm test -- retry"
            disabled={Boolean(workspaceFinalizeBlockedReason) || finalizing || submitting}
            data-testid="workspace-finalize-test-command"
          />
        </label>
        <label>
          <span>Missing-test note</span>
          <textarea
            value={workspaceFinalizeFields.verificationNotes}
            onChange={(event) => setWorkspaceFinalizeField('verificationNotes', event.target.value)}
            placeholder="If tests could not run, say exactly why."
            disabled={Boolean(workspaceFinalizeBlockedReason) || finalizing || submitting}
            rows={2}
            data-testid="workspace-finalize-verification-notes"
          />
        </label>
        <button
          type="button"
          className="room-workspace-launch-btn"
          onClick={() => void handleWorkspaceFinalize()}
          disabled={Boolean(workspaceFinalizeBlockedReason) || finalizing || submitting}
          data-testid="workspace-finalize-submit"
        >
          {finalizing ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
          Finalize from workspace
        </button>
        {workspaceFinalizeBlockedReason && (
          <div className="commit-submission-status is-blocked" data-testid="workspace-finalize-disabled">
            <TriangleAlert size={16} />
            <span>{workspaceFinalizeBlockedReason}</span>
          </div>
        )}
        {workspaceFinalizeResult?.submission && (
          <div className="commit-submission-status is-success" data-testid="workspace-finalize-success">
            <CheckCircle2 size={16} />
            <span>
              Submitted {shortSha(workspaceFinalizeResult.submission.commitSha)} from {workspaceFinalizeResult.submission.branchName}.
            </span>
          </div>
        )}
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

      {effectiveDisabledReason && (
        <div className="commit-submission-status is-blocked" data-testid="commit-submission-disabled">
          <TriangleAlert size={16} />
          <span>{effectiveDisabledReason}</span>
        </div>
      )}
      {error && (
        <div className="commit-submission-status is-error" data-testid="commit-submission-error">
          <TriangleAlert size={16} />
          <span>{error}</span>
        </div>
      )}
      <WorkspaceFinalizeRecovery error={error} />
      {result && (
        <div className="commit-submission-status is-success" data-testid="commit-submission-success">
          <CheckCircle2 size={16} />
          <span>{result.progress.nextActionLabel}</span>
        </div>
      )}
      {displayedProgress && (
        <AssessmentProgressPanel progress={displayedProgress} />
      )}

      <div className="commit-submission-actions">
        <button
          type="submit"
          className="room-workspace-launch-btn"
          disabled={Boolean(effectiveDisabledReason) || submitting}
          data-testid="commit-submission-submit"
        >
          {submitting ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          Submit commit
        </button>
      </div>
    </form>
  );
}
