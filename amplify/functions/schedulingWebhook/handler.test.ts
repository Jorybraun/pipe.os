import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './handler';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Scheduling Webhook Handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    process.env.SCHEDULINGCONNECTION_TABLE_NAME = 'SchedulingConnection';
    process.env.SCHEDULEDINTERVIEW_TABLE_NAME = 'ScheduledInterview';
    process.env.CANDIDATE_TABLE_NAME = 'Candidate';
  });

  it('should reject requests with no normalizer', async () => {
    const event = {
      queryStringParameters: { connectionId: 'conn-123' },
      headers: { 'user-agent': 'Unknown' },
      body: JSON.stringify({ some: 'data' }),
    };

    const result = await handler(event as any);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain('Could not identify provider');
  });

  it('should reject requests with invalid signature', async () => {
    // Mock connection lookup
    ddbMock.on(any => any.TableName === 'SchedulingConnection').resolves({
      Item: {
        id: 'conn-123',
        providerId: 'CALENDLY',
        webhookSecret: 'secret',
        status: 'ACTIVE'
      }
    });

    const event = {
      queryStringParameters: { connectionId: 'conn-123' },
      headers: { 'calendly-webhook-signature': 'invalid' },
      body: JSON.stringify({ event: 'invitee.created' }),
    };

    const result = await handler(event as any);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).message).toBe('Signature verification failed');
  });

  it('should process valid Calendly webhook and update interview', async () => {
    // 1. Mock connection lookup
    ddbMock.on(any => any.TableName === 'SchedulingConnection').resolves({
      Item: {
        id: 'conn-123',
        providerId: 'CALENDLY',
        webhookSecret: 'secret',
        status: 'ACTIVE'
      }
    });

    // 2. Mock interview lookup by externalEventId (GSI)
    ddbMock.on(any => any.IndexName === 'interviewsByExternalEventId').resolves({
      Items: [{
        id: 'interview-123',
        candidateId: 'cand-123',
        status: 'INVITED'
      }]
    });

    // 3. Mock interview update
    ddbMock.on(any => any.TableName === 'ScheduledInterview' && !any.IndexName).resolves({});

    const payload = {
      event: 'invitee.created',
      payload: {
        email: 'cand@example.com',
        scheduled_event: {
          uri: 'evt-123',
          start_time: '2026-03-03T10:00:00Z'
        }
      }
    };
    const body = JSON.stringify(payload);
    
    // Create valid signature
    const crypto = await import('crypto');
    const timestamp = Date.now().toString();
    const hmac = crypto.createHmac('sha256', 'secret').update(`${timestamp}.${body}`).digest('hex');

    const event = {
      queryStringParameters: { connectionId: 'conn-123' },
      headers: { 'calendly-webhook-signature': `t=${timestamp},v1=${hmac}` },
      body,
    };

    const result = await handler(event as any);
    expect(result.statusCode).toBe(200);
    
    // Verify interview was updated
    expect(ddbMock).toHaveReceivedCommand(UpdateCommand);
  });
});

// Helper to match any command
const any = vi.fn(() => true);
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
