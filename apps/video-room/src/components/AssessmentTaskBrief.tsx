import { AlertTriangle, CheckCircle2, CircleDashed, ClipboardCheck, GitBranch, ShieldCheck, SquareTerminal, Upload } from 'lucide-react';
import { summarizeChallengePacket } from '../lib/challengePacketSummary';
import { summarizeAssessmentAiUse } from '../lib/aiUseSummary';
import { assessmentSubmissionActionLabel } from '../lib/assessmentSubmissionState';
import type { RoomAssessmentProgressSnapshot, RoomWorkspace, RoomWorkspaceChallengePacket } from '../types';

interface AssessmentTaskBriefProps {
  packet: RoomWorkspaceChallengePacket | null;
  workspace: RoomWorkspace | null;
  progress?: RoomAssessmentProgressSnapshot | null;
  workspaceReady?: boolean;
  onOpenWorkspace?: () => void;
  onOpenSubmission?: () => void;
}

function repoLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.hostname === 'github.com') {
      const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
      if (owner && repo) return `${owner}/${repo}`;
    }
  } catch {
    // Keep the raw value below for non-URL repository labels.
  }
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function shortSha(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 10) : null;
}

interface ProofChecklistItem {
  label: string;
  captured: boolean;
  detail: string;
  required: boolean;
}

interface SubmissionStatus {
  label: string;
  detail: string;
  tone: 'ready' | 'review' | 'submitted';
}

type EvaluationDiagnostic = NonNullable<NonNullable<RoomAssessmentProgressSnapshot['evaluation']>['diagnostics']>[number];

function sentenceCaseToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'Unknown';
  return trimmed
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bAi\b/g, 'AI');
}

function diagnosticSourceSummary(diagnostic: EvaluationDiagnostic): string {
  const sourceTypes = diagnostic.sourceRefTypes.length > 0
    ? diagnostic.sourceRefTypes.map(sentenceCaseToken).join(', ')
    : 'No source refs listed';
  const countLabel = diagnostic.sourceRefCount === 1 ? 'source ref' : 'source refs';
  return `${diagnostic.sourceRefCount} ${countLabel}: ${sourceTypes}`;
}

function primaryEvaluationDiagnostic(progress: RoomAssessmentProgressSnapshot): EvaluationDiagnostic | null {
  return progress.evaluation?.diagnostics?.[0] ?? null;
}

function submissionStatus(progress: RoomAssessmentProgressSnapshot): SubmissionStatus | null {
  if (!progress.hasCommitSubmission || !progress.commit?.commitSha) return null;

  const diagnostic = primaryEvaluationDiagnostic(progress);
  if (diagnostic && progress.evaluation?.status !== 'EVALUATED') {
    return {
      label: 'Evaluation needs attention',
      detail: diagnostic.message || progress.evaluation?.summary || progress.nextActionLabel,
      tone: 'review',
    };
  }

  if (progress.evaluation?.status === 'EVALUATED') {
    return {
      label: 'Assessment report ready',
      detail: 'Your commit and evidence trail have been evaluated. The recruiter can now review the source-backed report.',
      tone: 'ready',
    };
  }

  if (progress.nextAction === 'START_EVALUATION' || progress.readiness?.isReadyForEvaluation) {
    return {
      label: 'Submission captured',
      detail: 'Your assessment branch commit, diff, and required source refs are captured. Evaluation can start from this evidence.',
      tone: 'submitted',
    };
  }

  return {
    label: 'Commit recorded',
    detail: progress.nextActionLabel,
    tone: 'review',
  };
}

function proofChecklistItems(progress: RoomAssessmentProgressSnapshot): ProofChecklistItem[] {
  if (progress.readiness) {
    return [
      ...progress.readiness.required,
      ...progress.readiness.confidence,
    ].map((item) => ({
      label: item.label,
      captured: item.satisfied,
      detail: item.satisfied ? 'Captured as source-backed assessment evidence.' : item.missingImpact,
      required: item.required,
    }));
  }

  const testOrGapCaptured = progress.hasTestEvidence || progress.hasVerificationGap === true;
  const aiUse = summarizeAssessmentAiUse(progress);
  return [
    {
      label: 'Challenge packet',
      captured: progress.hasChallengePacket,
      detail: 'Repo, base commit, task, success criteria, and expected evidence are assigned.',
      required: true,
    },
    {
      label: 'Workspace telemetry',
      captured: Boolean(progress.hasDevContainerEvidence),
      detail: 'The controlled dev container has emitted launch or workspace state evidence.',
      required: true,
    },
    {
      label: 'Work evidence',
      captured: progress.hasWorkEvidence,
      detail: 'PIPE has observed concrete room, editor, terminal, or code activity.',
      required: true,
    },
    {
      label: 'Assessment branch commit',
      captured: progress.hasCommitSubmission,
      detail: 'A real assessment branch or fork commit has been submitted.',
      required: true,
    },
    {
      label: 'Tests or verification note',
      captured: testOrGapCaptured,
      detail: progress.hasVerificationGap === true && !progress.hasTestEvidence
        ? 'A missing-test reason is captured; passing test output is still stronger.'
        : 'Test output or an explicit verification note is attached to the submission.',
      required: true,
    },
    {
      label: 'AI use transparency',
      captured: progress.hasAiInteraction,
      detail: progress.hasAiInteraction ? aiUse.detail : 'Use AI if helpful; only real agent interactions will be recorded.',
      required: false,
    },
    {
      label: 'Interview context',
      captured: Boolean(progress.hasMessageEvidence || progress.hasTranscriptEvidence || progress.hasToolUsageEvidence),
      detail: 'Chat, transcript, and workspace activity add context for the reviewer.',
      required: false,
    },
  ];
}

