import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Plus, Settings, Mail, ChevronRight, Save, Trash2, CheckSquare, Square, X, Users, Clock, CheckCircle } from "lucide-react";
import { LiquidMetalCard, SubTitle } from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { ChallengeCard } from "../components/Pipeline/ChallengeCard";
import { ChallengeBrowserPanel } from "../components/Pipeline/ChallengeBrowserPanel";
import { useStageDetail } from "../hooks/useStageDetail";
import { useOverviewData } from "../hooks/useOverviewData";
import { useStageMutations } from "../hooks/useStageMutations";
import { useChallengeMutations } from "../hooks/useChallengeMutations";
import { useCandidateMutations } from "../hooks/useCandidateMutations";
import { CandidateIntakeModal } from "../components/Candidate/CandidateIntakeModal";
import type { NotificationTemplate, ChallengeItem } from "../lib/api/types";
import { useSidebarPortal } from "../contexts/SidebarPortalContext";
import { useStageRefetch } from "../contexts/StageRefetchContext";
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
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ChallengeTemplate } from "../content/challengeLibrary";

/**
 * StageDetailPage — manages challenges and settings for a pipeline stage.
 *
 * All data is loaded from the Cloudflare Worker API. No aws-amplify imports.
 */
export default function StageDetailPage(): JSX.Element {
  const { id, stageId } = useParams<{ id: string; stageId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const toggleChallengePanel = useCallback((): void => {
    const loc = location.pathname;
    if (loc.endsWith('/challenges')) {
      navigate(loc.replace(/\/challenges$/, ''), { replace: true });
    } else {
      navigate(`${loc}/challenges`, { replace: true });
    }
  }, [location.pathname, navigate]);

  const { stage, isLoading, refetch } = useStageDetail(stageId);
  const { candidates: allCandidates, refetch: refetchOverview } = useOverviewData(id);
  const { updateStage } = useStageMutations();
  const { createChallenge, deleteChallenge, reorderChallenges } =
    useChallengeMutations();
  const { deleteCandidate } = useCandidateMutations();

  // Register refetch so StageConfigPanel (in Layout aside) can trigger it
  const { registerRefetch } = useStageRefetch();
  useEffect(() => {
    registerRefetch(refetch);
  }, [registerRefetch, refetch]);

  // Local title state for the inline editable input (mirrors stage.title)
  const [localTitle, setLocalTitle] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'challenges' | 'candidates'>('challenges');

  // Add candidate modal
  const [showAddCandidate, setShowAddCandidate] = useState(false);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const toggleSelect = useCallback((id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback((): void => {
    setSelectedIds(new Set());
  }, []);

  // Email Template State
  const [editingTemplate, setEditingTemplate] =
    useState<NotificationTemplate | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Derived title: prefer local edit state, then server data
  const displayTitle =
    localTitle !== null ? localTitle : (stage?.title ?? "");

  // ─── Sidebar portal for challenge browser ──────────────────────────────────

  const { portalNode, openPortal, closePortal, isPortalOpen } = useSidebarPortal();
  const challengePanelOpen = location.pathname.endsWith('/challenges');

  // Sync portal open/close with route
  useEffect(() => {
    if (challengePanelOpen && !isPortalOpen) openPortal();
    if (!challengePanelOpen && isPortalOpen) closePortal();
  }, [challengePanelOpen, isPortalOpen, openPortal, closePortal]);

  // Clean up portal on unmount
  useEffect(() => {
    return () => closePortal();
  }, [closePortal]);

  // ─── DnD sensors and handlers ─────────────────────────────────────────────

  const [activeDrag, setActiveDrag] = useState<{ title: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = useCallback((event: DragStartEvent): void => {
    const data = event.active.data.current;
    if (data?.type === 'template') {
      setActiveDrag({ title: (data.template as ChallengeTemplate).title });
    } else {
      setActiveDrag({ title: String(data?.title ?? 'Challenge') });
    }
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent): Promise<void> => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over || !stage || !stageId) return;

      const activeType = active.data.current?.type as string;

      if (activeType === 'template') {
        // Add new challenge from sidebar
        const template = active.data.current?.template as ChallengeTemplate;
        const challenges = stage.challenges;
        let insertIndex = challenges.length;
        const overIndex = challenges.findIndex((c) => c.id === over.id);
        if (overIndex >= 0) insertIndex = overIndex + 1;

        await createChallenge(stageId, {
          type: template.type,
          title: template.title,
          instructions: template.instructions,
          config: template.config as Record<string, unknown>,
          order: insertIndex,
        });
        await refetch();
      } else {
        // Reorder existing challenges
        if (active.id === over.id) return;
        const oldIndex = stage.challenges.findIndex((c) => c.id === active.id);
        const newIndex = stage.challenges.findIndex((c) => c.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;

        const reordered = arrayMove(stage.challenges, oldIndex, newIndex).map(
          (c, i) => ({ ...c, order: i }),
        );
        try {
          await reorderChallenges(
            stageId,
            reordered.map((c) => ({ id: c.id, order: c.order })),
          );
          await refetch();
        } catch (err) {
          console.error("[StageDetailPage] Failed to reorder:", err);
          await refetch();
        }
      }
    },
    [stage, stageId, createChallenge, reorderChallenges, refetch],
  );

  // ─── Challenge delete handler ─────────────────────────────────────────────

  const handleChallengeDelete = useCallback(
    async (challenge: ChallengeItem): Promise<void> => {
      if (!window.confirm("Delete this challenge?")) return;
      try {
        await deleteChallenge(challenge.id);
        await refetch();
      } catch (err) {
        console.error("[StageDetailPage] Failed to delete challenge:", err);
      }
    },
    [deleteChallenge, refetch],
  );

  // ─── Batch delete handler ──────────────────────────────────────────────────

  const handleBatchDelete = useCallback(async (): Promise<void> => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Delete ${count} challenge${count > 1 ? 's' : ''}?`)) return;
    setIsDeleting(true);
    try {
      for (const cid of selectedIds) {
        await deleteChallenge(cid);
      }
      setSelectedIds(new Set());
      await refetch();
    } catch (err) {
      console.error("[StageDetailPage] Batch delete failed:", err);
      await refetch();
    } finally {
      setIsDeleting(false);
    }
  }, [selectedIds, deleteChallenge, refetch]);

  // ─── Stage title save (onBlur) ────────────────────────────────────────────

  const handleTitleBlur = useCallback(async (): Promise<void> => {
    if (!stageId || localTitle === null) return;
    const title = localTitle.trim();
    if (!title) return;
    try {
      await updateStage(stageId, { title });
    } catch (err) {
      console.error("[StageDetailPage] Failed to update stage title:", err);
    }
    setLocalTitle(null);
  }, [stageId, localTitle, updateStage]);

  // ─── Email template save ──────────────────────────────────────────────────

  const handleSaveTemplate = useCallback(async (): Promise<void> => {
    if (!stageId || !editingTemplate || !stage) return;
    setIsSavingTemplate(true);
    try {
      const currentTemplates = stage.notificationTemplates ?? [];
      const exists = currentTemplates.find(
        (t) => t.trigger === editingTemplate.trigger,
      );

      const newTemplates = exists
        ? currentTemplates.map((t) =>
            t.trigger === editingTemplate.trigger ? editingTemplate : t,
          )
        : [...currentTemplates, editingTemplate];

      await updateStage(stageId, { notificationTemplates: newTemplates });
      setEditingTemplate(null);
      await refetch();
    } catch (err) {
      console.error("[StageDetailPage] Failed to save template:", err);
    } finally {
      setIsSavingTemplate(false);
    }
  }, [stageId, editingTemplate, stage, updateStage, refetch]);

  // ─── Time limit change ────────────────────────────────────────────────────

  const handleTimeLimitChange = useCallback(
    async (value: string): Promise<void> => {
      if (!stageId) return;
      const timeLimit = value ? parseInt(value, 10) : null;
      try {
        await updateStage(stageId, { timeLimit });
        await refetch();
      } catch (err) {
        console.error("[StageDetailPage] Failed to update time limit:", err);
      }
    },
    [stageId, updateStage, refetch],
  );

  // ─── Drag-and-drop reorder ────────────────────────────────────────────────


  // ─── Loading state ────────────────────────────────────────────────────────

  if (isLoading && !stage) {
    return (
      <div style={{ padding: 40 }}>
        <Skeleton width={200} height={32} style={{ marginBottom: 40 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height={80} />
          ))}
        </div>
      </div>
    );
  }

  if (!stage) {
    return <div style={{ padding: 40, color: "var(--pipe-text, #fff)" }}>Stage not found.</div>;
  }

  const challenges = [...(stage.challenges ?? [])]
    .filter((c) => c !== null)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const triggers: NotificationTemplate["trigger"][] = [
    "INVITATION",
    "SUCCESS",
    "FAILURE",
  ];

  return (
    <div style={{ paddingBottom: 100 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 40,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.2em",
                color: "var(--pipe-text-dim)",
                marginBottom: 8,
                fontFamily: "Space Mono",
              }}
            >
              PIPELINE_STAGE / {stage.id.substring(0, 8)}
            </div>
            <div style={{ position: "relative" }}>
              <span
                data-testid="stage-title-display"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  fontSize: 24,
                  fontWeight: 800,
                  color: "transparent",
                  pointerEvents: "none",
                  userSelect: "none",
                  whiteSpace: "pre",
                  zIndex: -1,
                }}
              >
                {displayTitle}
              </span>
              <input
                data-testid="stage-title-input"
                value={displayTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                onBlur={() => void handleTitleBlur()}
                placeholder="Stage Title"
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--pipe-border)",
                  fontSize: 24,
                  fontWeight: 800,
                  color: "var(--pipe-text, #fff)",
                  margin: 0,
                  padding: "4px 0",
                  outline: "none",
                  width: "100%",
                  minWidth: 300,
                }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, visibility: activeTab === 'challenges' ? 'visible' : 'hidden' }}>
          <button
            onClick={() => toggleChallengePanel()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 24px",
              background: "var(--pipe-surface)",
              border: "1px solid var(--pipe-border)",
              borderRadius: 4,
              color: "var(--pipe-text, #fff)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              fontFamily: "Space Mono",
              cursor: "pointer",
            }}
          >
            <Plus size={14} />
            ADD_CHALLENGE
          </button>
          <button
            onClick={() => {
              const params = new URLSearchParams(window.location.search);
              params.set('config', stageId ?? '');
              navigate(`?${params.toString()}`, { replace: true });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 24px",
              background: "rgba(167,139,250,0.08)",
              border: "1px solid rgba(167,139,250,0.2)",
              borderRadius: 4,
              color: "rgba(167,139,250,0.7)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              fontFamily: "Space Mono",
              cursor: "pointer",
            }}
          >
            <Settings size={14} />
            STAGE_CONFIG
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 40,
          alignItems: "flex-start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Tabs */}
          {(() => {
            const stageCandidates = allCandidates.filter((c) => c.currentStageId === stageId);
            return (
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--pipe-border-light)', marginBottom: 8 }}>
                <button
                  onClick={() => setActiveTab('challenges')}
                  style={{
                    padding: '10px 20px',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === 'challenges' ? '2px solid var(--pipe-text, #fff)' : '2px solid transparent',
                    color: activeTab === 'challenges' ? 'var(--pipe-text, #fff)' : 'var(--pipe-text-dim)',
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: '0.1em',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  CHALLENGES ({challenges.length})
                </button>
                <button
                  onClick={() => setActiveTab('candidates')}
                  style={{
                    padding: '10px 20px',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === 'candidates' ? '2px solid var(--pipe-text, #fff)' : '2px solid transparent',
                    color: activeTab === 'candidates' ? 'var(--pipe-text, #fff)' : 'var(--pipe-text-dim)',
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: '0.1em',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  CANDIDATES ({stageCandidates.length})
                </button>
              </div>
            );
          })()}

          {activeTab === 'challenges' && <>
          {/* Selection toolbar */}
          {selectedIds.size > 0 ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'rgba(248,113,113,0.06)',
              border: '1px solid rgba(248,113,113,0.15)',
              borderRadius: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={() => {
                    if (selectedIds.size === challenges.length) clearSelection();
                    else setSelectedIds(new Set(challenges.map((c) => c.id)));
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--pipe-text-muted)', padding: 4,
                    display: 'flex', alignItems: 'center',
                  }}
                  title={selectedIds.size === challenges.length ? 'Deselect all' : 'Select all'}
                >
                  {selectedIds.size === challenges.length
                    ? <CheckSquare size={14} />
                    : <Square size={14} />}
                </button>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                  fontFamily: '"Space Mono", monospace',
                  color: '#f87171',
                }}>
                  {selectedIds.size} SELECTED
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => void handleBatchDelete()}
                  disabled={isDeleting}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px',
                    background: 'rgba(248,113,113,0.12)',
                    border: '1px solid rgba(248,113,113,0.25)',
                    borderRadius: 4,
                    color: '#f87171',
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
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
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--pipe-text-dim)', padding: 4,
                    display: 'flex', alignItems: 'center',
                  }}
                  title="Clear selection"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            {/* Portal: render ChallengeBrowserPanel into Layout's aside */}
            {challengePanelOpen && portalNode && createPortal(
              <ChallengeBrowserPanel
                onClose={toggleChallengePanel}
                stageId={stageId!}
                challengeCount={challenges.length}
                createChallenge={createChallenge}
                refetch={refetch}
              />,
              portalNode,
            )}

          {/* Video call card for LIVE_VIDEO stages */}
          {stage.mode === 'LIVE_VIDEO' && (
            <div style={{
              marginTop: 20,
              marginBottom: challenges.length > 0 ? 0 : 0,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '14px 18px',
              background: 'rgba(96, 165, 250, 0.06)',
              border: '1px solid rgba(96, 165, 250, 0.15)',
              borderRadius: 8,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 6,
                background: 'rgba(96, 165, 250, 0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <div>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--pipe-text, #fff)',
                  fontFamily: '"Space Mono", monospace', letterSpacing: '0.05em',
                }}>
                  VIDEO CALL
                </div>
                <div style={{
                  fontSize: 10, color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace', marginTop: 2,
                }}>
                  {stage.isScheduled ? 'Scheduled via Calendly' : 'Live video interview'}
                </div>
              </div>
            </div>
          )}

          {challenges.length > 0 ? (
            <SortableContext
              items={challenges.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <div style={{ marginTop: 20 }}>
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
                        `/pipeline/${id}/challenges/${challenge.id}`,
                      )
                    }
                    onDelete={(challenge) =>
                      void handleChallengeDelete(challenge as ChallengeItem)
                    }
                  />
                ))}
              </div>
            </SortableContext>
          ) : (
            <div
              style={{
                marginTop: 20,
                padding: "60px 24px",
                textAlign: "center",
                border: "1px dashed var(--pipe-border-light)",
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  color: "var(--pipe-text-dim)",
                  fontSize: 12,
                  marginBottom: 24,
                }}
              >
                No challenges added to this stage yet.
              </div>
              <button
                onClick={() => toggleChallengePanel()}
                style={{
                  padding: "10px 20px",
                  background: "var(--pipe-text, #fff)",
                  color: "#000",
                  border: "none",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: "Space Mono",
                  cursor: "pointer",
                }}
              >
                + ADD_FIRST_CHALLENGE
              </button>
            </div>
          )}

            <DragOverlay
              dropAnimation={{
                sideEffects: defaultDropAnimationSideEffects({
                  styles: { active: { opacity: "0.5" } },
                }),
              }}
            >
              {activeDrag && (
                <div style={{
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
                }}>
                  {activeDrag.title}
                </div>
              )}
            </DragOverlay>
          </DndContext>
          </>}

          {activeTab === 'candidates' && (() => {
            const stageCandidates = allCandidates.filter((c) => c.currentStageId === stageId);
            const completed = stageCandidates.filter((c) => c.status === 'COMPLETED');
            const pending = stageCandidates.filter((c) => c.status !== 'COMPLETED');

            const addCandidateBtn = (
              <button
                onClick={() => setShowAddCandidate(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 14px', background: 'rgba(255,255,255,0.03)',
                  border: '1px dashed var(--pipe-border-light)', borderRadius: 6,
                  color: 'var(--pipe-text-dim)', fontSize: 10, fontWeight: 700,
                  fontFamily: '"Space Mono", monospace', letterSpacing: '0.08em',
                  cursor: 'pointer', width: '100%',
                }}
              >
                <Plus size={12} /> ADD CANDIDATE
              </button>
            );

            if (stageCandidates.length === 0) {
              return (
                <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {addCandidateBtn}
                  <div style={{
                    padding: '40px 24px', textAlign: 'center',
                    border: '1px dashed var(--pipe-border-light)', borderRadius: 12,
                  }}>
                    <Users size={24} color="var(--pipe-text-dim)" style={{ marginBottom: 12 }} />
                    <div style={{ color: 'var(--pipe-text-dim)', fontSize: 12 }}>
                      No candidates in this stage yet.
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {addCandidateBtn}
                {completed.length > 0 && (
                  <>
                    <div style={{
                      fontSize: 9, letterSpacing: '0.15em', color: '#4ade80',
                      fontFamily: '"Space Mono", monospace', fontWeight: 700, marginBottom: 4,
                    }}>
                      SUBMITTED ({completed.length})
                    </div>
                    {completed.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '10px 14px',
                          background: 'rgba(74, 222, 128, 0.04)',
                          border: '1px solid rgba(74, 222, 128, 0.12)',
                          borderRadius: 6,
                        }}
                      >
                        <div
                          onClick={() => navigate(`/candidates/${c.id}`)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}
                        >
                          <CheckCircle size={13} color="#4ade80" />
                          <span style={{
                            fontSize: 11, fontWeight: 600, color: 'var(--pipe-text, #fff)',
                            fontFamily: '"Space Mono", monospace',
                          }}>
                            {c.name ?? c.email ?? 'Unknown'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {c.score !== null && (
                            <span style={{
                              fontSize: 11, fontWeight: 700, color: '#4ade80',
                              fontFamily: '"Space Mono", monospace',
                            }}>
                              {Math.round(c.score)}%
                            </span>
                          )}
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Remove ${c.name ?? c.email ?? 'this candidate'}?`)) return;
                              await deleteCandidate(c.id);
                              await refetchOverview();
                            }}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--pipe-text-dim)', padding: 4,
                              display: 'flex', alignItems: 'center',
                              opacity: 0.5, transition: 'opacity 0.2s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#f87171'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--pipe-text-dim)'; }}
                            title="Remove candidate"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {pending.length > 0 && (
                  <>
                    <div style={{
                      fontSize: 9, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace', fontWeight: 700,
                      marginTop: completed.length > 0 ? 12 : 0, marginBottom: 4,
                    }}>
                      PENDING ({pending.length})
                    </div>
                    {pending.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '10px 14px',
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: '1px solid var(--pipe-border-light)',
                          borderRadius: 6,
                        }}
                      >
                        <div
                          onClick={() => navigate(`/candidates/${c.id}`)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}
                        >
                          <Clock size={13} color="var(--pipe-text-dim)" />
                          <span style={{
                            fontSize: 11, fontWeight: 600, color: 'var(--pipe-text-muted)',
                            fontFamily: '"Space Mono", monospace',
                          }}>
                            {c.name ?? c.email ?? 'Unknown'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{
                            fontSize: 9, color: 'var(--pipe-text-dim)',
                            fontFamily: '"Space Mono", monospace',
                          }}>
                            {c.status === 'INVITED' ? 'INVITED' : 'IN PROGRESS'}
                          </span>
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Remove ${c.name ?? c.email ?? 'this candidate'}?`)) return;
                              await deleteCandidate(c.id);
                              await refetchOverview();
                            }}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--pipe-text-dim)', padding: 4,
                              display: 'flex', alignItems: 'center',
                              opacity: 0.5, transition: 'opacity 0.2s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#f87171'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--pipe-text-dim)'; }}
                            title="Remove candidate"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })()}
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Email Templates Section */}
          <LiquidMetalCard style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 20,
              }}
            >
              <Mail size={14} color="var(--pipe-text-dim)" />
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  fontWeight: 700,
                  color: "var(--pipe-text, #fff)",
                  fontFamily: "Space Mono",
                }}
              >
                EMAIL_TEMPLATES
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {triggers.map((trigger) => {
                const isEditing = editingTemplate?.trigger === trigger;
                const hasTemplate = (stage.notificationTemplates ?? []).some(
                  (t) => t.trigger === trigger,
                );

                return (
                  <div
                    key={trigger}
                    style={{
                      borderBottom: "1px solid var(--pipe-border-light)",
                      paddingBottom: 12,
                    }}
                  >
                    <button
                      onClick={() => {
                        const existing = (stage.notificationTemplates ?? []).find(
                          (t) => t.trigger === trigger,
                        );
                        setEditingTemplate(
                          existing ?? { trigger, subject: "", body: "" },
                        );
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "transparent",
                        border: "none",
                        color: isEditing ? "var(--pipe-text, #fff)" : "var(--pipe-text-muted)",
                        fontSize: 9,
                        fontWeight: 700,
                        fontFamily: "Space Mono",
                        cursor: "pointer",
                        padding: "8px 0",
                      }}
                    >
                      <span>
                        {trigger}{" "}
                        {hasTemplate && (
                          <span style={{ color: "#4ade80", marginLeft: 4 }}>
                            ●
                          </span>
                        )}
                      </span>
                      <ChevronRight
                        size={12}
                        style={{
                          transform: isEditing ? "rotate(90deg)" : "none",
                          transition: "transform 0.2s",
                        }}
                      />
                    </button>

                    {isEditing && editingTemplate && (
                      <div
                        style={{
                          marginTop: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <div>
                          <label
                            style={{
                              fontSize: 8,
                              color: "var(--pipe-text-dim)",
                              display: "block",
                              marginBottom: 4,
                            }}
                          >
                            SUBJECT
                          </label>
                          <input
                            data-testid="template-subject-input"
                            value={editingTemplate.subject}
                            onChange={(e) =>
                              setEditingTemplate({
                                ...editingTemplate,
                                subject: e.target.value,
                              })
                            }
                            style={{
                              width: "100%",
                              background: "rgba(0,0,0,0.2)",
                              border: "1px solid var(--pipe-border)",
                              color: "var(--pipe-text, #fff)",
                              padding: "6px 8px",
                              fontSize: 11,
                              fontFamily: "Space Mono",
                            }}
                          />
                        </div>
                        <div>
                          <label
                            style={{
                              fontSize: 8,
                              color: "var(--pipe-text-dim)",
                              display: "block",
                              marginBottom: 4,
                            }}
                          >
                            BODY (HTML)
                          </label>
                          <textarea
                            data-testid="template-body-input"
                            value={editingTemplate.body}
                            onChange={(e) =>
                              setEditingTemplate({
                                ...editingTemplate,
                                body: e.target.value,
                              })
                            }
                            style={{
                              width: "100%",
                              minHeight: 100,
                              background: "rgba(0,0,0,0.2)",
                              border: "1px solid var(--pipe-border)",
                              color: "var(--pipe-text, #fff)",
                              padding: "6px 8px",
                              fontSize: 11,
                              fontFamily: "Space Mono",
                              resize: "vertical",
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => void handleSaveTemplate()}
                            disabled={isSavingTemplate}
                            style={{
                              flex: 1,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                              padding: "8px",
                              background: "var(--pipe-text, #fff)",
                              color: "#000",
                              border: "none",
                              borderRadius: 4,
                              fontSize: 9,
                              fontWeight: 800,
                              fontFamily: "Space Mono",
                              cursor: "pointer",
                            }}
                          >
                            <Save size={12} />
                            {isSavingTemplate ? "SAVING..." : "SAVE_TEMPLATE"}
                          </button>
                          <button
                            onClick={() => setEditingTemplate(null)}
                            style={{
                              padding: "8px 12px",
                              background: "var(--pipe-surface)",
                              border: "1px solid var(--pipe-border)",
                              color: "var(--pipe-text-muted)",
                              fontSize: 9,
                              fontFamily: "Space Mono",
                              cursor: "pointer",
                            }}
                          >
                            CANCEL
                          </button>
                        </div>
                        <p
                          style={{
                            fontSize: 8,
                            color: "var(--pipe-text-dim)",
                            lineHeight: 1.4,
                          }}
                        >
                          Available tags: <br />
                          <code>{"{{name}}"}</code>,{" "}
                          <code>{"{{pipelineName}}"}</code>,{" "}
                          <code>{"{{bookingUrl}}"}</code>
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </LiquidMetalCard>

          <LiquidMetalCard style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 20,
              }}
            >
              <Settings size={14} color="var(--pipe-text-dim)" />
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  fontWeight: 700,
                  color: "var(--pipe-text, #fff)",
                  fontFamily: "Space Mono",
                }}
              >
                STAGE_SETTINGS
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 9,
                    color: "var(--pipe-text-dim)",
                    marginBottom: 8,
                    fontFamily: "Space Mono",
                  }}
                >
                  DEFAULT_TIME_LIMIT (MINS)
                </label>
                <div style={{ display: "flex", gap: 12 }}>
                  <input
                    data-testid="stage-time-limit-input"
                    type="number"
                    defaultValue={stage.timeLimit ?? ""}
                    key={`time-limit-${stage.id}`}
                    onBlur={async (e) => {
                      await handleTimeLimitChange(e.target.value);
                    }}
                    placeholder="Untimed"
                    style={{
                      flex: 1,
                      background: "rgba(0,0,0,0.2)",
                      border: "1px solid var(--pipe-border)",
                      padding: "8px 12px",
                      color: "var(--pipe-text, #fff)",
                      fontSize: 13,
                      outline: "none",
                      fontFamily: "Space Mono",
                    }}
                  />
                </div>
              </div>

            </div>
          </LiquidMetalCard>
        </aside>
      </div>

      {showAddCandidate && id && (
        <CandidateIntakeModal
          pipelineId={id}
          stageId={stageId}
          onClose={() => setShowAddCandidate(false)}
          onSuccess={() => {
            setShowAddCandidate(false);
            void refetchOverview();
          }}
        />
      )}
    </div>
  );
}
