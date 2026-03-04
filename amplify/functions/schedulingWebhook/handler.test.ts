import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './handler';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import crypto from 'crypto';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Scheduling Webhook Handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    process.env.SCHEDULINGCONNECTION_TABLE_NAME = 'SchedulingConnection';
    process.env.SCHEDULEDINTERVIEW_TABLE_NAME = 'ScheduledInterview';
    process.env.CANDIDATE_TABLE_NAME = 'Candidate';
    process.env.WEBHOOK_ENABLED = 'true';
  });

  describe('3.1 resolveNormalizer(headers)', () => {
    it('No matching normalizer (unknown headers) - 400', async () => {
      const event = {
        headers: { 'user-agent': 'Unknown' },
        body: '{}',
        requestContext: { http: { method: 'POST' } }
      };

      const result = await handler(event as any);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toContain('Unknown provider');
    });

    it('Calendly headers → resolves calendlyNormalizer', async () => {
      // Mock connection lookup to fail later, we just want to see it reach that point
      ddbMock.on(ScanCommand, { TableName: 'SchedulingConnection' }).resolves({ Items: [] });
      
      const event = {
        headers: { 'calendly-webhook-signature': 'any' },
        body: '{}',
        requestContext: { http: { method: 'POST' } }
      };

      const result = await handler(event as any);
      // It should pass resolution and fail at connection lookup (404)
      expect(result.statusCode).toBe(404);
    });

    it('Cal.com headers → resolves calcomNormalizer', async () => {
      ddbMock.on(ScanCommand, { TableName: 'SchedulingConnection' }).resolves({ Items: [] });
      
      const event = {
        headers: { 'x-cal-signature-256': 'any' },
        body: '{}',
        requestContext: { http: { method: 'POST' } }
      };

      const result = await handler(event as any);
      expect(result.statusCode).toBe(404);
    });
  });

  describe('3.3 findConnectionByProvider(providerId)', () => {
    it('ACTIVE connection exists for provider', async () => {
      ddbMock.on(ScanCommand, { TableName: 'SchedulingConnection' }).resolves({
        Items: [{
          id: 'conn-123',
          providerId: 'CALENDLY',
          status: 'ACTIVE',
          webhookSecret: 'secret'
        }]
      });

      ddbMock.on(ScanCommand, { TableName: 'ScheduledInterview' }).resolves({ Items: [] });

      const body = JSON.stringify({ event: 'invitee.created', payload: { scheduled_event: { uri: 'evt' } } });
      const timestamp = Date.now().toString();
      const hmac = crypto.createHmac('sha256', 'secret').update(`${timestamp}.${body}`).digest('hex');

      const event = {
        queryStringParameters: { connectionId: 'conn-123' },
        headers: { 'calendly-webhook-signature': `t=${timestamp},v1=${hmac}` },
        body,
        requestContext: { http: { method: 'POST' } }
      };

      const result = await handler(event as any);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('No matching interview found');
    });

    it('Only REVOKED connections exist', async () => {
      // Mock returning no ACTIVE connections (even if some exist with other status)
      ddbMock.on(ScanCommand, { TableName: 'SchedulingConnection' }).resolves({
        Items: []
      });

      const event = {
        queryStringParameters: { connectionId: 'conn-123' },
        headers: { 'calendly-webhook-signature': 'any' },
        body: '{}',
        requestContext: { http: { method: 'POST' } }
      };

      const result = await handler(event as any);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).message).toBe('No active connection found');
    });

    it('No connections at all', async () => {
      ddbMock.on(ScanCommand, { TableName: 'SchedulingConnection' }).resolves({ Items: [] });

      const event = {
        queryStringParameters: { connectionId: 'conn-123' },
        headers: { 'calendly-webhook-signature': 'any' },
        body: '{}',
        requestContext: { http: { method: 'POST' } }
      };

      const result = await handler(event as any);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).message).toBe('No active connection found');
    });

    it("Multiple ACTIVE connections (shouldn't happen) - Returns first", async () => {
      ddbMock.on(ScanCommand, { TableName: 'SchedulingConnection' }).resolves({
        Items: [{
          id: 'conn-123',
          providerId: 'CALENDLY',
          status: 'ACTIVE',
          webhookSecret: 'secret'
        }, {
          id: 'conn-456',
          providerId: 'CALENDLY',
          status: 'ACTIVE'
        }]
      });

      ddbMock.on(ScanCommand, { TableName: 'ScheduledInterview' }).resolves({ Items: [] });

      const body = JSON.stringify({ event: 'invitee.created', payload: { scheduled_event: { uri: 'evt' } } });
      const timestamp = Date.now().toString();
      const hmac = crypto.createHmac('sha256', 'secret').update(`${timestamp}.${body}`).digest('hex');

      const event = {
        queryStringParameters: { connectionId: 'conn-123' },
        headers: { 'calendly-webhook-signature': `t=${timestamp},v1=${hmac}` },
        body,
        requestContext: { http: { method: 'POST' } }
      };

      const result = await handler(event as any);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('3.4 findScheduledInterview(normalized)', () => {
    it('Match by externalEventId (primary path)', async () => {
      ddbMock.on(ScanCommand, { TableName: 'SchedulingConnection' }).resolves({
        Items: [{ id: 'c1', providerId: 'CALENDLY', status: 'ACTIVE', webhookSecret: 's' }]
      });

      ddbMock.on(ScanCommand, { TableName: 'ScheduledInterview' }).resolves({
        Items: [{ id: 'int-1', candidateId: 'can-1', status: 'INVITED' }]
      });

      const body = JSON.stringify({ event: 'invitee.created', payload: { scheduled_event: { uri: 'evt-1' } } });
      const timestamp = Date.now().toString();
      const hmac = crypto.createHmac('sha256', 's').update(`${timestamp}.${body}`).digest('hex');

      const event = {
        queryStringParameters: { connectionId: 'c1' },
        headers: { 'calendly-webhook-signature': `t=${timestamp},v1=${hmac}` },
        body,
        requestContext: { http: { method: 'POST' } }
      };

      const result = await handler(event as any);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Interview updated');
    });

    it('No externalEventId match → email fallback finds INVITED interview', async () => {
      ddbMock.on(ScanCommand, { TableName: 'SchedulingConnection' }).resolves({
        Items: [{ id: 'c1', providerId: 'CALENDLY', status: 'ACTIVE', webhookSecret: 's' }]
      });

      // 1. Scan lookup by externalId fails
      ddbMock.on(ScanCommand, { TableName: 'ScheduledInterview', FilterExpression: '#eid = :eid' }).resolves({ Items: [] });

      // 2. Fallback: Search candidate by email
      ddbMock.on(ScanCommand, { TableName: 'Candidate' }).resolves({
        Items: [{ id: 'can-1', email: 'test@example.com' }]
      });

      // 3. Fallback: Search INVITED interview for candidate
      ddbMock.on(ScanCommand, { TableName: 'ScheduledInterview', FilterExpression: '#cid = :cid AND #status = :status' }).resolves({
        Items: [{ id: 'int-1', candidateId: 'can-1', status: 'INVITED' }]
      });

      const body = JSON.stringify({ event: 'invitee.created', payload: { email: 'test@example.com' } });
      const timestamp = Date.now().toString();
      const hmac = crypto.createHmac('sha256', 's').update(`${timestamp}.${body}`).digest('hex');

      const event = {
        queryStringParameters: { connectionId: 'c1' },
        headers: { 'calendly-webhook-signature': `t=${timestamp},v1=${hmac}` },
        body,
        requestContext: { http: { method: 'POST' } }
      };

      const result = await handler(event as any);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Interview updated');
    });
  });

  describe('3.5 Full Handler Integration Tests', () => {
    it('WEBHOOK_ENABLED=false → 503', async () => {
      process.env.WEBHOOK_ENABLED = 'false';
      const event = { requestContext: { http: { method: 'POST' } } };
      const result = await handler(event as any);
      expect(result.statusCode).toBe(503);
    });

    it('Valid Calendly invitee.created → full happy path', async () => {
      ddbMock.on(ScanCommand, { TableName: 'SchedulingConnection' }).resolves({
        Items: [{ id: 'c1', providerId: 'CALENDLY', status: 'ACTIVE', webhookSecret: 's' }]
      });

      ddbMock.on(ScanCommand, { TableName: 'ScheduledInterview' }).resolves({
        Items: [{ id: 'int-1', candidateId: 'can-1', status: 'INVITED' }]
      });

      const body = JSON.stringify({
        event: 'invitee.created',
        payload: {
          scheduled_event: {
            uri: 'evt-1',
            start_time: '2026-03-03T10:00:00Z',
            location: { join_url: 'https://zoom.us/j/1' }
          }
        }
      });
      const timestamp = Date.now().toString();
      const hmac = crypto.createHmac('sha256', 's').update(`${timestamp}.${body}`).digest('hex');

      const event = {
        queryStringParameters: { connectionId: 'c1' },
        headers: { 'calendly-webhook-signature': `t=${timestamp},v1=${hmac}` },
        body,
        requestContext: { http: { method: 'POST' } }
      };

      const result = await handler(event as any);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Interview updated');
      
      const calls = ddbMock.calls();
      const updates = calls.filter(c => c.args[0] instanceof UpdateCommand);
      expect(updates.length).toBeGreaterThan(0);
    });
  });
});
