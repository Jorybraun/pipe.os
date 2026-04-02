import { ArrowLeft, Play, Copy, Save, Layers } from 'lucide-react';
import type { EditorChallenge } from './types';

interface EditorHeaderProps {
  challenge: EditorChallenge;
  onChange: (c: EditorChallenge) => void;
  isSaving: boolean;
  isRunning: boolean;
  onBack: () => void;
  onRunTests: () => void;
  onPreview: () => void;
  onPreviewStage?: (() => void) | undefined;
  onClone: () => void;
  onSave: () => void;
}

export function EditorHeader({
  challenge,
  onChange,
  isSaving,
  isRunning,
  onBack,
  onRunTests,
  onPreview,
  onPreviewStage,
  onClone,
  onSave,
}: EditorHeaderProps): JSX.Element {
  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 18px',
    background: 'rgba(255,255,255,0.05)',
    color: 'var(--pipe-text, #fff)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 800,
    fontFamily: 'Space Mono',
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 8, fontFamily: 'Space Mono' }}>
            CHALLENGE_EDITOR / {challenge.type}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <input
              value={challenge.title}
              onChange={(e) => onChange({ ...challenge, title: e.target.value })}
              placeholder="Challenge Title"
              style={{
                background: 'transparent', border: 'none', borderBottom: '2px solid rgba(255,255,255,0.15)',
                fontSize: 28, fontWeight: 800, color: 'var(--pipe-text, #fff)', margin: 0, padding: '8px 0',
                outline: 'none', width: 'auto', minWidth: 400, fontFamily: 'inherit',
                transition: 'border-bottom 0.2s ease',
              }}
              onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'rgba(251,191,36,0.5)')}
              onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'rgba(255,255,255,0.15)')}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', letterSpacing: '0.1em' }}>
                TIME_LIMIT
              </div>
              <input
                type="number"
                value={(challenge.config?.timeLimit as number) || ''}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value) : null;
                  onChange({ ...challenge, config: { ...challenge.config, timeLimit: val } });
                }}
                placeholder="MINS"
                style={{
                  width: 60, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 4, padding: '6px 10px', color: 'var(--pipe-text, #fff)', fontSize: 12,
                  fontFamily: 'Space Mono', textAlign: 'center', outline: 'none',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {challenge.type === 'CODE_IMPLEMENTATION' && (
          <button onClick={onRunTests} disabled={isSaving || isRunning} style={btnStyle}>
            <Play size={16} />
            {isRunning ? 'RUNNING...' : 'RUN_TESTS'}
          </button>
        )}
        <button onClick={onPreview} style={btnStyle}>
          <Play size={16} />
          PREVIEW
        </button>
        {onPreviewStage && (
          <button onClick={onPreviewStage} style={{ ...btnStyle, border: '1px solid rgba(96,165,250,0.3)', color: 'rgba(96,165,250,0.8)' }}>
            <Layers size={16} />
            STAGE
          </button>
        )}
        <button onClick={onClone} disabled={isSaving} style={btnStyle}>
          <Copy size={16} />
          CLONE
        </button>
        <button onClick={onSave} disabled={isSaving} style={{ ...btnStyle, background: '#fff', color: '#000', border: 'none' }}>
          <Save size={16} />
          {isSaving ? 'SAVING...' : 'SAVE'}
        </button>
      </div>
    </div>
  );
}
