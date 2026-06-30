import { useEffect, useRef, useState, useCallback } from 'react';
import {
  buildClippyBrowserPromptIdentity,
  type ClippyPromptActor,
} from '../lib/clippyPromptIdentity';
import { redactAgentDiagnosticText } from '../lib/agentDiagnosticRedaction';

export type AgentStatus = 'starting' | 'idle' | 'thinking' | 'working' | 'auth_needed' | 'disconnected';
export type AgentPromptDeliveryStatus = 'queued' | 'blocked';
export type AgentPromptBlockedReason =
  | 'workspace_required'
  | 'bridge_reconnecting'
  | 'agent_starting'
  | 'agent_auth_needed'
  | 'agent_disconnected'
  | 'agent_identity_missing'
  | 'agent_capabilities_missing';
export type AgentRoomActionId =
  | 'open-browser'
  | 'open-terminal'
  | 'open-workspace'
  | 'launch-workspace'
  | 'open-files'
  | 'open-notepad'
  | 'open-paint'
  | 'start-recording';

export interface AgentChatMessage {
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
  source?: 'user_submit' | 'agent_stdout' | 'agent_api_response' | 'bridge_diagnostic' | 'bridge_observation';
  agentName?: string;
  agentStatus?: AgentStatus;
  diagnosticSource?: string;
  observedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  truncated?: boolean;
  persisted?: boolean;
  promptType?: string;
  deliveredToAgent?: boolean;
  promptLength?: number;
  promptFingerprint?: string;
  roomContextStatus?: number | null;
  roomContextLength?: number;
  roomContextFingerprint?: string;
  userMessageLength?: number;
  userMessageFingerprint?: string;
  contextTruncated?: boolean;
  browserPromptId?: string;
  browserPromptFingerprint?: string;
  browserPromptTimestamp?: number;
  browserPromptLength?: number;
  agentRuntime?: string;
  agentRunProvider?: string;
  agentRunId?: string;
  agentRunExternalSessionHash?: string;
  deliveryStatus?: AgentPromptDeliveryStatus;
  blockedReason?: AgentPromptBlockedReason;
}

export interface AgentRoomAction {
  id: AgentRoomActionId;
  label: string;
  text?: string;
  url?: string;
  autoExecute?: boolean;
  source?: 'agent_stdout_action' | 'agent_api_response_action' | 'bridge_observation';
  agentName?: string;
  bridgeEventType?: 'CHAT_RESPONSE' | 'FILE_CHANGED' | 'ROOM_ACTION';
  protocol?: 'bridge_actions_field' | 'clippy_room_action_tag' | 'workspace_file_observation';
  observedAt?: string;
  persisted?: boolean;
  browserPromptId?: string;
  browserPromptFingerprint?: string;
  browserPromptTimestamp?: number;
  browserPromptLength?: number;
  agentRuntime?: string;
  agentRunProvider?: string;
  agentRunId?: string;
  agentRunExternalSessionHash?: string;
}

export interface AgentFileChangeEvent {
  filePath: string;
  actionName: string;
  timestamp: number;
  observedAt?: string;
  source?: string;
  sizeBytes?: number;
  contentHash?: string;
  contentPreview?: string;
  persisted?: boolean;
}

export type ParsedAgentBridgeMessage =
  | {
      kind: 'status';
      status: AgentStatus;
      agentName: string;
    }
  | {
      kind: 'chat';
      message: Omit<AgentChatMessage, 'timestamp'>;
      actions?: AgentRoomAction[];
    }
  | {
      kind: 'auth_needed';
      agentName: string;
      authUrl: string | null;
      message: string | null;
    }
  | {
      kind: 'ready';
      agentName: string;
      capabilities: string[];
    }
  | {
      kind: 'file_changed';
      message: Omit<AgentChatMessage, 'timestamp'>;
      action: AgentRoomAction;
      fileChange: Omit<AgentFileChangeEvent, 'timestamp'>;
    }
  | {
      kind: 'room_action';
      action: AgentRoomAction;
    }
  | {
      kind: 'error';
      message: Omit<AgentChatMessage, 'timestamp'>;
    }
  | {
      kind: 'diagnostic';
      message: Omit<AgentChatMessage, 'timestamp'>;
      status: AgentStatus;
      agentName: string;
    }
  | {
      kind: 'ignored';
    };

