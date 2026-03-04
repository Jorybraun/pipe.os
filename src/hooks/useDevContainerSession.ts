/**
 * useDevContainerSession Hook
 *
 * Manages the full lifecycle of a Fargate dev container session:
 *   IDLE → LAUNCHING → BOOTING → READY → DESTROYING → IDLE
 *
 * Status updates during BOOTING are received via an AppSync subscription
 * on the DevContainerSession model, which is updated by the ecsStatusBridge Lambda.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import { v4 as uuid } from 'uuid';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

// ─── Lambda response type guards ─────────────────────────────────────────────

interface StatusPayload {
  status?: string;
  containerUrl?: string;
  success?: boolean;
  error?: string;
}

interface LaunchPayload {
  taskArn?: string;
  status?: string;
  success?: boolean;
  error?: string;
}

interface DestroyPayload {
  success?: boolean;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStatusPayload(result: unknown): StatusPayload {
  if (!isRecord(result)) return {};
  return {
    status: typeof result['status'] === 'string' ? result['status'] : undefined,
    containerUrl: typeof result['containerUrl'] === 'string' ? result['containerUrl'] : undefined,
    success: typeof result['success'] === 'boolean' ? result['success'] : undefined,
    error: typeof result['error'] === 'string' ? result['error'] : undefined,
  };
}

function parseLaunchPayload(result: unknown): LaunchPayload {
  if (!isRecord(result)) return {};
  return {
    taskArn: typeof result['taskArn'] === 'string' ? result['taskArn'] : undefined,
    status: typeof result['status'] === 'string' ? result['status'] : undefined,
    success: typeof result['success'] === 'boolean' ? result['success'] : undefined,
    error: typeof result['error'] === 'string' ? result['error'] : undefined,
  };
}

function parseDestroyPayload(result: unknown): DestroyPayload {
  if (!isRecord(result)) return {};
  return {
    success: typeof result['success'] === 'boolean' ? result['success'] : undefined,
    error: typeof result['error'] === 'string' ? result['error'] : undefined,
  };
}

/**
 * How long (ms) to wait for a subscription event before falling back to a
 * single getContainerStatus query.
 */
const SUBSCRIPTION_TIMEOUT_MS = 120_000;

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

  // Keep mutable refs for use inside async callbacks / subscription handlers
  const taskArnRef = useRef<string | null>(null);
  // sessionId doesn't drive renders — track it as a ref
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    taskArnRef.current = taskArn;
  }, [taskArn]);

  // ─── Subscription with fallback ────────────────────────────────────────────

  useEffect(() => {
    if (state !== 'BOOTING' || !taskArn) return;

    let unsubscribed = false;

    // Subscribe to model updates for this specific task
    const sub = client.models.DevContainerSession
      .onUpdate({
        filter: {
          taskArn: { eq: taskArn }
        }
      })
      .subscribe({
        next: (update) => {
          if (unsubscribed) return;
          if (!update) return;

          console.log('[useDevContainerSession] Model update:', update.status);

          if (update.status === 'READY' && update.url) {
            setState('READY');
            setContainerUrl(update.url);
          } else if (update.status === 'ERROR') {
            setState('ERROR');
            setError('Container failed to start');
          } else if (update.status === 'STOPPING') {
            setState('IDLE');
            setTaskArn(null);
            setContainerUrl(null);
          }
        },
        error: (err: unknown) => {
          console.error(
            '[useDevContainerSession] Subscription error, will rely on safety timeout:',
            err
          );
        },
      });

    // Safety timeout fallback
    const timeout = setTimeout(async () => {
      if (unsubscribed) return;
      const arn = taskArnRef.current;
      if (!arn) return;

      try {
        const { data: result } = await client.queries.getContainerStatus({
          taskArn: arn,
        });
        if (!result) return;
        const payload = parseStatusPayload(result);
        if (payload.status === 'READY') {
          setState('READY');
          setContainerUrl(payload.containerUrl ?? null);
        }
      } catch (err) {
        console.error('[useDevContainerSession] Fallback check failed:', err);
      }
    }, SUBSCRIPTION_TIMEOUT_MS);

    return () => {
      unsubscribed = true;
      sub.unsubscribe();
      clearTimeout(timeout);
    };
  }, [state, taskArn]);

  // ─── launch ────────────────────────────────────────────────────────────────

  const launch = useCallback(async () => {
    setState('LAUNCHING');
    setError(null);
    setContainerUrl(null);

    const newSessionId = uuid();
    sessionIdRef.current = newSessionId;

    try {
      const { data: result, errors } = await client.mutations.launchDevContainer({
        sessionId: newSessionId,
      });

      if (errors) throw new Error(errors[0].message);
      const payload = parseLaunchPayload(result);

      if (payload.success === false || !payload.taskArn) {
        throw new Error(payload.error ?? 'Launch returned no task ARN');
      }

      console.log('[useDevContainerSession] Container launched, task:', payload.taskArn);

      setTaskArn(payload.taskArn);
      taskArnRef.current = payload.taskArn;
      setState('BOOTING');
    } catch (err) {
      console.error('[useDevContainerSession] launch error:', err);
      setState('ERROR');
      setError(err instanceof Error ? err.message : 'Failed to launch container');
    }
  }, []);

  // ─── destroy ───────────────────────────────────────────────────────────────

  const destroy = useCallback(async () => {
    const arn = taskArnRef.current;
    if (!arn) return;

    setState('DESTROYING');

    try {
      const { data: result, errors } = await client.mutations.destroyDevContainer({
        taskArn: arn,
      });

      if (errors) throw new Error(errors[0].message);
      const payload = parseDestroyPayload(result);

      if (payload.success === false) throw new Error(payload.error ?? 'Destroy failed');

      console.log('[useDevContainerSession] Container destroyed');
    } catch (err) {
      console.error('[useDevContainerSession] destroy error:', err);
    } finally {
      setState('IDLE');
      setTaskArn(null);
      setContainerUrl(null);
      sessionIdRef.current = null;
    }
  }, []);

  // ─── reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setState('IDLE');
    setTaskArn(null);
    setContainerUrl(null);
    sessionIdRef.current = null;
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
