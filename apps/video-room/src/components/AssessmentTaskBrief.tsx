import { CheckCircle2, CircleDashed, ClipboardCheck, GitBranch, SquareTerminal, Upload } from 'lucide-react';
import { summarizeChallengePacket } from '../lib/challengePacketSummary';
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
      detail: progress.hasAiInteraction
        ? 'Agent messages or responses are captured as assessment evidence.'
        : 'Use AI if helpful; only real agent interactions will be recorded.',
      required: false,
    },
    {
      label: 'Interview context',
      captured: Boolean(progress.hasMessageEvidence || progress.hasTranscriptEvidence || progress.hasToolUsageEvidence),
      detail: 'Chat, transcript, and room actions add context for the reviewer.',
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
  const currentStep = progress?.readiness?.detail
    ?? progress?.nextActionLabel
    ?? (workspaceReady ? 'Commit changes, then submit work.' : 'Launch the controlled workspace to begin.');
  const proofItems = progress ? proofChecklistItems(progress) : [];
  const missingRequiredProof = progress?.readiness?.missingRequiredCount
    ?? proofItems.filter((item) => item.required && !item.captured).length;
  const incompletePacketFields = progress?.challengePacketContract?.isComplete === false
    ? progress.challengePacketContract.missingFields
    : [];
  const hasContract = Boolean(
    summary.task
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
        {workspaceReady && onOpenSubmission && (
          <button type="button" onClick={onOpenSubmission} data-testid="assessment-brief-open-submission">
            <Upload size={14} />
            Submit work
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
