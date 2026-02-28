import { useState, useEffect, useCallback, useRef } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import type {
  VideoRole,
  VideoSessionStatus,
  VideoSignalType,
  VideoSignalPayload,
} from '../lib/video/types';

// ============================================================================
// Types
// ============================================================================

export type VideoSession = Schema['VideoSession']['type'];
export type VideoSignal = Schema['VideoSignal']['type'];

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

const candidateClient = generateClient<Schema>({ authMode: 'apiKey' });
const recruiterClient = generateClient<Schema>(); // userPool auth

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
}: UseVideoSignalingOptions): UseVideoSignalingReturn {
  const client = role === 'RECRUITER' ? recruiterClient : candidateClient;

  const [session, setSession] = useState<VideoSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Track the session ID for subscriptions set up asynchronously
  const sessionIdRef = useRef<string | null>(null);

  // ---- Find or subscribe to the existing session -------------------------

  useEffect(() => {
    let isMounted = true;

    async function init(): Promise<void> {
      try {
        // Find an existing non-ended session for this stage + candidate
        const { data: sessions } = await client.models.VideoSession.list({
          filter: {
            stageId: { eq: stageId },
            candidateId: { eq: candidateId },
          },
        });

        const active = (sessions ?? []).find((s) => s.status !== 'ENDED');
        if (isMounted && active) {
          setSession(active);
          sessionIdRef.current = active.id;
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error ? err : new Error('Failed to fetch video session')
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void init();
    return () => { isMounted = false; };
  }, [stageId, candidateId, client]);

  // ---- Subscribe to session status updates --------------------------------

  useEffect(() => {
    if (!session) return;

    // Re-read session when it's updated by the other party
    const sub = client.models.VideoSession.observeQuery({
      filter: { id: { eq: session.id } },
    }).subscribe({
      next: ({ items }) => {
        const updated = items[0];
        if (updated) setSession(updated);
      },
      error: (err: unknown) => {
        console.error('[useVideoSignaling] Session subscription error:', err);
      },
    });

    return () => sub.unsubscribe();
  }, [session?.id, client]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Subscribe to incoming signals from the remote peer -----------------

  useEffect(() => {
    if (!session) return;

    const remoteRole: VideoRole = role === 'RECRUITER' ? 'CANDIDATE' : 'RECRUITER';

    const sub = client.models.VideoSignal.observeQuery({
      filter: {
        sessionId: { eq: session.id },
        senderRole: { eq: remoteRole },
      },
    }).subscribe({
      next: ({ items }) => {
        // Process signals sequentially based on createdAt ordering.
        // AppSync delivers the full list each time, so we key by id to
        // avoid re-processing already-handled signals.
        items.forEach((sig) => {
          if (!sig.payload) return;
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
  }, [session?.id, role, onSignal, client]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Mutations ----------------------------------------------------------

  const createSession = useCallback(async (): Promise<VideoSession | null> => {
    if (role !== 'RECRUITER') {
      console.error('[useVideoSignaling] Only RECRUITER can create sessions');
      return null;
    }
    try {
      const { data: newSession, errors } =
        await recruiterClient.models.VideoSession.create({
          stageId,
          candidateId,
          recruiterId: 'self', // Amplify owner field is set automatically
          status: 'WAITING',
        });
      if (errors) throw new Error(errors[0].message);
      if (newSession) {
        setSession(newSession);
        sessionIdRef.current = newSession.id;
      }
      return newSession ?? null;
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to create session');
      console.error('[useVideoSignaling] createSession error:', e);
      setError(e);
      return null;
    }
  }, [role, stageId, candidateId]);

  const updateStatus = useCallback(
    async (status: VideoSessionStatus): Promise<void> => {
      if (!session) return;
      try {
        const { errors } = await client.models.VideoSession.update({
          id: session.id,
          status,
        });
        if (errors) throw new Error(errors[0].message);
      } catch (err) {
        console.error(`[useVideoSignaling] updateStatus(${status}) error:`, err);
      }
    },
    [session, client]
  );

  const markCalling = useCallback(() => updateStatus('CALLING'), [updateStatus]);
  const markActive = useCallback(() => updateStatus('ACTIVE'), [updateStatus]);
  const markEnded = useCallback(() => updateStatus('ENDED'), [updateStatus]);

  const sendSignal = useCallback(
    async (type: VideoSignalType, payload: VideoSignalPayload): Promise<void> => {
      if (!session) {
        console.error('[useVideoSignaling] sendSignal: no active session');
        return;
      }
      try {
        const { errors } = await client.models.VideoSignal.create({
          sessionId: session.id,
          senderRole: role,
          type,
          payload,
        });
        if (errors) throw new Error(errors[0].message);
      } catch (err) {
        console.error('[useVideoSignaling] sendSignal error:', err);
      }
    },
    [session, role, client]
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
