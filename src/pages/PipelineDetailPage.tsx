import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { LiquidMetalCard, SubTitle } from "../components";
import { generateClient } from 'aws-amplify/data';
import type { Schema } from "../../amplify/data/resource";
import { StageRenderer, StageType } from "../components/Assessment/StageRegistry";

const client = generateClient<Schema>();

/**
 * PipelineDetailPage - Configure assessment pipeline with AI assistance
 * Displays a preview of the stage content and rubric.
 */

// Helper card components
function TimeCard({ duration, label }: { duration: string; label: string }) {
  return (
    <LiquidMetalCard variant="chrome" style={{ padding: 20 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.2em",
          color: "rgba(255,255,255,0.3)",
          marginBottom: 8,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 800,
          background:
            "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {duration}
      </div>
    </LiquidMetalCard>
  );
}

export default function PipelineDetailPage(): JSX.Element {
  const { stage: stageId } = useParams<{ stage: string }>();
  const [stageData, setStageData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStage = useCallback(async () => {
    if (!stageId) return;
    try {
      setIsLoading(true);
      setError(null);
      const { data } = await client.models.Stage.get({ id: stageId });
      setStageData(data);
    } catch (err) {
      console.error("[PipelineDetailPage] Error fetching stage:", err);
      setError(err instanceof Error ? err : new Error("Failed to load stage details"));
    } finally {
      setIsLoading(false);
    }
  }, [stageId]);

  useEffect(() => {
    fetchStage();
  }, [fetchStage]);

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace', fontSize: 10 }}>
        FETCHING_STAGE_DETAILS...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LiquidMetalCard variant="mercury" style={{ maxWidth: 400, padding: 40, textAlign: 'center' }}>
          <div style={{ color: '#f87171', marginBottom: 16, fontSize: 12, fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
            ERROR_LOADING_STAGE
          </div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
            {error.message}
          </p>
          <button
            onClick={() => fetchStage()}
            style={{
              padding: '12px 24px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer'
            }}
          >
            RETRY_CONNECTION
          </button>
        </LiquidMetalCard>
      </div>
    );
  }

  if (!stageData) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace' }}>
        STAGE_NOT_FOUND
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SubTitle>{stageData.type}_PREVIEW</SubTitle>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace' }}>
          ID: {stageData.id}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 32 }}>
        <div style={{ minWidth: 0 }}>
          <StageRenderer
            type={stageData.type as StageType}
            config={stageData.config}
            onSubmissionChange={() => {}} // Read-only preview for recruiter
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              padding: 32,
              background: 'rgba(255, 255, 255, 0.03)',
              backdropFilter: 'blur(40px) saturate(150%)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 16,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Decorative Gradient Glow */}
            <div style={{
              position: 'absolute',
              top: -50,
              right: -50,
              width: 150,
              height: 150,
              background: 'radial-gradient(circle, rgba(139, 92, 246, 0.1) 0%, transparent 70%)',
              filter: 'blur(30px)',
              pointerEvents: 'none'
            }} />

            <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)', marginBottom: 24, fontFamily: '"Space Mono", monospace', fontWeight: 700 }}>
              STAGE_RUBRIC
            </div>
            
            {stageData.type === 'CODE_REVIEW' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Scoring Weights</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.8 }}>
                    • Bugs Found: 50%<br />
                    • Severity Accuracy: 25%<br />
                    • Fix Quality: 25%<br />
                    • False Positives: -10% penalty
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Ground Truth</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.8 }}>
                    This stage contains {stageData.config?.snippets?.length || 0} snippets with predefined bugs.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                Rubric configuration coming soon for {stageData.type} stages.
              </div>
            )}
          </div>

          <TimeCard duration="45m" label="Estimated Duration" />
          
          <button
            style={{
              width: '100%',
              padding: '16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: 'rgba(255,255,255,0.6)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontWeight: 700,
              fontFamily: '"Space Mono", monospace',
              cursor: 'not-allowed',
            }}
          >
            EDIT_STAGE_CONFIG
          </button>
        </div>
      </div>
    </div>
  );
}
