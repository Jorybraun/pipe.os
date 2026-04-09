/**
 * NewStageFormPage — /pipeline/:id/new-stage.
 *
 * Visual type picker → name input → create. The type selection is the first
 * thing you see — large cards with icons and descriptions. Picking a type
 * auto-fills the name (editable) and creates the stage.
 *
 * Stage types:
 *   - CODE_REVIEW  → Multi-turn PR review with AI implementer
 *   - CULTURAL     → AI-conducted behavioral interview (STAR format)
 *   - QUESTIONS    → Mix-and-match question library (technical + non-technical)
 *   - SCREENING    → Initial candidate evaluation (phone/video/online)
 */

import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  GitPullRequest,
  Brain,
  ListChecks,
  Phone,
  ArrowLeft,
} from 'lucide-react';
import { SectionCard } from '../components';
import { useStageMutations } from '../hooks/useStageMutations';
import type { PipelineShellContext } from './PipelineShellPage';

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
      'Candidate reviews a real GitHub PR with planted bugs. An AI implementer responds with pushback, clarification, or fixes. Scored on communication, technical depth, and review practice.',
    icon: GitPullRequest,
    color: '#60a5fa',
  },
  {
    key: 'CULTURAL',
    label: 'Cultural Fit',
    description: 'AI behavioral interview (STAR format)',
    detail:
      'An AI agent conducts a structured behavioral interview. Questions drawn from a curated bank across 5 competency dimensions. Scores against BARS rubrics and compares to your team benchmark.',
    icon: Brain,
    color: '#a78bfa',
  },
  {
    key: 'QUESTIONS',
    label: 'Questions',
    description: 'Technical and non-technical question library',
    detail:
      'Mix and match questions from the library — system design, debugging, trade-offs, leadership, collaboration. Group by topic or create a custom mix. Supports short answer, MCQ, and follow-up formats.',
    icon: ListChecks,
    color: '#4ade80',
  },
  {
    key: 'SCREENING',
    label: 'Screening',
    description: 'Initial candidate evaluation',
    detail:
      'Phone screen, video call, or async online questions. Lightweight first filter before deeper assessment stages.',
    icon: Phone,
    color: '#fbbf24',
  },
];

export default function NewStageFormPage(): JSX.Element {
  const { pipelineId, refetch } = useOutletContext<PipelineShellContext>();
  const navigate = useNavigate();
  const { createStage } = useStageMutations();

  const [selected, setSelected] = useState<StageTypeOption | null>(null);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (option: StageTypeOption): void => {
    setSelected(option);
    setName(option.label);
  };

  const handleCreate = async (): Promise<void> => {
    if (!selected || isSubmitting) return;
    const title = name.trim() || selected.label;
    setIsSubmitting(true);
    setError(null);

    try {
      // Map QUESTIONS → TECHNICAL for the API (same underlying type)
      const stageType = selected.key === 'QUESTIONS' ? 'TECHNICAL' : selected.key;
      const created = await createStage(pipelineId, title, stageType);
      await refetch();
      navigate(`/pipeline/${pipelineId}/stage/${created.id}`);
    } catch (err) {
      console.error('[NewStageFormPage] Failed to create stage:', err);
      setError(err instanceof Error ? err.message : 'Failed to create stage');
      setIsSubmitting(false);
    }
  };

  const handleBack = (): void => {
    if (selected) {
      setSelected(null);
      setName('');
    } else {
      navigate(`/pipeline/${pipelineId}`);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <SectionCard
        label={selected ? 'NAME_YOUR_STAGE' : 'CHOOSE_STAGE_TYPE'}
        icon={
          selected ? (
            <selected.icon size={16} color={selected.color} />
          ) : undefined
        }
        meta={
          <button
            onClick={handleBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text-dim)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.1em',
              fontFamily: mono,
              cursor: 'pointer',
            }}
          >
            <ArrowLeft size={10} />
            {selected ? 'CHANGE_TYPE' : 'CANCEL'}
          </button>
        }
      >
        {!selected ? (
          /* ── Type picker ─────────────────────────────────────────── */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
            }}
          >
            {STAGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                onClick={() => handleSelect(option)}
                style={{
                  padding: '24px 20px',
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
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: `${option.color}12`,
                      border: `1px solid ${option.color}25`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <option.icon size={18} color={option.color} />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: 'var(--pipe-text)',
                        fontFamily: mono,
                      }}
                    >
                      {option.label}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
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
                    fontSize: 10,
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
        ) : (
          /* ── Name input + create ─────────────────────────────────── */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            {/* Selected type summary */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                background: `${selected.color}06`,
                border: `1px solid ${selected.color}20`,
                borderRadius: 10,
              }}
            >
              <selected.icon size={18} color={selected.color} />
              <div>
                <div
                  style={{
                    fontSize: 11,
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
                    fontSize: 9,
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
                htmlFor="new-stage-name"
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
                id="new-stage-name"
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
                  padding: '14px 16px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 8,
                  color: 'var(--pipe-text)',
                  fontSize: 14,
                  fontFamily: mono,
                  outline: 'none',
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
        )}
      </SectionCard>
    </div>
  );
}
