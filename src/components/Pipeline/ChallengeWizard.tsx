/**
 * ChallengeWizard — custom challenge creator
 *
 * Renders a type picker + form to create a custom challenge and stage it
 * before saving to the database. Renders inline inside the CHALLENGES
 * SectionCard body.
 *
 * Design: brutalist glassmorphic, Space Mono, pipe design tokens.
 */

import { useState, useCallback } from 'react';
import {
  Code2,
  CircleDot,
  MessageSquare,
  Plus,
  X,
  ArrowLeft,
  Loader2,
  Zap,
} from 'lucide-react';
import { useChallengeMutations } from '../../hooks/useChallengeMutations';
import { useStageRefetch } from '../../contexts/StageRefetchContext';

// ─── Types ──────────────────────────────────────────────────────────────────

interface StagedChallenge {
  id: string;
  type: string;
  title: string;
  instructions: string;
  config: Record<string, unknown>;
  serverConfig?: Record<string, unknown>;
  source: 'custom';
}

// ─── Style tokens ───────────────────────────────────────────────────────────

const mono: React.CSSProperties = {
  fontFamily: '"Space Mono", monospace',
};

const labelStyle: React.CSSProperties = {
  ...mono,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.2em',
  color: 'var(--pipe-text-dim)',
  marginBottom: 10,
  display: 'block',
};

const TYPE_BADGE_COLORS: Record<string, string> = {
  CODE_IMPLEMENTATION: '#a78bfa',
  QUIZ_MCQ: '#4ade80',
  QUIZ_SHORT_ANSWER: '#fbbf24',
  CODE_REVIEW: '#60a5fa',
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }): JSX.Element {
  const color = TYPE_BADGE_COLORS[type] ?? 'var(--pipe-text-dim)';
  const label =
    type === 'CODE_IMPLEMENTATION'
      ? 'CODE'
      : type === 'QUIZ_MCQ'
        ? 'MCQ'
        : type === 'QUIZ_SHORT_ANSWER'
          ? 'LONG-FORM'
          : type;
  return (
    <span
      style={{
        ...mono,
        fontSize: 7,
        fontWeight: 800,
        letterSpacing: '0.15em',
        color,
        padding: '2px 6px',
        borderRadius: 2,
        background: `${color}11`,
        border: `1px solid ${color}33`,
      }}
    >
      {label}
    </span>
  );
}

// ─── Custom question creator ─────────────────────────────────────────────────

