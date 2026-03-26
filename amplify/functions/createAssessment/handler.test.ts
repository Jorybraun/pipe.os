import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

const ddbMock = mockClient(DynamoDBClient);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Builds a minimal AppSync resolver event for createAssessment. */
function makeEvent(args: Record<string, unknown>) {
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createAssessment handler', () => {
  beforeEach(async () => {
    vi.resetModules();
    ddbMock.reset();

    process.env.CANDIDATE_TABLE_NAME = 'Candidate';
    process.env.ASSESSMENT_TABLE_NAME = 'Assessment';
  });

  // ── Validation ──────────────────────────────────────────────────────────

  it('rejects when inviteToken is missing', async () => {
    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({ challengeId: 'ch-1', submission: '{}' }),
    );

    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('inviteToken') }),
    );
  });

  it('rejects when inviteToken is empty string', async () => {
    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({ inviteToken: '  ', challengeId: 'ch-1', submission: '{}' }),
    );

    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('inviteToken') }),
    );
  });

  it('rejects when challengeId is missing', async () => {
    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({ inviteToken: 'valid-token-abc', submission: '{}' }),
    );

    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('challengeId') }),
    );
  });

  it('rejects when submission is missing', async () => {
    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({ inviteToken: 'valid-token-abc', challengeId: 'ch-1' }),
    );

    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('submission') }),
    );
  });

  // ── Token resolution ────────────────────────────────────────────────────

  it('rejects when inviteToken does not match any candidate', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [], Count: 0 });

    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({ inviteToken: 'bad-token', challengeId: 'ch-1', submission: '{}' }),
    );

    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('Invalid invite token') }),
    );
  });

  // ── Duplicate prevention ────────────────────────────────────────────────

  it('rejects when candidate already has an assessment for this challenge', async () => {
    let scanCallCount = 0;
    ddbMock.on(ScanCommand).callsFake((input) => {
      scanCallCount++;
      // First scan: resolve inviteToken → candidate
      if (scanCallCount === 1) {
        return { Items: [candidateItem()], Count: 1 };
      }
      // Second scan: duplicate check → found existing assessment
      return { Items: [{ id: { S: 'existing-assessment-id' } }], Count: 1 };
    });

    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({ inviteToken: 'valid-token-abc', challengeId: 'ch-1', submission: '{}' }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('already submitted'),
      }),
    );
    // Must NOT have called PutItem
    expect(ddbMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('creates assessment with ownerId set server-side from Candidate.owner', async () => {
    let scanCallCount = 0;
    ddbMock.on(ScanCommand).callsFake(() => {
      scanCallCount++;
      if (scanCallCount === 1) return { Items: [candidateItem()], Count: 1 };
      return { Items: [], Count: 0 }; // No duplicate
    });

    // PutItem succeeds
    ddbMock.on(PutItemCommand).resolves({});

    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({
        inviteToken: 'valid-token-abc',
        challengeId: 'ch-1',
        submission: '{"answer":"hello"}',
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({ success: true, assessmentId: expect.any(String) }),
    );

    // Verify PutItem was called with correct ownerId
    const putCalls = ddbMock.commandCalls(PutItemCommand);
    expect(putCalls).toHaveLength(1);

    const putInput = putCalls[0].args[0].input;
    const item = putInput.Item!;

    // ownerId must be the recruiter's Cognito sub from the Candidate record
    expect(item['ownerId']).toEqual({ S: 'recruiter-cognito-sub-123' });
    // candidateId must be from the resolved candidate, not from client input
    expect(item['candidateId']).toEqual({ S: 'cand-1' });
    expect(item['challengeId']).toEqual({ S: 'ch-1' });
    expect(item['submission']).toEqual({ S: '{"answer":"hello"}' });
    expect(item['score']).toEqual({ N: '0' });
    // Must have completedAt timestamp
    expect(item['completedAt']).toBeDefined();
    expect(item['completedAt']!.S).toBeTruthy();
  });

  it('does NOT accept candidateId from client input — uses resolved candidate', async () => {
    // Even if the client sends a different candidateId, the handler must ignore it
    let scanCallCount = 0;
    ddbMock.on(ScanCommand).callsFake(() => {
      scanCallCount++;
      if (scanCallCount === 1) return { Items: [candidateItem()], Count: 1 };
      return { Items: [], Count: 0 };
    });
    ddbMock.on(PutItemCommand).resolves({});

    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({
        inviteToken: 'valid-token-abc',
        challengeId: 'ch-1',
        submission: '{}',
        candidateId: 'ATTACKER-SUPPLIED-ID', // Should be ignored
      }),
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));

    const putCalls = ddbMock.commandCalls(PutItemCommand);
    const item = putCalls[0].args[0].input.Item!;

    // Must use the resolved candidate ID, not the attacker-supplied one
    expect(item['candidateId']).toEqual({ S: 'cand-1' });
    expect(item['candidateId']).not.toEqual({ S: 'ATTACKER-SUPPLIED-ID' });
  });

  it('does NOT accept ownerId from client input — uses Candidate.owner', async () => {
    let scanCallCount = 0;
    ddbMock.on(ScanCommand).callsFake(() => {
      scanCallCount++;
      if (scanCallCount === 1) return { Items: [candidateItem()], Count: 1 };
      return { Items: [], Count: 0 };
    });
    ddbMock.on(PutItemCommand).resolves({});

    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({
        inviteToken: 'valid-token-abc',
        challengeId: 'ch-1',
        submission: '{}',
        ownerId: 'ATTACKER-SUPPLIED-OWNER', // Should be ignored
      }),
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));

    const putCalls = ddbMock.commandCalls(PutItemCommand);
    const item = putCalls[0].args[0].input.Item!;

    // Must use Candidate.owner, not client-supplied ownerId
    expect(item['ownerId']).toEqual({ S: 'recruiter-cognito-sub-123' });
    expect(item['ownerId']).not.toEqual({ S: 'ATTACKER-SUPPLIED-OWNER' });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it('handles candidate with no owner field gracefully', async () => {
    const candidateNoOwner = candidateItem();
    delete (candidateNoOwner as Record<string, unknown>)['owner'];

    let scanCallCount = 0;
    ddbMock.on(ScanCommand).callsFake(() => {
      scanCallCount++;
      if (scanCallCount === 1) return { Items: [candidateNoOwner], Count: 1 };
      return { Items: [], Count: 0 };
    });
    ddbMock.on(PutItemCommand).resolves({});

    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({
        inviteToken: 'valid-token-abc',
        challengeId: 'ch-1',
        submission: '{}',
      }),
    );

    // Should still succeed — ownerId will be empty/null but assessment is created
    expect(result).toEqual(expect.objectContaining({ success: true }));

    const putCalls = ddbMock.commandCalls(PutItemCommand);
    const item = putCalls[0].args[0].input.Item!;
    // ownerId should be absent or null when candidate has no owner
    expect(item['ownerId']).toBeUndefined();
  });

  it('returns error when DynamoDB PutItem fails', async () => {
    let scanCallCount = 0;
    ddbMock.on(ScanCommand).callsFake(() => {
      scanCallCount++;
      if (scanCallCount === 1) return { Items: [candidateItem()], Count: 1 };
      return { Items: [], Count: 0 };
    });
    ddbMock.on(PutItemCommand).rejects(new Error('ConditionalCheckFailedException'));

    const { handler } = await import('./handler');
    const result = await handler(
      makeEvent({
        inviteToken: 'valid-token-abc',
        challengeId: 'ch-1',
        submission: '{}',
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({ success: false, error: expect.any(String) }),
    );
  });
});
