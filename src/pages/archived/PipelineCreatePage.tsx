import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../../providers";
import { LiquidMetalCard } from "../../components/ui/LiquidMetalCard";
import { FieldGroup } from "../../components/ui/form";
import { TextInput } from "../../components/ui/form";
import { TextareaInput } from "../../components/ui/form";
import { Loader2 } from "lucide-react";

// Default stage names for new pipelines
const DEFAULT_STAGE_NAMES = [
  "Technical Screen",
  "Technical Assessment",
  "Final Round",
];

/**
 * PipelineCreatePage - Simplified pipeline creation form.
 *
 * Route: /pipeline/new
 * Creates a pipeline with name + description, then scaffolds 3 empty stages.
 */
export default function PipelineCreatePage(): JSX.Element {
  const navigate = useNavigate();
  const dataFactory = useData();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleTrimmed = title.trim();
  const isValid = titleTrimmed.length >= 1 && titleTrimmed.length <= 100;

  const handleCreate = async (): Promise<void> => {
    if (!isValid || isSubmitting) return;
    const client = dataFactory.createClient();
    setIsSubmitting(true);
    setError(null);

    try {
      // 1. Create Pipeline
      const { data: pipeline, errors: pErrors } =
        await client.models.Pipeline.create({
          title: titleTrimmed,
          description: description.trim() || undefined,
          status: "DRAFT",
          creationMode: "PRESET",
        } as any);

      if (pErrors || !pipeline) {
        throw new Error(pErrors?.[0]?.message ?? "Failed to create pipeline");
      }

      // 2. Create 3 empty stages (no challenges — added at stage level)
      for (let i = 0; i < DEFAULT_STAGE_NAMES.length; i++) {
        await client.models.Stage.create({
          pipelineId: (pipeline as { id: string }).id,
          title: DEFAULT_STAGE_NAMES[i] ?? `Stage ${i + 1}`,
          order: i,
        });
      }

      navigate(`/pipeline/${(pipeline as { id: string }).id}`);
    } catch (err) {
      console.error("[PipelineCreatePage] Failed to create pipeline:", err);
      setError(
        err instanceof Error ? err.message : "Failed to create pipeline",
      );
    } finally {
      setIsSubmitting(false);
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
            color: "rgba(255,255,255,0.3)",
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
            color: "#fff",
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
                      : "rgba(255,255,255,0.3)",
                  fontFamily: "Space Mono",
                  marginLeft: "auto",
                }}
              >
                {titleTrimmed.length}/100
              </span>
            </div>
          </div>

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
                      : "rgba(255,255,255,0.3)",
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
              disabled={isSubmitting}
              style={{
                padding: "12px 24px",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.5)",
                fontSize: 10,
                letterSpacing: "0.12em",
                fontWeight: 700,
                fontFamily: "Space Mono",
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              CANCEL
            </button>
            <button
              onClick={handleCreate}
              disabled={!isValid || isSubmitting}
              style={{
                padding: "12px 32px",
                background:
                  isValid && !isSubmitting
                    ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
                    : "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.2)",
                color:
                  isValid && !isSubmitting ? "#fff" : "rgba(255,255,255,0.3)",
                fontSize: 10,
                letterSpacing: "0.12em",
                fontWeight: 700,
                fontFamily: "Space Mono",
                cursor: isValid && !isSubmitting ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "all 0.2s ease",
              }}
            >
              {isSubmitting ? (
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
