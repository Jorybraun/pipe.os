/**
 * DisplaySettings — Theme and background controls.
 */

import { RotateCcw } from 'lucide-react';
import { useTheme, type HeatmapColorTheme } from '../../contexts/ThemeContext';

type ColorScheme = 'dark' | 'light';
type ThemeName = 'metalic' | 'heatmap' | 'anatomy';

function deriveScheme(mode: string): ColorScheme {
  return mode === 'dark' || mode === 'anatomy-dark' ? 'dark' : 'light';
}

function deriveThemeName(mode: string, shader: string): ThemeName {
  if (mode === 'anatomy' || mode === 'anatomy-dark') return 'anatomy';
  if (shader === 'heatmap') return 'heatmap';
  return 'metalic';
}

export function DisplaySettings(): JSX.Element {
  const { theme, updateBackground, setMode, resetTheme } = useTheme();
  const bg = theme.background;

  const colorScheme = deriveScheme(theme.mode);
  const themeName = deriveThemeName(theme.mode, bg.shader);

  function applyScheme(scheme: ColorScheme) {
    if (themeName === 'anatomy') {
      setMode(scheme === 'dark' ? 'anatomy-dark' : 'anatomy');
    } else {
      setMode(scheme === 'dark' ? 'dark' : 'light');
    }
  }

  function applyTheme(name: ThemeName) {
    if (name === 'anatomy') {
      setMode(colorScheme === 'dark' ? 'anatomy-dark' : 'anatomy');
    } else {
      setMode(colorScheme === 'dark' ? 'dark' : 'light');
      updateBackground({ shader: name === 'heatmap' ? 'heatmap' : 'liquid-metal' });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Dark / Light tabs */}
        <div>
          <label style={labelStyle}>MODE</label>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--pipe-border)', marginBottom: -1 }}>
            {(['dark', 'light'] as ColorScheme[]).map((s) => (
              <button
                key={s}
                onClick={() => applyScheme(s)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  fontFamily: '"Space Mono", monospace',
                  background: 'none',
                  border: 'none',
                  borderBottom: colorScheme === s
                    ? '2px solid var(--pipe-text)'
                    : '2px solid transparent',
                  color: colorScheme === s ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Theme select */}
        <div>
          <label style={labelStyle}>THEME</label>
          <select
            value={themeName}
            onChange={(e) => applyTheme(e.target.value as ThemeName)}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              fontFamily: '"Space Mono", monospace',
              background: 'var(--pipe-surface-solid)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text)',
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              paddingRight: 32,
            }}
          >
            <option value="metalic">METALIC</option>
            <option value="heatmap">HEAT_MAP</option>
            <option value="anatomy">ANATOMY</option>
          </select>
        </div>

        {/* Background toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>BACKGROUND</label>
          <ToggleSwitch enabled={bg.enabled} onChange={() => updateBackground({ enabled: !bg.enabled })} />
        </div>

        {/* Color theme picker (heatmap only) */}
        {themeName === 'heatmap' && (
          <div>
            <label style={labelStyle}>COLOR_THEME</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([
                { key: 'aurora' as HeatmapColorTheme, label: 'AURORA', colors: ['#c4a8ff', '#ff9999'] },
                { key: 'neon' as HeatmapColorTheme, label: 'NEON', colors: ['#00d4ff', '#0066ff'] },
                { key: 'calm' as HeatmapColorTheme, label: 'CALM', colors: ['#9db4c0', '#c2dfe3'] },
              ]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => updateBackground({ heatmapTheme: t.key })}
                  style={{
                    flex: 1,
                    padding: '10px 6px',
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    fontFamily: '"Space Mono", monospace',
                    background: bg.heatmapTheme === t.key ? 'var(--pipe-accent-surface)' : 'var(--pipe-surface)',
                    border: bg.heatmapTheme === t.key ? '1px solid var(--pipe-accent-border)' : '1px solid var(--pipe-border)',
                    borderRadius: 4,
                    color: bg.heatmapTheme === t.key ? 'var(--pipe-accent)' : 'var(--pipe-text-dim)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', gap: 3 }}>
                    {t.colors.map((c) => (
                      <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
                    ))}
                  </div>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Overlay slider */}
        <SliderControl
          label="DARK_OVERLAY"
          value={bg.overlay}
          min={0} max={1} step={0.05}
          displayValue={`${Math.round(bg.overlay * 100)}%`}
          onChange={(v) => updateBackground({ overlay: v })}
        />

        {/* Opacity slider */}
        <SliderControl
          label="OPACITY"
          value={bg.opacity}
          min={0} max={1} step={0.05}
          displayValue={`${Math.round(bg.opacity * 100)}%`}
          onChange={(v) => updateBackground({ opacity: v })}
        />

        {/* Speed slider */}
        <SliderControl
          label="ANIMATION_SPEED"
          value={bg.speed}
          min={0} max={1} step={0.05}
          displayValue={bg.speed === 0 ? 'STATIC' : `${bg.speed.toFixed(2)}`}
          onChange={(v) => updateBackground({ speed: v })}
        />

        {/* Animate forever toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>KEEP_PLAYING</label>
          <ToggleSwitch enabled={bg.animateForever} onChange={() => updateBackground({ animateForever: !bg.animateForever })} />
        </div>

        {/* Scale slider */}
        <SliderControl
          label="SCALE"
          value={bg.scale}
          min={0.1} max={1.5} step={0.05}
          displayValue={`${bg.scale.toFixed(2)}`}
          onChange={(v) => updateBackground({ scale: v })}
        />
      </div>

      {/* Reset button */}
      <div style={{ padding: 20, borderTop: '1px solid var(--pipe-border)' }}>
        <button
          onClick={resetTheme}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '10px 16px',
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: 'var(--pipe-text-dim)',
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
  color: 'var(--pipe-text-dim)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 10,
};

// ── Toggle switch ──────────────────────────────────────────────────────────

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: () => void }): JSX.Element {
  return (
    <button
      aria-label="Toggle"
      onClick={onChange}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: enabled ? 'var(--pipe-text-muted)' : 'var(--pipe-surface)',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
      }}
    >
      <div style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: 'var(--pipe-bg)',
        position: 'absolute',
        top: 2,
        left: enabled ? 18 : 2,
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

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
          color: 'var(--pipe-text-muted)',
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
          accentColor: 'var(--pipe-text)',
          cursor: 'pointer',
        }}
      />
    </div>
  );
}
