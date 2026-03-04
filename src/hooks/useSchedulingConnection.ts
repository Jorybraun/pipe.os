import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

/**
 * Connection status as stored in DynamoDB.
 * ACTIVE — tokens valid, webhook registered
 * EXPIRED — tokens need refresh (auto-refresh failed)
 * REVOKED — user disconnected or provider revoked access
 */
type ConnectionStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/** Provider types that support OAuth connections */
type ProviderId = 'CALENDLY' | 'CAL_COM';

/** Lightweight view of a SchedulingConnection for UI consumption */
export interface SchedulingConnectionInfo {
  id: string;
  providerId: ProviderId | null;
  status: ConnectionStatus | null;
  accountEmail: string | null;
  accountName: string | null;
  connectedAt: string;
  lastSyncAt: string | null;
}

/** Event type as returned by fetchEventTypes */
export interface ProviderEventType {
  id: string;
  name: string;
  duration: number;
  url: string;
}

/** Raw event type shape returned by the schedulingOAuth Lambda's fetchEventTypes action */
interface RawProviderEventType {
  id: string;
  name: string;
  durationMinutes?: number;
  url: string;
}

interface UseSchedulingConnectionResult {
  /** Current connection, or null if not connected */
  connection: SchedulingConnectionInfo | null;
  /** Whether the initial load is in progress */
  isLoading: boolean;
  /** Error from the last operation */
  error: Error | null;
  /** Exchange an OAuth code for a connection */
  exchangeOAuth: (
    providerId: ProviderId,
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ) => Promise<void>;
  /** Fetch event types for the current connection */
  fetchEventTypes: (connectionId: string) => Promise<ProviderEventType[]>;
  /** Disconnect the current connection */
  disconnect: (connectionId: string) => Promise<void>;
  /** Register or re-register the Calendly webhook for an existing connection */
  registerWebhook: (connectionId: string) => Promise<void>;
}

// Recruiter hook — uses Cognito user pool auth (default)
const client = generateClient<Schema>();

/**
 * useSchedulingConnection — manages the recruiter's OAuth connection
 * to a scheduling provider (Calendly or Cal.com).
 *
 * Provides real-time subscription to the SchedulingConnection model,
 * plus mutation wrappers for the exchangeSchedulingOAuth Lambda.
 *
 * @example
 * ```tsx
 * const { connection, exchangeOAuth, disconnect, isLoading } = useSchedulingConnection();
 *
 * if (connection?.status === 'ACTIVE') {
 *   return <ConnectionStatusBadge connection={connection} onDisconnect={() => disconnect(connection.id)} />;
 * }
 * ```
 */
