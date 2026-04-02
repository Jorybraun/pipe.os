/**
 * DisplaySettingsPanel — Slide-out panel for user theme/display preferences.
 */

import { X, RotateCcw } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

interface DisplaySettingsPanelProps {
  onClose: () => void;
}

export function DisplaySettingsPanel({ onClose }: DisplaySettingsPanelProps): JSX.Element {
  const { theme, updateBackground, resetTheme } = useTheme();
  const bg = theme.background;

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
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.2em',
          color: 'rgba(255,255,255,0.4)',
        }}>
          DISPLAY_SETTINGS
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.3)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Shader picker */}
        <div>
          <label style={labelStyle}>BACKGROUND_SHADER</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['liquid-metal', 'heatmap'] as const).map((s) => (
              <button
                key={s}
                onClick={() => updateBackground({ shader: s })}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontFamily: '"Space Mono", monospace',
                  background: bg.shader === s ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.03)',
                  border: bg.shader === s ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 4,
                  color: bg.shader === s ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {s.toUpperCase().replace('-', '_')}
              </button>
            ))}
          </div>
        </div>

        {/* Opacity slider */}
        <SliderControl
          label="OPACITY"
          value={bg.opacity}
          min={0}
          max={1}
          step={0.05}
          displayValue={`${Math.round(bg.opacity * 100)}%`}
          onChange={(v) => updateBackground({ opacity: v })}
        />

        {/* Speed slider */}
        <SliderControl
          label="ANIMATION_SPEED"
          value={bg.speed}
          min={0}
          max={1}
          step={0.05}
          displayValue={bg.speed === 0 ? 'STATIC' : `${bg.speed.toFixed(2)}`}
          onChange={(v) => updateBackground({ speed: v })}
        />

        {/* Scale slider */}
        <SliderControl
          label="SCALE"
          value={bg.scale}
          min={0.1}
          max={1.5}
          step={0.05}
          displayValue={`${bg.scale.toFixed(2)}`}
          onChange={(v) => updateBackground({ scale: v })}
        />
      </div>

      {/* Reset button */}
      <div style={{ padding: 20, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={resetTheme}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '10px 16px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 4,
            color: 'rgba(255,255,255,0.4)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={11} />
          RESET_DEFAULTS
        </button>
      </div>
    </div>
  );
}

// ── Shared styles ───────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.15em',
  color: 'rgba(255,255,255,0.3)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 10,
};

// ── Slider sub-component ────────────────────────────────────────────────────

function SliderControl({ label, value, min, max, step, displayValue, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#a78bfa',
          fontFamily: '"Space Mono", monospace',
        }}>
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          accentColor: '#a78bfa',
          cursor: 'pointer',
        }}
      />
    </div>
  );
}
