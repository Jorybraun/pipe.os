import { useEffect, useState } from 'react';
import { Loader2, Sparkles, User } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import type { CandidateProfile } from './CandidateProfileReview';
import { CandidateProfileReview } from './CandidateProfileReview';

interface WaitingForMatchProps {
  title: string;
  instructions: string;
  config: {
    autoRefresh?: boolean;
    refreshIntervalSeconds?: number;
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

export function WaitingForMatch({
  title,
  instructions,
  config,
  onRefresh,
  sessionToken,
}: WaitingForMatchProps): JSX.Element {
  const intervalSeconds = config.refreshIntervalSeconds ?? 30;

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
            border: '1px solid rgba(96, 165, 250, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 28px',
          }}
        >
          <Sparkles size={24} color="#60a5fa" />
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

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 24,
          }}
        >
          <Loader2
            size={14}
            color="var(--pipe-text-dim)"
            className="animate-spin"
          />
          <span
            style={{
              fontSize: 11,
              color: 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.05em',
            }}
          >
            {`MATCHING IN PROGRESS${dots}`}
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
