import { Shield, List, Settings, Type, Mic, Video as VideoIcon, Code, CheckSquare, Layers } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../../components';
import type { EditorFormProps } from './types';

const QUESTION_TYPES = [
  { id: 'text', label: 'TEXT', icon: Type, desc: 'Written response' },
  { id: 'mcq', label: 'MCQ', icon: CheckSquare, desc: 'Pick from options' },
  { id: 'voice', label: 'VOICE', icon: Mic, desc: 'Spoken answer' },
  { id: 'video', label: 'VIDEO', icon: VideoIcon, desc: 'Record on camera' },
  { id: 'code', label: 'CODE', icon: Code, desc: 'Write a code snippet' },
];

const CATEGORIES = [
  { id: 'WHY', label: 'WHY', color: '#60a5fa', desc: 'Explain reasoning' },
  { id: 'DEPTH', label: 'DEPTH', color: '#4ade80', desc: 'Go deeper on topic' },
  { id: 'FIX', label: 'FIX', color: '#f87171', desc: 'Correct weakness' },
  { id: 'MISSED', label: 'MISSED', color: '#fbbf24', desc: 'Cover blind spots' },
  { id: 'PRIORITISATION', label: 'PRIORITY', color: '#a78bfa', desc: 'Rank trade-offs' },
];

export function FollowUpEditor({ challenge, onChange }: EditorFormProps): JSX.Element {
  const fuConfig = typeof challenge.config === 'object' ? challenge.config : {};
  const questionCount = (fuConfig.questionCount as number) ?? 3;
  const selectedTypes = (fuConfig.questionTypes as string[]) ?? ['text'];
  const selectedCategories = (fuConfig.categories as string[]) ?? ['WHY', 'DEPTH', 'FIX', 'MISSED'];

  const updateFU = (patch: Record<string, unknown>) => onChange({ ...challenge, config: { ...fuConfig, ...patch } });

  const toggleList = (list: string[], id: string) => {
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    return next.length > 0 ? next : list;
  };

  const sidebarSection = (title: string, icon: any, children: React.ReactNode) => (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ color: 'rgba(255,255,255,0.4)' }}>{icon}</div>
        <SubTitle>{title}</SubTitle>
      </div>
      {children}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 0, minHeight: 'calc(100vh - 100px)', margin: '-24px -20px', alignItems: "stretch" }}>
      
      {/* MAIN CONTENT AREA */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: '40px 60px' }}>
        
        {/* Question Types */}
        <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
          <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Layers size={16} color="#a78bfa" />
              <SubTitle>ALLOWED_RESPONSE_FORMATS</SubTitle>
            </div>
            <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>{selectedTypes.length} SELECTED</span>
          </div>
          <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {QUESTION_TYPES.map(({ id, label, icon: Icon, desc }) => {
              const isOn = selectedTypes.includes(id);
              return (
                <button key={id} onClick={() => updateFU({ questionTypes: toggleList(selectedTypes, id) })} style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderRadius: 8, cursor: 'pointer',
                  fontFamily: 'Space Mono', fontSize: 11, textAlign: 'left',
                  border: isOn ? '1px solid rgba(167,139,250,0.5)' : '1px solid rgba(255,255,255,0.1)',
                  background: isOn ? 'rgba(167,139,250,0.1)' : 'rgba(0,0,0,0.1)',
                  color: isOn ? '#fff' : 'rgba(255,255,255,0.4)', transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}>
                  <div style={{ color: isOn ? '#a78bfa' : 'rgba(255,255,255,0.2)' }}><Icon size={18} /></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, letterSpacing: '0.05em' }}>{label}</div>
                    <div style={{ fontSize: 8, opacity: 0.5, marginTop: 2 }}>{desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </LiquidMetalCard>

        {/* Categories */}
        <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
          <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Settings size={16} color="#4ade80" />
              <SubTitle>ACTIVE_PROBING_STRATEGIES</SubTitle>
            </div>
            <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>{selectedCategories.length} ACTIVE</span>
          </div>
          <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {CATEGORIES.map(({ id, label, color, desc }) => {
              const isOn = selectedCategories.includes(id);
              return (
                <button key={id} onClick={() => updateFU({ categories: toggleList(selectedCategories, id) })} style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderRadius: 8, cursor: 'pointer',
                  fontFamily: 'Space Mono', fontSize: 11, textAlign: 'left',
                  border: isOn ? `1px solid ${color}55` : '1px solid rgba(255,255,255,0.1)',
                  background: isOn ? `${color}11` : 'rgba(0,0,0,0.1)',
                  color: isOn ? '#fff' : 'rgba(255,255,255,0.4)', transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: isOn ? color : 'rgba(255,255,255,0.1)',
                    boxShadow: isOn ? `0 0 10px ${color}66` : 'none',
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, letterSpacing: '0.05em' }}>{label}</div>
                    <div style={{ fontSize: 8, opacity: 0.5, marginTop: 2 }}>{desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </LiquidMetalCard>
      </div>

      {/* CONFIGURATION SIDEBAR */}
      <aside style={{ position: "sticky", top: 0, height: "calc(100vh - 100px)" }}>
        <LiquidMetalCard variant="chrome" style={{ padding: '40px 32px', borderRadius: '32px 0 0 0', height: '100%', borderLeft: '1px solid var(--pipe-border)', borderTop: '1px solid var(--pipe-border)' }}>
          
          <div style={{ marginBottom: 40, paddingBottom: 32, borderBottom: '1px solid var(--pipe-border)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--pipe-text, #fff)', marginBottom: 8 }}>
              Follow-Up
            </div>
            <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', lineHeight: 1.6 }}>
              AI analyzes candidate responses in real-time to generate probing questions based on your configured strategies.
            </div>
          </div>

          {sidebarSection('QUESTION_COUNT', <List size={14} />, (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => updateFU({ questionCount: n })} style={{
                    flex: 1, height: 44, borderRadius: 4, cursor: 'pointer', fontFamily: 'Space Mono', fontSize: 14, fontWeight: 800,
                    border: questionCount === n ? '1px solid rgba(251,191,36,0.5)' : '1px solid rgba(255,255,255,0.1)',
                    background: questionCount === n ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.03)',
                    color: questionCount === n ? '#fbbf24' : 'rgba(255,255,255,0.4)', transition: 'all 0.2s',
                  }}>{n}</button>
                ))}
              </div>
              <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontStyle: 'italic' }}>
                Total questions to generate per session.
              </div>
            </div>
          ))}

          {sidebarSection('AUTOMATION', <Shield size={14} />, (
            <div style={{ padding: '16px', background: 'rgba(52, 211, 153, 0.05)', border: '1px solid rgba(52, 211, 153, 0.15)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#34d399', fontWeight: 800, letterSpacing: '0.05em', marginBottom: 4 }}>FULLY_AUTONOMOUS</div>
              <div style={{ fontSize: 9, color: 'rgba(52, 211, 153, 0.7)', lineHeight: 1.5 }}>
                Questions are generated and delivered without manual intervention.
              </div>
            </div>
          ))}

        </LiquidMetalCard>
      </aside>
    </div>
  );
}
