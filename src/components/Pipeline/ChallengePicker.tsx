import { useState, useMemo } from 'react';
import { X, Code, Shield, FileText, Search, Filter, Timer, ChevronRight, Zap } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { ALL_CHALLENGE_TEMPLATES, type ChallengeTemplate } from '../../content/challengeLibrary';

interface ChallengePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (template: ChallengeTemplate) => void;
}

const TYPES = [
  { id: 'ALL', label: 'All', icon: Zap, color: '#fff' },
  { id: 'CODE_REVIEW', label: 'Code Review', icon: Code, color: '#60a5fa' },
  { id: 'CODE_IMPLEMENTATION', label: 'Implementation', icon: Code, color: '#a78bfa' },
  { id: 'QUIZ_MCQ', label: 'Multiple Choice', icon: Shield, color: '#34d399' },
  { id: 'QUIZ_SHORT_ANSWER', label: 'Short Answer', icon: FileText, color: '#fbbf24' },
];

/**
 * ChallengePicker - Modal for browsing and selecting challenge templates.
 */
export function ChallengePicker({ isOpen, onClose, onSelect }: ChallengePickerProps): JSX.Element | null {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('ALL');

  const filteredTemplates = useMemo(() => {
    return ALL_CHALLENGE_TEMPLATES.filter(t => {
      const matchesSearch = 
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesType = selectedType === 'ALL' || t.type === selectedType;
      
      return matchesSearch && matchesType;
    });
  }, [searchQuery, selectedType]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(12px)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    }}>
      <LiquidMetalCard variant="chrome" style={{ 
        maxWidth: 900, 
        width: '100%', 
        height: '85vh', 
        display: 'flex', 
        flexDirection: 'column', 
        padding: 0,
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8, fontFamily: 'Space Mono' }}>CHALLENGE_LIBRARY</div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>Select a Template</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Toolbar */}
        <div style={{ 
          padding: '16px 32px', 
          background: 'rgba(255,255,255,0.02)', 
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          gap: 24,
          alignItems: 'center'
        }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)' }} />
            <input 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by title, technology, or tag..."
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 4,
                padding: '10px 16px 10px 36px',
                color: '#fff',
                fontSize: 12,
                outline: 'none',
                fontFamily: 'Space Mono'
              }}
            />
          </div>

          {/* Type Filters */}
          <div style={{ display: 'flex', gap: 8 }}>
            {TYPES.map(t => {
              const isActive = selectedType === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedType(isActive ? 'ALL' : t.id)}
                  style={{
                    padding: '8px 12px',
                    background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                    border: `1px solid ${isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)'}`,
                    borderRadius: 4,
                    color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    fontFamily: 'Space Mono',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.2s'
                  }}
                >
                  <t.icon size={12} color={isActive ? t.color : 'rgba(255,255,255,0.2)'} />
                  {t.label.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Results Grid */}
        <div style={{ padding: 32, overflowY: 'auto', flex: 1 }}>
          {filteredTemplates.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {filteredTemplates.map(t => {
                const typeInfo = TYPES.find(type => type.id === t.type);
                return (
                  <LiquidMetalCard 
                    key={t.id} 
                    variant="dark" 
                    onClick={() => onSelect(t)}
                    style={{ padding: 20, cursor: 'pointer', display: 'flex', flexDirection: 'column', height: '100%' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div style={{ 
                        width: 32, 
                        height: 32, 
                        background: 'rgba(255,255,255,0.03)', 
                        border: '1px solid rgba(255,255,255,0.05)', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        color: typeInfo?.color || '#fff'
                      }}>
                        {typeInfo && <typeInfo.icon size={16} />}
                      </div>
                      <div style={{ 
                        fontSize: 8, 
                        background: 'rgba(255,255,255,0.05)', 
                        padding: '4px 8px', 
                        borderRadius: 2, 
                        color: 'rgba(255,255,255,0.4)',
                        fontFamily: 'Space Mono',
                        fontWeight: 700
                      }}>
                        {t.difficulty.toUpperCase()}
                      </div>
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 6 }}>{t.title}</div>
                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {t.description}
                      </p>
                    </div>

                    <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.3)' }}>
                        <Timer size={12} />
                        <span style={{ fontSize: 10, fontFamily: 'Space Mono' }}>{t.estimatedMinutes}M</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, overflow: 'hidden' }}>
                        {t.tags.slice(0, 2).map(tag => (
                          <span key={tag} style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 2 }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </LiquidMetalCard>
                );
              })}
            </div>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}>
              <Filter size={48} style={{ marginBottom: 20 }} />
              <div style={{ fontSize: 12, fontFamily: 'Space Mono', letterSpacing: '0.1em' }}>NO_MATCHING_TEMPLATES</div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div style={{ padding: '16px 32px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.01)' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Mono' }}>
            {filteredTemplates.length} TEMPLATES_AVAILABLE
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>
            <span>Click card to clone to stage</span>
            <ChevronRight size={14} />
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}
