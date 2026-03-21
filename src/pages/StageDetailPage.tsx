import { useState, useEffect, useCallback } from "react";
import { FEATURE_FLAGS } from "../config/featureFlags";
import { useParams } from "react-router-dom";
import {
  Plus,
  Settings,
  Video,
  Mail,
  ChevronRight,
  Save,
} from "lucide-react";
import { LiquidMetalCard, SubTitle } from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { ChallengeCard } from "../components/Pipeline/ChallengeCard";
import { ChallengePicker } from "../components/Pipeline/ChallengePicker";
import type { ChallengeSelection } from "../types/challengeSelection";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { EventTypePicker } from "../components/Scheduling/EventTypePicker";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

const client = generateClient<Schema>();

interface NotificationTemplate {
  trigger: "INVITATION" | "SUCCESS" | "FAILURE";
  subject: string;
  body: string;
}

/**
 * StageDetailPage - Manage challenges within a specific stage.
 */
export default function StageDetailPage(): JSX.Element {
  const { stageId } = useParams<{
    id: string;
    stageId: string;
  }>();

  const [stage, setStage] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modeFieldReady, setModeFieldReady] = useState(false);

  // Email Template State
  const [editingTemplate, setEditingTemplate] =
    useState<NotificationTemplate | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const checkModeField = useCallback(async (stageId: string) => {
    try {
      await client.models.Stage.list({
        filter: { id: { eq: stageId } },
        selectionSet: ["id", "mode"],
      });
      setModeFieldReady(true);
    } catch {
      setModeFieldReady(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (!stageId) return;
    try {
      setIsLoading(true);
      const { data: stages } = modeFieldReady
        ? await client.models.Stage.list({
            filter: { id: { eq: stageId } },
            selectionSet: [
              "id",
              "title",
              "order",
              "timeLimit",
              "mode",
              "challenges.*",
              "schedulingEventTypeId",
              "notificationTemplates",
            ],
          })
        : await client.models.Stage.list({
            filter: { id: { eq: stageId } },
            selectionSet: [
              "id",
              "title",
              "order",
              "timeLimit",
              "challenges.*",
              "notificationTemplates",
            ],
          });

      const data = stages[0];
      if (data) {
        // Parse templates if they are stored as JSON string
        const templates =
          typeof data.notificationTemplates === "string"
            ? JSON.parse(data.notificationTemplates)
            : data.notificationTemplates || [];
        setStage({ ...data, notificationTemplates: templates });
      }
    } catch (err) {
      console.error("[StageDetail] Error fetching stage:", err);
    } finally {
      setIsLoading(false);
    }
  }, [stageId, modeFieldReady]);

  useEffect(() => {
    if (stageId) void checkModeField(stageId);
  }, [stageId, checkModeField]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleChallengeSelect = async (selections: ChallengeSelection[]) => {
    if (!stageId) return;
    setPickerOpen(false);
    setIsLoading(true);
    try {
      const currentCount = stage?.challenges?.length || 0;
      let orderOffset = 0;
      for (const sel of selections) {
        const order = currentCount + orderOffset;
        orderOffset++;

        if (sel.source === 'library') {
          const { template } = sel;
          await client.models.Challenge.create({
            stageId,
            type: template.type,
            title: template.title,
            instructions: template.instructions,
            config: JSON.stringify(template.config),
            order,
          });
        } else {
          // GitHub PR — create challenge then fire-and-forget diff cache
          const { data: created, errors } = await client.models.Challenge.create({
            stageId,
            type: 'CODE_REVIEW',
            title: sel.prTitle,
            instructions: sel.prDescription,
            githubRepoUrl: sel.repoUrl,
            githubPrNumber: sel.prNumber,
            githubPrTitle: sel.prTitle,
            githubPrDescription: sel.prDescription,
            order,
          });

          if (errors) {
            console.error('[StageDetailPage] Failed to create GitHub PR challenge:', errors);
            continue;
          }

          const challengeId = created?.id;
          if (!challengeId) continue;

          // Fire-and-forget: fetch full diff and cache it on the challenge record
          const selRepoUrl = sel.repoUrl;
          const selPrNumber = sel.prNumber;
          void (async () => {
            try {
              const { data: raw } = await client.mutations.fetchGitHubPR({
                repoUrl: selRepoUrl,
                prNumber: selPrNumber,
                skipCache: false,
              });

              const result = typeof raw === 'string' ? JSON.parse(raw) : raw;

              if (result?.success && result.data) {
                await client.models.Challenge.update({
                  id: challengeId,
                  cachedDiffJson: result.data.diff,
                  cachedMetadata: result.data.metadata,
                  diffCachedAt: new Date().toISOString(),
                });
                console.log('[StageDetailPage] Diff cached for challenge', challengeId);
              }
            } catch (cacheErr) {
              console.error('[StageDetailPage] Failed to cache diff for challenge', challengeId, cacheErr);
            }
          })();
        }
      }
      await fetchData();
    } catch (err) {
      console.error("[StageDetailPage] Failed to add challenges:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChallengeDelete = async (challenge: any) => {
    if (!window.confirm("Delete this challenge?")) return;
    try {
      await client.models.Challenge.delete({ id: challenge.id });
      await fetchData();
    } catch (err) {
      console.error("Failed to delete challenge:", err);
    }
  };

  const handleEventTypeSelect = async (eventTypeId: string) => {
    if (!stageId) return;
    try {
      await client.models.Stage.update({
        id: stageId,
        schedulingEventTypeId: eventTypeId,
      });
      setStage((prev: any) =>
        prev ? { ...prev, schedulingEventTypeId: eventTypeId } : prev,
      );
    } catch (err) {
      console.error("[StageDetail] Failed to save event type:", err);
    }
  };

  /** Update or Add an email template */
  const handleSaveTemplate = async () => {
    if (!stageId || !editingTemplate) return;
    setIsSavingTemplate(true);
    try {
      const currentTemplates = (stage.notificationTemplates ||
        []) as NotificationTemplate[];
      const exists = currentTemplates.find(
        (t) => t.trigger === editingTemplate.trigger,
      );

      let newTemplates;
      if (exists) {
        newTemplates = currentTemplates.map((t) =>
          t.trigger === editingTemplate.trigger ? editingTemplate : t,
        );
      } else {
        newTemplates = [...currentTemplates, editingTemplate];
      }

      await client.models.Stage.update({
        id: stageId,
        notificationTemplates: JSON.stringify(newTemplates),
      });

      setStage({ ...stage, notificationTemplates: newTemplates });
      setEditingTemplate(null);
    } catch (err) {
      console.error("[StageDetail] Failed to save template:", err);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id && stage) {
      const oldIndex = stage.challenges.findIndex(
        (c: any) => c.id === active.id,
      );
      const newIndex = stage.challenges.findIndex((c: any) => c.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newChallenges = arrayMove(
          stage.challenges,
          oldIndex,
          newIndex,
        ).map((c: any, i: number) => ({
          ...c,
          order: i,
        }));
        setStage({ ...stage, challenges: newChallenges });
        try {
          await Promise.all(
            newChallenges.map((c: any) =>
              client.models.Challenge.update({ id: c.id, order: c.order }),
            ),
          );
        } catch (err) {
          console.error("Failed to update challenge order:", err);
          fetchData();
        }
      }
    }
  };

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

  if (!stage)
    return <div style={{ padding: 40, color: "#fff" }}>Stage not found.</div>;

  const challenges = [...(stage.challenges || [])]
    .filter((c) => c !== null)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

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
              value={stage.title || ""}
              onChange={(e) => {
                const newVal = e.target.value;
                setStage({ ...stage, title: newVal });
              }}
              onBlur={async () => {
                if (stage.title) {
                  try {
                    await client.models.Stage.update({
                      id: stage.id,
                      title: stage.title,
                    });
                  } catch (err) {
                    console.error("Failed to update stage title:", err);
                  }
                }
              }}
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
              placeholder="Stage Title"
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
              onDragEnd={handleDragEnd}
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
                      onDelete={handleChallengeDelete}
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
                const hasTemplate = (stage.notificationTemplates || []).some(
                  (t: any) => t.trigger === trigger,
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
                        const existing = (
                          stage.notificationTemplates || []
                        ).find((t: any) => t.trigger === trigger);
                        setEditingTemplate(
                          existing || { trigger, subject: "", body: "" },
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

                    {isEditing && (
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
                            onClick={handleSaveTemplate}
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
                    type="number"
                    value={stage.timeLimit || ""}
                    onChange={async (e) => {
                      const val = e.target.value
                        ? parseInt(e.target.value)
                        : null;
                      setStage({ ...stage, timeLimit: val });
                      await client.models.Stage.update({
                        id: stage.id,
                        timeLimit: val,
                      });
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
                {!modeFieldReady ? (
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "rgba(251,191,36,0.06)",
                      border: "1px solid rgba(251,191,36,0.2)",
                      borderRadius: 4,
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: 9,
                        color: "rgba(251,191,36,0.7)",
                        lineHeight: 1.6,
                        fontFamily: "Space Mono",
                      }}
                    >
                      ⚠ SCHEMA_NOT_DEPLOYED
                      <br />
                      <span style={{ opacity: 0.6 }}>
                        Run <code>npx ampx sandbox</code> to enable live video
                        stages.
                      </span>
                    </p>
                  </div>
                ) : (
                  <>
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
                            onClick={async () => {
                              if (isActive) return;
                              setStage({ ...stage, mode: m });
                              try {
                                await client.models.Stage.update({
                                  id: stage.id,
                                  mode: m,
                                });
                              } catch (err) {
                                console.error(
                                  "[StageDetail] Failed to update mode:",
                                  err,
                                );
                                setStage({ ...stage, mode: stage.mode });
                              }
                            }}
                            style={{
                              flex: 1,
                              padding: "8px 0",
                              background: isActive
                                ? "rgba(255,255,255,0.12)"
                                : "transparent",
                              border: "none",
                              color: isActive
                                ? "#fff"
                                : "rgba(255,255,255,0.3)",
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing: "0.12em",
                              fontFamily: "Space Mono",
                              cursor: isActive ? "default" : "pointer",
                              transition: "background 0.15s, color 0.15s",
                            }}
                          >
                            {m === "LIVE_VIDEO" ? "⦿ LIVE_VIDEO" : "ASYNC"}
                          </button>
                        );
                      })}
                    </div>
                    {(stage.mode ?? "ASYNC") === "LIVE_VIDEO" && (
                      <div
                        style={{
                          marginTop: 20,
                          borderTop: "1px solid rgba(255,255,255,0.05)",
                          paddingTop: 20,
                        }}
                      >
                        <EventTypePicker
                          currentEventTypeId={
                            stage.schedulingEventTypeId ?? null
                          }
                          onSelect={handleEventTypeSelect}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
              )}
            </div>
          </LiquidMetalCard>
        </aside>
      </div>

      <ChallengePicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleChallengeSelect}
      />
    </div>
  );
}
