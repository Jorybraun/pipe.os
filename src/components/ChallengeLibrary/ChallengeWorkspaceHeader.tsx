import { Code, FileText, Shield, Clock, BarChart2, Tag, Pencil, Play, Eye } from 'lucide-react';
import { TabNav } from '../ui/TabNav';

// ============================================================================
// Types
// ============================================================================

type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';

interface ChallengeWorkspaceHeaderProps {
  title: string;
  type: ChallengeType;
  language?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  timeEstimate?: number;
  tags?: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onPreview: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const TYPE_CONFIG: Record<ChallengeType, { label: string; color: string; icon: typeof Code }> = {
  CODE_REVIEW: { label: 'CODE REVIEW', color: '#60a5fa', icon: Code },
  CODE_IMPLEMENTATION: { label: 'IMPLEMENTATION', color: '#a78bfa', icon: Code },
  QUIZ_MCQ: { label: 'MULTIPLE CHOICE', color: '#4ade80', icon: Shield },
  QUIZ_SHORT_ANSWER: { label: 'SHORT ANSWER', color: '#fbbf24', icon: FileText },
};

const DIFFICULTY_COLORS: Record<string, string> = {
  EASY: '#4ade80',
  MEDIUM: '#fbbf24',
  HARD: '#f87171',
};

const TABS_BY_TYPE: Record<ChallengeType, Array<{ id: string; label: string; icon: typeof Pencil }>> = {
  CODE_REVIEW: [
    { id: 'instructions', label: 'INSTRUCTIONS', icon: FileText },
    { id: 'code', label: 'CODE', icon: Code },
    { id: 'scoring', label: 'SCORING', icon: BarChart2 },
    { id: 'preview', label: 'PREVIEW', icon: Eye },
  ],
  CODE_IMPLEMENTATION: [
    { id: 'instructions', label: 'INSTRUCTIONS', icon: FileText },
    { id: 'code', label: 'CODE', icon: Code },
    { id: 'tests', label: 'TESTS', icon: Play },
    { id: 'preview', label: 'PREVIEW', icon: Eye },
  ],
  QUIZ_MCQ: [
    { id: 'instructions', label: 'QUESTION', icon: FileText },
    { id: 'options', label: 'OPTIONS', icon: Shield },
    { id: 'preview', label: 'PREVIEW', icon: Eye },
  ],
  QUIZ_SHORT_ANSWER: [
    { id: 'instructions', label: 'QUESTION', icon: FileText },
    { id: 'scoring', label: 'RUBRIC', icon: BarChart2 },
    { id: 'preview', label: 'PREVIEW', icon: Eye },
  ],
};

// ============================================================================
// Component
// ============================================================================

/**
 * ChallengeWorkspaceHeader - Top bar showing challenge metadata and tab navigation.
 * Displays type badge, title, difficulty, time estimate, tags, and editor tabs.
 */
export function ChallengeWorkspaceHeader({
  title,
  type,
  language,
  difficulty,
  timeEstimate,
  tags,
  activeTab,
  onTabChange,
  onPreview,
}: ChallengeWorkspaceHeaderProps): JSX.Element {
  const typeInfo = TYPE_CONFIG[type];
  const TypeIcon = typeInfo.icon;
  const rawTabs = TABS_BY_TYPE[type] || TABS_BY_TYPE.CODE_IMPLEMENTATION;

  // Convert raw tabs to TabNav format
  const mappedTabs = rawTabs.map(t => ({
    id: t.id,
    label: t.label,
    icon: <t.icon size={11} />,
  }));

  return (
    <div style={{
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(255, 255, 255, 0.02)',
      flexShrink: 0,
    }}>
      {/* Top row: metadata */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: '24px 32px 16px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Type badge + language */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              background: `${typeInfo.color}15`,
              border: `1px solid ${typeInfo.color}40`,
              borderRadius: 4,
            }}>
              <TypeIcon size={12} color={typeInfo.color} />
              <span style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '0.12em',
                color: typeInfo.color,
                fontFamily: '"Space Mono", monospace',
              }}>
                {typeInfo.label}
              </span>
            </div>

            {language && (
              <span style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: 'rgba(255,255,255,0.4)',
                fontFamily: '"Space Mono", monospace',
                textTransform: 'uppercase',
              }}>
                {language}
              </span>
            )}

            {difficulty && (
              <span style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '0.1em',
                color: DIFFICULTY_COLORS[difficulty] ?? '#fff',
                fontFamily: '"Space Mono", monospace',
              }}>
                ● {difficulty}
              </span>
            )}

            {timeEstimate && (
              <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                color: 'rgba(255,255,255,0.4)',
                fontFamily: '"Space Mono", monospace',
              }}>
                <Clock size={10} />
                {timeEstimate}m
              </span>
            )}
          </div>

          {/* Title */}
          <h2 style={{
            fontSize: 22,
            fontWeight: 800,
            color: '#fff',
            margin: 0,
            letterSpacing: '-0.01em',
            lineHeight: 1.3,
          }}>
            {title}
          </h2>

          {/* Tags */}
          {tags && tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 9,
                    padding: '4px 10px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 4,
                    color: 'rgba(255,255,255,0.4)',
                    fontFamily: '"Space Mono", monospace',
                  }}
                >
                  <Tag size={10} />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Preview button */}
        <button
          onClick={onPreview}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6,
            color: 'rgba(255,255,255,0.8)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            cursor: 'pointer',
            transition: 'all 0.2s',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
        >
          <Eye size={14} />
          PREVIEW
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ paddingLeft: 32, paddingBottom: 0, marginTop: 16 }}>
        <TabNav 
          tabs={mappedTabs}
          activeTab={activeTab}
          onTabChange={onTabChange}
        />
      </div>
    </div>
  );
}

