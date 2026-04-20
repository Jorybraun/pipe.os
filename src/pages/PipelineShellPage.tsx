/**
 * PipelineShellPage — the outer shell for /pipeline/:id.
 *
 * Layout:
 *   [Header row: PIPELINE_OVERVIEW / title / actions]
 *   [StageStepper]
 *   [LiquidMetalCard container → <Outlet />]
 *
 * The Outlet renders either:
 *   - PipelineInsightsPanel (index route) — role profile + insights
 *   - StagePanel (nested /stage/:stageId route) — challenges/candidates/configure
 *
 * All pipeline data (pipeline, stages, candidates, roleContext) is fetched once
 * here via useOverviewData and passed down through React Router's outlet
 * context so nested routes never re-fetch.
 */

import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, Outlet, useMatch, useLocation } from 'react-router-dom';
import { Rocket, Plus, LayoutGrid, AlertTriangle, X } from 'lucide-react';
import { LiquidMetalCard } from '../components';
// LiquidMetalCard is used for the error card only. The shell no longer wraps
// the outlet in a container card — nested SectionCards provide their own
// chrome, and double-nesting them read as box-in-box.
import { Skeleton } from '../components/ui/Skeleton';
import { CandidateIntakeModal } from '../components/Candidate/CandidateIntakeModal';
import { NewStageModal } from '../components/Pipeline/NewStageModal';
import { StageStepper } from '../components/Pipeline/StageStepper';
import { useOverviewData } from '../hooks/useOverviewData';
import type {
  OverviewPipeline,
  OverviewStage,
  OverviewCandidate,
  OverviewRoleContext,
} from '../lib/api/types';

/**
 * Outlet context shape provided to nested routes under /pipeline/:id.
 * Nested components read this via `useOutletContext<PipelineShellContext>()`.
 */
export interface PipelineShellContext {
  pipelineId: string;
  pipeline: OverviewPipeline;
  stages: OverviewStage[];
  candidates: OverviewCandidate[];
  roleContext: OverviewRoleContext | null;
  refetch: () => Promise<void>;
}

function PipelineShellSkeleton(): JSX.Element {
  return (
    <div style={{ padding: 40 }}>
      <Skeleton width={160} height={10} style={{ marginBottom: 12 }} />
      <Skeleton width={280} height={32} style={{ marginBottom: 32 }} />
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} width={180} height={58} />
        ))}
      </div>
      <Skeleton width="100%" height={420} />
    </div>
  );
}

interface AutoBuildWarning {
  code: string;
  severity: 'warn';
  message: string;
}

