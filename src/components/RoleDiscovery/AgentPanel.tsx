import { useState, useRef, useEffect } from 'react';
import { Brain, Send, AlertCircle } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { SubTitle } from '../ui/SubTitle';
import type {
  RoleBaseline,
  RoleDynamicContext,
  AgentMessage,
} from '../../types/roleDiscovery';

interface AgentPanelProps {
  baseline: RoleBaseline | null;
  context: RoleDynamicContext;
  progress: number;
  gaps: string[];
}

/**
 * AgentPanel - Right sidebar with agent chat and role model display
 *
 * Features:
 * - Tab navigation between AGENT and ROLE MODEL views
 * - Real-time chat interface with the discovery agent
 * - Progress indicator showing completeness
 * - Role model display showing baseline and accumulated context
 * - Gaps indicator showing missing critical information
 *
 * @example
 * ```tsx
 * <AgentPanel
 *   baseline={baselineData}
 *   context={dynamicContext}
 *   progress={75}
 *   gaps={['Team context incomplete']}
 * />
 * ```
 */
export function AgentPanel({
  baseline,
  context,
  progress,
  gaps,
}: AgentPanelProps): JSX.Element {
  const [tab, setTab] = useState<'AGENT' | 'ROLE MODEL'>('AGENT');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom when messages change
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (): void => {
    if (!input.trim()) return;

    const userMessage: AgentMessage = {
      from: 'user',
      text: input.trim(),
      timestamp: new Date(),
    };

    setMessages((m) => [...m, userMessage]);
    setInput('');

    // Mock agent response (Phase 1A: dummy data)
    setTimeout(() => {
      const q = input.toLowerCase();
      let response = 'Ask me about the interview design process.';

      if (q.includes('why')) {
        response =
          'Each field shapes the interview. Title sets difficulty, stack targets questions.';
      } else if (q.includes('skip')) {
        response =
          '60% completeness unlocks Phase 2. More context = better results.';
      } else if (q.includes('next')) {
        response =
          'Next, we select interview stages based on this role model.';
      }

      const agentMessage: AgentMessage = {
        from: 'agent',
        text: response,
        timestamp: new Date(),
      };

      setMessages((m) => [...m, agentMessage]);
    }, 350);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div
      style={{
        width: 360,
        background:
          'linear-gradient(180deg, rgba(20,20,30,0.95) 0%, rgba(15,15,25,0.98) 100%)',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Tab Navigation */}
      <div
        style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        {(['AGENT', 'ROLE MODEL'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '16px 20px',
              background: tab === t ? 'rgba(255,255,255,0.02)' : 'transparent',
              border: 'none',
              borderBottom:
                tab === t
                  ? '2px solid rgba(139, 92, 246, 0.8)'
                  : '2px solid transparent',
              color: tab === t ? '#fff' : 'rgba(255,255,255,0.4)',
              fontSize: 9,
              letterSpacing: '0.15em',
              cursor: 'pointer',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Agent Tab */}
      {tab === 'AGENT' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Agent Header */}
          <div style={{ padding: 24 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  background:
                    'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))',
                  border: '1px solid rgba(139, 92, 246, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(139, 92, 246, 0.9)',
                }}
              >
                <Brain size={20} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#fff',
                    letterSpacing: '0.05em',
                  }}
                >
                  ROLE DISCOVERY AGENT
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: 'rgba(139, 92, 246, 0.8)',
                    letterSpacing: '0.15em',
                    marginTop: 4,
                  }}
                >
                  PHASE 1
                </div>
              </div>
            </div>

            <LiquidMetalCard variant="dark" style={{ padding: 16 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color:
                    progress >= 60
                      ? 'rgba(150,255,150,0.8)'
                      : 'rgba(255,255,255,0.4)',
                }}
              >
                {progress >= 60 ? '✓ READY TO PROCEED' : 'WAITING FOR INPUT'}
              </div>
            </LiquidMetalCard>
          </div>

          {/* Progress Bar */}
          <div style={{ padding: '0 24px 20px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontSize: 8,
                  letterSpacing: '0.2em',
                  color: 'rgba(255,255,255,0.3)',
                }}
              >
                COMPLETENESS
              </span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                {progress}%
              </span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.06)' }}>
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background:
                    progress >= 60
                      ? 'linear-gradient(90deg, rgba(150,255,150,0.5), rgba(150,255,150,0.9))'
                      : 'linear-gradient(90deg, rgba(139, 92, 246, 0.4), rgba(139, 92, 246, 0.8))',
                  boxShadow:
                    progress >= 60
                      ? '0 0 12px rgba(150,255,150,0.4)'
                      : '0 0 10px rgba(139, 92, 246, 0.3)',
                  transition: 'width 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            </div>
          </div>

          {/* Chat Messages */}
          <div
            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
          >
            <div
              ref={chatRef}
              style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px' }}
            >
              {messages.length === 0 ? (
                <p
                  style={{
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.4)',
                    lineHeight: 1.7,
                    margin: 0,
                  }}
                >
                  Ask me anything about this phase or what information helps design
                  better interviews.
                </p>
              ) : (
                messages.map((m, i) => (
                  <LiquidMetalCard
                    key={i}
                    variant={m.from === 'user' ? 'dark' : 'mercury'}
                    style={{ padding: 12, marginBottom: 8 }}
                  >
                    <p
                      style={{
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.7)',
                        lineHeight: 1.6,
                        margin: 0,
                      }}
                    >
                      {m.text}
                    </p>
                  </LiquidMetalCard>
                ))
              )}
            </div>

            {/* Chat Input */}
            <div
              style={{
                padding: '16px 24px 24px',
                borderTop: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything..."
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff',
                    fontSize: 11,
                    fontFamily: '"Space Mono", monospace',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleSend}
                  style={{
                    padding: '12px 14px',
                    background:
                      'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))',
                    border: '1px solid rgba(139, 92, 246, 0.4)',
                    color: 'rgba(139, 92, 246, 0.9)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Role Model Tab */
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {baseline ? (
            <LiquidMetalCard variant="chrome" style={{ padding: 20, marginBottom: 20 }}>
              <div
                style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}
              >
                {baseline.level} {baseline.title}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.4)',
                  marginBottom: 16,
                  letterSpacing: '0.1em',
                }}
              >
                {baseline.department} · {baseline.location}
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: 'rgba(255,255,255,0.3)',
                  marginBottom: 12,
                }}
              >
                {baseline.teamSize} → {baseline.reportsTo}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {baseline.stack?.map((tech, i) => (
                  <span
                    key={i}
                    style={{
                      padding: '4px 8px',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      fontSize: 9,
                      color: 'rgba(255,255,255,0.6)',
                    }}
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </LiquidMetalCard>
          ) : (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', margin: 0 }}>
                Complete the baseline to build the role model
              </p>
            </div>
          )}

          {/* Dynamic Context */}
          {Object.keys(context).filter((k) => context[k]).length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <SubTitle>CONTEXT</SubTitle>
              <div style={{ marginTop: 16 }}>
                {Object.entries(context)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <LiquidMetalCard
                      key={k}
                      variant="dark"
                      style={{ padding: 16, marginBottom: 8 }}
                    >
                      <div
                        style={{
                          fontSize: 8,
                          letterSpacing: '0.15em',
                          color: 'rgba(139, 92, 246, 0.8)',
                          marginBottom: 8,
                          textTransform: 'uppercase',
                        }}
                      >
                        {k.replace(/_/g, ' ')}
                      </div>
                      <p
                        style={{
                          fontSize: 11,
                          color: 'rgba(255,255,255,0.6)',
                          lineHeight: 1.6,
                          margin: 0,
                        }}
                      >
                        {v}
                      </p>
                    </LiquidMetalCard>
                  ))}
              </div>
            </div>
          )}

          {/* Gaps Indicator */}
          {gaps.length > 0 && (
            <div>
              <SubTitle>GAPS</SubTitle>
              <div style={{ marginTop: 16 }}>
                {gaps.map((g, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      background: 'rgba(255,200,100,0.1)',
                      border: '1px solid rgba(255,200,100,0.2)',
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ color: 'rgba(255,200,100,0.9)' }}>
                      <AlertCircle size={14} />
                    </span>
                    <span style={{ fontSize: 10, color: 'rgba(255,200,100,0.9)' }}>
                      {g}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
