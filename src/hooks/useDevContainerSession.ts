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

/** Unwraps AWSJSON scalars — Amplify Gen 2 returns .returns(a.json()) values as JSON strings */
function coerceJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function parseStatusPayload(result: unknown): StatusPayload {
  const parsed = coerceJson(result);
  if (!isRecord(parsed)) return {};
  return {
    status: typeof parsed['status'] === 'string' ? parsed['status'] : undefined,
    containerUrl: typeof parsed['containerUrl'] === 'string' ? parsed['containerUrl'] : undefined,
    success: typeof parsed['success'] === 'boolean' ? parsed['success'] : undefined,
    error: typeof parsed['error'] === 'string' ? parsed['error'] : undefined,
  };
}

function parseLaunchPayload(result: unknown): LaunchPayload {
  const parsed = coerceJson(result);
  if (!isRecord(parsed)) return {};
  return {
    taskArn: typeof parsed['taskArn'] === 'string' ? parsed['taskArn'] : undefined,
    status: typeof parsed['status'] === 'string' ? parsed['status'] : undefined,
    success: typeof parsed['success'] === 'boolean' ? parsed['success'] : undefined,
    error: typeof parsed['error'] === 'string' ? parsed['error'] : undefined,
  };
}

function parseDestroyPayload(result: unknown): DestroyPayload {
  const parsed = coerceJson(result);
  if (!isRecord(parsed)) return {};
  return {
    success: typeof parsed['success'] === 'boolean' ? parsed['success'] : undefined,
    error: typeof parsed['error'] === 'string' ? parsed['error'] : undefined,
  };
}

/**
 * How often (ms) to poll ECS status as a fallback while waiting for
 * the AppSync subscription to deliver a READY event. The subscription is
 * set up first (fast path), but we poll every few seconds to catch cases
 * where the container reached READY before the subscription was active
 * (e.g. after a page refresh) since AppSync does not replay past events.
 */
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

  // Keep mutable refs for use inside async callbacks / subscription handlers
  const taskArnRef = useRef<string | null>(null);
  // sessionId doesn't drive renders — track it as a ref
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    taskArnRef.current = taskArn;
  }, [taskArn]);

  // ─── Subscription with polling fallback ───────────────────────────────────

  useEffect(() => {
    if (state !== 'BOOTING' || !taskArn) return;

    let unsubscribed = false;

    /**
     * Polls the container status via Lambda (ECS DescribeTasks). Called
     * immediately on mount (in case READY was written before we subscribed)
     * and then every POLL_INTERVAL_MS until the container is no longer BOOTING.
     */
    const checkStatus = async () => {
      if (unsubscribed) return;
      const arn = taskArnRef.current;
      if (!arn) return;

      try {
        const { data: result } = await client.queries.getContainerStatus({
          taskArn: arn,
        });
        if (unsubscribed || !result) return;
        const payload = parseStatusPayload(result);

        console.log('[useDevContainerSession] Poll result:', payload.status);

        if (payload.status === 'READY') {
          setState('READY');
          setContainerUrl(payload.containerUrl ?? null);
        } else if (payload.status === 'STOPPED' || payload.status === 'ERROR') {
          setState('ERROR');
          setError('Container stopped unexpectedly');
        }
      } catch (err) {
        console.error('[useDevContainerSession] Poll failed:', err);
      }
    };

    // Subscribe to model updates for this specific task (fast path —
    // avoids polling delay when AppSync subscription delivers the event).
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

          console.log('[useDevContainerSession] Subscription update:', update.status);

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
            '[useDevContainerSession] Subscription error, falling back to polling:',
            err
          );
        },
      });

    // Immediate check — catches the case where the container already reached
    // READY before this subscription was established (e.g. page refresh).
    void checkStatus();

    // Periodic polling — reliable fallback in case the subscription misses
    // an event (multi-auth AppSync delivery, missed events, reconnect, etc.)
    const poll = setInterval(() => { void checkStatus(); }, POLL_INTERVAL_MS);

    return () => {
      unsubscribed = true;
      sub.unsubscribe();
      clearInterval(poll);
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
