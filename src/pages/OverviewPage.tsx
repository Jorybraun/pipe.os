import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  CheckCircle,
  Activity,
  Code,
  FileText,
  Copy,
  Plus,
  X,
  Video,
  ExternalLink,
  Clock,
  Mail,
  Target,
  ChevronRight,
  GripVertical,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { LiquidMetalCard } from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { useData } from "../providers";
import { useSchedulingConnection } from "../hooks/useSchedulingConnection";
import { CandidateIntakeModal } from "../components/Candidate/CandidateIntakeModal";
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const OverviewSkeleton = () => (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 32, padding: 40 }}
  >
    {/* Header Skeleton */}
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
      }}
    >
      <div>
        <Skeleton width={100} height={8} style={{ marginBottom: 12 }} />
        <Skeleton width={200} height={32} />
      </div>
      <Skeleton width={120} height={40} />
    </div>

    {/* Stage Headers Skeleton */}
    <div style={{ display: "flex", gap: 12 }}>
      {[1, 2, 3].map((i) => (
        <LiquidMetalCard
          key={i}
          style={{ flex: 1, minWidth: 280, height: 180, padding: 24 }}
        >
          <Skeleton width={20} height={20} style={{ marginBottom: 24 }} />
          <Skeleton width={80} height={8} style={{ marginBottom: 16 }} />
          <Skeleton width={60} height={42} />
          <Skeleton width="100%" height={2} style={{ marginTop: 20 }} />
        </LiquidMetalCard>
      ))}
    </div>
  </div>
);

/**
 * OverviewPage - Kanban-style pipeline view showing candidates by stage
 */

