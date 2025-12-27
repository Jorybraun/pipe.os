import React from 'react';
import { Trash2 } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { SubTitle } from '../ui/SubTitle';
import { Toggle } from '../ui/Toggle';

/**
 * Settings tab content - stateless presentation component.
 */
export function SettingsContent({
  allowRerecording,
  preparationTime,
  autoAdvance,
  onAllowRerecordingChange,
  onPreparationTimeChange,
  onAutoAdvanceChange,
  onDelete,
}) {
  return (
    <div>
      <SubTitle>QUESTION_SETTINGS</SubTitle>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Allow Re-recording */}
        <LiquidMetalCard variant="default" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Allow Re-recording</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Candidates can re-record their response before submitting</div>
            </div>
            <Toggle value={allowRerecording} onChange={onAllowRerecordingChange} />
          </div>
        </LiquidMetalCard>

        {/* Preparation Countdown */}
        <LiquidMetalCard variant="default" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Preparation Countdown</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Time given to prepare before recording starts</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{preparationTime}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>SEC</span>
            </div>
          </div>
        </LiquidMetalCard>

        {/* Auto-Advance */}
        <LiquidMetalCard variant="default" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Auto-Advance</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Automatically move to next question after time limit</div>
            </div>
            <Toggle value={autoAdvance} onChange={onAutoAdvanceChange} />
          </div>
        </LiquidMetalCard>

        {/* Danger zone */}
        <div style={{ marginTop: 24 }}>
          <SubTitle>DANGER_ZONE</SubTitle>
          <LiquidMetalCard variant="dark" style={{ padding: 24, marginTop: 16, border: '1px solid rgba(255,80,80,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,80,80,0.9)', marginBottom: 4 }}>Delete Question</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>This action cannot be undone</div>
              </div>
              <button
                onClick={onDelete}
                style={{
                  padding: '10px 20px',
                  background: 'rgba(255,80,80,0.1)',
                  border: '1px solid rgba(255,80,80,0.3)',
                  color: 'rgba(255,80,80,0.9)',
                  fontSize: 9,
                  letterSpacing: '0.15em',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Trash2 size={12} />
                DELETE
              </button>
            </div>
          </LiquidMetalCard>
        </div>
      </div>
    </div>
  );
}
