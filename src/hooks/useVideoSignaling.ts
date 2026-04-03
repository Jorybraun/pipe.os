import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  VideoRole,
  VideoSessionStatus,
  VideoSignalType,
  VideoSignalPayload,
} from '../lib/video/types';

// ============================================================================
// Types
// ============================================================================

export type VideoSession = {
  id: string;
  stageId: string;
  candidateId: string;
  recruiterId: string;
  status: string;
  createdAt?: string;
};

interface UseVideoSignalingOptions {
  stageId: string;
  candidateId: string;
  role: VideoRole;
  onSignal: (type: VideoSignalType, payload: VideoSignalPayload) => void;
  sessionToken?: string | null;
}

interface UseVideoSignalingReturn {
  session: VideoSession | null;
  status: VideoSessionStatus | null;
  isLoading: boolean;
  error: Error | null;
  createSession: () => Promise<VideoSession | null>;
  markCalling: () => Promise<void>;
  markActive: () => Promise<void>;
  markEnded: () => Promise<void>;
  sendSignal: (type: VideoSignalType, payload: VideoSignalPayload) => Promise<void>;
}

// ============================================================================
// Config
// ============================================================================

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';
const WS_BASE = API_BASE.replace(/^http/, 'ws');

// ============================================================================
// Hook
// ============================================================================

/**
 * useVideoSignaling — Manages WebSocket connection to the VideoRoom
 * Durable Object for WebRTC signaling between peers.
 *
 * Replaces the previous AppSync-based signaling with a direct WebSocket
 * connection to a Cloudflare Durable Object.
 */
export function useVideoSignaling({
  stageId,
  candidateId,
  role,
  onSignal,
  sessionToken,
}: UseVideoSignalingOptions): UseVideoSignalingReturn {
  const [session, setSession] = useState<VideoSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  // Connect WebSocket to Durable Object when session exists
  useEffect(() => {
    if (!session) return;

    const wsPath = role === 'RECRUITER'
      ? `${WS_BASE}/api/v1/video/sessions/${session.id}/ws`
      : `${WS_BASE}/rpc/video/sessions/${session.id}/ws`;

    const ws = new WebSocket(wsPath);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`[useVideoSignaling] WebSocket connected as ${role}`);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as {
          type: string;
          role?: string;
          status?: string;
          payload?: unknown;
        };

        // Handle status updates
        if (message.type === 'STATUS_UPDATE' && message.status) {
          setSession((prev) =>
            prev ? { ...prev, status: message.status as string } : prev,
          );
          return;
        }

        // Handle peer disconnection
        if (message.type === 'PEER_DISCONNECTED') {
          onSignalRef.current('HANGUP', { reason: 'peer_disconnected' });
          return;
        }

        // Route signaling messages (only from remote peer)
        if (message.role !== role && message.payload) {
          onSignalRef.current(
            message.type as VideoSignalType,
            message.payload as VideoSignalPayload,
          );
        }
      } catch (err) {
        console.error('[useVideoSignaling] Failed to parse message:', err);
      }
    };

    ws.onclose = (event) => {
      console.log('[useVideoSignaling] WebSocket closed:', event.code);
      wsRef.current = null;
    };

    ws.onerror = (event) => {
      console.error('[useVideoSignaling] WebSocket error:', event);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [session?.id, role]);

  // Initial loading state
  useEffect(() => {
    setIsLoading(false);
  }, []);

  // ---- Mutations ----------------------------------------------------------

  const createSession = useCallback(async (): Promise<VideoSession | null> => {
    if (role !== 'RECRUITER') {
      console.error('[useVideoSignaling] Only RECRUITER can create sessions');
      return null;
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const clerkToken = await getClerkToken();
      if (clerkToken) {
        headers['Authorization'] = `Bearer ${clerkToken}`;
      }

      const response = await fetch(`${API_BASE}/api/v1/video/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ stageId, candidateId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }

      const data = await response.json() as {
        session: VideoSession;
      };

      setSession(data.session);
      return data.session;
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to create session');
      console.error('[useVideoSignaling] createSession error:', e);
      setError(e);
      return null;
    }
  }, [role, stageId, candidateId, sessionToken]);

  const sendStatusUpdate = useCallback(async (status: VideoSessionStatus): Promise<void> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[useVideoSignaling] WebSocket not connected');
      return;
    }

    ws.send(JSON.stringify({
      type: 'STATUS_UPDATE',
      status,
    }));

    // Optimistic local update
    setSession((prev) => prev ? { ...prev, status } : prev);
  }, []);

  const markCalling = useCallback(() => sendStatusUpdate('CALLING'), [sendStatusUpdate]);
  const markActive = useCallback(() => sendStatusUpdate('ACTIVE'), [sendStatusUpdate]);
  const markEnded = useCallback(() => sendStatusUpdate('ENDED'), [sendStatusUpdate]);

  const sendSignal = useCallback(
    async (type: VideoSignalType, payload: VideoSignalPayload): Promise<void> => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('[useVideoSignaling] sendSignal: WebSocket not connected');
        return;
      }

      ws.send(JSON.stringify({ type, payload }));
    },
    [],
  );

  return {
    session,
    status: (session?.status as VideoSessionStatus) ?? null,
    isLoading,
    error,
    createSession,
    markCalling,
    markActive,
    markEnded,
    sendSignal,
  };
}

// ─── Helper: Get Clerk token ────────────────────────────────────────────────

async function getClerkToken(): Promise<string | null> {
  try {
    // Access Clerk from the window — avoid importing @clerk/react in this hook
    const clerk = (window as unknown as { Clerk?: { session?: { getToken: () => Promise<string> } } }).Clerk;
    if (clerk?.session) {
      return await clerk.session.getToken();
    }
  } catch {
    // Clerk not available
  }
  return null;
}
