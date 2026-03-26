/**
 * createAssessment Lambda Handler
 *
 * Secure replacement for client-side Assessment.create() via publicApiKey.
 *
 * SECURITY:
 *   - Accepts inviteToken (NOT candidateId) as identity proof.
 *   - Resolves candidateId and ownerId server-side from DynamoDB.
 *   - Rejects duplicate assessments (same candidate + challenge).
 *   - NEVER trusts client-supplied candidateId or ownerId.
 *
 * Called by the candidate assessment flow (publicApiKey auth).
 */

import {
  DynamoDBClient,
  ScanCommand,
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

export async function handler(event: unknown): Promise<CreateAssessmentResult> {
  try {
    // ── 1. Extract and validate arguments ────────────────────────────────
    const args = (event as Record<string, unknown>)?.['arguments'] as
      | Record<string, unknown>
      | undefined;

    const inviteToken = typeof args?.['inviteToken'] === 'string'
      ? args['inviteToken'].trim()
      : '';
    const challengeId = typeof args?.['challengeId'] === 'string'
      ? args['challengeId'].trim()
      : '';
    const submission = typeof args?.['submission'] === 'string'
      ? args['submission']
      : '';

    if (!inviteToken) {
      return { success: false, error: 'VALIDATION: inviteToken is required' };
    }
    if (!challengeId) {
      return { success: false, error: 'VALIDATION: challengeId is required' };
    }
    if (!submission) {
      return { success: false, error: 'VALIDATION: submission is required' };
    }

    // ── 2. Resolve inviteToken → candidate (server-side) ─────────────────
    const { Items, Count } = await dynamo.send(new ScanCommand({
      TableName: CANDIDATE_TABLE,
      FilterExpression: 'inviteToken = :token',
      ExpressionAttributeValues: {
        ':token': { S: inviteToken },
      },
      ProjectionExpression: 'id, pipelineId, #o',
      ExpressionAttributeNames: { '#o': 'owner' },
    }));

    if (!Items || Count === 0 || !Items[0]) {
      console.error('[createAssessment] Invalid invite token');
      return { success: false, error: 'Invalid invite token' };
    }

    const candidate = unmarshall(Items[0]);
    const candidateId = candidate['id'] as string;
    const ownerId = (candidate['owner'] as string | undefined) ?? null;

    // ── 3. Duplicate check (same candidate + challenge) ──────────────────
    // Uses a Scan with filter — acceptable at MVP scale.
    // TODO: Add GSI on candidateId+challengeId for O(1) lookup at scale.
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

    // ── 4. Create Assessment record ──────────────────────────────────────
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
      // Amplify model type discriminator
      __typename: { S: 'Assessment' },
    };

    // Only set ownerId if the candidate has an owner (recruiter Cognito sub)
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
