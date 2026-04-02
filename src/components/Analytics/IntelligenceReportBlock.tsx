import React from 'react';
import { LiquidMetalCard, SubTitle } from '../../components';
import { Target, Zap, Shield, TrendingUp, Search, BarChart3, Activity } from 'lucide-react';

/**
 * Registry of block types supported by the AI renderer.
 */
export type IntelligenceBlockType = 
  | 'EXECUTIVE_SUMMARY'
  | 'SKILL_RADAR' 
  | 'HIRE_RECOMMENDATION'
  | 'STRENGTHS_CONCERNS'
  | 'PERFORMANCE_TIMELINE'
  | 'RADIAL_GAUGE'
  | 'KEY_FINDINGS';

export interface IntelligenceBlockConfig {
  id: string;
  type: IntelligenceBlockType;
  title: string;
  data: any;
  priority?: number;
  width?: 'full' | 'half';
}

interface BlockContainerProps {
  config: IntelligenceBlockConfig;
  children: React.ReactNode;
  icon?: React.ReactNode;
  accentColor?: string;
}

const BlockContainer = ({ config, children, icon, accentColor = '#fff' }: BlockContainerProps) => (
  <LiquidMetalCard 
    variant="default" 
    style={{ 
      padding: 0, 
      borderRadius: 16,
      gridColumn: config.width === 'half' ? 'span 1' : 'span 2',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}
  >
    <div style={{ 
      padding: '20px 24px', 
      borderBottom: '1px solid var(--pipe-border)', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between',
      background: 'var(--pipe-surface)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {icon && <div style={{ color: accentColor, opacity: 0.8 }}>{icon}</div>}
        <SubTitle>{config.title.toUpperCase()}</SubTitle>
      </div>
      <div style={{ fontSize: 8, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
        AI_BLOCK_{config.type}
      </div>
    </div>
    <div style={{ padding: '24px', flex: 1 }}>
      {children}
    </div>
  </LiquidMetalCard>
);

/**
 * 4-axis spider/radar chart component.
 */
function SkillRadarChart({ data, color }: { data: Record<string, number>, color: string }): JSX.Element {
  const cx = 100, cy = 100, maxR = 60;
  const entries = Object.entries(data);
  const dims = entries.map(([label], i) => ({
    label,
    angleDeg: (i * 360 / entries.length) - 90
  }));

  const toXY = (value: number, angleDeg: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + (value / 100) * maxR * Math.cos(rad),
      y: cy + (value / 100) * maxR * Math.sin(rad),
    };
  };

  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const dataPoints = dims.map((d, i) => toXY(entries[i][1], d.angleDeg));
  const dataPolygon = dataPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <svg width="240" height="200" viewBox="0 0 200 200">
        {gridLevels.map(level => {
          const pts = dims.map(d => toXY(100 * level, d.angleDeg));
          return <polygon key={level} points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />;
        })}
        {dims.map(d => {
          const end = toXY(100, d.angleDeg);
          return <line key={d.label} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />;
        })}
        <polygon points={dataPolygon} fill={`${color}22`} stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {dataPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />)}
        {dims.map((d, i) => {
          const labelPt = toXY(maxR + 25, d.angleDeg);
          return (
            <text key={d.label} x={labelPt.x} y={labelPt.y} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="Space Mono">
              {d.label.toUpperCase()}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Radial gauge for single metric.
 */
function RadialGauge({ value, color, label }: { value: number, color: string, label: string }): JSX.Element {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;

  return (
    <div style={{ textAlign: 'center' }}>
      <svg width="120" height="120" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset 1s ease-out' }} />
        <text x="50" y="55" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="900" fontFamily="Space Mono">{value}</text>
      </svg>
      <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', marginTop: 8 }}>{label.toUpperCase()}</div>
    </div>
  );
}

export function IntelligenceReportRenderer({ blocks }: { blocks: IntelligenceBlockConfig[] }): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, width: '100%' }}>
      {blocks.sort((a, b) => (a.priority || 0) - (b.priority || 0)).map(block => (
        <IntelligenceBlock key={block.id} config={block} />
      ))}
    </div>
  );
}

function IntelligenceBlock({ config }: { config: IntelligenceBlockConfig }): JSX.Element {
  switch (config.type) {
    case 'EXECUTIVE_SUMMARY':
      return (
        <BlockContainer config={config} icon={<Zap size={16} />} accentColor="#fbbf24">
          <p style={{ fontSize: 15, lineHeight: 1.7, color: 'rgba(255,255,255,0.85)', margin: 0 }}>{config.data.summary}</p>
        </BlockContainer>
      );

    case 'SKILL_RADAR':
      return (
        <BlockContainer config={config} icon={<Activity size={16} />} accentColor="#a78bfa">
          <SkillRadarChart data={config.data.skills} color="#a78bfa" />
        </BlockContainer>
      );

    case 'HIRE_RECOMMENDATION':
      return (
        <BlockContainer config={config} icon={<Target size={16} />} accentColor="#10b981">
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <div style={{ fontSize: 64, fontWeight: 900, color: 'var(--pipe-text, #fff)', lineHeight: 1 }}>{config.data.score}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#10b981', marginBottom: 4 }}>{config.data.signal}</div>
              <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>Based on cross-stage calibration</div>
            </div>
          </div>
        </BlockContainer>
      );

    case 'STRENGTHS_CONCERNS':
      return (
        <BlockContainer config={config} icon={<Shield size={16} />} accentColor="#60a5fa">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ fontSize: 9, color: '#10b981', fontWeight: 800, marginBottom: 12, fontFamily: 'Space Mono' }}>KEY_STRENGTHS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {config.data.strengths.map((s: string, i: number) => <span key={i} style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', borderRadius: 6, fontSize: 11 }}>{s}</span>)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#f87171', fontWeight: 800, marginBottom: 12, fontFamily: 'Space Mono' }}>AREAS_FOR_REVIEW</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {config.data.concerns.map((c: string, i: number) => <span key={i} style={{ padding: '6px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171', borderRadius: 6, fontSize: 11 }}>{c}</span>)}
              </div>
            </div>
          </div>
        </BlockContainer>
      );

    case 'PERFORMANCE_TIMELINE':
      return (
        <BlockContainer config={config} icon={<BarChart3 size={16} />} accentColor="#a78bfa">
          <div style={{ height: 120, display: 'flex', alignItems: 'flex-end', gap: 12, paddingBottom: 20 }}>
            {config.data.points.map((p: any, i: number) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ width: '100%', height: `${p.value}%`, background: 'linear-gradient(180deg, #a78bfa 0%, rgba(167,139,250,0.2) 100%)', borderRadius: '4px 4px 2px 2px' }} />
                <div style={{ fontSize: 8, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>{p.label}</div>
              </div>
            ))}
          </div>
        </BlockContainer>
      );

    case 'RADIAL_GAUGE':
      return (
        <BlockContainer config={config} icon={<Activity size={16} />} accentColor="#60a5fa">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'center' }}>
            {config.data.gauges.map((g: any, i: number) => <RadialGauge key={i} value={g.value} color={g.color || '#60a5fa'} label={g.label} />)}
          </div>
        </BlockContainer>
      );

    case 'KEY_FINDINGS':
      return (
        <BlockContainer config={config} icon={<Search size={16} />} accentColor="#fbbf24">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {config.data.findings.map((f: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '12px', background: 'var(--pipe-surface)', borderRadius: 8, border: '1px solid var(--pipe-border-light)' }}>
                <div style={{ marginTop: 2 }}>{f.icon === 'alert' ? <Shield size={14} color="#f87171" /> : <TrendingUp size={14} color="#fbbf24" />}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text, #fff)', marginBottom: 4 }}>{f.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.5 }}>{f.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </BlockContainer>
      );

    default:
      return <BlockContainer config={config}><pre style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{JSON.stringify(config.data, null, 2)}</pre></BlockContainer>;
  }
}
