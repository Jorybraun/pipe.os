import { type ReactNode } from 'react';
import { ChallengeWorkspaceHeader } from './ChallengeWorkspaceHeader';
import { Copy, Save } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface ChallengeWorkspaceProps {
  challenge: {
    id: string;
    title: string;
    type: string;
    isSystem?: boolean;
    config?: any;
    difficulty?: string;
    timeEstimate?: number;
    tags?: string[];
    [key: string]: any;
  };
  activeTab: string;
  onTabChange: (tab: string) => void;
  onSave?: (updates: any) => void;
  onClone?: (challenge: any) => void;
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
  challenge,
  activeTab,
  onTabChange,
  onSave,
  onClone,
  children,
}: ChallengeWorkspaceProps): JSX.Element {
  return (
    <div style={{
      flex: 1,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      background: 'rgba(255,255,255,0.01)',
    }}>
      <ChallengeWorkspaceHeader
        title={challenge.title}
        type={challenge.type as any}
        difficulty={challenge.difficulty as any}
        timeEstimate={challenge.timeEstimate}
        tags={challenge.tags}
        activeTab={activeTab}
        onTabChange={onTabChange}
        onPreview={() => onTabChange('preview')}
      />

      {/* Tab content area */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
        padding: '32px 40px',
        position: 'relative',
      }}>
        {children}

        {/* Floating action bar for System templates or editable challenges */}
        <div style={{
          position: 'fixed',
          bottom: 32,
          right: 32,
          display: 'flex',
          gap: 12,
          zIndex: 10,
        }}>
          {challenge.isSystem ? (
            <button
              onClick={() => onClone?.(challenge)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 24px',
                background: '#fff',
                color: '#000',
                border: 'none',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 800,
                fontFamily: 'Space Mono, monospace',
                cursor: 'pointer',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              <Copy size={14} />
              CLONE_TO_EDIT
            </button>
          ) : (
            <button
              onClick={() => onSave?.({})} 
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 24px',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                backdropFilter: 'blur(10px)',
                color: '#fff',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 800,
                fontFamily: 'Space Mono, monospace',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
              }}
            >
              <Save size={14} />
              SAVE_CHANGES
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

