/**
 * useDevContainerSession Hook
 *
 * Manages the full lifecycle of a Fargate dev container session:
 *   IDLE → LAUNCHING → BOOTING → READY → DESTROYING → IDLE
 *
 * Usage:
 *   const { state, containerUrl, launch, destroy } = useDevContainerSession();
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import { v4 as uuid } from 'uuid';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

/** How often to poll ECS while the container is booting (ms) */
const POLL_INTERVAL_MS = 5_000;

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

export function useDevContainerSession(): UseDevContainerSessionReturn {
  const [state, setState] = useState<ContainerSessionState>('IDLE');
  const [containerUrl, setContainerUrl] = useState<string | null>(null);
  const [taskArn, setTaskArn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Holds the interval reference so we can clear it on unmount / destroy
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taskArnRef = useRef<string | null>(null);

  // Keep the ref in sync so the poll callback can read the latest value
  useEffect(() => {
    taskArnRef.current = taskArn;
  }, [taskArn]);

  // Clear the poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  /**
   * Polls ECS task status until the container is READY (or an error occurs).
   */
  const startPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }

    pollRef.current = setInterval(async () => {
      const arn = taskArnRef.current;
      if (!arn) return;

      try {
        const { data: result, errors } = await client.queries.getContainerStatus({
          taskArn: arn,
        });

        if (errors) {
          console.error('[useDevContainerSession] getContainerStatus error:', errors);
          return;
        }

        if (!result) return;

        // The Lambda returns JSON; Amplify deserializes it as `unknown`
        const payload = result as {
          status?: string;
          containerUrl?: string;
          success?: boolean;
          error?: string;
        };

        if (payload.success === false) {
          console.error('[useDevContainerSession] Status error:', payload.error);
          if (pollRef.current) clearInterval(pollRef.current);
          setState('ERROR');
          setError(payload.error ?? 'Failed to check container status');
          return;
        }

        console.log('[useDevContainerSession] Container status:', payload.status);

        if (payload.status === 'READY') {
          if (pollRef.current) clearInterval(pollRef.current);
          setState('READY');
          setContainerUrl(payload.containerUrl ?? null);
        } else if (payload.status === 'STOPPED' || payload.status === 'STOPPING') {
          if (pollRef.current) clearInterval(pollRef.current);
          setState('IDLE');
          setTaskArn(null);
          setContainerUrl(null);
        }
      } catch (err) {
        console.error('[useDevContainerSession] Poll error:', err);
      }
    }, POLL_INTERVAL_MS);
  }, []);

  const launch = useCallback(async () => {
    setState('LAUNCHING');
    setError(null);
    setContainerUrl(null);

    const sessionId = uuid();

    try {
      const { data: result, errors } = await client.mutations.launchDevContainer({
        sessionId,
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
      startPolling();
    } catch (err) {
      console.error('[useDevContainerSession] launch error:', err);
      setState('ERROR');
      setError(err instanceof Error ? err.message : 'Failed to launch container');
    }
  }, [startPolling]);

  const destroy = useCallback(async () => {
    const arn = taskArnRef.current;
    if (!arn) return;

    if (pollRef.current) {
      clearInterval(pollRef.current);
    }

    setState('DESTROYING');

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
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }
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
