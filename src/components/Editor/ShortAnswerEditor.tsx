import { Shield, ChevronDown, Type, Video as VideoIcon, Settings, HelpCircle, MessageSquare } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../../components';
import { ButtonGroup } from '../ui/ButtonGroup';
import { NumberInput } from '../ui/NumberInput';
import { QuestionVideoRecorder } from '../Challenge/QuestionVideoRecorder';
import { normalizeShortAnswerConfig } from '../../lib/shortAnswerUtils';
import { FollowUpConfiguration } from './FollowUpConfiguration';
import type { EditorFormProps } from './types';

export function ShortAnswerEditor({ challenge, onChange }: EditorFormProps): JSX.Element {
  const saConfig = normalizeShortAnswerConfig(challenge.config);
  const currentMode = (saConfig as unknown as Record<string, unknown>).inputMode as string ?? 'text';
  const existingVideoKey = (saConfig as unknown as Record<string, unknown>).questionVideoS3Key as string | undefined;
  const hasFollowUp = !!challenge.config?.enableFollowUp;
  const timeLimit = (challenge.config?.timeLimit as number) || 0;

  const setConfig = (patch: Record<string, unknown>) => onChange({ ...challenge, config: { ...challenge.config, ...patch } });

  const responseOptions = [
    { value: 'text', label: 'WRITTEN' },
    { value: 'voice', label: 'VOICE' },
    { value: 'video', label: 'VIDEO' },
  ];

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
          <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <MessageSquare size={16} color="#fbbf24" />
              <SubTitle>CHALLENGE_PROMPT</SubTitle>
            </div>
            <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
              {((challenge.config?.question as string) || '').length} CHARS
            </span>
          </div>
          <textarea
            value={(challenge.config?.question as string) || ''}
            onChange={(e) => setConfig({ question: e.target.value })}
            placeholder="What should the candidate answer?"
            style={{
              width: '100%', minHeight: 320, padding: '32px', background: 'transparent',
              border: 'none', color: 'var(--pipe-text, #fff)', fontSize: 18, fontFamily: 'inherit',
              lineHeight: 1.6, outline: 'none', resize: 'none',
            }}
          />
        </LiquidMetalCard>

        {/* Video Instructions */}
        <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
          <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <VideoIcon size={16} color="var(--pipe-accent)" />
              <SubTitle>VIDEO_INSTRUCTIONS</SubTitle>
            </div>
            {existingVideoKey && (
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 10px #4ade80' }} />
            )}
          </div>
          <div style={{ padding: '32px' }}>
            <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', marginBottom: 24, lineHeight: 1.6, maxWidth: 500 }}>
              Optional: Record a short video to introduce yourself or provide extra context for this question.
            </div>
            <QuestionVideoRecorder
              challengeId={challenge.id}
              {...(existingVideoKey ? { existingS3Key: existingVideoKey } : {})}
              onUploaded={(s3Key) => setConfig({ questionVideoS3Key: s3Key })}
            />
          </div>
        </LiquidMetalCard>
      </div>

      {/* CONFIGURATION SIDEBAR */}
      <aside>
        <LiquidMetalCard variant="chrome" style={{ padding: 32, borderRadius: 16 }}>
          
          {sidebarSection('RESPONSE_TYPE', <Type size={14} />, (
            <ButtonGroup 
              options={responseOptions} 
              selected={currentMode} 
              onChange={(val) => setConfig({ inputMode: val })} 
            />
          ))}

          {sidebarSection('TIME_LIMIT', <Settings size={14} />, (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <NumberInput 
                value={timeLimit} 
                onChange={(val) => setConfig({ timeLimit: val })} 
                min={0} 
                max={60} 
                unit="MIN" 
              />
              <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontStyle: 'italic', paddingLeft: 2 }}>
                Set to 0 for unlimited time.
              </div>
            </div>
          ))}

          {sidebarSection('EVALUATION_RUBRIC', <Shield size={14} />, (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <textarea
                value={(challenge.serverConfig?.idealAnswer as string) || ''}
                onChange={(e) => onChange({ ...challenge, serverConfig: { ...challenge.serverConfig, idealAnswer: e.target.value } })}
                placeholder="Describe a 10/10 answer..."
                style={{
                  width: '100%', minHeight: 140, padding: '16px', background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--pipe-border)', color: 'var(--pipe-text, #fff)', fontSize: 12, 
                  fontFamily: 'inherit', lineHeight: 1.6, outline: 'none', resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.6 }}>
                <HelpCircle size={10} color="#fff" />
                <span style={{ fontSize: 9, fontFamily: 'Space Mono', color: 'var(--pipe-text, #fff)' }}>INTERNAL_ONLY</span>
              </div>
            </div>
          ))}

          {sidebarSection('AI_FOLLOW_UP', <ChevronDown size={14} />, (
            <FollowUpConfiguration
              enabled={hasFollowUp}
              onChange={(val) => setConfig({ enableFollowUp: val })}
              accentColor="#fff"
            />
          ))}

        </LiquidMetalCard>
      </aside>
    </div>
  );
}
