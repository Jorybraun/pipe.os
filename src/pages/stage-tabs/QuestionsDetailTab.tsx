/**
 * QuestionsDetailTab — default tab for TECHNICAL/QUESTIONS stages.
 *
 * Renders the ChallengeWizard (ADR-034 CA Phase 2) inline when
 * EDIT_STAGE is clicked, with a question list below.
 */

import { useState } from 'react';
import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ListChecks,
  ChevronRight,
  Plus,
  HelpCircle,
  X,
} from 'lucide-react';
import { SectionCard } from '../../components';
import { ChallengeWizard } from '../../components/Pipeline/ChallengeWizard';
import type { StagePanelContext } from '../StagePanel';

const mono = '"Space Mono", monospace';

export default function QuestionsDetailTab(): JSX.Element {
  const { shell, stage, stageId, refetchStage } = useOutletContext<StagePanelContext>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showWizard, setShowWizard] = useState(() => searchParams.get('adder') === '1');

  const challenges = [...(stage.challenges ?? [])]
    .filter((c) => c !== null)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <div
      data-testid="stage-tab-content-questions-detail"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Challenge wizard or add button */}
      <SectionCard
        label="CHALLENGES"
        icon={<Plus size={16} color="var(--pipe-text-dim)" />}
        meta={
          showWizard ? (
            <button
              onClick={() => setShowWizard(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                background: 'transparent',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text-dim)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.15em',
                fontFamily: mono,
                cursor: 'pointer',
              }}
            >
              <X size={11} />
              CLOSE
            </button>
          ) : (
            <button
              onClick={() => setShowWizard(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.15em',
                fontFamily: mono,
                cursor: 'pointer',
              }}
            >
              <Plus size={11} />
              ADD_CHALLENGES
            </button>
          )
        }
      >
        {showWizard && (
          <ChallengeWizard
            stageId={stageId}
            roleContextId={shell.roleContext?.id ?? null}
            persona={shell.roleContext?.persona ?? null}
            onClose={() => {
              setShowWizard(false);
              void refetchStage();
            }}
          />
        )}
      </SectionCard>

      {/* Current questions list */}
      <SectionCard
        label="QUESTIONS"
        icon={<ListChecks size={16} color="var(--pipe-text-dim)" />}
        meta={`${challenges.length} QUESTION${challenges.length !== 1 ? 'S' : ''}`}
      >
        {challenges.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {challenges.map((c, i) => {
              const typeColor =
                c.type === 'QUIZ_MCQ'
                  ? '#4ade80'
                  : c.type === 'QUIZ_SHORT_ANSWER'
                    ? '#fbbf24'
                    : c.type === 'FOLLOW_UP'
                      ? '#a78bfa'
                      : '#60a5fa';
              const typeLabel =
                c.type === 'QUIZ_MCQ'
                  ? 'MCQ'
                  : c.type === 'QUIZ_SHORT_ANSWER'
                    ? 'SHORT_ANSWER'
                    : c.type === 'FOLLOW_UP'
                      ? 'FOLLOW_UP'
                      : c.type;

              return (
                <div
                  key={c.id}
                  onClick={() =>
                    navigate(`/pipeline/${shell.pipelineId}/challenges/${c.id}`)
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--pipe-surface)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: mono,
                      width: 20,
                      textAlign: 'right',
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--pipe-text)',
                        fontFamily: mono,
                        marginBottom: 2,
                      }}
                    >
                      {c.title}
                    </div>
                    {c.instructions && (
                      <div
                        style={{
                          fontSize: 9,
                          color: 'var(--pipe-text-dim)',
                          fontFamily: mono,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 400,
                        }}
                      >
                        {c.instructions}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      padding: '2px 8px',
                      background: `${typeColor}10`,
                      border: `1px solid ${typeColor}20`,
                      borderRadius: 3,
                      color: typeColor,
                      fontFamily: mono,
                      letterSpacing: '0.08em',
                      flexShrink: 0,
                    }}
                  >
                    {typeLabel}
                  </span>
                  <ChevronRight size={12} color="var(--pipe-text-dim)" style={{ flexShrink: 0 }} />
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              padding: '40px 24px',
              textAlign: 'center',
              border: '1px dashed rgba(74,222,128,0.2)',
              borderRadius: 10,
              background: 'rgba(74,222,128,0.03)',
            }}
          >
            <HelpCircle size={24} color="rgba(74,222,128,0.4)" style={{ marginBottom: 12 }} />
            <div
              style={{
                fontSize: 11,
                color: 'var(--pipe-text-muted)',
                fontFamily: mono,
                lineHeight: 1.6,
              }}
            >
              No questions added yet. Use the cards above to add from the
              library, generate with AI, or write your own.
            </div>
          </div>
        )}
      </SectionCard>

    </div>
  );
}
