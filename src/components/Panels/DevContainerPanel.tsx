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
  const { state, containerUrl, error, expiresAt, expiringSoon, launch, destroy, reset } =
    useDevContainerSession();
  const [submitPanelOpen, setSubmitPanelOpen] = useState(false);
  const [assessmentProgress, setAssessmentProgress] = useState<CandidateAssessmentProgress | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [commitFields, setCommitFields] = useState<CandidateCommitSubmissionFormFields>(EMPTY_COMMIT_FIELDS);
  const [commitSubmitting, setCommitSubmitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState<string | null>(null);

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
    if (!assessmentProgress) {
      setCommitError('Assessment session is not ready for commit submission.');
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
    const commitBlocked = !assessmentProgress || commitSubmitting;
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
              SUBMIT COMMIT
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
              <span>Missing test note</span>
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
