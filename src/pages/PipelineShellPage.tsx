/**
 * PipelineShellPage — the outer shell for /pipeline/:id.
 *
 * Layout:
 *   [Header row: INTERVIEW_PLAN / title / actions]
 *   [Interview timeline]
 *   [Route outlet]
 *
 * The Outlet renders either:
 *   - PipelineInsightsPanel (index route) — context + interview state
 *   - StagePanel (nested /stage/:stageId route) — interview setup + people
 *
 * All pipeline data (pipeline, stages, candidates, roleContext) is fetched once
 * here via useOverviewData and passed down through React Router's outlet
 * context so nested routes never re-fetch.
 */

import { useState, useCallback } from 'react';
import { useParams, useNavigate, Outlet } from 'react-router-dom';
import { Rocket, Plus, LayoutGrid, Pencil, Undo2 } from 'lucide-react';
import { LiquidMetalCard } from '../components';
// LiquidMetalCard is used for the error card only. The shell no longer wraps
// the outlet in a container card — nested SectionCards provide their own
// chrome, and double-nesting them read as box-in-box.
import { Skeleton } from '../components/ui/Skeleton';
import { CandidateIntakeModal } from '../components/Candidate/CandidateIntakeModal';
import { NewStageModal } from '../components/Pipeline/NewStageModal';
import EditPipelineModal from '../components/Pipeline/EditPipelineModal';
import { useOverviewData } from '../hooks/useOverviewData';
import type {
  OverviewPipeline,
  OverviewStage,
  OverviewCandidate,
  OverviewRoleContext,
  OverviewMatchConfig,
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
  matchConfig: OverviewMatchConfig | null;
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

export default function PipelineShellPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
    unpublishPipeline,
    updatePipeline,
  } = useOverviewData(id);

  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [showNewStage, setShowNewStage] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const handlePublish = useCallback(async (): Promise<void> => {
    try {
      await publishPipeline();
    } catch (err) {
      console.error('[PipelineShellPage] Failed to publish:', err);
    }
  }, [publishPipeline]);

  const handleUnpublish = useCallback(async (): Promise<void> => {
    if (!window.confirm('Pause this interview plan? People will no longer be able to access its interview links.')) return;
    try {
      await unpublishPipeline();
    } catch (err) {
      console.error('[PipelineShellPage] Failed to unpublish:', err);
    }
  }, [unpublishPipeline]);

  const handleUpdate = useCallback(
    async (updates: Parameters<typeof updatePipeline>[0]): Promise<void> => {
      try {
        await updatePipeline(updates);
      } catch (err) {
        console.error('[PipelineShellPage] Failed to update:', err);
      }
    },
    [updatePipeline],
  );

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
            ERROR_LOADING_CONTEXT
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
          Interview Plan Not Found
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
          BACK TO CONTEXTS
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
    matchConfig,
    refetch,
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 32, padding: '0 0 80px' }}>
      {/* Header - spans both columns */}
      <div style={{ gridColumn: '1 / -1' }}>
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
              INTERVIEW PLAN
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
            onClick={() => navigate(`/pipeline/${id}`)}
            aria-label="Interview plan overview"
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
            OVERVIEW
          </button>
          <button
            onClick={() => navigate(`/pipeline/${id}/kanban`)}
            aria-label="View people board"
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
            PEOPLE BOARD
          </button>
          {isDraft && (
            <button
              onClick={() => void handlePublish()}
              disabled={stages.length === 0}
              title={
                stages.length === 0
                  ? 'Add at least 1 interview before activating'
                  : 'Activate this plan so people can be invited'
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
              ACTIVATE PLAN
            </button>
          )}
          {isActivePipeline && (
            <>
              <button
                onClick={() => setShowEdit(true)}
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
                <Pencil size={14} />
                EDIT
              </button>
              <button
                onClick={() => void handleUnpublish()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  color: 'var(--pipe-text-dim)',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: 'pointer',
                }}
              >
                <Undo2 size={14} />
                PAUSE PLAN
              </button>
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
                ADD PERSON
              </button>
            </>
          )}
          {isDraft && (
            <button
              onClick={() => setShowEdit(true)}
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
              <Pencil size={14} />
              EDIT
            </button>
          )}
        </div>
      </div>
      </div>

      {/* Main content area */}
      <div style={{ gridColumn: '1' }}>
        {/* Outlet — nested routes render their own SectionCards so the shell
            doesn't need an outer container. */}
        <Outlet context={outletContext} />
      </div>

      {/* Right panel - vertical interview timeline */}
      <div style={{ 
        gridColumn: '2',
        paddingLeft: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        position: 'relative',
      }}>
        {/* Timeline line */}
        <div style={{
          position: 'absolute',
          left: 6,
          top: 8,
          bottom: 8,
          width: 1,
          background: 'var(--pipe-border)',
        }} />
        
        {stages.map((stage) => {
          const candidateCount = candidates.filter(c => c.currentStageId === stage.id).length;
          return (
            <div
              key={stage.id}
              onClick={() => navigate(`/pipeline/${id}/stage/${stage.id}`)}
              style={{
                display: 'flex',
                gap: 16,
                padding: '12px 0',
                cursor: 'pointer',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '0.7';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
            >
              {/* Timeline dot */}
              <div style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: 'var(--pipe-accent)',
                border: '2px solid var(--pipe-bg)',
                zIndex: 1,
                flexShrink: 0,
              }} />
              
              {/* Stage info */}
              <div>
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--pipe-text)',
                  fontFamily: '"Space Mono", monospace',
                  marginBottom: 2,
                }}>
                  {stage.title}
                </div>
                <div style={{
                  fontSize: 9,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                }}>
                  {candidateCount} people
                </div>
              </div>
            </div>
          );
        })}
        
        {isDraft && (
          <div
            onClick={() => setShowNewStage(true)}
            style={{
              display: 'flex',
              gap: 16,
              padding: '12px 0',
              cursor: 'pointer',
              position: 'relative',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.7';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
          >
            {/* Timeline dot */}
            <div style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#4ade80',
              border: '2px solid var(--pipe-bg)',
              zIndex: 1,
              flexShrink: 0,
            }} />
            
            {/* Add stage text */}
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#4ade80',
              fontFamily: '"Space Mono", monospace',
            }}>
              ADD INTERVIEW
            </div>
          </div>
        )}
      </div>

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

      {showEdit && pipeline && (
        <EditPipelineModal
          initial={{
            title: pipeline.title,
            level: pipeline.level,
            stack: pipeline.stack ?? null,
            description: pipeline.description ?? null,
          }}
          onSave={handleUpdate}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  );
}