export function AssessmentTaskBrief({
  packet,
  workspace,
  progress = null,
  workspaceReady = false,
  onOpenWorkspace,
  onOpenSubmission,
}: AssessmentTaskBriefProps): JSX.Element {
  const summary = summarizeChallengePacket(packet);
  const repositoryUrl = summary.repositoryUrl ?? workspace?.repoUrl ?? null;
  const baseCommitSha = summary.baseCommitSha ?? progress?.commit?.baseCommitSha ?? null;
  const incompletePacketFields = progress?.challengePacketContract?.isComplete === false
    ? progress.challengePacketContract.missingFields
    : [];
  const challengeSetupStep = incompletePacketFields.length > 0
    ? `Complete challenge packet before candidate work starts: missing ${incompletePacketFields.join(', ')}.`
    : workspace?.challenge.status === 'missing_reviewable_task'
      ? workspace.challenge.message ?? 'Assign a GitHub PR or complete source-backed task packet before launching.'
      : !packet
        ? 'Attach a complete source-backed task packet before candidate work starts.'
        : null;
  const currentStep = progress?.readiness?.detail
    ?? progress?.nextActionLabel
    ?? challengeSetupStep
    ?? (workspaceReady ? 'Commit changes, then submit work.' : 'Launch the controlled workspace to begin.');
  const proofItems = progress ? proofChecklistItems(progress) : [];
  const missingRequiredProof = progress?.readiness?.missingRequiredCount
    ?? proofItems.filter((item) => item.required && !item.captured).length;
  const status = progress ? submissionStatus(progress) : null;
  const submittedChangedFileCount = progress?.commit?.changedFiles.length ?? 0;
  const submittedVerification = progress?.hasTestEvidence
    ? 'Test evidence captured'
    : progress?.hasVerificationGap
      ? 'Verification gap captured'
      : 'No test evidence captured';
  const evaluationDiagnostics = progress?.evaluation?.diagnostics?.slice(0, 3) ?? [];
  const canOpenSubmission = workspaceReady && !challengeSetupStep;
  const submissionActionLabel = assessmentSubmissionActionLabel(progress, 'Submit work');
  const hasContract = Boolean(
    summary.task
    || summary.matchProof.length > 0
    || summary.successCriteria.length > 0
    || summary.expectedEvidence.length > 0,
  );

  return (
    <aside
      className="assessment-task-brief"
      data-testid="assessment-task-brief"
      aria-label="Assessment task brief"
    >
      <div className="assessment-task-brief-header">
        <ClipboardCheck size={16} />
        <div>
          <h2>Assessment task</h2>
          <span>Open-source implementation</span>
        </div>
      </div>

      <dl className="assessment-task-brief-meta">
        {repositoryUrl && (
          <>
            <dt>Repo</dt>
            <dd title={repositoryUrl}>{repoLabel(repositoryUrl)}</dd>
          </>
        )}
        {summary.githubPrNumber && (
          <>
            <dt>PR</dt>
            <dd>#{summary.githubPrNumber}</dd>
          </>
        )}
        {baseCommitSha && (
          <>
            <dt>Base</dt>
            <dd title={baseCommitSha}>{shortSha(baseCommitSha)}</dd>
          </>
        )}
        {progress?.commit?.branchName && (
          <>
            <dt>Branch</dt>
            <dd>{progress.commit.branchName}</dd>
          </>
        )}
      </dl>

      <section className="assessment-task-brief-step">
        <strong>Current step</strong>
        <p>{currentStep}</p>
        {progress?.readiness && (
          <div className="assessment-task-brief-readiness" data-testid="assessment-task-brief-readiness">
            <span>{progress.readiness.label}</span>
            <small>
              {progress.readiness.isReadyForEvaluation
                ? 'Required proof is complete.'
                : `${progress.readiness.missingRequiredCount} required proof ${progress.readiness.missingRequiredCount === 1 ? 'item' : 'items'} missing.`}
            </small>
          </div>
        )}
        {incompletePacketFields.length > 0 && (
          <div className="assessment-task-brief-contract-warning" data-testid="assessment-task-brief-contract-warning">
            <span>Task packet incomplete</span>
            <small>Missing {incompletePacketFields.join(', ')}</small>
          </div>
        )}
      </section>

      {status && progress?.commit?.commitSha && (
        <section
          className={`assessment-task-brief-submission is-${status.tone}`}
          data-testid="assessment-task-brief-submission"
          aria-label="Assessment submission status"
        >
          <div className="assessment-task-brief-submission-header">
            <ShieldCheck size={15} />
            <div>
              <strong>{status.label}</strong>
              <p>{status.detail}</p>
            </div>
          </div>
          <dl>
            <dt>Commit</dt>
            <dd>{shortSha(progress.commit.commitSha)}</dd>
            {progress.commit.branchName && (
              <>
                <dt>Branch</dt>
                <dd>{progress.commit.branchName}</dd>
              </>
            )}
            <dt>Files</dt>
            <dd>
              {submittedChangedFileCount === 0
                ? 'Changed files not listed'
                : `${submittedChangedFileCount} changed ${submittedChangedFileCount === 1 ? 'file' : 'files'}`}
            </dd>
            <dt>Verification</dt>
            <dd>{submittedVerification}</dd>
          </dl>
        </section>
      )}

      {evaluationDiagnostics.length > 0 && (
        <section
          className="assessment-task-brief-diagnostics"
          data-testid="assessment-task-brief-diagnostics"
          aria-label="Evaluator diagnostics"
        >
          <div className="assessment-task-brief-diagnostics-header">
            <AlertTriangle size={15} />
            <div>
              <strong>Evaluator cautions</strong>
              <p>PIPE is showing the real evaluator state. These cautions must be resolved or reviewed before treating the assessment as a hiring signal.</p>
            </div>
          </div>
          <ul>
            {evaluationDiagnostics.map((diagnostic) => (
              <li key={diagnostic.id}>
                <span>
                  {sentenceCaseToken(diagnostic.severity)}: {sentenceCaseToken(diagnostic.code)}
                </span>
                <small>{diagnostic.message}</small>
                <small>{diagnosticSourceSummary(diagnostic)}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {progress && (
        <section
          className="assessment-task-brief-proof"
          data-testid="assessment-task-brief-proof"
          aria-label="Assessment proof checklist"
        >
          <div className="assessment-task-brief-proof-header">
            <strong>Proof checklist</strong>
            <span>
              {missingRequiredProof === 0
                ? 'Ready for source-backed review'
                : `${missingRequiredProof} required ${missingRequiredProof === 1 ? 'item' : 'items'} missing`}
            </span>
          </div>
          <ul>
            {proofItems.map((item) => (
              <li key={item.label} className={item.captured ? 'is-captured' : 'is-missing'}>
                {item.captured ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
                <div>
                  <span>
                    {item.label}: {item.captured ? 'Captured' : item.required ? 'Missing' : 'Not captured'}
                  </span>
                  <small>{item.detail}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasContract ? (
        <div className="assessment-task-brief-contract">
          {summary.task && (
            <section>
              <strong>Task</strong>
              <p>{summary.task}</p>
            </section>
          )}
          {summary.matchProof.length > 0 && (
            <section>
              <strong>Match proof</strong>
              <ul>
                {summary.matchProof.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          )}
          {summary.successCriteria.length > 0 && (
            <section>
              <strong>Success criteria</strong>
              <ul>
                {summary.successCriteria.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          )}
          {summary.expectedEvidence.length > 0 && (
            <section>
              <strong>Expected evidence</strong>
              <ul>
                {summary.expectedEvidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <p className="assessment-task-brief-empty">
          The host still needs to attach a source-backed task packet before this assessment can be trusted.
        </p>
      )}

      <div className="assessment-task-brief-actions">
        {workspaceReady && onOpenWorkspace && (
          <button type="button" onClick={onOpenWorkspace} data-testid="assessment-brief-open-workspace">
            <SquareTerminal size={14} />
            Workspace
          </button>
        )}
        {canOpenSubmission && onOpenSubmission && (
          <button type="button" onClick={onOpenSubmission} data-testid="assessment-brief-open-submission">
            {submissionActionLabel === 'Submit work' ? <Upload size={14} /> : <CheckCircle2 size={14} />}
            {submissionActionLabel}
          </button>
        )}
        {progress?.commit?.commitSha && (
          <span className="assessment-task-brief-commit">
            <GitBranch size={13} />
            Commit {shortSha(progress.commit.commitSha)}
          </span>
        )}
      </div>
    </aside>
  );
}
