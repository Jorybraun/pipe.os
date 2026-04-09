/**
 * ReposTab — REPOS tab for ChallengeStudioPage.
 *
 * Connects role personas to repo discovery:
 * Pipeline selector → DISCOVER → browse/accept/reject → convert to challenge.
 *
 * CR-13 (repo-discovery-pipeline.md)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  Star,
  Search as SearchIcon,
  Loader2,
  Check,
  X,
  ArrowRight,
  ExternalLink,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { SectionCard } from '../../components';
import { usePipelines } from '../../hooks/usePipelines';
import { useApiClient } from '../../hooks/useApiClient';
import {
  useRepoDiscovery,
  type DiscoveredRepo,
  type RepoStatus,
} from '../../hooks/useRepoDiscovery';
import type { OverviewResponse } from '../../lib/api/types';

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

// ─── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<RepoStatus, { label: string; color: string }> = {
  DISCOVERING: { label: 'DISCOVERING', color: '#fbbf24' },
  DISCOVERED: { label: 'DISCOVERED', color: '#60a5fa' },
  ASSESSED: { label: 'ASSESSED', color: '#a78bfa' },
  ACCEPTED: { label: 'ACCEPTED', color: '#4ade80' },
  REJECTED: { label: 'REJECTED', color: '#ef4444' },
  CONVERTING: { label: 'CONVERTING', color: '#fbbf24' },
  CHALLENGE_READY: { label: 'CHALLENGE READY', color: '#4ade80' },
  FAILED: { label: 'FAILED', color: '#ef4444' },
};

const FILTER_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: 'ALL' },
  { value: 'DISCOVERED', label: 'DISCOVERED' },
  { value: 'ASSESSED', label: 'ASSESSED' },
  { value: 'ACCEPTED', label: 'ACCEPTED' },
  { value: 'CHALLENGE_READY', label: 'READY' },
  { value: 'REJECTED', label: 'REJECTED' },
];

// ─── ReposTab ───────────────────────────────────────────────────────────────

export function ReposTab(): JSX.Element {
  const { pipelines, isLoading: pipelinesLoading } = usePipelines();
  const api = useApiClient();
  const discovery = useRepoDiscovery();

  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [personaSkills, setPersonaSkills] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Fetch persona skills when pipeline changes
  useEffect(() => {
    if (!selectedPipelineId) {
      setPersonaSkills([]);
      return;
    }

    void (async () => {
      try {
        const data = await api.get<OverviewResponse>(
          `/api/v1/pipelines/${selectedPipelineId}/overview`,
        );
        const persona = data.roleContext?.persona;
        setPersonaSkills(persona?.mustHaveSkills ?? []);
      } catch {
        setPersonaSkills([]);
      }
    })();
  }, [selectedPipelineId, api]);

  // Fetch repos when pipeline changes
  useEffect(() => {
    if (selectedPipelineId) {
      void discovery.fetchRepos(selectedPipelineId);
    }
  }, [selectedPipelineId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDiscover = useCallback(async () => {
    if (!selectedPipelineId) return;
    await discovery.startDiscovery(selectedPipelineId);
  }, [selectedPipelineId, discovery]);

  const filteredRepos = statusFilter === 'ALL'
    ? discovery.repos
    : discovery.repos.filter((r) => r.status === statusFilter);

  const hasPersona = personaSkills.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Discovery Panel */}
      <SectionCard label="REPO_DISCOVERY" icon={<SearchIcon size={14} />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Pipeline selector */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)', letterSpacing: '0.1em', fontWeight: 700 }}>
              PIPELINE
            </label>
            <select
              value={selectedPipelineId ?? ''}
              onChange={(e) => setSelectedPipelineId(e.target.value || null)}
              disabled={pipelinesLoading}
              style={{
                ...mono,
                fontSize: 10,
                background: 'var(--pipe-bg)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text)',
                padding: '6px 10px',
                flex: 1,
                maxWidth: 400,
              }}
            >
              <option value="">Select a pipeline...</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.level})
                </option>
              ))}
            </select>

            <button
              onClick={handleDiscover}
              disabled={!selectedPipelineId || !hasPersona || discovery.isDiscovering}
              style={{
                ...mono,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                padding: '6px 14px',
                background: hasPersona ? 'rgba(96,165,250,0.12)' : 'transparent',
                border: `1px solid ${hasPersona ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
                borderRadius: 4,
                color: hasPersona ? '#60a5fa' : 'var(--pipe-text-dim)',
                cursor: hasPersona ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                opacity: discovery.isDiscovering ? 0.6 : 1,
              }}
            >
              {discovery.isDiscovering ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
              {discovery.isDiscovering ? 'DISCOVERING...' : 'DISCOVER REPOS'}
            </button>
          </div>

          {/* Persona skills preview */}
          {selectedPipelineId && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.1em' }}>
                {hasPersona ? 'SKILLS:' : 'NO PERSONA — run role discovery first'}
              </span>
              {personaSkills.map((s) => (
                <span
                  key={s}
                  style={{
                    ...mono,
                    fontSize: 8,
                    color: '#60a5fa',
                    padding: '2px 7px',
                    borderRadius: 3,
                    background: 'rgba(96,165,250,0.1)',
                    border: '1px solid rgba(96,165,250,0.2)',
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {/* Job status */}
          {discovery.job && (
            <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-muted)', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span>
                Status: <strong style={{ color: discovery.job.status === 'COMPLETED' ? '#4ade80' : '#fbbf24' }}>{discovery.job.status}</strong>
              </span>
              {discovery.job.skillsQueried.length > 0 && (
                <span>Queried: {discovery.job.skillsQueried.join(', ')}</span>
              )}
              {discovery.job.totalPassed > 0 && (
                <span style={{ color: '#4ade80' }}>{discovery.job.totalPassed} repos found</span>
              )}
              {discovery.job.totalRejected > 0 && (
                <span style={{ color: 'var(--pipe-text-dim)' }}>{discovery.job.totalRejected} filtered out</span>
              )}
            </div>
          )}

          {/* Error */}
          {discovery.error && (
            <div style={{ ...mono, fontSize: 9, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={11} /> {discovery.error}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Filter pills */}
      {discovery.repos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTER_STATUSES.map((f) => {
            const count = f.value === 'ALL'
              ? discovery.repos.length
              : discovery.repos.filter((r) => r.status === f.value).length;
            const active = statusFilter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                style={{
                  ...mono,
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  padding: '4px 10px',
                  background: active ? 'rgba(96,165,250,0.12)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
                  borderRadius: 3,
                  color: active ? '#60a5fa' : 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                }}
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Repo grid */}
      {discovery.isLoadingRepos ? (
        <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-dim)', textAlign: 'center', padding: 40 }}>
          <Loader2 size={16} className="animate-spin" style={{ margin: '0 auto 8px' }} /> Loading repos...
        </div>
      ) : filteredRepos.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
            gap: 12,
          }}
        >
          {filteredRepos.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              onAccept={() => void discovery.acceptRepo(repo.id)}
              onReject={() => void discovery.rejectRepo(repo.id)}
              onConvert={() => void discovery.convertToChallenge(repo.id)}
              isConverting={discovery.isConverting}
            />
          ))}
        </div>
      ) : selectedPipelineId ? (
        <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-dim)', textAlign: 'center', padding: 40 }}>
          No repos discovered yet. Click DISCOVER REPOS to find matching repositories.
        </div>
      ) : null}
    </div>
  );
}

// ─── RepoCard ───────────────────────────────────────────────────────────────

function RepoCard({
  repo,
  onAccept,
  onReject,
  onConvert,
  isConverting,
}: {
  repo: DiscoveredRepo;
  onAccept: () => void;
  onReject: () => void;
  onConvert: () => void;
  isConverting: boolean;
}): JSX.Element {
  const statusCfg = STATUS_CONFIG[repo.status] ?? { label: repo.status, color: 'var(--pipe-text-dim)' };
  const canAct = repo.status === 'DISCOVERED' || repo.status === 'ASSESSED';
  const canConvert = repo.status === 'ACCEPTED';

  return (
    <div
      style={{
        padding: '16px 18px',
        border: '1px solid var(--pipe-border)',
        borderRadius: 8,
        background: 'var(--pipe-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Badges row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {repo.stars != null && (
          <span style={{ ...mono, fontSize: 8, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 3 }}>
            <Star size={9} /> {repo.stars >= 1000 ? `${(repo.stars / 1000).toFixed(1)}k` : repo.stars}
          </span>
        )}
        {repo.primaryLanguage && (
          <span style={{ ...mono, fontSize: 8, color: '#a78bfa', letterSpacing: '0.05em' }}>
            {repo.primaryLanguage}
          </span>
        )}
        {repo.license && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
            {repo.license.toUpperCase()}
          </span>
        )}
        {repo.seniorityBand && (
          <span
            style={{
              ...mono,
              fontSize: 7,
              fontWeight: 700,
              color: '#4ade80',
              padding: '1px 6px',
              borderRadius: 3,
              background: 'rgba(74,222,128,0.1)',
              border: '1px solid rgba(74,222,128,0.2)',
              letterSpacing: '0.1em',
            }}
          >
            {repo.seniorityBand}
          </span>
        )}
      </div>

      {/* Repo name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <GitBranch size={13} color="var(--pipe-text-dim)" />
        <a
          href={repo.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            ...mono,
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--pipe-text)',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {repo.githubOwner}/{repo.githubRepo}
          <ExternalLink size={9} color="var(--pipe-text-dim)" />
        </a>
      </div>

      {/* Quality bars */}
      {repo.qualityScore != null && (
        <QualityBar label="QUALITY" value={repo.qualityScore} color="#4ade80" />
      )}
      {repo.stackMatchScore != null && (
        <QualityBar label="STACK" value={repo.stackMatchScore} color="#60a5fa" />
      )}

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {repo.sloc != null && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
            {repo.sloc >= 1000 ? `${(repo.sloc / 1000).toFixed(0)}k` : repo.sloc} SLOC
          </span>
        )}
        {repo.meanCyclomaticComplexity != null && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
            {repo.meanCyclomaticComplexity.toFixed(1)} CCN
          </span>
        )}
        {repo.sourceFileCount != null && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
            {repo.sourceFileCount} files
          </span>
        )}
        {repo.topics.length > 0 && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
            {repo.topics.slice(0, 3).join(', ')}
          </span>
        )}
      </div>

      {/* Status + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
        <span
          style={{
            ...mono,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: statusCfg.color,
          }}
        >
          {statusCfg.label}
        </span>
        <div style={{ flex: 1 }} />

        {canAct && (
          <>
            <button
              onClick={onAccept}
              style={{
                ...mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
                padding: '4px 10px', background: 'rgba(74,222,128,0.08)',
                border: '1px solid rgba(74,222,128,0.25)', borderRadius: 3,
                color: '#4ade80', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <Check size={9} /> ACCEPT
            </button>
            <button
              onClick={onReject}
              style={{
                ...mono, fontSize: 8, padding: '4px 8px',
                background: 'transparent', border: '1px solid var(--pipe-border)',
                borderRadius: 3, color: 'var(--pipe-text-dim)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <X size={9} /> REJECT
            </button>
          </>
        )}

        {canConvert && (
          <button
            onClick={onConvert}
            disabled={isConverting}
            style={{
              ...mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
              padding: '4px 12px', background: 'rgba(96,165,250,0.12)',
              border: '1px solid rgba(96,165,250,0.3)', borderRadius: 3,
              color: '#60a5fa', cursor: isConverting ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: isConverting ? 0.6 : 1,
            }}
          >
            {isConverting ? <Loader2 size={9} /> : <ArrowRight size={9} />}
            CONVERT TO CHALLENGE
          </button>
        )}

        {repo.status === 'CHALLENGE_READY' && repo.challengeTemplateId && (
          <span style={{ ...mono, fontSize: 8, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Check size={9} /> Challenge created
          </span>
        )}
      </div>
    </div>
  );
}

// ─── QualityBar ─────────────────────────────────────────────────────────────

function QualityBar({ label, value, color }: { label: string; value: number; color: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ ...mono, fontSize: 7, color: 'var(--pipe-text-dim)', width: 38, letterSpacing: '0.05em' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 3, background: 'var(--pipe-bg)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(value * 100)}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ ...mono, fontSize: 7, color, fontWeight: 700, width: 20, textAlign: 'right' }}>
        {Math.round(value * 100)}
      </span>
    </div>
  );
}
