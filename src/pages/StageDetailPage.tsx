import { useState, useCallback } from "react";
import { FEATURE_FLAGS } from "../config/featureFlags";
import { useParams, useNavigate } from "react-router-dom";
import { Plus, Settings, Video, Mail, ChevronRight, Save } from "lucide-react";
import { LiquidMetalCard, SubTitle } from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { ChallengeCard } from "../components/Pipeline/ChallengeCard";
import { ChallengePicker } from "../components/Pipeline/ChallengePicker";
import type { ChallengeSelection } from "../types/challengeSelection";
import { useStageDetail } from "../hooks/useStageDetail";
import { useStageMutations } from "../hooks/useStageMutations";
import { useChallengeMutations } from "../hooks/useChallengeMutations";
import { useAuth as useClerkAuth } from "@clerk/react";
import { createApiClient } from "../lib/api/client";
import type { NotificationTemplate, ChallengeItem } from "../lib/api/types";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

/**
 * StageDetailPage — manages challenges and settings for a pipeline stage.
 *
 * All data is loaded from the Cloudflare Worker API. No aws-amplify imports.
 */
export default function StageDetailPage(): JSX.Element {
  const { id, stageId } = useParams<{ id: string; stageId: string }>();
  const navigate = useNavigate();
  const { getToken } = useClerkAuth();

  const { stage, isLoading, refetch } = useStageDetail(stageId);
  const { updateStage } = useStageMutations();
  const { createChallenge, deleteChallenge, reorderChallenges } =
    useChallengeMutations();

  // Local title state for the inline editable input (mirrors stage.title)
  const [localTitle, setLocalTitle] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);

  // Email Template State
  const [editingTemplate, setEditingTemplate] =
    useState<NotificationTemplate | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Derived title: prefer local edit state, then server data
  const displayTitle =
    localTitle !== null ? localTitle : (stage?.title ?? "");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // ─── Challenge select handler ────────────────────────────────────────────────

  const handleChallengeSelect = useCallback(
    async (selections: ChallengeSelection[]): Promise<void> => {
      if (!stageId) return;
      setPickerOpen(false);

      const currentCount = stage?.challenges?.length ?? 0;
      let orderOffset = 0;

      for (const sel of selections) {
        const order = currentCount + orderOffset;
        orderOffset++;

        try {
          if (sel.source === "library") {
            const { template } = sel;
            await createChallenge(stageId, {
              type: template.type,
              title: template.title,
              instructions: template.instructions,
              config: template.config as Record<string, unknown>,
              order,
            });
          } else {
            // GitHub PR — create challenge then fire-and-forget diff cache
            const created = await createChallenge(stageId, {
              type: "CODE_REVIEW",
              title: sel.prTitle,
              instructions: sel.prDescription,
              githubRepoUrl: sel.repoUrl,
              githubPrNumber: sel.prNumber,
              githubPrTitle: sel.prTitle,
              githubPrDescription: sel.prDescription,
              order,
            });

            // Fire-and-forget: cache the full diff on the challenge record
            void (async () => {
              try {
                const api = createApiClient({ getToken });
                const result = await api.post<{
                  success: boolean;
                  data?: {
                    diff?: Record<string, unknown>;
                    metadata?: Record<string, unknown>;
                  };
                }>("/api/v1/github/pr", {
                  challengeId: created.id,
                  repoUrl: sel.repoUrl,
                  prNumber: sel.prNumber,
                });

                if (result?.success) {
                  console.log(
                    "[StageDetailPage] Diff cached for challenge",
                    created.id,
                  );
                }
              } catch (cacheErr) {
                console.error(
                  "[StageDetailPage] Failed to cache diff for challenge",
                  created.id,
                  cacheErr,
                );
              }
            })();
          }
        } catch (err) {
          console.error("[StageDetailPage] Failed to add challenge:", err);
        }
      }

      await refetch();
    },
    [stageId, stage?.challenges?.length, createChallenge, getToken, refetch],
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

  const handleDragEnd = useCallback(
    async (event: DragEndEvent): Promise<void> => {
      const { active, over } = event;
      if (!over || active.id === over.id || !stage) return;

      const oldIndex = stage.challenges.findIndex((c) => c.id === active.id);
      const newIndex = stage.challenges.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(stage.challenges, oldIndex, newIndex).map(
        (c, i) => ({ ...c, order: i }),
      );

      // Optimistically update local state via refetch after API call
      try {
        await reorderChallenges(
          stageId!,
          reordered.map((c) => ({ id: c.id, order: c.order })),
        );
        await refetch();
      } catch (err) {
        console.error("[StageDetailPage] Failed to reorder challenges:", err);
        await refetch(); // Revert to server state
      }
    },
    [stage, stageId, reorderChallenges, refetch],
  );

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
    return <div style={{ padding: 40, color: "#fff" }}>Stage not found.</div>;
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
                color: "rgba(255,255,255,0.3)",
                marginBottom: 8,
                fontFamily: "Space Mono",
              }}
            >
              PIPELINE_STAGE / {stage.id.substring(0, 8)}
            </div>
            <input
              data-testid="stage-title-input"
              value={displayTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={() => void handleTitleBlur()}
              placeholder="Stage Title"
              style={{
                background: "transparent",
                border: "none",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                fontSize: 24,
                fontWeight: 800,
                color: "#fff",
                margin: 0,
                padding: "4px 0",
                outline: "none",
                width: "100%",
                minWidth: 300,
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => setPickerOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 24px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              color: "#fff",
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

          {challenges.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => void handleDragEnd(e)}
            >
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
            </DndContext>
          ) : (
            <div
              style={{
                marginTop: 20,
                padding: "60px 24px",
                textAlign: "center",
                border: "1px dashed rgba(255,255,255,0.05)",
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  color: "rgba(255,255,255,0.2)",
                  fontSize: 12,
                  marginBottom: 24,
                }}
              >
                No challenges added to this stage yet.
              </div>
              <button
                onClick={() => setPickerOpen(true)}
                style={{
                  padding: "10px 20px",
                  background: "#fff",
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
              <Mail size={14} color="rgba(255,255,255,0.4)" />
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  fontWeight: 700,
                  color: "#fff",
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
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
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
                        color: isEditing ? "#fff" : "rgba(255,255,255,0.5)",
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
                              color: "rgba(255,255,255,0.3)",
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
                              border: "1px solid rgba(255,255,255,0.1)",
                              color: "#fff",
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
                              color: "rgba(255,255,255,0.3)",
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
                              border: "1px solid rgba(255,255,255,0.1)",
                              color: "#fff",
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
                              background: "#fff",
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
                              background: "rgba(255,255,255,0.05)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              color: "rgba(255,255,255,0.5)",
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
                            color: "rgba(255,255,255,0.2)",
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
              <Settings size={14} color="rgba(255,255,255,0.4)" />
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  fontWeight: 700,
                  color: "#fff",
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
                    color: "rgba(255,255,255,0.3)",
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
                      border: "1px solid rgba(255,255,255,0.1)",
                      padding: "8px 12px",
                      color: "#fff",
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
                    borderTop: "1px solid rgba(255,255,255,0.05)",
                    paddingTop: 20,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 9,
                      color: "rgba(255,255,255,0.3)",
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
                      border: "1px solid rgba(255,255,255,0.1)",
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
                              ? "rgba(255,255,255,0.12)"
                              : "transparent",
                            border: "none",
                            color: isActive ? "#fff" : "rgba(255,255,255,0.3)",
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

      <ChallengePicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(selections) => void handleChallengeSelect(selections)}
      />
    </div>
  );
}
