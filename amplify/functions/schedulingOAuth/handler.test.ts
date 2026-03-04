import { expect, vi, test, beforeEach } from 'vitest';
import { handler } from './handler';
import { ddbMock } from './test/setup';
import { PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const CONNECTION_TABLE = process.env.SCHEDULINGCONNECTION_TABLE_NAME ?? 'SchedulingConnection';

global.fetch = vi.fn();

beforeEach(() => {
  ddbMock.reset();
  vi.clearAllMocks();
  process.env.WEBHOOK_URL_SSM_PARAM = '/webhook/url';
});

// Mock SSM
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = vi.fn().mockResolvedValue({
      Parameter: { Value: 'https://example.com/webhook' },
    });
  },
  GetParameterCommand: class {},
}));

const mockEvent = (action: string, params: any, identity: any = { sub: 'test-user' }) => ({
  arguments: { action, params },
  identity,
} as any);

// ─── 5.1 Action Routing ──────────────────────────────────────────────────────

test('5.1.1 action: \'exchange\' → dispatches to `handleExchange`', async () => {
  const event = mockEvent('exchange', { code: 'test', redirectUri: 'test', providerId: 'CALENDLY' });
  ddbMock.on(PutCommand).resolves({});
  (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600, refresh_token: 'rt' }) });
  (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { email: 'test@example.com', name: 'Test User' } }) });
  
  // Webhook registration mock calls
  (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { uri: 'user-uri' } }) });
  (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { uri: 'webhook-uri' } }) });

  const result = await handler(event);
  expect(result.success).toBe(true);
  expect(ddbMock.commandCalls(PutCommand).length).toBe(1);
});

test('5.1.2 action: \'refresh\' → dispatches to `handleRefresh`', async () => {
  const event = mockEvent('refresh', { connectionId: 'test' });
  ddbMock.on(GetCommand).resolves({ Item: { providerId: 'CALENDLY', refreshToken: 'rt' } });
  ddbMock.on(UpdateCommand).resolves({});
  (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600, refresh_token: 'rt' }) });
  const result = await handler(event);
  expect(result.success).toBe(true);
  expect(ddbMock.commandCalls(UpdateCommand).length).toBe(1);
});

test('5.1.3 action: \'fetchEventTypes\' → dispatches to `handleFetchEventTypes`', async () => {
  const event = mockEvent('fetchEventTypes', { connectionId: 'test' });
  ddbMock.on(GetCommand).resolves({ Item: { providerId: 'CALENDLY', accessToken: 'at', tokenExpiry: new Date(Date.now() + 3600000).toISOString() } });
  (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { uri: 'test' } }) });
  (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ collection: [] }) });
  const result = await handler(event);
  expect(result.success).toBe(true);
});

test('5.1.4 action: \'disconnect\' → dispatches to `handleDisconnect`', async () => {
  const event = mockEvent('disconnect', { connectionId: 'test' });
  ddbMock.on(GetCommand).resolves({ Item: { providerId: 'CALENDLY', accessToken: 'at', webhookId: 'test' } });
  ddbMock.on(UpdateCommand).resolves({});
  (global.fetch as any).mockResolvedValueOnce({ ok: true });
  const result = await handler(event);
  expect(result.success).toBe(true);
  expect(ddbMock.commandCalls(UpdateCommand).length).toBe(1);
});

test('5.1.5 action: \'registerWebhook\' → dispatches to `handleRegisterWebhook`', async () => {
  const event = mockEvent('registerWebhook', { connectionId: 'test' });
  ddbMock.on(GetCommand).resolves({ Item: { providerId: 'CALENDLY', accessToken: 'at', webhookSecret: 'test', recruiterId: 'test-user', status: 'ACTIVE', accountEmail: 'test@example.com' } });
  ddbMock.on(UpdateCommand).resolves({});
  
  // Mock Calendly calls for registration
  (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { uri: 'user-uri' } }) });
  (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { uri: 'webhook-uri' } }) });

  const result = await handler(event);
  expect(result.success).toBe(true);
  expect(ddbMock.commandCalls(UpdateCommand).length).toBe(1);
});

test('5.1.6 Unknown action → error response', async () => {
  const event = mockEvent('unknown', {});
  const result = await handler(event);
  expect(result.success).toBe(false);
  expect(result.message).toContain('Unknown action');
});

test('5.1.7 Identity extracted from `event.identity.sub`', async () => {
    const event = mockEvent('exchange', { code: 'test', redirectUri: 'test', providerId: 'CALENDLY' }, { sub: 'custom-user-id' });
    ddbMock.on(PutCommand).resolves({});
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600, refresh_token: 'rt' }) });
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { email: 'test@example.com', name: 'Test User' } }) });

    await handler(event);
    const putCommandInput = ddbMock.commandCalls(PutCommand)[0].args[0].input as any;

    expect(putCommandInput.Item.recruiterId).toBe('custom-user-id');
});

test('5.1.8 Missing identity', async () => {
    // Identity is undefined, should fallback to 'unknown'
    const event = {
        arguments: { action: 'exchange', params: { code: 'test', redirectUri: 'test', providerId: 'CALENDLY' } },
        identity: undefined
    } as any;
    
    ddbMock.on(PutCommand).resolves({});
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600, refresh_token: 'rt' }) });
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { email: 'test@example.com', name: 'Test User' } }) });

    await handler(event);
    const putCommandInput = ddbMock.commandCalls(PutCommand)[0].args[0].input as any;

    expect(putCommandInput.Item.recruiterId).toBe('unknown');
});

// ─── 5.2 handleExchange(params, recruiterId) ────────────────────────────────

test('5.2.1 Happy path: code → tokens → connection created → webhook registered', async () => {
    const params = { code: 'test', redirectUri: 'test', providerId: 'CALENDLY' };
    const event = mockEvent('exchange', params);

    // Mock token exchange
    (global.fetch as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'mock_access_token', expires_in: 3600, refresh_token: 'mock_refresh_token' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { email: 'test@example.com', name: 'Test User' } }) })
        // Registration calls
        .mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { uri: 'user-uri' } }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { uri: 'webhook-uri' } }) });

    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler(event);

    expect(result.success).toBe(true);

    const putCall = ddbMock.commandCalls(PutCommand)[0];
    expect(putCall.args[0].input.TableName).toBe(CONNECTION_TABLE);
    expect(putCall.args[0].input.Item.accessToken).toBe('mock_access_token');
    expect(putCall.args[0].input.Item.refreshToken).toBe('mock_refresh_token');
});

test('5.2.5 Token exchange HTTP error (400)', async () => {
    const event = mockEvent('exchange', { code: 'test', redirectUri: 'test', providerId: 'CALENDLY' });
    (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request'
    });

    const result = await handler(event);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Token exchange failed');
});

test('5.2.11 With `codeVerifier` for PKCE', async () => {
    const params = { code: 'test', redirectUri: 'test', providerId: 'CALENDLY', codeVerifier: 'test_verifier' };
    const event = mockEvent('exchange', params);

    (global.fetch as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'mock_access_token', expires_in: 3600, refresh_token: 'mock_refresh_token' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { email: 'test@example.com', name: 'Test User' } }) });

    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    await handler(event);

    const fetchBody = (global.fetch as any).mock.calls[0][1].body;
    // Body is URLSearchParams
    expect(fetchBody.toString()).toContain('code_verifier=test_verifier');
});
