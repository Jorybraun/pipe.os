/**
 * AgentDrawer — global copilot agent panel.
 *
 * Mounts in Layout's agentPanel slot. Provides a chat interface
 * with skill mode switching and session persistence.
 */

import { useRef, useEffect } from 'react';
import { X, Bot, Trash2 } from 'lucide-react';
import { useAgentChat } from '../../hooks/useAgentChat';
import { AgentMessage, AgentThinking } from './AgentMessage';
import { AgentInputBar } from './AgentInputBar';

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

const SKILL_LABELS: Record<string, string> = {
  general: 'GENERAL',
  challenge_design: 'CHALLENGE DESIGN',
  score_explain: 'SCORE EXPLAINER',
  pipeline_advisor: 'PIPELINE ADVISOR',
};

interface AgentDrawerProps {
  pipelineId: string | null;
  skillMode: string;
  onClose: () => void;
  onSkillModeChange: (mode: string) => void;
}

export function AgentDrawer({ pipelineId, skillMode, onClose, onSkillModeChange }: AgentDrawerProps): JSX.Element {
  const chat = useAgentChat(pipelineId, skillMode);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages.length, chat.isThinking]);

  // Sync skill mode from chat to parent
  useEffect(() => {
    if (chat.skillMode !== skillMode) {
      onSkillModeChange(chat.skillMode);
    }
  }, [chat.skillMode, skillMode, onSkillModeChange]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <Bot size={16} color="var(--pipe-accent)" />
        <div style={{ flex: 1 }}>
          <div style={{ ...mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--pipe-text)' }}>
            COPILOT
          </div>
          <div style={{ ...mono, fontSize: 8, color: 'var(--pipe-accent)', letterSpacing: '0.1em', marginTop: 2 }}>
            {SKILL_LABELS[chat.skillMode] ?? chat.skillMode.toUpperCase()}
          </div>
        </div>
        <button
          onClick={() => void chat.clearSession()}
          title="Clear conversation"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
          }}
        >
          <Trash2 size={13} />
        </button>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {chat.messages.length === 0 && !chat.isThinking && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Bot size={28} color="var(--pipe-text-dim)" style={{ margin: '0 auto 12px' }} />
            <div style={{ ...mono, fontSize: 11, color: 'var(--pipe-text)', marginBottom: 6 }}>
              PIPE Copilot
            </div>
            <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-muted)', lineHeight: 1.6, maxWidth: 280, margin: '0 auto' }}>
              I can help you design code review challenges, explain candidate scores, or advise on your pipeline structure.
            </div>
          </div>
        )}

        {chat.messages.map((msg, i) => (
          <AgentMessage key={i} message={msg} />
        ))}

        {chat.isThinking && <AgentThinking />}

        {chat.error && (
          <div style={{ ...mono, fontSize: 9, color: '#ef4444', padding: '8px 12px', textAlign: 'center' }}>
            {chat.error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <AgentInputBar
        onSend={(text) => void chat.sendMessage(text)}
        isThinking={chat.isThinking}
        skillMode={chat.skillMode}
        onSkillModeChange={chat.setSkillMode}
      />
    </div>
  );
}
