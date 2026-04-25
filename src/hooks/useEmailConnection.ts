import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from './useApiClient';
import type { ApiClient } from '../lib/api/client';

type ConnectionStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';
type EmailProviderId = 'GMAIL' | 'MICROSOFT';

export interface EmailConnectionInfo {
  id: string;
  providerId: EmailProviderId;
  status: ConnectionStatus;
  accountEmail: string;
  accountName: string | null;
  connectedAt: string;
}

interface UseEmailConnectionResult {
  connection: EmailConnectionInfo | null;
  isLoading: boolean;
  error: Error | null;
  getAuthUrl: (
    providerId: EmailProviderId,
    redirectUri: string,
    codeChallenge?: string,
  ) => Promise<string>;
  exchangeOAuth: (
    providerId: EmailProviderId,
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ) => Promise<void>;
  disconnect: () => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * useEmailConnection — manages the recruiter's OAuth connection
 * to an email provider (Gmail or Microsoft) for send-as.
 */
export function useEmailConnection(): UseEmailConnectionResult {
  const api: ApiClient = useApiClient();

  const [connection, setConnection] = useState<EmailConnectionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchConnection = useCallback(async () => {
    try {
      const result = await api.get<{
        connection: {
          id: string;
          providerId: EmailProviderId;
          accountEmail: string;
          accountName: string | null;
          status: ConnectionStatus;
          connectedAt: string;
        } | null;
      }>('/api/v1/email/connection');

      if (result.connection) {
        setConnection({
          id: result.connection.id,
          providerId: result.connection.providerId,
          status: result.connection.status,
          accountEmail: result.connection.accountEmail,
          accountName: result.connection.accountName,
          connectedAt: result.connection.connectedAt,
        });
      } else {
        setConnection(null);
      }
    } catch (err) {
      console.error('[useEmailConnection] fetch error:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch email connection'));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void fetchConnection();
  }, [fetchConnection]);

  const getAuthUrl = useCallback(
    async (
      providerId: EmailProviderId,
      redirectUri: string,
      codeChallenge?: string,
    ): Promise<string> => {
      setError(null);
      try {
        const result = await api.post<{ authUrl: string }>(
          '/api/v1/email/connect',
          { providerId, redirectUri, codeChallenge },
        );
        return result.authUrl;
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error('Failed to get auth URL');
        setError(wrapped);
        throw wrapped;
      }
    },
    [api],
  );

  const exchangeOAuth = useCallback(
    async (
      providerId: EmailProviderId,
      code: string,
      redirectUri: string,
      codeVerifier?: string,
    ): Promise<void> => {
      setError(null);
      try {
        const result = await api.post<{
          connection: {
            id: string;
            providerId: EmailProviderId;
            accountEmail: string;
            accountName: string;
            status: ConnectionStatus;
          };
        }>('/api/v1/email/callback', {
          providerId,
          code,
          redirectUri,
          codeVerifier,
        });

        setConnection({
          id: result.connection.id,
          providerId: result.connection.providerId,
          status: result.connection.status,
          accountEmail: result.connection.accountEmail,
          accountName: result.connection.accountName,
          connectedAt: new Date().toISOString(),
        });
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error('Email OAuth exchange failed');
        console.error('[useEmailConnection] exchangeOAuth failed:', wrapped);
        setError(wrapped);
        throw wrapped;
      }
    },
    [api],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await api.del('/api/v1/email/connection');
      setConnection(null);
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('Disconnect failed');
      console.error('[useEmailConnection] disconnect failed:', wrapped);
      setError(wrapped);
      throw wrapped;
    }
  }, [api]);

  return {
    connection,
    isLoading,
    error,
    getAuthUrl,
    exchangeOAuth,
    disconnect,
    refetch: fetchConnection,
  };
}
