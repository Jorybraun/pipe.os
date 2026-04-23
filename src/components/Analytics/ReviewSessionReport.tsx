import { useState, useEffect } from 'react';
import { MessageSquare, BarChart3, Table2, Loader2, RefreshCw } from 'lucide-react';
import { TabNav } from '../ui/TabNav';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { useApiClient } from '../../hooks/useApiClient';
import type { ReviewSessionListItem, ReviewSessionReportResponse } from '../../lib/api/types';
import type { Thread, ReviewRound, ReviewComment, ThreadExchange } from '../../types/conversation';
import { buildThreadsFromRounds } from '../../types/conversation';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReviewSessionReportProps {
  session: ReviewSessionListItem;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  scoring: 'Scoring…',
  scored: 'Scored',
  scoring_failed: 'Scoring Failed',
};

const STATUS_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  pending: { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)' },
  in_progress: { text: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.3)' },
  scoring: { text: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)' },
  scored: { text: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' },
  scoring_failed: { text: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)' },
};

function getStatusColors(status: string): { text: string; bg: string; border: string } {
  const fallback = { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)' };
  return STATUS_COLORS[status] ?? fallback;
}

// ─── Sub-components: Transcript ─────────────────────────────────────────────

function CommentReadOnly({ comment }: { comment: ReviewComment }): JSX.Element {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'rgba(96,165,250,0.04)',
        border: '1px solid rgba(96,165,250,0.12)',
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 9,
            color: 'rgba(96,165,250,0.7)',
            letterSpacing: '0.1em',
            fontWeight: 600,
          }}
        >
          YOU
        </span>
        <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.05em' }}>
          #{comment.id}
        </span>
        {comment.file && (
          <span
            style={{
              fontSize: 9,
              color: '#60a5fa',
              fontFamily: '"Space Mono", monospace',
              marginLeft: 'auto',
            }}
          >
            {comment.file}:{comment.line ?? ''}
          </span>
        )}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 11,
          lineHeight: 1.6,
          color: 'rgba(255,255,255,0.75)',
          fontFamily: '"Space Mono", monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {comment.what}
      </p>
    </div>
  );
}

function ExchangeReadOnly({ exchange }: { exchange: ThreadExchange }): JSX.Element {
  const isReviewer = exchange.actor === 'reviewer';
  return (
    <div
      style={{
        padding: '10px 12px',
        background: isReviewer ? 'rgba(96,165,250,0.04)' : 'var(--pipe-accent-surface)',
        border: `1px solid ${isReviewer ? 'rgba(96,165,250,0.12)' : 'var(--pipe-accent-surface)'}`,
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 9,
            color: isReviewer ? 'rgba(96,165,250,0.7)' : 'var(--pipe-accent)',
            letterSpacing: '0.1em',
            fontWeight: 600,
          }}
        >
          {isReviewer ? 'YOU' : 'AUTHOR'}
        </span>
        <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.05em' }}>
          ROUND {exchange.round}
        </span>
        {exchange.move && (
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '0.1em',
              padding: '1px 6px',
              borderRadius: 3,
              background: 'rgba(255,255,255,0.06)',
              color: 'var(--pipe-text-dim)',
            }}
          >
            {exchange.move.toUpperCase()}
          </span>
        )}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 11,
          lineHeight: 1.6,
          color: 'rgba(255,255,255,0.75)',
          fontFamily: '"Space Mono", monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {exchange.content}
      </p>
    </div>
  );
}

function ThreadReadOnly({ thread }: { thread: Thread }): JSX.Element {
  return (
    <div
      style={{
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.07)',
        overflow: 'hidden',
        background: 'var(--pipe-surface)',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          background: 'var(--pipe-surface)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {thread.comment.file && (
          <span
            style={{
              fontSize: 9,
              color: '#60a5fa',
              fontFamily: '"Space Mono", monospace',
              fontWeight: 700,
            }}
          >
            {thread.comment.file}:{thread.comment.line ?? ''}
          </span>
        )}
        <span
          style={{
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.08em',
            padding: '2px 6px',
            borderRadius: 3,
            background: thread.resolution === 'fix_agreed' ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)',
            color: thread.resolution === 'fix_agreed' ? '#34d399' : 'var(--pipe-text-dim)',
          }}
        >
          {thread.resolution.toUpperCase().replace(/_/g, ' ')}
        </span>
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CommentReadOnly comment={thread.comment} />
        {thread.exchanges.map((exchange, i) => (
          <ExchangeReadOnly key={`${thread.comment_id}-ex-${i}`} exchange={exchange} />
        ))}
      </div>
    </div>
  );
}

