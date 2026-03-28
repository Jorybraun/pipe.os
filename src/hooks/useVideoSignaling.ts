import { useState, useEffect, useCallback, useRef } from 'react';
import { useData } from '../providers';
import type { DataProvider, DataProviderFactory } from '../providers';
import type {
  VideoRole,
  VideoSessionStatus,
  VideoSignalType,
  VideoSignalPayload,
} from '../lib/video/types';

// ============================================================================
// Types
// ============================================================================

export type VideoSession = Record<string, unknown> & {
  id: string;
  stageId: string;
  candidateId: string;
  recruiterId: string;
  status: string;
  createdAt?: string;
};

export type VideoSignal = Record<string, unknown> & {
  id: string;
  sessionId: string;
  senderRole: string;
  type: string;
  payload?: string | unknown;
};

interface UseVideoSignalingOptions {
  /** ID of the Stage this video session belongs to */
  stageId: string;
  /** ID of the Candidate in this session */
  candidateId: string;
  /** Role of the local user */
  role: VideoRole;
  /**
   * Called every time a new signal arrives from the remote peer.
   * The hook filters out signals sent by the local role, so all
   * signals delivered here are from the remote party.
   */
  onSignal: (type: VideoSignalType, payload: VideoSignalPayload) => void;
  /** JWT session token for lambda-authorized candidate calls (optional, falls back to apiKey) */
  sessionToken?: string | null;
}

