/**
 * enterStage Lambda Handler (ADR-023)
 *
 * Creates a stage-level Assessment when a candidate enters a stage.
 * Idempotent: returns existing assessmentId if (candidateId, stageId) already exists.
 *
 * Auth paths:
 * 1. Lambda auth (preferred): candidateId from sessionAuthorizer resolverContext
 * 2. publicApiKey (transition): validates inviteToken server-side
 *
 * SECURITY:
 *   - NEVER trusts client-supplied candidateId or ownerId.
 *   - Resolves ownerId server-side from the Candidate record's owner field.
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

interface EnterStageResult {
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
  const identity = event['identity'] as Record<string, unknown> | undefined;
  const resolverContext = identity?.['resolverContext'] as Record<string, string> | undefined;
  if (resolverContext?.['candidateId']) {
    return { candidateId: resolverContext['candidateId'], fromResolverContext: true };
  }
  return { candidateId: null, fromResolverContext: false };
}

export async function handler(event: unknown): Promise<EnterStageResult> {
  try {
    const eventObj = event as Record<string, unknown>;
    const args = eventObj['arguments'] as Record<string, unknown> | undefined;

    const stageId = typeof args?.['stageId'] === 'string'
      ? args['stageId'].trim()
      : '';

    if (!stageId) {
      return { success: false, error: 'VALIDATION: stageId is required' };
    }

    // ── 1. Resolve candidate identity ──────────────────────────────────────
    let candidateId: string;

    const { candidateId: resolvedId, fromResolverContext } = extractCandidateId(eventObj);

    if (fromResolverContext && resolvedId) {
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
        console.error('[enterStage] Invalid invite token');
        return { success: false, error: 'Invalid invite token' };
      }

      candidateId = unmarshall(Items[0])['id'] as string;
    }

    // ── 2. Look up ownerId from Candidate record ───────────────────────────
    const { Item: candidateItem } = await dynamo.send(new GetItemCommand({
      TableName: CANDIDATE_TABLE,
      Key: { id: { S: candidateId } },
      ProjectionExpression: '#o',
      ExpressionAttributeNames: { '#o': 'owner' },
    }));

    const ownerId = candidateItem
      ? (unmarshall(candidateItem)['owner'] as string | undefined) ?? null
      : null;

    // ── 3. Idempotent check (same candidate + stage) ─────────────────────
    // If an Assessment already exists for this (candidateId, stageId), return it.
    // Amplify soft-deletes set _deleted=true; filter in code for reliability.
    const { Items: existingItems } = await dynamo.send(
      new ScanCommand({
        TableName: ASSESSMENT_TABLE,
        FilterExpression: 'candidateId = :cid AND stageId = :sid',
        ExpressionAttributeValues: {
          ':cid': { S: candidateId },
          ':sid': { S: stageId },
        },
        ProjectionExpression: 'id, #del',
        ExpressionAttributeNames: { '#del': '_deleted' },
      }),
    );

    const activeAssessments = (existingItems ?? []).filter(item => {
      const record = unmarshall(item);
      return !record['_deleted'];
    });

    if (activeAssessments.length > 0) {
      const existingId = unmarshall(activeAssessments[0]!)['id'] as string;
      console.log(`[enterStage] Returning existing assessment ${existingId} for candidate ${candidateId}, stage ${stageId}`);
      return { success: true, assessmentId: existingId };
    }

    // ── 4. Create Assessment record ────────────────────────────────────────
    const assessmentId = randomUUID();
    const now = new Date().toISOString();

    const item: Record<string, { S: string }> = {
      id: { S: assessmentId },
      candidateId: { S: candidateId },
      stageId: { S: stageId },
      status: { S: 'PENDING' },
      startedAt: { S: now },
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

    console.log(`[enterStage] Created assessment ${assessmentId} for candidate ${candidateId}, stage ${stageId}`);

    return { success: true, assessmentId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    console.error('[enterStage] Error:', message);
    return { success: false, error: message };
  }
}
