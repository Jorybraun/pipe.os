/**
 * RepoAdminPage — /admin/repos
 *
 * Human-in-the-loop approval for the qualified_repos catalog.
 * Shows pass-2 repos with their sample PRs. Approve to send to pass 3
 * (Gemma summarization + Vectorize upsert). Review failed repos.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, ExternalLink, Check, X, Loader2, Search, ChevronDown, ChevronRight, Sparkles, GitPullRequest, RefreshCcw, ChevronLeft, PackageOpen } from 'lucide-react';
import { useApiClient } from '../../hooks/useApiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminStatus = 'pending' | 'approved' | 'denied';
type FilterKey = AdminStatus | 'failed' | 'all';
type PassFilter = '1' | '2' | 'all';
type SuitabilityFilter = 'suitable' | 'hold' | 'reject' | 'any';

const PAGE_SIZE = 50;

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
  mean_ccn: number | null;
  pr_quality_score: number;
  open_feature_issue_count: number | null;
  open_pr_count: number | null;
  has_ci: number;
  has_tests: number;
  test_framework: string | null;
  detected_stack_json: string | null;
  top_skills_csv: string | null;
  admin_status: AdminStatus;
  admin_reason: string | null;
  disqualified: number;
  disqualified_reason: string | null;
  pass: number;
  has_signals: number;
  challenge_suitability_verdict: 'suitable' | 'hold' | 'reject' | null;
}

interface SamplePR {
  pr_number: number;
  pr_url: string;
  title: string | null;
  merged_at: string;
  changed_file_count: number;
  modifies_tests: number;
  swe_bench_eligible: number;
  additions: number | null;
  deletions: number | null;
  resolves_issue_number: number | null;
}

interface ReposResponse {
  repos: QualifiedRepo[];
  total: number;
  page?: number;
  limit?: number;
}

interface PRsResponse {
  prs: SamplePR[];
}

interface BulkIngestReportRow {
  repo_id: number;
  full_name: string;
  verdict: string;
  status: 'ok' | 'failed';
  message: string;
  vectorized_at: string | null;
}

interface BulkIngestResponse {
  ok: boolean;
  total: number;
  ok_count: number;
  failed_count: number;
  results: BulkIngestReportRow[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

const SENIORITY_COLOR: Record<string, string> = {
  junior: '#4ade80',
  mid: '#fbbf24',
  senior: '#f87171',
  staff: '#a78bfa',
};

const STATUS_FILTERS: Array<{ key: FilterKey; label: string; color: string }> = [
  { key: 'pending',  label: 'PENDING',  color: '#fbbf24' },
  { key: 'failed',   label: 'FAILED',   color: '#f87171' },
  { key: 'approved', label: 'APPROVED', color: '#4ade80' },
  { key: 'denied',   label: 'DENIED',   color: 'var(--pipe-text-dim)' },
  { key: 'all',      label: 'ALL',      color: 'var(--pipe-text)' },
];

const PASS_FILTERS: Array<{ key: PassFilter; label: string }> = [
  { key: 'all', label: 'ALL PASSES' },
  { key: '1',   label: 'PASS 1' },
  { key: '2',   label: 'PASS 2' },
];

const SUITABILITY_FILTERS: Array<{ key: SuitabilityFilter; label: string; color: string }> = [
  { key: 'any',      label: 'ANY',      color: 'var(--pipe-text-muted)' },
  { key: 'suitable', label: 'SUITABLE', color: '#4ade80' },
  { key: 'hold',     label: 'HOLD',     color: '#fbbf24' },
  { key: 'reject',   label: 'REJECT',   color: '#f87171' },
];

const SUITABILITY_COLOR: Record<string, string> = {
  suitable: '#4ade80',
  hold: '#fbbf24',
  reject: '#f87171',
};

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
  color: string;
}): JSX.Element {
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
        border: `1px solid ${active ? color : 'var(--pipe-border)'}`,
        background: active ? `${color}18` : 'transparent',
        color: active ? color : 'var(--pipe-text-dim)',
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

// ─── PR row ───────────────────────────────────────────────────────────────────

function PRRow({ pr }: { pr: SamplePR }): JSX.Element {
  const ghUrl = pr.pr_url;
  const addDel = (pr.additions !== null && pr.deletions !== null)
    ? `+${pr.additions}/-${pr.deletions}`
    : `${pr.changed_file_count} files`;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '6px 0',
        borderBottom: '1px solid var(--pipe-border)',
      }}
    >
      <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', width: 32, flexShrink: 0 }}>
        #{pr.pr_number}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text)', lineHeight: 1.4, wordBreak: 'break-word' }}>
          {pr.title ?? '(no title)'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          <span style={{ ...mono, fontSize: 7, color: 'var(--pipe-text-dim)' }}>{addDel}</span>
          {pr.modifies_tests === 1 && (
            <span style={{ ...mono, fontSize: 7, color: '#4ade80' }}>tests</span>
          )}
          {pr.resolves_issue_number !== null && (
            <span style={{ ...mono, fontSize: 7, color: '#60a5fa' }}>fixes #{pr.resolves_issue_number}</span>
          )}
          {pr.swe_bench_eligible === 1 && (
            <span style={{ ...mono, fontSize: 7, color: '#a78bfa' }}>swe-bench</span>
          )}
        </div>
      </div>
      <a
        href={ghUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--pipe-text-dim)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
      >
        <ExternalLink size={9} />
      </a>
    </div>
  );
}

// ─── Repo card ────────────────────────────────────────────────────────────────

function RepoCard({
  repo,
  onApprove,
  onDeny,
  onReset,
  onRequeue,
  onRunPass3,
  onOpen,
  saving,
  requeueing,
  runningPass3,
}: {
  repo: QualifiedRepo;
  onApprove: (reason: string) => void;
  onDeny: (reason: string) => void;
  onReset: () => void;
  onRequeue: () => void;
  onRunPass3: () => void;
  onOpen: () => void;
  saving: boolean;
  requeueing: boolean;
  runningPass3: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [prs, setPrs] = useState<SamplePR[] | null>(null);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [reason, setReason] = useState(repo.admin_reason ?? '');
  const api = useApiClient();

  const senColor = SENIORITY_COLOR[repo.seniority_band ?? ''] ?? 'var(--pipe-text-dim)';
  const ghUrl = `https://github.com/${repo.full_name}`;
  const featureIssues = repo.open_feature_issue_count ?? 0;
  const openPrs = repo.open_pr_count ?? 0;
  const isFailed = repo.disqualified === 1;

  function fmtStars(n: number): string {
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }
  function fmtSloc(n: number | null): string {
    if (n == null) return '—';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  const toggleExpand = async (): Promise<void> => {
    if (!expanded && prs === null) {
      setLoadingPRs(true);
      try {
        const res = await api.get<PRsResponse>(`/api/v1/admin/repos/${repo.id}/prs`);
        setPrs(res.prs);
      } catch {
        setPrs([]);
      } finally {
        setLoadingPRs(false);
      }
    }
    setExpanded((e) => !e);
  };

  const borderColor = isFailed
    ? 'rgba(248,113,113,0.2)'
    : repo.admin_status === 'approved'
      ? 'rgba(74,222,128,0.2)'
      : repo.admin_status === 'denied'
        ? 'rgba(255,255,255,0.04)'
        : 'var(--pipe-border)';

  return (
    <div
      style={{
        padding: '14px 16px',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        background: 'var(--pipe-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
      }}
    >
      {/* Top row: badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            ...mono, fontSize: 8, fontWeight: 700, color: '#60a5fa',
            padding: '2px 7px', borderRadius: 3,
            background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)',
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
        {repo.challenge_suitability_verdict && (
          <span
            style={{
              ...mono, fontSize: 8, fontWeight: 700,
              color: SUITABILITY_COLOR[repo.challenge_suitability_verdict] ?? 'var(--pipe-text-dim)',
              padding: '2px 7px', borderRadius: 3,
              background: `${SUITABILITY_COLOR[repo.challenge_suitability_verdict] ?? 'var(--pipe-text-dim)'}14`,
              border: `1px solid ${SUITABILITY_COLOR[repo.challenge_suitability_verdict] ?? 'var(--pipe-border)'}40`,
              letterSpacing: '0.08em',
            }}
          >
            {repo.challenge_suitability_verdict.toUpperCase()}
          </span>
        )}
        <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', marginLeft: 'auto' }}>
          ★ {fmtStars(repo.stars)}
        </span>
      </div>

      {/* Repo name — click to open detail page */}
      <button
        onClick={onOpen}
        style={{
          ...mono, fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)',
          lineHeight: 1.3, textAlign: 'left',
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
        }}
      >
        {repo.full_name}
      </button>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
          SLOC {fmtSloc(repo.sloc)}
        </span>
        {openPrs > 0 && (
          <span style={{ ...mono, fontSize: 8, color: '#60a5fa' }}>{openPrs} open PRs</span>
        )}
        {featureIssues > 0 && (
          <span style={{ ...mono, fontSize: 8, color: '#4ade80' }}>{featureIssues} feature issues</span>
        )}
        <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>pass {repo.pass}</span>
        {repo.has_signals === 1 && (
          <span style={{ ...mono, fontSize: 8, color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 3 }}>
            <Sparkles size={8} /> SIGNALS
          </span>
        )}
      </div>

      {/* Stack skills */}
      {repo.top_skills_csv && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {repo.top_skills_csv.split(',').map((skill) => (
            <span
              key={skill}
              style={{
                ...mono, fontSize: 7, fontWeight: 600,
                padding: '2px 6px', borderRadius: 3,
                background: 'rgba(96,165,250,0.06)',
                border: '1px solid rgba(96,165,250,0.15)',
                color: 'var(--pipe-text-dim)',
                letterSpacing: '0.04em',
              }}
            >
              {skill}
            </span>
          ))}
        </div>
      )}

      {/* PR quality bar — only for non-failed */}
      {!isFailed && (
        <QualityBar value={repo.pr_quality_score} label="PR QUAL" />
      )}

      {/* Disqualified reason */}
      {isFailed && repo.disqualified_reason && (
        <div style={{
          ...mono, fontSize: 8, color: '#f87171',
          padding: '6px 8px', borderRadius: 4,
          background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)',
          lineHeight: 1.5,
        }}>
          {repo.disqualified_reason}
        </div>
      )}

      {/* Expand PRs toggle */}
      {!isFailed && (
        <button
          onClick={() => void toggleExpand()}
          style={{
            ...mono, fontSize: 8, color: 'var(--pipe-text-dim)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5, padding: 0,
            textAlign: 'left',
          }}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          <GitPullRequest size={9} />
          SAMPLE PRS
          {loadingPRs && <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} />}
          {prs !== null && !loadingPRs && (
            <span style={{ color: 'var(--pipe-text-dim)' }}>({prs.length})</span>
          )}
        </button>
      )}

      {/* PR list */}
      {expanded && prs !== null && prs.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--pipe-border)',
          paddingTop: 8,
          maxHeight: 260,
          overflowY: 'auto',
        }}>
          {prs.map((pr) => <PRRow key={pr.pr_number} pr={pr} />)}
        </div>
      )}
      {expanded && prs !== null && prs.length === 0 && (
        <div style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', paddingTop: 4 }}>
          No sample PRs stored.
        </div>
      )}

      {/* Reason input — shown for non-failed repos */}
      {!isFailed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for decision (optional — used for training)"
            rows={2}
            style={{
              ...mono, fontSize: 8,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 3, color: 'var(--pipe-text)',
              padding: '5px 7px', resize: 'vertical', width: '100%',
              outline: 'none', lineHeight: 1.5,
              letterSpacing: '0.03em',
            }}
          />
        </div>
      )}

      {/* Status + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 4, flexWrap: 'wrap' }}>
        {!isFailed && (
          <span style={{
            ...mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
            color:
              repo.admin_status === 'approved' ? '#4ade80' :
              repo.admin_status === 'denied' ? 'var(--pipe-text-dim)' :
              '#fbbf24',
          }}>
            {repo.admin_status.toUpperCase()}
          </span>
        )}

        <a
          href={ghUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            ...mono, fontSize: 8, color: 'var(--pipe-text-dim)',
            display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none',
          }}
        >
          <ExternalLink size={9} /> GITHUB
        </a>

        <div style={{ flex: 1 }} />

        {/* Pass 3 button — only on approved, pass-2 repos without signals */}
        {!isFailed && repo.admin_status === 'approved' && repo.pass >= 2 && repo.has_signals === 0 && (
          <button
            onClick={onRunPass3}
            disabled={runningPass3 || saving}
            style={{
              ...mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
              padding: '4px 10px',
              background: 'rgba(167,139,250,0.08)',
              border: '1px solid rgba(167,139,250,0.25)',
              borderRadius: 3, color: '#a78bfa', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: runningPass3 ? 0.6 : 1,
            }}
          >
            {runningPass3
              ? <><Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> RUNNING...</>
              : <><Sparkles size={9} /> RUN PASS 3</>
            }
          </button>
        )}

        {/* Re-run pass 3 if signals exist */}
        {!isFailed && repo.admin_status === 'approved' && repo.pass >= 2 && repo.has_signals === 1 && (
          <button
            onClick={onRunPass3}
            disabled={runningPass3 || saving}
            style={{
              ...mono, fontSize: 8, padding: '4px 8px',
              background: 'transparent', border: '1px solid rgba(167,139,250,0.2)',
              borderRadius: 3, color: 'rgba(167,139,250,0.5)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: runningPass3 ? 0.5 : 1,
            }}
          >
            {runningPass3
              ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} />
              : <Sparkles size={9} />
            }
            RE-RUN
          </button>
        )}

        {!isFailed && repo.admin_status !== 'approved' && (
          <button
            onClick={() => onApprove(reason)}
            disabled={saving}
            style={{
              ...mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
              padding: '4px 10px',
              background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)',
              borderRadius: 3, color: '#4ade80', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: saving ? 0.5 : 1,
            }}
          >
            <Check size={9} /> APPROVE
          </button>
        )}

        {!isFailed && repo.admin_status !== 'denied' && (
          <button
            onClick={() => onDeny(reason)}
            disabled={saving}
            style={{
              ...mono, fontSize: 8, padding: '4px 8px',
              background: 'transparent', border: '1px solid var(--pipe-border)',
              borderRadius: 3, color: 'var(--pipe-text-dim)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: saving ? 0.5 : 1,
            }}
          >
            <X size={9} /> DENY
          </button>
        )}

        {!isFailed && repo.admin_status !== 'pending' && (
          <button
            onClick={onReset}
            disabled={saving}
            style={{
              ...mono, fontSize: 8, padding: '4px 8px',
              background: 'transparent', border: '1px solid var(--pipe-border)',
              borderRadius: 3, color: 'var(--pipe-text-dim)', cursor: 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            RESET
          </button>
        )}

        {/* Requeue — sends the repo back to pass 1 for re-crawling */}
        {!isFailed && (
          <button
            onClick={onRequeue}
            disabled={requeueing || saving}
            title="Reset to pass 1 and re-crawl"
            style={{
              ...mono, fontSize: 8, padding: '4px 8px',
              background: 'transparent', border: '1px solid var(--pipe-border)',
              borderRadius: 3, color: 'var(--pipe-text-dim)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: requeueing ? 0.5 : 1,
            }}
          >
            {requeueing
              ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} />
              : <RefreshCcw size={9} />
            }
            REQUEUE
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RepoAdminPage(): JSX.Element {
  const api = useApiClient();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<FilterKey>('pending');
  const [passFilter, setPassFilter] = useState<PassFilter>('all');
  const [suitabilityFilter, setSuitabilityFilter] = useState<SuitabilityFilter>('any');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [repos, setRepos] = useState<QualifiedRepo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [requeueing, setRequeueing] = useState<number | null>(null);
  const [runningPass3, setRunningPass3] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkIngesting, setBulkIngesting] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkIngestResponse | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const load = useCallback(async (
    status: FilterKey,
    pass: PassFilter,
    suitability: SuitabilityFilter,
    pageNum: number,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        status,
        limit: String(PAGE_SIZE),
        page: String(pageNum),
      });
      if (pass !== 'all') qs.set('pass', pass);
      if (suitability !== 'any') qs.set('suitability', suitability);
      const res = await api.get<ReposResponse>(`/api/v1/admin/repos?${qs.toString()}`);
      setRepos(res.repos);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repos');
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [statusFilter, passFilter, suitabilityFilter]);

  useEffect(() => {
    void load(statusFilter, passFilter, suitabilityFilter, page);
  }, [statusFilter, passFilter, suitabilityFilter, page, load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleStatusChange = async (id: number, status: AdminStatus, reason: string): Promise<void> => {
    setSaving(id);
    try {
      await api.patch(`/api/v1/admin/repos/${id}`, {
        admin_status: status,
        ...(reason.trim() ? { admin_reason: reason.trim() } : {}),
      });
      setRepos((prev) => prev.map((r) =>
        r.id === id ? { ...r, admin_status: status, admin_reason: reason.trim() || r.admin_reason } : r,
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(null);
    }
  };

  const handleRequeue = async (id: number): Promise<void> => {
    setRequeueing(id);
    setError(null);
    try {
      await api.post(`/api/v1/admin/repos/${id}/requeue`, {});
      setRepos((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Requeue failed');
    } finally {
      setRequeueing(null);
    }
  };

  const handleRunPass3 = async (id: number): Promise<void> => {
    setRunningPass3(id);
    setError(null);
    try {
      await api.post(`/api/v1/admin/repos/${id}/pass3`, {});
      setRepos((prev) => prev.map((r) => r.id === id ? { ...r, has_signals: 1 } : r));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pass 3 failed');
    } finally {
      setRunningPass3(null);
    }
  };

  const handleBulkIngest = async (): Promise<void> => {
    setBulkConfirm(false);
    setBulkIngesting(true);
    setBulkResult(null);
    setError(null);
    try {
      const res = await api.post<BulkIngestResponse>('/api/v1/admin/repos/bulk-ingest', {
        verdicts: ['suitable', 'hold'],
        feedback_text: 'bulk ingest 2026-04-18',
      });
      setBulkResult(res);
      // Reload the current view so vectorized repos reflect their updated state
      void load(statusFilter, passFilter, suitabilityFilter, page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk ingest failed');
    } finally {
      setBulkIngesting(false);
    }
  };

  const filtered = search.trim()
    ? repos.filter((r) =>
        r.full_name.toLowerCase().includes(search.toLowerCase()) ||
        (r.detected_domain ?? '').toLowerCase().includes(search.toLowerCase()))
    : repos;

  const counts = {
    approved: repos.filter((r) => r.admin_status === 'approved').length,
    denied: repos.filter((r) => r.admin_status === 'denied').length,
    pending: repos.filter((r) => r.admin_status === 'pending').length,
    failed: repos.filter((r) => r.disqualified === 1).length,
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
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

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
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', ...mono, fontSize: 10 }}>
          <span style={{ color: '#fbbf24' }}>{counts.pending} PENDING</span>
          <span style={{ color: '#f87171' }}>{counts.failed} FAILED</span>
          <span style={{ color: '#4ade80' }}>{counts.approved} APPROVED</span>
          <span style={{ color: 'var(--pipe-text-dim)' }}>{counts.denied} DENIED</span>
          <span style={{ color: 'var(--pipe-text-dim)' }}>{total} TOTAL</span>
          <button
            onClick={() => navigate('/admin/repos/search')}
            style={{
              background: 'transparent',
              border: '1px solid var(--pipe-border, #242530)',
              color: '#60a5fa',
              padding: '6px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              borderRadius: 4,
              letterSpacing: '0.08em',
              ...mono,
            }}
          >
            <Search size={11} />
            SEMANTIC_SEARCH
          </button>

          {/* Bulk ingest button — one-shot override for suitable+hold repos with vectorized_at IS NULL */}
          {!bulkConfirm && !bulkIngesting && (
            <button
              onClick={() => setBulkConfirm(true)}
              style={{
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.3)',
                color: '#fbbf24',
                padding: '6px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                borderRadius: 4,
                letterSpacing: '0.08em',
                ...mono,
              }}
            >
              <PackageOpen size={11} />
              BULK INGEST SUITABLE+HOLD
            </button>
          )}

          {/* Inline confirmation expand */}
          {bulkConfirm && !bulkIngesting && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                border: '1px solid rgba(251,191,36,0.4)',
                borderRadius: 4,
                background: 'rgba(251,191,36,0.06)',
              }}
            >
              <span style={{ ...mono, fontSize: 9, color: '#fbbf24', letterSpacing: '0.06em' }}>
                Ingest all suitable+hold repos into REPO_INDEX? Overrides per-repo gate.
              </span>
              <button
                onClick={() => void handleBulkIngest()}
                style={{
                  ...mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                  padding: '3px 10px',
                  background: 'rgba(251,191,36,0.15)',
                  border: '1px solid rgba(251,191,36,0.4)',
                  borderRadius: 3, color: '#fbbf24', cursor: 'pointer',
                }}
              >
                CONFIRM
              </button>
              <button
                onClick={() => setBulkConfirm(false)}
                style={{
                  ...mono, fontSize: 9, padding: '3px 8px',
                  background: 'transparent',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 3, color: 'var(--pipe-text-dim)', cursor: 'pointer',
                }}
              >
                CANCEL
              </button>
            </div>
          )}

          {/* In-progress spinner */}
          {bulkIngesting && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Loader2 size={11} color="#fbbf24" style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ ...mono, fontSize: 10, color: '#fbbf24', letterSpacing: '0.08em' }}>
                INGESTING...
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bulk ingest result banner */}
      {bulkResult && (
        <div
          style={{
            ...mono, fontSize: 9, letterSpacing: '0.05em',
            padding: '10px 14px',
            border: `1px solid ${bulkResult.failed_count === 0 ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.3)'}`,
            borderRadius: 6,
            background: bulkResult.failed_count === 0 ? 'rgba(74,222,128,0.05)' : 'rgba(251,191,36,0.05)',
            color: bulkResult.failed_count === 0 ? '#4ade80' : '#fbbf24',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>
            BULK INGEST COMPLETE — {bulkResult.ok_count}/{bulkResult.total} ok
            {bulkResult.failed_count > 0 && `, ${bulkResult.failed_count} failed`}
          </span>
          <button
            onClick={() => setBulkResult(null)}
            style={{
              ...mono, fontSize: 9, padding: '2px 8px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 3, color: 'var(--pipe-text-dim)', cursor: 'pointer',
            }}
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {STATUS_FILTERS.map(({ key, label, color }) => (
            <Pill
              key={key}
              label={label}
              active={statusFilter === key}
              onClick={() => setStatusFilter(key)}
              color={color}
            />
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: 'var(--pipe-border)' }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {PASS_FILTERS.map(({ key, label }) => (
            <Pill
              key={key}
              label={label}
              active={passFilter === key}
              onClick={() => setPassFilter(key)}
              color="var(--pipe-text-muted)"
            />
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: 'var(--pipe-border)' }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {SUITABILITY_FILTERS.map(({ key, label, color }) => (
            <Pill
              key={key}
              label={label}
              active={suitabilityFilter === key}
              onClick={() => setSuitabilityFilter(key)}
              color={color}
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
              ...mono, fontSize: 9,
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--pipe-text)', width: 140, letterSpacing: '0.05em',
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
            {statusFilter === 'failed'
              ? 'No crawler-rejected repos found.'
              : 'Run the crawler to populate the catalog, then come back here to approve repos.'}
          </div>
        </div>
      )}

      {/* Grid */}
      {!loading && filtered.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
            {filtered.map((repo) => (
              <RepoCard
                key={repo.id}
                repo={repo}
                saving={saving === repo.id}
                requeueing={requeueing === repo.id}
                runningPass3={runningPass3 === repo.id}
                onApprove={(reason) => void handleStatusChange(repo.id, 'approved', reason)}
                onDeny={(reason) => void handleStatusChange(repo.id, 'denied', reason)}
                onReset={() => void handleStatusChange(repo.id, 'pending', '')}
                onRequeue={() => void handleRequeue(repo.id)}
                onRunPass3={() => void handleRunPass3(repo.id)}
                onOpen={() => navigate(`/admin/repos/${repo.id}`)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex', justifyContent: 'center', alignItems: 'center',
              gap: 8, marginTop: 32,
            }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{
                  ...mono, fontSize: 10, letterSpacing: '0.1em',
                  padding: '6px 12px',
                  background: 'transparent',
                  border: '1px solid var(--pipe-border)',
                  color: page === 1 ? 'var(--pipe-text-dim)' : 'var(--pipe-text)',
                  cursor: page === 1 ? 'default' : 'pointer',
                  borderRadius: 4,
                  display: 'flex', alignItems: 'center', gap: 6,
                  opacity: page === 1 ? 0.4 : 1,
                }}
              >
                <ChevronLeft size={11} /> PREV
              </button>
              <span style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-muted)', padding: '0 12px' }}>
                PAGE {page} / {totalPages} · {total} TOTAL
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{
                  ...mono, fontSize: 10, letterSpacing: '0.1em',
                  padding: '6px 12px',
                  background: 'transparent',
                  border: '1px solid var(--pipe-border)',
                  color: page >= totalPages ? 'var(--pipe-text-dim)' : 'var(--pipe-text)',
                  cursor: page >= totalPages ? 'default' : 'pointer',
                  borderRadius: 4,
                  display: 'flex', alignItems: 'center', gap: 6,
                  opacity: page >= totalPages ? 0.4 : 1,
                }}
              >
                NEXT <ChevronRight size={11} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