export interface AgentConnectionState {
  connected: boolean;
  status: AgentStatus;
  messages: AgentChatMessage[];
  authUrl: string | null;
  authMessage: string | null;
  agentName: string;
  capabilities: string[];
  roomActions: AgentRoomAction[];
  fileChanges: AgentFileChangeEvent[];
}

export interface UseAgentConnectionOptions {
  wsUrl: string | null;
  enabled: boolean;
  promptActor?: ClippyPromptActor;
  promptWorkspaceSessionId?: string | null;
}

const ROOM_ACTIONS: Record<AgentRoomActionId, { label: string; aliases: string[] }> = {
  'open-browser': {
    label: 'Open Browser',
    aliases: ['open-browser', 'browser', 'open-edge', 'edge', 'microsoft-edge', 'open-url'],
  },
  'open-terminal': {
    label: 'Open Terminal',
    aliases: ['open-terminal', 'terminal', 'shell', 'open-shell'],
  },
  'open-workspace': {
    label: 'Open Workspace',
    aliases: ['open-workspace', 'workspace', 'code-server', 'editor', 'open-editor'],
  },
  'launch-workspace': {
    label: 'Launch Workspace',
    aliases: ['launch-workspace', 'start-workspace', 'start-container', 'launch-container'],
  },
  'open-files': {
    label: 'Open Files',
    aliases: ['open-files', 'files', 'file-manager', 'explorer'],
  },
  'open-notepad': {
    label: 'Open Notepad',
    aliases: ['open-notepad', 'notepad', 'notes'],
  },
  'open-paint': {
    label: 'Open Paint',
    aliases: ['open-paint', 'paint', 'mspaint', 'ms-paint'],
  },
  'start-recording': {
    label: 'Start Recording',
    aliases: ['start-recording', 'record', 'recording'],
  },
};

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return value === 'starting'
    || value === 'idle'
    || value === 'thinking'
    || value === 'working'
    || value === 'auth_needed'
    || value === 'disconnected';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberOrNullValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeActionName(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function findRoomActionId(value: unknown): AgentRoomActionId | null {
  const raw = stringOrNull(value);
  if (!raw) return null;
  const normalized = normalizeActionName(raw);
  const entry = Object.entries(ROOM_ACTIONS).find(([, config]) => (
    config.aliases.some((alias) => normalizeActionName(alias) === normalized)
  ));
  return entry ? entry[0] as AgentRoomActionId : null;
}

function parseActionUrl(value: unknown): string | undefined {
  const raw = stringOrNull(value);
  if (!raw || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    return undefined;
  }
  return undefined;
}

interface RoomActionParseContext {
  source: AgentRoomAction['source'];
  bridgeEventType: NonNullable<AgentRoomAction['bridgeEventType']>;
  protocol: NonNullable<AgentRoomAction['protocol']>;
  agentName?: string;
}

function parseRoomAction(value: unknown, context: RoomActionParseContext): AgentRoomAction | null {
  if (!isRecord(value)) return null;
  const id = findRoomActionId(value.action ?? value.id ?? value.name);
  if (!id) return null;
  const text = redactAgentDiagnosticText(value.text ?? value.reason ?? value.message) ?? undefined;
  const label = stringOrNull(value.label) ?? ROOM_ACTIONS[id].label;
  const browserPromptId = stringOrNull(value.browserPromptId);
  const browserPromptFingerprint = stringOrNull(value.browserPromptFingerprint);
  const browserPromptTimestamp = numberOrUndefined(value.browserPromptTimestamp);
  const browserPromptLength = numberOrUndefined(value.browserPromptLength);
  const agentRuntime = stringOrNull(value.agentRuntime);
  const agentRunProvider = stringOrNull(value.agentRunProvider);
  const agentRunId = stringOrNull(value.agentRunId);
  const agentRunExternalSessionHash = stringOrNull(value.agentRunExternalSessionHash);
  return {
    id,
    label,
    text,
    url: parseActionUrl(value.url ?? value.href),
    autoExecute: typeof value.autoExecute === 'boolean' ? value.autoExecute : undefined,
    source: context.source,
    agentName: stringOrNull(value.agent) ?? context.agentName,
    bridgeEventType: context.bridgeEventType,
    protocol: context.protocol,
    observedAt: stringOrNull(value.observedAt) ?? undefined,
    persisted: typeof value.persisted === 'boolean' ? value.persisted : undefined,
    ...(browserPromptId ? { browserPromptId } : {}),
    ...(browserPromptFingerprint ? { browserPromptFingerprint } : {}),
    ...(browserPromptTimestamp !== undefined ? { browserPromptTimestamp } : {}),
    ...(browserPromptLength !== undefined ? { browserPromptLength } : {}),
    ...(agentRuntime ? { agentRuntime } : {}),
    ...(agentRunProvider ? { agentRunProvider } : {}),
    ...(agentRunId ? { agentRunId } : {}),
    ...(agentRunExternalSessionHash ? { agentRunExternalSessionHash } : {}),
  };
}

export function agentStatusEvidenceText(status: AgentStatus, agentName: string): string | null {
  const name = agentName.trim();
  if (!name) return null;
  switch (status) {
    case 'starting':
      return `${name} is starting from the real container bridge.`;
    case 'auth_needed':
      return `${name} requires real authentication before it can assist.`;
    case 'thinking':
      return `${name} is thinking about the candidate request.`;
    case 'working':
      return `${name} is working on the candidate request.`;
    case 'idle':
      return `${name} is ready.`;
    case 'disconnected':
      return `${name} bridge is disconnected.`;
    default:
      return `${name} status: ${status}`;
  }
}

export function parseAgentBridgeMessage(value: unknown): ParsedAgentBridgeMessage {
  if (!isRecord(value)) return { kind: 'ignored' };
  if (value.type === 'AGENT_STATUS') {
    const agentName = stringOrNull(value.agent);
    if (!agentName || !isAgentStatus(value.status)) return { kind: 'ignored' };
    return { kind: 'status', status: value.status, agentName };
  }
  if (value.type === 'CHAT_RESPONSE') {
    const text = redactAgentDiagnosticText(value.text);
    if (!text) return { kind: 'ignored' };
    const source = value.source === 'agent_api_response'
      ? 'agent_api_response'
      : value.source === 'agent_stdout'
        ? 'agent_stdout'
        : null;
    if (!source) return { kind: 'ignored' };
    const agentName = stringOrNull(value.agent);
    if (!agentName) return { kind: 'ignored' };
    const observedAt = stringOrNull(value.observedAt);
    const persisted = typeof value.persisted === 'boolean' ? value.persisted : null;
    if (!observedAt || persisted === null) return { kind: 'ignored' };
    const browserPromptId = stringOrNull(value.browserPromptId);
    const browserPromptFingerprint = stringOrNull(value.browserPromptFingerprint);
    const browserPromptTimestamp = numberOrUndefined(value.browserPromptTimestamp);
    const browserPromptLength = numberOrUndefined(value.browserPromptLength);
    const agentRuntime = stringOrNull(value.agentRuntime);
    const agentRunProvider = stringOrNull(value.agentRunProvider);
    const agentRunId = stringOrNull(value.agentRunId);
    const agentRunExternalSessionHash = stringOrNull(value.agentRunExternalSessionHash);
    return {
      kind: 'chat',
      message: {
        role: 'agent',
        text,
        source,
        agentName,
        observedAt,
        persisted,
        ...(browserPromptId ? { browserPromptId } : {}),
        ...(browserPromptFingerprint ? { browserPromptFingerprint } : {}),
        ...(browserPromptTimestamp !== undefined ? { browserPromptTimestamp } : {}),
        ...(browserPromptLength !== undefined ? { browserPromptLength } : {}),
        ...(agentRuntime ? { agentRuntime } : {}),
        ...(agentRunProvider ? { agentRunProvider } : {}),
        ...(agentRunId ? { agentRunId } : {}),
        ...(agentRunExternalSessionHash ? { agentRunExternalSessionHash } : {}),
      },
      actions: undefined,
    };
  }
  if (value.type === 'AUTH_NEEDED') {
    const agentName = stringOrNull(value.agent);
    if (!agentName) return { kind: 'ignored' };
    return {
      kind: 'auth_needed',
      authUrl: stringOrNull(value.authUrl),
      agentName,
      message: redactAgentDiagnosticText(value.message),
    };
  }
  if (value.type === 'AGENT_READY') {
    const agentName = stringOrNull(value.agent);
    if (!agentName) return { kind: 'ignored' };
    return {
      kind: 'ready',
      agentName,
      capabilities: Array.isArray(value.capabilities)
        ? value.capabilities.filter((entry): entry is string => typeof entry === 'string')
        : [],
    };
  }
  if (value.type === 'FILE_CHANGED') {
    const filePath = stringOrNull(value.path ?? value.filePath);
    const actionName = stringOrNull(value.action ?? value.operation);
    const source = stringOrNull(value.source);
    const observedAt = stringOrNull(value.observedAt);
    const sizeBytes = numberOrUndefined(value.sizeBytes);
    const contentHash = stringOrNull(value.contentHash);
    const persisted = typeof value.persisted === 'boolean' ? value.persisted : null;
    if (
      !filePath
      || !actionName
      || source !== 'code_server_workspace'
      || !observedAt
      || typeof sizeBytes !== 'number'
      || sizeBytes < 0
      || !contentHash
      || !SHA256_HEX_RE.test(contentHash)
      || persisted === null
    ) {
      return { kind: 'ignored' };
    }
    const text = `I noticed ${filePath} was ${actionName} in the workspace.`;
    const contentPreview = stringOrNull(value.contentPreview);
    return {
      kind: 'file_changed',
      message: { role: 'agent', text, source: 'bridge_observation' },
      action: {
        id: 'open-workspace',
        label: ROOM_ACTIONS['open-workspace'].label,
        text,
        source: 'bridge_observation',
        bridgeEventType: 'FILE_CHANGED',
        protocol: 'workspace_file_observation',
      },
      fileChange: {
        filePath,
        actionName,
        observedAt,
        source,
        sizeBytes,
        contentHash,
        contentPreview: contentPreview && contentPreview.length <= 4000
          ? contentPreview
          : contentPreview?.slice(0, 4000),
        persisted,
      },
    };
  }
  if (value.type === 'ROOM_ACTION') {
    const agentName = stringOrNull(value.agent);
    if (!agentName) return { kind: 'ignored' };
    const source = value.source === 'agent_api_response'
      ? 'agent_api_response_action'
      : value.source === 'agent_stdout'
        ? 'agent_stdout_action'
        : null;
    if (!source) return { kind: 'ignored' };
    const action = parseRoomAction(value, {
      source,
      bridgeEventType: 'ROOM_ACTION',
      protocol: 'clippy_room_action_tag',
      agentName,
    });
    return action ? { kind: 'room_action', action } : { kind: 'ignored' };
  }
  if (value.type === 'ERROR') {
    const text = redactAgentDiagnosticText(value.message) ?? 'Unknown agent error';
    return {
      kind: 'error',
      message: {
        role: 'agent',
        text: `Error: ${text}`,
        source: 'bridge_diagnostic',
      },
    };
  }
  if (value.type === 'AGENT_DIAGNOSTIC') {
    const text = redactAgentDiagnosticText(value.message) ?? 'Agent bridge diagnostic.';
    const status = isAgentStatus(value.status) ? value.status : 'disconnected';
    const agentName = stringOrNull(value.agent);
    if (!agentName) return { kind: 'ignored' };
    const message: Omit<AgentChatMessage, 'timestamp'> = {
      role: 'agent',
      text,
      source: 'bridge_diagnostic',
      agentName,
      agentStatus: status,
    };
    const diagnosticSource = stringOrNull(value.diagnosticSource);
    const observedAt = stringOrNull(value.observedAt);
    const signal = stringOrNull(value.signal);
    if (diagnosticSource) message.diagnosticSource = diagnosticSource;
    if (observedAt) message.observedAt = observedAt;
    if ('exitCode' in value) message.exitCode = numberOrNullValue(value.exitCode);
    if ('signal' in value) message.signal = signal;
    if (typeof value.truncated === 'boolean') message.truncated = value.truncated;
    if (typeof value.persisted === 'boolean') message.persisted = value.persisted;
    const promptType = stringOrNull(value.promptType);
    const promptFingerprint = stringOrNull(value.promptFingerprint);
    const roomContextFingerprint = stringOrNull(value.roomContextFingerprint);
    const userMessageFingerprint = stringOrNull(value.userMessageFingerprint);
    const browserPromptId = stringOrNull(value.browserPromptId);
    const browserPromptFingerprint = stringOrNull(value.browserPromptFingerprint);
    const agentRuntime = stringOrNull(value.agentRuntime);
    const agentRunProvider = stringOrNull(value.agentRunProvider);
    const agentRunId = stringOrNull(value.agentRunId);
    const agentRunExternalSessionHash = stringOrNull(value.agentRunExternalSessionHash);
    if (promptType) message.promptType = promptType;
    if (typeof value.deliveredToAgent === 'boolean') message.deliveredToAgent = value.deliveredToAgent;
    if ('promptLength' in value) {
      const promptLength = numberOrUndefined(value.promptLength);
      if (promptLength !== undefined) message.promptLength = promptLength;
    }
    if (promptFingerprint) message.promptFingerprint = promptFingerprint;
    if ('roomContextStatus' in value) message.roomContextStatus = numberOrNullValue(value.roomContextStatus);
    if ('roomContextLength' in value) {
      const roomContextLength = numberOrUndefined(value.roomContextLength);
      if (roomContextLength !== undefined) message.roomContextLength = roomContextLength;
    }
    if (roomContextFingerprint) message.roomContextFingerprint = roomContextFingerprint;
    if ('userMessageLength' in value) {
      const userMessageLength = numberOrUndefined(value.userMessageLength);
      if (userMessageLength !== undefined) message.userMessageLength = userMessageLength;
    }
    if (userMessageFingerprint) message.userMessageFingerprint = userMessageFingerprint;
    if (typeof value.contextTruncated === 'boolean') message.contextTruncated = value.contextTruncated;
    if (browserPromptId) message.browserPromptId = browserPromptId;
    if (browserPromptFingerprint) message.browserPromptFingerprint = browserPromptFingerprint;
    if (agentRuntime) message.agentRuntime = agentRuntime;
    if (agentRunProvider) message.agentRunProvider = agentRunProvider;
    if (agentRunId) message.agentRunId = agentRunId;
    if (agentRunExternalSessionHash) message.agentRunExternalSessionHash = agentRunExternalSessionHash;
    if ('browserPromptTimestamp' in value) {
      const browserPromptTimestamp = numberOrUndefined(value.browserPromptTimestamp);
      if (browserPromptTimestamp !== undefined) message.browserPromptTimestamp = browserPromptTimestamp;
    }
    if ('browserPromptLength' in value) {
      const browserPromptLength = numberOrUndefined(value.browserPromptLength);
      if (browserPromptLength !== undefined) message.browserPromptLength = browserPromptLength;
    }
    return {
      kind: 'diagnostic',
      status,
      agentName,
      message,
    };
  }
  return { kind: 'ignored' };
}

export function useAgentConnection({
  wsUrl,
  enabled,
  promptActor = 'guest',
  promptWorkspaceSessionId = null,
}: UseAgentConnectionOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('disconnected');
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [agentName, setAgentName] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [roomActions, setRoomActions] = useState<AgentRoomAction[]>([]);
  const [fileChanges, setFileChanges] = useState<AgentFileChangeEvent[]>([]);

  useEffect(() => {
    if (!enabled || !wsUrl) return;

    let ws: WebSocket;
    let reconnectTimer: number | undefined;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          setStatus('disconnected');
        };

        ws.onmessage = (event) => {
          let rawMessage: unknown;
          try {
            rawMessage = JSON.parse(event.data as string) as unknown;
          } catch {
            return;
          }

          const parsed = parseAgentBridgeMessage(rawMessage);
          switch (parsed.kind) {
            case 'status':
              setStatus(parsed.status);
              setAgentName(parsed.agentName);
              if (parsed.status !== 'auth_needed') {
                setAuthUrl(null);
                setAuthMessage(null);
              }
              break;
            case 'chat':
              setMessages((prev) => [...prev, {
                ...parsed.message,
                timestamp: Date.now(),
              }]);
              if (parsed.actions) {
                setRoomActions((prev) => [...prev.slice(-19), ...parsed.actions!]);
              }
              break;
            case 'auth_needed':
              setStatus('auth_needed');
              setAuthUrl(parsed.authUrl);
              setAuthMessage(parsed.message);
              setAgentName(parsed.agentName);
              break;
            case 'ready':
              setAgentName(parsed.agentName);
              setCapabilities(parsed.capabilities);
              setStatus('idle');
              setAuthUrl(null);
              setAuthMessage(null);
              break;
            case 'file_changed':
              {
                const timestamp = Date.now();
                setMessages((prev) => [...prev, {
                  ...parsed.message,
                  timestamp,
                }]);
                setFileChanges((prev) => [...prev.slice(-49), {
                  ...parsed.fileChange,
                  timestamp,
                }]);
              }
              setRoomActions((prev) => [...prev.slice(-19), parsed.action]);
              break;
            case 'room_action':
              if (parsed.action.text) {
                setMessages((prev) => [...prev, {
                  role: 'agent',
                  text: parsed.action.text ?? parsed.action.label,
                  timestamp: Date.now(),
                }]);
              }
              setRoomActions((prev) => [...prev.slice(-19), parsed.action]);
              break;
            case 'error':
              setMessages((prev) => [...prev, {
                ...parsed.message,
                timestamp: Date.now(),
              }]);
              break;
            case 'diagnostic':
              setAgentName(parsed.agentName);
              setStatus(parsed.status);
              setMessages((prev) => [...prev, {
                ...parsed.message,
                timestamp: Date.now(),
              }]);
              break;
            case 'ignored':
              break;
          }
        };

        ws.onclose = () => {
          setConnected(false);
          setStatus('disconnected');
          if (enabled) {
            reconnectTimer = window.setTimeout(connect, 3000);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        if (enabled) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      }
    };

    connect();

    return () => {
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl, enabled]);

  const sendMessage = useCallback((text: string): AgentChatMessage | null => {
    const trimmed = text.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return null;
    const timestamp = Date.now();
    const promptIdentity = buildClippyBrowserPromptIdentity({
      text: trimmed,
      actor: promptActor,
      timestamp,
      workspaceSessionId: promptWorkspaceSessionId,
    });
    const message: AgentChatMessage = {
      role: 'user',
      text: trimmed,
      timestamp,
      source: 'user_submit',
      ...promptIdentity,
    };
    setMessages((prev) => [...prev, message]);
    wsRef.current.send(JSON.stringify({
      type: 'CHAT',
      text: trimmed,
      ...promptIdentity,
    }));
    return message;
  }, [promptActor, promptWorkspaceSessionId]);

  const startAuth = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'AUTH_START', agent: 'devin' }));
  }, []);

  const stopAgent = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'AGENT_STOP' }));
  }, []);

  return {
    connected,
    status,
    messages,
    authUrl,
    authMessage,
    agentName,
    capabilities,
    roomActions,
    fileChanges,
    sendMessage,
    startAuth,
    stopAgent,
  };
}
