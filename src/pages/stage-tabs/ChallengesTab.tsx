/**
 * ChallengesTab — index route under /pipeline/:id/stage/:stageId.
 *
 * Renders the challenge list with drag-and-drop reordering and multi-select
 * deletion. Clicking ADD_CHALLENGE expands the InlineChallengeAdder inline
 * inside the SectionCard — the sidebar drawer has been removed.
 */

import { useCallback, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, CheckSquare, Square, X, PhoneCall, Video, Calendar } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ChallengeCard } from '../../components/Pipeline/ChallengeCard';
import { InlineChallengeAdder } from '../../components/Pipeline/InlineChallengeAdder';
import { ChallengeWizard } from '../../components/Pipeline/ChallengeWizard';
import { useChallengeMutations } from '../../hooks/useChallengeMutations';
import { SectionCard } from '../../components';
import type { ChallengeItem } from '../../lib/api/types';
import type { StagePanelContext } from '../StagePanel';

export default function ChallengesTab(): JSX.Element {
  const { shell, stage, stageId, refetchStage } =
    useOutletContext<StagePanelContext>();
  const navigate = useNavigate();
  const { deleteChallenge, reorderChallenges } = useChallengeMutations();

  const [searchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeDrag, setActiveDrag] = useState<{ title: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(() => searchParams.get('adder') === '1');

  const challenges = [...(stage.challenges ?? [])]
    .filter((c) => c !== null)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const toggleSelect = useCallback((cid: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  }, []);

  const clearSelection = useCallback((): void => {
    setSelectedIds(new Set());
  }, []);

  // ─── DnD (reorder only — template drag removed with browser panel) ─────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = useCallback((event: DragStartEvent): void => {
    const data = event.active.data.current;
    setActiveDrag({ title: String(data?.title ?? 'Challenge') });
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent): Promise<void> => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = challenges.findIndex((c) => c.id === active.id);
      const newIndex = challenges.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(challenges, oldIndex, newIndex).map(
        (c, i) => ({ ...c, order: i }),
      );
      try {
        await reorderChallenges(
          stageId,
          reordered.map((c) => ({ id: c.id, order: c.order })),
        );
        await refetchStage();
      } catch (err) {
        console.error('[ChallengesTab] Failed to reorder:', err);
        await refetchStage();
      }
    },
    [challenges, stageId, reorderChallenges, refetchStage],
  );

  const handleDelete = useCallback(
    async (challenge: ChallengeItem): Promise<void> => {
      if (!window.confirm('Delete this challenge?')) return;
      try {
        await deleteChallenge(challenge.id);
        await refetchStage();
      } catch (err) {
        console.error('[ChallengesTab] Failed to delete challenge:', err);
      }
    },
    [deleteChallenge, refetchStage],
  );

  const handleBatchDelete = useCallback(async (): Promise<void> => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Delete ${count} challenge${count > 1 ? 's' : ''}?`))
      return;
    setIsDeleting(true);
    try {
      for (const cid of selectedIds) {
        await deleteChallenge(cid);
      }
      setSelectedIds(new Set());
      await refetchStage();
    } catch (err) {
      console.error('[ChallengesTab] Batch delete failed:', err);
      await refetchStage();
    } finally {
      setIsDeleting(false);
    }
  }, [selectedIds, deleteChallenge, refetchStage]);

  return (
    <div data-testid="stage-tab-content-challenges">
      <SectionCard
        label="CHALLENGES"
        icon={<Plus size={16} color="var(--pipe-text-dim)" />}
        meta={
          showAddForm ? (
            <button
              onClick={() => setShowAddForm(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                background: 'transparent',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text-dim)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.15em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
              }}
            >
              <X size={11} />
              CLOSE
            </button>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.15em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
              }}
            >
              <Plus size={11} />
              EDIT_STAGE
            </button>
          )
        }
      >
        {/* Challenge adder — ChallengeWizard for non-SCREENING, legacy adder for SCREENING */}
        {showAddForm && (
          stage.stageType === 'SCREENING' ? (
            <InlineChallengeAdder
              stageId={stageId}
              onClose={() => {
                setShowAddForm(false);
                void refetchStage();
              }}
            />
          ) : (
            <ChallengeWizard
              stageId={stageId}
              roleContextId={shell.roleContext?.id ?? null}
              persona={shell.roleContext?.persona ?? null}
              onClose={() => {
                setShowAddForm(false);
                void refetchStage();
              }}
            />
          )
        )}

        {/* Selection toolbar */}
        {selectedIds.size > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              marginBottom: 12,
              marginTop: showAddForm ? 16 : 0,
              background: 'rgba(248,113,113,0.06)',
              border: '1px solid rgba(248,113,113,0.15)',
              borderRadius: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => {
                  if (selectedIds.size === challenges.length) clearSelection();
                  else setSelectedIds(new Set(challenges.map((c) => c.id)));
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--pipe-text-muted)',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                }}
                title={
                  selectedIds.size === challenges.length
                    ? 'Deselect all'
                    : 'Select all'
                }
              >
                {selectedIds.size === challenges.length ? (
                  <CheckSquare size={14} />
                ) : (
                  <Square size={14} />
                )}
              </button>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontFamily: '"Space Mono", monospace',
                  color: '#f87171',
                }}
              >
                {selectedIds.size} SELECTED
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => void handleBatchDelete()}
                disabled={isDeleting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  background: 'rgba(248,113,113,0.12)',
                  border: '1px solid rgba(248,113,113,0.25)',
                  borderRadius: 4,
                  color: '#f87171',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: isDeleting ? 'wait' : 'pointer',
                  opacity: isDeleting ? 0.5 : 1,
                }}
              >
                <Trash2 size={11} />
                {isDeleting ? 'DELETING...' : 'DELETE'}
              </button>
              <button
                onClick={clearSelection}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--pipe-text-dim)',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Clear selection"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          {challenges.length > 0 ? (
            <SortableContext
              items={challenges.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <div style={{ marginTop: showAddForm ? 16 : 0 }}>
                {challenges.map((c, i) => (
                  <ChallengeCard
                    key={c.id}
                    challenge={c}
                    index={i}
                    isSelected={selectedIds.has(c.id)}
                    multiSelect={selectedIds.size > 0}
                    onClick={() => toggleSelect(c.id)}
                    onEdit={(challenge) =>
                      navigate(
                        `/pipeline/${shell.pipelineId}/challenges/${challenge.id}`,
                      )
                    }
                    onDelete={(challenge) =>
                      void handleDelete(challenge as ChallengeItem)
                    }
                  />
                ))}
              </div>
            </SortableContext>
          ) : !showAddForm ? (
            (() => {
              const fmt = stage.screeningFormat;
              const isCall = fmt === 'PHONE_CALL' || fmt === 'VIDEO_CALL';
              if (isCall) {
                const Icon = fmt === 'PHONE_CALL' ? PhoneCall : Video;
                const accentColor = fmt === 'PHONE_CALL' ? '#60a5fa' : '#a78bfa';
                const accentBg =
                  fmt === 'PHONE_CALL'
                    ? 'rgba(96,165,250,0.06)'
                    : 'rgba(167,139,250,0.06)';
                const accentBorder =
                  fmt === 'PHONE_CALL'
                    ? 'rgba(96,165,250,0.2)'
                    : 'rgba(167,139,250,0.2)';
                return (
                  <div
                    style={{
                      padding: '24px',
                      background: accentBg,
                      border: `1px solid ${accentBorder}`,
                      borderRadius: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 16,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Icon size={16} color={accentColor} />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '0.12em',
                          color: accentColor,
                          fontFamily: '"Space Mono", monospace',
                        }}
                      >
                        {fmt === 'PHONE_CALL' ? 'PHONE_SCREENING' : 'VIDEO_SCREENING'}
                      </span>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 10,
                        color: 'var(--pipe-text-muted)',
                        fontFamily: '"Space Mono", monospace',
                        lineHeight: 1.6,
                      }}
                    >
                      {fmt === 'PHONE_CALL'
                        ? 'Recruiter calls the candidate through the app. The call is recorded and transcribed automatically.'
                        : 'Schedule a live video meeting. The recruiter and candidate join a video room in the browser.'}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Calendar size={11} color="var(--pipe-text-dim)" />
                      <span
                        style={{
                          fontSize: 9,
                          color: 'var(--pipe-text-dim)',
                          fontFamily: '"Space Mono", monospace',
                          letterSpacing: '0.08em',
                        }}
                      >
                        {stage.isScheduled
                          ? 'SCHEDULING_LINK — candidate books a time slot'
                          : 'NO_SCHEDULING — recruiter initiates directly'}
                      </span>
                    </div>
                  </div>
                );
              }
              return (
                <div
                  style={{
                    padding: '60px 24px',
                    textAlign: 'center',
                    border: '1px dashed var(--pipe-border-light)',
                    borderRadius: 12,
                  }}
                >
                  <div
                    style={{
                      color: 'var(--pipe-text-dim)',
                      fontSize: 12,
                      marginBottom: 24,
                      fontFamily: '"Space Mono", monospace',
                      letterSpacing: '0.05em',
                    }}
                  >
                    No challenges added to this stage yet.
                  </div>
                  <button
                    onClick={() => setShowAddForm(true)}
                    style={{
                      padding: '10px 20px',
                      background: 'var(--pipe-text)',
                      color: 'var(--pipe-bg)',
                      border: '1px solid var(--pipe-text)',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '0.15em',
                      fontFamily: '"Space Mono", monospace',
                      cursor: 'pointer',
                    }}
                  >
                    + ADD_FIRST_CHALLENGE
                  </button>
                </div>
              );
            })()
          ) : null}

          <DragOverlay
            dropAnimation={{
              sideEffects: defaultDropAnimationSideEffects({
                styles: { active: { opacity: '0.5' } },
              }),
            }}
          >
            {activeDrag && (
              <div
                style={{
                  padding: '12px 16px',
                  background: 'rgba(12, 12, 14, 0.95)',
                  border: '1px solid rgba(167,139,250,0.3)',
                  borderRadius: 8,
                  color: '#a78bfa',
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.08em',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                }}
              >
                {activeDrag.title}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </SectionCard>
    </div>
  );
}