export function useSchedulingConnection(): UseSchedulingConnectionResult {
  const [connection, setConnection] = useState<SchedulingConnectionInfo | null>(null);
  const [isLoading, setIsLoading]   = useState(true);
  const [error, setError]           = useState<Error | null>(null);

  // Subscribe to the recruiter's SchedulingConnection records.
  // A recruiter should have at most one ACTIVE connection.
  // Guard: model may not exist in amplify_outputs.json until sandbox is redeployed.
  useEffect(() => {
    if (!client.models.SchedulingConnection) {
      console.warn('[useSchedulingConnection] SchedulingConnection model not deployed yet — run `npx ampx sandbox`');
      setIsLoading(false);
      return;
    }

    const subscription = client.models.SchedulingConnection.observeQuery().subscribe({
      next: ({ items, isSynced }) => {
        // Pick the first ACTIVE connection, or the most recent one
        const active = items.find(
          (c) => c.status === 'ACTIVE',
        ) ?? items[0] ?? null;

        if (active) {
          setConnection({
            id:           active.id,
            providerId:   active.providerId as ProviderId | null,
            status:       active.status as ConnectionStatus | null,
            accountEmail: active.accountEmail ?? null,
            accountName:  active.accountName ?? null,
            connectedAt:  active.connectedAt,
            lastSyncAt:   active.lastSyncAt ?? null,
          });
        } else {
          setConnection(null);
        }

        if (isSynced) setIsLoading(false);
      },
      error: (err: unknown) => {
        console.error('[useSchedulingConnection] Subscription error:', err);
        setError(err instanceof Error ? err : new Error('Subscription failed'));
        setIsLoading(false);
      },
    });

    return () => subscription.unsubscribe();
  }, []);

  /**
   * Exchange an OAuth authorization code for tokens.
   * Creates a SchedulingConnection and registers a webhook.
   */
  const exchangeOAuth = useCallback(async (
    providerId: ProviderId,
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<void> => {
    setError(null);

    try {
      const { data, errors } = await client.mutations.exchangeSchedulingOAuth({
        action: 'exchange',
        params: JSON.stringify({ providerId, code, redirectUri, codeVerifier }),
      });

      if (errors) {
        console.error('[useSchedulingConnection] exchangeOAuth errors:', errors);
        throw new Error(errors[0].message);
      }

      // Parse the Lambda response to get the connection data
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      console.log('[useSchedulingConnection] exchangeOAuth result:', result);
      if (!result?.success) {
        throw new Error(result?.message ?? result?.error ?? 'OAuth exchange failed');
      }

      // Set connection state directly from Lambda response.
      // observeQuery subscriptions don't fire for records created server-side
      // via IAM auth — the userPool subscription never receives the event.
      const d = result.data as Record<string, unknown> | undefined;
      if (d?.connectionId) {
        setConnection({
          id:           d.connectionId as string,
          providerId:   (d.providerId as ProviderId) ?? providerId,
          status:       (d.status as ConnectionStatus) ?? 'ACTIVE',
          accountEmail: (d.accountEmail as string) ?? null,
          accountName:  (d.accountName as string) ?? null,
          connectedAt:  new Date().toISOString(),
          lastSyncAt:   null,
        });
      }
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Exchange failed');
      console.error('[useSchedulingConnection] exchangeOAuth failed:', wrapped);
      setError(wrapped);
      throw wrapped;
    }
  }, []);

  /**
   * Fetch available event types for the connected provider.
   * Used by EventTypePicker to let the recruiter choose a booking page.
   */
  const fetchEventTypes = useCallback(async (
    connectionId: string,
  ): Promise<ProviderEventType[]> => {
    setError(null);

    try {
      const { data, errors } = await client.mutations.exchangeSchedulingOAuth({
        action: 'fetchEventTypes',
        params: JSON.stringify({ connectionId }),
      });

      if (errors) {
        console.error('[useSchedulingConnection] fetchEventTypes errors:', errors);
        throw new Error(errors[0].message);
      }

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      if (!result?.success) {
        throw new Error(result?.error ?? 'Failed to fetch event types');
      }

      // Lambda returns data: RawProviderEventType[] with durationMinutes — normalize to duration
      const raw = (result.data ?? []) as RawProviderEventType[];
      return raw.map((et) => ({
        id: et.id,
        name: et.name,
        duration: et.durationMinutes ?? 0,
        url: et.url,
      }));
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Fetch event types failed');
      console.error('[useSchedulingConnection] fetchEventTypes failed:', wrapped);
      setError(wrapped);
      throw wrapped;
    }
  }, []);

  /**
   * Disconnect the scheduling provider.
   * Deletes the webhook and marks the connection as REVOKED.
   */
  const disconnect = useCallback(async (connectionId: string): Promise<void> => {
    setError(null);

    try {
      const { data, errors } = await client.mutations.exchangeSchedulingOAuth({
        action: 'disconnect',
        params: JSON.stringify({ connectionId }),
      });

      if (errors) {
        console.error('[useSchedulingConnection] disconnect errors:', errors);
        throw new Error(errors[0].message);
      }

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      if (!result?.success) {
        throw new Error(result?.error ?? 'Disconnect failed');
      }

      // Clear connection state directly — same IAM auth issue as exchange
      setConnection(null);
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Disconnect failed');
      console.error('[useSchedulingConnection] disconnect failed:', wrapped);
      setError(wrapped);
      throw wrapped;
    }
  }, []);

  /**
   * Register or re-register the webhook subscription with the provider.
   * Use after deploying a new Function URL or to fix a missed initial registration.
   */
  const registerWebhook = useCallback(async (connectionId: string): Promise<void> => {
    setError(null);

    try {
      const { data, errors } = await client.mutations.exchangeSchedulingOAuth({
        action: 'registerWebhook',
        params: JSON.stringify({ connectionId }),
      });

      if (errors) {
        console.error('[useSchedulingConnection] registerWebhook errors:', errors);
        throw new Error(errors[0].message);
      }

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      if (!result?.success) {
        throw new Error(result?.message ?? 'Webhook registration failed');
      }

      console.log('[useSchedulingConnection] Webhook registered successfully', result.data);
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Webhook registration failed');
      console.error('[useSchedulingConnection] registerWebhook failed:', wrapped);
      setError(wrapped);
      throw wrapped;
    }
  }, []);

  return {
    connection,
    isLoading,
    error,
    exchangeOAuth,
    fetchEventTypes,
    disconnect,
    registerWebhook,
  };
}