export default function PipelineShellPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    pipeline,
    stages,
    candidates,
    roleContext,
    matchConfig,
    isLoading,
    error,
    refetch,
    publishPipeline,
  } = useOverviewData(id);

  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [showNewStage, setShowNewStage] = useState(false);

  // Warnings arriving via navigate state from the auto-build wizard. Captured
  // once on mount so the banner persists even after route state is cleared.
  const [autoBuildWarnings, setAutoBuildWarnings] = useState<AutoBuildWarning[]>([]);

  useEffect(() => {
    const state = location.state as { autoBuildWarnings?: AutoBuildWarning[] } | null;
    if (state?.autoBuildWarnings && state.autoBuildWarnings.length > 0) {
      setAutoBuildWarnings(state.autoBuildWarnings);
      // Clear the route state so a refresh doesn't replay the banner.
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // Hide the stepper on the new-stage form route so the form has full focus.
  const newStageMatch = useMatch('/pipeline/:id/new-stage');

  const handlePublish = useCallback(async (): Promise<void> => {
    try {
      await publishPipeline();
    } catch (err) {
      console.error('[PipelineShellPage] Failed to publish:', err);
    }
  }, [publishPipeline]);

  if (isLoading && !pipeline) {
    return <PipelineShellSkeleton />;
  }

  if (error) {
    return (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
        }}
      >
        <LiquidMetalCard
          variant="mercury"
          style={{ maxWidth: 420, padding: 40, textAlign: 'center' }}
        >
          <div
            style={{
              color: '#f87171',
              marginBottom: 16,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.1em',
            }}
          >
            ERROR_LOADING_PIPELINE
          </div>
          <p
            style={{
              color: 'var(--pipe-text-muted)',
              fontSize: 13,
              marginBottom: 24,
              lineHeight: 1.6,
            }}
          >
            {error.message}
          </p>
          <button
            onClick={() => void refetch()}
            style={{
              padding: '12px 24px',
              background: 'var(--pipe-surface-hover)',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
            }}
          >
            RETRY_CONNECTION
          </button>
        </LiquidMetalCard>
      </div>
    );
  }

  if (!pipeline || !id) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <h2 style={{ color: 'var(--pipe-text)', marginBottom: 20 }}>
          Pipeline Not Found
        </h2>
        <button
          onClick={() => navigate('/')}
          style={{
            color: 'var(--pipe-text)',
            background: 'var(--pipe-surface-hover)',
            border: '1px solid var(--pipe-border)',
            padding: '10px 20px',
            cursor: 'pointer',
            fontFamily: '"Space Mono", monospace',
            fontSize: 10,
            letterSpacing: '0.1em',
          }}
        >
          BACK_TO_ROLES
        </button>
      </div>
    );
  }

  const isDraft = pipeline.status === 'DRAFT';
  const isActivePipeline = pipeline.status === 'ACTIVE';

  const outletContext: PipelineShellContext = {
    pipelineId: id,
    pipeline,
    stages,
    candidates,
    roleContext,
    refetch,
  };

  return (
    <div style={{ padding: '0 0 80px' }}>
      {autoBuildWarnings.length > 0 && (
        <div
          data-testid="auto-build-warnings-banner"
          style={{
            display: 'flex',
            gap: 12,
            padding: '14px 16px',
            marginBottom: 20,
            background: 'rgba(251, 191, 36, 0.08)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            borderRadius: 6,
            alignItems: 'flex-start',
          }}
        >
          <AlertTriangle size={16} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.18em',
                color: '#fbbf24',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 8,
              }}
            >
              AUTO_BUILD_WARNINGS
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {autoBuildWarnings.map((w) => (
                <li
                  key={w.code}
                  style={{
                    fontSize: 12,
                    color: 'var(--pipe-text)',
                    lineHeight: 1.5,
                    fontFamily: '"Space Mono", monospace',
                  }}
                >
                  <span style={{ color: 'var(--pipe-text-dim)' }}>[{w.code}]</span> {w.message}
                </li>
              ))}
            </ul>
          </div>
          <button
            onClick={() => setAutoBuildWarnings([])}
            aria-label="Dismiss warnings"
            data-testid="auto-build-warnings-dismiss"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 24,
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              PIPELINE_OVERVIEW
            </div>
            <div
              data-testid="pipeline-status-badge"
              style={{
                fontSize: 9,
                letterSpacing: '0.15em',
                fontFamily: '"Space Mono", monospace',
                padding: '2px 8px',
                borderRadius: 2,
                background: isDraft
                  ? 'rgba(251, 191, 36, 0.15)'
                  : 'rgba(74, 222, 128, 0.15)',
                color: isDraft ? '#fbbf24' : '#4ade80',
                border: `1px solid ${
                  isDraft ? 'rgba(251, 191, 36, 0.3)' : 'rgba(74, 222, 128, 0.3)'
                }`,
              }}
            >
              {pipeline.status}
            </div>
          </div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: 'var(--pipe-text)',
              margin: 0,
            }}
          >
            {pipeline.title}
          </h1>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => navigate(`/pipeline/${id}/kanban`)}
            aria-label="View kanban"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
            }}
          >
            <LayoutGrid size={14} />
            VIEW_KANBAN
          </button>
          {isDraft && (
            <button
              onClick={() => void handlePublish()}
              disabled={stages.length === 0}
              title={
                stages.length === 0
                  ? 'Add at least 1 stage before publishing'
                  : 'Publish pipeline to start inviting candidates'
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                background:
                  stages.length === 0
                    ? 'var(--pipe-surface)'
                    : 'rgba(74, 222, 128, 0.1)',
                border: `1px solid ${
                  stages.length === 0
                    ? 'var(--pipe-border-light)'
                    : 'rgba(74, 222, 128, 0.3)'
                }`,
                color:
                  stages.length === 0
                    ? 'var(--pipe-text-dim)'
                    : '#4ade80',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: stages.length === 0 ? 'not-allowed' : 'pointer',
                opacity: stages.length === 0 ? 0.5 : 1,
              }}
            >
              <Rocket size={14} />
              PUBLISH_PIPELINE
            </button>
          )}
          {isActivePipeline && (
            <button
              onClick={() => setShowAddCandidate(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                color: 'var(--pipe-text)',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
              }}
            >
              <Plus size={14} />
              ADD_CANDIDATE
            </button>
          )}
        </div>
      </div>

      {/* Stepper — hidden on the new-stage form route so the form has full focus */}
      {!newStageMatch && (
        <StageStepper
          pipelineId={id}
          stages={stages}
          candidates={candidates}
          canAddStage={isDraft}
          matchConfig={matchConfig}
          {...(isDraft
            ? {
                onAddStage: () => setShowNewStage(true),
              }
            : {})}
        />
      )}

      {/* Outlet — nested routes render their own SectionCards so the shell
          doesn't need an outer container. */}
      <Outlet context={outletContext} />

      {showAddCandidate && id && (
        <CandidateIntakeModal
          pipelineId={id}
          onClose={() => setShowAddCandidate(false)}
          onSuccess={() => {
            setShowAddCandidate(false);
            void refetch();
          }}
        />
      )}

      {showNewStage && id && (
        <NewStageModal
          pipelineId={id}
          onCreated={(stageId) => {
            setShowNewStage(false);
            void refetch().then(() => {
              navigate(`/pipeline/${id}/stage/${stageId}`);
            });
          }}
          onClose={() => setShowNewStage(false)}
        />
      )}
    </div>
  );
}