function CustomCreator({
  onAdd,
  onBack,
}: {
  onAdd: (item: StagedChallenge) => void;
  onBack: () => void;
}): JSX.Element {
  const [selectedType, setSelectedType] = useState<
    'QUIZ_MCQ' | 'CODE_IMPLEMENTATION' | 'QUIZ_SHORT_ANSWER' | null
  >(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');

  const handleCreate = useCallback(() => {
    if (!selectedType || !title.trim()) return;
    onAdd({
      id: `custom-${Date.now()}`,
      type: selectedType,
      title: title.trim(),
      instructions: instructions.trim() || title.trim(),
      config:
        selectedType === 'QUIZ_MCQ'
          ? { question: instructions.trim() || title.trim(), options: [], correctOptionId: '' }
          : selectedType === 'QUIZ_SHORT_ANSWER'
            ? { question: instructions.trim() || title.trim(), inputMode: 'text' }
            : {},
      source: 'custom',
    });
    setTitle('');
    setInstructions('');
  }, [selectedType, title, instructions, onAdd]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onBack}
          style={{
            ...mono,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            background: 'none',
            border: '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: 'var(--pipe-text-dim)',
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.1em',
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={10} />
          BACK
        </button>
        <label style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>CUSTOM_CHALLENGE</label>
      </div>

      {/* Type picker */}
      <div>
        <label style={labelStyle}>CHALLENGE_TYPE</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['QUIZ_MCQ', 'CODE_IMPLEMENTATION', 'QUIZ_SHORT_ANSWER'] as const).map((type) => {
            const isActive = selectedType === type;
            const color = TYPE_BADGE_COLORS[type] ?? '#fff';
            const Icon =
              type === 'QUIZ_MCQ' ? CircleDot : type === 'CODE_IMPLEMENTATION' ? Code2 : MessageSquare;
            const label =
              type === 'QUIZ_MCQ' ? 'MCQ' : type === 'CODE_IMPLEMENTATION' ? 'CODE' : 'LONG-FORM';
            return (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                style={{
                  ...mono,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  background: isActive ? `${color}0a` : 'var(--pipe-surface)',
                  border: isActive ? `1px solid ${color}55` : '1px solid var(--pipe-border)',
                  color: isActive ? color : 'var(--pipe-text-dim)',
                }}
              >
                <Icon size={12} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {selectedType && (
        <>
          <div>
            <label style={labelStyle}>TITLE</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Challenge title..."
              style={{
                ...mono,
                width: '100%',
                padding: '9px 12px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 6,
                color: 'var(--pipe-text)',
                fontSize: 10,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={labelStyle}>INSTRUCTIONS</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Write the question or instructions..."
              rows={4}
              style={{
                ...mono,
                width: '100%',
                padding: '9px 12px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 6,
                color: 'var(--pipe-text)',
                fontSize: 10,
                outline: 'none',
                resize: 'vertical',
                lineHeight: 1.6,
                boxSizing: 'border-box',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleCreate();
                }
              }}
            />
            <div
              style={{
                ...mono,
                marginTop: 3,
                fontSize: 7,
                color: 'var(--pipe-text-dim)',
                opacity: 0.5,
              }}
            >
              {'\u2318\u21B5'} to add
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!title.trim()}
            style={{
              ...mono,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 20px',
              background: title.trim() ? '#fbbf24' : 'var(--pipe-surface)',
              border: title.trim() ? '1px solid #fbbf24' : '1px solid var(--pipe-border)',
              borderRadius: 6,
              color: title.trim() ? '#0c0c0e' : 'var(--pipe-text-dim)',
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.12em',
              cursor: title.trim() ? 'pointer' : 'not-allowed',
              alignSelf: 'flex-start',
            }}
          >
            <Plus size={11} />
            STAGE_CHALLENGE
          </button>
        </>
      )}
    </div>
  );
}

// ─── Staged queue ───────────────────────────────────────────────────────────

function StagedQueue({
  items,
  onRemove,
  onSave,
  isSaving,
}: {
  items: StagedChallenge[];
  onRemove: (index: number) => void;
  onSave: () => void;
  isSaving: boolean;
}): JSX.Element {
  if (items.length === 0) return <></>;

  return (
    <div
      style={{
        borderTop: '1px solid var(--pipe-border)',
        paddingTop: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <label style={labelStyle}>
        STAGED — {items.length} CHALLENGE{items.length !== 1 ? 'S' : ''}
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {items.map((item, i) => (
          <div
            key={`${item.id}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
            }}
          >
            <TypeBadge type={item.type} />
            <span
              style={{
                ...mono,
                fontSize: 9,
                color: 'var(--pipe-text)',
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.title}
            </span>
            <button
              onClick={() => onRemove(i)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--pipe-text-dim)',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={onSave}
        disabled={isSaving}
        style={{
          ...mono,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '12px 20px',
          background: isSaving ? 'var(--pipe-surface)' : 'var(--pipe-text)',
          border: '1px solid var(--pipe-text)',
          borderRadius: 6,
          color: isSaving ? 'var(--pipe-text-dim)' : 'var(--pipe-bg)',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.15em',
          cursor: isSaving ? 'wait' : 'pointer',
          opacity: isSaving ? 0.6 : 1,
        }}
      >
        {isSaving ? (
          <>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            SAVING...
          </>
        ) : (
          <>
            <Zap size={12} />
            ADD_{items.length}_CHALLENGE{items.length !== 1 ? 'S' : ''}
          </>
        )}
      </button>
    </div>
  );
}

// ─── Main ChallengeWizard ───────────────────────────────────────────────────

export interface ChallengeWizardProps {
  stageId: string;
  onClose: () => void;
}

export function ChallengeWizard({ stageId, onClose }: ChallengeWizardProps): JSX.Element {
  const { createChallenge } = useChallengeMutations();
  const { triggerRefetch } = useStageRefetch();

  const [stagedItems, setStagedItems] = useState<StagedChallenge[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleStage = useCallback((item: StagedChallenge) => {
    setStagedItems((prev) => [...prev, item]);
  }, []);

  const handleRemove = useCallback((index: number) => {
    setStagedItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(async () => {
    if (stagedItems.length === 0) {
      onClose();
      return;
    }
    setIsSaving(true);
    try {
      for (let i = 0; i < stagedItems.length; i++) {
        const item = stagedItems[i]!;
        await createChallenge(stageId, {
          type: item.type as 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER',
          title: item.title,
          instructions: item.instructions,
          config: item.config,
          ...(item.serverConfig ? { serverConfig: item.serverConfig } : {}),
          order: i,
        });
      }
      await triggerRefetch();
      onClose();
    } catch (err) {
      console.error('[ChallengeWizard] Failed to save:', err);
    } finally {
      setIsSaving(false);
    }
  }, [stagedItems, stageId, createChallenge, triggerRefetch, onClose]);

  return (
    <div
      data-testid="challenge-wizard"
      style={{
        paddingTop: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <CustomCreator onAdd={handleStage} onBack={onClose} />

      <StagedQueue
        items={stagedItems}
        onRemove={handleRemove}
        onSave={() => void handleSave()}
        isSaving={isSaving}
      />
    </div>
  );
}
