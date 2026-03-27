/**
 * getStageConfig Lambda Handler
 *
 * Returns the current stage's rendering config + challenge type list for a candidate.
 * No challenge content, no database IDs — only what the client needs to build the component tree.
 *
 * Server-side logic:
 * 1. Resolve candidateId from inviteToken / session JWT
 * 2. Walk stages in order, find the first with un-submitted challenges
 * 3. Return stage metadata + challenge types/orders + currentIndex
 * 4. Create Assessment for the stage if it doesn't exist
 * 5. Return { isComplete: true } when all stages are done
 */

import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'node:crypto';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME ?? 'Candidate';
const STAGE_TABLE = process.env.STAGE_TABLE_NAME ?? 'Stage';
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE_NAME ?? 'Challenge';
const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME ?? 'Assessment';
const CHALLENGE_SUBMISSION_TABLE = process.env.CHALLENGE_SUBMISSION_TABLE_NAME ?? 'ChallengeSubmission';

interface StageConfigResult {
  isComplete: boolean;
  stageTitle?: string;
  mode?: string;
  timeLimit?: number | null;
  videoConfig?: unknown;
  challenges?: Array<{ type: string; order: number }>;
  currentIndex?: number;
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

export async function handler(event: unknown): Promise<StageConfigResult> {
  try {
    const eventObj = event as Record<string, unknown>;
    const args = eventObj['arguments'] as Record<string, unknown> | undefined;

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
        return { isComplete: false, error: 'VALIDATION: inviteToken is required' };
      }

      const { Items, Count } = await dynamo.send(new ScanCommand({
        TableName: CANDIDATE_TABLE,
        FilterExpression: 'inviteToken = :token',
        ExpressionAttributeValues: { ':token': { S: inviteToken } },
        ProjectionExpression: 'id',
      }));

      if (!Items || Count === 0 || !Items[0]) {
        return { isComplete: false, error: 'Invalid invite token' };
      }

      candidateId = unmarshall(Items[0])['id'] as string;
    }

    // ── 2. Look up candidate → pipelineId + ownerId ────────────────────────
    const { Item: candidateItem } = await dynamo.send(new GetItemCommand({
      TableName: CANDIDATE_TABLE,
      Key: marshall({ id: candidateId }),
      ProjectionExpression: 'id, pipelineId, #o',
      ExpressionAttributeNames: { '#o': 'owner' },
    }));

    if (!candidateItem) {
      return { isComplete: false, error: 'Candidate not found' };
    }

    const candidate = unmarshall(candidateItem);
    const pipelineId = candidate['pipelineId'] as string;
    const ownerId = (candidate['owner'] as string | undefined) ?? null;

    // ── 3. Fetch all stages for this pipeline ──────────────────────────────
    const { Items: stageItemsFull } = await dynamo.send(new ScanCommand({
      TableName: STAGE_TABLE,
      FilterExpression: 'pipelineId = :pid',
      ExpressionAttributeValues: { ':pid': { S: pipelineId } },
    }));

    const stages = (stageItemsFull ?? [])
      .map(item => unmarshall(item) as Record<string, unknown>)
      .sort((a, b) => ((a['order'] as number) ?? 0) - ((b['order'] as number) ?? 0));

    if (stages.length === 0) {
      return { isComplete: true };
    }

