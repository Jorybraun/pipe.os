/**
 * RepoAdminPage — Admin page for approving/denying repos in the qualified_repos catalog.
 *
 * Route: /admin/repos
 * Auth: Clerk JWT (recruiter-only)
 *
 * Shows all repos from the crawler with pending/approved/denied status.
 * The human can approve or deny each one to control what enters the challenge library.
 */

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../../lib/api/client';
import { ExternalLink, Check, X, Clock } from 'lucide-react';

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
  crawled_at: string;
}

interface ReposResponse {
  repos: QualifiedRepo[];
  total: number;
  page: number;
  limit: number;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const MONO: CSSProperties = { fontFamily: "'Space Mono', 'Courier New', monospace" };

const s = {
  page: {
    minHeight: '100vh',
    background: '#0c0c0e',
    color: '#dde0ee',
    ...MONO,
  } satisfies CSSProperties,

  header: {
    padding: '20px 28px 0',
    borderBottom: '1px solid #242530',
    paddingBottom: 0,
  } satisfies CSSProperties,

  title: {
    fontSize: 18,
    fontWeight: 700,
    color: '#dde0ee',
    ...MONO,
  } satisfies CSSProperties,

  subtitle: {
    fontSize: 11,
    color: '#50546a',
    marginTop: 4,
    ...MONO,
  } satisfies CSSProperties,

  tabs: {
    display: 'flex',
    gap: 0,
    marginTop: 16,
  } satisfies CSSProperties,

  tab: (active: boolean): CSSProperties => ({
    padding: '8px 20px',
    fontSize: 11,
    fontWeight: active ? 700 : 400,
    color: active ? '#dde0ee' : '#50546a',
    background: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? '#60a5fa' : 'transparent'}`,
    cursor: 'pointer',
    ...MONO,
  }),

  body: {
    padding: '20px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  } satisfies CSSProperties,

  card: {
    background: '#111214',
    border: '1px solid #242530',
    padding: '14px 18px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 16,
  } satisfies CSSProperties,

  cardMain: {
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  repoName: {
    fontSize: 14,
    fontWeight: 700,
    color: '#dde0ee',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap' as const,
  } satisfies CSSProperties,

  repoLink: {
    color: '#60a5fa',
    textDecoration: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
  } satisfies CSSProperties,

  meta: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px 14px',
    marginTop: 6,
    fontSize: 11,
    color: '#8890a8',
    ...MONO,
  } satisfies CSSProperties,

  metaLabel: {
    color: '#50546a',
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  } satisfies CSSProperties,

  tag: (color: string): CSSProperties => ({
    display: 'inline-block',
    padding: '1px 7px',
    fontSize: 10,
    border: `1px solid ${color}44`,
    color,
    background: `${color}11`,
  }),

  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexShrink: 0,
  } satisfies CSSProperties,

  btn: (variant: 'approve' | 'deny' | 'reset'): CSSProperties => {
    const colors = {
      approve: { bg: 'rgba(74,222,128,.1)', border: 'rgba(74,222,128,.4)', color: '#4ade80' },
      deny:    { bg: 'rgba(248,113,113,.1)', border: 'rgba(248,113,113,.4)', color: '#f87171' },
      reset:   { bg: 'rgba(80,84,106,.1)',   border: '#363743',              color: '#8890a8' },
    }[variant];
    return {
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      padding: '5px 14px',
      fontSize: 11,
      fontWeight: 700,
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      color: colors.color,
      cursor: 'pointer',
      ...MONO,
    };
  },

  statusBadge: (status: AdminStatus): CSSProperties => {
    const map = {
      pending:  { color: '#fbbf24', border: 'rgba(251,191,36,.3)',  bg: 'rgba(251,191,36,.08)'  },
      approved: { color: '#4ade80', border: 'rgba(74,222,128,.3)',  bg: 'rgba(74,222,128,.08)'  },
      denied:   { color: '#f87171', border: 'rgba(248,113,113,.3)', bg: 'rgba(248,113,113,.08)' },
    }[status];
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 9px',
      fontSize: 10,
      fontWeight: 700,
      border: `1px solid ${map.border}`,
      color: map.color,
      background: map.bg,
      letterSpacing: '0.04em',
      ...MONO,
    };
  },

  empty: {
    padding: '48px 0',
    textAlign: 'center' as const,
    color: '#50546a',
    fontSize: 12,
    ...MONO,
  } satisfies CSSProperties,

  loading: {
    padding: '48px 0',
    textAlign: 'center' as const,
    color: '#50546a',
    fontSize: 12,
    ...MONO,
  } satisfies CSSProperties,

  error: {
    padding: '16px',
    background: 'rgba(248,113,113,.08)',
    border: '1px solid rgba(248,113,113,.3)',
    color: '#f87171',
    fontSize: 12,
    marginBottom: 12,
    ...MONO,
  } satisfies CSSProperties,

  counts: {
    display: 'flex',
    gap: 20,
    fontSize: 11,
    color: '#8890a8',
    marginTop: 8,
    paddingBottom: 16,
  } satisfies CSSProperties,

  countItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 2,
  } satisfies CSSProperties,

  countNum: {
    fontSize: 18,
    fontWeight: 700,
  } satisfies CSSProperties,

  countLabel: {
    fontSize: 9,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: '#50546a',
  } satisfies CSSProperties,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtStars(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function fmtSloc(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ─── Repo card ───────────────────────────────────────────────────────────────

interface RepoCardProps {
  repo: QualifiedRepo;
  onStatusChange: (id: number, status: AdminStatus) => void;
  loading: boolean;
}

function RepoCard({ repo, onStatusChange, loading }: RepoCardProps): JSX.Element {
  const ghUrl = `https://github.com/${repo.full_name}`;
  const featureIssues = repo.open_feature_issue_count ?? 0;

  return (
    <div style={s.card}>
      <div style={s.cardMain}>
        {/* Repo name + link */}
        <div style={s.repoName}>
          <span>{repo.full_name}</span>
          <a href={ghUrl} target="_blank" rel="noopener noreferrer" style={s.repoLink}>
            <ExternalLink size={11} />
            GitHub
          </a>
        </div>

        {/* Meta row */}
        <div style={s.meta}>
          <span><span style={s.metaLabel}>★ </span>{fmtStars(repo.stars)}</span>
          <span>{repo.primary_language}</span>
          {repo.detected_domain && <span>{repo.detected_domain}</span>}
          {repo.seniority_band && <span>{repo.seniority_band}</span>}
          <span><span style={s.metaLabel}>sloc </span>{fmtSloc(repo.sloc)}</span>
          <span><span style={s.metaLabel}>pr quality </span>{repo.pr_quality_score.toFixed(2)}</span>
          {featureIssues > 0 && (
            <span style={{ color: '#4ade80' }}>
              {featureIssues} feature issue{featureIssues !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Tags */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {repo.disqualified ? (
            <span style={s.tag('#f87171')}>disqualified{repo.disqualified_reason ? `: ${repo.disqualified_reason}` : ''}</span>
          ) : null}
          {featureIssues > 0 && <span style={s.tag('#4ade80')}>feature impl</span>}
          {(repo.open_pr_count ?? 0) > 0 && <span style={s.tag('#60a5fa')}>code review</span>}
        </div>
      </div>

      {/* Status + actions */}
      <div style={s.actions}>
        <div style={s.statusBadge(repo.admin_status)}>
          {repo.admin_status === 'approved' && <Check size={10} />}
          {repo.admin_status === 'denied' && <X size={10} />}
          {repo.admin_status === 'pending' && <Clock size={10} />}
          {repo.admin_status}
        </div>

        {repo.admin_status !== 'approved' && (
          <button
            style={s.btn('approve')}
            onClick={() => onStatusChange(repo.id, 'approved')}
            disabled={loading}
          >
            <Check size={11} /> Approve
          </button>
        )}
        {repo.admin_status !== 'denied' && (
          <button
            style={s.btn('deny')}
            onClick={() => onStatusChange(repo.id, 'denied')}
            disabled={loading}
          >
            <X size={11} /> Deny
          </button>
        )}
        {repo.admin_status !== 'pending' && (
          <button
            style={s.btn('reset')}
            onClick={() => onStatusChange(repo.id, 'pending')}
            disabled={loading}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type TabFilter = 'all' | 'pending' | 'approved' | 'denied';

export default function RepoAdminPage(): JSX.Element {
  const { getToken } = useClerkAuth();
  const [tab, setTab] = useState<TabFilter>('pending');
  const [repos, setRepos] = useState<QualifiedRepo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = createApiClient({ getToken });

  const load = useCallback(async (filter: TabFilter) => {
    setLoading(true);
    setError(null);
    try {
      const statusParam = filter === 'all' ? '' : `?status=${filter}&limit=100`;
      const res = await api.get<ReposResponse>(`/api/v1/admin/repos${statusParam || '?limit=100'}`);
      setRepos(res.repos);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(tab); }, [tab, load]);

  const handleStatusChange = async (id: number, status: AdminStatus): Promise<void> => {
    setActionLoading(true);
    try {
      await api.patch(`/api/v1/admin/repos/${id}`, { admin_status: status });
      setRepos((prev) =>
        prev.map((r) => (r.id === id ? { ...r, admin_status: status } : r)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update repo');
    } finally {
      setActionLoading(false);
    }
  };

  // Counts for the header
  const approvedCount = repos.filter((r) => r.admin_status === 'approved').length;
  const deniedCount = repos.filter((r) => r.admin_status === 'denied').length;
  const pendingCount = repos.filter((r) => r.admin_status === 'pending').length;

  const TABS: { key: TabFilter; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'denied', label: 'Denied' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.title}>Repo Catalog</div>
        <div style={s.subtitle}>
          Approve or deny repos from the offline crawler to control what enters the challenge library.
        </div>

        <div style={s.counts}>
          <div style={s.countItem}>
            <span style={{ ...s.countNum, color: '#fbbf24' }}>{pendingCount}</span>
            <span style={s.countLabel}>pending</span>
          </div>
          <div style={s.countItem}>
            <span style={{ ...s.countNum, color: '#4ade80' }}>{approvedCount}</span>
            <span style={s.countLabel}>approved</span>
          </div>
          <div style={s.countItem}>
            <span style={{ ...s.countNum, color: '#f87171' }}>{deniedCount}</span>
            <span style={s.countLabel}>denied</span>
          </div>
          <div style={s.countItem}>
            <span style={{ ...s.countNum, color: '#8890a8' }}>{total}</span>
            <span style={s.countLabel}>total</span>
          </div>
        </div>

        <div style={s.tabs}>
          {TABS.map((t) => (
            <button key={t.key} style={s.tab(tab === t.key)} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={s.body}>
        {error && <div style={s.error}>{error}</div>}

        {loading ? (
          <div style={s.loading}>Loading repos…</div>
        ) : repos.length === 0 ? (
          <div style={s.empty}>No repos in this category.</div>
        ) : (
          repos.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              onStatusChange={handleStatusChange}
              loading={actionLoading}
            />
          ))
        )}
      </div>
    </div>
  );
}
