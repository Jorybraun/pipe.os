/**
 * KanbanPage — /pipeline/:id/kanban.
 *
 * The horizontally-scrolling stage-and-candidate board that used to be the
 * default /pipeline/:id view. Lifted out of OverviewPage so the shell can
 * default to the insights panel instead.
 *
 * Reuses useOverviewData / useStageMutations / useCandidateMutations — the
 * drag/reorder wiring is unchanged from the original implementation.
 *
 * The trailing "Add Stage" column has been removed; stage creation now lives
 * at /pipeline/:id/new-stage.
 */

import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  Activity,
  CheckCircle,
  Copy,
  GripVertical,
  Mail,
  Target,
  ChevronRight,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LiquidMetalCard } from '../components';
import { Skeleton } from '../components/ui/Skeleton';
import { useOverviewData } from '../hooks/useOverviewData';
import { useStageMutations } from '../hooks/useStageMutations';
import { useCandidateMutations } from '../hooks/useCandidateMutations';
import { usePipelineIngestion, type PipelineIngestionItem } from '../hooks/usePipelineIngestion';
import type { OverviewStage, OverviewCandidate } from '../lib/api/types';

// ─── StageHeaderCard (copied verbatim from the old OverviewPage) ────────────

function StageHeaderCard({
  stage,
  candidates,
  isActive,
  onClick,
}: {
  stage: OverviewStage;
  candidates: OverviewCandidate[];
  isActive: boolean;
  onClick: () => void;
}): JSX.Element {
  const scoredCandidates = candidates.filter(
    (c) => c.score !== undefined && c.score !== null,
  );
  const avgScore =
    scoredCandidates.length > 0
      ? Math.round(
          scoredCandidates.reduce((sum, c) => sum + (c.score ?? 0), 0) /
            scoredCandidates.length,
        )
      : null;

  return (
    <LiquidMetalCard
      data-testid="stage-card"
      variant={isActive ? 'chrome' : 'default'}
      hover
      onClick={onClick}
      style={{ padding: 24, cursor: 'pointer' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <FileText
          size={20}
          color={isActive ? 'var(--pipe-text)' : 'var(--pipe-text-dim)'}
        />
        {isActive && <Activity size={16} color="var(--pipe-text-dim)" />}
      </div>

      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.2em',
          color: isActive ? 'var(--pipe-text)' : 'var(--pipe-text-muted)',
          marginBottom: 12,
        }}
      >
        {(stage.title || 'STAGE').toUpperCase()}
      </div>

      {avgScore !== null ? (
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            background:
              'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {avgScore}
        </div>
      ) : (
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            color: 'var(--pipe-text-dim)',
          }}
        >
          —
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          height: 2,
          background: 'var(--pipe-surface)',
        }}
      >
        {avgScore !== null && (
          <div
            style={{
              width: `${avgScore}%`,
              height: '100%',
              background:
                'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))',
            }}
          />
        )}
      </div>
    </LiquidMetalCard>
  );
}

// ─── SortableStage ──────────────────────────────────────────────────────────

function SortableStage({
  id,
  disabled = false,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled, data: { type: 'Stage' } });

  const containerStyle: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    flex: '0 0 320px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    position: 'relative',
    cursor: disabled ? 'default' : 'grab',
  };

  return (
    <div ref={setNodeRef} style={containerStyle} {...listeners}>
      {children}
    </div>
  );
}

// ─── CandidateKanbanCard ────────────────────────────────────────────────────

