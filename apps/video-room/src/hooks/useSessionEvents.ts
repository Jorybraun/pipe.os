import { useCallback, useEffect, useRef } from 'react';

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

interface QueuedSessionEvent {
  type: SessionEventType;
  text: string;
  actor?: string;
  properties?: Record<string, unknown>;
}

const SESSION_EVENT_FLUSH_DELAY_MS = 500;

function sessionEventsUrl(apiBase: string, token: string): string {
  return `${apiBase}/api/v1/meeting-rooms/${token}/session-events`;
}

/**
 * Hook to capture session events and send them to the API
 * where they become candidate_nodes in the knowledge graph.
 */
export function useSessionEvents({ token, apiBase }: CaptureOptions) {
  const queueRef = useRef<QueuedSessionEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(token);
  const apiBaseRef = useRef(apiBase);
  tokenRef.current = token;
  apiBaseRef.current = apiBase;

  const clearFlushTimer = useCallback((): void => {
    if (!flushTimerRef.current) return;
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
  }, []);

  const flush = useCallback(async () => {
    if (queueRef.current.length === 0) return;
    clearFlushTimer();
    const batch = queueRef.current.splice(0);
    const failed: typeof batch = [];
    for (const event of batch) {
      try {
        const response = await fetch(sessionEventsUrl(apiBaseRef.current, tokenRef.current), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        });
        if (!response.ok) {
          failed.push(event);
        }
      } catch {
        failed.push(event);
      }
    }
    if (failed.length > 0) {
      queueRef.current.unshift(...failed);
    }
  }, [clearFlushTimer]);

  const flushBeforeUnload = useCallback((): void => {
    if (queueRef.current.length === 0) return;
    clearFlushTimer();
    const batch = queueRef.current.splice(0);
    for (const event of batch) {
      const body = JSON.stringify(event);
      const url = sessionEventsUrl(apiBaseRef.current, tokenRef.current);
      try {
        if (navigator.sendBeacon?.(url, body)) continue;
      } catch {
        // Fall back to keepalive fetch below.
      }
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  }, [clearFlushTimer]);

  const capture = useCallback((type: SessionEventType, text: string, actor?: string, properties?: Record<string, unknown>) => {
    queueRef.current.push({ type, text, actor, properties });

    // Debounce flush — batch events over 500ms
    clearFlushTimer();
    flushTimerRef.current = setTimeout(() => {
      void flush();
    }, SESSION_EVENT_FLUSH_DELAY_MS);
  }, [clearFlushTimer, flush]);

  useEffect(() => {
    const handlePageHide = (): void => {
      flushBeforeUnload();
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        flushBeforeUnload();
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flushBeforeUnload();
      clearFlushTimer();
    };
  }, [clearFlushTimer, flushBeforeUnload]);

  return { capture, flush };
}
