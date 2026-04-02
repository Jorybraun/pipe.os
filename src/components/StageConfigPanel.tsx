/**
 * StageConfigPanel — Slide-out panel for configuring a stage's type,
 * scheduling, and video meeting settings.
 *
 * Follows the DisplaySettingsPanel pattern: header + scrollable content + footer.
 * Renders in the Layout agentPanel slot (left side, same as Display Settings).
 */

import { useState, useEffect } from 'react';
import { X, Save, Calendar, Video, Phone, Users, Code, FileText, Zap } from 'lucide-react';
import { STAGE_TYPE_CONFIGS, STAGE_TYPES, type StageType } from '../lib/stageTemplates';
import { useStageMutations } from '../hooks/useStageMutations';
import { useStageDetail } from '../hooks/useStageDetail';

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

export function StageConfigPanel({ stageId, onClose }: StageConfigPanelProps): JSX.Element {
  const { stage, isLoading } = useStageDetail(stageId);
  const { updateStage } = useStageMutations();

  const [stageType, setStageType] = useState<StageType | null>(null);
  const [isScheduled, setIsScheduled] = useState(false);
  const [isVideoMeeting, setIsVideoMeeting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Sync local state when stage data loads
  useEffect(() => {
    if (stage && !initialized) {
      setStageType((stage.stageType as StageType | null) ?? null);
      setIsScheduled(stage.isScheduled);
      setIsVideoMeeting(stage.mode === 'LIVE_VIDEO');
      setInitialized(true);
    }
  }, [stage, initialized]);

  const hasChanges = stage != null && (
    stageType !== ((stage.stageType as StageType | null) ?? null) ||
    isScheduled !== stage.isScheduled ||
    isVideoMeeting !== (stage.mode === 'LIVE_VIDEO')
  );

  const handleSave = async (): Promise<void> => {
    setIsSaving(true);
    try {
      await updateStage(stageId, {
        stageType: stageType,
        isScheduled,
        mode: isVideoMeeting ? 'LIVE_VIDEO' : 'ASYNC',
      });
      onClose();
    } catch (err) {
      console.error('[StageConfigPanel] save failed:', err);
    } finally {
      setIsSaving(false);
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
        <div>
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
          }}>
            STAGE_CONFIG
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

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Stage type selector */}
        <div>
          <label style={labelStyle}>STAGE_TYPE</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {STAGE_TYPES.map((key) => {
              const config = STAGE_TYPE_CONFIGS[key];
              const Icon = STAGE_TYPE_ICONS[key];
              const isActive = stageType === key;
              return (
                <button
                  key={key}
                  onClick={() => setStageType(isActive ? null : key)}
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
          {stageType && STAGE_TYPE_CONFIGS[stageType].templateQuestions.length > 0 && (
            <div style={{
              marginTop: 8,
              fontSize: 8,
              color: 'var(--pipe-text-dim)',
              letterSpacing: '0.05em',
              opacity: 0.6,
            }}>
              {STAGE_TYPE_CONFIGS[stageType].templateQuestions.length} template questions will be available
            </div>
          )}
        </div>

        {/* Scheduling toggle */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={12} style={{ color: 'var(--pipe-text-dim)' }} />
              <label style={{ ...labelStyle, marginBottom: 0 }}>SCHEDULING_LINK</label>
            </div>
            <ToggleSwitch value={isScheduled} onChange={setIsScheduled} />
          </div>
          <div style={{
            marginTop: 6,
            fontSize: 8,
            color: 'var(--pipe-text-dim)',
            letterSpacing: '0.05em',
            opacity: 0.6,
          }}>
            Candidates receive a scheduling link when moved to this stage
          </div>
        </div>

        {/* Video meeting toggle */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Video size={12} style={{ color: 'var(--pipe-text-dim)' }} />
              <label style={{ ...labelStyle, marginBottom: 0 }}>VIDEO_MEETING</label>
            </div>
            <ToggleSwitch value={isVideoMeeting} onChange={setIsVideoMeeting} />
          </div>
          <div style={{
            marginTop: 6,
            fontSize: 8,
            color: 'var(--pipe-text-dim)',
            letterSpacing: '0.05em',
            opacity: 0.6,
          }}>
            This stage includes a live video meeting
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: 20, borderTop: '1px solid var(--pipe-border)' }}>
        <button
          onClick={() => void handleSave()}
          disabled={!hasChanges || isSaving}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '10px 16px',
            background: hasChanges ? 'rgba(167,139,250,0.15)' : 'var(--pipe-surface)',
            border: hasChanges ? '1px solid rgba(167,139,250,0.3)' : '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: hasChanges ? '#a78bfa' : 'var(--pipe-text-dim)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            cursor: hasChanges && !isSaving ? 'pointer' : 'default',
            opacity: hasChanges ? 1 : 0.5,
            transition: 'all 0.15s',
          }}
        >
          <Save size={11} />
          {isSaving ? 'SAVING...' : 'SAVE_CONFIG'}
        </button>
      </div>
    </div>
  );
}

// ── Toggle switch (matches DisplaySettingsPanel pattern) ────────────────────

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: value ? '#a78bfa' : 'var(--pipe-surface)',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
      }}
    >
      <div style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#fff',
        position: 'absolute',
        top: 2,
        left: value ? 18 : 2,
        transition: 'left 0.2s',
      }} />
    </button>
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
