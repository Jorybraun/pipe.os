/**
 * IngestionDetailTab — default tab for INGESTION stages.
 *
 * Shows pipeline-level ingestion summary and per-candidate ingestion cards
 * with profile excerpts, match scores, dimension breakdowns, and recruiter
 * actions (approve / reject / re-ingest).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Users,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Activity,
  Filter,
  ArrowUpDown,
} from 'lucide-react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { LiquidMetalCard } from '../../components/ui/LiquidMetalCard';
import { createApiClient } from '../../lib/api/client';
import { ApiError } from '../../lib/api/types';
import type { StagePanelContext } from '../StagePanel';

const mono = '"Space Mono", monospace';

interface IngestionRow {
  candidateId: string;
  candidateName: string;
  status: 'pending' | 'profile_generated' | 'embedded' | 'matched' | 'failed';
  candidateSearchableProfile: string;
  matchedRepoName: string | null;
  triangulatedScore: number | null;
  dimensions: {
    skillCoverage: number;
    semanticSimilarity: number;
    situationFit: number;
    roleAlignment: number;
  } | null;
  reasoning: { matches: string[]; mismatches: string[] } | null;
  errorText: string | null;
}

type FilterStatus = 'all' | 'pending' | 'failed' | 'matched';
type SortKey = 'name' | 'score' | 'status';

const STATUS_LABEL: Record<IngestionRow['status'], string> = {
  pending: 'PENDING',
  profile_generated: 'PROFILE GENERATED',
  embedded: 'EMBEDDED',
  matched: 'MATCHED',
  failed: 'FAILED',
};

const STATUS_COLOR: Record<IngestionRow['status'], string> = {
  pending: 'var(--pipe-text-dim)',
  profile_generated: '#60a5fa',
  embedded: '#60a5fa',
  matched: '#4ade80',
  failed: '#f87171',
};

function StatusBadge({ status }: { status: IngestionRow['status'] }): JSX.Element {
  return (
    <span
      style={{
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: '0.1em',
        padding: '2px 8px',
        borderRadius: 3,
        background: `${STATUS_COLOR[status]}18`,
        border: `1px solid ${STATUS_COLOR[status]}40`,
        color: STATUS_COLOR[status],
        fontFamily: mono,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function DimensionBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'var(--pipe-text-dim)',
          fontFamily: mono,
          width: 100,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 4,
          background: 'var(--pipe-border)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.round(value * 100)}%`,
            height: '100%',
            background: color,
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--pipe-text-muted)',
          fontFamily: mono,
          width: 32,
          textAlign: 'right',
        }}
      >
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

export default function IngestionDetailTab(): JSX.Element {
  const { shell } = useOutletContext<StagePanelContext>();
  const { getToken } = useClerkAuth();

  const [rows, setRows] = useState<IngestionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [actionId, setActionId] = useState<string | null>(null);

  const isValidateMode = shell.matchConfig?.matchPhilosophy === 'validate';

  const fetchIngestion = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const api = createApiClient({ getToken });
      const data = await api.get<IngestionRow[]>(
        `/api/v1/pipelines/${shell.pipelineId}/ingestion`,
      );
      setRows(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(
          err instanceof Error ? err.message : 'Failed to load ingestion data',
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [shell.pipelineId, getToken]);

  useEffect(() => {
    void fetchIngestion();
  }, [fetchIngestion]);

  const summary = useMemo(() => {
    const ingested = rows.filter(
      (r) => r.status !== 'pending' && r.status !== 'failed',
    ).length;
    const pending = rows.filter((r) => r.status === 'pending').length;
    const failed = rows.filter((r) => r.status === 'failed').length;
    return { ingested, pending, failed, total: rows.length };
  }, [rows]);

  const filteredRows = useMemo(() => {
    let result = [...rows];
    if (filter === 'pending') {
      result = result.filter((r) => r.status === 'pending');
    } else if (filter === 'failed') {
      result = result.filter((r) => r.status === 'failed');
    } else if (filter === 'matched') {
      result = result.filter((r) => r.status === 'matched');
    }
    result.sort((a, b) => {
      if (sort === 'name') return a.candidateName.localeCompare(b.candidateName);
      if (sort === 'score') {
        const sa = a.triangulatedScore ?? -1;
        const sb = b.triangulatedScore ?? -1;
        return sb - sa;
      }
      if (sort === 'status') return a.status.localeCompare(b.status);
      return 0;
    });
    return result;
  }, [rows, filter, sort]);

  const handleFeedback = useCallback(
    async (candidateId: string, approved: boolean) => {
      setActionId(candidateId);
      try {
        const api = createApiClient({ getToken });
        await api.post(
          `/api/v1/pipelines/${shell.pipelineId}/ingestion/${candidateId}/feedback`,
          { approved },
        );
        await fetchIngestion();
      } catch (err) {
        console.error('[IngestionDetailTab] Feedback failed:', err);
      } finally {
        setActionId(null);
      }
    },
    [shell.pipelineId, getToken, fetchIngestion],
  );

  const handleReingest = useCallback(
    async (candidateId: string) => {
      setActionId(candidateId);
      try {
        const api = createApiClient({ getToken });
        await api.post(
          `/api/v1/pipelines/${shell.pipelineId}/ingestion/${candidateId}/reingest`,
          {},
        );
        await fetchIngestion();
      } catch (err) {
        console.error('[IngestionDetailTab] Re-ingest failed:', err);
      } finally {
        setActionId(null);
      }
    },
    [shell.pipelineId, getToken, fetchIngestion],
  );

  if (isLoading) {
    return (
      <div
        data-testid="stage-tab-content-ingestion-detail"
        style={{
          padding: 40,
          color: 'var(--pipe-text-dim)',
          fontFamily: mono,
          fontSize: 11,
          letterSpacing: '0.1em',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Loader2 size={16} />
        LOADING INGESTION DATA...
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="stage-tab-content-ingestion-detail"
        style={{
          padding: 40,
          color: '#f87171',
          fontFamily: mono,
          fontSize: 11,
          letterSpacing: '0.1em',
        }}
      >
        <AlertCircle size={16} style={{ marginBottom: 8 }} />
        {error}
      </div>
    );
  }

  return (
    <div
      data-testid="stage-tab-content-ingestion-detail"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Summary */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}
      >
        {[
          {
            label: 'TOTAL',
            value: summary.total,
            color: 'var(--pipe-text)',
            icon: Users,
          },
          {
            label: 'INGESTED',
            value: summary.ingested,
            color: '#4ade80',
            icon: CheckCircle2,
          },
          {
            label: 'PENDING',
            value: summary.pending,
            color: 'var(--pipe-text-dim)',
            icon: Clock,
          },
          {
            label: 'FAILED',
            value: summary.failed,
            color: '#f87171',
            icon: XCircle,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              padding: '16px 20px',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <stat.icon
              size={18}
              color={stat.color}
              style={{ flexShrink: 0 }}
            />
            <div>
              <div
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  color: 'var(--pipe-text-dim)',
                  fontFamily: mono,
                  marginBottom: 4,
                }}
              >
                {stat.label}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: stat.color,
                  fontFamily: mono,
                  lineHeight: 1,
                }}
              >
                {stat.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Filter size={12} color="var(--pipe-text-dim)" />
          {(['all', 'pending', 'failed', 'matched'] as FilterStatus[]).map(
            (f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '4px 10px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  fontFamily: mono,
                  background: filter === f ? 'var(--pipe-text)' : 'transparent',
                  border: `1px solid ${
                    filter === f ? 'var(--pipe-text)' : 'var(--pipe-border)'
                  }`,
                  borderRadius: 4,
                  color:
                    filter === f ? 'var(--pipe-bg)' : 'var(--pipe-text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {f.toUpperCase()}
              </button>
            ),
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ArrowUpDown size={12} color="var(--pipe-text-dim)" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            style={{
              padding: '4px 10px',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.1em',
              fontFamily: mono,
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text)',
              cursor: 'pointer',
            }}
          >
            <option value="name">BY NAME</option>
            <option value="score">BY SCORE</option>
            <option value="status">BY STATUS</option>
          </select>
        </div>
      </div>

      {/* Candidate cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {filteredRows.length === 0 ? (
          <div
            style={{
              padding: '40px 24px',
              textAlign: 'center',
              border: '1px dashed var(--pipe-border-light)',
              borderRadius: 12,
              color: 'var(--pipe-text-dim)',
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.1em',
            }}
          >
            No candidates match the selected filter.
          </div>
        ) : (
          filteredRows.map((row) => (
            <LiquidMetalCard
              key={row.candidateId}
              variant="default"
              style={{ padding: '20px 24px', borderRadius: 12 }}
            >
              {/* Header: name + status + actions */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  marginBottom: 16,
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: 'var(--pipe-surface)',
                      border: '1px solid var(--pipe-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Users size={14} color="var(--pipe-text-dim)" />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--pipe-text)',
                        fontFamily: mono,
                        letterSpacing: '0.05em',
                        marginBottom: 4,
                      }}
                    >
                      {row.candidateName}
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {row.status !== 'pending' && (
                    <>
                      <button
                        onClick={() =>
                          void handleFeedback(row.candidateId, true)
                        }
                        disabled={actionId === row.candidateId}
                        title="Approve match"
                        style={{
                          background: 'none',
                          border: '1px solid var(--pipe-border)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          cursor:
                            actionId === row.candidateId
                              ? 'default'
                              : 'pointer',
                          opacity: actionId === row.candidateId ? 0.5 : 1,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <ThumbsUp
                          size={14}
                          color={
                            actionId === row.candidateId
                              ? 'var(--pipe-text-dim)'
                              : '#4ade80'
                          }
                        />
                      </button>
                      <button
                        onClick={() =>
                          void handleFeedback(row.candidateId, false)
                        }
                        disabled={actionId === row.candidateId}
                        title="Reject match"
                        style={{
                          background: 'none',
                          border: '1px solid var(--pipe-border)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          cursor:
                            actionId === row.candidateId
                              ? 'default'
                              : 'pointer',
                          opacity: actionId === row.candidateId ? 0.5 : 1,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <ThumbsDown
                          size={14}
                          color={
                            actionId === row.candidateId
                              ? 'var(--pipe-text-dim)'
                              : '#f87171'
                          }
                        />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => void handleReingest(row.candidateId)}
                    disabled={
                      row.status === 'pending' ||
                      isValidateMode ||
                      actionId === row.candidateId
                    }
                    title="Re-ingest candidate"
                    style={{
                      background: 'none',
                      border: '1px solid var(--pipe-border)',
                      borderRadius: 6,
                      padding: '6px 8px',
                      cursor:
                        row.status === 'pending' ||
                        isValidateMode ||
                        actionId === row.candidateId
                          ? 'default'
                          : 'pointer',
                      opacity:
                        row.status === 'pending' ||
                        isValidateMode ||
                        actionId === row.candidateId
                          ? 0.4
                          : 1,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <RefreshCw
                      size={14}
                      color={
                        row.status === 'pending' ||
                        isValidateMode ||
                        actionId === row.candidateId
                          ? 'var(--pipe-text-dim)'
                          : '#60a5fa'
                      }
                    />
                  </button>
                </div>
              </div>

              {/* Profile excerpt */}
              {row.candidateSearchableProfile && (
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--pipe-text-muted)',
                    fontFamily: mono,
                    lineHeight: 1.6,
                    marginBottom: 16,
                    padding: '10px 14px',
                    background: 'var(--pipe-surface)',
                    borderRadius: 8,
                    border: '1px solid var(--pipe-border-light)',
                  }}
                >
                  {row.candidateSearchableProfile.slice(0, 200)}
                  {row.candidateSearchableProfile.length > 200 ? '…' : ''}
                </div>
              )}

              {/* Match info */}
              {row.matchedRepoName && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  <Activity size={12} color="#60a5fa" />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#60a5fa',
                      fontFamily: mono,
                      letterSpacing: '0.08em',
                    }}
                  >
                    {row.matchedRepoName.toUpperCase()}
                  </span>
                  {row.triangulatedScore !== null && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: 'var(--pipe-text)',
                        fontFamily: mono,
                      }}
                    >
                      {Math.round(row.triangulatedScore * 100)}%
                    </span>
                  )}
                </div>
              )}

              {/* Dimensions */}
              {row.dimensions && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    marginBottom: 16,
                    padding: '14px 16px',
                    background: 'var(--pipe-surface)',
                    borderRadius: 8,
                    border: '1px solid var(--pipe-border-light)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: '0.15em',
                      color: 'var(--pipe-text-dim)',
                      fontFamily: mono,
                      marginBottom: 4,
                    }}
                  >
                    DIMENSIONS
                  </div>
                  <DimensionBar
                    label="SKILL COV"
                    value={row.dimensions.skillCoverage}
                    color="#60a5fa"
                  />
                  <DimensionBar
                    label="SEMANTIC"
                    value={row.dimensions.semanticSimilarity}
                    color="#a78bfa"
                  />
                  <DimensionBar
                    label="SITUATION"
                    value={row.dimensions.situationFit}
                    color="#f472b6"
                  />
                  <DimensionBar
                    label="ROLE ALIGN"
                    value={row.dimensions.roleAlignment}
                    color="#4ade80"
                  />
                </div>
              )}

              {/* Reasoning */}
              {row.reasoning && (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  {row.reasoning.matches.length > 0 && (
                    <div>
                      <div
                        style={{
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: '0.15em',
                          color: '#4ade80',
                          fontFamily: mono,
                          marginBottom: 6,
                        }}
                      >
                        MATCHES
                      </div>
                      <ul
                        style={{
                          margin: 0,
                          padding: '0 0 0 16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        {row.reasoning.matches.map((m, i) => (
                          <li
                            key={i}
                            style={{
                              fontSize: 10,
                              color: 'var(--pipe-text-muted)',
                              fontFamily: mono,
                              lineHeight: 1.5,
                            }}
                          >
                            {m}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {row.reasoning.mismatches.length > 0 && (
                    <div>
                      <div
                        style={{
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: '0.15em',
                          color: '#f87171',
                          fontFamily: mono,
                          marginBottom: 6,
                        }}
                      >
                        MISMATCHES
                      </div>
                      <ul
                        style={{
                          margin: 0,
                          padding: '0 0 0 16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        {row.reasoning.mismatches.map((m, i) => (
                          <li
                            key={i}
                            style={{
                              fontSize: 10,
                              color: 'var(--pipe-text-muted)',
                              fontFamily: mono,
                              lineHeight: 1.5,
                            }}
                          >
                            {m}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Error text */}
              {row.errorText && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '10px 14px',
                    background: 'rgba(248,113,113,0.06)',
                    border: '1px solid rgba(248,113,113,0.15)',
                    borderRadius: 8,
                    fontSize: 10,
                    color: '#f87171',
                    fontFamily: mono,
                    lineHeight: 1.5,
                  }}
                >
                  {row.errorText}
                </div>
              )}
            </LiquidMetalCard>
          ))
        )}
      </div>
    </div>
  );
}