function CandidateKanbanCard({
  candidate,
  ingestion,
  onClick,
  onRefresh,
  isOverlay = false,
  disabled = false,
}: {
  candidate: OverviewCandidate;
  ingestion?: PipelineIngestionItem | undefined;
  onClick: () => void;
  onRefresh?: (candidateId: string) => Promise<void>;
  isOverlay?: boolean;
  disabled?: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: candidate.id,
    disabled,
    data: { type: 'Candidate', candidate },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    marginBottom: 8,
    cursor: isDragging ? 'grabbing' : 'pointer',
  };

  const rawToken = (candidate.inviteToken || '').replace(/^CLAIMED::/, '');
  const isClaimed = (candidate.inviteToken || '').startsWith('CLAIMED::');

  const handleCopyLink = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const inviteUrl = `${window.location.origin}/assess/${rawToken}`;
      void navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    [rawToken],
  );

  const handleRefresh = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!onRefresh || refreshing) return;
      setRefreshing(true);
      try {
        await onRefresh(candidate.id);
      } finally {
        setRefreshing(false);
      }
    },
    [onRefresh, candidate.id, refreshing],
  );

  const initials = (candidate.name || '')
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const getStatusColor = (): string => {
    if (candidate.status === 'COMPLETED') return '#34d399';
    if (candidate.status === 'IN_PROGRESS') return 'rgba(255, 255, 255, 0.40)';
    return 'rgba(255,255,255,0.2)';
  };

  const statusColor = getStatusColor();

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <LiquidMetalCard
        variant="mercury"
        onClick={onClick}
        style={{
          padding: 0,
          borderRadius: 8,
          position: 'relative',
          overflow: 'hidden',
          boxShadow: isOverlay ? '0 20px 40px rgba(0,0,0,0.4)' : undefined,
          border: isOverlay ? '1px solid rgba(255,255,255,0.3)' : undefined,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <div style={{ width: 4, background: statusColor, opacity: 0.8 }} />
          <div style={{ flex: 1, padding: '12px 16px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 6,
              }}
            >
              <div
                {...listeners}
                style={{ cursor: 'grab', padding: '4px 0' }}
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical size={12} color="var(--pipe-text-dim)" />
              </div>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 800,
                  color: 'var(--pipe-text)',
                }}
              >
                {initials}
              </div>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--pipe-text)',
                  margin: 0,
                  letterSpacing: '0.01em',
                }}
              >
                {(candidate.name || '').toUpperCase()}
              </h3>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <Mail size={10} color="var(--pipe-text-dim)" />
                  <span
                    style={{
                      fontSize: 8,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: 'Space Mono',
                    }}
                  >
                    {(candidate.email || '').toLowerCase()}
                  </span>
                </div>
              </div>
            </div>

            {isClaimed && (
              <div style={{ marginBottom: 6 }}>
                <span
                  data-testid="link-used-badge"
                  style={{
                    display: 'inline-block',
                    fontSize: 8,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                    fontFamily: 'Space Mono',
                    color: '#fbbf24',
                    background: 'rgba(251, 191, 36, 0.1)',
                    border: '1px solid rgba(251, 191, 36, 0.25)',
                    borderRadius: 3,
                    padding: '2px 6px',
                  }}
                >
                  LINK_USED
                </span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Activity size={12} color={statusColor} />
                <div
                  style={{
                    fontSize: 8,
                    fontWeight: 800,
                    color: statusColor,
                    letterSpacing: '0.1em',
                    fontFamily: 'Space Mono',
                  }}
                >
                  {(candidate.status || 'INVITED').toUpperCase()}
                </div>
              </div>

              {/* Enrichment indicator */}
              {ingestion && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background:
                        ingestion.status === 'matched'
                          ? '#10b981'
                          : ingestion.status === 'failed'
                            ? '#f87171'
                            : '#9ca3af',
                    }}
                  />
                  {ingestion.status === 'matched' && ingestion.triangulatedScore !== null && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: '#10b981',
                        fontFamily: 'Space Mono',
                      }}
                    >
                      {Math.round(ingestion.triangulatedScore)}
                    </span>
                  )}
                  {ingestion.status === 'matched' && ingestion.matchPhilosophy && (
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: '#60a5fa',
                        fontFamily: 'Space Mono',
                        letterSpacing: '0.06em',
                        padding: '1px 5px',
                        background: 'rgba(96,165,250,0.08)',
                        border: '1px solid rgba(96,165,250,0.15)',
                        borderRadius: 3,
                      }}
                    >
                      {ingestion.matchPhilosophy.toUpperCase()}
                    </span>
                  )}
                </div>
              )}

              <div
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Target size={12} color="var(--pipe-text-dim)" />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: 'var(--pipe-text)',
                      fontFamily: 'Space Mono',
                    }}
                  >
                    {String(candidate.score ?? 0).padStart(2, '0')}
                  </span>
                </div>
                <ChevronRight size={14} color="var(--pipe-text-dim)" />
              </div>
            </div>
          </div>
          <div
            style={{
              width: 44,
              borderLeft: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.01)',
              gap: 10,
            }}
          >
            <button
              onClick={handleCopyLink}
              title="Copy assessment link"
              style={{
                background: 'transparent',
                border: 'none',
                color: copied ? '#10b981' : 'var(--pipe-text-dim)',
                cursor: 'pointer',
                padding: 4,
                transition: 'all 0.2s ease',
              }}
            >
              {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
            </button>
            <button
              onClick={handleRefresh}
              aria-label="Regenerate invite link"
              data-testid="refresh-candidate"
              title="Regenerate invite link"
              disabled={refreshing}
              style={{
                background: 'transparent',
                border: 'none',
                color: refreshing ? 'rgba(255, 255, 255, 0.40)' : 'var(--pipe-text-dim)',
                cursor: refreshing ? 'wait' : 'pointer',
                padding: 4,
                transition: 'all 0.2s ease',
                animation: refreshing ? 'spin 1s linear infinite' : undefined,
              }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}

// ─── KanbanPage ─────────────────────────────────────────────────────────────

export default function KanbanPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { pipeline, stages, candidates, isLoading, refetch } =
    useOverviewData(id);
  const { reorderStages, deleteStage } = useStageMutations();
  const { updateCandidate, refreshLink } = useCandidateMutations();
  const { items: ingestionItems } = usePipelineIngestion(id);

  const ingestionByCandidate = useMemo(() => {
    const map = new Map<string, PipelineIngestionItem>();
    for (const item of ingestionItems) {
      map.set(item.candidateId, item);
    }
    return map;
  }, [ingestionItems]);

  const [localStages, setLocalStages] = useState<OverviewStage[] | null>(null);
  const [activeCandidate, setActiveCandidate] =
    useState<OverviewCandidate | null>(null);
  const [activeStage, setActiveStage] = useState<OverviewStage | null>(null);

  const displayStages = localStages ?? stages;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleRefreshLink = useCallback(
    async (candidateId: string): Promise<void> => {
      await refreshLink(candidateId);
      await refetch();
    },
    [refreshLink, refetch],
  );

  const handleDeleteStage = async (
    stageId: string,
    stageTitle: string,
  ): Promise<void> => {
    if (
      !window.confirm(`Delete stage "${stageTitle}"? This cannot be undone.`)
    )
      return;
    try {
      await deleteStage(stageId);
      setLocalStages(null);
      await refetch();
    } catch (err) {
      console.error('[KanbanPage] Failed to delete stage:', err);
    }
  };

  const candidatesByStage = useMemo(() => {
    return displayStages.reduce(
      (acc, s) => {
        acc[s.id] = candidates.filter((c) => c.currentStageId === s.id);
        return acc;
      },
      {} as Record<string, OverviewCandidate[]>,
    );
  }, [displayStages, candidates]);

  const handleDragStart = (event: DragStartEvent): void => {
    const activeData = event.active.data.current as
      | { type?: string }
      | undefined;
    if (activeData?.type === 'Candidate') {
      const candidate = candidates.find((c) => c.id === event.active.id);
      if (candidate) setActiveCandidate(candidate);
    } else if (activeData?.type === 'Stage') {
      const stage = displayStages.find((s) => s.id === event.active.id);
      if (stage) setActiveStage(stage);
    }
  };

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event;
    setActiveCandidate(null);
    setActiveStage(null);

    if (!over) return;

    if (
      active.data.current?.type === 'Stage' &&
      over.data.current?.type === 'Stage' &&
      active.id !== over.id
    ) {
      const oldIndex = displayStages.findIndex((s) => s.id === active.id);
      const newIndex = displayStages.findIndex((s) => s.id === over.id);
      const reordered = arrayMove(displayStages, oldIndex, newIndex);
      setLocalStages(reordered);

      if (!id) return;
      try {
        await reorderStages(
          id,
          reordered.map((s, idx) => ({ id: s.id, order: idx })),
        );
      } catch (err) {
        console.error('[KanbanPage] Failed to reorder stages:', err);
        setLocalStages(null);
        await refetch();
      }
      return;
    }

    if (active.data.current?.type === 'Candidate') {
      const candidateId = active.id as string;
      let targetStageId: string | null = null;

      if (over.data.current?.type === 'Stage') {
        targetStageId = over.id as string;
      } else if (over.data.current?.type === 'Candidate') {
        const targetCandidateId = over.id as string;
        for (const [stageId, stageCandidates] of Object.entries(
          candidatesByStage,
        )) {
          if (stageCandidates.some((c) => c.id === targetCandidateId)) {
            targetStageId = stageId;
            break;
          }
        }
      }

      if (targetStageId) {
        try {
          await updateCandidate(candidateId, { currentStageId: targetStageId });
          await refetch();
        } catch (err) {
          console.error('[KanbanPage] Failed to move candidate:', err);
        }
      }
    }
  };

  if (isLoading && !pipeline) {
    return (
      <div style={{ padding: 40 }}>
        <Skeleton width={200} height={32} style={{ marginBottom: 32 }} />
        <div style={{ display: 'flex', gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width={320} height={180} />
          ))}
        </div>
      </div>
    );
  }

  if (!pipeline || !id) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <h2 style={{ color: 'var(--pipe-text)' }}>Pipeline Not Found</h2>
      </div>
    );
  }

  const isDraft = pipeline.status === 'DRAFT';
  const isActivePipeline = pipeline.status === 'ACTIVE';

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={(e) => void handleDragEnd(e)}
    >
      <div style={{ padding: '32px 40px 80px' }}>
        {/* Header row — mirrors PipelineShellPage for visual continuity */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginBottom: 32,
          }}
        >
          <div>
            <button
              onClick={() => navigate(`/pipeline/${id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'transparent',
                border: 'none',
                color: 'var(--pipe-text-dim)',
                fontSize: 10,
                letterSpacing: '0.15em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                padding: 0,
                marginBottom: 12,
              }}
            >
              <ArrowLeft size={12} />
              BACK_TO_OVERVIEW
            </button>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 8,
              }}
            >
              KANBAN_VIEW
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
        </div>

        {/* Board */}
        <div
          data-testid="kanban-board"
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            paddingBottom: 24,
            alignItems: 'flex-start',
          }}
        >
          <SortableContext
            items={displayStages.map((s) => s.id)}
            strategy={horizontalListSortingStrategy}
          >
            {displayStages.map((s) => {
              const stageCandidates = candidatesByStage[s.id] ?? [];
              return (
                <SortableStage key={s.id} id={s.id} disabled={!isDraft}>
                  <div style={{ position: 'relative' }}>
                    <StageHeaderCard
                      stage={s}
                      candidates={stageCandidates}
                      isActive={false}
                      onClick={() => navigate(`/pipeline/${id}/stage/${s.id}`)}
                    />
                    {isDraft && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 10,
                          right: 10,
                        }}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteStage(s.id, s.title ?? 'Stage');
                          }}
                          title="Delete this stage"
                          style={{
                            width: 28,
                            height: 28,
                            background: 'rgba(255,80,80,0.08)',
                            border: '1px solid rgba(255,80,80,0.2)',
                            borderRadius: 6,
                            color: 'rgba(255,100,100,0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      minHeight: 100,
                    }}
                  >
                    {stageCandidates.map((candidate) => (
                      <CandidateKanbanCard
                        key={candidate.id}
                        candidate={candidate}
                        ingestion={ingestionByCandidate.get(candidate.id)}
                        onClick={() => navigate(`/candidates/${candidate.id}`)}
                        onRefresh={handleRefreshLink}
                        disabled={!isActivePipeline}
                      />
                    ))}
                    {stageCandidates.length === 0 && (
                      <div
                        style={{
                          height: 120,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px dashed var(--pipe-border)',
                          borderRadius: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 8,
                            letterSpacing: '0.2em',
                            color: 'var(--pipe-text-dim)',
                          }}
                        >
                          NO CANDIDATES
                        </span>
                      </div>
                    )}
                  </div>
                </SortableStage>
              );
            })}
          </SortableContext>
        </div>
      </div>

      <DragOverlay
        dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: '0.5' } },
          }),
        }}
      >
        {activeCandidate ? (
          <CandidateKanbanCard
            candidate={activeCandidate}
            ingestion={ingestionByCandidate.get(activeCandidate.id)}
            onClick={() => {}}
            isOverlay
          />
        ) : activeStage ? (
          <div style={{ width: 320, opacity: 0.8 }}>
            <StageHeaderCard
              stage={activeStage}
              candidates={candidatesByStage[activeStage.id] ?? []}
              isActive={false}
              onClick={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
