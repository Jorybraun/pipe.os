import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './handler';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ssmMock = mockClient(SSMClient);

// Mock fetch globally
global.fetch = vi.fn();

describe('Scheduling OAuth Handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    ssmMock.reset();
    vi.clearAllMocks();
    process.env.SCHEDULINGCONNECTION_TABLE_NAME = 'SchedulingConnection';
    process.env.CALENDLY_CLIENT_ID = 'cal-id';
    process.env.CALENDLY_CLIENT_SECRET = 'cal-secret';
    process.env.WEBHOOK_URL_SSM_PARAM = '/webhook/url';
  });

  describe('exchange action', () => {
    it('should exchange code for tokens and create connection', async () => {
      const mockEvent = {
        arguments: {
          action: 'exchange',
          params: {
            code: 'test-code',
            redirectUri: 'https://example.com/callback',
            providerId: 'CALENDLY'
          }
        },
        identity: { sub: 'user-123' }
      };

      // 1. Mock Token Exchange
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'at-123',
          refresh_token: 'rt-123',
          expires_in: 3600
        })
      });

      // 2. Mock User Info Fetch
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          resource: { email: 'user@example.com', name: 'Test User' }
        })
      });

      // 3. Mock SSM for Webhook URL
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'https://webhook.site/123' }
      });

      // 4. Mock Calendly User URI Fetch (for webhook registration)
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          resource: { uri: 'user-uri', current_organization: 'org-uri' }
        })
      });

      // 5. Mock Webhook Registration
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          resource: { uri: 'webhook-uri' }
        })
      });

      const result = await handler(mockEvent as any);

      expect(result.success).toBe(true);
      expect(ddbMock).toHaveReceivedCommand(PutCommand);
      expect(ddbMock).toHaveReceivedCommand(UpdateCommand); // For webhookId
    });
  });

  describe('refresh action', () => {
    it('should refresh tokens using refresh token', async () => {
      const mockEvent = {
        arguments: {
          action: 'refresh',
          params: { connectionId: 'conn-123' }
        }
      };

      // 1. Mock Connection Lookup
      ddbMock.on(GetCommand).resolves({
        Item: {
          id: 'conn-123',
          providerId: 'CALENDLY',
          refreshToken: 'rt-123'
        }
      });

      // 2. Mock Refresh Token Call
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-at',
          refresh_token: 'new-rt',
          expires_in: 3600
        })
      });

      const result = await handler(mockEvent as any);

      expect(result.success).toBe(true);
      expect(ddbMock).toHaveReceivedCommand(UpdateCommand);
    });
  });

  describe('registerWebhook action', () => {
    it('should register webhook and update connection', async () => {
      const mockEvent = {
        arguments: {
          action: 'registerWebhook',
          params: { connectionId: 'conn-123' }
        },
        identity: { sub: 'user-123' }
      };

      // 1. Mock Connection Lookup
      ddbMock.on(GetCommand).resolves({
        Item: {
          id: 'conn-123',
          recruiterId: 'user-123',
          providerId: 'CALENDLY',
          accessToken: 'at-123',
          webhookSecret: 'ws-123',
          status: 'ACTIVE'
        }
      });

      // 2. Mock SSM
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'https://webhook.site/123' }
      });

      // 3. Mock Calendly calls
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ resource: { uri: 'u', current_organization: 'o' } })
      });
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ resource: { uri: 'w' } })
      });

      const result = await handler(mockEvent as any);

      expect(result.success).toBe(true);
      expect(ddbMock).toHaveReceivedCommand(UpdateCommand);
      
      // Verify connectionId is appended to callback URL
      const lastFetchCall = (global.fetch as any).mock.calls.find((c: any) => c[1]?.method === 'POST');
      const body = JSON.parse(lastFetchCall[1].body);
      expect(body.url).toContain('connectionId=conn-123');
    });
  });
});
