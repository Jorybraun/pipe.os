/**
 * RepoDetailPage — /admin/repos/:id
 *
 * Per-repo detail + human-in-the-loop Pass 3 gate.
 *
 * Flow:
 *   1. Page loads → shows repo header + PR list + Pass-3 state.
 *   2. "Run AI analysis" → POST /pass3/analyze → Gemma narrative/profile/architecture renders.
 *   3. Admin reads the narrative, clicks "Approve & ingest" or "Deny".
 *      - Approve  → POST /pass3/feedback {verdict:'approved', text} → POST /pass3/ingest.
 *      - Deny     → POST /pass3/feedback {verdict:'denied', text}. No vectorize.
 *   4. "Re-run analysis" wipes verdict + vectorized_at and re-runs Gemma.
 *
 * The verdict + free-text critique is the feedback signal captured for
 * future training-data export. No separate rating scale.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Sparkles,
  Check,
  X,
  RefreshCcw,
  GitPullRequest,
  Database,
  Cpu,
} from 'lucide-react';
import { useApiClient } from '../../hooks/useApiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminStatus = 'pending' | 'approved' | 'denied';
type AdminVerdict = 'approved' | 'denied';

interface RepoDetail {
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
  crawled_at: string;
  has_signals: number;
}

type SuitabilityVerdict = 'suitable' | 'hold' | 'reject';

interface TopPrPick {
  pr_number: number;
  why: string;
}

interface SignalsRow {
  signals_version: string | null;
  content_hash: string | null;
  architecture_style: string | null;
  engineering_narrative: string | null;
  repo_searchable_profile: string | null;
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  swe_bench_eligibility_rate: number | null;
  model_used: string | null;
  model_version: string | null;
  admin_verdict: AdminVerdict | null;
  admin_feedback_text: string | null;
  verdict_at: string | null;
  vectorized_at: string | null;
  challenge_suitability_verdict: SuitabilityVerdict | null;
  challenge_suitability_reason: string | null;
  top_pr_picks_json: string | null;
  red_flags_json: string | null;
  seniority_justification: string | null;
  ideal_role_match: string | null;
}

interface RepoResponse {
  repo: RepoDetail;
  signals: SignalsRow | null;
}

interface AnalyzeResponse {
  ok: true;
  id: number;
  content_hash: string;
  architecture_style: string;
  engineering_narrative: string;
  repo_searchable_profile: string;
}

interface FeedbackResponse {
  ok: true;
  id: number;
  verdict: AdminVerdict;
  verdict_at: string;
}

interface IngestResponse {
  ok: true;
  id: number;
  vectorized_at: string;
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

interface PRsResponse {
  prs: SamplePR[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

const SENIORITY_COLOR: Record<string, string> = {
  junior: '#4ade80',
  mid: '#fbbf24',
  senior: '#f87171',
  staff: 'var(--pipe-accent)',
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtStars(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function fmtSloc(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function fmtPct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// ─── Small UI ─────────────────────────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: string; color?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: color ?? 'var(--pipe-text)' }}>{value}</span>
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--pipe-border)',
        borderRadius: 8,
        background: 'var(--pipe-surface)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ ...mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', margin: 0 }}>
          {title}
        </h2>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      {children}
    </div>
  );
}

// ─── Pass 3 state panel ───────────────────────────────────────────────────────

function Pass3Panel({
  repoId,
  fullName,
  signals,
  onRefresh,
}: {
  repoId: number;
  fullName: string;
  signals: SignalsRow | null;
  onRefresh: () => void | Promise<void>;
}): JSX.Element {
  const api = useApiClient();
  const [busy, setBusy] = useState<'analyze' | 'approve' | 'deny' | 'ingest' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [openFeedback, setOpenFeedback] = useState<null | AdminVerdict>(null);

  const runAnalyze = async (): Promise<void> => {
    setBusy('analyze');
    setError(null);
    try {
      await api.post<AnalyzeResponse>(`/api/v1/admin/repos/${repoId}/pass3/analyze`, {});
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analyze failed');
    } finally {
      setBusy(null);
    }
  };

  const submitVerdict = async (verdict: AdminVerdict): Promise<void> => {
    setBusy(verdict === 'approved' ? 'approve' : 'deny');
    setError(null);
    try {
      await api.post<FeedbackResponse>(`/api/v1/admin/repos/${repoId}/pass3/feedback`, {
        verdict,
        ...(feedback.trim() ? { feedback_text: feedback.trim() } : {}),
      });
      if (verdict === 'approved') {
        setBusy('ingest');
        try {
          await api.post<IngestResponse>(`/api/v1/admin/repos/${repoId}/pass3/ingest`, {});
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Verdict saved, but vectorize failed: ${msg}`);
        }
      }
      setOpenFeedback(null);
      setFeedback('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feedback failed');
    } finally {
      setBusy(null);
    }
  };

  // ─── Empty: no analysis yet ────────────────────────────────────────────────
  if (!signals || !signals.engineering_narrative) {
    return (
      <Section title="PASS 3 — AI ANALYSIS">
        <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-dim)', lineHeight: 1.7 }}>
          No Gemma narrative yet. Running analysis will generate the engineering profile used for
          semantic search, but nothing enters the vector index until you approve.
        </div>
        {error && <ErrorLine text={error} />}
        <button
          onClick={() => void runAnalyze()}
          disabled={busy !== null}
          style={actionButton('var(--pipe-accent)', busy !== null)}
        >
          {busy === 'analyze'
            ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> RUNNING...</>
            : <><Sparkles size={11} /> RUN AI ANALYSIS</>
          }
        </button>
      </Section>
    );
  }

  const hasVerdict = signals.admin_verdict !== null;
  const verdictColor = signals.admin_verdict === 'approved' ? '#4ade80' : signals.admin_verdict === 'denied' ? '#f87171' : 'var(--pipe-text-dim)';

  return (
    <Section
      title="PASS 3 — AI ANALYSIS"
      right={
        <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
          {signals.model_used ?? 'unknown'} · {signals.signals_version ?? '—'}
        </span>
      }
    >
      {/* AI assessment (decision-oriented signal above the narrative) */}
      <AssessmentBlock signals={signals} fullName={fullName} />

      {/* Architecture + stats row */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <StatChip label="ARCHITECTURE" value={(signals.architecture_style ?? 'unknown').toUpperCase()} color="#60a5fa" />
        <StatChip label="TEST TOUCH" value={fmtPct(signals.test_touch_rate)} />
        <StatChip label="ISSUE LINK" value={fmtPct(signals.issue_link_rate)} />
        <StatChip label="SWE-BENCH" value={fmtPct(signals.swe_bench_eligibility_rate)} />
        <StatChip label="MEAN FILES" value={signals.mean_changed_files == null ? '—' : signals.mean_changed_files.toFixed(1)} />
        <StatChip label="P90 FILES" value={signals.p90_changed_files == null ? '—' : String(signals.p90_changed_files)} />
      </div>

      {/* Engineering narrative */}
      <ProseBlock label="ENGINEERING NARRATIVE" text={signals.engineering_narrative} />

      {/* Searchable profile */}
      {signals.repo_searchable_profile && (
        <ProseBlock label="REPO SEARCHABLE PROFILE" text={signals.repo_searchable_profile} dimmed />
      )}

      {/* Verdict state */}
      {hasVerdict && (
        <div
          style={{
            border: `1px solid ${verdictColor}40`,
            background: `${verdictColor}0c`,
            borderRadius: 6,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: verdictColor }}>
              {signals.admin_verdict === 'approved' ? 'APPROVED' : 'DENIED'}
            </span>
            <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
              {fmtDate(signals.verdict_at)}
            </span>
            {signals.admin_verdict === 'approved' && signals.vectorized_at && (
              <span style={{ ...mono, fontSize: 8, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Cpu size={9} /> VECTORIZED {fmtDate(signals.vectorized_at)}
              </span>
            )}
            {signals.admin_verdict === 'approved' && !signals.vectorized_at && (
              <span style={{ ...mono, fontSize: 8, color: '#fbbf24' }}>NOT YET VECTORIZED</span>
            )}
          </div>
          {signals.admin_feedback_text && (
            <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text)', lineHeight: 1.6, paddingLeft: 2 }}>
              {signals.admin_feedback_text}
            </div>
          )}
        </div>
      )}

      {error && <ErrorLine text={error} />}

      {/* Verdict actions (only if no verdict) */}
      {!hasVerdict && openFeedback === null && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setOpenFeedback('approved')}
            disabled={busy !== null}
            style={actionButton('#4ade80', busy !== null)}
          >
            <Check size={11} /> APPROVE &amp; INGEST
          </button>
          <button
            onClick={() => setOpenFeedback('denied')}
            disabled={busy !== null}
            style={actionButton('#f87171', busy !== null, true)}
          >
            <X size={11} /> DENY
          </button>
        </div>
      )}

      {/* Inline feedback form */}
      {!hasVerdict && openFeedback !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={
              openFeedback === 'approved'
                ? 'Optional: anything worth remembering about this narrative (training signal).'
                : 'Optional: what did the model get wrong? (training signal)'
            }
            rows={3}
            autoFocus
            style={{
              ...mono,
              fontSize: 10,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text)',
              padding: '8px 10px',
              resize: 'vertical',
              outline: 'none',
              lineHeight: 1.5,
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => void submitVerdict(openFeedback)}
              disabled={busy !== null}
              style={actionButton(openFeedback === 'approved' ? '#4ade80' : '#f87171', busy !== null)}
            >
              {busy !== null
                ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> {busy === 'ingest' ? 'VECTORIZING...' : 'SAVING...'}</>
                : <>CONFIRM {openFeedback === 'approved' ? 'APPROVE' : 'DENY'}</>
              }
            </button>
            <button
              onClick={() => { setOpenFeedback(null); setFeedback(''); }}
              disabled={busy !== null}
              style={actionButton('var(--pipe-text-dim)', busy !== null, true)}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Re-run (only if verdict is set) */}
      {hasVerdict && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => void runAnalyze()}
            disabled={busy !== null}
            style={actionButton('var(--pipe-accent)', busy !== null, true)}
          >
            {busy === 'analyze'
              ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> RE-RUNNING...</>
              : <><RefreshCcw size={11} /> RE-RUN ANALYSIS</>
            }
          </button>
          {signals.admin_verdict === 'approved' && !signals.vectorized_at && (
            <button
              onClick={() => void submitVerdict('approved')}
              disabled={busy !== null}
              style={actionButton('var(--pipe-accent)', busy !== null)}
            >
              {busy === 'ingest'
                ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> VECTORIZING...</>
                : <><Cpu size={11} /> RETRY VECTORIZE</>
              }
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

const VERDICT_COLOR: Record<SuitabilityVerdict, string> = {
  suitable: '#4ade80',
  hold: '#fbbf24',
  reject: '#f87171',
};

function safeParseJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function AssessmentBlock({ signals, fullName }: { signals: SignalsRow; fullName: string }): JSX.Element | null {
  const verdict = signals.challenge_suitability_verdict;
  const reason = signals.challenge_suitability_reason;
  const topPicks = safeParseJsonArray<TopPrPick>(signals.top_pr_picks_json);
  const redFlags = safeParseJsonArray<string>(signals.red_flags_json);
  const justification = signals.seniority_justification;
  const role = signals.ideal_role_match;

  const hasAny =
    verdict !== null ||
    (reason !== null && reason !== '') ||
    topPicks.length > 0 ||
    redFlags.length > 0 ||
    (justification !== null && justification !== '') ||
    (role !== null && role !== '');

  if (!hasAny) return null;

  const verdictColor = verdict ? VERDICT_COLOR[verdict] : 'var(--pipe-text-dim)';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        border: '1px solid var(--pipe-border)',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.015)',
      }}
    >
      <div style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.2em' }}>
        AI ASSESSMENT
      </div>

      {/* Verdict + reason */}
      {verdict && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '8px 10px',
            border: `1px solid ${verdictColor}40`,
            background: `${verdictColor}0c`,
            borderRadius: 4,
          }}
        >
          <span
            style={{
              ...mono,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.15em',
              color: verdictColor,
              padding: '2px 8px',
              border: `1px solid ${verdictColor}`,
              borderRadius: 3,
              flexShrink: 0,
              textTransform: 'uppercase',
            }}
          >
            {verdict}
          </span>
          {reason && (
            <span style={{ ...mono, fontSize: 10, lineHeight: 1.65, color: 'var(--pipe-text)' }}>
              {reason}
            </span>
          )}
        </div>
      )}

      {/* Ideal role */}
      {role && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.15em' }}>
            IDEAL ROLE
          </span>
          <span
            style={{
              ...mono,
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--pipe-accent)',
              padding: '3px 8px',
              borderRadius: 3,
              background: 'var(--pipe-accent-surface)',
              border: '1px solid var(--pipe-accent-border)',
              letterSpacing: '0.06em',
            }}
          >
            {role}
          </span>
        </div>
      )}

      {/* Top PR picks */}
      {topPicks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.15em' }}>
            TOP PR PICKS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topPicks.map((pick) => (
              <a
                key={pick.pr_number}
                href={`https://github.com/${fullName}/pull/${pick.pr_number}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '6px 8px',
                  borderRadius: 3,
                  border: '1px solid var(--pipe-border)',
                  background: 'rgba(255,255,255,0.01)',
                  textDecoration: 'none',
                }}
              >
                <span
                  style={{
                    ...mono,
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#60a5fa',
                    flexShrink: 0,
                    minWidth: 44,
                  }}
                >
                  #{pick.pr_number}
                </span>
                <span style={{ ...mono, fontSize: 10, lineHeight: 1.55, color: 'var(--pipe-text)', flex: 1 }}>
                  {pick.why}
                </span>
                <ExternalLink size={10} color="var(--pipe-text-dim)" style={{ marginTop: 2, flexShrink: 0 }} />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Red flags */}
      {redFlags.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ ...mono, fontSize: 8, color: '#f87171', letterSpacing: '0.15em' }}>
            RED FLAGS
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {redFlags.map((flag, i) => (
              <li
                key={i}
                style={{ ...mono, fontSize: 10, lineHeight: 1.6, color: 'var(--pipe-text)' }}
              >
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Seniority justification */}
      {justification && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.15em' }}>
            SENIORITY JUSTIFICATION
          </div>
          <div
            style={{
              ...mono,
              fontSize: 10,
              lineHeight: 1.7,
              color: 'var(--pipe-text)',
              padding: '8px 10px',
              borderRadius: 3,
              background: 'rgba(255,255,255,0.01)',
              border: '1px solid var(--pipe-border)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {justification}
          </div>
        </div>
      )}
    </div>
  );
}

function ProseBlock({ label, text, dimmed }: { label: string; text: string; dimmed?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.15em' }}>{label}</div>
      <div
        style={{
          ...mono,
          fontSize: 10,
          lineHeight: 1.75,
          color: dimmed ? 'var(--pipe-text-dim)' : 'var(--pipe-text)',
          whiteSpace: 'pre-wrap',
          padding: '10px 12px',
          background: 'rgba(255,255,255,0.015)',
          border: '1px solid var(--pipe-border)',
          borderRadius: 4,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function ErrorLine({ text }: { text: string }): JSX.Element {
  return (
    <div style={{
      ...mono, fontSize: 9, color: '#f87171',
      padding: '8px 10px', borderRadius: 4,
      background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)',
    }}>
      {text}
    </div>
  );
}

function actionButton(color: string, disabled: boolean, subdued = false): React.CSSProperties {
  return {
    ...mono,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.12em',
    padding: '6px 12px',
    background: subdued ? 'transparent' : `${color}0c`,
    border: `1px solid ${subdued ? 'var(--pipe-border)' : color + '40'}`,
    borderRadius: 4,
    color: subdued ? 'var(--pipe-text-dim)' : color,
    cursor: disabled ? 'default' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    opacity: disabled ? 0.5 : 1,
  };
}

// ─── PR list row (read-only) ──────────────────────────────────────────────────

function PRListRow({ pr }: { pr: SamplePR }): JSX.Element {
  const addDel = (pr.additions !== null && pr.deletions !== null)
    ? `+${pr.additions}/-${pr.deletions}`
    : `${pr.changed_file_count} files`;
  return (
    <a
      href={pr.pr_url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 0',
        borderBottom: '1px solid var(--pipe-border)',
        textDecoration: 'none',
      }}
    >
      <span style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)', width: 40, flexShrink: 0 }}>
        #{pr.pr_number}
      </span>
      <span style={{ ...mono, fontSize: 10, color: 'var(--pipe-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {pr.title ?? '(no title)'}
      </span>
      <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>{addDel}</span>
      {pr.modifies_tests === 1 && <span style={{ ...mono, fontSize: 8, color: '#4ade80' }}>tests</span>}
      {pr.resolves_issue_number !== null && <span style={{ ...mono, fontSize: 8, color: '#60a5fa' }}>#{pr.resolves_issue_number}</span>}
      {pr.swe_bench_eligible === 1 && <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-accent)' }}>swe-bench</span>}
      <ExternalLink size={10} color="var(--pipe-text-dim)" />
    </a>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RepoDetailPage(): JSX.Element {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const api = useApiClient();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<RepoResponse | null>(null);
  const [prs, setPrs] = useState<SamplePR[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async (): Promise<void> => {
    try {
      const res = await api.get<RepoResponse>(`/api/v1/admin/repos/${id}`);
      setDetail(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repo');
    }
  }, [api, id]);

  const loadPrs = useCallback(async (): Promise<void> => {
    try {
      const res = await api.get<PRsResponse>(`/api/v1/admin/repos/${id}/prs`);
      setPrs(res.prs);
    } catch {
      setPrs([]);
    }
  }, [api, id]);

  useEffect(() => {
    if (!Number.isFinite(id) || id <= 0) {
      setError('invalid repo id');
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all([loadDetail(), loadPrs()]).finally(() => setLoading(false));
  }, [id, loadDetail, loadPrs]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Loader2 size={20} color="var(--pipe-text-dim)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div style={{ maxWidth: 800, margin: '40px auto', padding: 20 }}>
        <BackLink onClick={() => navigate('/admin/repos')} />
        <ErrorLine text={error ?? 'Repo not found'} />
      </div>
    );
  }

  const { repo, signals } = detail;
  const senColor = SENIORITY_COLOR[repo.seniority_band ?? ''] ?? 'var(--pipe-text-dim)';

  return (
    <div
      style={{
        padding: '0 0 80px',
        maxWidth: 1100,
        margin: '0 auto',
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <BackLink onClick={() => navigate('/admin/repos')} />

      {/* Header */}
      <div
        style={{
          border: '1px solid var(--pipe-border)',
          borderRadius: 8,
          background: 'var(--pipe-surface)',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            ...mono, fontSize: 9, fontWeight: 700, color: '#60a5fa',
            padding: '3px 8px', borderRadius: 3,
            background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)',
            letterSpacing: '0.08em',
          }}>
            {repo.primary_language.toUpperCase()}
          </span>
          {repo.seniority_band && (
            <span style={{ ...mono, fontSize: 9, fontWeight: 700, color: senColor, letterSpacing: '0.1em' }}>
              {repo.seniority_band.toUpperCase()}
            </span>
          )}
          {repo.detected_domain && (
            <span style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)' }}>
              {repo.detected_domain}
            </span>
          )}
          <span style={{
            ...mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            color:
              repo.admin_status === 'approved' ? '#4ade80' :
              repo.admin_status === 'denied' ? 'var(--pipe-text-dim)' :
              '#fbbf24',
            marginLeft: 'auto',
          }}>
            {repo.admin_status.toUpperCase()}
          </span>
        </div>

        <div style={{ ...mono, fontSize: 18, fontWeight: 700, color: 'var(--pipe-text)' }}>
          {repo.full_name}
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <StatChip label="STARS" value={fmtStars(repo.stars)} />
          <StatChip label="SLOC" value={fmtSloc(repo.sloc)} />
          <StatChip label="FILES" value={repo.file_count == null ? '—' : String(repo.file_count)} />
          <StatChip label="MEAN CCN" value={repo.mean_ccn == null ? '—' : repo.mean_ccn.toFixed(1)} />
          <StatChip label="PR QUAL" value={`${Math.round(repo.pr_quality_score * 100)}%`} color={repo.pr_quality_score >= 0.7 ? '#4ade80' : repo.pr_quality_score >= 0.4 ? '#fbbf24' : '#f87171'} />
          <StatChip label="OPEN PRS" value={String(repo.open_pr_count ?? 0)} />
          <StatChip label="OPEN ISSUES" value={String(repo.open_feature_issue_count ?? 0)} />
          <StatChip label="PASS" value={String(repo.pass)} />
        </div>

        {repo.top_skills_csv && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {repo.top_skills_csv.split(',').map((skill) => (
              <span
                key={skill}
                style={{
                  ...mono, fontSize: 8, fontWeight: 600,
                  padding: '3px 7px', borderRadius: 3,
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

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a
            href={repo.github_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...mono, fontSize: 9, color: '#60a5fa',
              display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none',
              letterSpacing: '0.1em',
            }}
          >
            <ExternalLink size={10} /> OPEN ON GITHUB
          </a>
          {repo.admin_reason && (
            <span style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)' }}>
              note: {repo.admin_reason}
            </span>
          )}
        </div>
      </div>

      {/* Pass 3 panel */}
      <div style={{ marginBottom: 16 }}>
        <Pass3Panel repoId={id} fullName={repo.full_name} signals={signals} onRefresh={loadDetail} />
      </div>

      {/* PR list */}
      <Section
        title="SAMPLE PRS"
        right={
          <span style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <GitPullRequest size={10} /> {prs?.length ?? 0}
          </span>
        }
      >
        {prs === null ? (
          <Loader2 size={14} color="var(--pipe-text-dim)" style={{ animation: 'spin 1s linear infinite' }} />
        ) : prs.length === 0 ? (
          <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={12} /> No sample PRs stored.
          </div>
        ) : (
          <div>
            {prs.map((pr) => <PRListRow key={pr.pr_number} pr={pr} />)}
          </div>
        )}
      </Section>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        ...mono,
        fontSize: 9,
        letterSpacing: '0.15em',
        color: 'var(--pipe-text-dim)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: 0,
        marginBottom: 16,
      }}
    >
      <ArrowLeft size={11} /> BACK TO CATALOG
    </button>
  );
}
