import { useState, useEffect } from 'react';
import {
  GitBranch,
  ChevronRight,
  GitPullRequest,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { DiffPanel, type DiffJson, type Annotation } from './DiffPanel';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { MatchProofPanel, type CodeReviewMatchExplanation } from '../Panels/ProblemPanel';

// ============================================================================
// Types
// ============================================================================

interface CachedMeta {
  prNumber?: number;
  branch?: string;
  base?: string;
  author?: string;
  additions?: number;
  deletions?: number;
  filesChanged?: number;
  title?: string;
  reviewProfile?: unknown;
}

interface CandidateSafeCodeReviewTaskPacket {
  repositoryUrl: string | null;
  pullRequestUrl: string | null;
  githubPrNumber: number | null;
  baseCommitSha: string | null;
  headCommitSha: string | null;
  task: string | null;
  successCriteria: string[];
  expectedEvidence: string[];
  constraints: string[];
  isComplete: boolean;
  missingFields: string[];
}

export interface CodeReviewReviewProfile {
  source: 'deterministic_engineering_prior';
  difficultyBand: 'introductory' | 'focused' | 'advanced' | 'oversized';
  expectedSeniority: 'mid' | 'senior' | 'staff';
  expectedTimeMinutes: number;
  basis: {
    changedFileCount: number;
    changedLineCount: number;
    sourceHunkCount: number;
    testChangeCount: number;
    demandFamilyCount: number;
    hasIssueContext: boolean;
  };
  rationale: string;
}

export interface CodeReviewChallengeProps {
  challenge: {
    id: string;
    title: string;
    instructions: string | null;
    githubRepoUrl?: string | null;
    githubPrNumber?: number | null;
    githubPrTitle?: string | null;
    githubPrDescription?: string | null;
    cachedMetadata?: unknown;
    matchExplanation?: CodeReviewMatchExplanation | null;
    reviewProfile?: unknown;
    challengePacket?: unknown;
  };
  diff: DiffJson | null;
  isFetchingDiff: boolean;
  submission: {
    annotations: Annotation[];
    verdict: string | null;
    summary: string;
  };
  onSubmissionChange: (s: {
    annotations: Annotation[];
    verdict: string | null;
    summary: string;
  }) => void;
}

const VERDICT_OPTIONS = [
  {
    key: 'approve' as const,
    label: 'Approve',
    icon: CheckCircle2,
    color: '#34d399',
    bg: 'rgba(52,211,153,0.08)',
    border: 'rgba(52,211,153,0.2)',
    description: 'Code is ready to merge',
  },
  {
    key: 'request_changes' as const,
    label: 'Request changes',
    icon: XCircle,
    color: '#f87171',
    bg: 'rgba(248,113,113,0.08)',
    border: 'rgba(248,113,113,0.2)',
    description: 'Changes needed before merge',
  },
  {
    key: 'comment_only' as const,
    label: 'Comment only',
    icon: MessageSquare,
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.2)',
    description: 'Informational review only',
  },
];

const BRAND_SURFACE = 'rgba(6, 16, 27, 0.74)';
const BRAND_SURFACE_SOFT = 'rgba(244, 248, 255, 0.045)';
const BRAND_BORDER = 'rgba(178, 214, 255, 0.14)';
const BRAND_BORDER_STRONG = 'rgba(178, 214, 255, 0.24)';
const BRAND_MUTED = 'rgba(244,248,255,0.62)';
const BRAND_DIM = 'rgba(244,248,255,0.38)';
const BRAND_SHADOW = '0 18px 60px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.055)';
const LABEL_FONT = '"Space Mono", monospace';
const BODY_FONT = '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function repoLabelFromUrl(repoUrl: string | null | undefined): string {
  if (!repoUrl) return 'Repository pending';
  try {
    const parsed = new URL(repoUrl);
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    return owner && repo ? `${owner}/${repo.replace(/\.git$/, '')}` : repoUrl;
  } catch {
    return repoUrl;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function sanitizeChallengePacket(value: unknown): CandidateSafeCodeReviewTaskPacket | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    repositoryUrl: stringValue(record.repositoryUrl),
    pullRequestUrl: stringValue(record.pullRequestUrl),
    githubPrNumber: numberValue(record.githubPrNumber),
    baseCommitSha: stringValue(record.baseCommitSha),
    headCommitSha: stringValue(record.headCommitSha),
    task: stringValue(record.task),
    successCriteria: stringArrayValue(record.successCriteria),
    expectedEvidence: stringArrayValue(record.expectedEvidence),
    constraints: stringArrayValue(record.constraints),
    isComplete: record.isComplete === true,
    missingFields: stringArrayValue(record.missingFields),
  };
}

