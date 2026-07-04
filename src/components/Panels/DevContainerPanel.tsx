/**
 * DevContainerPanel
 *
 * Renders a code-server dev container inside the candidate assessment flow.
 * ADR-037: the panel is selected by the CODE_IMPLEMENTATION blueprint when a
 * challenge has `devContainerRepoUrl` set. Mounts a session via
 * `useDevContainerSession` on first render and swaps to a proxied iframe
 * once the container reaches READY.
 */

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useSessionToken } from '../../contexts/SessionTokenContext';
import { useDevContainerSession } from '../../hooks/useDevContainerSession';
import {
  buildCandidateCommitSubmissionDefaults,
  buildCandidateCommitSubmissionPayload,
  getCandidateAssessmentProgress,
  submitCandidateAssessmentCommit,
  type CandidateAssessmentProgress,
  type CandidateCommitSubmissionFormFields,
} from '../../lib/assessmentCommitSubmission';
import { finalizeDevContainerAssessment } from '../../lib/devContainerClient';

export interface DevContainerPanelProps {
  challengeId: string;
}

function formatRemaining(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const EMPTY_COMMIT_FIELDS: CandidateCommitSubmissionFormFields = {
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

function shortSha(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 12) : null;
}

function challengePacketSubmissionBlocker(progress: CandidateAssessmentProgress | null): string | null {
  if (!progress) return 'Assessment session is not ready for commit submission.';
  if (progress.challengePacketContract) {
    if (progress.challengePacketContract.isComplete) return null;
    const missingFields = progress.challengePacketContract.missingFields
      .map((field) => field.trim())
      .filter(Boolean);
    return missingFields.length > 0
      ? `Complete the source-backed challenge packet before submitting work. Missing ${missingFields.join(', ')}.`
      : 'Complete the source-backed challenge packet before submitting work.';
  }
  return progress.hasChallengePacket
    ? null
    : 'Assign a complete source-backed challenge packet before submitting work.';
}

function isDirtyWorkspaceFinalizeError(message: string | null): boolean {
  return message?.toLowerCase().includes('commit or discard uncommitted workspace changes') ?? false;
}

function locatorText(
  progress: CandidateAssessmentProgress | null,
  keys: readonly string[],
): string | null {
  const locator = progress?.challenge?.locator;
  if (!locator) return null;
  for (const key of keys) {
    const value = locator[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function compactText(value: string | null | undefined, max = 180): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) return 'Task packet loading from source evidence.';
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}...`;
}

function proofTone(satisfied: boolean, warning = false): 'good' | 'warn' | 'quiet' {
  if (satisfied) return 'good';
  return warning ? 'warn' : 'quiet';
}

function pillStyle(tone: 'good' | 'warn' | 'quiet'): CSSProperties {
  const palette = {
    good: {
      border: 'rgba(74,222,128,0.38)',
      background: 'rgba(74,222,128,0.08)',
      color: '#86efac',
    },
    warn: {
      border: 'rgba(251,191,36,0.42)',
      background: 'rgba(251,191,36,0.09)',
      color: '#fde68a',
    },
    quiet: {
      border: 'rgba(148,163,184,0.28)',
      background: 'rgba(148,163,184,0.08)',
      color: 'var(--pipe-text-dim)',
    },
  }[tone];

  return {
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
    padding: '5px 7px',
    fontSize: 9,
    letterSpacing: '0.1em',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  };
}

function compactList(items: readonly string[], maxItems = 2): string[] {
  return items
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function AssessmentWorkspaceTaskBrief({
  progress,
}: {
  progress: CandidateAssessmentProgress | null;
}): JSX.Element {
  const summary = progress?.challenge?.summary;
  const task = summary?.task?.trim()
    || compactText(progress?.challenge?.exactText, 160);
  const successCriteria = compactList(summary?.successCriteria ?? []);
  const expectedEvidence = compactList(summary?.expectedEvidence ?? [], 3);
  const verificationCommand = summary?.verificationCommand?.trim() ?? null;

  const rows = [
    { label: 'TASK', values: [task] },
    { label: 'SUCCESS', values: successCriteria },
    { label: 'EVIDENCE', values: expectedEvidence },
    ...(verificationCommand ? [{ label: 'VERIFY', values: [verificationCommand] }] : []),
  ].filter((row) => row.values.length > 0);

  return (
    <div
      data-testid="assessment-workspace-task-brief"
      style={{
        display: 'grid',
        gridTemplateColumns: 'max-content minmax(0, 1fr)',
        gap: '4px 8px',
        minWidth: 0,
        fontSize: 10,
        lineHeight: 1.45,
      }}
    >
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'contents' }}>
          <span style={{ color: '#93c5fd', letterSpacing: '0.12em', fontWeight: 800 }}>
            {row.label}
          </span>
          <span style={{ minWidth: 0, color: '#e5e7eb', overflowWrap: 'anywhere' }}>
            {row.values.join(' · ')}
          </span>
        </div>
      ))}
    </div>
  );
}

function AssessmentWorkspaceStatusStrip({
  progress,
  loading,
  error,
  onOpenSubmit,
}: {
  progress: CandidateAssessmentProgress | null;
  loading: boolean;
  error: string | null;
  onOpenSubmit: () => void;
}): JSX.Element {
  const defaults = buildCandidateCommitSubmissionDefaults(progress);
  const repositoryUrl = progress?.commit?.repositoryUrl
    ?? defaults.repositoryUrl
    ?? locatorText(progress, ['repositoryUrl', 'githubRepoUrl', 'repoUrl']);
  const baseCommitSha = progress?.commit?.baseCommitSha
    ?? defaults.baseCommitSha
    ?? locatorText(progress, ['baseCommitSha', 'baseCommit', 'base_commit_sha', 'base_commit']);
  const branchName = progress?.commit?.branchName ?? defaults.branchName;
  const packetComplete = progress?.challengePacketContract?.isComplete === true
    || (progress?.challengePacketContract == null && progress?.hasChallengePacket === true);
  const packetLabel = packetComplete
    ? 'Task packet complete'
    : progress?.hasChallengePacket
      ? 'Task packet incomplete'
      : 'Task packet missing';
  const testsLabel = progress?.hasTestEvidence
    ? 'Tests captured'
    : progress?.hasVerificationGap
      ? 'Test gap declared'
      : 'Tests missing';
  const proofItems = [
    { label: packetLabel, tone: proofTone(packetComplete, true) },
    { label: progress?.hasDevContainerEvidence ? 'Workspace evidence' : 'Workspace pending', tone: proofTone(progress?.hasDevContainerEvidence === true) },
    { label: progress?.hasToolUsageEvidence ? 'Tool activity' : 'Tool activity pending', tone: proofTone(progress?.hasToolUsageEvidence === true) },
    { label: progress?.hasAiInteraction ? 'AI use captured' : 'No AI use captured', tone: progress?.hasAiInteraction ? 'good' : 'quiet' },
    { label: testsLabel, tone: proofTone(progress?.hasTestEvidence === true, progress?.hasVerificationGap === true) },
    { label: progress?.hasCommitSubmission ? 'Commit submitted' : 'Commit required', tone: proofTone(progress?.hasCommitSubmission === true, true) },
  ] as const;

  return (
    <section
      data-testid="assessment-workspace-status-strip"
      aria-label="Assessment workspace status"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 1.3fr) minmax(260px, 1fr) auto',
        gap: 12,
        alignItems: 'stretch',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(148,163,184,0.18)',
        background: 'linear-gradient(180deg, rgba(15,23,42,0.96), rgba(9,9,11,0.96))',
        color: '#f8fafc',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, letterSpacing: '0.16em', color: '#fbbf24', fontWeight: 800 }}>
            SOURCE-BACKED TASK
          </span>
          <span style={{ fontSize: 9, color: loading ? '#fbbf24' : error ? '#f87171' : 'var(--pipe-text-dim)' }}>
            {loading ? 'LOADING' : error ? 'PROGRESS ERROR' : progress?.nextActionLabel ?? 'Assessment state pending'}
          </span>
        </div>
        <AssessmentWorkspaceTaskBrief progress={progress} />
      </div>

      <div
        data-testid="assessment-workspace-assignment-locator"
        style={{
          display: 'grid',
          gap: 5,
          alignContent: 'center',
          borderLeft: '1px solid rgba(148,163,184,0.16)',
          paddingLeft: 12,
          minWidth: 0,
        }}
      >
        <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)' }}>
          Repo: <strong style={{ color: '#bfdbfe' }}>{repositoryUrl || 'waiting for packet'}</strong>
        </span>
        <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)' }}>
          Base: <strong style={{ color: '#bfdbfe' }}>{baseCommitSha ? shortSha(baseCommitSha) : 'waiting'}</strong>
          {branchName ? <> / Branch: <strong style={{ color: '#bfdbfe' }}>{branchName}</strong></> : null}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 8, justifyItems: 'end', alignContent: 'center' }}>
        <div
          data-testid="assessment-workspace-proof-pills"
          style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}
        >
          {proofItems.map((item) => (
            <span key={item.label} style={pillStyle(item.tone)}>
              {item.label}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenSubmit}
          data-testid="assessment-workspace-submit-work"
          style={{
            padding: '7px 12px',
            background: 'rgba(251,191,36,0.18)',
            border: '1px solid rgba(251,191,36,0.52)',
            color: '#fbbf24',
            fontSize: 10,
            letterSpacing: '0.16em',
            fontWeight: 800,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {progress?.hasCommitSubmission ? 'REVIEW SUBMISSION' : 'SUBMIT WORK'}
        </button>
      </div>
    </section>
  );
}

function WorkspaceFinalizeTrustContract(): JSX.Element {
  return (
    <div
      data-testid="assessment-workspace-finalize-trust-contract"
      aria-label="Workspace finalizer trust contract"
      style={{
        gridColumn: '1 / -1',
        border: '1px solid rgba(74,222,128,0.28)',
        background: 'rgba(74,222,128,0.05)',
        padding: 10,
        color: 'var(--pipe-text-dim)',
        fontSize: 10,
        lineHeight: 1.55,
      }}
    >
      <strong style={{ display: 'block', color: '#4ade80', letterSpacing: '0.12em', marginBottom: 4 }}>
        TRUSTED FINALIZER PATH
      </strong>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li>Reads the current git HEAD inside the controlled workspace.</li>
        <li>Verifies repository and base commit against the assigned challenge packet.</li>
        <li>Captures changed files, source diff, and configured verification output or an explicit gap.</li>
        <li>Stores source refs for the commit, diff, tests, and workspace state before evaluation.</li>
      </ul>
    </div>
  );
}

function WorkspaceFinalizeRecovery({ error }: { error: string | null }): JSX.Element | null {
  if (!isDirtyWorkspaceFinalizeError(error)) return null;

  return (
    <div
      data-testid="assessment-workspace-finalize-recovery"
      role="status"
      style={{
        gridColumn: '1 / -1',
        border: '1px solid rgba(251,191,36,0.45)',
        background: 'rgba(251,191,36,0.08)',
        color: '#fde68a',
        padding: 10,
        fontSize: 10,
        lineHeight: 1.55,
      }}
    >
      <strong style={{ display: 'block', color: '#fbbf24', letterSpacing: '0.12em', marginBottom: 4 }}>
        COMMIT WORKSPACE CHANGES FIRST
      </strong>
      <span>Run these in the workspace terminal, then click Finalize workspace head again.</span>
      <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        <li><code>git status --short</code></li>
        <li><code>git add &lt;files&gt;</code></li>
        <li><code>git commit -m "pipe assessment submission"</code></li>
      </ol>
    </div>
  );
}

function fieldStyle(kind: 'input' | 'textarea' = 'input'): CSSProperties {
  return {
    width: '100%',
    minHeight: kind === 'textarea' ? 58 : 34,
    resize: kind === 'textarea' ? 'vertical' : undefined,
    background: '#050507',
    border: '1px solid rgba(148,163,184,0.32)',
    color: '#f8fafc',
    padding: '8px 10px',
    fontSize: 11,
    fontFamily: '"Space Mono", monospace',
    boxSizing: 'border-box',
  };
}

export function DevContainerPanel({ challengeId }: DevContainerPanelProps): JSX.Element {
  const sessionToken = useSessionToken();
  const { state, containerUrl, taskArn, error, expiresAt, expiringSoon, launch, destroy, reset } =
    useDevContainerSession();
  const [submitPanelOpen, setSubmitPanelOpen] = useState(false);
  const [assessmentProgress, setAssessmentProgress] = useState<CandidateAssessmentProgress | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [commitFields, setCommitFields] = useState<CandidateCommitSubmissionFormFields>(EMPTY_COMMIT_FIELDS);
  const [commitSubmitting, setCommitSubmitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState<string | null>(null);
  const [workspaceNarrative, setWorkspaceNarrative] = useState('');
  const [workspaceTestCommand, setWorkspaceTestCommand] = useState('');
  const [workspaceVerificationNotes, setWorkspaceVerificationNotes] = useState('');
  const [workspaceFinalizing, setWorkspaceFinalizing] = useState(false);

  // Auto-launch exactly once when the panel mounts and there is no live
  // session. React strict-mode double-invokes effects in dev, so we guard
  // with a ref instead of relying on `state === 'IDLE'`.
  const launchedRef = useRef(false);
  useEffect(() => {
    if (launchedRef.current) return;
    if (state !== 'IDLE') return;
    launchedRef.current = true;
    void launch({ challengeId });
  }, [challengeId, launch, state]);

  // Tick every second while a session is live so the countdown re-renders.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  useEffect(() => {
    if (state !== 'READY') {
      setAssessmentProgress(null);
      setAssessmentError(null);
      setCommitSuccess(null);
      return;
    }

    let cancelled = false;
    setAssessmentLoading(true);
    setAssessmentError(null);
    void getCandidateAssessmentProgress(sessionToken)
      .then((response) => {
        if (cancelled) return;
        setAssessmentProgress(response.progress);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAssessmentError(err instanceof Error ? err.message : 'Assessment progress could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setAssessmentLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionToken, state]);

  useEffect(() => {
    const defaults = buildCandidateCommitSubmissionDefaults(assessmentProgress);
    setCommitFields((current) => ({
      ...current,
      repositoryUrl: current.repositoryUrl.trim() ? current.repositoryUrl : defaults.repositoryUrl,
      branchName: current.branchName.trim() ? current.branchName : defaults.branchName,
      baseCommitSha: current.baseCommitSha.trim() ? current.baseCommitSha : defaults.baseCommitSha,
    }));

    const verificationCommand = assessmentProgress?.challenge?.summary?.verificationCommand?.trim();
    if (verificationCommand) {
      setWorkspaceTestCommand((current) => current.trim() ? current : verificationCommand);
    }
  }, [assessmentProgress]);

  const remaining = formatRemaining(expiresAt);
  const setCommitField = (
    key: keyof CandidateCommitSubmissionFormFields,
    value: string | boolean,
  ): void => {
    setCommitFields((current) => ({ ...current, [key]: value }));
    setCommitError(null);
    setCommitSuccess(null);
  };

  const handleCommitSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const submissionBlocker = challengePacketSubmissionBlocker(assessmentProgress);
    if (submissionBlocker) {
      setCommitError(submissionBlocker);
      return;
    }
    setCommitSubmitting(true);
    setCommitError(null);
    setCommitSuccess(null);
    try {
      const payload = await buildCandidateCommitSubmissionPayload(commitFields);
      const response = await submitCandidateAssessmentCommit(payload, sessionToken);
      setAssessmentProgress(response.progress);
      setCommitSuccess(response.progress.nextActionLabel);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Commit submission failed.');
    } finally {
      setCommitSubmitting(false);
    }
  };

  const handleWorkspaceFinalize = async (): Promise<void> => {
    if (!taskArn) {
      setCommitError('Dev container session is not ready for workspace finalization.');
      return;
    }
    const submissionBlocker = challengePacketSubmissionBlocker(assessmentProgress);
    if (submissionBlocker) {
      setCommitError(submissionBlocker);
      return;
    }
    setWorkspaceFinalizing(true);
    setCommitError(null);
    setCommitSuccess(null);
    try {
      const response = await finalizeDevContainerAssessment(taskArn, {
        ...(workspaceNarrative.trim() ? { narrative: workspaceNarrative.trim() } : {}),
        ...(workspaceTestCommand.trim() ? { testCommand: workspaceTestCommand.trim() } : {}),
        ...(workspaceVerificationNotes.trim() ? { verificationNotes: workspaceVerificationNotes.trim() } : {}),
      }, sessionToken);
      setAssessmentProgress(response.progress);
      setCommitSuccess(response.progress.commit?.commitSha
        ? `Workspace commit ${shortSha(response.progress.commit.commitSha)} captured. ${response.progress.nextActionLabel}`
        : response.progress.nextActionLabel);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Workspace finalization failed.';
      setCommitError(message);
    } finally {
      setWorkspaceFinalizing(false);
    }
  };

  if (state === 'ERROR') {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0c0c0e',
          color: '#f87171',
          fontFamily: '"Space Mono", monospace',
          padding: 32,
          gap: 16,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: '0.2em', fontWeight: 700 }}>
          DEV CONTAINER ERROR
        </div>
        <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', maxWidth: 480, textAlign: 'center' }}>
          {error ?? 'The dev environment could not start.'}
        </div>
        <button
          onClick={() => {
            launchedRef.current = false;
            reset();
          }}
          style={{
            padding: '10px 20px',
            background: 'rgba(248,113,113,0.15)',
            border: '1px solid rgba(248,113,113,0.4)',
            color: '#f87171',
            fontSize: 11,
            letterSpacing: '0.15em',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          RETRY
        </button>
      </div>
    );
  }

  if (state === 'READY' && containerUrl) {
    const submissionBlocker = challengePacketSubmissionBlocker(assessmentProgress);
    const commitBlocked = Boolean(submissionBlocker) || commitSubmitting;
    const workspaceFinalizeBlocked = Boolean(submissionBlocker) || !taskArn || workspaceFinalizing;
    const commitStatusLabel = assessmentLoading
      ? 'LOADING ASSESSMENT STATE'
      : assessmentProgress?.hasCommitSubmission
        ? `SUBMITTED ${shortSha(assessmentProgress.commit?.commitSha) ?? ''}`.trim()
        : assessmentProgress?.nextActionLabel ?? 'ASSESSMENT SESSION REQUIRED';

    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0c0c0e',
          fontFamily: '"Space Mono", monospace',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            background: 'var(--pipe-surface)',
            borderBottom: '1px solid var(--pipe-border)',
            fontSize: 10,
            letterSpacing: '0.15em',
            color: 'var(--pipe-text-dim)',
          }}
        >
          <span style={{ color: '#4ade80' }}>● DEV CONTAINER LIVE</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ color: assessmentProgress?.hasCommitSubmission ? '#4ade80' : '#fbbf24' }}>
              {commitStatusLabel}
            </span>
            {remaining && (
              <span style={{ color: expiringSoon ? '#fbbf24' : 'var(--pipe-text-dim)' }}>
                TTL {remaining}
              </span>
            )}
            <button
              type="button"
              onClick={() => setSubmitPanelOpen((open) => !open)}
              data-testid="assessment-submit-toggle"
              style={{
                padding: '4px 12px',
                background: submitPanelOpen ? 'rgba(251,191,36,0.18)' : 'transparent',
                border: '1px solid rgba(251,191,36,0.48)',
                color: '#fbbf24',
                fontSize: 9,
                letterSpacing: '0.15em',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              SUBMIT WORK
            </button>
            <button
              onClick={() => void destroy()}
              style={{
                padding: '4px 12px',
                background: 'transparent',
                border: '1px solid rgba(248,113,113,0.4)',
                color: '#f87171',
                fontSize: 9,
                letterSpacing: '0.15em',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              END SESSION
            </button>
          </div>
        </div>
        {expiringSoon && (
          <div
            role="alert"
            style={{
              padding: '8px 16px',
              background: 'rgba(251,191,36,0.08)',
              borderBottom: '1px solid rgba(251,191,36,0.4)',
              fontSize: 11,
              color: '#fbbf24',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            ⚠ SESSION ENDING SOON — save your work, the container will be destroyed in ~{remaining ?? '1:00'}.
          </div>
        )}
        <AssessmentWorkspaceStatusStrip
          progress={assessmentProgress}
          loading={assessmentLoading}
          error={assessmentError}
          onOpenSubmit={() => setSubmitPanelOpen(true)}
        />
        {submitPanelOpen && (
          <form
            onSubmit={(event) => void handleCommitSubmit(event)}
            data-testid="assessment-commit-panel"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 10,
              padding: 12,
              background: '#09090b',
              borderBottom: '1px solid rgba(251,191,36,0.24)',
              color: '#f8fafc',
              maxHeight: 360,
              overflow: 'auto',
              fontSize: 11,
            }}
          >
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <strong style={{ color: '#fbbf24', letterSpacing: '0.14em' }}>ASSESSMENT COMMIT</strong>
              <span style={{ color: assessmentError ? '#f87171' : 'var(--pipe-text-dim)' }}>
                {assessmentError ?? (assessmentProgress?.nextActionLabel ?? 'No assessment session loaded')}
              </span>
            </div>
            {submissionBlocker && (
              <div
                data-testid="assessment-commit-packet-blocker"
                role="alert"
                style={{
                  gridColumn: '1 / -1',
                  color: '#fbbf24',
                  border: '1px solid rgba(251,191,36,0.45)',
                  background: 'rgba(251,191,36,0.08)',
                  padding: 8,
                }}
              >
                {submissionBlocker}
              </div>
            )}

            <div
              style={{
                gridColumn: '1 / -1',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr)) auto',
                gap: 10,
                alignItems: 'end',
                border: '1px solid rgba(74,222,128,0.24)',
                background: 'rgba(74,222,128,0.06)',
                padding: 10,
              }}
            >
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Workspace submission note</span>
                <input
                  value={workspaceNarrative}
                  onChange={(event) => {
                    setWorkspaceNarrative(event.target.value);
                    setCommitError(null);
                    setCommitSuccess(null);
                  }}
                  disabled={workspaceFinalizing}
                  data-testid="assessment-workspace-finalize-narrative"
                  placeholder="What did you change?"
                  style={fieldStyle()}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Verification command</span>
                <input
                  value={workspaceTestCommand}
                  onChange={(event) => {
                    setWorkspaceTestCommand(event.target.value);
                    setCommitError(null);
                    setCommitSuccess(null);
                  }}
                  disabled={workspaceFinalizing}
                  data-testid="assessment-workspace-finalize-test-command"
                  placeholder="npm test -- retry"
                  style={fieldStyle()}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Missing-test note</span>
                <input
                  value={workspaceVerificationNotes}
                  onChange={(event) => {
                    setWorkspaceVerificationNotes(event.target.value);
                    setCommitError(null);
                    setCommitSuccess(null);
                  }}
                  disabled={workspaceFinalizing}
                  data-testid="assessment-workspace-finalize-verification-notes"
                  placeholder="If any expected tests could not run, say exactly why."
                  style={fieldStyle()}
                />
              </label>
              <button
                type="button"
                onClick={() => void handleWorkspaceFinalize()}
                disabled={workspaceFinalizeBlocked}
                data-testid="assessment-workspace-finalize-submit"
                style={{
                  padding: '9px 14px',
                  minHeight: 34,
                  background: workspaceFinalizeBlocked ? 'rgba(148,163,184,0.12)' : 'rgba(74,222,128,0.16)',
                  border: '1px solid rgba(74,222,128,0.48)',
                  color: workspaceFinalizeBlocked ? 'var(--pipe-text-dim)' : '#4ade80',
                  fontSize: 10,
                  letterSpacing: '0.15em',
                  fontWeight: 700,
                  cursor: workspaceFinalizeBlocked ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {workspaceFinalizing ? 'FINALIZING...' : 'FINALIZE WORKSPACE HEAD'}
              </button>
              <WorkspaceFinalizeTrustContract />
            </div>
            <WorkspaceFinalizeRecovery error={commitError} />

            <label style={{ display: 'grid', gap: 4 }}>
              <span>Repository URL</span>
              <input
                value={commitFields.repositoryUrl}
                onChange={(event) => setCommitField('repositoryUrl', event.target.value)}
                disabled={commitSubmitting}
                data-testid="assessment-commit-repository-url"
                style={fieldStyle()}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Branch</span>
              <input
                value={commitFields.branchName}
                onChange={(event) => setCommitField('branchName', event.target.value)}
                disabled={commitSubmitting}
                data-testid="assessment-commit-branch"
                style={fieldStyle()}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Base commit SHA</span>
              <input
                value={commitFields.baseCommitSha}
                onChange={(event) => setCommitField('baseCommitSha', event.target.value)}
                disabled={commitSubmitting}
                data-testid="assessment-commit-base-sha"
                style={fieldStyle()}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Commit SHA</span>
              <input
                value={commitFields.commitSha}
                onChange={(event) => setCommitField('commitSha', event.target.value)}
                disabled={commitSubmitting}
                data-testid="assessment-commit-commit-sha"
                style={fieldStyle()}
              />
            </label>

            <label style={{ gridColumn: 'span 2', display: 'grid', gap: 4 }}>
              <span>Submission note</span>
              <textarea
                value={commitFields.narrative}
                onChange={(event) => setCommitField('narrative', event.target.value)}
                disabled={commitSubmitting}
                data-testid="assessment-commit-narrative"
                style={fieldStyle('textarea')}
              />
            </label>
            <label style={{ gridColumn: 'span 2', display: 'grid', gap: 4 }}>
              <span>Changed files</span>
              <textarea
                value={commitFields.changedFilesText}
                onChange={(event) => setCommitField('changedFilesText', event.target.value)}
                disabled={commitSubmitting}
                data-testid="assessment-commit-changed-files"
                style={fieldStyle('textarea')}
              />
            </label>

            <label style={{ gridColumn: 'span 2', display: 'grid', gap: 4 }}>
              <span>Commit evidence</span>
              <textarea
                value={commitFields.commitEvidenceText}
                onChange={(event) => setCommitField('commitEvidenceText', event.target.value)}
                disabled={commitSubmitting}
                data-testid="assessment-commit-commit-evidence"
                style={fieldStyle('textarea')}
              />
            </label>
            <label style={{ gridColumn: 'span 2', display: 'grid', gap: 4 }}>
              <span>Diff evidence</span>
              <textarea
                value={commitFields.diffText}
                onChange={(event) => setCommitField('diffText', event.target.value)}
                disabled={commitSubmitting}
                data-testid="assessment-commit-diff"
                style={fieldStyle('textarea')}
              />
            </label>
            <label style={{ gridColumn: 'span 2', display: 'grid', gap: 4 }}>
              <span>Test evidence</span>
              <textarea
                value={commitFields.testEvidenceText}
                onChange={(event) => setCommitField('testEvidenceText', event.target.value)}
                disabled={commitSubmitting}
                data-testid="assessment-commit-test-evidence"
                style={fieldStyle('textarea')}
              />
            </label>
            <label style={{ gridColumn: 'span 2', display: 'grid', gap: 4 }}>
              <span>Missing or partial verification note</span>
              <textarea
                value={commitFields.verificationNotesText}
                onChange={(event) => setCommitField('verificationNotesText', event.target.value)}
                disabled={commitSubmitting}
                data-testid="assessment-commit-verification-note"
                style={fieldStyle('textarea')}
              />
            </label>

            {(commitError || commitSuccess) && (
              <div
                data-testid="assessment-commit-result"
                style={{
                  gridColumn: '1 / -1',
                  color: commitError ? '#f87171' : '#4ade80',
                  border: `1px solid ${commitError ? 'rgba(248,113,113,0.4)' : 'rgba(74,222,128,0.4)'}`,
                  padding: 8,
                }}
              >
                {commitError ?? commitSuccess}
              </div>
            )}

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="submit"
                disabled={commitBlocked}
                data-testid="assessment-commit-submit"
                style={{
                  padding: '8px 14px',
                  background: commitBlocked ? 'rgba(148,163,184,0.12)' : 'rgba(251,191,36,0.18)',
                  border: '1px solid rgba(251,191,36,0.48)',
                  color: commitBlocked ? 'var(--pipe-text-dim)' : '#fbbf24',
                  fontSize: 10,
                  letterSpacing: '0.15em',
                  fontWeight: 700,
                  cursor: commitBlocked ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {commitSubmitting ? 'SUBMITTING...' : 'SUBMIT SOURCE-BACKED COMMIT'}
              </button>
            </div>
          </form>
        )}
        <iframe
          src={containerUrl}
          title="code-server dev environment"
          style={{ flex: 1, width: '100%', border: 'none', background: '#1e1e2e' }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation"
        />
      </div>
    );
  }

  // LAUNCHING / BOOTING / IDLE (first paint before auto-launch effect runs)
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0c0c0e',
        color: 'var(--pipe-text, #fff)',
        fontFamily: '"Space Mono", monospace',
        gap: 16,
      }}
    >
      <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'var(--pipe-text-dim)' }}>
        PROVISIONING DEV ENVIRONMENT
      </div>
      <div style={{ fontSize: 12, color: '#fbbf24', letterSpacing: '0.1em' }}>
        {state === 'LAUNCHING' ? 'LAUNCHING…' : state === 'BOOTING' ? 'BOOTING CODE-SERVER…' : 'STARTING…'}
      </div>
      <div
        style={{
          width: 240,
          height: 2,
          background: 'var(--pipe-surface-hover)',
          borderRadius: 1,
          overflow: 'hidden',
          marginTop: 8,
        }}
      >
        <div
          style={{
            height: '100%',
            background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
            borderRadius: 1,
            animation: 'devcontainer-indeterminate 2s linear infinite',
            width: '40%',
          }}
        />
        <style>{`
          @keyframes devcontainer-indeterminate {
            0%   { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        `}</style>
      </div>
      <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginTop: 16, maxWidth: 360, textAlign: 'center' }}>
        The first boot may take 20–30 seconds while the container image warms up.
      </div>
    </div>
  );
}
