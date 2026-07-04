import { AlertTriangle, CheckCircle2, CircleDashed, ClipboardCheck, GitBranch, ShieldCheck, SquareTerminal, Upload } from 'lucide-react';
import { hidesCandidateSolutionPullRequest, summarizeChallengePacket } from '../lib/challengePacketSummary';
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

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function pullRequestLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const [, owner, repo, pull, number] = parsed.pathname.split('/');
    if (parsed.hostname === 'github.com' && owner && repo && pull === 'pull' && number) return `#${number}`;
  } catch {
    // Keep the raw value below for non-URL PR labels.
  }
  return value;
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

function topReviewPacketSourceRefLabels(
  packet: NonNullable<NonNullable<RoomAssessmentProgressSnapshot['evaluation']>['reviewPacket']>,
): string[] {
  return Object.entries(packet.evidence.sourceRefTypeCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([kind, count]) => `${count} ${sentenceCaseToken(kind)}`);
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

function aiUseTransparencyProofItem(progress: RoomAssessmentProgressSnapshot): ProofChecklistItem {
  const aiUse = summarizeAssessmentAiUse(progress);
  return {
    label: 'AI-use transparency',
    captured: progress.hasAiInteraction,
    detail: progress.hasAiInteraction
      ? aiUse.detail
      : 'Optional: use AI if helpful. PIPE records only real agent bridge prompts, blocked attempts, bridge statuses, diagnostics, and agent responses; silence is not proof of no AI use.',
    required: false,
  };
}

function proofChecklistItems(progress: RoomAssessmentProgressSnapshot): ProofChecklistItem[] {
  if (progress.readiness) {
    const readinessItems = [
      ...progress.readiness.required,
      ...progress.readiness.confidence,
    ].map((item) => ({
      label: item.label,
      captured: item.satisfied,
      detail: item.id === 'ai_usage_transparency'
        ? item.satisfied
          ? summarizeAssessmentAiUse(progress).detail
          : item.missingImpact
        : item.satisfied ? 'Captured as source-backed assessment evidence.' : item.missingImpact,
      required: item.required,
    }));
    const hasAiUseReadiness = [
      ...progress.readiness.required,
      ...progress.readiness.confidence,
    ].some((item) => item.id === 'ai_usage_transparency');
    return hasAiUseReadiness ? readinessItems : [...readinessItems, aiUseTransparencyProofItem(progress)];
  }

  const testOrGapCaptured = progress.hasTestEvidence || progress.hasVerificationGap === true;
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
    aiUseTransparencyProofItem(progress),
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
  const hideSolutionPullRequest = hidesCandidateSolutionPullRequest({
    sourceRefType: packet?.sourceRefType,
    assignmentTrustState: progress?.assignmentTrust?.state,
  });
  const visibleGithubPrNumber = hideSolutionPullRequest ? null : summary.githubPrNumber;
  const visiblePullRequestUrl = hideSolutionPullRequest ? null : summary.pullRequestUrl;
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
  const finalReviewPacket = progress?.evaluation?.reviewPacket ?? null;
  const submittedChangedFileCount = progress?.commit?.changedFiles.length ?? 0;
  const submittedVerification = progress?.hasTestEvidence
    ? 'Test evidence captured'
    : progress?.hasVerificationGap
      ? 'Verification gap captured'
      : 'No test evidence captured';
  const evaluationDiagnostics = progress?.evaluation?.diagnostics?.slice(0, 3) ?? [];
  const submissionActionLabel = assessmentSubmissionActionLabel(progress, 'Submit work');
  const canOpenSubmission = (workspaceReady || submissionActionLabel !== 'Submit work') && !challengeSetupStep;
  const reviewPacketSourceRefs = finalReviewPacket ? topReviewPacketSourceRefLabels(finalReviewPacket) : [];
  const hasContract = Boolean(
    summary.task
    || summary.verificationCommand
    || summary.matchProof.length > 0
    || summary.assessmentFit.length > 0
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
        {hideSolutionPullRequest && (
          <>
            <dt>Source</dt>
            <dd>Source-backed replay</dd>
          </>
        )}
        {visibleGithubPrNumber && (
          <>
            <dt>PR</dt>
            <dd>
              {visiblePullRequestUrl ? (
                <a href={visiblePullRequestUrl} target="_blank" rel="noopener noreferrer">
                  #{visibleGithubPrNumber}
                </a>
              ) : (
                <>#{visibleGithubPrNumber}</>
              )}
            </dd>
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

      {finalReviewPacket && (
        <section
          className="assessment-final-review-packet"
          data-testid="assessment-final-review-packet"
          aria-label="Source-backed final review packet"
        >
          <div className="assessment-final-review-packet-header">
            <CheckCircle2 size={15} />
            <div>
              <strong>Source-backed report ready</strong>
              <p>
                The final packet is tied to the assigned repo challenge, submitted commit,
                and captured evidence. It does not auto-submit anything upstream.
              </p>
            </div>
          </div>
          <dl>
            <dt>Artifact</dt>
            <dd>{finalReviewPacket.schemaVersion}</dd>
            <dt>Challenge</dt>
            <dd>
              {[
                finalReviewPacket.challenge.assignmentTrust.label,
                repoLabel(finalReviewPacket.challenge.repositoryUrl),
                finalReviewPacket.challenge.baseCommitSha ? `Base ${shortSha(finalReviewPacket.challenge.baseCommitSha)}` : null,
                hidesCandidateSolutionPullRequest({
                  assignmentTrustState: finalReviewPacket.challenge.assignmentTrust.state,
                })
                  ? null
                  : pullRequestLabel(finalReviewPacket.challenge.pullRequestUrl),
              ].filter(Boolean).join(' · ')}
            </dd>
            {finalReviewPacket.submission && (
              <>
                <dt>Submitted work</dt>
                <dd>
                  {[
                    finalReviewPacket.submission.commitSha ? `Commit ${shortSha(finalReviewPacket.submission.commitSha)}` : null,
                    finalReviewPacket.submission.branchName,
                    finalReviewPacket.submission.submissionSourceLabel,
                    finalReviewPacket.submission.integrity.label,
                    finalReviewPacket.submission.challengeBinding.label,
                  ].filter(Boolean).join(' · ')}
                </dd>
              </>
            )}
            <dt>Evidence</dt>
            <dd>
              {[
                pluralize(finalReviewPacket.evidence.sourceRefCount, 'source ref'),
                reviewPacketSourceRefs.join(', '),
                pluralize(finalReviewPacket.evaluation.claimCount, 'claim'),
                pluralize(finalReviewPacket.evaluation.diagnosticCount, 'diagnostic'),
              ].filter(Boolean).join(' · ')}
            </dd>
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
          {summary.verificationCommand && (
            <section>
              <strong>Verification command</strong>
              <p><code>{summary.verificationCommand}</code></p>
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
          {summary.assessmentFit.length > 0 && (
            <section>
              <strong>Assessment fit</strong>
              <ul>
                {summary.assessmentFit.map((item) => <li key={item}>{item}</li>)}
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
