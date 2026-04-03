import { useState, useEffect, useMemo } from 'react';
import { Calendar, RefreshCw } from 'lucide-react';
import { useApiClient } from '../../hooks/useApiClient';
import { useScheduledInterviews } from '../../hooks/useScheduledInterviews';
import { useSchedulingConnection } from '../../hooks/useSchedulingConnection';
import { InterviewCard } from './InterviewCard';
import {
  SchedulingFilters,
  DEFAULT_FILTER,
  applySchedulingFilters,
  sortInterviews,
  type SchedulingFilterState,
} from './SchedulingFilters';
import { Skeleton } from '../ui/Skeleton';
import { ConnectionSetup } from './ConnectionSetup';

// ---------------------------------------------------------------------------
// Types for enrichment lookup tables
// ---------------------------------------------------------------------------

interface PipelineRef {
  id: string;
  title: string;
}

interface CandidateRef {
  id: string;
  name: string | null;
  email: string | null;
}

interface StageRef {
  id: string;
  title: string;
}

// ---------------------------------------------------------------------------
// SchedulingDashboard
// ---------------------------------------------------------------------------

/**
 * SchedulingDashboard — recruiter view of all scheduled interviews.
 *
 * Enrichment strategy: after loading ScheduledInterviews via subscription,
 * we batch-fetch the unique pipelines, candidates, and stages referenced by
 * those records. This is intentionally simple for MVP.
 *
 * TODO: Replace the triple batch-fetch with a single GraphQL query that
 * returns denormalized data once AppSync resolver support improves, or add
 * displayName fields directly to ScheduledInterview to avoid the N+1-style
 * pattern on first load.
 */
export function SchedulingDashboard(): JSX.Element {
  const api = useApiClient();
  const { interviews, isLoading, error, updateStatus } = useScheduledInterviews();
  const { connection } = useSchedulingConnection();

  const [filters, setFilters] = useState<SchedulingFilterState>(DEFAULT_FILTER);

  // Lookup tables built after interviews load
  const [pipelinesMap, setPipelinesMap]   = useState<Record<string, PipelineRef>>({});
  const [candidatesMap, setCandidatesMap] = useState<Record<string, CandidateRef>>({});
  const [stagesMap, setStagesMap]         = useState<Record<string, StageRef>>({});
  const [enriching, setEnriching]         = useState(false);

  // Unique IDs needed
  const pipelineIds  = useMemo(() => [...new Set(interviews.map((i) => i.pipelineId))],  [interviews]);
  const candidateIds = useMemo(() => [...new Set(interviews.map((i) => i.candidateId))], [interviews]);
  const stageIds     = useMemo(() => [...new Set(interviews.map((i) => i.stageId))],     [interviews]);

  useEffect(() => {
    if (interviews.length === 0) return;
    let cancelled = false;

    const enrich = async () => {
      setEnriching(true);
      try {
        // Fetch enrichment data from Worker API
        const [pipResults, candResults, stageResults] = await Promise.all([
          Promise.all(pipelineIds.map((pid) =>
            api.get<{ pipeline: { id: string; title: string } }>(`/api/v1/pipelines/${pid}`).catch(() => null)
          )),
          Promise.all(candidateIds.map((cid) =>
            api.get<{ candidate: { id: string; name: string | null; email: string | null } }>(`/api/v1/candidates/${cid}`).catch(() => null)
          )),
          Promise.all(stageIds.map((sid) =>
            api.get<{ stage: { id: string; title: string } }>(`/api/v1/stages/${sid}`).catch(() => null)
          )),
        ]);

        if (cancelled) return;

        const pm: Record<string, PipelineRef> = {};
        pipResults.forEach((r) => {
          if (r?.pipeline) pm[r.pipeline.id] = { id: r.pipeline.id, title: r.pipeline.title };
        });

        const cm: Record<string, CandidateRef> = {};
        candResults.forEach((r) => {
          if (r?.candidate) cm[r.candidate.id] = { id: r.candidate.id, name: r.candidate.name, email: r.candidate.email };
        });

        const sm: Record<string, StageRef> = {};
        stageResults.forEach((r) => {
          if (r?.stage) sm[r.stage.id] = { id: r.stage.id, title: r.stage.title };
        });

        setPipelinesMap(pm);
        setCandidatesMap(cm);
        setStagesMap(sm);
      } catch (err) {
        console.error('[SchedulingDashboard] Enrichment error:', err);
      } finally {
        if (!cancelled) setEnriching(false);
      }
    };

    enrich();
    return () => { cancelled = true; };
    // We intentionally depend on the unique ID arrays — ref-stable via useMemo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineIds.join(','), candidateIds.join(','), stageIds.join(',')]);

  // Build pipeline list for filter dropdown
  const pipelineList = useMemo(
    () => Object.values(pipelinesMap).sort((a, b) => a.title.localeCompare(b.title)),
    [pipelinesMap]
  );

  // Apply filters + sort
  const displayedInterviews = useMemo(
    () => sortInterviews(applySchedulingFilters(interviews, filters)),
    [interviews, filters]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading || enriching) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={64} style={{ borderRadius: 8 }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p style={{ color: '#f87171', fontFamily: '"Space Mono", monospace', fontSize: 13 }}>
        Failed to load interviews: {error.message}
      </p>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            INTERVIEW_SCHEDULE
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--pipe-text, #fff)', letterSpacing: '-0.02em' }}>
            Schedule
          </h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
            {interviews.length} total
          </span>
          {connection?.lastSyncAt && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10,
                color: 'rgba(74,222,128,0.7)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.05em',
              }}
              title={`Last webhook sync: ${new Date(connection.lastSyncAt).toLocaleString()}`}
            >
              <RefreshCw size={10} />
              Last sync {new Date(connection.lastSyncAt).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </span>
          )}
        </div>
      </div>

      {/* OAuth connection setup */}
      <ConnectionSetup />

      {/* Filters */}
      <div style={{ marginBottom: 24 }}>
        <SchedulingFilters
          filters={filters}
          onFiltersChange={setFilters}
          pipelines={pipelineList}
        />
      </div>

      {/* List */}
      {displayedInterviews.length === 0 ? (
        <div
          style={{
            padding: 64,
            textAlign: 'center',
            border: '1px dashed var(--pipe-border)',
            borderRadius: 12,
          }}
        >
          <Calendar size={40} color="var(--pipe-text-dim)" style={{ marginBottom: 16 }} />
          <p style={{ color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', fontSize: 13, lineHeight: 1.7 }}>
            {interviews.length === 0
              ? 'No interviews yet. Invite candidates to LIVE_VIDEO stages to get started.'
              : 'No interviews match the current filters.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayedInterviews.map((iv) => {
            const candidate = candidatesMap[iv.candidateId];
            const pipeline  = pipelinesMap[iv.pipelineId];
            const stage     = stagesMap[iv.stageId];

            const candidateName = candidate?.name ?? candidate?.email ?? iv.candidateId;
            const pipelineTitle = pipeline?.title ?? iv.pipelineId;
            const stageTitle    = stage?.title    ?? iv.stageId;

            return (
              <InterviewCard
                key={iv.id}
                interview={iv}
                candidateName={candidateName}
                pipelineTitle={pipelineTitle}
                stageTitle={stageTitle}
                updateStatus={updateStatus}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
