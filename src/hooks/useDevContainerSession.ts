/**
 * useDevContainerSession Hook
 *
 * Manages the full lifecycle of a dev container session:
 *   IDLE → LAUNCHING → BOOTING → READY → DESTROYING → IDLE
 *
 * Two backends coexist during the Phase 3b migration:
 *   - Legacy (default): AWS Fargate via AppSync (`useDevContainerSessionAppSync`)
 *   - Cloudflare (ADR-037): Durable Object via REST (`useDevContainerSessionCloudflare`)
 *
 * Switching is controlled by `VITE_USE_CLOUDFLARE_DEV_CONTAINERS`. The
 * hook's public shape is a strict non-breaking superset — the Cloudflare
 * path additionally populates `expiresAt` and `expiringSoon` (derived from
 * `warned_at`). Legacy callers who ignore those fields continue to work.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useData } from '../providers';
import type {
  DataProviderFactory,
  DataProvider,
  MutationOperation,
  QueryOperation,
} from '../providers';
import { v4 as uuid } from 'uuid';
import { useSessionToken } from '../contexts/SessionTokenContext';
import {
  launchDevContainer,
  getDevContainerStatus,
  destroyDevContainer,
  getExchangeToken,
  buildProxyIframeUrl,
  DevContainerApiError,
} from '../lib/devContainerClient';

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
 * How often (ms) to poll container status. On the legacy AppSync path this
 * is a fallback alongside the subscription; on the Cloudflare path it is
 * the sole status source.
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
   * Per-session code-server password — available from BOOTING onward on
   * the legacy path. Held in React component memory only; never written
   * to localStorage, sessionStorage, or logs. Cleared on destroy() and
   * reset(). Do NOT include this value in error messages or console.log.
   * Always `null` on the Cloudflare path (code-server runs `--auth none`
   * inside the container; the Worker enforces auth via candidate JWT).
   */
  accessToken: string | null;
  /**
   * Stable session identifier across both backends.
   *   - Legacy: ECS task ARN
   *   - Cloudflare: Worker sessionId (UUID)
   */
  taskArn: string | null;
  /** Human-readable error message when state = 'ERROR' */
  error: string | null;
  /**
   * ISO timestamp when the session's TTL will destroy the container.
   * Populated on the Cloudflare path only (legacy is null).
   */
  expiresAt: string | null;
  /**
   * True once the warn alarm has fired (i.e. the session has ≤
   * WARN_BEFORE_SECONDS left). Populated on the Cloudflare path only.
   */
  expiringSoon: boolean;
  /** Spin up a new container. Optional `challengeId` scopes TTL + repo metadata. */
  launch: (opts?: { challengeId?: string | null }) => Promise<void>;
  /** Tear down the running container */
  destroy: () => Promise<void>;
  /** Reset to IDLE after an error */
  reset: () => void;
}

export function shouldUseCloudflareDevContainers(
  flag: string | undefined = import.meta.env.VITE_USE_CLOUDFLARE_DEV_CONTAINERS,
  hostname: string | undefined = typeof window !== 'undefined' ? window.location.hostname : undefined,
): boolean {
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return hostname === 'app-dev.hire-pipe.com' || hostname === 'app.hire-pipe.com';
}

const USE_CLOUDFLARE = shouldUseCloudflareDevContainers();

// Select exactly one backend for this bundle/session. Calling both hooks would
// still initialize the inactive backend and can crash deployed Cloudflare flows
// when the legacy AppSync provider is not configured.
export const useDevContainerSession: () => UseDevContainerSessionReturn = USE_CLOUDFLARE
  ? useDevContainerSessionCloudflare
  : useDevContainerSessionAppSync;

// ─── Cloudflare implementation (ADR-037) ────────────────────────────────────

