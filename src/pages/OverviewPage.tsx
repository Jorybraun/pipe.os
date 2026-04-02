/**
 * OverviewPage — Kanban-style pipeline view showing candidates by stage.
 *
 * Migrated from Amplify (N+1 calls) to the Cloudflare Workers API.
 * All data is loaded in a single GET /api/v1/pipelines/:id/overview request.
 */

import { useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle,
  Activity,
  FileText,
  Copy,
  Plus,
  Mail,
  Target,
  ChevronRight,
  GripVertical,
  Trash2,
  Rocket,
  RefreshCw,
  Settings,
} from "lucide-react";
import { LiquidMetalCard } from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { CandidateIntakeModal } from "../components/Candidate/CandidateIntakeModal";
import { useOverviewData } from "../hooks/useOverviewData";
import { useStageMutations } from "../hooks/useStageMutations";
import { useCandidateMutations } from "../hooks/useCandidateMutations";
import type { OverviewStage, OverviewCandidate } from "../lib/api/types";
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
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ─── Skeleton ────────────────────────────────────────────────────────────────

const OverviewSkeleton = () => (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 32, padding: 40 }}
  >
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

// ─── StageHeaderCard ─────────────────────────────────────────────────────────

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
        <FileText size={20} color={isActive ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)"} />
        {isActive && (
          <Activity size={16} color="var(--pipe-text-dim)" />
        )}
      </div>

      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.2em",
          color: isActive ? "var(--pipe-text, #fff)" : "var(--pipe-text-muted)",
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
            color: "var(--pipe-text-dim)",
          }}
        >
          —
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          height: 2,
          background: "var(--pipe-surface)",
        }}
      >
        {avgScore !== null && (
          <div
            style={{
              width: `${avgScore}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))",
            }}
          />
        )}
      </div>
    </LiquidMetalCard>
  );
}

// ─── SortableStage ────────────────────────────────────────────────────────────

/**
 * SortableStage — a draggable column container for a pipeline stage.
 *
 * The outer `setNodeRef` div is a plain div without `role="button"`. The dnd-kit
 * `listeners` (pointer/keyboard event handlers) are applied to the outer div for
 * drag initiation, but `attributes` (ARIA roles) are NOT — keeping the container
 * a plain, non-interactive div.
 *
 * This flat DOM structure ensures the Playwright test selector
 * `[data-testid="stage-card"].locator("..")` resolves to a plain div that
 * contains both the stage header and the candidate cards, making assertions
 * like `.locator("text=CANDIDATE 1")` reliable.
 */
function SortableStage({
  id,
  disabled = false,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const {
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled,
    data: { type: "Stage" },
  });

  const containerStyle: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    flex: "0 0 320px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    position: "relative",
    cursor: disabled ? "default" : "grab",
  };

  return (
    // listeners only — no {...attributes} so the container remains a plain div.
    // Drag is initiated by pointer/keyboard events without adding role="button".
    <div ref={setNodeRef} style={containerStyle} {...listeners}>
      {children}
    </div>
  );
}

// ─── CandidateKanbanCard ─────────────────────────────────────────────────────

function CandidateKanbanCard({
  candidate,
  onClick,
  onRefresh,
  isOverlay = false,
  disabled = false,
}: {
  candidate: OverviewCandidate;
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
    data: { type: "Candidate", candidate },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    marginBottom: 8,
    cursor: isDragging ? "grabbing" : "pointer",
  };

  const rawToken = (candidate.inviteToken || "").replace(/^CLAIMED::/, "");
  const isClaimed = (candidate.inviteToken || "").startsWith("CLAIMED::");

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

  const initials = (candidate.name || "")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const getStatusColor = (): string => {
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
                <GripVertical size={12} color="var(--pipe-text-dim)" />
              </div>

              {/* Initials Circle */}
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "var(--pipe-surface)",
                  border: "1px solid var(--pipe-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 800,
                  color: "var(--pipe-text, #fff)",
                }}
              >
                {initials}
              </div>

              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--pipe-text, #fff)",
                  margin: 0,
                  letterSpacing: "0.01em",
                }}
              >
                {(candidate.name || "").toUpperCase()}
              </h3>

              <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Mail size={10} color="var(--pipe-text-dim)" />
                  <span
                    style={{
                      fontSize: 8,
                      color: "var(--pipe-text-dim)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {(candidate.email || "").toLowerCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* LINK_USED Badge */}
            {isClaimed && (
              <div style={{ marginBottom: 6 }}>
                <span
                  data-testid="link-used-badge"
                  style={{
                    display: "inline-block",
                    fontSize: 8,
                    fontWeight: 800,
                    letterSpacing: "0.1em",
                    fontFamily: "Space Mono",
                    color: "#fbbf24",
                    background: "rgba(251, 191, 36, 0.1)",
                    border: "1px solid rgba(251, 191, 36, 0.25)",
                    borderRadius: 3,
                    padding: "2px 6px",
                  }}
                >
                  LINK_USED
                </span>
              </div>
            )}

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
                  {(candidate.status || "INVITED").toUpperCase()}
                </div>
              </div>

              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Target size={12} color="var(--pipe-text-dim)" />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "var(--pipe-text, #fff)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {String(candidate.score ?? 0).padStart(2, "0")}
                  </span>
                </div>
                <ChevronRight size={14} color="var(--pipe-text-dim)" />
              </div>
            </div>
          </div>

          {/* Action Area */}
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
                color: copied ? "#10b981" : "var(--pipe-text-dim)",
                cursor: "pointer",
                padding: 4,
                transition: "all 0.2s ease",
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
                background: "transparent",
                border: "none",
                color: refreshing ? "#8b5cf6" : "var(--pipe-text-dim)",
                cursor: refreshing ? "wait" : "pointer",
                padding: 4,
                transition: "all 0.2s ease",
                animation: refreshing ? "spin 1s linear infinite" : undefined,
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

// ─── OverviewPage ─────────────────────────────────────────────────────────────

/**
 * OverviewPage — main recruiter kanban view, loaded via Worker API.
 *
 * Zero aws-amplify or generateClient imports. All data flows through
 * useOverviewData, useStageMutations, and useCandidateMutations.
 */
export default function OverviewPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { pipeline, stages, candidates, isLoading, error, refetch, publishPipeline } =
    useOverviewData(id);

  const { createStage, reorderStages, deleteStage } = useStageMutations();
  const { updateCandidate, refreshLink } = useCandidateMutations();

  const [localStages, setLocalStages] = useState<OverviewStage[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeCandidate, setActiveCandidate] = useState<OverviewCandidate | null>(null);
  const [activeStage, setActiveStage] = useState<OverviewStage | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const configStageId = searchParams.get('config');
  const setConfigStageId = useCallback((stageId: string | null) => {
    setSearchParams((prev) => {
      if (stageId) prev.set('config', stageId);
      else prev.delete('config');
      return prev;
    }, { replace: true });
  }, [setSearchParams]);
  const [isAddingStage, setIsAddingStage] = useState(false);
  const [newStageTitle, setNewStageTitle] = useState('');

  // Use locally-optimistic stage order if available, otherwise fall back to fetched.
  const displayStages = localStages ?? stages;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleRefreshLink = useCallback(
    async (candidateId: string): Promise<void> => {
      await refreshLink(candidateId);
      await refetch();
    },
    [refreshLink, refetch],
  );

  const handleAddStage = async (): Promise<void> => {
    if (!id || !newStageTitle.trim()) return;

    try {
      const created = await createStage(id, newStageTitle.trim());
      setNewStageTitle('');
      setIsAddingStage(false);
      setLocalStages(null);
      await refetch();
      // Auto-open config panel for the new stage
      if (created?.id) setConfigStageId(created.id);
    } catch (err) {
      console.error("[OverviewPage] Failed to add stage:", err);
    }
  };

  const handleDeleteStage = async (
    stageId: string,
    stageTitle: string,
  ): Promise<void> => {
    if (!window.confirm(`Delete stage "${stageTitle}"? This cannot be undone.`))
      return;

    try {
      await deleteStage(stageId);
      setLocalStages(null);
      await refetch();
    } catch (err) {
      console.error("[OverviewPage] Failed to delete stage:", err);
    }
  };

  // ─── Drag-and-drop ─────────────────────────────────────────────────────────

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
    const activeData = event.active.data.current as { type?: string } | undefined;
    if (activeData?.type === "Candidate") {
      const candidate = candidates.find((c) => c.id === event.active.id);
      if (candidate) setActiveCandidate(candidate);
    } else if (activeData?.type === "Stage") {
      const stage = displayStages.find((s) => s.id === event.active.id);
      if (stage) setActiveStage(stage);
    }
  };

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event;
    setActiveCandidate(null);
    setActiveStage(null);

    if (!over) return;

    // Stage reordering.
    if (
      active.data.current?.type === "Stage" &&
      over.data.current?.type === "Stage" &&
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
        console.error("[OverviewPage] Failed to reorder stages:", err);
        setLocalStages(null); // revert to server state
        await refetch();
      }
      return;
    }

    // Candidate movement between stages.
    if (active.data.current?.type === "Candidate") {
      const candidateId = active.id as string;
      let targetStageId: string | null = null;

      if (over.data.current?.type === "Stage") {
        targetStageId = over.id as string;
      } else if (over.data.current?.type === "Candidate") {
        const targetCandidateId = over.id as string;
        for (const [stageId, stageCandidates] of Object.entries(candidatesByStage)) {
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
          console.error("[OverviewPage] Failed to move candidate:", err);
        }
      }
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

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
              color: "var(--pipe-text-muted)",
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
              padding: "12px 24px",
              background: "var(--pipe-surface-hover)",
              border: "1px solid var(--pipe-border)",
              color: "var(--pipe-text, #fff)",
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
        <h2 style={{ color: "var(--pipe-text, #fff)", marginBottom: 20 }}>Pipeline Not Found</h2>
        <button
          onClick={() => navigate("/")}
          style={{
            color: "var(--pipe-text, #fff)",
            background: "var(--pipe-surface-hover)",
            border: "1px solid var(--pipe-border)",
            padding: "10px 20px",
            cursor: "pointer",
          }}
        >
          Back to Roles
        </button>
      </div>
    );
  }

  const isDraft = pipeline?.status === "DRAFT";
  const isActivePipeline = pipeline?.status === "ACTIVE";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={(e) => void handleDragEnd(e)}
    >
      <div>
        {/* Page Header */}
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
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.2em",
                  color: "var(--pipe-text-dim)",
                }}
              >
                PIPELINE_OVERVIEW
              </div>
              <div
                data-testid="pipeline-status-badge"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.15em",
                  fontFamily: "Space Mono",
                  padding: "2px 8px",
                  borderRadius: 2,
                  background: isDraft
                    ? "rgba(251, 191, 36, 0.15)"
                    : "rgba(74, 222, 128, 0.15)",
                  color: isDraft ? "#fbbf24" : "#4ade80",
                  border: `1px solid ${isDraft ? "rgba(251, 191, 36, 0.3)" : "rgba(74, 222, 128, 0.3)"}`,
                }}
              >
                {pipeline?.status ?? ""}
              </div>
            </div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--pipe-text, #fff)",
                margin: 0,
              }}
            >
              {pipeline?.title}
            </h1>
          </div>

          {!showAddForm && (
            <div style={{ display: "flex", gap: 12 }}>
              {isDraft && (
                <button
                  onClick={() => void publishPipeline()}
                  disabled={displayStages.length === 0}
                  title={
                    displayStages.length === 0
                      ? "Add at least 1 stage before publishing"
                      : "Publish pipeline to start inviting candidates"
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 20px",
                    background:
                      displayStages.length === 0
                        ? "rgba(255,255,255,0.02)"
                        : "rgba(74, 222, 128, 0.1)",
                    border: `1px solid ${displayStages.length === 0 ? "rgba(255,255,255,0.05)" : "rgba(74, 222, 128, 0.3)"}`,
                    color:
                      displayStages.length === 0
                        ? "rgba(255,255,255,0.3)"
                        : "#4ade80",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    fontFamily: "Space Mono",
                    cursor:
                      displayStages.length === 0
                        ? "not-allowed"
                        : "pointer",
                    opacity: displayStages.length === 0 ? 0.5 : 1,
                  }}
                >
                  <Rocket size={14} />
                  PUBLISH_PIPELINE
                </button>
              )}
              {isActivePipeline && (
                <button
                  onClick={() => setShowAddForm(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 20px",
                    background: "var(--pipe-surface)",
                    border: "1px solid var(--pipe-border)",
                    color: "var(--pipe-text, #fff)",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    fontFamily: "Space Mono",
                    cursor: "pointer",
                  }}
                >
                  <Plus size={14} />
                  ADD_CANDIDATE
                </button>
              )}
            </div>
          )}
        </div>

        {/* Add Candidate Modal */}
        {showAddForm && id && (
          <CandidateIntakeModal
            pipelineId={id}
            onClose={() => setShowAddForm(false)}
            onSuccess={(candidateId) => {
              console.log("[OverviewPage] Candidate created:", candidateId);
              setShowAddForm(false);
              void refetch();
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
            items={displayStages.map((s) => s.id)}
            strategy={horizontalListSortingStrategy}
          >
            {displayStages.map((s) => {
              const stageCandidates = candidatesByStage[s.id] ?? [];

              return (
                <SortableStage key={s.id} id={s.id} disabled={!isDraft}>
                  {/* Stage Header — direct child of the plain SortableStage outer div.
                      The SortableStage outer div has no ARIA role="button", so
                      `[data-testid="stage-card"].locator("..")` resolves to a plain div
                      that also contains the candidate cards. The delete button is
                      absolutely positioned relative to the column (position:relative). */}
                  <div style={{ position: "relative" }}>
                    <StageHeaderCard
                      stage={s}
                      candidates={stageCandidates}
                      isActive={false}
                      onClick={() => navigate(`/pipeline/${id}/stages/${s.id}`)}
                    />
                    {isDraft && (
                      <div style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        display: "flex",
                        gap: 4,
                      }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfigStageId(s.id);
                          }}
                          title="Configure stage"
                          style={{
                            width: 28,
                            height: 28,
                            background: "rgba(167,139,250,0.08)",
                            border: "1px solid rgba(167,139,250,0.2)",
                            borderRadius: 6,
                            color: "rgba(167,139,250,0.5)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                        >
                          <Settings size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteStage(s.id, s.title ?? "Stage");
                          }}
                          title="Delete this stage"
                          style={{
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
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Candidate Cards — direct child of the column div, sibling of header. */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      minHeight: 100,
                    }}
                  >
                    {stageCandidates.map((candidate) => (
                      <CandidateKanbanCard
                        key={candidate.id}
                        candidate={candidate}
                        onClick={() => navigate(`/candidates/${candidate.id}`)}
                        onRefresh={handleRefreshLink}
                        disabled={!isActivePipeline}
                      />
                    ))}

                    {stageCandidates.length === 0 && (
                      <div
                        style={{
                          height: 120,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "1px dashed var(--pipe-border)",
                          borderRadius: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 8,
                            letterSpacing: "0.2em",
                            color: "var(--pipe-text-dim)",
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

          {/* Add Stage Column — only visible on DRAFT pipelines */}
          {isDraft && (
            <div style={{ flex: "0 0 320px" }}>
              {isAddingStage ? (
                <div
                  style={{
                    width: "100%",
                    padding: 20,
                    background: "var(--pipe-surface)",
                    border: "1px solid var(--pipe-border)",
                    borderRadius: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <label
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: "0.15em",
                      color: "var(--pipe-text-dim)",
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    STAGE_NAME
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={newStageTitle}
                    onChange={(e) => setNewStageTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddStage();
                      if (e.key === "Escape") {
                        setIsAddingStage(false);
                        setNewStageTitle("");
                      }
                    }}
                    placeholder="e.g. Screening"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: 11,
                      fontFamily: '"Space Mono", monospace',
                      background: "rgba(0,0,0,0.2)",
                      border: "1px solid var(--pipe-border)",
                      borderRadius: 4,
                      color: "var(--pipe-text)",
                      outline: "none",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => {
                        setIsAddingStage(false);
                        setNewStageTitle("");
                      }}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        fontFamily: '"Space Mono", monospace',
                        background: "var(--pipe-surface)",
                        border: "1px solid var(--pipe-border)",
                        borderRadius: 4,
                        color: "var(--pipe-text-dim)",
                        cursor: "pointer",
                      }}
                    >
                      CANCEL
                    </button>
                    <button
                      onClick={() => void handleAddStage()}
                      disabled={!newStageTitle.trim()}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        fontFamily: '"Space Mono", monospace',
                        background: newStageTitle.trim()
                          ? "rgba(167,139,250,0.15)"
                          : "var(--pipe-surface)",
                        border: newStageTitle.trim()
                          ? "1px solid rgba(167,139,250,0.3)"
                          : "1px solid var(--pipe-border)",
                        borderRadius: 4,
                        color: newStageTitle.trim()
                          ? "#a78bfa"
                          : "var(--pipe-text-dim)",
                        cursor: newStageTitle.trim() ? "pointer" : "default",
                        opacity: newStageTitle.trim() ? 1 : 0.5,
                      }}
                    >
                      CREATE
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsAddingStage(true)}
                  style={{
                    width: "100%",
                    height: 180,
                    background: "var(--pipe-surface)",
                    border: "1px dashed rgba(255,255,255,0.1)",
                    borderRadius: 12,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    color: "var(--pipe-text-dim)",
                    cursor: "pointer",
                    transition: "all 0.2s",
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
              )}
            </div>
          )}
        </div>
      </div>

      <DragOverlay
        dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: "0.5" } },
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
