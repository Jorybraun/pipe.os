/**
 * AgentMessage — single message bubble in the agent drawer.
 *
 * User messages: right-aligned, subtle background.
 * Assistant messages: left-aligned, markdown support.
 */

import type { ChatMessage } from '../../hooks/useAgentChat';

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

interface AgentMessageProps {
  message: ChatMessage;
}

export function AgentMessage({ message }: AgentMessageProps): JSX.Element {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          padding: '10px 14px',
          borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          background: isUser
            ? 'rgba(96,165,250,0.1)'
            : 'rgba(255,255,255,0.03)',
          border: `1px solid ${isUser ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.06)'}`,
        }}
      >
        <div
          style={{
            ...mono,
            fontSize: 11,
            color: 'var(--pipe-text)',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.content}
        </div>

        {message.toolsUsed && message.toolsUsed.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {message.toolsUsed.map((tool, i) => (
              <span
                key={i}
                style={{
                  ...mono,
                  fontSize: 7,
                  color: 'var(--pipe-accent)',
                  padding: '1px 5px',
                  borderRadius: 2,
                  background: 'var(--pipe-accent-surface)',
                  border: '1px solid var(--pipe-accent-border)',
                }}
              >
                {tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Thinking indicator — animated dots. */
export function AgentThinking(): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
      <div
        style={{
          padding: '10px 14px',
          borderRadius: '12px 12px 12px 2px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ ...mono, fontSize: 11, color: 'var(--pipe-text-dim)', animation: 'pulse 1.5s ease-in-out infinite' }}>
          thinking
        </span>
        <span style={{ ...mono, fontSize: 11, color: 'var(--pipe-text-dim)', animation: 'pulse 1.5s ease-in-out infinite 0.3s' }}>.</span>
        <span style={{ ...mono, fontSize: 11, color: 'var(--pipe-text-dim)', animation: 'pulse 1.5s ease-in-out infinite 0.6s' }}>.</span>
        <span style={{ ...mono, fontSize: 11, color: 'var(--pipe-text-dim)', animation: 'pulse 1.5s ease-in-out infinite 0.9s' }}>.</span>
      </div>
    </div>
  );
}
