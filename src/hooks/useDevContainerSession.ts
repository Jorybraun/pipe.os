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
import { useData } from '../providers';
import type { DataProviderFactory, DataProvider, MutationOperation, QueryOperation } from '../providers';
import { v4 as uuid } from 'uuid';

function mut<TArgs, TResult>(
  client: DataProvider,
  name: string,
): MutationOperation<TArgs, TResult> {
  const fn = (client.mutations as Record<string, MutationOperation<TArgs, TResult>>)[name];
  if (!fn) throw new Error(`Mutation '${name}' not available`);
  return fn;
}

function qry<TArgs, TResult>(
  client: DataProvider,
  name: string,
): QueryOperation<TArgs, TResult> {
  const fn = (client.queries as Record<string, QueryOperation<TArgs, TResult>>)[name];
  if (!fn) throw new Error(`Query '${name}' not available`);
  return fn;
}

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
  accessToken?: string;
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
  const out: StatusPayload = {};
  if (typeof parsed['status'] === 'string') out.status = parsed['status'];
  if (typeof parsed['containerUrl'] === 'string') out.containerUrl = parsed['containerUrl'];
  if (typeof parsed['success'] === 'boolean') out.success = parsed['success'];
  if (typeof parsed['error'] === 'string') out.error = parsed['error'];
  return out;
}

function parseLaunchPayload(result: unknown): LaunchPayload {
  const parsed = coerceJson(result);
  if (!isRecord(parsed)) return {};
  const out: LaunchPayload = {};
  if (typeof parsed['taskArn'] === 'string') out.taskArn = parsed['taskArn'];
  if (typeof parsed['status'] === 'string') out.status = parsed['status'];
  if (typeof parsed['accessToken'] === 'string') out.accessToken = parsed['accessToken'];
  if (typeof parsed['success'] === 'boolean') out.success = parsed['success'];
  if (typeof parsed['error'] === 'string') out.error = parsed['error'];
  return out;
}

function parseDestroyPayload(result: unknown): DestroyPayload {
  const parsed = coerceJson(result);
  if (!isRecord(parsed)) return {};
  const out: DestroyPayload = {};
  if (typeof parsed['success'] === 'boolean') out.success = parsed['success'];
  if (typeof parsed['error'] === 'string') out.error = parsed['error'];
  return out;
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
  /**
   * Per-session code-server password — available from BOOTING onward.
   * Held in React component memory only; never written to localStorage,
   * sessionStorage, or logs. Cleared on destroy() and reset().
   * Do NOT include this value in error messages or console.log calls.
   */
  accessToken: string | null;
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
  const factory: DataProviderFactory = useData();

  const [state, setState] = useState<ContainerSessionState>('IDLE');
  const [containerUrl, setContainerUrl] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
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
        const client = factory.createClient();
        const { data: result } = await qry<{ taskArn: string }, unknown>(client, 'getContainerStatus')({
          taskArn: arn,
        });
        if (unsubscribed || !result) return;
        const payload = parseStatusPayload(result);

        console.log('[useDevContainerSession] Poll result:', payload.status, 'URL:', payload.containerUrl);

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

    // Subscribe to model updates for this specific task via observeQuery
    // filtered by taskArn (provider-agnostic equivalent of onUpdate).
    const client = factory.createClient();
    const sub = client.models.DevContainerSession
      .observeQuery({
        filter: {
          taskArn: { eq: taskArn },
        },
      })
      .subscribe({
        next: ({ items }) => {
          if (unsubscribed) return;
          const record = (items as Array<Record<string, unknown>>)[0];
          if (!record) return;

          console.log('[useDevContainerSession] Subscription update:', record['status'], 'URL:', record['url']);

          if (record['status'] === 'READY' && record['url']) {
            setState('READY');
            setContainerUrl(record['url'] as string);
          } else if (record['status'] === 'ERROR') {
            setState('ERROR');
            setError('Container failed to start');
          } else if (record['status'] === 'STOPPING') {
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
  }, [state, taskArn, factory]);

  // ─── launch ────────────────────────────────────────────────────────────────

  const launch = useCallback(async () => {
    setState('LAUNCHING');
    setError(null);
    setContainerUrl(null);
    setAccessToken(null);

    const newSessionId = uuid();
    sessionIdRef.current = newSessionId;

    try {
      const client = factory.createClient();
      const { data: result, errors } = await mut<{ sessionId: string }, unknown>(client, 'launchDevContainer')({
        sessionId: newSessionId,
      });

      if (errors) throw new Error(errors[0]?.message ?? 'Launch failed');
      const payload = parseLaunchPayload(result);

      if (payload.success === false || !payload.taskArn) {
        throw new Error(payload.error ?? 'Launch returned no task ARN');
      }

      console.log('[useDevContainerSession] Container launched, task:', payload.taskArn);

      setTaskArn(payload.taskArn);
      taskArnRef.current = payload.taskArn;
      if (payload.accessToken) setAccessToken(payload.accessToken);
      setState('BOOTING');
    } catch (err) {
      console.error('[useDevContainerSession] launch error:', err);
      setState('ERROR');
      setError(err instanceof Error ? err.message : 'Failed to launch container');
    }
  }, [factory]);

  // ─── destroy ───────────────────────────────────────────────────────────────

  const destroy = useCallback(async () => {
    const arn = taskArnRef.current;
    if (!arn) return;

    setState('DESTROYING');

    try {
      const client = factory.createClient();
      const { data: result, errors } = await mut<{ taskArn: string }, unknown>(client, 'destroyDevContainer')({
        taskArn: arn,
      });

      if (errors) throw new Error(errors[0]?.message ?? 'Destroy failed');
      const payload = parseDestroyPayload(result);

      if (payload.success === false) throw new Error(payload.error ?? 'Destroy failed');

      console.log('[useDevContainerSession] Container destroyed');
    } catch (err) {
      console.error('[useDevContainerSession] destroy error:', err);
    } finally {
      setState('IDLE');
      setTaskArn(null);
      setContainerUrl(null);
      setAccessToken(null);
      sessionIdRef.current = null;
    }
  }, [factory]);

  // ─── reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setState('IDLE');
    setTaskArn(null);
    setContainerUrl(null);
    setAccessToken(null);
    sessionIdRef.current = null;
    setError(null);
  }, []);

  return {
    state,
    containerUrl,
    accessToken,
    taskArn,
    error,
    launch,
    destroy,
    reset,
  };
}