function commitLabel(commitSha: string | null): string {
  return commitSha ? commitSha.slice(0, 12) : 'Not provided';
}

function formatEnumLabel(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function asCodeReviewReviewProfile(value: unknown): CodeReviewReviewProfile | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const basis = record.basis;
  if (typeof basis !== 'object' || basis === null || Array.isArray(basis)) return null;
  const basisRecord = basis as Record<string, unknown>;
  if (
    record.source !== 'deterministic_engineering_prior'
    || !['introductory', 'focused', 'advanced', 'oversized'].includes(String(record.difficultyBand))
    || !['mid', 'senior', 'staff'].includes(String(record.expectedSeniority))
    || typeof record.expectedTimeMinutes !== 'number'
    || typeof record.rationale !== 'string'
    || typeof basisRecord.changedFileCount !== 'number'
    || typeof basisRecord.changedLineCount !== 'number'
    || typeof basisRecord.sourceHunkCount !== 'number'
    || typeof basisRecord.testChangeCount !== 'number'
    || typeof basisRecord.demandFamilyCount !== 'number'
    || typeof basisRecord.hasIssueContext !== 'boolean'
  ) {
    return null;
  }
  return record as unknown as CodeReviewReviewProfile;
}

function reviewProfileTone(profile: CodeReviewReviewProfile): {
  label: string;
  color: string;
  background: string;
  border: string;
} {
  if (profile.difficultyBand === 'oversized') {
    return {
      label: 'Calibration risk',
      color: '#f87171',
      background: 'rgba(248,113,113,0.08)',
      border: 'rgba(248,113,113,0.22)',
    };
  }
  if (profile.difficultyBand === 'advanced') {
    return {
      label: 'Advanced',
      color: '#fbbf24',
      background: 'rgba(251,191,36,0.08)',
      border: 'rgba(251,191,36,0.22)',
    };
  }
  return {
    label: formatEnumLabel(profile.difficultyBand),
    color: '#34d399',
    background: 'rgba(52,211,153,0.08)',
    border: 'rgba(52,211,153,0.2)',
  };
}

export function ReviewProfileCard({ profile }: { profile: CodeReviewReviewProfile }): JSX.Element {
  const tone = reviewProfileTone(profile);
  const basisRows = [
    ['Files', profile.basis.changedFileCount],
    ['Lines', profile.basis.changedLineCount],
    ['Hunks', profile.basis.sourceHunkCount],
    ['Demands', profile.basis.demandFamilyCount],
    ['Tests', profile.basis.testChangeCount],
    ['Issue', profile.basis.hasIssueContext ? 'yes' : 'no'],
  ] as const;

  return (
    <div
      data-testid="code-review-review-profile"
      style={{
        padding: 16,
        borderRadius: 6,
        background: 'linear-gradient(180deg, rgba(244,248,255,0.052), rgba(98,143,185,0.045))',
        border: `1px solid ${BRAND_BORDER_STRONG}`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 8, letterSpacing: '0.16em', color: BRAND_DIM, fontFamily: LABEL_FONT }}>
          Assessment fit
        </span>
        <span
          style={{
            fontSize: 8,
            fontWeight: 800,
            letterSpacing: '0.12em',
            padding: '3px 7px',
            borderRadius: 4,
            color: tone.color,
            background: tone.background,
            border: `1px solid ${tone.border}`,
            fontFamily: LABEL_FONT,
            whiteSpace: 'nowrap',
          }}
        >
          {tone.label}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 8, color: BRAND_DIM, fontFamily: LABEL_FONT, marginBottom: 3 }}>
            Target time
          </div>
          <div style={{ fontSize: 13, color: '#f4f8ff', fontWeight: 800 }}>
            {profile.expectedTimeMinutes} min
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, color: BRAND_DIM, fontFamily: LABEL_FONT, marginBottom: 3 }}>
            Level
          </div>
          <div style={{ fontSize: 13, color: '#f4f8ff', fontWeight: 800 }}>
            {formatEnumLabel(profile.expectedSeniority)}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginBottom: 12 }}>
        {basisRows.map(([label, value]) => (
          <div
            key={label}
            style={{
              padding: '7px 6px',
              borderRadius: 4,
              background: 'rgba(244,248,255,0.035)',
              border: `1px solid ${BRAND_BORDER}`,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 8, color: BRAND_DIM, fontFamily: LABEL_FONT, marginBottom: 3 }}>
              {label}
            </div>
            <div style={{ fontSize: 10, color: BRAND_MUTED, fontWeight: 700, overflowWrap: 'anywhere' }}>
              {value}
            </div>
          </div>
        ))}
      </div>
      <p style={{ margin: 0, color: BRAND_DIM, fontSize: 10, lineHeight: 1.55 }}>
        {profile.rationale}
      </p>
    </div>
  );
}

