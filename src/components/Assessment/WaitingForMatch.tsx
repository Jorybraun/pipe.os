import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, User } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import type { CandidateProfile } from './CandidateProfileReview';
import { CandidateProfileReview } from './CandidateProfileReview';

export interface WaitingForMatchDiagnostics {
  phase?: 'candidate_evidence' | 'repo_matching';
  ingestionStatus?: string | null;
  currentStep?: string | null;
  matchableNodeCount?: number;
  rawNodeCount?: number;
  updatedAt?: string | null;
  estimatedCompletionAt?: string | null;
  staleAfterSeconds?: number;
  pipeline?: WaitingPipelineStep[];
}

export type WaitingPipelineStepStatus = 'pending' | 'active' | 'complete' | 'blocked';

export interface WaitingPipelineStep {
  id: 'intake' | 'decomposition' | 'repo_matching' | 'challenge' | 'review' | 'scoring';
  label: string;
  status: WaitingPipelineStepStatus;
  detail?: string | null;
  updatedAt?: string | null;
}

interface WaitingForMatchProps {
  title: string;
  instructions: string;
  config: {
    autoRefresh?: boolean;
    refreshIntervalSeconds?: number;
    state?: 'pending' | 'blocked';
    reason?: string;
    diagnostics?: WaitingForMatchDiagnostics;
  };
  onRefresh: () => void | Promise<void>;
  sessionToken?: string | null;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '';

async function fetchProfile(sessionToken: string): Promise<CandidateProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/rpc/candidate-profile`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { profile?: CandidateProfile };
    return data.profile ?? null;
  } catch {
    return null;
  }
}

function progressLabelForStepId(stepId: WaitingPipelineStep['id']): string {
  if (stepId === 'intake' || stepId === 'decomposition') return 'Analyzing your background';
  if (stepId === 'repo_matching') return 'Finding a real project that fits';
  return 'Preparing your review';
}

function progressBlockStatus(
  diagnostics: WaitingForMatchDiagnostics | undefined,
  stepIds: WaitingPipelineStep['id'][],
): WaitingPipelineStepStatus {
  const pipeline = diagnostics?.pipeline ?? [];
  const matching = pipeline.filter((step) => stepIds.includes(step.id));
  if (matching.some((step) => step.status === 'blocked')) return 'blocked';
  if (matching.some((step) => step.status === 'active')) return 'active';
  if (matching.some((step) => step.status === 'complete')) return 'complete';
  return 'pending';
}

function currentProgressBlock(
  diagnostics: WaitingForMatchDiagnostics | undefined,
  isBlocked: boolean,
): { label: string; status: WaitingPipelineStepStatus } {
  const pipeline = diagnostics?.pipeline ?? [];
  if (pipeline.length === 0) {
    return {
      label: isBlocked ? 'Finding a real project that fits' : 'Analyzing your background',
      status: isBlocked ? 'blocked' : 'active',
    };
  }

  const blocks: Array<{ label: string; stepIds: WaitingPipelineStep['id'][] }> = [
    { label: 'Analyzing your background', stepIds: ['intake', 'decomposition'] },
    { label: 'Finding a real project that fits', stepIds: ['repo_matching'] },
    { label: 'Preparing your review', stepIds: ['challenge', 'review', 'scoring'] },
  ];

  const activeBlock = blocks.find((block) => progressBlockStatus(diagnostics, block.stepIds) === 'active');
  if (activeBlock) {
    return { label: activeBlock.label, status: 'active' };
  }

  if (isBlocked) {
    const blockedBlock = blocks.find((block) => progressBlockStatus(diagnostics, block.stepIds) === 'blocked');
    if (blockedBlock) return { label: blockedBlock.label, status: 'blocked' };
  }
  const pendingBlock = blocks.find((block) => progressBlockStatus(diagnostics, block.stepIds) === 'pending');
  return pendingBlock
    ? { label: pendingBlock.label, status: 'pending' }
    : { label: 'Preparing your review', status: isBlocked ? 'blocked' : 'complete' };
}

function statusLabel(value: WaitingPipelineStepStatus): string {
  if (value === 'complete') return 'Done';
  if (value === 'active') return 'Working';
  if (value === 'blocked') return 'Needs attention';
  return 'Queued';
}

function statusColorForBlock(value: WaitingPipelineStepStatus): string {
  if (value === 'complete') return '#4ade80';
  if (value === 'active') return '#60a5fa';
  if (value === 'blocked') return '#fbbf24';
  return 'var(--pipe-text-dim)';
}

function blockTone(value: WaitingPipelineStepStatus): string {
  if (value === 'complete') return 'rgba(74,222,128,0.08)';
  if (value === 'active') return 'rgba(96,165,250,0.08)';
  if (value === 'blocked') return 'rgba(251,191,36,0.08)';
  return 'rgba(12,12,14,0.24)';
}

export function WaitingForMatch({
  config,
  onRefresh,
  sessionToken,
}: WaitingForMatchProps): JSX.Element {
  const intervalSeconds = config.refreshIntervalSeconds ?? 30;
  const isBlocked = config.state === 'blocked';
  const profileReadyStatuses = new Set(['profile_generated', 'embedded', 'matched', 'enriched']);
  const canViewProfile = Boolean(
    sessionToken
      && !isBlocked
      && config.diagnostics?.ingestionStatus
      && profileReadyStatuses.has(config.diagnostics.ingestionStatus),
  );
  const profileUnavailableMessage = isBlocked
    ? 'Profile is unavailable while matching needs recruiter attention.'
    : 'Profile appears after PIPE finishes reviewing your background.';

  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<'idle' | 'checking' | 'checked' | 'failed'>('idle');

  // Auto-refresh
  useEffect(() => {
    if (!config.autoRefresh) return;
    const t = setInterval(() => {
      Promise.resolve(onRefresh()).catch(() => {
        // Manual refresh owns user-visible failure messaging.
      });
    }, intervalSeconds * 1000);
    return () => clearInterval(t);
  }, [config.autoRefresh, intervalSeconds, onRefresh]);

  const handleRefresh = async () => {
    if (refreshState === 'checking') return;
    setRefreshState('checking');
    try {
      await onRefresh();
      setRefreshState('checked');
    } catch {
      setRefreshState('failed');
    }
  };

  const handleViewProfile = async () => {
    if (!sessionToken) return;
    setProfileError(null);
    setProfileLoading(true);
    const p = await fetchProfile(sessionToken);
    setProfile(p);
    setProfileLoading(false);
    if (!p) {
      setProfileError('Profile is not ready yet. PIPE is still reviewing your background.');
      return;
    }
    setShowProfile(true);
  };
  const progressBlocks: Array<{ label: string; status: WaitingPipelineStepStatus }> = [
    {
      label: progressLabelForStepId('decomposition'),
      status: progressBlockStatus(config.diagnostics, ['intake', 'decomposition']),
    },
    {
      label: progressLabelForStepId('repo_matching'),
      status: progressBlockStatus(config.diagnostics, ['repo_matching']),
    },
    {
      label: progressLabelForStepId('challenge'),
      status: progressBlockStatus(config.diagnostics, ['challenge', 'review', 'scoring']),
    },
  ];
  const activeBlock = currentProgressBlock(config.diagnostics, isBlocked);
  const statusText = activeBlock.status === 'blocked'
    ? `${activeBlock.label} needs attention`
    : activeBlock.label;
  const safeInstructions = isBlocked
    ? 'Your recruiter needs to review this match before your review continues.'
    : 'PIPE is analyzing your background, finding a real project that fits, and preparing your review.';
  const displayTitle = activeBlock.label;

  if (showProfile && profile) {
    return (
      <div style={{ height: '100vh', overflow: 'auto', background: '#0c0c0e', padding: 24 }}>
        <button
          onClick={() => setShowProfile(false)}
          style={{
            marginBottom: 16,
            padding: '8px 16px',
            background: 'var(--pipe-surface-hover)',
            border: '1px solid var(--pipe-border)',
            color: 'var(--pipe-text, #fff)',
            fontSize: 10,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            cursor: 'pointer',
            borderRadius: 4,
          }}
        >
          ← BACK TO WAITING
        </button>
        <CandidateProfileReview profile={profile} />
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <LiquidMetalCard
        variant="mercury"
        style={{
          maxWidth: 520,
          width: '100%',
          padding: '48px 40px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'rgba(96, 165, 250, 0.08)',
            border: isBlocked ? '1px solid rgba(251, 191, 36, 0.28)' : '1px solid rgba(96, 165, 250, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 28px',
          }}
        >
          {isBlocked ? <AlertTriangle size={24} color="#fbbf24" /> : <Sparkles size={24} color="#60a5fa" />}
        </div>

        <h2
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--pipe-text, #fff)',
            margin: '0 0 12px',
            letterSpacing: '-0.02em',
          }}
        >
          {displayTitle}
        </h2>

        <p
          style={{
            fontSize: 13,
            color: 'var(--pipe-text-dim)',
            lineHeight: 1.6,
            margin: '0 0 32px',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          {safeInstructions}
        </p>

        {config.reason && (
          <p
            style={{
              fontSize: 11,
              color: 'var(--pipe-text-dim)',
              lineHeight: 1.6,
              margin: '0 0 24px',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {config.reason}
          </p>
        )}

        {progressBlocks.length > 0 && (
          <div
            data-testid="code-review-pipeline"
            style={{
              margin: '0 0 24px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(12,12,14,0.28)',
              textAlign: 'left',
            }}
          >
            {progressBlocks.map((row) => (
              <div
                key={row.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderBottom: row.label === progressBlocks[progressBlocks.length - 1]?.label
                    ? 'none'
                    : '1px solid rgba(255,255,255,0.08)',
                  fontFamily: '"Space Mono", monospace',
                  background: blockTone(row.status),
                }}
              >
                <span style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--pipe-text, #fff)', lineHeight: 1.4 }}>
                    {row.label}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                    {row.status === 'complete'
                      ? 'This step is done.'
                      : row.status === 'active'
                        ? 'This step is in progress.'
                        : row.status === 'blocked'
                          ? 'This step needs recruiter attention.'
                          : 'This step is queued.'}
                  </span>
                </span>
                <span style={{ fontSize: 8, color: statusColorForBlock(row.status), fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {statusLabel(row.status)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 24,
          }}
        >
          {!isBlocked && (
            <Loader2
              size={14}
              color="var(--pipe-text-dim)"
              className="animate-spin"
            />
          )}
          <span
            data-testid="code-review-pipeline-status"
            style={{
              fontSize: 11,
              color: isBlocked ? '#fbbf24' : 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.05em',
            }}
          >
            {statusText}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleRefresh}
            disabled={refreshState === 'checking'}
            style={{
              padding: '10px 24px',
              background: 'var(--pipe-surface-hover)',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text, #fff)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: refreshState === 'checking' ? 'wait' : 'pointer',
              borderRadius: 4,
              transition: 'all 0.2s',
              opacity: refreshState === 'checking' ? 0.65 : 1,
            }}
            onMouseEnter={(e) => {
              if (refreshState !== 'checking') e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--pipe-surface-hover)';
            }}
          >
            {refreshState === 'checking' ? 'CHECKING...' : 'CHECK STATUS NOW'}
          </button>

          {canViewProfile ? (
            <button
              onClick={handleViewProfile}
              disabled={profileLoading}
              style={{
                padding: '10px 24px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'var(--pipe-text-dim)',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: profileLoading ? 'not-allowed' : 'pointer',
                borderRadius: 4,
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: profileLoading ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!profileLoading) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
              }}
            >
              <User size={12} />
              {profileLoading ? 'LOADING...' : 'VIEW PROFILE'}
            </button>
          ) : (
            <span
              style={{
                alignSelf: 'center',
                color: 'var(--pipe-text-dim)',
                fontSize: 10,
                lineHeight: 1.5,
                fontFamily: '"Space Mono", monospace',
              }}
            >
              {profileUnavailableMessage}
            </span>
          )}
        </div>
        {refreshState === 'checked' && (
          <div style={{ marginTop: 12, color: '#4ade80', fontSize: 10, fontFamily: '"Space Mono", monospace' }}>
            Status checked. If this state does not change, PIPE is still waiting on the evidence gate shown above.
          </div>
        )}
        {refreshState === 'failed' && (
          <div style={{ marginTop: 12, color: '#f87171', fontSize: 10, fontFamily: '"Space Mono", monospace' }}>
            Status check failed. Refresh the page or contact the recruiter for a fresh invite.
          </div>
        )}
        {profileError && (
          <div style={{ marginTop: 12, color: '#fbbf24', fontSize: 10, lineHeight: 1.5, fontFamily: '"Space Mono", monospace' }}>
            {profileError}
          </div>
        )}
      </LiquidMetalCard>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
