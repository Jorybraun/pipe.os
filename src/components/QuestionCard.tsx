import { GripVertical, Video, BarChart3, ChevronRight } from "lucide-react";
import LiquidMetalCard from "./LiquidMetalCard";
import type { Question } from "../types/question";

interface QuestionCardProps {
  question: Question;
  onClick?: () => void;
  index: number;
}

export default function QuestionCard({
  question,
  onClick,
  index,
}: QuestionCardProps) {
  const typeColors = {
    technical: {
      bg: "rgba(100, 180, 255, 0.15)",
      color: "rgba(100, 180, 255, 0.9)",
      border: "rgba(100, 180, 255, 0.3)",
    },
    behavioral: {
      bg: "rgba(255, 180, 100, 0.15)",
      color: "rgba(255, 180, 100, 0.9)",
      border: "rgba(255, 180, 100, 0.3)",
    },
    motivation: {
      bg: "rgba(180, 100, 255, 0.15)",
      color: "rgba(180, 100, 255, 0.9)",
      border: "rgba(180, 100, 255, 0.3)",
    },
    situational: {
      bg: "rgba(100, 255, 180, 0.15)",
      color: "rgba(100, 255, 180, 0.9)",
      border: "rgba(100, 255, 180, 0.3)",
    },
  };

  const typeStyle = typeColors[question.type] || typeColors.technical;

  return (
    <LiquidMetalCard
      variant="chrome"
      hover
      onClick={onClick}
      data-testid="question-card"
    >
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          {/* Drag handle + number */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              style={{
                padding: 4,
                background: "transparent",
                border: "none",
                color: "var(--pipe-text-dim)",
                cursor: "grab",
              }}
            >
              <GripVertical size={16} />
            </button>
            <div
              style={{
                width: 36,
                height: 36,
                background: "var(--pipe-surface)",
                border: "1px solid var(--pipe-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--pipe-text-dim)",
                }}
              >
                {index + 1}
              </span>
            </div>
          </div>

          {/* Content */}
          <div style={{ flex: 1 }}>
            {/* Meta row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  fontSize: 8,
                  letterSpacing: "0.15em",
                  padding: "4px 10px",
                  background: typeStyle.bg,
                  color: typeStyle.color,
                  border: `1px solid ${typeStyle.border}`,
                  textTransform: "uppercase",
                }}
              >
                {question.type}
              </span>
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  color: "var(--pipe-text-dim)",
                }}
              >
                {question.timeLimit} MIN
              </span>
              {question.isRequired && (
                <span
                  style={{
                    fontSize: 8,
                    letterSpacing: "0.1em",
                    color: "rgba(255,100,100,0.7)",
                  }}
                >
                  REQUIRED
                </span>
              )}
            </div>

            {/* Question text */}
            <p
              style={{
                fontSize: 14,
                color: "var(--pipe-text, #fff)",
                lineHeight: 1.6,
                margin: "0 0 16px",
              }}
            >
              {question.text}
            </p>

            {/* Status indicators */}
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              {/* Video status */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {question.hasVideo ? (
                  <>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        background: "rgba(150,255,150,0.8)",
                        boxShadow: "0 0 6px rgba(150,255,150,0.5)",
                      }}
                    />
                    <Video size={12} color="rgba(150,255,150,0.8)" />
                    <span
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        color: "rgba(150,255,150,0.8)",
                      }}
                    >
                      {Math.floor((question.videoDuration ?? 0) / 60)}:
                      {((question.videoDuration ?? 0) % 60)
                        .toString()
                        .padStart(2, "0")}
                    </span>
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        background: "rgba(255,200,100,0.6)",
                      }}
                    />
                    <Video size={12} color="rgba(255,200,100,0.6)" />
                    <span
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        color: "rgba(255,200,100,0.6)",
                      }}
                    >
                      NO VIDEO
                    </span>
                  </>
                )}
              </div>

              {/* Rubric status */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <BarChart3 size={12} color="var(--pipe-text-dim)" />
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    color: "var(--pipe-text-dim)",
                  }}
                >
                  {question.rubric.length} CRITERIA
                </span>
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: "var(--pipe-text-dim)",
            }}
          >
            <ChevronRight size={20} />
          </div>
        </div>
      </div>

      {/* Bottom accent line */}
      <div
        style={{
          height: 2,
          background: question.hasVideo
            ? "linear-gradient(90deg, rgba(150,255,150,0.3), rgba(150,255,150,0.6), rgba(150,255,150,0.3))"
            : "linear-gradient(90deg, rgba(255,200,100,0.2), rgba(255,200,100,0.4), rgba(255,200,100,0.2))",
        }}
      />
    </LiquidMetalCard>
  );
}