function TranscriptTab({ rounds }: { rounds: ReviewRound[] }): JSX.Element {
  const threads = buildThreadsFromRounds(rounds);
  if (threads.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--pipe-text-dim)', fontSize: 12 }}>
        No transcript available.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {threads.map((thread) => (
        <ThreadReadOnly key={thread.comment_id} thread={thread} />
      ))}
    </div>
  );
}

// ─── Sub-components: Score ──────────────────────────────────────────────────

function ScoreTab({
  score,
  scoreReport,
  status,
}: {
  score: number | null;
  scoreReport: ReviewSessionListItem['scoreReport'];
  status: string;
}): JSX.Element {
  if (!scoreReport) {
    const colors = getStatusColors(status);
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '6px 14px',
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
            color: colors.text,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          {STATUS_LABELS[status] ?? status.toUpperCase()}
        </span>
      </div>
    );
  }

  const band = scoreReport.overall.band;
  const bandColor =
    band === 'strong' ? '#10b981' : band === 'adequate' ? '#fbbf24' : '#f87171';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <div style={{ fontSize: 48, fontWeight: 900, color: 'var(--pipe-text, #fff)', lineHeight: 1 }}>
          {score ?? '—'}
        </div>
        <span
          style={{
            display: 'inline-block',
            padding: '4px 10px',
            background: `${bandColor}14`,
            border: `1px solid ${bandColor}40`,
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 700,
            color: bandColor,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          {band.toUpperCase()}
        </span>
      </div>

      <LiquidMetalCard variant="default" style={{ padding: 20, borderRadius: 8 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            marginBottom: 16,
            fontWeight: 700,
            fontFamily: '"Space Mono", monospace',
          }}
        >
          DIMENSION_BREAKDOWN
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'TECHNICAL', score: scoreReport.technical.score, weight: 30 },
            { label: 'CONVERSATION', score: scoreReport.conversation.score, weight: 30 },
            { label: 'PRACTICE', score: scoreReport.practice.score, weight: 25 },
            { label: 'EFFECTIVENESS', score: scoreReport.effectiveness.score, weight: 15 },
          ].map((dim) => (
            <div key={dim.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  width: 120,
                  fontSize: 10,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {dim.label}
              </span>
              <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                <div
                  style={{
                    width: `${dim.score}%`,
                    height: '100%',
                    background: 'var(--pipe-accent)',
                    borderRadius: 3,
                  }}
                />
              </div>
              <span
                style={{
                  width: 40,
                  textAlign: 'right',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--pipe-text, #fff)',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {Math.round(dim.score)}
              </span>
            </div>
          ))}
        </div>
      </LiquidMetalCard>

      {scoreReport.overall.narrative && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--pipe-text-muted)',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
          }}
        >
          {scoreReport.overall.narrative}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components: Metrics ────────────────────────────────────────────────

