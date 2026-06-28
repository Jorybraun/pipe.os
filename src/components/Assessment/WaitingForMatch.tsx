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
  onRefresh: () => void;
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

function formatDiagnosticLabel(value: string): string {
  return value.replace(/_/g, ' ').toUpperCase();
}

function formatUpdatedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function diagnosticRows(diagnostics: WaitingForMatchDiagnostics | undefined): Array<{ label: string; value: string }> {
  if (!diagnostics) return [];
  const rows: Array<{ label: string; value: string }> = [];
  if (diagnostics.phase) {
    rows.push({ label: 'PHASE', value: formatDiagnosticLabel(diagnostics.phase) });
  }
  if (diagnostics.ingestionStatus) {
    rows.push({ label: 'STATUS', value: formatDiagnosticLabel(diagnostics.ingestionStatus) });
  }
  if (diagnostics.currentStep) {
    rows.push({ label: 'STEP', value: formatDiagnosticLabel(diagnostics.currentStep) });
  }
  if (typeof diagnostics.matchableNodeCount === 'number' || typeof diagnostics.rawNodeCount === 'number') {
    const matchable = diagnostics.matchableNodeCount ?? 0;
    const raw = diagnostics.rawNodeCount ?? matchable;
    rows.push({ label: 'EVIDENCE', value: `${matchable} MATCHABLE / ${raw} RAW` });
  }
  const updatedAt = formatUpdatedAt(diagnostics.updatedAt);
  if (updatedAt) {
    rows.push({ label: 'UPDATED', value: updatedAt.toUpperCase() });
  }
  return rows;
}

export function WaitingForMatch({
  title,
  instructions,
  config,
  onRefresh,
  sessionToken,
}: WaitingForMatchProps): JSX.Element {
  const intervalSeconds = config.refreshIntervalSeconds ?? 30;
  const isBlocked = config.state === 'blocked';
  const rows = diagnosticRows(config.diagnostics);

  const [dots, setDots] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Animated ellipsis
  useEffect(() => {
    const t = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 600);
    return () => clearInterval(t);
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (!config.autoRefresh) return;
    const t = setInterval(() => {
      onRefresh();
    }, intervalSeconds * 1000);
    return () => clearInterval(t);
  }, [config.autoRefresh, intervalSeconds, onRefresh]);

  const handleViewProfile = async () => {
    if (!sessionToken) return;
    setProfileLoading(true);
    const p = await fetchProfile(sessionToken);
    setProfile(p);
    setProfileLoading(false);
    setShowProfile(true);
  };

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
          {title}
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
          {instructions}
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

        {rows.length > 0 && (
          <div
            style={{
              margin: '0 0 24px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(12,12,14,0.28)',
              textAlign: 'left',
            }}
          >
            {rows.map((row) => (
              <div
                key={row.label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '112px minmax(0, 1fr)',
                  gap: 12,
                  padding: '10px 12px',
                  borderBottom: row.label === rows[rows.length - 1]?.label ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--pipe-text-dim)',
                    lineHeight: 1.4,
                  }}
                >
                  {row.label}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--pipe-text, #fff)',
                    lineHeight: 1.4,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {row.value}
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
            style={{
              fontSize: 11,
              color: isBlocked ? '#fbbf24' : 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.05em',
            }}
          >
            {isBlocked ? 'MATCHING NEEDS ATTENTION' : `MATCHING IN PROGRESS${dots}`}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={onRefresh}
            style={{
              padding: '10px 24px',
              background: 'var(--pipe-surface-hover)',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text, #fff)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
              borderRadius: 4,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--pipe-surface-hover)';
            }}
          >
            CHECK STATUS NOW
          </button>

          {sessionToken && (
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
          )}
        </div>
      </LiquidMetalCard>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
