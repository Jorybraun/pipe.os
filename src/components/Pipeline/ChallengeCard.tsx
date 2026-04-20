import {
  GripVertical,
  Code,
  Shield,
  FileText,
  Trash2,
  Edit3,
  Clock,
  CheckSquare,
  Square,
} from "lucide-react";
import { LiquidMetalCard } from "../ui/LiquidMetalCard";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface ChallengeCardProps {
  challenge: any; // Allow partial/template challenges
  index?: number;
  onEdit?: (challenge: any) => void;
  onDelete?: (challenge: any) => void;
  onClick?: () => void;
  isTemplate?: boolean;
  isSelected?: boolean;
  multiSelect?: boolean;
}

const TYPE_COLORS = {
  CODE_REVIEW: {
    bg: "rgba(59, 130, 246, 0.1)",
    border: "rgba(59, 130, 246, 0.3)",
    text: "#60a5fa",
    icon: Code,
  },
  CODE_IMPLEMENTATION: {
    bg: "rgba(167, 139, 250, 0.1)",
    border: "rgba(167, 139, 250, 0.3)",
    text: "var(--pipe-accent)",
    icon: Code,
  },
  QUIZ_MCQ: {
    bg: "rgba(16, 185, 129, 0.1)",
    border: "rgba(16, 185, 129, 0.3)",
    text: "#34d399",
    icon: Shield,
  },
  QUIZ_SHORT_ANSWER: {
    bg: "rgba(245, 158, 11, 0.1)",
    border: "rgba(245, 158, 11, 0.3)",
    text: "#fbbf24",
    icon: FileText,
  },
};

/**
 * ChallengeCard - Individual challenge item in the pipeline builder.
 */
export function ChallengeCard({
  challenge,
  index,
  onEdit,
  onDelete,
  onClick,
  isTemplate = false,
  isSelected = false,
  multiSelect = false,
}: ChallengeCardProps): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: challenge.id,
    disabled: isTemplate,
  });

  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    padding: 0,
    marginBottom: isTemplate ? 0 : 12,
    borderRadius: 8,
    position: "relative" as const,
    zIndex: isDragging ? 1 : 0,
    cursor: isTemplate ? "pointer" : undefined,
  };

  const typeStyle =
    TYPE_COLORS[challenge.type as keyof typeof TYPE_COLORS] ||
    TYPE_COLORS.QUIZ_MCQ;
  const TypeIcon = typeStyle.icon;

  const config =
    typeof challenge.config === "string"
      ? JSON.parse(challenge.config)
      : challenge.config || {};
  const timeLimit = config.timeLimit;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      data-testid="challenge-card"
      {...(isTemplate && { "data-template-id": challenge.id })}
    >
      <LiquidMetalCard
        variant={isSelected ? "chrome" : "dark"}
        style={{
          padding: 0,
          borderRadius: 8,
          border: isSelected ? "1px solid rgba(255,255,255,0.4)" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {/* Left indicator: Drag handle for stage, or Type icon for template */}
          <div
            {...(isTemplate ? {} : { ...attributes, ...listeners })}
            style={{
              width: 48,
              background: isSelected
                ? "rgba(255,255,255,0.1)"
                : "rgba(255,255,255,0.02)",
              borderRight: "1px solid var(--pipe-border-light)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              cursor: isTemplate ? "pointer" : isDragging ? "grabbing" : "grab",
              borderTopLeftRadius: 8,
              borderBottomLeftRadius: 8,
            }}
          >
            {isTemplate ? (
              <TypeIcon
                size={18}
                color={isSelected ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)"}
              />
            ) : (
              <>
                <GripVertical size={14} color="var(--pipe-text-dim)" />
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: "var(--pipe-text-dim)",
                    fontFamily: "Space Mono",
                  }}
                >
                  {String((index ?? 0) + 1).padStart(2, "0")}
                </div>
              </>
            )}
          </div>

          {/* Content Body */}
          <div style={{ flex: 1, padding: "16px 20px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: "0.15em",
                  padding: "4px 8px",
                  background: typeStyle.bg,
                  border: `1px solid ${typeStyle.border}`,
                  color: typeStyle.text,
                  borderRadius: 3,
                  fontFamily: "Space Mono",
                  textTransform: "uppercase",
                }}
              >
                {challenge.difficulty?.toUpperCase() ||
                  challenge.type?.replace("QUIZ_", "")}
              </div>
              <h4
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--pipe-text, #fff)",
                  margin: 0,
                  lineHeight: 1.3,
                }}
              >
                {challenge.title}
              </h4>
              {timeLimit && (
                <div
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: "var(--pipe-text-dim)",
                    fontFamily: "Space Mono",
                    fontSize: 10,
                  }}
                >
                  <Clock size={12} />
                  <span>{timeLimit}M</span>
                </div>
              )}
            </div>

            <p
              style={{
                fontSize: 11,
                color: isSelected
                  ? "rgba(255,255,255,0.7)"
                  : "var(--pipe-text-dim)",
                lineHeight: 1.6,
                margin: 0,
                display: "-webkit-box",
                WebkitLineClamp: isTemplate ? 1 : 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {challenge.description ||
                challenge.instructions ||
                "No instructions provided."}
            </p>
          </div>

          {/* Actions - Only in non-template mode */}
          {!isTemplate && (onEdit || onDelete) && (
            <div
              style={{
                width: 44,
                borderLeft: "1px solid rgba(255,255,255,0.05)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
              }}
            >
              {multiSelect ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClick?.();
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: isSelected ? "#fff" : "var(--pipe-text-dim)",
                    cursor: "pointer",
                    padding: 8,
                    transition: "color 0.2s",
                  }}
                >
                  {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>
              ) : onEdit ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(challenge);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--pipe-text-dim)",
                    cursor: "pointer",
                    padding: 8,
                    transition: "color 0.2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "rgba(255,255,255,0.3)")
                  }
                >
                  <Edit3 size={14} />
                </button>
              ) : null}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(challenge);
                  }}
                  title="Delete challenge"
                  aria-label="Delete challenge"
                  style={{
                    background: "none",
                    border: "none",
                    color: "rgba(255,80,80,0.4)",
                    cursor: "pointer",
                    padding: 8,
                    transition: "color 0.2s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "#ef4444")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "rgba(255,80,80,0.4)")
                  }
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </LiquidMetalCard>
    </div>
  );
}