function useDevContainerSessionCloudflare(): UseDevContainerSessionReturn {
  const sessionToken = useSessionToken();

  const [state, setState] = useState<ContainerSessionState>('IDLE');
  const [containerUrl, setContainerUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const sessionTokenRef = useRef<string | null>(sessionToken);
  const exchangeTokenFetchedRef = useRef(false);
  useEffect(() => {
    sessionTokenRef.current = sessionToken;
  }, [sessionToken]);

  // Poll while a non-terminal session is live. Covers LAUNCHING → READY
  // and surfaces warned_at → expiringSoon flips without any subscription
  // plumbing. A single setInterval keyed on sessionId avoids tearing
  // multiple timers during React strict-mode double-mount.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await getDevContainerStatus(sessionId, sessionTokenRef.current);
        if (cancelled) return;

        setExpiresAt(res.expiresAt);
        setExpiringSoon(res.expiringSoon);

        if (res.status === 'READY' || res.status === 'SLEEPING') {
          // Only fetch exchange token once per session — the ref survives
          // across poll cycles without triggering effect re-runs.
          if (!exchangeTokenFetchedRef.current) {
            exchangeTokenFetchedRef.current = true;
            try {
              const { exchangeToken } = await getExchangeToken(sessionId, sessionTokenRef.current);
              setContainerUrl(buildProxyIframeUrl(sessionId, exchangeToken));
            } catch (err) {
              console.error('[useDevContainerSession:cf] exchange token failed:', err);
              exchangeTokenFetchedRef.current = false; // allow retry
              setState('ERROR');
              setError('Failed to get iframe access token');
              return;
            }
          }
          setState('READY');
        } else if (res.status === 'LAUNCHING') {
          setState((prev) => (prev === 'IDLE' || prev === 'LAUNCHING' ? 'BOOTING' : prev));
        } else if (res.status === 'STOPPED') {
          setState('IDLE');
          setSessionId(null);
          sessionIdRef.current = null;
          exchangeTokenFetchedRef.current = false;
          setContainerUrl(null);
          setExpiresAt(null);
          setExpiringSoon(false);
        } else if (res.status === 'EXPIRED') {
          setState('IDLE');
          setSessionId(null);
          sessionIdRef.current = null;
          exchangeTokenFetchedRef.current = false;
          setContainerUrl(null);
          setError('Session expired.');
        } else if (res.status === 'ERROR') {
          setState('ERROR');
          setError(res.errorMessage ?? 'Container entered an error state.');
        }
      } catch (err) {
        if (cancelled) return;
        // A 404 after destroy is expected — treat as IDLE, not ERROR.
        if (err instanceof DevContainerApiError && err.status === 404) {
          setState('IDLE');
          setSessionId(null);
          sessionIdRef.current = null;
          exchangeTokenFetchedRef.current = false;
          setContainerUrl(null);
          return;
        }
        console.error('[useDevContainerSession:cf] status poll failed:', err);
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId]);

  const launch = useCallback(async (opts?: { challengeId?: string | null }) => {
    setState('LAUNCHING');
    setError(null);
    setContainerUrl(null);
    exchangeTokenFetchedRef.current = false;
    setExpiresAt(null);
    setExpiringSoon(false);

    try {
      const res = await launchDevContainer(
        { challengeId: opts?.challengeId ?? null },
        sessionTokenRef.current,
      );
      setSessionId(res.sessionId);
      sessionIdRef.current = res.sessionId;
      setExpiresAt(res.expiresAt);
      setState('BOOTING');
    } catch (err) {
      console.error('[useDevContainerSession:cf] launch failed:', err);
      setState('ERROR');
      setError(err instanceof Error ? err.message : 'Failed to launch container');
    }
  }, []);

  const destroy = useCallback(async () => {
    const current = sessionIdRef.current;
    if (!current) return;

    setState('DESTROYING');

    try {
      await destroyDevContainer(current, sessionTokenRef.current);
    } catch (err) {
      // Idempotent — already-terminal sessions are fine.
      if (!(err instanceof DevContainerApiError && err.status === 404)) {
        console.error('[useDevContainerSession:cf] destroy failed:', err);
      }
    } finally {
      setState('IDLE');
      setSessionId(null);
      sessionIdRef.current = null;
      exchangeTokenFetchedRef.current = false;
      setContainerUrl(null);
      setExpiresAt(null);
      setExpiringSoon(false);
    }
  }, []);

  const reset = useCallback(() => {
    setState('IDLE');
    setSessionId(null);
    sessionIdRef.current = null;
    exchangeTokenFetchedRef.current = false;
    setContainerUrl(null);
    setExpiresAt(null);
    setExpiringSoon(false);
    setError(null);
  }, []);

  return {
    state,
    containerUrl,
    accessToken: null,
    taskArn: sessionId,
    error,
    expiresAt,
    expiringSoon,
    launch,
    destroy,
    reset,
  };
}

// ─── Legacy AppSync implementation (AWS Fargate, pre-ADR-037) ───────────────

function useDevContainerSessionAppSync(): UseDevContainerSessionReturn {
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

  const launch = useCallback(async (_opts?: { challengeId?: string | null }) => {
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
    expiresAt: null,
    expiringSoon: false,
    launch,
    destroy,
    reset,
  };
}
