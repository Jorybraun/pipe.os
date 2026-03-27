import { Shield, ChevronDown, Settings } from 'lucide-react';
import { MonacoPanel } from '../Panels/MonacoPanel';
import { LiquidMetalCard, SubTitle } from '../../components';
import { FollowUpConfiguration } from './FollowUpConfiguration';
import type { EditorFormProps } from './types';

export function CodeImplEditor({ challenge, onChange }: EditorFormProps): JSX.Element {
  const codeLanguage = String(challenge.config?.language || 'javascript').toLowerCase();
  const testLanguage = String(challenge.serverConfig?.testLanguage || codeLanguage || 'javascript').toLowerCase();
  const hasFollowUp = !!challenge.config?.enableFollowUp;

  const setConfig = (patch: Record<string, unknown>) => 
    onChange({ ...challenge, config: { ...challenge.config, ...patch } });

  const langSelect = (value: string, onSelect: (v: string) => void) => (
    <select
      value={value}
      onChange={(e) => onSelect(e.target.value)}
      style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
        color: 'rgba(255,255,255,0.7)', fontFamily: 'Space Mono', fontSize: 10,
        padding: '6px 8px', borderRadius: 6, outline: 'none',
      }}
    >
      <option value="javascript">JAVASCRIPT</option>
      <option value="typescript">TYPESCRIPT</option>
    </select>
  );

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
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, marginTop: 16, alignItems: "start" }}>
      
      {/* MONACO PANELS AREA */}
      <div style={{
        height: 'calc(100vh - 200px)', display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr',
        gap: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 16, overflow: 'hidden',
      }}>
        <MonacoPanel
          label="INSTRUCTIONS"
          language="markdown"
          value={challenge.instructions || ''}
          onChange={(val) => onChange({ ...challenge, instructions: val ?? '' })}
        />

        <MonacoPanel
          label="CANDIDATE_CODE"
          language={codeLanguage}
          value={(challenge.config?.starterCode as string) || ''}
          onChange={(val) => onChange({
            ...challenge,
            config: { ...challenge.config, starterCode: val ?? '' },
          })}
          headerRight={langSelect(codeLanguage, (next) => onChange({
            ...challenge,
            config: { ...challenge.config, language: next },
            serverConfig: { ...challenge.serverConfig, testLanguage: (challenge.serverConfig?.testLanguage as string) || next },
          }))}
        />

        <MonacoPanel
          label="TESTS"
          language={testLanguage}
          value={(challenge.serverConfig?.testCode as string) || ''}
          onChange={(val) => onChange({
            ...challenge,
            serverConfig: { ...challenge.serverConfig, testCode: val ?? '' },
          })}
          headerRight={langSelect(testLanguage, (next) => onChange({
            ...challenge,
            serverConfig: { ...challenge.serverConfig, testLanguage: next },
          }))}
        />
      </div>

      {/* CONFIGURATION SIDEBAR */}
      <aside>
        <LiquidMetalCard variant="chrome" style={{ padding: 24, borderRadius: 16 }}>
          
          <div style={{ marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 8 }}>
              Code Implementation
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
              Candidate must implement logic to pass your automated test suite.
            </div>
          </div>

          {sidebarSection('AI_FOLLOW_UP', <ChevronDown size={14} />, (
            <FollowUpConfiguration
              enabled={hasFollowUp}
              onChange={(val) => setConfig({ enableFollowUp: val })}
              accentColor="#fff"
            />
          ))}

          {sidebarSection('ENGINE_SETTINGS', <Settings size={14} />, (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono', marginBottom: 4 }}>ENVIRONMENT</div>
                <div style={{ fontSize: 11, color: '#fff', fontWeight: 700 }}>Node.js / V8</div>
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', paddingLeft: 2 }}>
                Custom environments coming soon.
              </div>
            </div>
          ))}

        </LiquidMetalCard>
      </aside>
    </div>
  );
}