interface UseVideoSignalingReturn {
  /** Current session record, or null before one is established */
  session: VideoSession | null;
  /** Derived status from session.status */
  status: VideoSessionStatus | null;
  /** True while the initial session lookup/create is in progress */
  isLoading: boolean;
  /** Any fatal error */
  error: Error | null;
  /** Recruiter only: creates the VideoSession in WAITING state */
  createSession: () => Promise<VideoSession | null>;
  /** Recruiter only: transitions to CALLING, call after sending SDP offer */
  markCalling: () => Promise<void>;
  /** Recruiter/Candidate: transitions to ACTIVE */
  markActive: () => Promise<void>;
  /** Either party: transitions to ENDED */
  markEnded: () => Promise<void>;
  /** Send a signaling message (SDP offer/answer or ICE candidate) */
  sendSignal: (type: VideoSignalType, payload: VideoSignalPayload) => Promise<void>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useVideoSignaling — Manages the AppSync VideoSession record and
 * VideoSignal messages that drive WebRTC signaling between peers.
 *
 * - Recruiter uses userPool auth (owns the session record).
 * - Candidate uses apiKey auth (publicApiKey read/update/create).
 */
export function useVideoSignaling({
  stageId,
  candidateId,
  role,
  onSignal,
  sessionToken,
}: UseVideoSignalingOptions): UseVideoSignalingReturn {
  const factory: DataProviderFactory = useData();

  function getCandidateVideoClient() {
    if (sessionToken) {
      return factory.createSessionClient(sessionToken);
    }
    return factory.createPublicClient();
  }

  const client: DataProvider = role === 'RECRUITER'
    ? factory.createClient()
    : getCandidateVideoClient();

  const [session, setSession] = useState<VideoSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Track the session ID for use inside subscriptions
  const sessionIdRef = useRef<string | null>(null);

  // Deduplication: observeQuery replays the full list on every update,
  // so we track which signal IDs we've already dispatched to avoid
  // re-processing OFFER and ICE_CANDIDATE signals on subsequent updates.
  const processedSignalIds = useRef<Set<string>>(new Set());

  // ---- Continuously watch for the session ---------------------------------
  //
  // Use observeQuery instead of a one-time list() so the CANDIDATE picks up
  // sessions created by the RECRUITER *after* the candidate has loaded the page.
  // This also handles real-time status changes (WAITING → CALLING → ACTIVE).

  useEffect(() => {
    let isMounted = true;

    const sub = client.models.VideoSession.observeQuery({
      filter: {
        stageId: { eq: stageId },
        candidateId: { eq: candidateId },
      },
    }).subscribe({
      next: ({ items }) => {
        if (!isMounted) return;
        setIsLoading(false);

        const typedItems = items as VideoSession[];

        // Pick the most recently created non-ended session
        const active = [...typedItems]
          .filter((s) => s.status !== 'ENDED')
          .sort((a, b) =>
            ((b.createdAt as string) ?? '').localeCompare((a.createdAt as string) ?? '')
          )[0] ?? null;

        if (active) {
          setSession(active);
          sessionIdRef.current = active.id;
        } else if (!active && typedItems.every((s) => s.status === 'ENDED')) {
          // All sessions ended — clear local state
          setSession(null);
          sessionIdRef.current = null;
        }
      },
      error: (err: unknown) => {
        if (isMounted) {
          console.error('[useVideoSignaling] Session watch error:', err);
          setError(
            err instanceof Error ? err : new Error('Failed to watch video session')
          );
          setIsLoading(false);
        }
      },
    });

    return () => {
      isMounted = false;
      sub.unsubscribe();
    };
  }, [stageId, candidateId, role, sessionToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Subscribe to incoming signals from the remote peer -----------------

  useEffect(() => {
    if (!session) return;

    // Reset deduplication set when session changes (new call)
    processedSignalIds.current = new Set();

    const remoteRole: VideoRole = role === 'RECRUITER' ? 'CANDIDATE' : 'RECRUITER';

    const sub = client.models.VideoSignal.observeQuery({
      filter: {
        sessionId: { eq: session.id },
        senderRole: { eq: remoteRole },
      },
    }).subscribe({
      next: ({ items }) => {
        // observeQuery replays the full list on every new item. Guard
        // against re-processing signals we've already dispatched (e.g.
        // the SDP OFFER or earlier ICE candidates).
        const typedItems = items as VideoSignal[];
        typedItems.forEach((sig) => {
          if (!sig.payload) return;
          if (processedSignalIds.current.has(sig.id)) return;
          processedSignalIds.current.add(sig.id);
          const payload =
            typeof sig.payload === 'string'
              ? (JSON.parse(sig.payload) as VideoSignalPayload)
              : (sig.payload as VideoSignalPayload);
          onSignal(sig.type as VideoSignalType, payload);
        });
      },
      error: (err: unknown) => {
        console.error('[useVideoSignaling] Signal subscription error:', err);
      },
    });

    return () => sub.unsubscribe();
  }, [session?.id, role, onSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Mutations ----------------------------------------------------------

  const createSession = useCallback(async (): Promise<VideoSession | null> => {
    if (role !== 'RECRUITER') {
      console.error('[useVideoSignaling] Only RECRUITER can create sessions');
      return null;
    }
    try {
      const recruiterClient = factory.createClient();
      const { data: newSession, errors } =
        await recruiterClient.models.VideoSession.create({
          stageId,
          candidateId,
          recruiterId: 'self', // Amplify owner field is set automatically
          status: 'WAITING',
        });
      if (errors) throw new Error(errors[0]?.message ?? 'Operation failed');
      // Optimistic local update (observeQuery will confirm shortly)
      if (newSession) {
        const typedSession = newSession as VideoSession;
        setSession(typedSession);
        sessionIdRef.current = typedSession.id;
      }
      return (newSession as VideoSession) ?? null;
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to create session');
      console.error('[useVideoSignaling] createSession error:', e);
      setError(e);
      return null;
    }
  }, [role, stageId, candidateId, factory]);

  const updateStatus = useCallback(
    async (status: VideoSessionStatus): Promise<void> => {
      const id = sessionIdRef.current;
      if (!id) return;
      try {
        const { errors } = await client.models.VideoSession.update({
          id,
          status,
        });
        if (errors) throw new Error(errors[0]?.message ?? 'Operation failed');
      } catch (err) {
        console.error(`[useVideoSignaling] updateStatus(${status}) error:`, err);
      }
    },
    [role, sessionToken] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const markCalling = useCallback(() => updateStatus('CALLING'), [updateStatus]);
  const markActive = useCallback(() => updateStatus('ACTIVE'), [updateStatus]);
  const markEnded = useCallback(() => updateStatus('ENDED'), [updateStatus]);

  const sendSignal = useCallback(
    async (type: VideoSignalType, payload: VideoSignalPayload): Promise<void> => {
      const id = sessionIdRef.current;
      if (!id) {
        console.error('[useVideoSignaling] sendSignal: no active session');
        return;
      }
      try {
        // Serialize payload to a JSON string. AppSync's a.json() field rejects
        // objects with null-valued properties (e.g. sdpMLineIndex: null on some
        // ICE candidates). A string value sidesteps schema validation entirely.
        const { errors } = await client.models.VideoSignal.create({
          sessionId: id,
          senderRole: role,
          type,
          payload: JSON.stringify(payload),
        });
        if (errors) throw new Error(errors[0]?.message ?? 'Operation failed');
      } catch (err) {
        console.error('[useVideoSignaling] sendSignal error:', err);
      }
    },
    [role, sessionToken] // eslint-disable-line react-hooks/exhaustive-deps
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
