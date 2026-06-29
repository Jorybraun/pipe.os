import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { initAgent } from 'clippyjs';
import ClippyLoaders from 'clippyjs/agents/clippy';
import {
  useAgentConnection,
  type AgentChatMessage,
  type AgentPromptBlockedReason,
  type AgentFileChangeEvent,
  type AgentRoomAction,
  type AgentStatus,
} from '../hooks/useAgentConnection';
import type { ClippyPromptActor } from '../lib/clippyPromptIdentity';
import { buildClippyBrowserPromptIdentity } from '../lib/clippyPromptIdentity';

type ClippyJsAgent = Awaited<ReturnType<typeof initAgent>>;

const BLOCKED_PROMPT_MESSAGES: Record<AgentPromptBlockedReason, string> = {
  workspace_required: 'Clippy could not send that because the dev workspace is not running.',
  bridge_reconnecting: 'Clippy could not send that because the container bridge is reconnecting.',
  agent_starting: 'Clippy could not send that because the real agent is still starting.',
  agent_auth_needed: 'Clippy could not send that because the real agent needs authentication.',
  agent_disconnected: 'Clippy could not send that because no real agent bridge is ready.',
  agent_identity_missing: 'Clippy could not send that because the bridge has not reported a real agent identity.',
  agent_capabilities_missing: 'Clippy could not send that because the real agent has not reported chat capability yet.',
};

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
  chatOpen?: boolean;
  onChatOpen?: () => void;
  onChatClose?: () => void;
  agentWsUrl?: string | null;
  agentEnabled?: boolean;
  agentUnavailableMessage?: string;
  canLaunchAgentWorkspace?: boolean;
  promptActor?: ClippyPromptActor;
  promptWorkspaceSessionId?: string | null;
  openChatRequest?: number;
  onOpenBrowser?: (url: string) => void;
  onOpenTerminal?: () => void;
  onOpenAuthTerminal?: () => void;
  onOpenAuthBrowser?: () => void;
  onCheckAuth?: () => void;
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
  chatOpen: controlledChatOpen,
  onChatOpen,
  onChatClose,
  agentWsUrl,
  agentEnabled = false,
  agentUnavailableMessage,
  canLaunchAgentWorkspace = false,
  promptActor,
  promptWorkspaceSessionId,
  openChatRequest,
  onOpenBrowser,
  onOpenTerminal,
  onOpenAuthTerminal,
  onOpenAuthBrowser,
  onCheckAuth,
  onAction,
  onAgentRoomAction,
  onUserChatMessage,
  onAgentChatMessage,
  onAgentStatus,
  onAgentFileChange,
}: ClippyAssistantProps) {
  const clippyAgentRef = useRef<ClippyJsAgent | null>(null);
  const clippyReadyRef = useRef(false);
  const spokenPromptSignaturesRef = useRef<Set<string>>(new Set());
  const [clippyReady, setClippyReady] = useState(false);
  const [localChatOpen, setLocalChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [localChatMessages, setLocalChatMessages] = useState<AgentChatMessage[]>([]);
  const [dismissedPromptSignature, setDismissedPromptSignature] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const executedAgentActionsRef = useRef<Set<string>>(new Set());
  const capturedAgentMessagesRef = useRef<Set<string>>(new Set());
  const capturedAgentStatusRef = useRef<string | null>(null);
  const capturedAgentFileChangesRef = useRef<Set<string>>(new Set());
  const lastOpenChatRequestRef = useRef<number | undefined>(undefined);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moveClippyHome = useCallback((agent: ClippyJsAgent): void => {
    agent.moveTo(
      Math.max(12, window.innerWidth - 158),
      Math.max(12, window.innerHeight - 150),
      0,
    );
  }, []);

  const animateClippy = useCallback((animation?: string): void => {
    const agent = clippyAgentRef.current;
    if (!agent) return;
    if (animation) {
      agent.play(animation);
      return;
    }
    agent.animate();
  }, []);

  const showClippy = useCallback((): void => {
    const agent = clippyAgentRef.current;
    if (!agent) return;
    moveClippyHome(agent);
    agent.show(true);
  }, [moveClippyHome]);

  const agentConn = useAgentConnection({
    wsUrl: agentWsUrl ?? null,
    enabled: agentEnabled,
    promptActor,
    promptWorkspaceSessionId,
  });

  useEffect(() => {
    let disposed = false;
    initAgent({
      agent: ClippyLoaders.agent,
      map: ClippyLoaders.map,
      sound: ClippyLoaders.sound,
    }).then((agent) => {
      if (disposed) {
        agent.dispose();
        return;
      }
      clippyAgentRef.current = agent;
      clippyReadyRef.current = true;
      setClippyReady(true);
      moveClippyHome(agent);
      agent.show(true);
      agent.play('Show');
    }).catch((err: unknown) => {
      console.error('[ClippyAssistant] Failed to init authentic Clippy:', err);
    });

    const handleResize = (): void => {
      const agent = clippyAgentRef.current;
      if (!agent) return;
      moveClippyHome(agent);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      const agent = clippyAgentRef.current;
      if (!agent) return;
      try {
        agent.hide(true, undefined);
        agent.dispose();
      } catch {
        // The old sprite library can throw if cleanup races an animation frame.
      }
      clippyAgentRef.current = null;
      clippyReadyRef.current = false;
      setClippyReady(false);
    };
  }, [moveClippyHome]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [agentConn.messages, localChatMessages]);

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

  const reportedAgentName = agentConn.agentName.trim();
  const agentDisplayName = reportedAgentName || 'the real agent';

  const agentRoomActionPrompt: ClippyMessage | null = latestAgentRoomAction
    ? {
        text: latestAgentRoomAction.text
          ?? `${reportedAgentName || 'The connected agent'} suggests: ${latestAgentRoomAction.label}.`,
        hold: true,
        actions: [{
          id: 'agent-room-action',
          label: latestAgentRoomAction.label,
        }],
      }
    : null;

  const currentPrompt = agentRoomActionPrompt ?? (messages.length > 0 ? messages[messages.length - 1] : null);
  const currentPromptSignature = currentPrompt
    ? [
        currentPrompt.text,
        currentPrompt.hold ? 'hold' : 'release',
        currentPrompt.actions?.map((action) => `${action.id}:${action.label}:${action.disabled ? 'disabled' : 'enabled'}`).join('|') ?? '',
      ].join('::')
    : null;

  const canOpenAgentBridgeChat = agentEnabled || canLaunchAgentWorkspace || Boolean(agentUnavailableMessage);
  const chatOpen = (controlledChatOpen ?? localChatOpen) && canOpenAgentBridgeChat;

  const openChat = useCallback(() => {
    if (!canOpenAgentBridgeChat) {
      setDismissedPromptSignature(null);
      setLocalChatOpen(false);
      showClippy();
      animateClippy();
      return;
    }
    showClippy();
    animateClippy();
    setLocalChatOpen(true);
    onChatOpen?.();
  }, [animateClippy, canOpenAgentBridgeChat, onChatOpen, showClippy]);

  const closeChat = useCallback(() => {
    setDismissedPromptSignature((current) => currentPromptSignature ?? current);
    setLocalChatOpen(false);
    onChatClose?.();
  }, [currentPromptSignature, onChatClose]);

  useEffect(() => {
    if (openChatRequest === undefined || openChatRequest <= 0) return;
    if (lastOpenChatRequestRef.current === openChatRequest) return;
    lastOpenChatRequestRef.current = openChatRequest;
    openChat();
  }, [openChat, openChatRequest]);

  const handleChatInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setChatInput(e.target.value);
    animateClippy('Writing');
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      animateClippy('IdleFingerTap');
    }, 800);
  }, [animateClippy]);

  const handleAuthClick = useCallback(() => {
    if (agentConn.authUrl && onOpenBrowser) {
      onOpenAuthBrowser?.();
      onOpenBrowser(agentConn.authUrl);
    } else {
      onCheckAuth?.();
    }
    agentConn.startAuth();
  }, [agentConn, onCheckAuth, onOpenAuthBrowser, onOpenBrowser]);

  const handleAuthTerminalClick = useCallback(() => {
    animateClippy();
    onOpenAuthTerminal?.();
  }, [animateClippy, onOpenAuthTerminal]);

  const handleOpenTerminalClick = useCallback(() => {
    animateClippy();
    if (onAction) {
      onAction('open-terminal');
      return;
    }
    onOpenTerminal?.();
  }, [animateClippy, onAction, onOpenTerminal]);

  const handleActionClick = useCallback((actionId: string) => {
    animateClippy();
    if (actionId === 'agent-room-action' && latestAgentRoomAction) {
      onAgentRoomAction?.(latestAgentRoomAction);
      return;
    }
    onAction?.(actionId);
  }, [animateClippy, latestAgentRoomAction, onAction, onAgentRoomAction]);

  const showPrompt = Boolean(currentPrompt && !chatOpen && currentPromptSignature !== dismissedPromptSignature);

  const handleDismiss = useCallback(() => {
    setDismissedPromptSignature((current) => currentPromptSignature ?? current);
    const agent = clippyAgentRef.current;
    if (agent) agent.hide(true, undefined);
    onDismiss();
  }, [currentPromptSignature, onDismiss]);

  useEffect(() => {
    if (!showPrompt || !currentPrompt || !currentPromptSignature) return;
    const agent = clippyAgentRef.current;
    if (!agent || !clippyReadyRef.current) return;
    if (spokenPromptSignaturesRef.current.has(currentPromptSignature)) return;
    spokenPromptSignaturesRef.current.add(currentPromptSignature);
    showClippy();
    agent.speak(currentPrompt.text, false);
  }, [clippyReady, currentPrompt, currentPromptSignature, showClippy, showPrompt]);

  useEffect(() => {
    const latestAgentMessage = [...agentConn.messages].reverse().find((message) => message.role === 'agent');
    const agent = clippyAgentRef.current;
    if (!agent || !latestAgentMessage) return;
    const signature = `agent:${latestAgentMessage.timestamp}:${latestAgentMessage.text}`;
    if (spokenPromptSignaturesRef.current.has(signature)) return;
    spokenPromptSignaturesRef.current.add(signature);
    showClippy();
    agent.speak(latestAgentMessage.text, false);
  }, [agentConn.messages, showClippy]);

  const statusLabel: Record<string, string> = {
    starting: 'Starting...',
    idle: 'Ready',
    thinking: 'Thinking...',
    working: 'Working...',
    auth_needed: 'Authentication required',
    disconnected: 'Disconnected',
  };
  const unavailableMessage = agentUnavailableMessage
    ?? 'Launch the VS Code workspace to connect a real agent. Clippy chat stays disabled until the container bridge reports an agent identity.';
  const canSendToAgent = agentEnabled
    && agentConn.connected
    && agentConn.status !== 'auth_needed'
    && agentConn.status !== 'starting'
    && agentConn.status !== 'disconnected'
    && reportedAgentName.length > 0
    && agentConn.capabilities.length > 0;
  const blockedPromptReason: AgentPromptBlockedReason | null = canSendToAgent
    ? null
    : !agentEnabled
      ? 'workspace_required'
      : !agentConn.connected
        ? 'bridge_reconnecting'
        : agentConn.status === 'starting'
          ? 'agent_starting'
          : agentConn.status === 'auth_needed'
            ? 'agent_auth_needed'
            : agentConn.status === 'disconnected'
              ? 'agent_disconnected'
              : reportedAgentName.length === 0
                ? 'agent_identity_missing'
                : agentConn.capabilities.length === 0
                  ? 'agent_capabilities_missing'
                  : 'agent_disconnected';
  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    if (canSendToAgent) {
      const message = agentConn.sendMessage(text);
      if (!message) return;
      onUserChatMessage?.(message);
      setChatInput('');
      return;
    }
    if (!blockedPromptReason) return;
    const timestamp = Date.now();
    const promptIdentity = buildClippyBrowserPromptIdentity({
      text,
      actor: promptActor ?? 'guest',
      timestamp,
      workspaceSessionId: promptWorkspaceSessionId ?? null,
    });
    const blockedUserMessage: AgentChatMessage = {
      role: 'user',
      text,
      timestamp,
      source: 'user_submit',
      deliveryStatus: 'blocked',
      blockedReason: blockedPromptReason,
      ...promptIdentity,
    };
    const blockedDiagnostic: AgentChatMessage = {
      role: 'agent',
      text: BLOCKED_PROMPT_MESSAGES[blockedPromptReason],
      timestamp: timestamp + 1,
      source: 'bridge_observation',
    };
    setLocalChatMessages((prev) => [...prev.slice(-19), blockedUserMessage, blockedDiagnostic]);
    onUserChatMessage?.(blockedUserMessage);
    setChatInput('');
  }, [
    agentConn,
    blockedPromptReason,
    canSendToAgent,
    chatInput,
    onUserChatMessage,
    promptActor,
    promptWorkspaceSessionId,
  ]);
  const emptyChatMessage = !agentEnabled
    ? unavailableMessage
    : !agentConn.connected
      ? 'Clippy bridge is reconnecting to the dev container.'
      : agentConn.status === 'starting'
        ? `Clippy is starting ${agentDisplayName} inside the dev container.`
        : agentConn.status === 'auth_needed'
          ? agentConn.authMessage ?? `${agentDisplayName} is not authenticated in this container. Real credentials are required before Clippy can chat.`
          : agentConn.status === 'disconnected'
            ? 'Clippy bridge is connected, but no real agent has reported ready yet.'
            : reportedAgentName.length === 0
              ? 'Waiting for the container bridge to report a real agent identity before chat is enabled.'
              : agentConn.capabilities.length === 0
                ? `Waiting for ${agentDisplayName} to report ready before chat is enabled.`
                : `Connected to ${agentDisplayName}. Ask Clippy about the code or the interview workspace.`;
  const chatAgentName = agentEnabled ? agentDisplayName : 'agent bridge';
  const agentStateCheckState = !agentEnabled || agentConn.status === 'auth_needed'
    ? 'blocked'
    : agentConn.status === 'starting' || agentConn.status === 'disconnected'
      ? 'waiting'
      : 'ok';
  const bridgeChecks = [
    {
      label: 'Workspace',
      value: agentEnabled ? 'Ready' : 'Required',
      state: agentEnabled ? 'ok' : 'blocked',
    },
    {
      label: 'WebSocket',
      value: agentEnabled
        ? agentConn.connected ? 'Connected' : 'Reconnecting'
        : 'Offline',
      state: agentEnabled && agentConn.connected ? 'ok' : 'waiting',
    },
    {
      label: 'Agent',
      value: reportedAgentName || 'Waiting',
      state: reportedAgentName ? 'ok' : 'waiting',
    },
    {
      label: 'State',
      value: agentEnabled ? statusLabel[agentConn.status] || agentConn.status : 'Workspace required',
      state: agentStateCheckState,
    },
    {
      label: 'Capabilities',
      value: agentConn.capabilities.length > 0 ? agentConn.capabilities.join(', ') : 'Waiting',
      state: agentConn.capabilities.length > 0 ? 'ok' : 'waiting',
    },
  ] as const;
  const chatMessages = useMemo(() => (
    [...agentConn.messages, ...localChatMessages].sort((a, b) => a.timestamp - b.timestamp)
  ), [agentConn.messages, localChatMessages]);

  return (
    <>
      <button
        type="button"
        className="win95-clippy-hotspot"
        onClick={openChat}
        onDoubleClick={handleDismiss}
        aria-label="Ask Clippy"
        data-testid="clippy-hotspot"
      />

      {chatOpen && (
        <div className="win95-clippy-chat" data-testid="clippy-chat">
          <div className="win95-clippy-chat-header">
            <span className="win95-clippy-chat-title">
              <span>Clippy — {chatAgentName}</span>
            </span>
            <button
              type="button"
              onClick={closeChat}
              aria-label="Close Clippy chat"
              data-testid="clippy-chat-close"
            >
              ×
            </button>
          </div>

          <div className="win95-clippy-chat-messages">
            {chatMessages.length === 0 && (
              <div className="win95-clippy-chat-msg agent">
                {emptyChatMessage}
              </div>
            )}
            {chatMessages.map((msg, i) => (
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

          <div className="win95-clippy-bridge-checklist" data-testid="clippy-bridge-checklist">
            {bridgeChecks.map((check) => (
              <div
                className={`win95-clippy-bridge-check is-${check.state}`}
                key={check.label}
                data-testid={`clippy-bridge-check-${check.label.toLowerCase()}`}
              >
                <span>{check.label}</span>
                <strong>{check.value}</strong>
              </div>
            ))}
          </div>

          {agentEnabled && agentConn.status === 'auth_needed' && agentConn.authUrl && (
            <button
              className="win95-clippy-chat-auth-btn"
              onClick={handleAuthClick}
              data-testid="clippy-open-auth-browser"
            >
              Authenticate {agentDisplayName}
            </button>
          )}

          {agentEnabled && agentConn.status === 'auth_needed' && !agentConn.authUrl && onOpenAuthTerminal && (
            <>
              <button
                className="win95-clippy-chat-auth-btn"
                onClick={handleAuthTerminalClick}
                data-testid="clippy-open-auth-terminal"
              >
                Open Devin login terminal
              </button>
              <button
                className="win95-clippy-chat-auth-btn"
                onClick={handleAuthClick}
                data-testid="clippy-check-auth"
              >
                Check Devin auth
              </button>
            </>
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

          {(onAction || onOpenTerminal) && agentEnabled && (
            <button
              className="win95-clippy-chat-auth-btn"
              onClick={handleOpenTerminalClick}
              data-testid="clippy-open-terminal"
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
              placeholder={agentEnabled ? 'Ask Clippy...' : 'Ask Clippy when a real agent is connected...'}
              data-testid="clippy-chat-input"
            />
            <button
              className="win95-clippy-chat-send"
              onClick={handleSendChat}
              disabled={!chatInput.trim()}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