// Stage header card
function StageHeaderCard({
  stage,
  candidates,
  isActive,
  onClick,
}: {
  stage: any;
  candidates: any[];
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = FileText;
  const scoredCandidates = candidates.filter(
    (c) => c.score !== undefined && c.score !== null,
  );
  const avgScore =
    scoredCandidates.length > 0
      ? Math.round(
          scoredCandidates.reduce((sum, c) => sum + (c.score || 0), 0) /
            scoredCandidates.length,
        )
      : null;

  return (
    <LiquidMetalCard
      data-testid="stage-card"
      variant={isActive ? "chrome" : "default"}
      hover
      onClick={onClick}
      style={{ padding: 24, cursor: "pointer" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <Icon size={20} color={isActive ? "#fff" : "rgba(255,255,255,0.4)"} />
        {isActive && (
          <Activity
            size={16}
            color="rgba(255,255,255,0.8)"
            style={{ animation: "pulse 1.5s ease-in-out infinite" }}
          />
        )}
      </div>

      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.2em",
          color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
          marginBottom: 12,
        }}
      >
        {(stage.title || "STAGE").toUpperCase()}
      </div>

      {avgScore !== null ? (
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            background:
              "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {avgScore}
        </div>
      ) : (
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            color: "rgba(255,255,255,0.15)",
          }}
        >
          —
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          height: 2,
          background: "rgba(255,255,255,0.06)",
        }}
      >
        {avgScore !== null && (
          <div
            style={{
              width: `${avgScore}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))",
              boxShadow: "0 0 10px rgba(255,255,255,0.2)",
            }}
          />
        )}
      </div>
    </LiquidMetalCard>
  );
}

function SortableStage({
  id,
  children,
  disabled = false,
}: {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled,
    data: {
      type: "Stage",
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    flex: "0 0 320px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {/* Drag Handle for Stage (optional, can be whole header) */}
      <div {...listeners} style={{ cursor: disabled ? "default" : "grab" }}>
        {children}
      </div>
    </div>
  );
}

// Candidate card
function CandidateKanbanCard({
  candidate,
  onClick,
  onInvite,
  onReset,
  isInviting,
  isResetting,
  interview,
  isOverlay = false,
  disabled = false,
}: {
  candidate: any;
  onClick: () => void;
  onInvite?: () => void;
  onReset?: () => void;
  isInviting?: boolean;
  isResetting?: boolean;
  interview?: any;
  isOverlay?: boolean;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);

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
    data: {
      type: "Candidate",
      candidate,
    },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    marginBottom: 8,
    cursor: isDragging ? "grabbing" : "pointer",
  };

  // Strip CLAIMED:: prefix so the copy-link always produces a usable URL
  const rawToken = (candidate.inviteToken || '').replace(/^CLAIMED::/, '');
  const isClaimed = (candidate.inviteToken || '').startsWith('CLAIMED::');

  const handleCopyLink = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const inviteUrl = `${window.location.origin}/assess/${rawToken}`;
      navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    [rawToken],
  );

  const initials = (candidate.name || "")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusColor = () => {
    if (interview?.status === "SCHEDULED") return "#60a5fa";
    if (interview?.status === "INVITED") return "#fbbf24";
    if (candidate.status === "COMPLETED") return "#34d399";
    if (candidate.status === "IN_PROGRESS") return "#8b5cf6";
    return "rgba(255,255,255,0.2)";
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
          position: "relative",
          overflow: "hidden",
          boxShadow: isOverlay ? "0 20px 40px rgba(0,0,0,0.4)" : undefined,
          border: isOverlay ? "1px solid rgba(255,255,255,0.3)" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {/* Status Indicator Bar */}
          <div
            style={{
              width: 4,
              background: statusColor,
              opacity: 0.8,
            }}
          />

          {/* Main Content */}
          <div style={{ flex: 1, padding: "12px 16px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 6,
              }}
            >
              {/* Drag Handle */}
              <div
                {...listeners}
                style={{ cursor: "grab", padding: "4px 0" }}
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical size={12} color="rgba(255,255,255,0.15)" />
              </div>

              {/* Initials Circle */}
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 800,
                  color: "#fff",
                  letterSpacing: "-0.02em",
                }}
              >
                {initials}
              </div>

              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#fff",
                  margin: 0,
                  letterSpacing: "0.01em",
                }}
              >
                {(candidate.name || "").toUpperCase()}
              </h3>

              <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Mail size={10} color="rgba(255,255,255,0.2)" />
                  <span
                    style={{
                      fontSize: 8,
                      color: "rgba(255,255,255,0.3)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {(candidate.email || "").toLowerCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Stats & Status Row */}
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Activity size={12} color={statusColor} />
                <div
                  style={{
                    fontSize: 8,
                    fontWeight: 800,
                    color: statusColor,
                    letterSpacing: "0.1em",
                    fontFamily: "Space Mono",
                  }}
                >
                  {(
                    interview?.status ||
                    candidate.status ||
                    "IDLE"
                  ).toUpperCase()}
                </div>
              </div>

              {interview?.scheduledAt && interview.status === "SCHEDULED" && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Clock size={12} color="rgba(255,255,255,0.2)" />
                  <span
                    style={{
                      fontSize: 9,
                      color: "rgba(255,255,255,0.5)",
                      fontFamily: "Space Mono",
                      fontWeight: 700,
                    }}
                  >
                    {formatTime(interview.scheduledAt)}
                  </span>
                </div>
              )}

              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Target size={12} color="rgba(255,255,255,0.2)" />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "#fff",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {String(candidate.score || 0).padStart(2, "0")}
                  </span>
                </div>
                <ChevronRight size={14} color="rgba(255,255,255,0.15)" />
              </div>
            </div>

            {/* Inline Meeting Link if active */}
            {interview?.meetingUrl && interview.status === "SCHEDULED" && (
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: "1px solid rgba(255,255,255,0.03)",
                }}
              >
                <a
                  href={interview.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontSize: 8,
                    color: "#60a5fa",
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                  }}
                >
                  JOIN_MEETING <ExternalLink size={8} />
                </a>
              </div>
            )}
          </div>

          {/* Action Area */}
          {!interview && (
              <div
                style={{
                  width: 44,
                  borderLeft: "1px solid rgba(255,255,255,0.05)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255,255,255,0.01)",
                  gap: 10,
                }}
              >
                <button
                  onClick={handleCopyLink}
                  title="Copy assessment link"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: copied ? "#10b981" : "rgba(255,255,255,0.3)",
                    cursor: "pointer",
                    padding: 4,
                    transition: "all 0.2s ease",
                  }}
                >
                  {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                </button>
                {onInvite && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onInvite();
                    }}
                    disabled={isInviting}
                    title="Invite to Live Interview"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: isInviting
                        ? "rgba(255,255,255,0.1)"
                        : "rgba(139, 92, 246, 0.6)",
                      cursor: isInviting ? "default" : "pointer",
                      padding: 4,
                      transition: "all 0.2s ease",
                    }}
                  >
                    <Video size={14} />
                  </button>
                )}
                {(isClaimed || candidate.status === 'COMPLETED' || candidate.status === 'IN_PROGRESS') && onReset && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onReset();
                    }}
                    disabled={isResetting}
                    title="Reset invite token (unclaim + delete assessments)"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: isResetting
                        ? "rgba(255,255,255,0.1)"
                        : "rgba(251, 191, 36, 0.6)",
                      cursor: isResetting ? "default" : "pointer",
                      padding: 4,
                      transition: "all 0.2s ease",
                    }}
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>
            )}
        </div>

        {/* Mini progress bar at the very bottom (if in progress) */}
        {candidate.status === "IN_PROGRESS" && (
          <div style={{ height: 1, background: "rgba(255,255,255,0.03)" }}>
            <div
              style={{
                width: `45%`, // Dummy progress for now
                height: "100%",
                background: "#8b5cf6",
                opacity: 0.5,
              }}
            />
          </div>
        )}
      </LiquidMetalCard>
    </div>
  );
}

export default function OverviewPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dataFactory = useData();
  const [pipeline, setPipeline] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [activeCandidate, setActiveCandidate] = useState<any>(null);
  const [activeStage, setActiveStage] = useState<any>(null);

  // False until we confirm Phase 14 schema fields exist in the deployed sandbox.
  const [schemaReady, setSchemaReady] = useState(false);

  // Scheduling Connection for provider resolution
  const { connection, fetchEventTypes } = useSchedulingConnection();

  // Add Candidate Form State
  const [showAddForm, setShowAddForm] = useState(false);

  // Upcoming scheduled interviews for this pipeline (status=SCHEDULED)
  const [upcomingInterviews, setUpcomingInterviews] = useState<any[]>([]);

  // Invite-to-interview state
  const [invitingCandidateId, setInvitingCandidateId] = useState<string | null>(
    null,
  );

  // Reset-token state
  const [resettingCandidateId, setResettingCandidateId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handlePublishPipeline = async () => {
    if (!id) return;
    const client = dataFactory.createClient();
    try {
      await client.models.Pipeline.update({ id, status: "ACTIVE" } as any);
      await fetchData();
    } catch (err) {
      console.error("[OverviewPage] Failed to publish pipeline:", err);
    }
  };

  const handleAddStage = async () => {
    if (!id) return;

    const title = window.prompt("Enter new stage name:");
    if (!title || title.trim() === "") return;

    const client = dataFactory.createClient();
    setIsLoading(true);
    try {
      await client.models.Stage.create({
        pipelineId: id,
        title: title.trim(),
        order: stages.length,
      });
      await fetchData();
    } catch (err) {
      console.error("Failed to add stage:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchData = useCallback(async () => {
    if (!id) return;
    const client = dataFactory.createClient();
    try {
      setIsLoading(true);
      setError(null);

      // Probe schema for new fields inline (avoids cascading state updates)
      let hasNewFields = schemaReady;
      if (!hasNewFields) {
        try {
          await client.models.Stage.list({
            limit: 1,
            selectionSet: ["id", "schedulingEventTypeId"],
          });
          hasNewFields = true;
          setSchemaReady(true);
        } catch {
          hasNewFields = false;
        }
      }

      // Dynamically build selection set based on schema readiness
      const stageFields = ["id", "title", "order"];
      if (hasNewFields) {
        stageFields.push("mode", "schedulingEventTypeId");
      }

      const [pipelineData, candidatesData, stagesData] = await Promise.all([
        client.models.Pipeline.get({ id }),
        client.models.Candidate.list({
          filter: { pipelineId: { eq: id } },
          selectionSet: [
            "id",
            "name",
            "email",
            "status",
            "inviteToken",
            "currentStageId",
          ],
        }),
        client.models.Stage.list({
          filter: { pipelineId: { eq: id } },
          selectionSet: stageFields as any,
        }),
      ]);

      // Fetch challenges + assessments separately to avoid Amplify relation null crash
      // (Amplify's list.ts crashes on data[key].items when a relation is null)
      const challengesByStage: Record<string, { id: string }[]> = {};
      const rawStages = stagesData?.data || [];
      for (const stage of rawStages) {
        if (!stage) continue;
        try {
          const { data: stageChallenges } = await client.models.Challenge.list({
            filter: { stageId: { eq: (stage as any).id } },
            selectionSet: ["id", "stageId"],
          });
          if (stageChallenges) {
            challengesByStage[(stage as any).id] = stageChallenges.map((c: any) => ({ id: c.id }));
          }
        } catch { /* skip */ }
      }

      const assessmentsByCandidate: Record<string, { id: string; score: number | null; challengeId?: string }[]> = {};
      const allCandidateIds = (candidatesData?.data || []).map((c: any) => c?.id).filter(Boolean) as string[];
      for (const cId of allCandidateIds) {
        try {
          const { data: cAssessments } = await client.models.Assessment.list({
            filter: { candidateId: { eq: cId } },
            selectionSet: ["id", "score", "candidateId"],
          });
          if (cAssessments) {
            assessmentsByCandidate[cId] = cAssessments.map((a: any) => ({
              id: a.id,
              score: a.score ?? null,
            }));
          }
        } catch { /* skip — sandbox may not have Assessment table yet */ }
      }

      setPipeline(pipelineData?.data || null);

      // Enrich stages with separately-fetched challenges
      const enrichedStages = rawStages
        .filter(Boolean)
        .map((s: any) => ({ ...s, challenges: challengesByStage[s.id] || [] }))
        .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      setStages(enrichedStages as any);

      // Enrichment logic with extra guards
      const rawCandidates = candidatesData?.data || [];
      const enrichedCandidates = rawCandidates
        .map((c) => {
          if (!c) return null;
          const assessments = assessmentsByCandidate[(c as any).id] || [];
          const scores = assessments
            .map((a) => a.score)
            .filter((s): s is number => typeof s === "number");
          const score =
            scores.length > 0
              ? Math.round(
                  scores.reduce((sum, s) => sum + s, 0) / scores.length,
                )
              : null;
          return { ...c, score };
        })
        .filter(Boolean);

      setCandidates(enrichedCandidates);

      // Load upcoming scheduled interviews — guarded
      try {
        const { data: siData } = await client.models.ScheduledInterview.list({
          filter: { pipelineId: { eq: id } },
        });
        setUpcomingInterviews(
          (siData ?? []).filter(
            (si: any) =>
              si && (si.status === "SCHEDULED" || si.status === "INVITED"),
          ),
        );
      } catch (siErr) {
        console.warn("[OverviewPage] ScheduledInterview model failed:", siErr);
      }
    } catch (err) {
      console.error("Error fetching pipeline data:", err);
      setError(
        err instanceof Error ? err : new Error("Failed to load pipeline data"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [id, schemaReady, dataFactory]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleClearStages = async () => {
    if (!id) return;
    if (
      !window.confirm(
        "Are you sure you want to delete ALL stages for this pipeline?",
      )
    )
      return;

    const client = dataFactory.createClient();
    setIsLoading(true);
    try {
      // Fetch all stages first
      const { data: stagesToDelete } = await client.models.Stage.list({
        filter: { pipelineId: { eq: id } },
      });
      // Delete them
      await Promise.all(
        stagesToDelete.map((s) => client.models.Stage.delete({ id: (s as { id: string }).id })),
      );

      // Wait for consistency. Amplify Data backend is eventually consistent.
      // This arbitrary delay allows DynamoDB streams to sync before we re-fetch.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await fetchData();
    } catch (err) {
      console.error("Failed to clear stages:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteStage = async (stageId: string, stageTitle: string) => {
    if (!window.confirm(`Delete stage "${stageTitle}"? This cannot be undone.`))
      return;
    const client = dataFactory.createClient();
    setIsLoading(true);
    try {
      await client.models.Stage.delete({ id: stageId });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await fetchData();
    } catch (err) {
      console.error("[OverviewPage] Failed to delete stage:", err);
    } finally {
      setIsLoading(false);
    }
  };

  /** Create a ScheduledInterview record for a candidate (Invite to Interview) */
  const handleInviteToInterview = async (
    candidateId: string,
    stageId: string,
  ) => {
    if (!id) return;

    // Only allow invites for LIVE_VIDEO stages
    const stage = stages.find((s: any) => s.id === stageId);
    if (!stage || stage.mode !== "LIVE_VIDEO") {
      console.warn(
        "[OverviewPage] Invite to Interview is only valid for LIVE_VIDEO stages",
      );
      return;
    }

    const client = dataFactory.createClient();
    setInvitingCandidateId(candidateId);
    try {
      // Prevent duplicate invites: check for an existing record first
      const { data: existing } = await client.models.ScheduledInterview.list({
        filter: { candidateId: { eq: candidateId }, stageId: { eq: stageId } },
      });
      if (existing && existing.length > 0) {
        console.warn(
          "[OverviewPage] Interview invite already exists for this candidate + stage",
        );
        return;
      }

      // Resolve scheduling URL from the recruiter's connected provider
      let schedulingUrl: string | undefined;
      if (connection?.id && connection.status === "ACTIVE") {
        try {
          const eventTypes = await fetchEventTypes(connection.id);
          const firstEvent = eventTypes[0];
          if (firstEvent) {
            schedulingUrl = firstEvent.url;
            console.log(
              "[OverviewPage] Resolved scheduling URL from provider:",
              schedulingUrl,
            );
          }
        } catch (err) {
          console.warn(
            "[OverviewPage] Could not fetch event types, falling back to no scheduling URL:",
            err,
          );
        }
      }

      await client.models.ScheduledInterview.create({
        pipelineId: id,
        candidateId,
        stageId,
        status: "INVITED",
        schedulingProvider: connection?.providerId || "MANUAL",
        schedulingUrl: schedulingUrl ?? null,
      });
      // Re-fetch upcoming interviews
      const { data: siData } = await client.models.ScheduledInterview.list({
        filter: { pipelineId: { eq: id } },
      });
      setUpcomingInterviews(
        (siData ?? []).filter(
          (si: any) =>
            si && (si.status === "SCHEDULED" || si.status === "INVITED"),
        ),
      );
    } catch (err) {
      console.error(
        "[OverviewPage] Failed to create interview invitation:",
        err,
      );
    } finally {
      setInvitingCandidateId(null);
    }
  };

  /** Reset a candidate's invite token: unclaim, delete assessments, set INVITED */
  const handleResetCandidate = async (candidateId: string) => {
    const client = dataFactory.createClient();
    setResettingCandidateId(candidateId);
    try {
      const candidate = candidates.find((c: any) => c.id === candidateId);
      if (!candidate) return;

      // Server-side reset: hard-deletes ChallengeSubmissions + CandidateMedia,
      // resets Assessments to PENDING, unclaims invite token, sets status=INVITED.
      const resetCandidate = client.mutations['resetCandidate'];
      if (!resetCandidate) throw new Error('resetCandidate mutation not available');
      const { data: resetResultRaw, errors: resetErrors } = await resetCandidate({ candidateId });
      if (resetErrors?.length) {
        throw new Error(resetErrors[0]?.message ?? 'Reset failed');
      }
      const resetResult = resetResultRaw as { success?: boolean; error?: string } | null;
      if (!resetResult?.success) {
        throw new Error(resetResult?.error ?? 'Reset failed');
      }

      // Refresh data
      await fetchData();
    } catch (err) {
      console.error('[OverviewPage] Failed to reset candidate:', err);
    } finally {
      setResettingCandidateId(null);
    }
  };

  const handleSeedStage = async () => {
    if (!id) return;
    const client = dataFactory.createClient();
    setIsLoading(true);
    try {
      console.log("[Overview] Seeding MVP stages...");
      // 1. Technical Screen (Default: ASYNC)
      await client.models.Stage.create({
        pipelineId: id,
        title: "Technical Screen",
        order: 0,
        mode: "ASYNC",
      });

      // 2. Final Round (LIVE_VIDEO for scheduling tests)
      await client.models.Stage.create({
        pipelineId: id,
        title: "Final Round",
        order: 1,
        mode: "LIVE_VIDEO",
      });

      console.log("[Overview] Stages seeded. Refreshing...");
      // Wait for consistency. Amplify Data backend is eventually consistent.
      // 800ms is usually sufficient for standard sandbox deployments, but may
      // need backoff/retry in heavy load scenarios.
      await new Promise((resolve) => setTimeout(resolve, 800));
      await fetchData();
    } catch (err) {
      console.error("Failed to seed stages:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Map challenge IDs to stage IDs for grouping
  const challengeToStageMap = stages.reduce(
    (acc, stage) => {
      (stage.challenges || []).forEach((c: any) => {
        acc[c.id] = stage.id;
      });
      return acc;
    },
    {} as Record<string, string>,
  );

  // Group candidates by their current stage
  const candidatesByStage = useMemo(() => {
    return stages.reduce(
      (acc, s, idx) => {
        acc[s.id] = candidates.filter((c) => {
          // If candidate has a currentStageId, use it as the source of truth
          if (c.currentStageId) {
            return c.currentStageId === s.id;
          }

          // Fallback: Get count of unique stages this candidate has submitted assessments for
          const completedStageIds = new Set(
            (c.assessments || [])
              .map((a: any) => challengeToStageMap[a.challengeId])
              .filter(Boolean),
          );
          const completedCount = completedStageIds.size;

          // If they finished everything, they are in the last stage
          if (c.status === "COMPLETED" && idx === stages.length - 1)
            return true;
          if (c.status === "COMPLETED") return false;

          // Otherwise, they are in the stage corresponding to their progress
          // e.g. 0 stages completed -> in stage 0
          // 1 stage completed -> in stage 1
          return idx === completedCount;
        });
        return acc;
      },
      {} as Record<string, any[]>,
    );
  }, [stages, candidates, challengeToStageMap]);

  const handleDragStart = (event: any) => {
    const { active } = event;
    if (active.data.current?.type === "Candidate") {
      const candidate = candidates.find((c) => c.id === active.id);
      setActiveCandidate(candidate);
    } else if (active.data.current?.type === "Stage") {
      const stage = stages.find((s) => s.id === active.id);
      setActiveStage(stage);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCandidate(null);
    setActiveStage(null);

    if (!over) return;
    const client = dataFactory.createClient();

    // Handle Stage Reordering
    if (
      active.data.current?.type === "Stage" &&
      over.data.current?.type === "Stage" &&
      active.id !== over.id
    ) {
      const oldIndex = stages.findIndex((s) => s.id === active.id);
      const newIndex = stages.findIndex((s) => s.id === over.id);

      const newStages = arrayMove(stages, oldIndex, newIndex);
      setStages(newStages);

      // Update order in DB
      try {
        await Promise.all(
          newStages.map((s, idx) =>
            client.models.Stage.update({ id: s.id, order: idx } as any),
          ),
        );
      } catch (err) {
        console.error("[Overview] Failed to update stage order:", err);
        // Re-fetch to reset state on error
        fetchData();
      }
      return;
    }

    // Handle Candidate Movement between stages
    if (active.data.current?.type === "Candidate") {
      const candidateId = active.id as string;
      let targetStageId: string | null = null;

      if (over.data.current?.type === "Stage") {
        targetStageId = over.id as string;
      } else if (over.data.current?.type === "Candidate") {
        // Find which stage this target candidate belongs to
        const targetCandidateId = over.id as string;
        const typedCandidatesByStage = candidatesByStage as Record<
          string,
          any[]
        >;
        for (const [stageId, stageCandidates] of Object.entries(
          typedCandidatesByStage,
        )) {
          if (stageCandidates.some((c: any) => c.id === targetCandidateId)) {
            targetStageId = stageId;
            break;
          }
        }
      }

      if (targetStageId) {
        try {
          await client.models.Candidate.update({
            id: candidateId,
            currentStageId: targetStageId,
          } as any);
          await fetchData(); // Refresh to show in new stage
        } catch (err) {
          console.error("[Overview] Failed to move candidate:", err);
        }
      }
    }
  };

  if (isLoading && !pipeline) {
    return <OverviewSkeleton />;
  }

  if (error) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <LiquidMetalCard
          variant="mercury"
          style={{ maxWidth: 400, padding: 40, textAlign: "center" }}
        >
          <div
            style={{
              color: "#f87171",
              marginBottom: 16,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: '"Space Mono", monospace',
            }}
          >
            ERROR_LOADING_PIPELINE
          </div>
          <p
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: 13,
              marginBottom: 24,
              lineHeight: 1.6,
            }}
          >
            {error.message}
          </p>
          <button
            onClick={() => fetchData()}
            style={{
              padding: "12px 24px",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              fontSize: 10,
              letterSpacing: "0.1em",
              fontFamily: '"Space Mono", monospace',
              cursor: "pointer",
            }}
          >
            RETRY_CONNECTION
          </button>
        </LiquidMetalCard>
      </div>
    );
  }

  if (!pipeline && !isLoading) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <h2 style={{ color: "#fff", marginBottom: 20 }}>Pipeline Not Found</h2>
        <button
          onClick={() => navigate("/")}
          style={{
            color: "#fff",
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            padding: "10px 20px",
            cursor: "pointer",
          }}
        >
          Back to Roles
        </button>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div>
        {/* Page Header with Add Candidate button */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 32,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.2em",
                color: "rgba(255,255,255,0.3)",
                marginBottom: 8,
              }}
            >
              PIPELINE_OVERVIEW
            </div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "#fff",
                margin: 0,
              }}
            >
              {pipeline?.title}
            </h1>
          </div>

          {!showAddForm && (
            <div style={{ display: "flex", gap: 12 }}>
              {import.meta.env.DEV && (
                <>
                  <button
                    onClick={handleClearStages}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 20px",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "rgba(255,255,255,0.4)",
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      fontFamily: "Space Mono",
                      cursor: "pointer",
                    }}
                  >
                    <X size={14} />
                    CLEAR_STAGES
                  </button>
                  {stages.length === 0 && (
                    <button
                      onClick={handleSeedStage}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 20px",
                        background: "rgba(255,100,100,0.1)",
                        border: "1px solid rgba(255,100,100,0.2)",
                        color: "#ffaaaa",
                        fontSize: 10,
                        letterSpacing: "0.1em",
                        fontFamily: "Space Mono",
                        cursor: "pointer",
                      }}
                    >
                      <Code size={14} />
                      SEED_MVP_STAGES
                    </button>
                  )}
                </>
              )}
              {pipeline?.status === "DRAFT" && (
                <button
                  onClick={handlePublishPipeline}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 20px",
                    background:
                      "linear-gradient(135deg, rgba(74,222,128,0.15), rgba(16,185,129,0.1))",
                    border: "1px solid rgba(74,222,128,0.3)",
                    color: "#4ade80",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    fontFamily: "Space Mono",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "linear-gradient(135deg, rgba(74,222,128,0.25), rgba(16,185,129,0.18))")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      "linear-gradient(135deg, rgba(74,222,128,0.15), rgba(16,185,129,0.1))")
                  }
                >
                  PUBLISH_PIPELINE
                </button>
              )}
              {pipeline?.status === "ACTIVE" && (
                <button
                  onClick={() => setShowAddForm(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 20px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#fff",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    fontFamily: "Space Mono",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(255,255,255,0.1)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.05)")
                  }
                >
                  <Plus size={14} />
                  ADD_CANDIDATE
                </button>
              )}
            </div>
          )}
        </div>

        {/* Add Candidate Modal */}
        {showAddForm && (
          <CandidateIntakeModal
            pipelineId={id!}
            onClose={() => setShowAddForm(false)}
            onSuccess={() => {
              setShowAddForm(false);
              fetchData(); // Refresh list
            }}
          />
        )}

        {/* Stage Headers and Kanban Grid */}
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 24,
            alignItems: "flex-start",
          }}
        >
          <SortableContext
            items={stages.map((s) => s.id)}
            strategy={horizontalListSortingStrategy}
          >
            {stages.map((s) => {
              const stageCandidates = candidatesByStage[s.id] || [];
              const isDraft = pipeline?.status === "DRAFT";
              const isActive = pipeline?.status === "ACTIVE";

              return (
                <SortableStage key={s.id} id={s.id} disabled={!isDraft}>
                  {/* Header */}
                  <div style={{ position: "relative" }}>
                    <StageHeaderCard
                      stage={s}
                      candidates={stageCandidates}
                      isActive={false}
                      onClick={() => navigate(`/pipeline/${id}/stages/${s.id}`)}
                    />
                    {isDraft && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteStage(s.id, s.title ?? "Stage");
                        }}
                        title="Delete this stage"
                        style={{
                          position: "absolute",
                          top: 10,
                          right: 10,
                          width: 28,
                          height: 28,
                          background: "rgba(255,80,80,0.08)",
                          border: "1px solid rgba(255,80,80,0.2)",
                          borderRadius: 6,
                          color: "rgba(255,100,100,0.5)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background =
                            "rgba(255,80,80,0.2)";
                          e.currentTarget.style.color = "#ff6464";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background =
                            "rgba(255,80,80,0.08)";
                          e.currentTarget.style.color = "rgba(255,100,100,0.5)";
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>

                  {/* Candidate Cards */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      minHeight: 100,
                    }}
                  >
                    {stageCandidates.map((candidate: any) => {
                      // Find the interview record for this candidate in THIS stage
                      const interview = upcomingInterviews.find(
                        (si) =>
                          si.candidateId === candidate.id &&
                          si.stageId === s.id,
                      );

                      return (
                        <CandidateKanbanCard
                          key={candidate.id}
                          candidate={candidate}
                          onClick={() =>
                            navigate(`/candidates/${candidate.id}`)
                          }
                          isInviting={invitingCandidateId === candidate.id}
                          isResetting={resettingCandidateId === candidate.id}
                          onReset={() => handleResetCandidate(candidate.id)}
                          {...(interview ? { interview } : {})}
                          {...(s.mode === "LIVE_VIDEO"
                            ? {
                                onInvite: () =>
                                  handleInviteToInterview(candidate.id, s.id),
                              }
                            : {})}
                          disabled={!isActive}
                        />
                      );
                    })}

                    {stageCandidates.length === 0 && (
                      <div
                        style={{
                          height: 120,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "1px dashed rgba(255,255,255,0.08)",
                          borderRadius: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 8,
                            letterSpacing: "0.2em",
                            color: "rgba(255,255,255,0.2)",
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

          {/* Add Stage Column */}
          {pipeline?.status === "DRAFT" && (
            <div style={{ flex: "0 0 320px" }}>
              <button
                onClick={() => void handleAddStage()}
                style={{
                  width: "100%",
                  height: 180,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px dashed rgba(255,255,255,0.1)",
                  borderRadius: 12,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  color: "rgba(255,255,255,0.4)",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                }}
              >
                <Plus size={20} />
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.2em",
                    fontWeight: 700,
                    fontFamily: "Space Mono",
                  }}
                >
                  ADD_STAGE
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <DragOverlay
        dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: {
              active: {
                opacity: "0.5",
              },
            },
          }),
        }}
      >
        {activeCandidate ? (
          <CandidateKanbanCard
            candidate={activeCandidate}
            onClick={() => {}}
            isOverlay
          />
        ) : activeStage ? (
          <div style={{ width: 320, opacity: 0.8 }}>
            <StageHeaderCard
              stage={activeStage}
              candidates={candidatesByStage[activeStage.id] || []}
              isActive={false}
              onClick={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
