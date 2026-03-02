import { useState, useEffect, useMemo } from 'react';
import { Calendar, RefreshCw } from 'lucide-react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
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

const client = generateClient<Schema>();

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
        // Fetch only the records referenced by current interviews (avoids full table scans)
        const [pipGetResults, candGetResults, stageGetResults] = await Promise.all([
          Promise.all(pipelineIds.map((pid) => client.models.Pipeline.get({ id: pid }))),
          Promise.all(candidateIds.map((cid) => client.models.Candidate.get({ id: cid }))),
          Promise.all(stageIds.map((sid) => client.models.Stage.get({ id: sid }))),
        ]);

        if (cancelled) return;

        const pm: Record<string, PipelineRef> = {};
        pipGetResults.forEach(({ data: p }) => {
          if (p) pm[p.id] = { id: p.id, title: p.title };
        });

        const cm: Record<string, CandidateRef> = {};
        candGetResults.forEach(({ data: c }) => {
          if (c) cm[c.id] = { id: c.id, name: c.name ?? null, email: c.email ?? null };
        });

        const sm: Record<string, StageRef> = {};
        stageGetResults.forEach(({ data: s }) => {
          if (s) sm[s.id] = { id: s.id, title: s.title };
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
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            INTERVIEW_SCHEDULE
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
            Schedule
          </h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace' }}>
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
            border: '1px dashed rgba(255,255,255,0.08)',
            borderRadius: 12,
          }}
        >
          <Calendar size={40} color="rgba(255,255,255,0.12)" style={{ marginBottom: 16 }} />
          <p style={{ color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', fontSize: 13, lineHeight: 1.7 }}>
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
