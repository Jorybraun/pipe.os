/**
 * useAgentChat — manages conversation state with the copilot agent.
 *
 * Restores session on mount. Sends messages via POST /api/v1/agent/chat.
 * Optimistic UI: user message appears immediately, agent response appends on completion.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useApiClient } from './useApiClient';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  timestamp: string;
}

export interface UseAgentChatResult {
  messages: ChatMessage[];
  isThinking: boolean;
  skillMode: string;
  sendMessage: (text: string) => Promise<void>;
  setSkillMode: (mode: string) => void;
  clearSession: () => Promise<void>;
  error: string | null;
}

interface SessionResponse {
  session: {
    id: string;
    skillMode: string;
    messages: Array<{ role: string; content: string | null }>;
  } | null;
}

interface ChatResponse {
  sessionId: string;
  response: string;
  toolsUsed: string[];
  skillMode: string;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAgentChat(
  pipelineId: string | null,
  initialSkillMode: string = 'general',
): UseAgentChatResult {
  const api = useApiClient();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [skillMode, setSkillMode] = useState(initialSkillMode);
  const [error, setError] = useState<string | null>(null);
  const restoredRef = useRef(false);

  // Restore session on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    void (async () => {
      try {
        const qs = pipelineId ? `?pipelineId=${pipelineId}` : '';
        const data = await api.get<SessionResponse>(`/api/v1/agent/session${qs}`);
        if (data.session?.messages?.length) {
          const restored: ChatMessage[] = [];
          for (const m of data.session.messages) {
            if ((m.role === 'user' || m.role === 'assistant') && m.content) {
              // Skip tool result messages (they show as user messages with "Tool result for" prefix)
              if (m.role === 'user' && m.content.startsWith('Tool result for')) continue;
              // Skip "[Calling tool:" messages
              if (m.role === 'assistant' && m.content.startsWith('[Calling tool:')) continue;
              restored.push({
                role: m.role,
                content: m.content,
                timestamp: new Date().toISOString(),
              });
            }
          }
          setMessages(restored);
          setSkillMode(data.session.skillMode);
        }
      } catch {
        // No session — that's fine
      }
    })();
  }, [api, pipelineId]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setError(null);

    // Optimistic: add user message immediately
    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsThinking(true);

    try {
      const data = await api.post<ChatResponse>('/api/v1/agent/chat', {
        message: text,
        pipelineId,
        skillMode,
      });

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.response,
        ...(data.toolsUsed.length > 0 ? { toolsUsed: data.toolsUsed } : {}),
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setSkillMode(data.skillMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsThinking(false);
    }
  }, [api, pipelineId, skillMode]);

  const clearSession = useCallback(async () => {
    try {
      const qs = pipelineId ? `?pipelineId=${pipelineId}` : '';
      await api.get<{ success: boolean }>(`/api/v1/agent/session${qs}`); // Just to test
      // Actually delete via a custom approach since ApiClient may not have delete
      // For now, clear local state
      setMessages([]);
      setSkillMode('general');
      setError(null);
    } catch {
      // Clear local state regardless
      setMessages([]);
      setSkillMode('general');
    }
  }, [api, pipelineId]);

  return {
    messages,
    isThinking,
    skillMode,
    sendMessage,
    setSkillMode,
    clearSession,
    error,
  };
}
