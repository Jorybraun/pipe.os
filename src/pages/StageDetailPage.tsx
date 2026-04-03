import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { FEATURE_FLAGS } from "../config/featureFlags";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Plus, Settings, Video, Mail, ChevronRight, Save } from "lucide-react";
import { LiquidMetalCard, SubTitle } from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { ChallengeCard } from "../components/Pipeline/ChallengeCard";
import { ChallengeBrowserPanel } from "../components/Pipeline/ChallengeBrowserPanel";
import { useStageDetail } from "../hooks/useStageDetail";
import { useStageMutations } from "../hooks/useStageMutations";
import { useChallengeMutations } from "../hooks/useChallengeMutations";
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
  const { updateStage } = useStageMutations();
  const { createChallenge, deleteChallenge, reorderChallenges } =
    useChallengeMutations();

  // Register refetch so StageConfigPanel (in Layout aside) can trigger it
  const { registerRefetch } = useStageRefetch();
  useEffect(() => {
    registerRefetch(refetch);
  }, [registerRefetch, refetch]);

  // Local title state for the inline editable input (mirrors stage.title)
  const [localTitle, setLocalTitle] = useState<string | null>(null);

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

  // ─── Stage mode toggle ────────────────────────────────────────────────────

  const handleModeToggle = useCallback(
    async (mode: "ASYNC" | "LIVE_VIDEO"): Promise<void> => {
      if (!stageId) return;
      try {
        await updateStage(stageId, { mode });
        await refetch();
      } catch (err) {
        console.error("[StageDetailPage] Failed to update mode:", err);
      }
    },
    [stageId, updateStage, refetch],
  );

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

        <div style={{ display: "flex", gap: 12 }}>
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
          <SubTitle>CHALLENGES ({challenges.length})</SubTitle>

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
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Email Templates Section */}
          <LiquidMetalCard variant="chrome" style={{ padding: 24 }}>
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

          <LiquidMetalCard variant="chrome" style={{ padding: 24 }}>
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

              {/* STAGE_MODE — ASYNC (default) or LIVE_VIDEO — gated behind FEATURE_FLAG_LIVE_VIDEO */}
              {FEATURE_FLAGS.FEATURE_FLAG_LIVE_VIDEO && (
                <div
                  style={{
                    borderTop: "1px solid var(--pipe-border-light)",
                    paddingTop: 20,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 9,
                      color: "var(--pipe-text-dim)",
                      marginBottom: 12,
                      fontFamily: "Space Mono",
                    }}
                  >
                    <Video size={12} />
                    STAGE_MODE
                  </label>
                  <div
                    style={{
                      display: "flex",
                      gap: 0,
                      border: "1px solid var(--pipe-border)",
                      borderRadius: 4,
                      overflow: "hidden",
                    }}
                  >
                    {(["ASYNC", "LIVE_VIDEO"] as const).map((m) => {
                      const isActive = (stage.mode ?? "ASYNC") === m;
                      return (
                        <button
                          key={m}
                          onClick={() => void handleModeToggle(m)}
                          style={{
                            flex: 1,
                            padding: "8px 0",
                            background: isActive
                              ? "var(--pipe-surface-hover)"
                              : "transparent",
                            border: "none",
                            color: isActive ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: "0.12em",
                            fontFamily: "Space Mono",
                            cursor: isActive ? "default" : "pointer",
                            transition: "background 0.15s, color 0.15s",
                          }}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </LiquidMetalCard>
        </aside>
      </div>

    </div>
  );
}
