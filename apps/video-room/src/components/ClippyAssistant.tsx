import { useEffect, useRef, useState, useCallback } from 'react';
import { initAgent } from 'clippyjs';
import ClippyLoaders from 'clippyjs/agents/clippy';
import { useAgentConnection } from '../hooks/useAgentConnection';

type Agent = Awaited<ReturnType<typeof initAgent>>;

export interface ClippyMessage {
  text: string;
  hold?: boolean;
}

export interface ClippyAssistantProps {
  messages: ClippyMessage[];
  onDismiss: () => void;
  onClippyClick?: () => void;
  agentWsUrl?: string | null;
  agentEnabled?: boolean;
  onOpenBrowser?: (url: string) => void;
  onOpenTerminal?: () => void;
}

export function ClippyAssistant({
  messages,
  onDismiss,
  onClippyClick,
  agentWsUrl,
  agentEnabled = false,
  onOpenBrowser,
  onOpenTerminal,
}: ClippyAssistantProps) {
  const agentRef = useRef<Agent | null>(null);
  const [ready, setReady] = useState(false);
  const processedMessagesRef = useRef(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const agentConn = useAgentConnection({
    wsUrl: agentWsUrl ?? null,
    enabled: agentEnabled,
  });

  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initClippy = useCallback(async () => {
    if (agentRef.current) return;

    const agent = await initAgent({
      agent: ClippyLoaders.agent,
      map: ClippyLoaders.map,
      sound: ClippyLoaders.sound,
    });

    agentRef.current = agent;

    // Position Clippy in the bottom-right area, above the taskbar
    agent.moveTo(
      window.innerWidth - 180,
      window.innerHeight - 140,
      0,
    );

    agent.show(true);

    // Play the classic Show animation
    agent.play('Show');

    setReady(true);
  }, []);

  useEffect(() => {
    initClippy().catch((err) => {
      console.error('[ClippyAssistant] Failed to init Clippy:', err);
    });

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (agentRef.current) {
        try {
          agentRef.current.hide(true, undefined);
          agentRef.current.dispose();
        } catch {
          // ignore
        }
        agentRef.current = null;
      }
    };
  }, [initClippy]);

  useEffect(() => {
    if (!ready || !agentRef.current) return;

    const newMessages = messages.slice(processedMessagesRef.current);
    if (newMessages.length === 0) return;

    processedMessagesRef.current = messages.length;

    const clippyAgent = agentRef.current;
    newMessages.forEach((msg) => {
      clippyAgent.speak(msg.text, msg.hold ?? false);
    });
  }, [messages, ready]);

  useEffect(() => {
    if (!ready || !agentRef.current) return;
    if (agentConn.messages.length === 0) return;

    const lastMsg = agentConn.messages[agentConn.messages.length - 1];
    if (lastMsg.role === 'agent') {
      agentRef.current.speak(lastMsg.text, false);
    }
  }, [agentConn.messages, ready]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentConn.messages]);

  const handleDismiss = useCallback(() => {
    if (agentRef.current) {
      agentRef.current.hide(true, undefined);
    }
    onDismiss();
  }, [onDismiss]);

  const handleClick = useCallback(() => {
    if (agentRef.current) {
      agentRef.current.animate();
    }
    setChatOpen((v) => !v);
    onClippyClick?.();
  }, [onClippyClick]);

  const handleChatInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setChatInput(e.target.value);
    if (!agentRef.current || !ready) return;
    // Trigger Writing animation when user starts typing
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      agentRef.current.play('Writing');
    }
    // Reset typing state after 800ms of no input
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      // Play a random idle animation when user stops typing
      if (agentRef.current) {
        const idleAnims = ['IdleFingerTap', 'IdleHeadScratch', 'IdleSideToSide', 'IdleEyeBrowRaise'];
        agentRef.current.play(idleAnims[Math.floor(Math.random() * idleAnims.length)]);
      }
    }, 800);
  }, [ready]);

  const handleSendChat = useCallback(() => {
    if (!chatInput.trim()) return;
    agentConn.sendMessage(chatInput);
    setChatInput('');
  }, [chatInput, agentConn]);

  const handleAuthClick = useCallback(() => {
    if (agentConn.authUrl && onOpenBrowser) {
      onOpenBrowser(agentConn.authUrl);
    }
    agentConn.startAuth();
  }, [agentConn, onOpenBrowser]);

  const statusLabel: Record<string, string> = {
    idle: 'Ready',
    thinking: 'Thinking...',
    working: 'Working...',
    auth_needed: 'Authentication required',
    disconnected: 'Disconnected',
  };

  return (
    <>
      <div
        style={{ display: 'none' }}
        data-clippy-anchor="true"
        onClick={handleClick}
      />

      {chatOpen && agentEnabled && (
        <div className="win95-clippy-chat">
          <div className="win95-clippy-chat-header">
            <span>Clippy — {agentConn.agentName}</span>
            <button onClick={() => setChatOpen(false)}>×</button>
          </div>

          <div className="win95-clippy-chat-messages">
            {agentConn.messages.length === 0 && (
              <div className="win95-clippy-chat-msg agent">
                Hi! I'm Clippy, your AI pair programmer. Ask me anything about the code!
              </div>
            )}
            {agentConn.messages.map((msg, i) => (
              <div
                key={i}
                className={`win95-clippy-chat-msg ${msg.role}`}
              >
                {msg.text}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="win95-clippy-chat-status">
            <span className={`win95-clippy-chat-status-dot ${agentConn.status}`} />
            <span>{statusLabel[agentConn.status] || agentConn.status}</span>
            {!agentConn.connected && <span> — reconnecting...</span>}
          </div>

          {agentConn.status === 'auth_needed' && (
            <button
              className="win95-clippy-chat-auth-btn"
              onClick={handleAuthClick}
            >
              Authenticate {agentConn.agentName}
            </button>
          )}

          {onOpenTerminal && agentEnabled && (
            <button
              className="win95-clippy-chat-auth-btn"
              onClick={onOpenTerminal}
            >
              Open Terminal
            </button>
          )}

          <div className="win95-clippy-chat-input-row">
            <input
              type="text"
              className="win95-clippy-chat-input"
              value={chatInput}
              onChange={handleChatInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendChat();
              }}
              placeholder="Ask Clippy..."
              disabled={agentConn.status === 'auth_needed' || !agentConn.connected}
            />
            <button
              className="win95-clippy-chat-send"
              onClick={handleSendChat}
              disabled={agentConn.status === 'auth_needed' || !agentConn.connected || !chatInput.trim()}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