function MetricsTab({
  scoreReport,
}: {
  scoreReport: ReviewSessionListItem['scoreReport'];
}): JSX.Element {
  if (!scoreReport) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--pipe-text-dim)', fontSize: 12 }}>
        No metrics available.
      </div>
    );
  }

  const rows = [
    { label: 'Bugs Found', value: scoreReport.technical.bugs_found.length },
    { label: 'Bugs Missed', value: scoreReport.technical.bugs_missed.length },
    { label: 'False Positives', value: scoreReport.technical.false_positive_count },
    { label: 'Severity Accuracy', value: `${Math.round(scoreReport.technical.severity_accuracy * 100)}%` },
    { label: 'Threads Resolved', value: scoreReport.conversation.threads_resolved },
    { label: 'Threads Dangling', value: scoreReport.conversation.threads_dangling },
  ];

  return (
    <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--pipe-border)' }}>
            <th
              style={{
                padding: '12px 16px',
                textAlign: 'left',
                fontSize: 9,
                letterSpacing: '0.15em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                fontWeight: 700,
              }}
            >
              METRIC
            </th>
            <th
              style={{
                padding: '12px 16px',
                textAlign: 'right',
                fontSize: 9,
                letterSpacing: '0.15em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                fontWeight: 700,
              }}
            >
              VALUE
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: 12,
                  color: 'var(--pipe-text-muted)',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {row.label}
              </td>
              <td
                style={{
                  padding: '12px 16px',
                  textAlign: 'right',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--pipe-text, #fff)',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </LiquidMetalCard>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function ReviewSessionReport({ session }: ReviewSessionReportProps): JSX.Element {
  const api = useApiClient();
  const [activeTab, setActiveTab] = useState('transcript');
  const [report, setReport] = useState<ReviewSessionReportResponse | null>(null);
  const [fetching, setFetching] = useState(false);
  const [rescoring, setRescoring] = useState(false);

  // Lazy-fetch full report if transcript is missing
  useEffect(() => {
    if (session.transcript || report || fetching) return;
    setFetching(true);
    api
      .get<ReviewSessionReportResponse>(`/api/v1/review-sessions/${session.id}/report`)
      .then((data) => setReport(data))
      .catch((err) => console.error('[ReviewSessionReport] fetch report failed:', err))
      .finally(() => setFetching(false));
  }, [session.id, session.transcript, report, fetching, api]);

  const rounds: ReviewRound[] = session.transcript?.rounds ?? report?.transcript?.rounds ?? [];
  const scoreReport = session.scoreReport ?? report?.scoreReport ?? null;
  const score = session.score ?? report?.scoreReport?.overall.score ?? null;

  const tabs = [
    { id: 'transcript', label: 'TRANSCRIPT', icon: <MessageSquare size={12} /> },
    { id: 'score', label: 'SCORE', icon: <BarChart3 size={12} /> },
    { id: 'metrics', label: 'METRICS', icon: <Table2 size={12} /> },
  ];

  const handleRescore = async () => {
    setRescoring(true);
    try {
      await api.post(`/api/v1/review-sessions/${session.id}/rescore`, {});
      // Optimistically update status
      session.status = 'scoring';
      setReport(null);
      // Trigger re-fetch
      const data = await api.get<ReviewSessionReportResponse>(`/api/v1/review-sessions/${session.id}/report`);
      setReport(data);
    } catch (err) {
      console.error('[ReviewSessionReport] rescore failed:', err);
    } finally {
      setRescoring(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0c0c0e' }}>
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--pipe-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
              fontWeight: 700,
              fontFamily: '"Space Mono", monospace',
            }}
          >
            REVIEW_SESSION
          </div>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 8px',
              background: getStatusColors(session.status).bg,
              border: `1px solid ${getStatusColors(session.status).border}`,
              borderRadius: 3,
              fontSize: 8,
              fontWeight: 700,
              color: getStatusColors(session.status).text,
              letterSpacing: '0.08em',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {STATUS_LABELS[session.status] ?? session.status.toUpperCase()}
          </span>
        </div>
        {session.status === 'scoring_failed' && (
          <button
            onClick={() => void handleRescore()}
            disabled={rescoring}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'rgba(96,165,250,0.08)',
              border: '1px solid rgba(96,165,250,0.25)',
              borderRadius: 4,
              color: '#60a5fa',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              fontFamily: '"Space Mono", monospace',
              cursor: rescoring ? 'wait' : 'pointer',
              opacity: rescoring ? 0.5 : 1,
            }}
          >
            {rescoring ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={10} />}
            RE-SCORE
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
        <TabNav tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>
        {fetching && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={24} color="var(--pipe-text-dim)" style={{ animation: 'spin 1s linear infinite' }} />
            <div
              style={{
                marginTop: 12,
                fontSize: 10,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.15em',
              }}
            >
              LOADING_REPORT...
            </div>
          </div>
        )}

        {!fetching && activeTab === 'transcript' && <TranscriptTab rounds={rounds} />}
        {!fetching && activeTab === 'score' && (
          <ScoreTab score={score} scoreReport={scoreReport} status={session.status} />
        )}
        {!fetching && activeTab === 'metrics' && <MetricsTab scoreReport={scoreReport} />}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
