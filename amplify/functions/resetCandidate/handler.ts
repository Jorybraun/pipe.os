/**
 * resetCandidate Lambda Handler
 *
 * Hard-deletes all ChallengeSubmissions and CandidateMedia for a candidate,
 * resets Assessments to PENDING, and unclaims the invite token.
 *
 * Uses raw DynamoDB DeleteItem (not Amplify soft-delete) so records are
 * actually removed from the table.
 *
 * Authorization: authenticated (recruiter only)
 */

import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  DeleteItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME ?? 'Candidate';
const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME ?? 'Assessment';
const CHALLENGE_SUBMISSION_TABLE = process.env.CHALLENGE_SUBMISSION_TABLE_NAME ?? 'ChallengeSubmission';
const CANDIDATE_MEDIA_TABLE = process.env.CANDIDATE_MEDIA_TABLE_NAME ?? 'CandidateMedia';

interface ResetResult {
  success: boolean;
  error?: string;
}

export async function handler(event: unknown): Promise<ResetResult> {
  try {
    const args = (event as Record<string, unknown>)['arguments'] as Record<string, unknown> | undefined;
    const candidateId = typeof args?.['candidateId'] === 'string'
      ? args['candidateId'].trim()
      : '';

    if (!candidateId) {
      return { success: false, error: 'VALIDATION: candidateId is required' };
    }

    console.log(`[resetCandidate] Starting reset for candidate ${candidateId}`);

    // ── 1. Fetch Candidate to get inviteToken ────────────────────────────
    const { Item: candidateItem } = await dynamo.send(new GetItemCommand({
      TableName: CANDIDATE_TABLE,
      Key: marshall({ id: candidateId }),
      ProjectionExpression: 'id, inviteToken',
    }));

    if (!candidateItem) {
      return { success: false, error: 'Candidate not found' };
    }

    const candidate = unmarshall(candidateItem);
    const rawToken = (candidate['inviteToken'] as string) ?? '';
    const originalToken = rawToken.replace(/^CLAIMED::/, '');

    // ── 2. Find and process all Assessments ──────────────────────────────
    const { Items: assessmentItems } = await dynamo.send(new ScanCommand({
      TableName: ASSESSMENT_TABLE,
      FilterExpression: 'candidateId = :cid',
      ExpressionAttributeValues: marshall({ ':cid': candidateId }),
      ProjectionExpression: 'id',
    }));

    let deletedSubmissions = 0;

    for (const assessmentItem of (assessmentItems ?? [])) {
      const assessmentId = unmarshall(assessmentItem)['id'] as string;

      // ── 2a. Hard-delete all ChallengeSubmissions for this Assessment ──
      const { Items: submissionItems } = await dynamo.send(new ScanCommand({
        TableName: CHALLENGE_SUBMISSION_TABLE,
        FilterExpression: 'assessmentId = :aid',
        ExpressionAttributeValues: marshall({ ':aid': assessmentId }),
        ProjectionExpression: 'id',
      }));

      for (const subItem of (submissionItems ?? [])) {
        const subId = unmarshall(subItem)['id'] as string;
        await dynamo.send(new DeleteItemCommand({
          TableName: CHALLENGE_SUBMISSION_TABLE,
          Key: marshall({ id: subId }),
        }));
        deletedSubmissions++;
      }

      // ── 2b. Reset Assessment to PENDING ───────────────────────────────
      await dynamo.send(new UpdateItemCommand({
        TableName: ASSESSMENT_TABLE,
        Key: marshall({ id: assessmentId }),
        UpdateExpression: 'SET #s = :status REMOVE score, completedAt',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: marshall({ ':status': 'PENDING' }),
      }));
    }

    // ── 3. Hard-delete all CandidateMedia ────────────────────────────────
    const { Items: mediaItems } = await dynamo.send(new ScanCommand({
      TableName: CANDIDATE_MEDIA_TABLE,
      FilterExpression: 'candidateId = :cid',
      ExpressionAttributeValues: marshall({ ':cid': candidateId }),
      ProjectionExpression: 'id',
    }));

    let deletedMedia = 0;
    for (const mediaItem of (mediaItems ?? [])) {
      const mediaId = unmarshall(mediaItem)['id'] as string;
      await dynamo.send(new DeleteItemCommand({
        TableName: CANDIDATE_MEDIA_TABLE,
        Key: marshall({ id: mediaId }),
      }));
      deletedMedia++;
    }

    // ── 4. Reset Candidate ───────────────────────────────────────────────
    await dynamo.send(new UpdateItemCommand({
      TableName: CANDIDATE_TABLE,
      Key: marshall({ id: candidateId }),
      UpdateExpression: 'SET inviteToken = :token, #s = :status REMOVE currentStageId',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall({
        ':token': originalToken,
        ':status': 'INVITED',
      }),
    }));

    console.log(`[resetCandidate] Done: ${deletedSubmissions} submissions, ${deletedMedia} media deleted, ${(assessmentItems ?? []).length} assessments reset`);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    console.error('[resetCandidate] Error:', message);
    return { success: false, error: message };
  }
}
