import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Terminal, X } from 'lucide-react';
import {
  useAgentConnection,
  type AgentChatMessage,
  type AgentPromptBlockedReason,
  type AgentFileChangeEvent,
  type AgentRoomAction,
  type AgentStatus,
} from '../hooks/useAgentConnection';
import type { AgentPromptActor } from '../lib/agentPromptIdentity';
import { buildAgentBrowserPromptIdentity } from '../lib/agentPromptIdentity';

const BLOCKED_PROMPT_MESSAGES: Record<AgentPromptBlockedReason, string> = {
  workspace_required: 'The assistant could not send that because the dev workspace is not running.',
  bridge_reconnecting: 'The assistant could not send that because the container bridge is reconnecting.',
  agent_starting: 'The assistant could not send that because the real agent is still starting.',
  agent_auth_needed: 'The assistant could not send that because the real agent needs authentication.',
  agent_disconnected: 'The assistant could not send that because no real agent bridge is ready.',
  agent_identity_missing: 'The assistant could not send that because the bridge has not reported a real agent identity.',
  agent_capabilities_missing: 'The assistant could not send that because the real agent has not reported chat capability yet.',
};

export interface AgentAssistantMessage {
  text: string;
  hold?: boolean;
  actions?: AgentAssistantAction[];
}

export interface AgentAssistantAction {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface AgentAssistantProps {
  messages: AgentAssistantMessage[];
  onDismiss: () => void;
  chatOpen?: boolean;
  onChatOpen?: () => void;
  onChatClose?: () => void;
  agentWsUrl?: string | null;
  agentEnabled?: boolean;
  agentUnavailableMessage?: string;
  canLaunchAgentWorkspace?: boolean;
  promptActor?: AgentPromptActor;
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

export function AgentAssistant({
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
}: AgentAssistantProps): JSX.Element {
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

  const agentConn = useAgentConnection({
    wsUrl: agentWsUrl ?? null,
    enabled: agentEnabled,
    promptActor,
    promptWorkspaceSessionId,
  });

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
  }, [latestAgentRoomAction, latestAgentRoomActionSignature, onAgentRoomAction]);

  const reportedAgentName = agentConn.agentName.trim();
  const agentDisplayName = reportedAgentName || 'the real agent';

