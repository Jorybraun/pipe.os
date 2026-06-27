import { useCallback, useRef } from 'react';

export type SessionEventType =
  | 'chat_message'
  | 'ai_chat_user'
  | 'ai_chat_agent'
  | 'ai_agent_status'
  | 'terminal_command'
  | 'terminal_output'
  | 'file_change'
  | 'browser_navigation'
  | 'window_open'
  | 'window_close'
  | 'window_update'
  | 'window_focus'
  | 'room_surface_change'
  | 'workspace_state'
  | 'participant_join'
  | 'participant_leave'
  | 'clippy_prompt'
  | 'clippy_action'
  | 'recording_start'
  | 'recording_stop'
  | 'code_editor_open'
  | 'code_editor_save';

interface CaptureOptions {
  token: string;
  apiBase: string;
}

/**
 * Hook to capture session events and send them to the API
 * where they become candidate_nodes in the knowledge graph.
 */
export function useSessionEvents({ token, apiBase }: CaptureOptions) {
  const queueRef = useRef<Array<{ type: SessionEventType; text: string; actor?: string; properties?: Record<string, unknown> }>>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const flush = useCallback(async () => {
    if (queueRef.current.length === 0) return;
    const batch = queueRef.current.splice(0);
    const failed: typeof batch = [];
    for (const event of batch) {
      try {
        await fetch(`${apiBase}/api/v1/meeting-rooms/${tokenRef.current}/session-events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        });
      } catch {
        failed.push(event);
      }
    }
    if (failed.length > 0) {
      queueRef.current.unshift(...failed);
    }
  }, [apiBase]);

  const capture = useCallback((type: SessionEventType, text: string, actor?: string, properties?: Record<string, unknown>) => {
    queueRef.current.push({ type, text, actor, properties });

    // Debounce flush — batch events over 500ms
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      void flush();
    }, 500);
  }, [flush]);

  return { capture, flush };
}
