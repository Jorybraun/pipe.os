import { type ReactNode } from 'react';
import { ChallengeWorkspaceHeader } from './ChallengeWorkspaceHeader';

// ============================================================================
// Types
// ============================================================================

type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';

interface ChallengeWorkspaceProps {
  title: string;
  type: ChallengeType;
  language?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  timeEstimate?: number;
  tags?: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onPreview: () => void;
  children: ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * ChallengeWorkspace - Right panel wrapper that provides header + tab content area.
 * Renders the ChallengeWorkspaceHeader (metadata + tabs) and a content area.
 * The content is passed as children and is expected to match the active tab.
 */
export function ChallengeWorkspace({
  title,
  type,
  language,
  difficulty,
  timeEstimate,
  tags,
  activeTab,
  onTabChange,
  onPreview,
  children,
}: ChallengeWorkspaceProps): JSX.Element {
  return (
    <div style={{
      flex: 1,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      background: 'rgba(12, 12, 14, 0.3)',
    }}>
      <ChallengeWorkspaceHeader
        title={title}
        type={type}
        language={language}
        difficulty={difficulty}
        timeEstimate={timeEstimate}
        tags={tags}
        activeTab={activeTab}
        onTabChange={onTabChange}
        onPreview={onPreview}
      />

      {/* Tab content area */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}>
        {children}
      </div>
    </div>
  );
}
