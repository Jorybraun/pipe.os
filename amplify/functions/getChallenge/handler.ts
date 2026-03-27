/**
 * getChallenge Lambda Handler
 *
 * Returns the content for a single challenge identified by position (order),
 * not by database ID. Resolves the real challenge server-side.
 *
 * Security:
 *   - No database IDs in input or output
 *   - No serverConfig, groundTruth, or groundTruthAnnotations returned
 *   - Only returns public challenge data needed for rendering
 */

import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME ?? 'Candidate';
const STAGE_TABLE = process.env.STAGE_TABLE_NAME ?? 'Stage';
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE_NAME ?? 'Challenge';
const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME ?? 'Assessment';
const CHALLENGE_SUBMISSION_TABLE = process.env.CHALLENGE_SUBMISSION_TABLE_NAME ?? 'ChallengeSubmission';

interface ChallengeResult {
  type?: string;
  title?: string;
  instructions?: string;
  config?: unknown;
  cachedDiffJson?: unknown;
  githubPrTitle?: string;
  githubPrNumber?: number;
  githubRepoUrl?: string;
  githubPrDescription?: string;
  codeArtifact?: unknown;
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

/**
 * Resolves the candidate's current stage — the first stage with un-submitted challenges.
 * Returns the stage record and its sorted challenges.
 */
async function resolveCurrentStage(candidateId: string, pipelineId: string): Promise<{
  stageId: string;
  challenges: Record<string, unknown>[];
} | null> {
  const { Items: stageItemsFull } = await dynamo.send(new ScanCommand({
    TableName: STAGE_TABLE,
    FilterExpression: 'pipelineId = :pid',
    ExpressionAttributeValues: { ':pid': { S: pipelineId } },
  }));

  const stages = (stageItemsFull ?? [])
    .map(item => unmarshall(item) as Record<string, unknown>)
    .sort((a, b) => ((a['order'] as number) ?? 0) - ((b['order'] as number) ?? 0));

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

    // Check submissions
    const { Items: assessmentItems } = await dynamo.send(new ScanCommand({
      TableName: ASSESSMENT_TABLE,
      FilterExpression: 'candidateId = :cid AND stageId = :sid',
      ExpressionAttributeValues: marshall({ ':cid': candidateId, ':sid': stageId }),
      ProjectionExpression: 'id',
    }));

    const activeAssessments = (assessmentItems ?? []).filter(item => !unmarshall(item)['_deleted']);

    const submittedIds = new Set<string>();
    if (activeAssessments.length > 0) {
      const assessmentId = unmarshall(activeAssessments[0]!)['id'] as string;
      const { Items: subItems } = await dynamo.send(new ScanCommand({
        TableName: CHALLENGE_SUBMISSION_TABLE,
        FilterExpression: 'assessmentId = :aid',
        ExpressionAttributeValues: { ':aid': { S: assessmentId } },
        ProjectionExpression: 'challengeId',
      }));

      for (const subItem of (subItems ?? [])) {
        const record = unmarshall(subItem);
        if (!record['_deleted']) {
          submittedIds.add(record['challengeId'] as string);
        }
      }
    }

    // Check if any challenge is un-submitted
    const hasUnsubmitted = challenges.some(c => !submittedIds.has(c['id'] as string));
    if (hasUnsubmitted) {
      return { stageId, challenges };
    }
  }

  return null;
}

export async function handler(event: unknown): Promise<ChallengeResult> {
  try {
    const eventObj = event as Record<string, unknown>;
    const args = eventObj['arguments'] as Record<string, unknown> | undefined;

    const order = typeof args?.['order'] === 'number'
      ? args['order']
      : parseInt(String(args?.['order'] ?? ''), 10);

    if (isNaN(order) || order < 0) {
      return { error: 'VALIDATION: order must be a non-negative integer' };
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
        return { error: 'VALIDATION: inviteToken is required' };
      }

      const { Items, Count } = await dynamo.send(new ScanCommand({
        TableName: CANDIDATE_TABLE,
        FilterExpression: 'inviteToken = :token',
        ExpressionAttributeValues: { ':token': { S: inviteToken } },
        ProjectionExpression: 'id, pipelineId',
      }));

      if (!Items || Count === 0 || !Items[0]) {
        return { error: 'Invalid invite token' };
      }

      candidateId = unmarshall(Items[0])['id'] as string;
    }

    // ── 2. Get pipelineId ──────────────────────────────────────────────────
    const { Item: candidateItem } = await dynamo.send(new GetItemCommand({
      TableName: CANDIDATE_TABLE,
      Key: marshall({ id: candidateId }),
      ProjectionExpression: 'pipelineId',
    }));

    if (!candidateItem) {
      return { error: 'Candidate not found' };
    }

    const pipelineId = unmarshall(candidateItem)['pipelineId'] as string;

    // ── 3. Resolve current stage + get challenge at position ───────────────
    const currentStage = await resolveCurrentStage(candidateId, pipelineId);
    if (!currentStage) {
      return { error: 'All challenges complete' };
    }

    if (order >= currentStage.challenges.length) {
      return { error: `Challenge at order ${order} not found (stage has ${currentStage.challenges.length} challenges)` };
    }

    const challenge = currentStage.challenges[order]!;

    // ── 4. Build response DTO — public data only ───────────────────────────
    let config: unknown = null;
    if (challenge['config']) {
      try {
        config = typeof challenge['config'] === 'string'
          ? JSON.parse(challenge['config'])
          : challenge['config'];
      } catch { /* keep null */ }
    }

    let cachedDiffJson: unknown = null;
    if (challenge['cachedDiffJson']) {
      try {
        cachedDiffJson = typeof challenge['cachedDiffJson'] === 'string'
          ? JSON.parse(challenge['cachedDiffJson'])
          : challenge['cachedDiffJson'];
      } catch { /* keep null */ }
    }

    // TODO: fetch CodeArtifact if codeArtifactId is present (needs CODE_ARTIFACT_TABLE)

    console.log(`[getChallenge] Returning challenge order=${order} type=${challenge['type']} for candidate ${candidateId}`);

    return {
      type: (challenge['type'] as string) ?? undefined,
      title: (challenge['title'] as string) ?? undefined,
      instructions: (challenge['instructions'] as string) ?? undefined,
      config,
      cachedDiffJson,
      githubPrTitle: (challenge['githubPrTitle'] as string) ?? undefined,
      githubPrNumber: (challenge['githubPrNumber'] as number) ?? undefined,
      githubRepoUrl: (challenge['githubRepoUrl'] as string) ?? undefined,
      githubPrDescription: (challenge['githubPrDescription'] as string) ?? undefined,
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    console.error('[getChallenge] Error:', message);
    return { error: message };
  }
}