function TaskPacketList({
  title,
  items,
}: {
  title: string;
  items: string[];
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 8, color: BRAND_DIM, fontFamily: LABEL_FONT, marginBottom: 6 }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, color: BRAND_MUTED, fontSize: 10, lineHeight: 1.6 }}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function CodeReviewTaskPacketCard({
  packet,
  fallbackRepoUrl,
  fallbackPrNumber,
}: {
  packet: CandidateSafeCodeReviewTaskPacket;
  fallbackRepoUrl: string | null;
  fallbackPrNumber: number | null;
}): JSX.Element {
  const repositoryUrl = packet.repositoryUrl ?? fallbackRepoUrl;
  const prNumber = packet.githubPrNumber ?? fallbackPrNumber;
  const pullRequestUrl = packet.pullRequestUrl
    ?? (repositoryUrl && prNumber ? `${repositoryUrl.replace(/\/$/, '')}/pull/${prNumber}` : null);
  const statusLabel = packet.isComplete ? 'Task brief' : 'Task brief needs source proof';

  return (
    <div
      data-testid="code-review-challenge-packet"
      style={{
        padding: 16,
        borderRadius: 6,
        background: packet.isComplete
          ? 'linear-gradient(180deg, rgba(52,211,153,0.055), rgba(98,143,185,0.045))'
          : 'linear-gradient(180deg, rgba(251,191,36,0.065), rgba(98,143,185,0.045))',
        border: `1px solid ${packet.isComplete ? 'rgba(52,211,153,0.2)' : 'rgba(251,191,36,0.24)'}`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 8, letterSpacing: '0.16em', color: BRAND_DIM, fontFamily: LABEL_FONT }}>
          {statusLabel}
        </span>
        {pullRequestUrl && (
          <a
            href={pullRequestUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              color: '#b9ddff',
              fontSize: 9,
              fontFamily: LABEL_FONT,
              fontWeight: 700,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            PR {prNumber != null ? `#${prNumber}` : ''}
            <ExternalLink size={10} />
          </a>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 8, color: BRAND_DIM, fontFamily: LABEL_FONT, marginBottom: 3 }}>
            Repository
          </div>
          <div style={{ fontSize: 11, color: '#f4f8ff', fontWeight: 800, overflowWrap: 'anywhere' }}>
            {repoLabelFromUrl(repositoryUrl)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, color: BRAND_DIM, fontFamily: LABEL_FONT, marginBottom: 3 }}>
            Base commit
          </div>
          <div style={{ fontSize: 11, color: '#f4f8ff', fontWeight: 800, fontFamily: LABEL_FONT }}>
            {commitLabel(packet.baseCommitSha)}
          </div>
        </div>
      </div>

      {packet.task && (
        <p style={{ margin: 0, marginBottom: 12, color: 'rgba(244,248,255,0.78)', fontSize: 11, lineHeight: 1.55 }}>
          {packet.task}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TaskPacketList title="Success criteria" items={packet.successCriteria} />
        <TaskPacketList title="Expected evidence" items={packet.expectedEvidence} />
        <TaskPacketList title="Constraints" items={packet.constraints} />
        <TaskPacketList title="Missing details" items={packet.missingFields} />
      </div>
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

/**
 * CodeReviewChallenge - Full-page layout for CODE_REVIEW challenges.
 *
 * Left: challenge instructions + PR metadata
 * Center: DiffPanel with inline annotations
 * Right: verdict selection + summary + submit
 */
export function CodeReviewChallenge({
  challenge,
  diff,
  isFetchingDiff,
  submission,
  onSubmissionChange,
}: CodeReviewChallengeProps): JSX.Element {
  const [verdict, setVerdict] = useState<string | null>(submission.verdict);
  const [summary, setSummary] = useState(submission.summary);

  // Sync local state when parent submission changes (e.g., external restore or reset)
  useEffect(() => {
    setVerdict(submission.verdict);
    setSummary(submission.summary);
  }, [submission.verdict, submission.summary]);

  // Call parent synchronously so canAdvance updates in the same render cycle.
  // Using useEffect caused a stale-closure / async-hop problem where the parent
  // state lagged behind local state and the SUBMIT button stayed disabled.
  const handleVerdictChange = (v: string): void => {
    setVerdict(v);
    onSubmissionChange({ annotations: submission.annotations, verdict: v, summary });
  };

  const handleSummaryChange = (s: string): void => {
    const trimmed = s.slice(0, 1000);
    setSummary(trimmed);
    onSubmissionChange({ annotations: submission.annotations, verdict, summary: trimmed });
  };

  // When parent updates annotations, keep local state consistent
  const handleAnnotationAdd = (a: {
    file: string;
    line: number;
    severity: 'critical' | 'major' | 'minor';
    comment: string;
  }): void => {
    const annotation: Annotation = {
      ...a,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const next = { annotations: [...submission.annotations, annotation], verdict, summary };
    onSubmissionChange(next);
  };

  const isReady = !!verdict && summary.trim().length > 0;

  // Extract PR meta from cachedMetadata if available
  const meta = (typeof challenge.cachedMetadata === 'object' && challenge.cachedMetadata !== null
    ? challenge.cachedMetadata
    : {}) as CachedMeta;
  const reviewProfile = asCodeReviewReviewProfile(challenge.reviewProfile) ?? asCodeReviewReviewProfile(meta.reviewProfile);

  const prNumber = meta.prNumber ?? challenge.githubPrNumber;
  const branch = meta.branch ?? 'feature-branch';
  const base = meta.base ?? 'main';
  const additions = meta.additions ?? diff?.stats.additions ?? 0;
  const deletions = meta.deletions ?? diff?.stats.deletions ?? 0;
  const filesChanged = meta.filesChanged ?? diff?.stats.filesChanged ?? 0;

  const hasPrAssigned = prNumber != null && prNumber > 0;
  const repoUrl = challenge.githubRepoUrl ?? null;
  const repoLabel = repoLabelFromUrl(repoUrl);
  const prUrl = repoUrl && hasPrAssigned ? `${repoUrl.replace(/\/$/, '')}/pull/${prNumber}` : null;
  const challengePacket = sanitizeChallengePacket(challenge.challengePacket);
  const isPlaceholderInstructions =
    challenge.instructions?.includes('when your profile is ingested') ?? false;

  return (
    <div
      className="pipe-code-review-challenge"
      data-testid="code-review-challenge"
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        fontFamily: BODY_FONT,
        background:
          'linear-gradient(180deg, rgba(8,22,35,0.9) 0%, rgba(12,12,14,0.98) 100%), linear-gradient(rgba(185,221,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(185,221,255,0.035) 1px, transparent 1px)',
        backgroundSize: 'auto, 88px 88px, 88px 88px',
      }}
    >
      {/* ── Left Panel: Instructions + PR Context ─────────────── */}
      <div
        className="pipe-code-review-left"
        style={{
          width: 'clamp(280px, 28vw, 380px)',
          flexShrink: 0,
          borderRight: `1px solid ${BRAND_BORDER}`,
          display: 'flex',
          flexDirection: 'column',
          background: BRAND_SURFACE,
          boxShadow: BRAND_SHADOW,
          backdropFilter: 'blur(18px)',
          overflowY: 'auto',
        }}
      >
        {/* Instructions */}
        <div style={{ padding: 24, borderBottom: `1px solid ${BRAND_BORDER}` }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: BRAND_DIM,
              marginBottom: 12,
              fontFamily: LABEL_FONT,
            }}
          >
            Instructions
          </div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#f4f8ff',
              margin: 0,
              marginBottom: 12,
              lineHeight: 1.5,
              letterSpacing: '0.01em',
              wordBreak: 'break-word',
            }}
          >
            {challenge.title}
          </h3>
          {challenge.instructions && (
            <p
              style={{
                fontSize: 11,
                color: BRAND_MUTED,
                lineHeight: 1.7,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {isPlaceholderInstructions && !hasPrAssigned
                ? 'Your pull request is being prepared. Once a repository matched to your background is assigned, the diff will appear here. You can still review the instructions and wait, or proceed if instructed by your recruiter.'
                : challenge.instructions}
            </p>
          )}
          {challenge.githubPrDescription && (
            <p
              style={{
                fontSize: 11,
                color: BRAND_DIM,
                lineHeight: 1.7,
                margin: 0,
                marginTop: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {challenge.githubPrDescription}
            </p>
          )}
        </div>

        {/* PR Meta */}
        <div style={{ padding: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
            }}
          >
            <GitPullRequest size={12} color="#34d399" />
            <span
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: BRAND_DIM,
                fontFamily: LABEL_FONT,
              }}
            >
              Pull request
            </span>
          </div>

          <LiquidMetalCard
            variant="default"
            style={{
              padding: 16,
              borderRadius: 6,
              background: 'linear-gradient(180deg, rgba(244,248,255,0.06), rgba(98,143,185,0.055))',
              border: `1px solid ${BRAND_BORDER_STRONG}`,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                marginBottom: 14,
              }}
            >
              <span
                style={{
                  fontSize: 8,
                  letterSpacing: '0.16em',
                  color: BRAND_DIM,
                  fontFamily: LABEL_FONT,
                }}
              >
                Repository
              </span>
              {repoUrl ? (
                <a
                  data-testid="code-review-repo-link"
                  href={repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#b9ddff',
                    fontSize: 12,
                    fontWeight: 700,
                    textDecoration: 'none',
                    wordBreak: 'break-word',
                  }}
                >
                  {repoLabel}
                  <ExternalLink size={11} />
                </a>
              ) : (
                <span style={{ color: BRAND_MUTED, fontSize: 12 }}>{repoLabel}</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: '0.15em',
                  padding: '3px 8px',
                  background: 'rgba(52, 211, 153, 0.1)',
                  border: '1px solid rgba(52, 211, 153, 0.2)',
                  color: '#34d399',
                  borderRadius: 4,
                  fontFamily: LABEL_FONT,
                }}
              >
                  Open
              </span>
              {prNumber != null && (prUrl ? (
                <a
                  data-testid="code-review-pr-link"
                  href={prUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    color: BRAND_MUTED,
                    fontWeight: 700,
                    fontFamily: LABEL_FONT,
                    textDecoration: 'none',
                  }}
                >
                  #{prNumber}
                  <ExternalLink size={10} />
                </a>
              ) : (
                <span
                  style={{
                    fontSize: 11,
                    color: BRAND_MUTED,
                    fontWeight: 700,
                    fontFamily: LABEL_FONT,
                  }}
                >
                  #{prNumber}
                </span>
              ))}
            </div>

            {challenge.githubPrTitle && (
              <p
                style={{
                  fontSize: 11,
                  color: 'rgba(244,248,255,0.76)',
                  lineHeight: 1.5,
                  margin: 0,
                  marginBottom: 10,
                }}
              >
                {challenge.githubPrTitle}
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <GitBranch size={10} color={BRAND_DIM} />
              <span style={{ fontSize: 10, color: BRAND_DIM, fontFamily: LABEL_FONT }}>{branch}</span>
              <ChevronRight size={10} color={BRAND_DIM} />
              <span style={{ fontSize: 10, color: BRAND_DIM, fontFamily: LABEL_FONT }}>{base}</span>
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              <span style={{ fontSize: 10, color: BRAND_DIM, fontFamily: LABEL_FONT }}>
                <span style={{ color: '#4ade80', fontWeight: 700 }}>+{additions}</span>
                {' / '}
                <span style={{ color: '#f87171', fontWeight: 700 }}>-{deletions}</span>
              </span>
              <span style={{ fontSize: 10, color: BRAND_DIM, fontFamily: LABEL_FONT }}>
                {filesChanged} {filesChanged === 1 ? 'file' : 'files'}
              </span>
            </div>
          </LiquidMetalCard>
        </div>

        {challengePacket && (
          <div style={{ padding: '0 24px 24px' }}>
            <CodeReviewTaskPacketCard
              packet={challengePacket}
              fallbackRepoUrl={repoUrl}
              fallbackPrNumber={prNumber ?? null}
            />
          </div>
        )}

        {reviewProfile && (
          <div style={{ padding: '0 24px 24px' }}>
            <ReviewProfileCard profile={reviewProfile} />
          </div>
        )}

        {challenge.matchExplanation && (
          <div style={{ padding: '0 24px 24px' }}>
            <MatchProofPanel matchExplanation={challenge.matchExplanation} />
          </div>
        )}
      </div>

      {/* ── Center Panel: Diff ─────────────────────────────────── */}
      <div
        className="pipe-code-review-main"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {isFetchingDiff && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              color: 'var(--pipe-text-dim)',
            }}
          >
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 10, letterSpacing: '0.15em' }}>Loading diff...</div>
          </div>
        )}

        {!isFetchingDiff && diff && (
          <DiffPanel
            diff={diff}
            annotations={submission.annotations}
            onAnnotationAdd={handleAnnotationAdd}
          />
        )}

        {!isFetchingDiff && !diff && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              color: 'var(--pipe-text-dim)',
              padding: 24,
              textAlign: 'center',
            }}
          >
            <GitPullRequest size={32} color="rgba(255,255,255,0.1)" />
            <div style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--pipe-text-muted)' }}>
              {isPlaceholderInstructions
                ? 'Pull request not assigned yet'
                : 'Diff unavailable'}
            </div>
            <div style={{ fontSize: 10, maxWidth: 360, lineHeight: 1.6 }}>
              {isPlaceholderInstructions
                ? 'A repository matched to your background is being prepared. The diff will appear here once it is ready. If this persists, contact your recruiter.'
                : 'No diff data found for this PR.'}
            </div>
          </div>
        )}
      </div>

      {/* ── Right Panel: Verdict + Submit ─────────────────────── */}
      <div
        className="pipe-code-review-right"
        style={{
          width: 'clamp(260px, 22vw, 340px)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: BRAND_SURFACE,
          borderLeft: `1px solid ${BRAND_BORDER}`,
          boxShadow: BRAND_SHADOW,
          backdropFilter: 'blur(18px)',
        }}
      >
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Verdict */}
          <div style={{ padding: 24, borderBottom: `1px solid ${BRAND_BORDER}` }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: BRAND_DIM,
                marginBottom: 16,
                fontFamily: LABEL_FONT,
              }}
            >
              Your verdict
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {VERDICT_OPTIONS.map((opt) => {
                const isActive = verdict === opt.key;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.key}
                    onClick={() => handleVerdictChange(opt.key)}
                    style={{
                      padding: '14px 16px',
                      background: isActive ? opt.bg : BRAND_SURFACE_SOFT,
                      border: `1px solid ${isActive ? opt.border : BRAND_BORDER}`,
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        flex: 1,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon
                          size={14}
                          color={isActive ? opt.color : 'rgba(255,255,255,0.2)'}
                        />
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.05em',
                            color: isActive ? opt.color : 'rgba(255,255,255,0.35)',
                            fontFamily: LABEL_FONT,
                          }}
                        >
                          {opt.label}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 9,
                          color: isActive ? 'rgba(244,248,255,0.64)' : BRAND_DIM,
                          marginLeft: 22,
                          marginTop: 4,
                        }}
                      >
                        {opt.description}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div
            style={{
              padding: 24,
              borderBottom: `1px solid ${BRAND_BORDER}`,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: BRAND_DIM,
                marginBottom: 12,
                fontFamily: LABEL_FONT,
              }}
            >
              Review summary
            </div>

            <textarea
              value={summary}
              onChange={(e) => handleSummaryChange(e.target.value)}
              placeholder="Summarize your code review findings..."
              style={{
                minHeight: 120,
                background: BRAND_SURFACE_SOFT,
                border: `1px solid ${BRAND_BORDER}`,
                borderRadius: 4,
                color: '#f4f8ff',
                fontSize: 11,
                padding: 12,
                fontFamily: BODY_FONT,
                outline: 'none',
                resize: 'vertical',
                lineHeight: 1.6,
              }}
            />

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 8,
                fontSize: 9,
                color: BRAND_DIM,
                fontFamily: LABEL_FONT,
              }}
            >
              <span>Max 1000 characters</span>
              <span>
                {summary.length} / 1000
              </span>
            </div>
          </div>

          {/* Stats */}
          <div style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: BRAND_DIM,
                marginBottom: 12,
                fontFamily: LABEL_FONT,
              }}
            >
              Submission checklist
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 12,
                background: BRAND_SURFACE_SOFT,
                border: `1px solid ${BRAND_BORDER}`,
                borderRadius: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: BRAND_DIM, fontFamily: LABEL_FONT }}>Annotations</span>
                <span
                  style={{
                    fontSize: 10,
                    color:
                      submission.annotations.length > 0 ? 'var(--pipe-accent)' : 'rgba(255,255,255,0.3)',
                    fontWeight: 700,
                  }}
                >
                  {submission.annotations.length}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: BRAND_DIM, fontFamily: LABEL_FONT }}>Verdict</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: verdict ? '#34d399' : 'rgba(255,255,255,0.15)',
                  }}
                >
                  {verdict
                    ? verdict.replace('_', ' ')
                    : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: BRAND_DIM, fontFamily: LABEL_FONT }}>Summary</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: summary.trim() ? '#34d399' : 'rgba(255,255,255,0.15)',
                  }}
                >
                  {summary.trim() ? 'Ready' : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Review status indicator — submit is handled by StageShell footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: `1px solid ${BRAND_BORDER}`,
          }}
        >
          {isReady ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 16px',
                background: 'rgba(52,211,153,0.08)',
                border: '1px solid rgba(52,211,153,0.25)',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.12em',
                fontFamily: LABEL_FONT,
                color: '#34d399',
              }}
            >
              <CheckCircle2 size={13} />
              Review ready. Submit when you're done.
            </div>
          ) : (
            <div
              style={{
                padding: '10px 16px',
                fontSize: 9,
                color: BRAND_DIM,
                textAlign: 'center',
                letterSpacing: '0.08em',
                fontFamily: LABEL_FONT,
              }}
            >
              Choose a verdict and add a summary to enable submit
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @media (max-width: 980px) {
          .pipe-code-review-challenge {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: auto minmax(560px, 1fr) auto;
            overflow: auto !important;
          }

          .pipe-code-review-left,
          .pipe-code-review-right {
            width: auto !important;
            border-left: 0 !important;
            border-right: 0 !important;
          }

          .pipe-code-review-main {
            min-height: 560px;
            border-top: 1px solid ${BRAND_BORDER};
            border-bottom: 1px solid ${BRAND_BORDER};
          }
        }
      `}</style>
    </div>
  );
}
