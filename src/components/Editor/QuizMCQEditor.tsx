import { Shield, ChevronDown, List, Settings, HelpCircle, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../../components';
import { ButtonGroup } from '../ui/ButtonGroup';
import { FollowUpConfiguration } from './FollowUpConfiguration';
import type { EditorFormProps } from './types';

export function QuizMCQEditor({ challenge, onChange }: EditorFormProps): JSX.Element {
  const options = Array.isArray(challenge.config?.options) ? (challenge.config.options as { id: string; text: string }[]) : [];
  const correctId = challenge.serverConfig?.correctOptionId as string | undefined;
  const hasFollowUp = !!challenge.config?.enableFollowUp;

  const setConfig = (patch: Record<string, unknown>) => 
    onChange({ ...challenge, config: { ...challenge.config, ...patch } });

  const addOption = () => {
    const newId = crypto.randomUUID();
    const newOptions = [...options, { id: newId, text: '' }];
    onChange({
      ...challenge,
      config: { ...challenge.config, options: newOptions },
      serverConfig: { ...challenge.serverConfig, options: newOptions },
    });
  };

  const removeOption = (id: string) => {
    const newOptions = options.filter(o => o.id !== id);
    onChange({
      ...challenge,
      config: { ...challenge.config, options: newOptions },
      serverConfig: { ...challenge.serverConfig, options: newOptions },
    });
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
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 40, marginTop: 24, alignItems: "start" }}>
      
      {/* MAIN CONTENT AREA */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        
        {/* Question Input */}
        <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
          <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <MessageSquare size={16} color="#fbbf24" />
              <SubTitle>QUESTION_PROMPT</SubTitle>
            </div>
          </div>
          <textarea
            value={(challenge.config?.question as string) || ''}
            onChange={(e) => setConfig({ question: e.target.value })}
            placeholder="What is the question?"
            style={{
              width: '100%', minHeight: 160, padding: '32px', background: 'transparent',
              border: 'none', color: '#fff', fontSize: 18, fontFamily: 'inherit',
              lineHeight: 1.6, outline: 'none', resize: 'none',
            }}
          />
        </LiquidMetalCard>

        {/* Options Editor */}
        <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
          <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <List size={16} color="#4ade80" />
              <SubTitle>ANSWER_OPTIONS</SubTitle>
            </div>
            <button
              onClick={addOption}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(74,222,128,0.1)',
                border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80', padding: '6px 12px',
                borderRadius: 6, fontSize: 10, fontFamily: 'Space Mono', fontWeight: 700, cursor: 'pointer'
              }}
            >
              <Plus size={12} /> ADD_OPTION
            </button>
          </div>
          <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {options.map((opt, idx) => (
              <div key={opt.id} style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <button
                  onClick={() => onChange({ ...challenge, serverConfig: { ...challenge.serverConfig, correctOptionId: opt.id } })}
                  style={{
                    width: 24, height: 24, borderRadius: '50%', cursor: 'pointer',
                    border: `2px solid ${correctId === opt.id ? '#34d399' : 'rgba(255,255,255,0.1)'}`,
                    background: correctId === opt.id ? '#34d399' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                    boxShadow: correctId === opt.id ? '0 0 10px rgba(52, 211, 153, 0.3)' : 'none',
                  }}
                >
                  {correctId === opt.id && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
                </button>
                <input
                  value={opt.text}
                  onChange={(e) => {
                    const newOptions = [...options];
                    newOptions[idx] = { ...opt, text: e.target.value };
                    onChange({
                      ...challenge,
                      config: { ...challenge.config, options: newOptions },
                      serverConfig: { ...challenge.serverConfig, options: newOptions },
                    });
                  }}
                  placeholder={`Option ${String.fromCharCode(65 + idx)}...`}
                  style={{
                    flex: 1, padding: '16px 20px', background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 14,
                    outline: 'none', transition: 'border-color 0.2s',
                  }}
                />
                <button
                  onClick={() => removeOption(opt.id)}
                  style={{
                    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.2)',
                    cursor: 'pointer', padding: 8, transition: 'color 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#f87171'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.2)'}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </LiquidMetalCard>
      </div>

      {/* CONFIGURATION SIDEBAR */}
      <aside>
        <LiquidMetalCard variant="chrome" style={{ padding: 32, borderRadius: 16 }}>
          
          <div style={{ marginBottom: 40, paddingBottom: 32, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 8 }}>
              Multiple Choice
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
              A single-choice question for quick assessment. Use the radio buttons on the left to mark the correct answer.
            </div>
          </div>

          {sidebarSection('AI_FOLLOW_UP', <ChevronDown size={14} />, (
            <FollowUpConfiguration
              enabled={hasFollowUp}
              onChange={(val) => setConfig({ enableFollowUp: val })}
              accentColor="#fff"
            />
          ))}

          {sidebarSection('EXPLANATION', <HelpCircle size={14} />, (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <textarea
                value={(challenge.serverConfig?.explanation as string) || ''}
                onChange={(e) => onChange({ ...challenge, serverConfig: { ...challenge.serverConfig, explanation: e.target.value } })}
                placeholder="Why is the answer correct?"
                style={{
                  width: '100%', minHeight: 120, padding: '16px', background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', fontSize: 12, 
                  fontFamily: 'inherit', lineHeight: 1.6, outline: 'none', resize: 'vertical',
                }}
              />
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', paddingLeft: 2 }}>
                Shown to candidates after they submit.
              </div>
            </div>
          ))}

        </LiquidMetalCard>
      </aside>
    </div>
  );
}
