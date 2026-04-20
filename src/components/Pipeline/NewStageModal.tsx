/**
 * NewStageModal — modal overlay for creating a new stage.
 *
 * Visual type picker → name input → create. Opens over the current page
 * without navigating away. Triggered by the stepper's ADD_STAGE button.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  GitPullRequest,
  Brain,
  ListChecks,
  Phone,
  Video,
  FileText,
  ArrowLeft,
  X,
} from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { useStageMutations } from '../../hooks/useStageMutations';

const mono = '"Space Mono", monospace';

interface StageTypeOption {
  key: string;
  label: string;
  description: string;
  detail: string;
  icon: typeof GitPullRequest;
  color: string;
}

const STAGE_OPTIONS: StageTypeOption[] = [
  {
    key: 'CODE_REVIEW',
    label: 'Code Review',
    description: 'Multi-turn PR review with AI agent',
    detail:
      'Candidate reviews a real GitHub PR with planted bugs. An AI implementer responds with pushback, clarification, or fixes.',
    icon: GitPullRequest,
    color: '#60a5fa',
  },
  {
    key: 'CULTURAL',
    label: 'Cultural Fit',
    description: 'AI behavioral interview (STAR format)',
    detail:
      'AI agent conducts a structured behavioral interview across 5 competency dimensions. Scored against BARS rubrics.',
    icon: Brain,
    color: 'var(--pipe-accent)',
  },
  {
    key: 'QUESTIONS',
    label: 'Questions',
    description: 'Technical and non-technical question library',
    detail:
      'Mix and match from the library — system design, debugging, trade-offs, leadership, collaboration. Short answer, MCQ, follow-up.',
    icon: ListChecks,
    color: '#4ade80',
  },
  {
    key: 'SCREENING',
    label: 'Screening',
    description: 'Initial candidate evaluation',
    detail:
      'Phone screen, video call, or async online questions. Lightweight first filter before deeper stages.',
    icon: Phone,
    color: '#fbbf24',
  },
];

const SCREENING_FORMATS = [
  { key: 'PHONE_CALL' as const, label: 'Phone Screen', icon: Phone, color: '#60a5fa', description: 'Recruiter calls, auto-recorded and transcribed' },
  { key: 'VIDEO_CALL' as const, label: 'Video Call', icon: Video, color: 'var(--pipe-accent)', description: 'Live video meeting in the browser' },
  { key: 'ONLINE' as const, label: 'Online Questions', icon: FileText, color: '#fbbf24', description: 'Async questions — text, voice, or video responses' },
];

export interface NewStageModalProps {
  pipelineId: string;
  onCreated: (stageId: string) => void;
  onClose: () => void;
}

export function NewStageModal({
  pipelineId,
  onCreated,
  onClose,
}: NewStageModalProps): JSX.Element {
  const { createStage } = useStageMutations();

  const [selected, setSelected] = useState<StageTypeOption | null>(null);
  const [screeningFormat, setScreeningFormat] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step: 'pick-type' → 'pick-screening-format' (if screening) → 'name'
  const step = !selected
    ? 'pick-type'
    : selected.key === 'SCREENING' && !screeningFormat
      ? 'pick-screening-format'
      : 'name';

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSelect = (option: StageTypeOption): void => {
    setSelected(option);
    if (option.key !== 'SCREENING') {
      setName(option.label);
    }
  };

  const handleSelectScreeningFormat = (fmt: typeof SCREENING_FORMATS[number]): void => {
    setScreeningFormat(fmt.key);
    setName(fmt.label);
  };

  const handleCreate = useCallback(async (): Promise<void> => {
    if (!selected || isSubmitting) return;
    const title = name.trim() || selected.label;
    setIsSubmitting(true);
    setError(null);

    try {
      const stageType = selected.key === 'QUESTIONS' ? 'TECHNICAL' : selected.key;
      const created = await createStage(pipelineId, title, stageType);
      // If screening with a format, update the stage with the format
      if (selected.key === 'SCREENING' && screeningFormat) {
        await fetch(`/api/v1/stages/${created.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            screeningFormat,
            mode: screeningFormat === 'ONLINE' ? 'ASYNC' : 'LIVE_VIDEO',
          }),
        });
      }
      onCreated(created.id);
    } catch (err) {
      console.error('[NewStageModal] Failed to create stage:', err);
      setError(err instanceof Error ? err.message : 'Failed to create stage');
      setIsSubmitting(false);
    }
  }, [selected, screeningFormat, name, isSubmitting, pipelineId, createStage, onCreated]);

  const handleBack = (): void => {
    if (step === 'name' && selected?.key === 'SCREENING') {
      setScreeningFormat(null);
      setName('');
    } else if (selected) {
      setSelected(null);
      setScreeningFormat(null);
      setName('');
    } else {
      onClose();
    }
  };

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Modal */}
      <LiquidMetalCard
        variant="chrome"
        style={{
          width: '100%',
          maxWidth: 640,
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
          padding: 0,
          background: 'var(--pipe-surface-solid)',
        }}
      >
      <div onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 24px',
            borderBottom: '1px solid var(--pipe-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {selected && (
              <button
                onClick={handleBack}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                }}
              >
                <ArrowLeft size={14} />
              </button>
            )}
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.2em',
                color: selected ? selected.color : 'var(--pipe-text-dim)',
                fontFamily: mono,
              }}
            >
              {step === 'pick-type' ? 'ADD_STAGE' : step === 'pick-screening-format' ? 'SCREENING_FORMAT' : 'NAME_YOUR_STAGE'}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 24 }}>
          {step === 'pick-screening-format' ? (
            /* ── Screening format picker ──────────────────────────── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SCREENING_FORMATS.map((fmt) => (
                <button
                  key={fmt.key}
                  onClick={() => handleSelectScreeningFormat(fmt)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '16px 18px',
                    background: 'var(--pipe-surface)',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = `${fmt.color}40`;
                    e.currentTarget.style.background = `${fmt.color}06`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--pipe-border)';
                    e.currentTarget.style.background = 'var(--pipe-surface)';
                  }}
                >
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: 9,
                      background: `${fmt.color}12`, border: `1px solid ${fmt.color}25`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}
                  >
                    <fmt.icon size={18} color={fmt.color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--pipe-text)', fontFamily: mono }}>
                      {fmt.label}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: mono, lineHeight: 1.5 }}>
                      {fmt.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : step === 'pick-type' ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 10,
              }}
            >
              {STAGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  onClick={() => handleSelect(option)}
                  style={{
                    padding: '20px 18px',
                    background: 'var(--pipe-surface)',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 12,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = `${option.color}40`;
                    e.currentTarget.style.background = `${option.color}06`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--pipe-border)';
                    e.currentTarget.style.background = 'var(--pipe-surface)';
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: `${option.color}12`,
                        border: `1px solid ${option.color}25`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <option.icon size={16} color={option.color} />
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          color: 'var(--pipe-text)',
                          fontFamily: mono,
                        }}
                      >
                        {option.label}
                      </div>
                      <div
                        style={{
                          fontSize: 8,
                          color: 'var(--pipe-text-muted)',
                          fontFamily: mono,
                          letterSpacing: '0.03em',
                        }}
                      >
                        {option.description}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: mono,
                      lineHeight: 1.6,
                    }}
                  >
                    {option.detail}
                  </div>
                </button>
              ))}
            </div>
          ) : selected ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {/* Selected type badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  background: `${selected.color}06`,
                  border: `1px solid ${selected.color}20`,
                  borderRadius: 8,
                }}
              >
                <selected.icon size={16} color={selected.color} />
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: selected.color,
                      fontFamily: mono,
                      letterSpacing: '0.08em',
                    }}
                  >
                    {selected.label.toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontSize: 8,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: mono,
                    }}
                  >
                    {selected.description}
                  </div>
                </div>
              </div>

              {/* Name input */}
              <div>
                <label
                  htmlFor="modal-stage-name"
                  style={{
                    display: 'block',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.15em',
                    color: 'var(--pipe-text-dim)',
                    fontFamily: mono,
                    marginBottom: 8,
                  }}
                >
                  STAGE_NAME
                </label>
                <input
                  id="modal-stage-name"
                  data-testid="new-stage-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={selected.label}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate();
                  }}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    background: 'var(--pipe-surface)',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 8,
                    color: 'var(--pipe-text)',
                    fontSize: 14,
                    fontFamily: mono,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {error && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.25)',
                    borderRadius: 6,
                    color: '#f87171',
                    fontSize: 11,
                    fontFamily: mono,
                  }}
                >
                  {error}
                </div>
              )}

              <button
                onClick={() => void handleCreate()}
                data-testid="new-stage-submit"
                disabled={isSubmitting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  padding: '14px 24px',
                  background: selected.color,
                  border: 'none',
                  borderRadius: 8,
                  color: '#0c0c0e',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.15em',
                  fontFamily: mono,
                  cursor: isSubmitting ? 'wait' : 'pointer',
                  opacity: isSubmitting ? 0.6 : 1,
                  transition: 'opacity 0.15s ease',
                }}
              >
                {isSubmitting ? 'CREATING...' : 'CREATE_STAGE'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      </LiquidMetalCard>
    </div>
  );
}
