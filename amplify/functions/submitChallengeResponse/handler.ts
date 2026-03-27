/**
 * submitChallengeResponse Lambda Handler (ADR-023)
 *
 * Creates a ChallengeSubmission record under the candidate's Assessment.
 * Resolves assessmentId server-side from the challenge's stageId — the
 * candidate never sees or provides internal IDs.
 *
 * Security:
 *   - NEVER trusts client-supplied candidateId, ownerId, or assessmentId.
 *   - Resolves everything server-side from inviteToken/JWT + challengeId.
 *   - Rejects duplicate submissions (same assessment + challenge).
 */

import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'node:crypto';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME ?? 'Candidate';
const STAGE_TABLE = process.env.STAGE_TABLE_NAME ?? 'Stage';
const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME ?? 'Assessment';
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE_NAME ?? 'Challenge';
const CHALLENGE_SUBMISSION_TABLE = process.env.CHALLENGE_SUBMISSION_TABLE_NAME ?? 'ChallengeSubmission';

interface SubmitChallengeResult {
  success: boolean;
  challengeSubmissionId?: string;
  error?: string;
}

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

export async function handler(event: unknown): Promise<SubmitChallengeResult> {
  try {
    const eventObj = event as Record<string, unknown>;
    const args = eventObj['arguments'] as Record<string, unknown> | undefined;

    const order = typeof args?.['order'] === 'number'
      ? args['order']
      : parseInt(String(args?.['order'] ?? ''), 10);
    const submission = typeof args?.['submission'] === 'string'
      ? args['submission']
      : '';

    if (isNaN(order) || order < 0) {
      return { success: false, error: 'VALIDATION: order must be a non-negative integer' };
    }
    if (!submission) {
      return { success: false, error: 'VALIDATION: submission is required' };
    }

    // ── 1. Resolve candidate identity ──────────────────────────────────────
    let candidateId: string;

    const { candidateId: resolvedId, fromResolverContext } = extractCandidateId(eventObj);

    if (fromResolverContext && resolvedId) {
      candidateId = resolvedId;
    } else {
      const inviteToken = typeof args?.['inviteToken'] === 'string'
        ? args['inviteToken'].trim()
        : '';

      if (!inviteToken) {
        return { success: false, error: 'VALIDATION: inviteToken is required' };
      }

      const { Items, Count } = await dynamo.send(new ScanCommand({
        TableName: CANDIDATE_TABLE,
        FilterExpression: 'inviteToken = :token',
        ExpressionAttributeValues: { ':token': { S: inviteToken } },
        ProjectionExpression: 'id',
      }));

      if (!Items || Count === 0 || !Items[0]) {
        return { success: false, error: 'Invalid invite token' };
      }

      candidateId = unmarshall(Items[0])['id'] as string;
    }

    // ── 2. Look up candidate's pipelineId ──────────────────────────────────
    const { Item: candidateFullItem } = await dynamo.send(new GetItemCommand({
      TableName: CANDIDATE_TABLE,
      Key: marshall({ id: candidateId }),
      ProjectionExpression: 'pipelineId',
    }));

    if (!candidateFullItem) {
      return { success: false, error: 'Candidate not found' };
    }

    const pipelineId = unmarshall(candidateFullItem)['pipelineId'] as string;

    // ── 3. Resolve current stage + challenge at order position ──────────────
    // Walk stages in order to find the current one (first with un-submitted challenges)
    const { Items: stageItemsFull } = await dynamo.send(new ScanCommand({
      TableName: STAGE_TABLE,
      FilterExpression: 'pipelineId = :pid',
      ExpressionAttributeValues: { ':pid': { S: pipelineId } },
    }));

    const stages = (stageItemsFull ?? [])
      .map(item => unmarshall(item) as Record<string, unknown>)
      .sort((a, b) => ((a['order'] as number) ?? 0) - ((b['order'] as number) ?? 0));

    let challengeId: string | null = null;
    let assessmentId: string | null = null;
    let ownerId: string | null = null;

    for (const stage of stages) {
      const stageId = stage['id'] as string;

      const { Items: challengeItems } = await dynamo.send(new ScanCommand({
        TableName: CHALLENGE_TABLE,
        FilterExpression: 'stageId = :sid',
        ExpressionAttributeValues: { ':sid': { S: stageId } },
      }));

      const challenges = (challengeItems ?? [])
        .map(item => unmarshall(item) as Record<string, unknown>)
        .sort((a, b) => ((a['order'] as number) ?? 0) - ((b['order'] as number) ?? 0));

      if (challenges.length === 0) continue;

      // Check submissions for this stage
      const { Items: assessmentItems } = await dynamo.send(new ScanCommand({
        TableName: ASSESSMENT_TABLE,
        FilterExpression: 'candidateId = :cid AND stageId = :sid',
        ExpressionAttributeValues: marshall({ ':cid': candidateId, ':sid': stageId }),
        ProjectionExpression: 'id, ownerId',
      }));

      const activeAssessments = (assessmentItems ?? []).filter(item => !unmarshall(item)['_deleted']);

      const submittedIds = new Set<string>();
      if (activeAssessments.length > 0) {
        const aId = unmarshall(activeAssessments[0]!)['id'] as string;
        const { Items: subItems } = await dynamo.send(new ScanCommand({
          TableName: CHALLENGE_SUBMISSION_TABLE,
          FilterExpression: 'assessmentId = :aid',
          ExpressionAttributeValues: { ':aid': { S: aId } },
          ProjectionExpression: 'challengeId',
        }));

        for (const subItem of (subItems ?? [])) {
          const record = unmarshall(subItem);
          if (!record['_deleted']) {
            submittedIds.add(record['challengeId'] as string);
          }
        }
      }

      const hasUnsubmitted = challenges.some(c => !submittedIds.has(c['id'] as string));
      if (!hasUnsubmitted) continue;

      // This is the current stage — get challenge at `order`
      if (order >= challenges.length) {
        return { success: false, error: `Challenge at order ${order} not found` };
      }

      challengeId = challenges[order]!['id'] as string;

      if (activeAssessments.length > 0) {
        const assessment = unmarshall(activeAssessments[0]!);
        assessmentId = assessment['id'] as string;
        ownerId = (assessment['ownerId'] as string | undefined) ?? null;
      }
      break;
    }

    if (!challengeId) {
      return { success: false, error: 'Could not resolve challenge — all stages may be complete' };
    }

    if (!assessmentId) {
      return { success: false, error: 'No assessment found — call getStageConfig first' };
    }

    // ── 4. Duplicate check (same assessment + challenge) ───────────────────
    const { Items: existingItems } = await dynamo.send(new ScanCommand({
      TableName: CHALLENGE_SUBMISSION_TABLE,
      FilterExpression: 'assessmentId = :aid AND challengeId = :chid',
      ExpressionAttributeValues: marshall({ ':aid': assessmentId, ':chid': challengeId }),
      ProjectionExpression: 'id',
    }));

    const activeSubmissions = (existingItems ?? []).filter(item => !unmarshall(item)['_deleted']);

    if (activeSubmissions.length > 0) {
      return { success: false, error: 'Challenge already submitted' };
    }

    // ── 5. Create ChallengeSubmission ──────────────────────────────────────
    const challengeSubmissionId = randomUUID();
    const now = new Date().toISOString();

    // Parse submission JSON so it's stored as a DynamoDB Map (not a string).
    // The schema defines submission as a.json() which Amplify reads as a Map.
    let parsedSubmission: unknown = submission;
    try {
      parsedSubmission = JSON.parse(submission);
    } catch {
      // Keep as string if not valid JSON
    }

    const record: Record<string, unknown> = {
      id: challengeSubmissionId,
      assessmentId,
      challengeId,
      submission: parsedSubmission,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
      __typename: 'ChallengeSubmission',
    };

    if (ownerId) {
      record['ownerId'] = ownerId;
    }

    await dynamo.send(new PutItemCommand({
      TableName: CHALLENGE_SUBMISSION_TABLE,
      Item: marshall(record, { removeUndefinedValues: true }),
    }));

    console.log(`[submitChallengeResponse] Created ${challengeSubmissionId} for candidate ${candidateId}, challenge ${challengeId}`);

    return { success: true, challengeSubmissionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    console.error('[submitChallengeResponse] Error:', message);
    return { success: false, error: message };
  }
}
