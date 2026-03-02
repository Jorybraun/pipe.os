import { Search, Filter, Plus, Code, Shield, FileText, Zap } from 'lucide-react';
import { ChallengeListItem, type ChallengeListItemData } from './ChallengeListItem';

// ============================================================================
// Types
// ============================================================================

type FilterType = 'ALL' | 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';

interface ChallengeListSidebarProps {
  challenges: ChallengeListItemData[];
  selectedId: string | null;
  searchQuery: string;
  activeFilter: FilterType;
  onSelect: (id: string) => void;
  onSearchChange: (query: string) => void;
  onFilterChange: (filter: FilterType) => void;
  onCreateNew: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const FILTER_TABS: Array<{ id: FilterType; label: string; icon: typeof Zap; color: string }> = [
  { id: 'ALL', label: 'ALL', icon: Zap, color: '#fff' },
  { id: 'CODE_REVIEW', label: 'REVIEW', icon: Code, color: '#60a5fa' },
  { id: 'CODE_IMPLEMENTATION', label: 'CODE', icon: Code, color: '#a78bfa' },
  { id: 'QUIZ_MCQ', label: 'MCQ', icon: Shield, color: '#4ade80' },
  { id: 'QUIZ_SHORT_ANSWER', label: 'TEXT', icon: FileText, color: '#fbbf24' },
];

// ============================================================================
// Component
// ============================================================================

/**
 * ChallengeListSidebar - Left panel containing search, filters, and a scrollable
 * list of challenge items. Pure visual component.
 */
export function ChallengeListSidebar({
  challenges,
  selectedId,
  searchQuery,
  activeFilter,
  onSelect,
  onSearchChange,
  onFilterChange,
  onCreateNew,
}: ChallengeListSidebarProps): JSX.Element {
  return (
    <div style={{
      width: 320,
      minWidth: 320,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(12, 12, 14, 0.6)',
      borderRight: '1px solid rgba(255,255,255,0.04)',
    }}>
      {/* Header */}
      <div style={{
        padding: '24px 20px 0',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}>
          <div>
            <div style={{
              fontSize: 8,
              letterSpacing: '0.2em',
              color: 'rgba(255,255,255,0.25)',
              fontFamily: 'Space Mono, monospace',
              marginBottom: 6,
            }}>
              CHALLENGE_LIBRARY
            </div>
            <div style={{
              fontSize: 16,
              fontWeight: 800,
              color: '#fff',
              letterSpacing: '-0.01em',
            }}>
              Questions
            </div>
          </div>

          <button
            onClick={onCreateNew}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6,
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            title="Create new challenge"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Search */}
        <div style={{
          position: 'relative',
          marginBottom: 16,
        }}>
          <Search
            size={13}
            color="rgba(255,255,255,0.2)"
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search challenges..."
            style={{
              width: '100%',
              padding: '10px 12px 10px 36px',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 6,
              color: '#fff',
              fontSize: 11,
              fontFamily: 'Space Mono, monospace',
              outline: 'none',
              transition: 'border-color 0.2s',
            }}
          />
        </div>

        {/* Filter tabs */}
        <div style={{
          display: 'flex',
          gap: 2,
          marginBottom: 4,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}>
          {FILTER_TABS.map((tab) => {
            const isActive = activeFilter === tab.id;
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => onFilterChange(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 10px',
                  background: isActive ? `${tab.color}12` : 'transparent',
                  border: isActive ? `1px solid ${tab.color}30` : '1px solid transparent',
                  borderRadius: 4,
                  color: isActive ? tab.color : 'rgba(255,255,255,0.3)',
                  fontSize: 7,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  fontFamily: 'Space Mono, monospace',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s',
                }}
              >
                <TabIcon size={9} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div style={{
        height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
        margin: '12px 0 0',
        flexShrink: 0,
      }} />

      {/* Challenge count */}
      <div style={{
        padding: '12px 20px',
        fontSize: 9,
        color: 'rgba(255,255,255,0.2)',
        fontFamily: 'Space Mono, monospace',
        letterSpacing: '0.05em',
        flexShrink: 0,
      }}>
        {challenges.length} challenge{challenges.length !== 1 ? 's' : ''}
      </div>

      {/* Scrollable challenge list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}>
        {challenges.length > 0 ? (
          challenges.map((challenge) => (
            <ChallengeListItem
              key={challenge.id}
              challenge={challenge}
              isSelected={selectedId === challenge.id}
              onSelect={onSelect}
            />
          ))
        ) : (
          <div style={{
            padding: '60px 20px',
            textAlign: 'center',
          }}>
            <Filter size={24} color="rgba(255,255,255,0.08)" style={{ marginBottom: 16 }} />
            <div style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.2)',
              fontFamily: 'Space Mono, monospace',
            }}>
              No challenges match
            </div>
            <div style={{
              fontSize: 9,
              color: 'rgba(255,255,255,0.1)',
              marginTop: 8,
              fontFamily: 'Space Mono, monospace',
            }}>
              Try a different search or filter
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
