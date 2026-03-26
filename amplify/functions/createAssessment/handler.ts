/**
 * createAssessment Lambda Handler
 *
 * Secure assessment creation with two auth paths:
 *
 * 1. Lambda auth (preferred): candidateId comes from sessionAuthorizer's
 *    resolverContext — no inviteToken needed, identity already proven.
 * 2. publicApiKey (transition): validates inviteToken server-side to resolve
 *    candidateId. Will be removed after frontend migration to lambda auth.
 *
 * SECURITY:
 *   - NEVER trusts client-supplied candidateId or ownerId.
 *   - Resolves ownerId server-side from the Candidate record's owner field.
 *   - Rejects duplicate assessments (same candidate + challenge).
 */

import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'node:crypto';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME ?? 'Candidate';
const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME ?? 'Assessment';

interface CreateAssessmentResult {
  success: boolean;
  assessmentId?: string;
  error?: string;
}

/**
 * Extract candidateId from the event. Prefers resolverContext (Lambda auth)
 * over inviteToken (publicApiKey auth).
 */
function extractCandidateId(event: Record<string, unknown>): {
  candidateId: string | null;
  fromResolverContext: boolean;
} {
  // Path 1: Lambda authorizer sets identity.resolverContext.candidateId
  const identity = event['identity'] as Record<string, unknown> | undefined;
  const resolverContext = identity?.['resolverContext'] as Record<string, string> | undefined;
  if (resolverContext?.['candidateId']) {
    return { candidateId: resolverContext['candidateId'], fromResolverContext: true };
  }

  // Path 2: No resolverContext — fall through to inviteToken validation
  return { candidateId: null, fromResolverContext: false };
}

export async function handler(event: unknown): Promise<CreateAssessmentResult> {
  try {
    const eventObj = event as Record<string, unknown>;
    const args = eventObj['arguments'] as Record<string, unknown> | undefined;

    const challengeId = typeof args?.['challengeId'] === 'string'
      ? args['challengeId'].trim()
      : '';
    const submission = typeof args?.['submission'] === 'string'
      ? args['submission']
      : '';

    if (!challengeId) {
      return { success: false, error: 'VALIDATION: challengeId is required' };
    }
    if (!submission) {
      return { success: false, error: 'VALIDATION: submission is required' };
    }

    // ── 1. Resolve candidate identity ──────────────────────────────────────
    let candidateId: string;

    const { candidateId: resolvedId, fromResolverContext } = extractCandidateId(eventObj);

    if (fromResolverContext && resolvedId) {
      // Lambda auth path — identity proven by sessionAuthorizer
      candidateId = resolvedId;
    } else {
      // publicApiKey path — validate inviteToken (transition period)
      const inviteToken = typeof args?.['inviteToken'] === 'string'
        ? args['inviteToken'].trim()
        : '';

      if (!inviteToken) {
        return { success: false, error: 'VALIDATION: inviteToken is required' };
      }

      const { Items, Count } = await dynamo.send(new ScanCommand({
        TableName: CANDIDATE_TABLE,
        FilterExpression: 'inviteToken = :token',
        ExpressionAttributeValues: {
          ':token': { S: inviteToken },
        },
        ProjectionExpression: 'id',
      }));

      if (!Items || Count === 0 || !Items[0]) {
        console.error('[createAssessment] Invalid invite token');
        return { success: false, error: 'Invalid invite token' };
      }

      candidateId = unmarshall(Items[0])['id'] as string;
    }

    // ── 2. Look up ownerId from Candidate record ───────────────────────────
    // Always done regardless of auth path — ownerId is never from client input
    const { Item: candidateItem } = await dynamo.send(new GetItemCommand({
      TableName: CANDIDATE_TABLE,
      Key: { id: { S: candidateId } },
      ProjectionExpression: '#o',
      ExpressionAttributeNames: { '#o': 'owner' },
    }));

    const ownerId = candidateItem
      ? (unmarshall(candidateItem)['owner'] as string | undefined) ?? null
      : null;

    // ── 3. Duplicate check (same candidate + challenge) ────────────────────
    const { Items: existingItems, Count: existingCount } = await dynamo.send(
      new ScanCommand({
        TableName: ASSESSMENT_TABLE,
        FilterExpression: 'candidateId = :cid AND challengeId = :chid',
        ExpressionAttributeValues: {
          ':cid': { S: candidateId },
          ':chid': { S: challengeId },
        },
        ProjectionExpression: 'id',
      }),
    );

    if (existingItems && existingCount && existingCount > 0) {
      return { success: false, error: 'Assessment already submitted for this challenge' };
    }

    // ── 4. Create Assessment record ────────────────────────────────────────
    const assessmentId = randomUUID();
    const now = new Date().toISOString();

    const item: Record<string, { S: string } | { N: string }> = {
      id: { S: assessmentId },
      candidateId: { S: candidateId },
      challengeId: { S: challengeId },
      submission: { S: submission },
      score: { N: '0' },
      completedAt: { S: now },
      createdAt: { S: now },
      updatedAt: { S: now },
      __typename: { S: 'Assessment' },
    };

    if (ownerId) {
      item['ownerId'] = { S: ownerId };
    }

    await dynamo.send(new PutItemCommand({
      TableName: ASSESSMENT_TABLE,
      Item: item,
    }));

    console.log(`[createAssessment] Created ${assessmentId} for candidate ${candidateId}`);

    return { success: true, assessmentId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    console.error('[createAssessment] Error:', message);
    return { success: false, error: message };
  }
}
