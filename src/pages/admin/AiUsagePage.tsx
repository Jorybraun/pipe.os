/**
 * AiUsagePage — /admin/ai-usage
 *
 * Surfaces real AI spend across features (role discovery, culture, voice, ...).
 * Data source: GET /api/v1/admin/ai-usage + /ai-usage/sessions.
 *
 * Goal: answer "what did one interview cost me?" with real tokens and real
 * prices, including failed sessions.
 */

import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { useApiClient } from '../../hooks/useApiClient';
import { LiquidMetalCard } from '../../components/ui/LiquidMetalCard';

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const FONT_MONO: CSSProperties = { fontFamily: '"Space Mono", monospace' };

const LABEL_STYLE: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.14em',
  color: 'var(--pipe-text-dim)',
  textTransform: 'uppercase',
  ...FONT_MONO,
};

const VALUE_STYLE: CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: 'var(--pipe-text)',
  letterSpacing: '-0.01em',
  ...FONT_MONO,
};

// ─── Feature labels ───────────────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  role_discovery: 'ROLE DISCOVERY',
  culture_interview: 'CULTURE INTERVIEW',
  voice_interview: 'VOICE INTERVIEW',
  copilot: 'COPILOT',
  repo_crawl: 'REPO CRAWL',
  challenge_generation: 'CHALLENGE GEN',
};

function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature.toUpperCase();
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, subtitle }: {
  label: string;
  value: string;
  subtitle?: string;
}): JSX.Element {
  return (
    <LiquidMetalCard variant="dark" style={{ borderRadius: 8, padding: '20px 24px', flex: 1, minWidth: 180 }}>
      <div style={LABEL_STYLE}>{label}</div>
      <div style={{ ...VALUE_STYLE, marginTop: 8 }}>{value}</div>
      {subtitle && (
        <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginTop: 4, ...FONT_MONO }}>
          {subtitle}
        </div>
      )}
    </LiquidMetalCard>
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

  if (loading && !summary) {
    return (
      <div style={{ padding: 40, color: 'var(--pipe-text-dim)', ...FONT_MONO, fontSize: 11 }}>
        LOADING…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, color: '#f87171', ...FONT_MONO, fontSize: 11 }}>
        {error}
      </div>
    );
  }

  const monthly = summary?.monthly ?? { eventCount: 0, sessionCount: 0, failedCount: 0, totalCost: 0 };
  const features = summary?.features ?? [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        padding: '32px 40px',
        background: '#0c0c0e',
        minHeight: '100vh',
        color: 'var(--pipe-text)',
        ...FONT_MONO,
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '0.02em', ...FONT_MONO }}>
          AI USAGE · CURRENT MONTH
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--pipe-text-dim)', letterSpacing: '0.04em' }}>
          Real tokens · real prices · includes failed sessions
        </p>
      </div>

      {/* Totals strip */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <StatCard
          label="Total spend"
          value={`$${monthly.totalCost.toFixed(4)}`}
          subtitle="USD month-to-date"
        />
        <StatCard
          label="Sessions"
          value={String(monthly.sessionCount)}
          subtitle="unique ref_ids"
        />
        <StatCard
          label="API calls"
          value={String(monthly.eventCount)}
          subtitle="across all features"
        />
        <StatCard
          label="Failed calls"
          value={String(monthly.failedCount)}
          subtitle="errored but still billed"
        />
      </div>

      {/* Feature breakdown */}
      <LiquidMetalCard variant="default" style={{ borderRadius: 8, padding: '20px 24px' }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '0.18em',
            color: 'var(--pipe-text-dim)',
            textTransform: 'uppercase',
            borderBottom: '1px solid var(--pipe-border)',
            paddingBottom: 8,
            marginBottom: 16,
          }}
        >
          Per-feature breakdown
        </div>

        {features.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--pipe-text-dim)', fontSize: 11 }}>
            No usage data yet this month.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['Feature', 'Sessions', 'Calls', 'Failed', 'Avg / session', 'Total', 'Text tokens', 'Audio tokens'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '4px 8px',
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      color: 'var(--pipe-text-dim)',
                      borderBottom: '1px solid var(--pipe-border)',
                    }}
                  >
                    {h.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {features.map((row) => (
                <tr key={row.feature}>
                  <td style={{ padding: '8px', fontWeight: 700 }}>{featureLabel(row.feature)}</td>
                  <td style={{ padding: '8px', color: 'var(--pipe-text-dim)' }}>{row.sessionCount}</td>
                  <td style={{ padding: '8px', color: 'var(--pipe-text-dim)' }}>{row.eventCount}</td>
                  <td style={{ padding: '8px', color: row.failedCount > 0 ? '#f87171' : 'var(--pipe-text-dim)' }}>
                    {row.failedCount}
                  </td>
                  <td style={{ padding: '8px', fontWeight: 700 }}>${row.avgCostPerSession.toFixed(4)}</td>
                  <td style={{ padding: '8px', fontWeight: 700 }}>${row.totalCost.toFixed(4)}</td>
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
      </LiquidMetalCard>

      {/* Session drill-down */}
      <LiquidMetalCard variant="default" style={{ borderRadius: 8, padding: '20px 24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--pipe-border)',
            paddingBottom: 8,
            marginBottom: 16,
            gap: 12,
          }}
        >
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.18em', color: 'var(--pipe-text-dim)', textTransform: 'uppercase' }}>
            Recent sessions (top 50)
          </div>
          <select
            value={featureFilter}
            onChange={(e) => setFeatureFilter(e.target.value)}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              padding: '4px 8px',
              borderRadius: 4,
              ...FONT_MONO,
            }}
          >
            <option value="all">ALL FEATURES</option>
            {Object.keys(FEATURE_LABELS).map((key) => (
              <option key={key} value={key}>{FEATURE_LABELS[key]}</option>
            ))}
          </select>
        </div>

        {sessions.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--pipe-text-dim)', fontSize: 11 }}>
            No sessions yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['Feature', 'Session', 'Status', 'Calls', 'Text tokens', 'Audio tokens', 'Audio sec', 'Cost', 'Last'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '4px 8px',
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      color: 'var(--pipe-text-dim)',
                      borderBottom: '1px solid var(--pipe-border)',
                    }}
                  >
                    {h.toUpperCase()}
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
                  <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10, fontFamily: 'monospace' }}>
                    {row.refId ? row.refId.slice(0, 14) + '…' : '—'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <span
                      style={{
                        fontSize: 9,
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
                  <td style={{ padding: '8px', fontWeight: 700 }}>${row.totalCost.toFixed(4)}</td>
                  <td style={{ padding: '8px', color: 'var(--pipe-text-dim)', fontSize: 10 }}>
                    {new Date(row.lastEventAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LiquidMetalCard>
    </div>
  );
}
