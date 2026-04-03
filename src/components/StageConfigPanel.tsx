/**
 * StageConfigPanel — Multi-step stage configuration wizard.
 *
 * Step 1: Pick a stage type (SCREENING, CULTURAL, TECHNICAL, CODE_REVIEW, PANEL)
 *         → renames the stage, saves the type, swaps to step 2
 * Step 2: Type-specific challenge picker
 *         → browse/add challenges relevant to that type
 *
 * Renders in the Layout agentPanel slot via AppLayout.
 */

import { useState, useEffect, useMemo } from 'react';
import { X, ArrowLeft, Phone, Users, Code, FileText, Zap, Search } from 'lucide-react';
import { STAGE_TYPE_CONFIGS, STAGE_TYPES, type StageType } from '../lib/stageTemplates';
import { useStageMutations } from '../hooks/useStageMutations';
import { useStageDetail } from '../hooks/useStageDetail';
import {
  ALL_CHALLENGE_TEMPLATES,
  type ChallengeTemplate,
  type ChallengeType,
} from '../content/challengeLibrary';
import { useChallengeMutations } from '../hooks/useChallengeMutations';

interface StageConfigPanelProps {
  stageId: string;
  onClose: () => void;
}

const STAGE_TYPE_ICONS: Record<StageType, typeof Phone> = {
  SCREENING: Phone,
  CULTURAL: Users,
  TECHNICAL: Zap,
  CODE_REVIEW: Code,
  PANEL: FileText,
};

/** Map stage types to the challenge types they should show */
const TYPE_TO_CHALLENGE_TYPES: Record<StageType, ChallengeType[]> = {
  SCREENING: ['QUIZ_SHORT_ANSWER', 'FOLLOW_UP'],
  CULTURAL: ['QUIZ_SHORT_ANSWER', 'FOLLOW_UP'],
  TECHNICAL: ['CODE_IMPLEMENTATION', 'QUIZ_SHORT_ANSWER', 'QUIZ_MCQ'],
  CODE_REVIEW: ['CODE_REVIEW'],
  PANEL: ['QUIZ_SHORT_ANSWER', 'FOLLOW_UP'],
};

export function StageConfigPanel({ stageId, onClose }: StageConfigPanelProps): JSX.Element {
  const { stage, isLoading, refetch } = useStageDetail(stageId);
  const { updateStage } = useStageMutations();
  const { createChallenge } = useChallengeMutations();

  const [selectedType, setSelectedType] = useState<StageType | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Sync from server on load
  useEffect(() => {
    if (stage && !initialized) {
      setSelectedType((stage.stageType as StageType | null) ?? null);
      setInitialized(true);
    }
  }, [stage, initialized]);

  const handleSelectType = async (type: StageType): Promise<void> => {
    setSelectedType(type);
    // Rename stage + save type
    const config = STAGE_TYPE_CONFIGS[type];
    try {
      await updateStage(stageId, {
        stageType: type,
        title: config.label,
      });
      await refetch();
    } catch (err) {
      console.error('[StageConfigPanel] Failed to update stage type:', err);
    }
  };

  const handleBack = (): void => {
    setSelectedType(null);
  };

  const handleAddChallenge = async (template: ChallengeTemplate): Promise<void> => {
    const count = stage?.challenges?.length ?? 0;
    try {
      await createChallenge(stageId, {
        type: template.type,
        title: template.title,
        instructions: template.instructions,
        config: template.config as Record<string, unknown>,
        order: count,
      });
      await refetch();
    } catch (err) {
      console.error('[StageConfigPanel] Failed to add challenge:', err);
    }
  };

  if (isLoading) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Space Mono", monospace',
        fontSize: 9,
        color: 'var(--pipe-text-dim)',
        letterSpacing: '0.15em',
      }}>
        LOADING...
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '"Space Mono", monospace',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 20px 16px',
        borderBottom: '1px solid var(--pipe-border, rgba(255,255,255,0.06))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {selectedType && (
            <button
              onClick={handleBack}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--pipe-text-dim)',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <div>
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
            }}>
              {selectedType ? STAGE_TYPE_CONFIGS[selectedType].label.toUpperCase() : 'STAGE_CONFIG'}
            </span>
            {stage && (
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--pipe-text)',
                marginTop: 4,
              }}>
                {stage.title}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content — either type picker or challenge picker */}
      {selectedType ? (
        <TypeChallengePicker
          stageType={selectedType}
          onAdd={handleAddChallenge}
          existingCount={stage?.challenges?.length ?? 0}
        />
      ) : (
        <TypeSelector onSelect={(t) => void handleSelectType(t)} currentType={(stage?.stageType as StageType | null) ?? null} />
      )}
    </div>
  );
}