  const agentRoomActionPrompt: AgentAssistantMessage | null = latestAgentRoomAction
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
      return;
    }
    setLocalChatOpen(true);
    onChatOpen?.();
  }, [canOpenAgentBridgeChat, onChatOpen]);

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
    onOpenAuthTerminal?.();
  }, [onOpenAuthTerminal]);

  const handleOpenTerminalClick = useCallback(() => {
    if (onAction) {
      onAction('open-terminal');
      return;
    }
    onOpenTerminal?.();
  }, [onAction, onOpenTerminal]);

  const handleActionClick = useCallback((actionId: string) => {
    if (actionId === 'agent-room-action' && latestAgentRoomAction) {
      onAgentRoomAction?.(latestAgentRoomAction);
      return;
    }
    onAction?.(actionId);
  }, [latestAgentRoomAction, onAction, onAgentRoomAction]);

  const showPrompt = Boolean(currentPrompt && !chatOpen && currentPromptSignature !== dismissedPromptSignature);

  const handleDismiss = useCallback(() => {
    setDismissedPromptSignature((current) => currentPromptSignature ?? current);
    onDismiss();
  }, [currentPromptSignature, onDismiss]);

  const statusLabel: Record<string, string> = {
    starting: 'Starting',
    idle: 'Ready',
    thinking: 'Thinking',
    working: 'Working',
    auth_needed: 'Authentication required',
    disconnected: 'Disconnected',
  };
  const unavailableMessage = agentUnavailableMessage
    ?? 'Launch the VS Code workspace to connect a real agent. Assistant chat stays disabled until the container bridge reports an agent identity.';
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
    const promptIdentity = buildAgentBrowserPromptIdentity({
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
      ? 'Assistant bridge is reconnecting to the dev container.'
      : agentConn.status === 'starting'
        ? `Starting ${agentDisplayName} inside the dev container.`
        : agentConn.status === 'auth_needed'
          ? agentConn.authMessage ?? `${agentDisplayName} is not authenticated in this container. Real credentials are required before chat is enabled.`
          : agentConn.status === 'disconnected'
            ? 'The bridge is connected, but no real agent has reported ready yet.'
            : reportedAgentName.length === 0
              ? 'Waiting for the container bridge to report a real agent identity before chat is enabled.'
              : agentConn.capabilities.length === 0
                ? `Waiting for ${agentDisplayName} to report ready before chat is enabled.`
                : `Connected to ${agentDisplayName}. Ask about the code or the assessment workspace.`;
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
      {showPrompt && currentPrompt && (
        <aside className="agent-assistant-prompt" data-testid="assistant-prompt">
          <div className="agent-assistant-prompt-icon">
            <Bot size={18} />
          </div>
          <div className="agent-assistant-prompt-copy">
            <strong>AI assistant</strong>
            <span>{currentPrompt.text}</span>
          </div>
          <div className="agent-assistant-prompt-actions">
            {currentPrompt.actions?.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => handleActionClick(action.id)}
                disabled={action.disabled}
              >
                {action.label}
              </button>
            ))}
            <button type="button" onClick={openChat}>Open chat</button>
            <button type="button" onClick={handleDismiss} aria-label="Dismiss assistant prompt">
              <X size={14} />
            </button>
          </div>
        </aside>
      )}

      {chatOpen && (
        <section className="agent-assistant-panel" data-testid="agent-chat">
          <header className="agent-assistant-header">
            <div>
              <span>AI assistant</span>
              <strong>{chatAgentName}</strong>
            </div>
            <button
              type="button"
              onClick={closeChat}
              aria-label="Close AI assistant"
              data-testid="agent-chat-close"
            >
              <X size={16} />
            </button>
          </header>

          <div className="agent-assistant-messages">
            {chatMessages.length === 0 && (
              <div className="agent-assistant-message agent">
                {emptyChatMessage}
              </div>
            )}
            {chatMessages.map((msg, i) => (
              <div
                key={`${msg.timestamp}-${i}`}
                className={`agent-assistant-message ${msg.role}`}
              >
                {msg.text}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="agent-assistant-status">
            <span className={`agent-assistant-status-dot ${agentEnabled ? agentConn.status : 'unavailable'}`} />
            <span>
              {agentEnabled
                ? statusLabel[agentConn.status] || agentConn.status
                : 'Workspace required'}
            </span>
            {agentEnabled && !agentConn.connected && <span> - reconnecting</span>}
          </div>

          <div className="agent-assistant-checklist" data-testid="agent-bridge-checklist">
            {bridgeChecks.map((check) => (
              <div
                className={`agent-assistant-check is-${check.state}`}
                key={check.label}
                data-testid={`agent-bridge-check-${check.label.toLowerCase()}`}
              >
                <span>{check.label}</span>
                <strong>{check.value}</strong>
              </div>
            ))}
          </div>

          {agentEnabled && agentConn.status === 'auth_needed' && agentConn.authUrl && (
            <button
              className="agent-assistant-action-btn"
              onClick={handleAuthClick}
              data-testid="agent-open-auth-browser"
            >
              Authenticate {agentDisplayName}
            </button>
          )}

          {agentEnabled && agentConn.status === 'auth_needed' && !agentConn.authUrl && onOpenAuthTerminal && (
            <>
              <button
                className="agent-assistant-action-btn"
                onClick={handleAuthTerminalClick}
                data-testid="agent-open-auth-terminal"
              >
                Open Devin login terminal
              </button>
              <button
                className="agent-assistant-action-btn"
                onClick={handleAuthClick}
                data-testid="agent-check-auth"
              >
                Check Devin auth
              </button>
            </>
          )}

          {!agentEnabled && canLaunchAgentWorkspace && (
            <button
              className="agent-assistant-action-btn"
              onClick={() => handleActionClick('launch-workspace')}
              data-testid="agent-launch-workspace"
            >
              Launch workspace
            </button>
          )}

          {(onAction || onOpenTerminal) && agentEnabled && (
            <button
              className="agent-assistant-action-btn"
              onClick={handleOpenTerminalClick}
              data-testid="agent-open-terminal"
            >
              <Terminal size={14} />
              Open terminal
            </button>
          )}

          <div className="agent-assistant-input-row">
            <input
              type="text"
              className="agent-assistant-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendChat();
              }}
              placeholder={agentEnabled ? 'Ask the AI assistant...' : 'Connect a real agent before asking...'}
              data-testid="agent-chat-input"
            />
            <button
              className="agent-assistant-send"
              onClick={handleSendChat}
              disabled={!chatInput.trim()}
            >
              Send
            </button>
          </div>
        </section>
      )}
    </>
  );
}
