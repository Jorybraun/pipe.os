import { useCallback, useRef, useState, useEffect } from 'react';
import { Send, User, Bot, Cpu, Sparkles } from 'lucide-react';

export type ChatRole = 'host' | 'candidate' | 'ai';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  timestamp: number;
  deliveryStatus?: 'pending' | 'accepted' | 'rejected';
  deliveryRejectionReason?: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  currentUserRole: 'HOST' | 'GUEST';
  onAskAssistant?: () => void;
}

let msgCounter = 0;
function nextMsgId(): string {
  msgCounter += 1;
  return `msg-${msgCounter}`;
}

const ROLE_STYLES: Record<ChatRole, { icon: typeof User; className: string }> = {
  host: { icon: User, className: 'chat-msg-host' },
  candidate: { icon: User, className: 'chat-msg-candidate' },
  ai: { icon: Cpu, className: 'chat-msg-ai' },
};

function roleLabel(role: ChatRole, currentUserRole: 'HOST' | 'GUEST'): string {
  if (role === 'ai') return 'AI';
  if (role === 'host') return currentUserRole === 'HOST' ? 'You' : 'Host';
  return currentUserRole === 'GUEST' ? 'You' : 'Guest';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function ChatPanel({
  messages,
  onSend,
  currentUserRole,
  onAskAssistant,
}: ChatPanelProps): JSX.Element {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback((): void => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  }, [input, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="chat-panel" data-testid="chat-panel">
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <Bot size={28} />
            <p>Messages will appear here. Say hello!</p>
          </div>
        )}
        {messages.map((msg) => {
          const style = ROLE_STYLES[msg.role];
          const Icon = style.icon;
          return (
            <div
              key={msg.id}
              className={`chat-msg ${style.className}${msg.deliveryStatus ? ` chat-msg-${msg.deliveryStatus}` : ''}`}
            >
              <div className="chat-msg-avatar">
                <Icon size={14} />
              </div>
              <div className="chat-msg-body">
                <div className="chat-msg-header">
                  <span className="chat-msg-author">{roleLabel(msg.role, currentUserRole)}</span>
                  <span className="chat-msg-time">{formatTime(msg.timestamp)}</span>
                  {msg.deliveryStatus === 'pending' && (
                    <span className="chat-msg-status">Sending</span>
                  )}
                  {msg.deliveryStatus === 'rejected' && (
                    <span
                      className="chat-msg-status chat-msg-status-error"
                      title={msg.deliveryRejectionReason}
                    >
                      Not sent
                    </span>
                  )}
                </div>
                <div className="chat-msg-text">{msg.text}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="chat-input-area">
        <input
          type="text"
          className="chat-input"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="chat-input"
        />
        {onAskAssistant && (
          <button
            type="button"
            className="chat-assistant-btn"
            onClick={onAskAssistant}
            title="Ask AI assistant"
            aria-label="Ask AI assistant"
            data-testid="chat-ask-assistant"
          >
            <Sparkles size={14} />
          </button>
        )}
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim()}
          data-testid="chat-send"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
