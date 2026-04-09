/**
 * PipelineTemplateModal — pick a template to seed an empty pipeline with
 * stages + challenges in one shot.
 *
 * Applies the selected template by sequentially creating each stage and,
 * for each new stage, seeding the stage type's template questions as
 * challenges. Uses the existing `useStageMutations` and
 * `useChallengeMutations` hooks so this flows through the same authed
 * paths as manual creation.
 */

import { useState } from 'react';
import { X, Loader2, ArrowRight } from 'lucide-react';
import { LiquidMetalCard } from './LiquidMetalCard';
import {
  PIPELINE_TEMPLATES,
  resolveTemplate,
  type PipelineTemplate,
} from '../lib/pipelineTemplates';
import { useStageMutations } from '../hooks/useStageMutations';
import { useChallengeMutations } from '../hooks/useChallengeMutations';

interface PipelineTemplateModalProps {
  pipelineId: string;
  onClose: () => void;
  onApplied: (firstStageId: string | null) => void;
}

export function PipelineTemplateModal({
  pipelineId,
  onClose,
  onApplied,
}: PipelineTemplateModalProps): JSX.Element {
  const { createStage } = useStageMutations();
  const { createChallenge } = useChallengeMutations();
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async (template: PipelineTemplate): Promise<void> => {
    setApplyingKey(template.key);
    setError(null);

    try {
      const resolved = resolveTemplate(template);
      let firstStageId: string | null = null;

      for (const stage of resolved) {
        const created = await createStage(pipelineId, stage.title, stage.stageType);
        if (!firstStageId) firstStageId = created.id;

        // Seed the stage's challenges from its type's template questions.
        for (const ch of stage.challenges) {
          await createChallenge(created.id, {
            type: ch.type,
            title: ch.title,
            instructions: ch.instructions,
          });
        }
      }

      onApplied(firstStageId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply template';
      console.error('[PipelineTemplateModal] apply failed:', message);
      setError(message);
      setApplyingKey(null);
    }
  };

  const isApplying = applyingKey !== null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={() => {
        if (!isApplying) onClose();
      }}
    >
      <LiquidMetalCard
        variant="chrome"
        style={{
          width: '100%',
          maxWidth: 640,
          padding: 0,
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div
            style={{
              padding: '24px 32px',
              borderBottom: '1px solid var(--pipe-border-light)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: '0.2em',
                  color: 'var(--pipe-text-dim)',
                  fontFamily: 'Space Mono',
                  marginBottom: 4,
                }}
              >
                PIPELINE_TEMPLATE
              </div>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--pipe-text, #fff)',
                  margin: 0,
                  fontFamily: 'Space Mono',
                }}
              >
                SELECT_TEMPLATE
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={isApplying}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--pipe-text-dim)',
                cursor: isApplying ? 'not-allowed' : 'pointer',
                opacity: isApplying ? 0.4 : 1,
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div
            style={{
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              maxHeight: '60vh',
              overflowY: 'auto',
            }}
          >
            {error && (
              <div
                style={{
                  padding: '10px 14px',
                  fontSize: 10,
                  color: '#ff6b6b',
                  background: 'rgba(255,107,107,0.08)',
                  border: '1px solid rgba(255,107,107,0.2)',
                  borderRadius: 6,
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {error}
              </div>
            )}

            {PIPELINE_TEMPLATES.map((template) => {
              const isThisApplying = applyingKey === template.key;
              const isDisabled = isApplying && !isThisApplying;
              return (
                <button
                  key={template.key}
                  onClick={() => void handleApply(template)}
                  disabled={isApplying}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '16px 18px',
                    background: 'var(--pipe-surface)',
                    borderTop: `1px solid ${isThisApplying ? template.accent : 'var(--pipe-border)'}`,
                    borderRight: `1px solid ${isThisApplying ? template.accent : 'var(--pipe-border)'}`,
                    borderBottom: `1px solid ${isThisApplying ? template.accent : 'var(--pipe-border)'}`,
                    borderLeft: `3px solid ${template.accent}`,
                    borderRadius: 6,
                    color: 'var(--pipe-text)',
                    cursor: isApplying ? 'default' : 'pointer',
                    textAlign: 'left',
                    opacity: isDisabled ? 0.4 : 1,
                    transition: 'all 0.15s',
                    fontFamily: '"Space Mono", monospace',
                  }}
                  onMouseEnter={(e) => {
                    if (!isApplying) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isApplying) {
                      e.currentTarget.style.background = 'var(--pipe-surface)';
                    }
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.1em',
                        color: template.accent,
                        marginBottom: 4,
                      }}
                    >
                      {template.label.toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        letterSpacing: '0.05em',
                        color: 'var(--pipe-text-dim)',
                      }}
                    >
                      {template.description}
                    </div>
                    <div
                      style={{
                        fontSize: 8,
                        letterSpacing: '0.05em',
                        color: 'var(--pipe-text-dim)',
                        marginTop: 6,
                        opacity: 0.7,
                      }}
                    >
                      {template.stages.length} STAGES · SEEDED WITH TEMPLATE QUESTIONS
                    </div>
                  </div>
                  {isThisApplying ? (
                    <Loader2 size={16} color={template.accent} className="animate-spin" />
                  ) : (
                    <ArrowRight size={16} color="var(--pipe-text-dim)" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}