// ── Step 1: Type selector ───────────────────────────────────────────────────

function TypeSelector({ onSelect, currentType }: {
  onSelect: (type: StageType) => void;
  currentType: StageType | null;
}): JSX.Element {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <label style={labelStyle}>STAGE_TYPE</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {STAGE_TYPES.map((key) => {
            const config = STAGE_TYPE_CONFIGS[key];
            const Icon = STAGE_TYPE_ICONS[key];
            const isActive = currentType === key;
            return (
              <button
                key={key}
                onClick={() => onSelect(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontFamily: '"Space Mono", monospace',
                  background: isActive ? 'rgba(167,139,250,0.12)' : 'var(--pipe-surface)',
                  border: isActive ? '1px solid rgba(167,139,250,0.3)' : '1px solid var(--pipe-border)',
                  borderRadius: 4,
                  color: isActive ? '#a78bfa' : 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'left',
                }}
              >
                <Icon size={14} />
                <div>
                  <div>{config.label.toUpperCase()}</div>
                  <div style={{
                    fontSize: 8,
                    fontWeight: 400,
                    letterSpacing: '0.05em',
                    opacity: 0.7,
                    marginTop: 2,
                  }}>
                    {config.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Type-specific challenge picker ──────────────────────────────────

function TypeChallengePicker({ stageType, onAdd, existingCount }: {
  stageType: StageType;
  onAdd: (template: ChallengeTemplate) => Promise<void>;
  existingCount: number;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const challengeTypes = TYPE_TO_CHALLENGE_TYPES[stageType];

  const filtered = useMemo(() => {
    let templates = ALL_CHALLENGE_TEMPLATES.filter((t) =>
      challengeTypes.includes(t.type),
    );
    if (search.trim()) {
      const q = search.toLowerCase();
      templates = templates.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return templates;
  }, [challengeTypes, search]);

  return (
    <>
      {/* Search */}
      <div style={{ padding: '12px 20px 0' }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={12}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--pipe-text-dim)',
            }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search challenges..."
            style={{
              width: '100%',
              padding: '8px 10px 8px 30px',
              fontSize: 10,
              fontFamily: '"Space Mono", monospace',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text)',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Template list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && (
          <div style={{
            padding: 20,
            textAlign: 'center',
            fontSize: 9,
            color: 'var(--pipe-text-dim)',
            letterSpacing: '0.1em',
          }}>
            NO_CHALLENGES_FOUND
          </div>
        )}
        {filtered.map((template) => (
          <button
            key={template.id}
            onClick={() => void onAdd(template)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--pipe-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {template.title}
              </div>
              <div style={{
                fontSize: 8,
                color: 'var(--pipe-text-dim)',
                marginTop: 3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                opacity: 0.6,
              }}>
                {template.description}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--pipe-border)',
        fontSize: 8,
        color: 'var(--pipe-text-dim)',
        letterSpacing: '0.1em',
        textAlign: 'center',
      }}>
        {filtered.length} CHALLENGES — {existingCount} ADDED
      </div>
    </>
  );
}

// ── Shared styles ───────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.15em',
  color: 'var(--pipe-text-dim)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 10,
};
