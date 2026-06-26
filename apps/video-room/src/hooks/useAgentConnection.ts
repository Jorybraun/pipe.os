import { useEffect, useRef, useState, useCallback } from 'react';

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'auth_needed' | 'disconnected';

export interface AgentChatMessage {
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

export interface AgentConnectionState {
  connected: boolean;
  status: AgentStatus;
  messages: AgentChatMessage[];
  authUrl: string | null;
  agentName: string;
  capabilities: string[];
}

export interface UseAgentConnectionOptions {
  wsUrl: string | null;
  enabled: boolean;
}

export function useAgentConnection({ wsUrl, enabled }: UseAgentConnectionOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('disconnected');
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [agentName, setAgentName] = useState('devin');
  const [capabilities, setCapabilities] = useState<string[]>([]);

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
          setStatus('idle');
        };

        ws.onmessage = (event) => {
          let msg;
          try {
            msg = JSON.parse(event.data);
          } catch {
            return;
          }

          switch (msg.type) {
            case 'AGENT_STATUS':
              setStatus(msg.status || 'idle');
              if (msg.status !== 'auth_needed') {
                setAuthUrl(null);
              }
              break;
            case 'CHAT_RESPONSE':
              setMessages((prev) => [...prev, {
                role: 'agent',
                text: msg.text,
                timestamp: Date.now(),
              }]);
              break;
            case 'AUTH_NEEDED':
              setStatus('auth_needed');
              setAuthUrl(msg.authUrl || null);
              setAgentName(msg.agent || 'devin');
              break;
            case 'AGENT_READY':
              setAgentName(msg.agent || 'devin');
              setCapabilities(msg.capabilities || []);
              setStatus('idle');
              setAuthUrl(null);
              break;
            case 'FILE_CHANGED':
              // Could trigger a refresh notification
              break;
            case 'ERROR':
              setMessages((prev) => [...prev, {
                role: 'agent',
                text: `Error: ${msg.message}`,
                timestamp: Date.now(),
              }]);
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

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setMessages((prev) => [...prev, {
      role: 'user',
      text,
      timestamp: Date.now(),
    }]);
    wsRef.current.send(JSON.stringify({ type: 'CHAT', text }));
  }, []);

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
    agentName,
    capabilities,
    sendMessage,
    startAuth,
    stopAgent,
  };
}
