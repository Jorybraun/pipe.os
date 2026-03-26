import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

const ddbMock = mockClient(DynamoDBClient);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Builds an AppSync event with Lambda authorizer resolverContext. */
function makeLambdaAuthEvent(args: Record<string, unknown>, candidateId: string, pipelineId: string = 'pipe-1') {
  return {
    arguments: args,
    identity: {
      resolverContext: { candidateId, pipelineId },
    },
  } as unknown;
}

/** Builds an AppSync event with publicApiKey auth (no resolverContext). */
function makeApiKeyEvent(args: Record<string, unknown>) {
  return { arguments: args } as unknown;
}

/** DynamoDB-marshalled Candidate record. */
function candidateItem(overrides: Record<string, Record<string, string>> = {}) {
  return {
    id: { S: 'cand-1' },
    pipelineId: { S: 'pipe-1' },
    status: { S: 'IN_PROGRESS' },
    owner: { S: 'recruiter-cognito-sub-123' },
    inviteToken: { S: 'valid-token-abc' },
    ...overrides,
  };
}

/** Mocks DynamoDB for the Lambda auth path: GetItem for ownerId, Scan for duplicate check. */
function mockLambdaAuthPath(ownerValue: string | null = 'recruiter-cognito-sub-123') {
  // GetItem returns Candidate with owner
  ddbMock.on(GetItemCommand).resolves({
    Item: ownerValue ? { owner: { S: ownerValue } } : {},
  });
  // Scan for duplicate check returns empty
  ddbMock.on(ScanCommand).resolves({ Items: [], Count: 0 });
  // PutItem succeeds
  ddbMock.on(PutItemCommand).resolves({});
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createAssessment handler', () => {
  beforeEach(async () => {
    vi.resetModules();
    ddbMock.reset();
    process.env.CANDIDATE_TABLE_NAME = 'Candidate';
    process.env.ASSESSMENT_TABLE_NAME = 'Assessment';
  });

  // ── Validation ──────────────────────────────────────────────────────────

  it('rejects when challengeId is missing', async () => {
    const { handler } = await import('./handler');
    const result = await handler(
      makeLambdaAuthEvent({ submission: '{}' }, 'cand-1'),
    );
    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('challengeId') }),
    );
  });

  it('rejects when submission is missing', async () => {
    const { handler } = await import('./handler');
    const result = await handler(
      makeLambdaAuthEvent({ challengeId: 'ch-1' }, 'cand-1'),
    );
    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('submission') }),
    );
  });

  // ── Lambda auth path (resolverContext) ──────────────────────────────────

  it('creates assessment using candidateId from resolverContext', async () => {
    mockLambdaAuthPath();
    const { handler } = await import('./handler');

    const result = await handler(
      makeLambdaAuthEvent(
        { challengeId: 'ch-1', submission: '{"answer":"hello"}' },
        'cand-1',
      ),
    );

    expect(result).toEqual(
      expect.objectContaining({ success: true, assessmentId: expect.any(String) }),
    );

    // Verify PutItem was called with correct candidateId and ownerId
    const putCalls = ddbMock.commandCalls(PutItemCommand);
    expect(putCalls).toHaveLength(1);
    const item = putCalls[0].args[0].input.Item!;
    expect(item['candidateId']).toEqual({ S: 'cand-1' });
    expect(item['ownerId']).toEqual({ S: 'recruiter-cognito-sub-123' });
  });

  it('does NOT call ScanCommand for inviteToken when resolverContext is present', async () => {
    mockLambdaAuthPath();
    const { handler } = await import('./handler');

    await handler(
      makeLambdaAuthEvent(
        { challengeId: 'ch-1', submission: '{}' },
        'cand-1',
      ),
    );

    // The only Scan should be the duplicate check (on Assessment table)
    const scanCalls = ddbMock.commandCalls(ScanCommand);
    scanCalls.forEach((call) => {
      expect(call.args[0].input.TableName).toBe('Assessment');
    });
  });

  it('ignores client-supplied candidateId when resolverContext is present', async () => {
    mockLambdaAuthPath();
    const { handler } = await import('./handler');

    await handler(
      makeLambdaAuthEvent(
        { challengeId: 'ch-1', submission: '{}', candidateId: 'ATTACKER-ID' },
        'cand-1',
      ),
    );

    const putCalls = ddbMock.commandCalls(PutItemCommand);
    const item = putCalls[0].args[0].input.Item!;
    expect(item['candidateId']).toEqual({ S: 'cand-1' });
    expect(item['candidateId']).not.toEqual({ S: 'ATTACKER-ID' });
  });

  // ── publicApiKey path (inviteToken, transition) ─────────────────────────

  it('falls back to inviteToken validation when no resolverContext', async () => {
    // First scan: resolve inviteToken → candidate
    let scanCallCount = 0;
    ddbMock.on(ScanCommand).callsFake(() => {
      scanCallCount++;
      if (scanCallCount === 1) return { Items: [candidateItem()], Count: 1 };
      return { Items: [], Count: 0 }; // duplicate check
    });
    ddbMock.on(GetItemCommand).resolves({
      Item: { owner: { S: 'recruiter-cognito-sub-123' } },
    });
    ddbMock.on(PutItemCommand).resolves({});

    const { handler } = await import('./handler');
    const result = await handler(
      makeApiKeyEvent({
        inviteToken: 'valid-token-abc',
        challengeId: 'ch-1',
        submission: '{}',
      }),
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it('rejects when no resolverContext AND no inviteToken', async () => {
    const { handler } = await import('./handler');
    const result = await handler(
      makeApiKeyEvent({ challengeId: 'ch-1', submission: '{}' }),
    );
    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('inviteToken') }),
    );
  });

  it('rejects when inviteToken does not match any candidate', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [], Count: 0 });

    const { handler } = await import('./handler');
    const result = await handler(
      makeApiKeyEvent({ inviteToken: 'bad-token', challengeId: 'ch-1', submission: '{}' }),
    );
    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('Invalid invite token') }),
    );
  });

  // ── Duplicate prevention (both paths) ───────────────────────────────────

  it('rejects duplicate assessment', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: { owner: { S: 'recruiter-cognito-sub-123' } },
    });
    // Duplicate check returns existing assessment
    ddbMock.on(ScanCommand).resolves({
      Items: [{ id: { S: 'existing-assessment' } }],
      Count: 1,
    });

    const { handler } = await import('./handler');
    const result = await handler(
      makeLambdaAuthEvent(
        { challengeId: 'ch-1', submission: '{}' },
        'cand-1',
      ),
    );

    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('already submitted') }),
    );
    expect(ddbMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it('handles candidate with no owner field gracefully', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: {} });
    ddbMock.on(ScanCommand).resolves({ Items: [], Count: 0 });
    ddbMock.on(PutItemCommand).resolves({});

    const { handler } = await import('./handler');
    const result = await handler(
      makeLambdaAuthEvent(
        { challengeId: 'ch-1', submission: '{}' },
        'cand-1',
      ),
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    const item = ddbMock.commandCalls(PutItemCommand)[0].args[0].input.Item!;
    expect(item['ownerId']).toBeUndefined();
  });

  it('returns error when DynamoDB PutItem fails', async () => {
    mockLambdaAuthPath();
    ddbMock.on(PutItemCommand).rejects(new Error('ConditionalCheckFailedException'));

    const { handler } = await import('./handler');
    const result = await handler(
      makeLambdaAuthEvent(
        { challengeId: 'ch-1', submission: '{}' },
        'cand-1',
      ),
    );

    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.any(String) }),
    );
  });
});
