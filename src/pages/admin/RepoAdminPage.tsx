/**
 * RepoAdminPage — /admin/repos
 *
 * Human-in-the-loop approval for the qualified_repos catalog.
 * Approve or deny repos from the offline crawler to control what enters
 * the challenge library.
 */

import { useState, useEffect, useCallback } from 'react';
import { Database, ExternalLink, Check, X, Loader2, Search } from 'lucide-react';
import { useApiClient } from '../../hooks/useApiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminStatus = 'pending' | 'approved' | 'denied';

interface QualifiedRepo {
  id: number;
  full_name: string;
  github_url: string;
  primary_language: string;
  stars: number;
  detected_domain: string | null;
  seniority_band: string | null;
  sloc: number | null;
  file_count: number | null;
  pr_quality_score: number;
  open_feature_issue_count: number | null;
  open_pr_count: number | null;
  admin_status: AdminStatus;
  disqualified: number;
  disqualified_reason: string | null;
}

interface ReposResponse {
  repos: QualifiedRepo[];
  total: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

const SENIORITY_COLOR: Record<string, string> = {
  junior: '#4ade80',
  mid: '#fbbf24',
  senior: '#f87171',
  staff: '#a78bfa',
};

const STATUS_FILTERS: Array<{ key: AdminStatus | 'all'; label: string }> = [
  { key: 'all', label: 'ALL' },
  { key: 'pending', label: 'PENDING' },
  { key: 'approved', label: 'APPROVED' },
  { key: 'denied', label: 'DENIED' },
];

// ─── Pill ─────────────────────────────────────────────────────────────────────

function Pill({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}): JSX.Element {
  const c = color ?? 'var(--pipe-text)';
  return (
    <button
      onClick={onClick}
      style={{
        ...mono,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.1em',
        padding: '4px 10px',
        borderRadius: 3,
        border: `1px solid ${active ? c : 'var(--pipe-border)'}`,
        background: active ? `${c}18` : 'transparent',
        color: active ? c : 'var(--pipe-text-dim)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {label}
    </button>
  );
}

// ─── Quality bar ──────────────────────────────────────────────────────────────

function QualityBar({ value, label }: { value: number; label: string }): JSX.Element {
  const c = value >= 0.7 ? '#4ade80' : value >= 0.4 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ ...mono, fontSize: 7, color: 'var(--pipe-text-dim)', width: 48, letterSpacing: '0.05em' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 3, background: 'var(--pipe-surface)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(value * 100)}%`, height: '100%', background: c, borderRadius: 2 }} />
      </div>
      <span style={{ ...mono, fontSize: 7, color: c, fontWeight: 700, width: 20, textAlign: 'right' }}>
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

// ─── Repo card ────────────────────────────────────────────────────────────────

function RepoCard({
  repo,
  onApprove,
  onDeny,
  onReset,
  saving,
}: {
  repo: QualifiedRepo;
  onApprove: () => void;
  onDeny: () => void;
  onReset: () => void;
  saving: boolean;
}): JSX.Element {
  const senColor = SENIORITY_COLOR[repo.seniority_band ?? ''] ?? 'var(--pipe-text-dim)';
  const ghUrl = `https://github.com/${repo.full_name}`;
  const featureIssues = repo.open_feature_issue_count ?? 0;
  const openPrs = repo.open_pr_count ?? 0;

  function fmtStars(n: number): string {
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }
  function fmtSloc(n: number | null): string {
    if (n == null) return '—';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

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
      {/* Top row: badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            ...mono,
            fontSize: 8,
            fontWeight: 700,
            color: '#60a5fa',
            padding: '2px 7px',
            borderRadius: 3,
            background: 'rgba(96,165,250,0.1)',
            border: '1px solid rgba(96,165,250,0.25)',
            letterSpacing: '0.08em',
          }}
        >
          {repo.primary_language.toUpperCase()}
        </span>
        {repo.seniority_band && (
          <span style={{ ...mono, fontSize: 8, fontWeight: 700, color: senColor, letterSpacing: '0.1em' }}>
            {repo.seniority_band.toUpperCase()}
          </span>
        )}
        {repo.detected_domain && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
            {repo.detected_domain}
          </span>
        )}
        <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
          ★ {fmtStars(repo.stars)}
        </span>
      </div>

      {/* Repo name */}
      <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', lineHeight: 1.3 }}>
        {repo.full_name}
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
          SLOC {fmtSloc(repo.sloc)}
        </span>
        {openPrs > 0 && (
          <span style={{ ...mono, fontSize: 8, color: '#60a5fa' }}>
            {openPrs} PRs
          </span>
        )}
        {featureIssues > 0 && (
          <span style={{ ...mono, fontSize: 8, color: '#4ade80' }}>
            {featureIssues} feature issues
          </span>
        )}
        {repo.disqualified ? (
          <span style={{ ...mono, fontSize: 8, color: '#f87171' }}>
            DISQUALIFIED
          </span>
        ) : null}
      </div>

      {/* PR quality bar */}
      <QualityBar value={repo.pr_quality_score} label="PR QUAL" />

      {/* Status + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
        <span
          style={{
            ...mono,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color:
              repo.admin_status === 'approved' ? '#4ade80' :
              repo.admin_status === 'denied' ? '#f87171' :
              'var(--pipe-text-dim)',
          }}
        >
          {repo.admin_status.toUpperCase()}
        </span>

        <a
          href={ghUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            ...mono,
            fontSize: 8,
            color: 'var(--pipe-text-dim)',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            textDecoration: 'none',
          }}
        >
          <ExternalLink size={9} /> GITHUB
        </a>

        <div style={{ flex: 1 }} />

        {repo.admin_status !== 'approved' && (
          <button
            onClick={onApprove}
            disabled={saving}
            style={{
              ...mono,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '0.1em',
              padding: '4px 10px',
              background: 'rgba(74,222,128,0.08)',
              border: '1px solid rgba(74,222,128,0.25)',
              borderRadius: 3,
              color: '#4ade80',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              opacity: saving ? 0.5 : 1,
            }}
          >
            <Check size={9} /> APPROVE
          </button>
        )}

        {repo.admin_status !== 'denied' && (
          <button
            onClick={onDeny}
            disabled={saving}
            style={{
              ...mono,
              fontSize: 8,
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 3,
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              opacity: saving ? 0.5 : 1,
            }}
          >
            <X size={9} /> DENY
          </button>
        )}

        {repo.admin_status !== 'pending' && (
          <button
            onClick={onReset}
            disabled={saving}
            style={{
              ...mono,
              fontSize: 8,
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 3,
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            RESET
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RepoAdminPage(): JSX.Element {
  const api = useApiClient();
  const [statusFilter, setStatusFilter] = useState<AdminStatus | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [repos, setRepos] = useState<QualifiedRepo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const load = useCallback(async (status: AdminStatus | 'all') => {
    setLoading(true);
    setError(null);
    try {
      const qs = status === 'all' ? '?limit=100' : `?status=${status}&limit=100`;
      const res = await api.get<ReposResponse>(`/api/v1/admin/repos${qs}`);
      setRepos(res.repos);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repos');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(statusFilter); }, [statusFilter, load]);

  const handleStatusChange = async (id: number, status: AdminStatus): Promise<void> => {
    setSaving(id);
    try {
      await api.patch(`/api/v1/admin/repos/${id}`, { admin_status: status });
      setRepos((prev) => prev.map((r) => r.id === id ? { ...r, admin_status: status } : r));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(null);
    }
  };

  const filtered = search.trim()
    ? repos.filter((r) => r.full_name.toLowerCase().includes(search.toLowerCase()) ||
        (r.detected_domain ?? '').toLowerCase().includes(search.toLowerCase()))
    : repos;

  const counts = {
    approved: repos.filter((r) => r.admin_status === 'approved').length,
    denied: repos.filter((r) => r.admin_status === 'denied').length,
    pending: repos.filter((r) => r.admin_status === 'pending').length,
  };

  return (
    <div
      style={{
        opacity: mounted ? 1 : 0,
        transition: 'opacity 0.4s ease',
        padding: '0 0 80px',
        maxWidth: 1400,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
        <div>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 8 }}>
            REPO_CATALOG
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--pipe-text)', margin: 0 }}>
            Repo Admin
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 16, ...mono, fontSize: 10 }}>
          <span style={{ color: 'var(--pipe-text-dim)' }}>{counts.pending} PENDING</span>
          <span style={{ color: '#4ade80' }}>{counts.approved} APPROVED</span>
          <span style={{ color: '#f87171' }}>{counts.denied} DENIED</span>
          <span style={{ color: 'var(--pipe-text-dim)' }}>{total} TOTAL</span>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {STATUS_FILTERS.map(({ key, label }) => (
            <Pill
              key={key}
              label={label}
              active={statusFilter === key}
              onClick={() => setStatusFilter(key)}
              color={
                key === 'approved' ? '#4ade80' :
                key === 'denied' ? '#f87171' :
                key === 'pending' ? '#fbbf24' :
                'var(--pipe-text)'
              }
            />
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '1px solid var(--pipe-border)', borderRadius: 4 }}>
          <Search size={12} color="var(--pipe-text-dim)" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="SEARCH..."
            style={{
              ...mono,
              fontSize: 9,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--pipe-text)',
              width: 140,
              letterSpacing: '0.05em',
            }}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          ...mono, fontSize: 10, color: '#f87171',
          padding: '10px 14px', border: '1px solid rgba(248,113,113,0.25)',
          borderRadius: 6, background: 'rgba(248,113,113,0.05)', marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={18} color="var(--pipe-text-dim)" style={{ animation: 'spin 1s linear infinite', margin: '0 auto' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Database size={28} color="var(--pipe-text-dim)" style={{ margin: '0 auto 16px' }} />
          <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: 'var(--pipe-text)', marginBottom: 8 }}>
            No repos in this category
          </div>
          <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-muted)', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
            Run the crawler to populate the catalog, then come back here to approve repos for the challenge library.
          </div>
        </div>
      )}

      {/* Grid */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
          {filtered.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              saving={saving === repo.id}
              onApprove={() => void handleStatusChange(repo.id, 'approved')}
              onDeny={() => void handleStatusChange(repo.id, 'denied')}
              onReset={() => void handleStatusChange(repo.id, 'pending')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
