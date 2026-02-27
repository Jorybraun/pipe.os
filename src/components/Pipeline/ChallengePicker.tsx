import { X, Code, Shield, FileText, Zap, ArrowRight } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { type ChallengeType } from '../../lib/pipelinePresets';

interface ChallengePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (type: ChallengeType, template?: any) => void;
}

const TYPES = [
  { id: 'CODE_REVIEW', label: 'Code Review', icon: Code, description: 'Identify security, logic, and performance bugs.', color: '#60a5fa' },
  { id: 'CODE_IMPLEMENTATION', label: 'Implementation', icon: Code, description: 'Solve a task using a live editor.', color: '#a78bfa' },
  { id: 'QUIZ_MCQ', label: 'Multiple Choice', icon: Shield, description: 'Knowledge-based assessment.', color: '#34d399' },
  { id: 'QUIZ_SHORT_ANSWER', label: 'Short Answer', icon: FileText, description: 'Free-form written response.', color: '#fbbf24' },
];

/**
 * ChallengePicker - Modal for choosing challenge types and templates.
 */
export function ChallengePicker({ isOpen, onClose, onSelect }: ChallengePickerProps): JSX.Element | null {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    }}>
      <LiquidMetalCard variant="chrome" style={{ maxWidth: 800, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0 }}>
        {/* Header */}
        <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8, fontFamily: 'Space Mono' }}>ADD_NEW_CHALLENGE</div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>Select Challenge Type</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 32, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {TYPES.map(t => (
              <LiquidMetalCard 
                key={t.id} 
                variant="dark" 
                onClick={() => onSelect(t.id as ChallengeType)}
                style={{ padding: 24, cursor: 'pointer', transition: 'all 0.2s' }}
              >
                <div style={{ display: 'flex', gap: 20 }}>
                  <div style={{ 
                    width: 48, 
                    height: 48, 
                    background: 'rgba(255,255,255,0.03)', 
                    border: '1px solid rgba(255,255,255,0.05)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    color: t.color
                  }}>
                    <t.icon size={24} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{t.label}</div>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0, lineHeight: 1.5 }}>{t.description}</p>
                  </div>
                </div>
              </LiquidMetalCard>
            ))}
          </div>

          <div style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <Zap size={14} color="#a78bfa" />
              <div style={{ fontSize: 10, letterSpacing: '0.1em', fontWeight: 700, color: '#fff', fontFamily: 'Space Mono' }}>PRESET_TEMPLATES</div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {['React Hooks Master', 'Security: JWT & Auth', 'Performance Optimization'].map(name => (
                <div key={name} style={{
                  padding: '16px 20px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: 4,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'not-allowed', // Future feature
                  opacity: 0.6
                }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{name}</span>
                  <ArrowRight size={14} color="rgba(255,255,255,0.2)" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}
