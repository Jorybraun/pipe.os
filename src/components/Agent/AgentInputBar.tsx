/**
 * AgentInputBar — text input + send button + skill mode chips.
 */

import { useState, useCallback, type KeyboardEvent } from 'react';
import { Send, Loader2 } from 'lucide-react';

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

const SKILL_MODES = [
  { key: 'general', label: 'GENERAL' },
  { key: 'challenge_design', label: 'CHALLENGE DESIGN' },
] as const;

interface AgentInputBarProps {
  onSend: (text: string) => void;
  isThinking: boolean;
  skillMode: string;
  onSkillModeChange: (mode: string) => void;
}

export function AgentInputBar({ onSend, isThinking, skillMode, onSkillModeChange }: AgentInputBarProps): JSX.Element {
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    if (!text.trim() || isThinking) return;
    onSend(text.trim());
    setText('');
  }, [text, isThinking, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px' }}>
      {/* Skill mode chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {SKILL_MODES.map((m) => {
          const active = skillMode === m.key;
          return (
            <button
              key={m.key}
              onClick={() => onSkillModeChange(m.key)}
              style={{
                ...mono,
                fontSize: 7,
                fontWeight: 700,
                letterSpacing: '0.1em',
                padding: '3px 8px',
                background: active ? 'rgba(167,139,250,0.12)' : 'transparent',
                border: `1px solid ${active ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 3,
                color: active ? '#a78bfa' : 'var(--pipe-text-dim)',
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Input + send */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={skillMode === 'challenge_design'
            ? 'Describe what you want to test...'
            : 'Ask me anything about your pipeline...'}
          rows={2}
          style={{
            ...mono,
            fontSize: 11,
            flex: 1,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            color: 'var(--pipe-text)',
            padding: '10px 12px',
            resize: 'none',
            outline: 'none',
            lineHeight: 1.5,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isThinking}
          style={{
            ...mono,
            padding: '10px 12px',
            background: text.trim() && !isThinking ? 'rgba(96,165,250,0.15)' : 'transparent',
            border: `1px solid ${text.trim() && !isThinking ? 'rgba(96,165,250,0.3)' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: 6,
            color: text.trim() && !isThinking ? '#60a5fa' : 'var(--pipe-text-dim)',
            cursor: text.trim() && !isThinking ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {isThinking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}