    // ── 4. Walk stages, find current one (first with un-submitted challenges)
    for (const stage of stages) {
      const stageId = stage['id'] as string;

      // Fetch challenges for this stage
      const { Items: challengeItems } = await dynamo.send(new ScanCommand({
        TableName: CHALLENGE_TABLE,
        FilterExpression: 'stageId = :sid',
        ExpressionAttributeValues: { ':sid': { S: stageId } },
      }));

      const challenges = (challengeItems ?? [])
        .map(item => unmarshall(item) as Record<string, unknown>)
        .sort((a, b) => ((a['order'] as number) ?? 0) - ((b['order'] as number) ?? 0));

      if (challenges.length === 0) continue;

      // Find or create Assessment
      let assessmentId: string | null = null;
      const { Items: assessmentItems } = await dynamo.send(new ScanCommand({
        TableName: ASSESSMENT_TABLE,
        FilterExpression: 'candidateId = :cid AND stageId = :sid',
        ExpressionAttributeValues: marshall({ ':cid': candidateId, ':sid': stageId }),
        ProjectionExpression: 'id',
      }));

      const activeAssessments = (assessmentItems ?? []).filter(item => !unmarshall(item)['_deleted']);

      if (activeAssessments.length > 0) {
        assessmentId = unmarshall(activeAssessments[0]!)['id'] as string;
      }

      // Get submitted challenge IDs
      const submittedChallengeIds = new Set<string>();
      if (assessmentId) {
        const { Items: subItems } = await dynamo.send(new ScanCommand({
          TableName: CHALLENGE_SUBMISSION_TABLE,
          FilterExpression: 'assessmentId = :aid',
          ExpressionAttributeValues: { ':aid': { S: assessmentId } },
          ProjectionExpression: 'challengeId',
        }));

        for (const subItem of (subItems ?? [])) {
          const record = unmarshall(subItem);
          if (!record['_deleted']) {
            submittedChallengeIds.add(record['challengeId'] as string);
          }
        }
      }

      // Find first un-submitted challenge index
      let currentIndex = -1;
      for (let i = 0; i < challenges.length; i++) {
        if (!submittedChallengeIds.has(challenges[i]!['id'] as string)) {
          currentIndex = i;
          break;
        }
      }

      // All challenges in this stage submitted — move to next stage
      if (currentIndex === -1) continue;

      // ── Found the current stage ────────────────────────────────────────
      // Create Assessment if it doesn't exist
      if (!assessmentId) {
        assessmentId = randomUUID();
        const now = new Date().toISOString();
        const assessmentItem: Record<string, { S: string }> = {
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
          assessmentItem['ownerId'] = { S: ownerId };
        }
        await dynamo.send(new PutItemCommand({
          TableName: ASSESSMENT_TABLE,
          Item: assessmentItem,
        }));
        console.log(`[getStageConfig] Created assessment ${assessmentId} for stage ${stageId}`);
      }

      // Update Candidate.currentStageId so Kanban reflects the active stage
      await dynamo.send(new UpdateItemCommand({
        TableName: CANDIDATE_TABLE,
        Key: marshall({ id: candidateId }),
        UpdateExpression: 'SET currentStageId = :sid',
        ExpressionAttributeValues: marshall({ ':sid': stageId }),
      }));

      // Build challenge type list (no IDs, no content)
      const challengeTypes = challenges.map((c, i) => ({
        type: (c['type'] as string) ?? 'QUIZ_MCQ',
        order: i,
      }));

      // Parse videoConfig
      let videoConfig: unknown = null;
      if (stage['videoConfig']) {
        try {
          videoConfig = typeof stage['videoConfig'] === 'string'
            ? JSON.parse(stage['videoConfig'])
            : stage['videoConfig'];
        } catch { /* keep null */ }
      }

      console.log(`[getStageConfig] Returning stage "${stage['title']}" with ${challenges.length} challenges, currentIndex=${currentIndex}`);

      return {
        isComplete: false,
        stageTitle: (stage['title'] as string) ?? 'Stage',
        mode: (stage['mode'] as string) ?? 'ASYNC',
        timeLimit: (stage['timeLimit'] as number) ?? null,
        videoConfig,
        challenges: challengeTypes,
        currentIndex,
      };
    }

    // ── All stages complete ──────────────────────────────────────────────
    console.log(`[getStageConfig] All stages complete for candidate ${candidateId}`);
    return { isComplete: true };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    console.error('[getStageConfig] Error:', message);
    return { isComplete: false, error: message };
  }
}
