import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from './useApiClient';
import type { ApiClient } from '../lib/api/client';

/**
 * Connection status as stored in D1.
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
  eventTypes?: ProviderEventType[];
}

/** Event type as returned by the Worker API */
export interface ProviderEventType {
  id: string;
  name: string;
  duration: number;
  url: string;
  schedulingUrl: string;
}

interface UseSchedulingConnectionResult {
  connection: SchedulingConnectionInfo | null;
  isLoading: boolean;
  error: Error | null;
  exchangeOAuth: (
    providerId: ProviderId,
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ) => Promise<void>;
  fetchEventTypes: (connectionId: string) => Promise<ProviderEventType[]>;
  disconnect: (connectionId: string) => Promise<void>;
  getAuthUrl: (providerId: ProviderId, redirectUri: string, codeChallenge?: string) => Promise<string>;
  refetch: () => Promise<void>;
}

interface ApiProviderEventType {
  id: string;
  name: string;
  duration?: number;
  durationMinutes?: number;
  url: string;
  schedulingUrl: string;
}

function normalizeProviderEventType(eventType: ApiProviderEventType): ProviderEventType {
  return {
    id: eventType.id,
    name: eventType.name,
    duration: eventType.duration ?? eventType.durationMinutes ?? 30,
    url: eventType.url,
    schedulingUrl: eventType.schedulingUrl,
  };
}

/**
 * Helper function to fetch event types for a connection
 */
async function fetchEventTypesForConnection(api: ApiClient, connectionId: string): Promise<ProviderEventType[]> {
  try {
    const result = await api.get<{ eventTypes: ApiProviderEventType[] }>(`/api/v1/scheduling/connection/${connectionId}/event-types`);
    return (result.eventTypes || []).map(normalizeProviderEventType);
  } catch (err) {
    console.error('[fetchEventTypesForConnection] Failed:', err);
    return [];
  }
}

/**
 * useSchedulingConnection — manages the recruiter's OAuth connection
 * to a scheduling provider (Calendly or Cal.com).
 *
 * Now backed by Cloudflare Worker API instead of Amplify/AppSync.
 */
export function useSchedulingConnection(): UseSchedulingConnectionResult {
  const api: ApiClient = useApiClient();

  const [connection, setConnection] = useState<SchedulingConnectionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchConnection = useCallback(async () => {
    try {
      const result = await api.get<{
        connection: {
          id: string;
          providerId: ProviderId;
          accountEmail: string | null;
          accountName: string | null;
          status: ConnectionStatus;
          connectedAt: string;
          lastSyncAt: string | null;
        } | null;
      }>('/api/v1/scheduling/connection');

      if (result.connection) {
        // Fetch event types for the connection
        let eventTypes: ProviderEventType[] = [];
        try {
          eventTypes = await fetchEventTypesForConnection(api, result.connection.id);
        } catch (err) {
          console.error('[useSchedulingConnection] Failed to fetch event types:', err);
        }

        setConnection({
          id: result.connection.id,
          providerId: result.connection.providerId,
          status: result.connection.status,
          accountEmail: result.connection.accountEmail,
          accountName: result.connection.accountName,
          connectedAt: result.connection.connectedAt,
          lastSyncAt: result.connection.lastSyncAt,
          eventTypes,
        });
      } else {
        setConnection(null);
      }
    } catch (err) {
      console.error('[useSchedulingConnection] fetch error:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch connection'));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void fetchConnection();
  }, [fetchConnection]);

  const getAuthUrl = useCallback(async (
    providerId: ProviderId,
    redirectUri: string,
    codeChallenge?: string,
  ): Promise<string> => {
    setError(null);
    try {
      const result = await api.post<{ authUrl: string }>(
        '/api/v1/scheduling/connect',
        { providerId, redirectUri, codeChallenge },
      );
      return result.authUrl;
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Failed to get auth URL');
      setError(wrapped);
      throw wrapped;
    }
  }, [api]);

  const exchangeOAuth = useCallback(async (
    providerId: ProviderId,
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<void> => {
    setError(null);
    try {
      const result = await api.post<{
        connection: {
          id: string;
          providerId: ProviderId;
          accountEmail: string;
          accountName: string;
          status: ConnectionStatus;
          webhookRegistered: boolean;
        };
      }>('/api/v1/scheduling/callback', {
        providerId,
        code,
        redirectUri,
        codeVerifier,
      });

      const eventTypes = await fetchEventTypesForConnection(api, result.connection.id);
      setConnection({
        id: result.connection.id,
        providerId: result.connection.providerId,
        status: result.connection.status as ConnectionStatus,
        accountEmail: result.connection.accountEmail,
        accountName: result.connection.accountName,
        connectedAt: new Date().toISOString(),
        lastSyncAt: null,
        eventTypes,
      });
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Exchange failed');
      console.error('[useSchedulingConnection] exchangeOAuth failed:', wrapped);
      setError(wrapped);
      throw wrapped;
    }
  }, [api]);

  const fetchEventTypes = useCallback(async (
    _connectionId: string,
  ): Promise<ProviderEventType[]> => {
    setError(null);
    try {
      const result = await api.get<{
        eventTypes: ApiProviderEventType[];
      }>('/api/v1/scheduling/event-types');

      return result.eventTypes.map(normalizeProviderEventType);
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Fetch event types failed');
      console.error('[useSchedulingConnection] fetchEventTypes failed:', wrapped);
      setError(wrapped);
      throw wrapped;
    }
  }, [api]);

  const disconnect = useCallback(async (_connectionId: string): Promise<void> => {
    setError(null);
    try {
      await api.del('/api/v1/scheduling/connection');
      setConnection(null);
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Disconnect failed');
      console.error('[useSchedulingConnection] disconnect failed:', wrapped);
      setError(wrapped);
      throw wrapped;
    }
  }, [api]);

  return {
    connection,
    isLoading,
    error,
    exchangeOAuth,
    fetchEventTypes,
    disconnect,
    getAuthUrl,
    refetch: fetchConnection,
  };
}
