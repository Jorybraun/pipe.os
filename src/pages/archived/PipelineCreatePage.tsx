import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePipelineCreate, type PipelineLevel } from "../../hooks/usePipelineCreate";
import { LiquidMetalCard } from "../../components/ui/LiquidMetalCard";
import { FieldGroup, SelectInput } from "../../components/ui/form";
import { TextInput } from "../../components/ui/form";
import { TextareaInput } from "../../components/ui/form";
import { Loader2 } from "lucide-react";

const LEVEL_OPTIONS: PipelineLevel[] = [
  "Junior",
  "Mid",
  "Senior",
  "Staff",
  "Principal",
  "Lead",
  "Manager",
];

/**
 * PipelineCreatePage - Simplified pipeline creation form.
 *
 * Route: /pipeline/new
 * Creates a BLANK pipeline via the Worker API. The Worker handles all
 * server-side setup; no client-side stage scaffolding is needed.
 */
export default function PipelineCreatePage(): JSX.Element {
  const navigate = useNavigate();
  const { create, isCreating, error: apiError } = usePipelineCreate();
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<PipelineLevel>("Senior");
  const [description, setDescription] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const titleTrimmed = title.trim();
  const isValid = titleTrimmed.length >= 1 && titleTrimmed.length <= 100;
  const error = localError ?? apiError;

  const handleCreate = async (): Promise<void> => {
    if (!isValid) {
      if (titleTrimmed.length === 0) {
        setLocalError("Pipeline name is required");
      }
      return;
    }
    if (isCreating) return;
    setLocalError(null);

    try {
      const descriptionTrimmed = description.trim();
      const pipelineId = await create({
        title: titleTrimmed,
        level,
        ...(descriptionTrimmed.length > 0 && { description: descriptionTrimmed }),
        status: "DRAFT",
        creationMode: "BLANK",
      });

      navigate(`/pipeline/${pipelineId}`);
    } catch (err) {
      // apiError is set by the hook; surface it via the error display below.
      console.error("[PipelineCreatePage] Failed to create pipeline:", err);
    }
  };

  return (
    <div
      style={{
        maxWidth: 600,
        margin: "80px auto",
        padding: "0 24px",
      }}
    >
      <div style={{ marginBottom: 40 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: "0.2em",
            color: "var(--pipe-text-dim)",
            marginBottom: 12,
            fontFamily: "Space Mono",
          }}
        >
          NEW_PIPELINE
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: "var(--pipe-text, #fff)",
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          Create a Pipeline
        </h1>
      </div>

      <LiquidMetalCard variant="chrome" style={{ padding: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {/* Name */}
          <div>
            <FieldGroup label="PIPELINE NAME">
              <TextInput
                value={title}
                onChange={setTitle}
                placeholder="e.g. Senior Frontend Engineer"
              />
            </FieldGroup>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 6,
              }}
            >
              {titleTrimmed.length > 100 ? (
                <span
                  style={{
                    fontSize: 10,
                    color: "#f87171",
                    fontFamily: "Space Mono",
                  }}
                >
                  Name must be 100 characters or fewer
                </span>
              ) : (
                <span />
              )}
              <span
                style={{
                  fontSize: 10,
                  color:
                    titleTrimmed.length > 100
                      ? "#f87171"
                      : "var(--pipe-text-dim)",
                  fontFamily: "Space Mono",
                  marginLeft: "auto",
                }}
              >
                {titleTrimmed.length}/100
              </span>
            </div>
          </div>

          {/* Level */}
          <FieldGroup label="EXPERIENCE LEVEL">
            <SelectInput
              value={level}
              onChange={(val) => setLevel(val as PipelineLevel)}
              options={LEVEL_OPTIONS}
            />
          </FieldGroup>

          {/* Description */}
          <div>
            <FieldGroup label="DESCRIPTION (OPTIONAL)">
              <TextareaInput
                value={description}
                onChange={setDescription}
                placeholder="What role is this pipeline evaluating?"
                rows={3}
              />
            </FieldGroup>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 6,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color:
                    description.length > 500
                      ? "#f87171"
                      : "var(--pipe-text-dim)",
                  fontFamily: "Space Mono",
                }}
              >
                {description.length}/500
              </span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                padding: "12px 16px",
                background: "rgba(248,113,113,0.1)",
                border: "1px solid rgba(248,113,113,0.3)",
                borderRadius: 4,
                fontSize: 12,
                color: "#f87171",
                fontFamily: "Space Mono",
              }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 12,
              paddingTop: 8,
            }}
          >
            <button
              onClick={() => navigate("/")}
              disabled={isCreating}
              style={{
                padding: "12px 24px",
                background: "transparent",
                border: "1px solid var(--pipe-border)",
                color: "var(--pipe-text-muted)",
                fontSize: 10,
                letterSpacing: "0.12em",
                fontWeight: 700,
                fontFamily: "Space Mono",
                cursor: isCreating ? "not-allowed" : "pointer",
              }}
            >
              CANCEL
            </button>
            <button
              onClick={handleCreate}
              disabled={isCreating}
              style={{
                padding: "12px 32px",
                background:
                  isValid && !isCreating
                    ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
                    : "rgba(255,255,255,0.05)",
                border: "1px solid var(--pipe-border)",
                color:
                  isValid && !isCreating ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
                fontSize: 10,
                letterSpacing: "0.12em",
                fontWeight: 700,
                fontFamily: "Space Mono",
                cursor: isValid && !isCreating ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "all 0.2s ease",
              }}
            >
              {isCreating ? (
                <>
                  <Loader2
                    size={12}
                    style={{ animation: "spin 1s linear infinite" }}
                  />
                  CREATING...
                </>
              ) : (
                "CREATE PIPELINE"
              )}
            </button>
          </div>
        </div>
      </LiquidMetalCard>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
