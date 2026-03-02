import { Code, FileText, Shield, Clock } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface ChallengeListItemData {
  id: string;
  title: string;
  type: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';
  language?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  timeEstimate?: number; // minutes
  tags?: string[];
}

interface ChallengeListItemProps {
  challenge: ChallengeListItemData;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const TYPE_CONFIG = {
  CODE_REVIEW: { label: 'CODE REVIEW', color: '#60a5fa', icon: Code },
  CODE_IMPLEMENTATION: { label: 'IMPLEMENTATION', color: '#a78bfa', icon: Code },
  QUIZ_MCQ: { label: 'MCQ', color: '#4ade80', icon: Shield },
  QUIZ_SHORT_ANSWER: { label: 'SHORT ANSWER', color: '#fbbf24', icon: FileText },
} as const;

const DIFFICULTY_COLORS = {
  EASY: '#4ade80',
  MEDIUM: '#fbbf24',
  HARD: '#f87171',
} as const;

// ============================================================================
// Component
// ============================================================================

/**
 * ChallengeListItem - A single challenge entry in the sidebar list.
 * Displays type badge, title, difficulty, and metadata.
 * Pure visual component — no internal state.
 */
export function ChallengeListItem({
  challenge,
  isSelected,
  onSelect,
}: ChallengeListItemProps): JSX.Element {
  const typeConfig = TYPE_CONFIG[challenge.type] || TYPE_CONFIG.CODE_IMPLEMENTATION;
  const TypeIcon = typeConfig.icon;

  return (
    <button
      onClick={() => onSelect(challenge.id)}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '16px 20px',
        background: isSelected
          ? `linear-gradient(135deg, ${typeConfig.color}08, ${typeConfig.color}04)`
          : 'transparent',
        border: 'none',
        borderLeft: isSelected
          ? `2px solid ${typeConfig.color}`
          : '2px solid transparent',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
      }}
    >
      {/* Type Badge + Language */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 8px',
          background: `${typeConfig.color}12`,
          border: `1px solid ${typeConfig.color}25`,
          borderRadius: 3,
        }}>
          <TypeIcon size={9} color={typeConfig.color} />
          <span style={{
            fontSize: 7,
            fontWeight: 800,
            letterSpacing: '0.12em',
            color: typeConfig.color,
            fontFamily: 'Space Mono, monospace',
          }}>
            {typeConfig.label}
          </span>
        </div>

        {challenge.language && (
          <span style={{
            fontSize: 7,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: 'rgba(255,255,255,0.2)',
            fontFamily: 'Space Mono, monospace',
            textTransform: 'uppercase',
          }}>
            {challenge.language}
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: isSelected ? '#fff' : 'rgba(255,255,255,0.7)',
        lineHeight: 1.4,
        transition: 'color 0.2s',
      }}>
        {challenge.title}
      </div>

      {/* Meta row: difficulty + time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {challenge.difficulty && (
          <span style={{
            fontSize: 8,
            fontWeight: 800,
            letterSpacing: '0.1em',
            color: DIFFICULTY_COLORS[challenge.difficulty],
            fontFamily: 'Space Mono, monospace',
          }}>
            {challenge.difficulty}
          </span>
        )}
        {challenge.timeEstimate && (
          <span style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 9,
            color: 'rgba(255,255,255,0.25)',
            fontFamily: 'Space Mono, monospace',
          }}>
            <Clock size={9} />
            {challenge.timeEstimate}m
          </span>
        )}
      </div>

      {/* Tags */}
      {challenge.tags && challenge.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {challenge.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 7,
                padding: '2px 6px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 2,
                color: 'rgba(255,255,255,0.3)',
                fontFamily: 'Space Mono, monospace',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Selection indicator glow */}
      {isSelected && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: typeConfig.color,
          boxShadow: `0 0 12px ${typeConfig.color}60`,
        }} />
      )}
    </button>
  );
}
