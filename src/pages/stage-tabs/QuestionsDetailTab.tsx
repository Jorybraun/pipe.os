/**
 * QuestionsDetailTab — default tab for TECHNICAL stages.
 *
 * Single card: wizard opens inline at top, item list below.
 * Type badges distinguish questions (QUIZ_*) from challenges (CODE_*).
 */

import { useState } from 'react';
import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus, HelpCircle, X } from 'lucide-react';
import { SectionCard } from '../../components';
import { ChallengeWizard } from '../../components/Pipeline/ChallengeWizard';
import type { StagePanelContext } from '../StagePanel';

const mono = '"Space Mono", monospace';

function typeLabel(type: string): string {
  if (type === 'QUIZ_MCQ') return 'MCQ';
  if (type === 'QUIZ_SHORT_ANSWER') return 'SHORT_ANSWER';
  if (type === 'FOLLOW_UP') return 'FOLLOW_UP';
  if (type === 'CODE_IMPLEMENTATION') return 'CHALLENGE';
  if (type === 'CODE_REVIEW') return 'CODE_REVIEW';
  return type;
}

function typeColor(type: string): string {
  if (type === 'QUIZ_MCQ') return '#4ade80';
  if (type === 'QUIZ_SHORT_ANSWER') return '#fbbf24';
  if (type === 'FOLLOW_UP') return '#a78bfa';
  if (type === 'CODE_IMPLEMENTATION') return '#a78bfa';
  return '#60a5fa';
}

function stageMeta(items: { type: string }[]): string {
  const questions = items.filter((c) =>
    c.type === 'QUIZ_SHORT_ANSWER' || c.type === 'QUIZ_MCQ' || c.type === 'FOLLOW_UP',
  ).length;
  const challenges = items.filter((c) =>
    c.type === 'CODE_IMPLEMENTATION' || c.type === 'CODE_REVIEW',
  ).length;

  const parts: string[] = [];
  if (questions > 0) parts.push(`${questions} QUESTION${questions !== 1 ? 'S' : ''}`);
  if (challenges > 0) parts.push(`${challenges} CHALLENGE${challenges !== 1 ? 'S' : ''}`);
  return parts.join(' · ') || '0 ITEMS';
}

export default function QuestionsDetailTab(): JSX.Element {
  const { shell, stage, stageId, refetchStage } = useOutletContext<StagePanelContext>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showWizard, setShowWizard] = useState(() => searchParams.get('adder') === '1');

  const items = [...(stage.challenges ?? [])]
    .filter((c) => c !== null)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <div data-testid="stage-tab-content-questions-detail">
      <SectionCard
        label="STAGE"
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
              ADD
            </button>
          )
        }
      >
        {showWizard && (
          <ChallengeWizard
            stageId={stageId}
            onClose={() => {
              setShowWizard(false);
              void refetchStage();
            }}
          />
        )}

        {items.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: showWizard ? 16 : 0 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--pipe-text-dim)',
                fontFamily: mono,
                letterSpacing: '0.12em',
                padding: '8px 14px 4px',
              }}
            >
              {stageMeta(items)}
            </div>
            {items.map((c, i) => {
              const color = typeColor(c.type);
              const label = typeLabel(c.type);
              return (
                <div
                  key={c.id}
                  onClick={() => navigate(`/pipeline/${shell.pipelineId}/challenges/${c.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--pipe-surface)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
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
                      background: `${color}10`,
                      border: `1px solid ${color}20`,
                      borderRadius: 3,
                      color,
                      fontFamily: mono,
                      letterSpacing: '0.08em',
                      flexShrink: 0,
                    }}
                  >
                    {label}
                  </span>
                  <ChevronRight size={12} color="var(--pipe-text-dim)" style={{ flexShrink: 0 }} />
                </div>
              );
            })}
          </div>
        ) : !showWizard ? (
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
              No questions or challenges yet. Hit ADD to generate with AI or write your own.
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
