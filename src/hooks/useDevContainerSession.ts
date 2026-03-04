/**
 * useDevContainerSession Hook
 *
 * Manages the full lifecycle of a Fargate dev container session:
 *   IDLE → LAUNCHING → BOOTING → READY → DESTROYING → IDLE
 *
 * Status updates are delivered in real time via an AppSync subscription
 * (observeQuery on DevContainerSession) — no polling required.
 * The ECS EventBridge rule triggers devContainerEventHandler, which updates
 * the DevContainerSession record and AppSync pushes the change to the client.
 *
 * Usage:
 *   const { state, containerUrl, launch, destroy } = useDevContainerSession();
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import { v4 as uuid } from 'uuid';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

export type ContainerSessionState =
  | 'IDLE'
  | 'LAUNCHING'
  | 'BOOTING'
  | 'READY'
  | 'DESTROYING'
  | 'ERROR';

export interface UseDevContainerSessionReturn {
  /** Current lifecycle state of the session */
  state: ContainerSessionState;
  /** code-server URL — only populated when state = 'READY' */
  containerUrl: string | null;
  /** ECS task ARN — available from BOOTING onward */
  taskArn: string | null;
  /** Human-readable error message when state = 'ERROR' */
  error: string | null;
  /** Spin up a new Fargate container */
  launch: () => Promise<void>;
  /** Tear down the running container */
  destroy: () => Promise<void>;
  /** Reset to IDLE after an error */
  reset: () => void;
}

/** Maps the DevContainerSession.status enum value to our UI state machine. */
function mapSessionStatus(
  status: string | null | undefined
): ContainerSessionState {
  switch (status) {
    case 'PROVISIONING':
      return 'BOOTING';
    case 'BOOTING':
      return 'BOOTING';
    case 'READY':
      return 'READY';
    case 'STOPPING':
      return 'DESTROYING';
    case 'STOPPED':
      return 'IDLE';
    case 'ERROR':
      return 'ERROR';
    default:
      return 'BOOTING';
  }
}

export function useDevContainerSession(): UseDevContainerSessionReturn {
  const [state, setState] = useState<ContainerSessionState>('IDLE');
  const [containerUrl, setContainerUrl] = useState<string | null>(null);
  const [taskArn, setTaskArn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // sessionId is set after a successful launch and drives the subscription
  const [sessionId, setSessionId] = useState<string | null>(null);
  const taskArnRef = useRef<string | null>(null);

  // Keep ref in sync so destroy callback reads the latest value
  useEffect(() => {
    taskArnRef.current = taskArn;
  }, [taskArn]);

  // AppSync subscription: watch the DevContainerSession record for this session.
  // Replaces the setInterval polling pattern.
  useEffect(() => {
    if (!sessionId) return;

    const subscription = client.models.DevContainerSession.observeQuery({
      filter: { sessionId: { eq: sessionId } },
    }).subscribe({
      next: ({ items }) => {
        const session = items[0];
        if (!session) return;

        const nextState = mapSessionStatus(session.status);
        setState(nextState);

        if (session.containerUrl) {
          setContainerUrl(session.containerUrl);
        }
        if (session.taskArn && !taskArnRef.current) {
          setTaskArn(session.taskArn);
        }
        if (session.status === 'ERROR' && session.errorMessage) {
          setError(session.errorMessage);
        }
        // Clear sessionId to stop the subscription once we reach a terminal state.
        // The useEffect cleanup runs on sessionId change and unsubscribes.
        if (nextState === 'IDLE' || nextState === 'ERROR') {
          setSessionId(null);
        }
      },
      error: (err: unknown) => {
        console.error('[useDevContainerSession] Subscription error:', err);
      },
    });

    return () => subscription.unsubscribe();
  }, [sessionId]);

  const launch = useCallback(async () => {
    setState('LAUNCHING');
    setError(null);
    setContainerUrl(null);
    setTaskArn(null);
    setSessionId(null);

    const newSessionId = uuid();

    try {
      const { data: result, errors } = await client.mutations.launchDevContainer({
        sessionId: newSessionId,
      });

      if (errors) {
        throw new Error(errors[0].message);
      }

      const payload = result as {
        taskArn?: string;
        status?: string;
        success?: boolean;
        error?: string;
      };

      if (payload.success === false || !payload.taskArn) {
        throw new Error(payload.error ?? 'Launch returned no task ARN');
      }

      console.log('[useDevContainerSession] Container launched, task:', payload.taskArn);

      setTaskArn(payload.taskArn);
      setState('BOOTING');

      // Subscribe to real-time status updates via AppSync observeQuery
      setSessionId(newSessionId);
    } catch (err) {
      console.error('[useDevContainerSession] launch error:', err);
      setState('ERROR');
      setError(err instanceof Error ? err.message : 'Failed to launch container');
    }
  }, []);

  const destroy = useCallback(async () => {
    const arn = taskArnRef.current;
    if (!arn) return;

    setState('DESTROYING');
    setSessionId(null); // stop the subscription

    try {
      const { data: result, errors } = await client.mutations.destroyDevContainer({
        taskArn: arn,
      });

      if (errors) {
        throw new Error(errors[0].message);
      }

      const payload = result as { success?: boolean; error?: string };

      if (payload.success === false) {
        throw new Error(payload.error ?? 'Destroy failed');
      }

      console.log('[useDevContainerSession] Container destroyed');
    } catch (err) {
      console.error('[useDevContainerSession] destroy error:', err);
      // Non-fatal: treat as destroyed and reset to IDLE
    } finally {
      setState('IDLE');
      setTaskArn(null);
      setContainerUrl(null);
    }
  }, []);

  const reset = useCallback(() => {
    setSessionId(null);
    setState('IDLE');
    setTaskArn(null);
    setContainerUrl(null);
    setError(null);
  }, []);

  return {
    state,
    containerUrl,
    taskArn,
    error,
    launch,
    destroy,
    reset,
  };
}
