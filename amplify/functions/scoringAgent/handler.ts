/**
 * scoringAgent Lambda Handler
 *
 * Triggered by the scoreAssessment AppSync mutation.
 *
 * Steps:
 * 1. Receive assessmentId
 * 2. Fetch Assessment from DynamoDB (submission + challengeId)
 * 3. Fetch linked Challenge from DynamoDB (serverConfig with ground truth)
 * 4. Run deterministic scoring algorithm based on challenge.type
 * 5. Update Assessment.score and Assessment.feedback
 * 6. Return { score, feedback }
 *
 * Scoring is deterministic (no Claude call) — see ADR-021.
 */

import { DynamoDBClient, GetItemCommand, UpdateItemCommand, ReturnValue } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { scorer } from './scorer';

// ─── Config ───────────────────────────────────────────────────────────────────

const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME ?? 'Assessment';
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE_NAME ?? 'Challenge';
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

const dynamo = new DynamoDBClient({ region: AWS_REGION });

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScoringResult {
  success: boolean;
  score: number;
  feedback?: string;
  error?: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: unknown): Promise<ScoringResult> => {
  console.log('[ScoringAgent] Invoked', { event: JSON.stringify(event) });

  try {
    // Extract assessmentId from AppSync event
    const args = (event as Record<string, unknown>)['arguments'] as Record<string, unknown> | undefined;
    const assessmentId = (args?.['assessmentId'] ?? (event as Record<string, unknown>)['assessmentId']) as string | undefined;

    if (!assessmentId || typeof assessmentId !== 'string') {
      throw new Error('VALIDATION: assessmentId is required');
    }

    console.log('[ScoringAgent] assessmentId:', assessmentId);

    // Step 2: Fetch Assessment
    const assessmentResponse = await dynamo.send(new GetItemCommand({
      TableName: ASSESSMENT_TABLE,
      Key: marshall({ id: assessmentId }),
    }));

    if (!assessmentResponse.Item) {
      throw new Error(`ASSESSMENT_NOT_FOUND: ${assessmentId}`);
    }

    const assessment = unmarshall(assessmentResponse.Item) as Record<string, unknown>;
    const challengeId = assessment['challengeId'] as string | undefined;
    const submissionRaw = assessment['submission'];

    if (!challengeId) {
      console.warn('[ScoringAgent] No challengeId on Assessment — cannot score');
      return { success: true, score: 0, feedback: 'No challenge linked to this assessment.' };
    }

    // Step 3: Fetch Challenge
    const challengeResponse = await dynamo.send(new GetItemCommand({
      TableName: CHALLENGE_TABLE,
      Key: marshall({ id: challengeId }),
    }));

    if (!challengeResponse.Item) {
      console.warn('[ScoringAgent] Challenge not found:', challengeId);
      return { success: true, score: 0, feedback: 'Challenge not found.' };
    }

    const challenge = unmarshall(challengeResponse.Item) as Record<string, unknown>;
    const challengeType = challenge['type'] as string | undefined;
    const serverConfigRaw = challenge['serverConfig'];

    if (!challengeType) {
      console.warn('[ScoringAgent] Challenge has no type');
      return { success: true, score: 0, feedback: 'Challenge type not set.' };
    }

    // Step 4: Parse submission and serverConfig
    let submission: unknown = submissionRaw;
    if (typeof submissionRaw === 'string') {
      try { submission = JSON.parse(submissionRaw); } catch { /* keep raw */ }
    }

    let serverConfig: unknown = serverConfigRaw;
    if (typeof serverConfigRaw === 'string') {
      try { serverConfig = JSON.parse(serverConfigRaw); } catch { /* keep raw */ }
    }

    if (!submission || !serverConfig) {
      console.warn('[ScoringAgent] Missing submission or serverConfig', { challengeType });
      return { success: true, score: 0, feedback: 'Submission or scoring config not available.' };
    }

    // Step 5: Run deterministic scorer
    const score = scorer(challengeType, submission, serverConfig);
    const feedback = buildFeedback(challengeType, score);

    console.log('[ScoringAgent] Score calculated', { assessmentId, challengeType, score });

    // Step 6: Update Assessment
    await dynamo.send(new UpdateItemCommand({
      TableName: ASSESSMENT_TABLE,
      Key: marshall({ id: assessmentId }),
      UpdateExpression: 'SET score = :score, feedback = :feedback, completedAt = :completedAt',
      ExpressionAttributeValues: marshall({
        ':score': score,
        ':feedback': feedback,
        ':completedAt': new Date().toISOString(),
      }),
      ReturnValues: ReturnValue.NONE,
    }));

    console.log('[ScoringAgent] Assessment updated', { assessmentId, score });

    return { success: true, score, feedback };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    console.error('[ScoringAgent] Error:', message);
    return { success: false, score: 0, error: message };
  }
};

// ─── Feedback Helper ──────────────────────────────────────────────────────────

function buildFeedback(challengeType: string, score: number): string {
  if (challengeType === 'CODE_REVIEW') {
    if (score >= 80) return 'Excellent code review — most issues identified with good severity accuracy.';
    if (score >= 60) return 'Good code review — caught the main issues. Some were missed or misclassified.';
    if (score >= 40) return 'Code review needs improvement — several issues were missed.';
    return 'Code review requires significant improvement — most issues were not identified.';
  }
  if (challengeType === 'QUIZ_MCQ') {
    return score === 100 ? 'Correct answer.' : 'Incorrect answer.';
  }
  return `Score: ${score}/100`;
}
