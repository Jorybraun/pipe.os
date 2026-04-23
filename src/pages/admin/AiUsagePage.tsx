/**
 * AiUsagePage — /admin/ai-usage
 *
 * Surfaces real AI spend across features (role discovery, culture, voice, ...).
 * Data source: GET /api/v1/admin/ai-usage + /ai-usage/sessions.
 *
 * Goal: answer "what did one interview cost me?" with real tokens and real
 * prices, including failed sessions.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { useApiClient } from '../../hooks/useApiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthlyTotals {
  eventCount: number;
  sessionCount: number;
  failedCount: number;
  totalCost: number;
}

interface FeatureSummary {
  feature: string;
  eventCount: number;
  sessionCount: number;
  successCount: number;
  failedCount: number;
  totalCost: number;
  avgCostPerSession: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalInputAudioTokens: number;
  totalOutputAudioTokens: number;
}

interface SummaryResponse {
  monthly: MonthlyTotals;
  features: FeatureSummary[];
}

interface SessionRow {
  feature: string;
  refId: string | null;
  eventCount: number;
  totalCost: number;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  inputAudioTokens: number;
  outputAudioTokens: number;
  audioSeconds: number;
  lastEventAt: string;
  lastError: string | null;
}

interface SessionsResponse {
  sessions: SessionRow[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

const FEATURE_LABELS: Record<string, string> = {
  role_discovery: 'ROLE DISCOVERY',
  culture_interview: 'CULTURE INTERVIEW',
  live_panel: 'LIVE PANEL',
  copilot: 'COPILOT',
  repo_crawl: 'REPO CRAWL',
  challenge_generation: 'CHALLENGE GEN',
};

function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature.toUpperCase();
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: string;
  subtitle?: string;
  accent?: string;
}): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 180,
        padding: '14px 16px',
        border: '1px solid var(--pipe-border)',
        borderRadius: 8,
        background: 'var(--pipe-surface)',
      }}
    >
      <div
        style={{
          ...mono,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.14em',
          color: 'var(--pipe-text-dim)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          ...mono,
          fontSize: 22,
          fontWeight: 800,
          color: accent ?? 'var(--pipe-text)',
          letterSpacing: '-0.01em',
          marginTop: 6,
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)', marginTop: 4 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AiUsagePage(): JSX.Element {
  const api = useApiClient();

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureFilter, setFeatureFilter] = useState<string>('all');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const qs = featureFilter === 'all' ? '' : `?feature=${encodeURIComponent(featureFilter)}`;
      const [summaryRes, sessionsRes] = await Promise.all([
        api.get<SummaryResponse>('/api/v1/admin/ai-usage'),
        api.get<SessionsResponse>(`/api/v1/admin/ai-usage/sessions${qs}`),
      ]);
      setSummary(summaryRes);
      setSessions(sessionsRes.sessions);
    } catch (err) {
      console.error('[AiUsagePage] load failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [api, featureFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const monthly = summary?.monthly ?? { eventCount: 0, sessionCount: 0, failedCount: 0, totalCost: 0 };
  const features = summary?.features ?? [];

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
          <div style={{ ...mono, fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={11} />
            AI_USAGE
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--pipe-text)', margin: 0 }}>
            AI Usage
          </h1>
          <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-dim)', marginTop: 6 }}>
            Real tokens · real prices · includes failed sessions
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', ...mono, fontSize: 10 }}>
          <span style={{ color: 'var(--pipe-text)' }}>${monthly.totalCost.toFixed(4)} MTD</span>
          <span style={{ color: 'var(--pipe-text-dim)' }}>{monthly.sessionCount} SESSIONS</span>
          <span style={{ color: 'var(--pipe-text-dim)' }}>{monthly.eventCount} CALLS</span>
          <span style={{ color: monthly.failedCount > 0 ? '#f87171' : 'var(--pipe-text-dim)' }}>
            {monthly.failedCount} FAILED
          </span>
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
      {loading && !summary && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={18} color="var(--pipe-text-dim)" style={{ animation: 'spin 1s linear infinite', margin: '0 auto' }} />
        </div>
      )}

      {/* Content */}
      {summary && (
        <>
          {/* Stat cards */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <StatCard label="Total spend"  value={`$${monthly.totalCost.toFixed(4)}`} subtitle="USD month-to-date" />
            <StatCard label="Sessions"     value={String(monthly.sessionCount)}       subtitle="unique ref_ids" />
            <StatCard label="API calls"    value={String(monthly.eventCount)}         subtitle="across all features" />
            {monthly.failedCount > 0 ? (
              <StatCard
                label="Failed calls"
                value={String(monthly.failedCount)}
                subtitle="errored but still billed"
                accent="#f87171"
              />
            ) : (
              <StatCard
                label="Failed calls"
                value="0"
                subtitle="none yet this month"
              />
            )}
          </div>

          {/* Feature breakdown */}
          <div
            style={{
              padding: '14px 16px',
              border: '1px solid var(--pipe-border)',
              borderRadius: 8,
              background: 'var(--pipe-surface)',
              marginBottom: 20,
            }}
          >
            <div
              style={{
                ...mono,
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '0.18em',
                color: 'var(--pipe-text-dim)',
                textTransform: 'uppercase',
                borderBottom: '1px solid var(--pipe-border)',
                paddingBottom: 8,
                marginBottom: 12,
              }}
            >
              Per-feature breakdown
            </div>

            {features.length === 0 ? (
              <div style={{ ...mono, padding: '20px 0', textAlign: 'center', color: 'var(--pipe-text-dim)', fontSize: 11 }}>
                No usage data yet this month.
              </div>
            ) : (
              <table style={{ ...mono, width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    {['Feature', 'Sessions', 'Calls', 'Failed', 'Avg / session', 'Total', 'Text tokens', 'Audio tokens'].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left',
                          padding: '4px 8px',
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: '0.12em',
                          color: 'var(--pipe-text-dim)',
                          borderBottom: '1px solid var(--pipe-border)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {features.map((row) => (
                    <tr key={row.feature}>
                      <td style={{ padding: '8px', fontWeight: 700, color: 'var(--pipe-text)' }}>{featureLabel(row.feature)}</td>
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)' }}>{row.sessionCount}</td>
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)' }}>{row.eventCount}</td>
                      <td style={{ padding: '8px', color: row.failedCount > 0 ? '#f87171' : 'var(--pipe-text-dim)' }}>
                        {row.failedCount}
                      </td>
                      <td style={{ padding: '8px', fontWeight: 700, color: 'var(--pipe-text)' }}>${row.avgCostPerSession.toFixed(4)}</td>
                      <td style={{ padding: '8px', fontWeight: 700, color: 'var(--pipe-text)' }}>${row.totalCost.toFixed(4)}</td>
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10 }}>
                        {(row.totalInputTokens + row.totalOutputTokens).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10 }}>
                        {(row.totalInputAudioTokens + row.totalOutputAudioTokens).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Session drill-down */}
          <div
            style={{
              padding: '14px 16px',
              border: '1px solid var(--pipe-border)',
              borderRadius: 8,
              background: 'var(--pipe-surface)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--pipe-border)',
                paddingBottom: 8,
                marginBottom: 12,
                gap: 12,
              }}
            >
              <div style={{ ...mono, fontSize: 9, fontWeight: 800, letterSpacing: '0.18em', color: 'var(--pipe-text-dim)', textTransform: 'uppercase' }}>
                Recent sessions (top 50)
              </div>
              <select
                value={featureFilter}
                onChange={(e) => setFeatureFilter(e.target.value)}
                style={{
                  ...mono,
                  background: 'transparent',
                  border: '1px solid var(--pipe-border)',
                  color: 'var(--pipe-text)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  padding: '4px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                <option value="all">ALL FEATURES</option>
                {Object.keys(FEATURE_LABELS).map((key) => (
                  <option key={key} value={key}>{FEATURE_LABELS[key]}</option>
                ))}
              </select>
            </div>

            {sessions.length === 0 ? (
              <div style={{ ...mono, padding: '20px 0', textAlign: 'center', color: 'var(--pipe-text-dim)', fontSize: 11 }}>
                No sessions yet.
              </div>
            ) : (
              <table style={{ ...mono, width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    {['Feature', 'Session', 'Status', 'Calls', 'Text tokens', 'Audio tokens', 'Audio sec', 'Cost', 'Last'].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left',
                          padding: '4px 8px',
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: '0.12em',
                          color: 'var(--pipe-text-dim)',
                          borderBottom: '1px solid var(--pipe-border)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((row, i) => (
                    <tr
                      key={`${row.feature}-${row.refId}-${i}`}
                      style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.018)' }}
                      title={row.lastError ?? undefined}
                    >
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10 }}>{featureLabel(row.feature)}</td>
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10 }}>
                        {row.refId ? row.refId.slice(0, 14) + '…' : '—'}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <span
                          style={{
                            fontSize: 8,
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            padding: '2px 7px',
                            borderRadius: 3,
                            background: row.success ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                            color: row.success ? '#4ade80' : '#f87171',
                          }}
                        >
                          {row.success ? 'OK' : 'FAIL'}
                        </span>
                      </td>
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10 }}>{row.eventCount}</td>
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10 }}>
                        {(row.inputTokens + row.outputTokens).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10 }}>
                        {(row.inputAudioTokens + row.outputAudioTokens).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10 }}>
                        {row.audioSeconds > 0 ? row.audioSeconds.toFixed(1) : '—'}
                      </td>
                      <td style={{ padding: '8px', fontWeight: 700, color: 'var(--pipe-text)' }}>${row.totalCost.toFixed(4)}</td>
                      <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10 }}>
                        {new Date(row.lastEventAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
