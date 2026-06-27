import { useEffect, useRef, useState, useCallback } from 'react';
import { initAgent } from 'clippyjs';
import ClippyLoaders from 'clippyjs/agents/clippy';
import {
  useAgentConnection,
  type AgentChatMessage,
  type AgentFileChangeEvent,
  type AgentRoomAction,
  type AgentStatus,
} from '../hooks/useAgentConnection';

type Agent = Awaited<ReturnType<typeof initAgent>>;

export interface ClippyMessage {
  text: string;
  hold?: boolean;
  actions?: ClippyAction[];
}

export interface ClippyAction {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface ClippyAssistantProps {
  messages: ClippyMessage[];
  onDismiss: () => void;
  onClippyClick?: () => void;
  agentWsUrl?: string | null;
  agentEnabled?: boolean;
  agentUnavailableMessage?: string;
  canLaunchAgentWorkspace?: boolean;
  openChatRequest?: number;
  onOpenBrowser?: (url: string) => void;
  onOpenTerminal?: () => void;
  onAction?: (actionId: string) => void;
  onAgentRoomAction?: (action: AgentRoomAction) => void;
  onUserChatMessage?: (message: AgentChatMessage) => void;
  onAgentChatMessage?: (message: AgentChatMessage) => void;
  onAgentStatus?: (status: AgentStatus, agentName: string) => void;
  onAgentFileChange?: (event: AgentFileChangeEvent) => void;
}

export function ClippyAssistant({
  messages,
  onDismiss,
  onClippyClick,
  agentWsUrl,
  agentEnabled = false,
  agentUnavailableMessage,
  canLaunchAgentWorkspace = false,
  openChatRequest,
  onOpenBrowser,
  onOpenTerminal,
  onAction,
  onAgentRoomAction,
  onUserChatMessage,
  onAgentChatMessage,
  onAgentStatus,
  onAgentFileChange,
}: ClippyAssistantProps) {
  const agentRef = useRef<Agent | null>(null);
  const [ready, setReady] = useState(false);
  const spokenMessagesRef = useRef<Set<string>>(new Set());
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const executedAgentActionsRef = useRef<Set<string>>(new Set());
  const capturedAgentMessagesRef = useRef<Set<string>>(new Set());
  const capturedAgentStatusRef = useRef<string | null>(null);
  const capturedAgentFileChangesRef = useRef<Set<string>>(new Set());
  const lastOpenChatRequestRef = useRef<number | undefined>(undefined);

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

    const clippyAgent = agentRef.current;
    messages.forEach((msg) => {
      const signature = `${msg.text}|${msg.actions?.map((action) => action.id).join(',') ?? ''}`;
      if (spokenMessagesRef.current.has(signature)) return;
      spokenMessagesRef.current.add(signature);
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

  useEffect(() => {
    for (const msg of agentConn.messages) {
      if (msg.role !== 'agent') continue;
      const signature = `${msg.timestamp}|${msg.text}`;
      if (capturedAgentMessagesRef.current.has(signature)) continue;
      capturedAgentMessagesRef.current.add(signature);
      onAgentChatMessage?.(msg);
    }
  }, [agentConn.messages, onAgentChatMessage]);

  useEffect(() => {
    if (!agentEnabled) return;
    const signature = `${agentConn.agentName}|${agentConn.status}`;
    if (capturedAgentStatusRef.current === signature) return;
    capturedAgentStatusRef.current = signature;
    onAgentStatus?.(agentConn.status, agentConn.agentName);
  }, [agentConn.agentName, agentConn.status, agentEnabled, onAgentStatus]);

  useEffect(() => {
    for (const event of agentConn.fileChanges) {
      const signature = [
        event.timestamp,
        event.filePath,
        event.actionName,
        event.contentHash ?? '',
        event.sizeBytes ?? '',
      ].join('|');
      if (capturedAgentFileChangesRef.current.has(signature)) continue;
      capturedAgentFileChangesRef.current.add(signature);
      onAgentFileChange?.(event);
    }
  }, [agentConn.fileChanges, onAgentFileChange]);

  const latestAgentRoomAction = agentConn.roomActions[agentConn.roomActions.length - 1] ?? null;
  const latestAgentRoomActionSignature = latestAgentRoomAction
    ? `${latestAgentRoomAction.id}|${latestAgentRoomAction.text ?? ''}|${latestAgentRoomAction.url ?? ''}`
    : null;

  useEffect(() => {
    if (!latestAgentRoomAction || !latestAgentRoomAction.autoExecute || !latestAgentRoomActionSignature) return;
    if (executedAgentActionsRef.current.has(latestAgentRoomActionSignature)) return;
    executedAgentActionsRef.current.add(latestAgentRoomActionSignature);
    onAgentRoomAction?.(latestAgentRoomAction);
  }, [
    latestAgentRoomAction,
    latestAgentRoomActionSignature,
    onAgentRoomAction,
  ]);

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

  const openChat = useCallback(() => {
    if (agentRef.current) {
      agentRef.current.animate();
    }
    setChatOpen(true);
    onClippyClick?.();
  }, [onClippyClick]);

  useEffect(() => {
    if (openChatRequest === undefined || openChatRequest <= 0) return;
    if (lastOpenChatRequestRef.current === openChatRequest) return;
    lastOpenChatRequestRef.current = openChatRequest;
    openChat();
  }, [openChat, openChatRequest]);

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
    const text = chatInput.trim();
    if (!text) return;
    const message = agentConn.sendMessage(text);
    if (!message) return;
    onUserChatMessage?.(message);
    setChatInput('');
  }, [chatInput, agentConn, onUserChatMessage]);

  const handleAuthClick = useCallback(() => {
    if (agentConn.authUrl && onOpenBrowser) {
      onOpenBrowser(agentConn.authUrl);
    }
    agentConn.startAuth();
  }, [agentConn, onOpenBrowser]);

  const handleActionClick = useCallback((actionId: string) => {
    if (agentRef.current) {
      agentRef.current.animate();
    }
    if (actionId === 'agent-room-action' && latestAgentRoomAction) {
      onAgentRoomAction?.(latestAgentRoomAction);
      return;
    }
    onAction?.(actionId);
  }, [latestAgentRoomAction, onAction, onAgentRoomAction]);

  const agentRoomActionPrompt: ClippyMessage | null = latestAgentRoomAction
    ? {
        text: latestAgentRoomAction.text ?? `${agentConn.agentName} suggests: ${latestAgentRoomAction.label}.`,
        hold: true,
        actions: [{
          id: 'agent-room-action',
          label: latestAgentRoomAction.label,
        }],
      }
    : null;

  const currentPrompt = agentRoomActionPrompt ?? (messages.length > 0 ? messages[messages.length - 1] : null);

  const statusLabel: Record<string, string> = {
    idle: 'Ready',
    thinking: 'Thinking...',
    working: 'Working...',
    auth_needed: 'Authentication required',
    disconnected: 'Disconnected',
  };
  const unavailableMessage = agentUnavailableMessage
    ?? 'Launch the VS Code workspace to connect real Devin. Clippy chat stays disabled until the container bridge is connected.';
  const canSendToAgent = agentEnabled && agentConn.connected && agentConn.status !== 'auth_needed';
  const emptyChatMessage = !agentEnabled
    ? unavailableMessage
    : !agentConn.connected
      ? 'Clippy bridge is reconnecting to the dev container.'
      : agentConn.status === 'auth_needed'
        ? agentConn.authMessage ?? 'Devin is not authenticated in this container. Real Devin credentials are required before Clippy can chat.'
        : agentConn.capabilities.length === 0
          ? 'Clippy bridge is ready. Send a message to start the real Devin process.'
          : 'Connected to Devin. Ask Clippy about the code or the interview workspace.';
  const chatAgentName = agentEnabled ? agentConn.agentName : 'devin';

  return (
    <>
      <div
        style={{ display: 'none' }}
        data-clippy-anchor="true"
        onClick={handleClick}
      />

      {currentPrompt && (
        <div className="win95-clippy-prompt" data-testid="clippy-proactive-card">
          <div className="win95-clippy-prompt-title">
            <span>Clippy</span>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss Clippy"
              data-testid="clippy-dismiss"
            >
              ×
            </button>
          </div>
          <p>{currentPrompt.text}</p>
          {currentPrompt.actions && currentPrompt.actions.length > 0 && (
            <div className="win95-clippy-prompt-actions">
              {currentPrompt.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleActionClick(action.id)}
                  disabled={action.disabled}
                  data-testid={`clippy-action-${action.id}`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {chatOpen && (
        <div className="win95-clippy-chat" data-testid="clippy-chat">
          <div className="win95-clippy-chat-header">
            <span>Clippy — {chatAgentName}</span>
            <button onClick={() => setChatOpen(false)}>×</button>
          </div>

          <div className="win95-clippy-chat-messages">
            {agentConn.messages.length === 0 && (
              <div className="win95-clippy-chat-msg agent">
                {emptyChatMessage}
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
            <span className={`win95-clippy-chat-status-dot ${agentEnabled ? agentConn.status : 'unavailable'}`} />
            <span>
              {agentEnabled
                ? statusLabel[agentConn.status] || agentConn.status
                : 'Workspace required'}
            </span>
            {agentEnabled && !agentConn.connected && <span> — reconnecting...</span>}
          </div>

          {agentEnabled && agentConn.status === 'auth_needed' && agentConn.authUrl && (
            <button
              className="win95-clippy-chat-auth-btn"
              onClick={handleAuthClick}
            >
              Authenticate {agentConn.agentName}
            </button>
          )}

          {!agentEnabled && canLaunchAgentWorkspace && (
            <button
              className="win95-clippy-chat-auth-btn"
              onClick={() => handleActionClick('launch-workspace')}
              data-testid="clippy-launch-workspace"
            >
              Launch workspace
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
              placeholder={agentEnabled ? 'Ask Clippy...' : 'Ask Clippy when Devin is connected...'}
              disabled={!canSendToAgent}
              data-testid="clippy-chat-input"
            />
            <button
              className="win95-clippy-chat-send"
              onClick={handleSendChat}
              disabled={!canSendToAgent || !chatInput.trim()}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
