/**
 * CultureCostDashboard — Admin-only AI cost visibility for culture interviews.
 *
 * Not currently wired into the router or navigation. Mount when needed:
 *   import { CultureCostDashboard } from './pages/admin/CultureCostDashboard';
 *
 * Data source: GET /api/v1/screening/culture/cost-dashboard
 *
 * Shows:
 *  1. Monthly totals card (total interviews, total cost, avg per interview)
 *  2. Top 10 most expensive interviews table
 */

import { useState, useEffect, type CSSProperties } from 'react';
import { LiquidMetalCard } from '../../components/ui/LiquidMetalCard';

// ─── API types ────────────────────────────────────────────────────────────────

interface MonthlySummary {
  totalCost: number;
  interviewCount: number;
  avgCostPerInterview: number;
}

interface TopExpensiveRow {
  session_id: string;
  total_cost: number;
  candidate_id: string | null;
  state: string | null;
  completed_at: string | null;
}

interface CostDashboardData {
  monthly: MonthlySummary;
  topExpensive: TopExpensiveRow[];
}

// ─── Style constants ──────────────────────────────────────────────────────────

const FONT_MONO: CSSProperties = { fontFamily: 'Space Mono, monospace' };

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

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
}

function StatCard({ label, value, subtitle }: StatCardProps): JSX.Element {
  return (
    <LiquidMetalCard
      variant="dark"
      style={{ borderRadius: 8, padding: '20px 24px', flex: 1 }}
    >
      <div style={LABEL_STYLE}>{label}</div>
      <div style={{ ...VALUE_STYLE, marginTop: 8 }}>{value}</div>
      {subtitle && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--pipe-text-dim)',
            marginTop: 4,
            ...FONT_MONO,
          }}
        >
          {subtitle}
        </div>
      )}
    </LiquidMetalCard>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Admin cost dashboard for the culture interview pipeline.
 *
 * Named export — not a default export because this page is not yet routed.
 * Wire into the router when the admin segment is built.
 */
export function CultureCostDashboard(): JSX.Element {
  const [data, setData] = useState<CostDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch('/api/v1/screening/culture/cost-dashboard', {
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as CostDashboardData;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
          console.error('[CultureCostDashboard] load failed:', err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          color: 'var(--pipe-text-dim)',
          fontSize: 11,
          ...FONT_MONO,
        }}
      >
        LOADING...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          color: '#f87171',
          fontSize: 11,
          ...FONT_MONO,
        }}
      >
        {error ?? 'No data.'}
      </div>
    );
  }

  const { monthly, topExpensive } = data;

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
      {/* Header */}
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: '0.02em',
            color: 'var(--pipe-text)',
            ...FONT_MONO,
          }}
        >
          CULTURE INTERVIEW — AI COST
        </h1>
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 10,
            color: 'var(--pipe-text-dim)',
            letterSpacing: '0.04em',
          }}
        >
          Current calendar month · auto-refreshes on page load
        </p>
      </div>

      {/* Monthly stats row */}
      <div style={{ display: 'flex', gap: 16 }}>
        <StatCard
          label="Total interviews"
          value={String(monthly.interviewCount)}
          subtitle="culture sessions with AI usage"
        />
        <StatCard
          label="Total AI cost"
          value={`$${monthly.totalCost.toFixed(4)}`}
          subtitle="USD this month"
        />
        <StatCard
          label="Avg cost / interview"
          value={`$${monthly.avgCostPerInterview.toFixed(4)}`}
          subtitle="conversation + scoring"
        />
      </div>

      {/* Top expensive interviews table */}
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
            ...FONT_MONO,
          }}
        >
          Most Expensive Interviews (top 10)
        </div>

        {topExpensive.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--pipe-text-dim)',
              fontSize: 11,
              padding: '20px 0',
            }}
          >
            No usage data yet.
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 11,
              ...FONT_MONO,
            }}
          >
            <thead>
              <tr>
                {['Session', 'Candidate', 'State', 'Completed', 'Cost'].map((h) => (
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
              {topExpensive.map((row, i) => (
                <tr
                  key={row.session_id}
                  style={{
                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.018)',
                  }}
                >
                  <td
                    style={{
                      padding: '8px 8px',
                      color: 'var(--pipe-text-dim)',
                      fontSize: 10,
                      letterSpacing: '0.02em',
                      fontFamily: 'monospace',
                    }}
                  >
                    {row.session_id.slice(0, 12)}…
                  </td>
                  <td
                    style={{
                      padding: '8px 8px',
                      color: 'var(--pipe-text-dim)',
                      fontSize: 10,
                    }}
                  >
                    {row.candidate_id ? row.candidate_id.slice(0, 10) + '…' : '—'}
                  </td>
                  <td style={{ padding: '8px 8px' }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        padding: '2px 7px',
                        borderRadius: 3,
                        background:
                          row.state === 'complete'
                            ? 'rgba(74,222,128,0.1)'
                            : row.state === 'error'
                            ? 'rgba(248,113,113,0.1)'
                            : 'rgba(255,255,255,0.06)',
                        color:
                          row.state === 'complete'
                            ? '#4ade80'
                            : row.state === 'error'
                            ? '#f87171'
                            : 'var(--pipe-text-dim)',
                      }}
                    >
                      {(row.state ?? 'unknown').toUpperCase()}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: '8px 8px',
                      color: 'var(--pipe-text-dim)',
                      fontSize: 10,
                    }}
                  >
                    {row.completed_at
                      ? new Date(row.completed_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                  </td>
                  <td
                    style={{
                      padding: '8px 8px',
                      color: 'var(--pipe-text)',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    ${row.total_cost.toFixed(4)}
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
