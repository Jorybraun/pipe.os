/**
 * resolveToken Lambda Handler
 *
 * Called by the resolveToken AppSync custom query (publicApiKey auth).
 *
 * Given an inviteToken:
 *   1. Validates it against DynamoDB
 *   2. Issues a short-lived JWT session token (2h)
 *   3. Claims the inviteToken (one-time use)
 *   4. Returns { id, pipelineId, status, name, sessionToken }
 *
 * The sessionToken is used by the client for all subsequent Lambda-authorized
 * API calls. The inviteToken cannot be reused after claiming.
 *
 * DynamoDB access: Scan with FilterExpression on inviteToken.
 * A GSI on inviteToken would be more efficient at scale; scan is acceptable for MVP.
 */

import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AppSyncResolverHandler } from 'aws-lambda';
import { signJwt } from '../_shared/jwt';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME ?? 'Candidate';
const SESSION_SECRET = process.env.SESSION_TOKEN_SECRET ?? '';

interface ResolveTokenArgs {
  inviteToken: string;
}

interface ResolveTokenResult {
  id: string;
  pipelineId: string;
  status: string;
  name: string | null;
  sessionToken: string | null;
}

export const handler: AppSyncResolverHandler<ResolveTokenArgs, ResolveTokenResult | null> = async (event) => {
  const { inviteToken } = event.arguments;

  if (!inviteToken || typeof inviteToken !== 'string' || inviteToken.trim() === '') {
    console.error('[resolveToken] Missing or invalid inviteToken');
    return null;
  }

  const trimmedToken = inviteToken.trim();

  // Reject already-claimed tokens
  if (trimmedToken.startsWith('CLAIMED::')) {
    console.log('[resolveToken] Token already claimed');
    return null;
  }

  const { Items, Count } = await dynamo.send(new ScanCommand({
    TableName: CANDIDATE_TABLE,
    FilterExpression: 'inviteToken = :token',
    ExpressionAttributeValues: {
      ':token': { S: trimmedToken },
    },
    // Only project the fields we need — email and owner are intentionally excluded.
    // owner (recruiter Cognito sub) must NEVER be returned to candidate clients.
    ProjectionExpression: 'id, pipelineId, #s, #n',
    ExpressionAttributeNames: { '#s': 'status', '#n': 'name' },
  }));

  if (!Items || Count === 0 || !Items[0]) {
    console.log('[resolveToken] No candidate found for token');
    return null;
  }

  const item = unmarshall(Items[0]);
  const candidateId = item['id'] as string;
  const pipelineId = item['pipelineId'] as string;

  // Issue session token (JWT)
  let sessionToken: string | null = null;
  if (SESSION_SECRET) {
    sessionToken = signJwt({ sub: candidateId, pid: pipelineId }, SESSION_SECRET);

    // Claim the inviteToken — one-time use. Preserves original for audit.
    try {
      await dynamo.send(new UpdateItemCommand({
        TableName: CANDIDATE_TABLE,
        Key: { id: { S: candidateId } },
        UpdateExpression: 'SET inviteToken = :claimed',
        // Only claim if the token hasn't been claimed by a concurrent request
        ConditionExpression: 'inviteToken = :original',
        ExpressionAttributeValues: {
          ':claimed': { S: `CLAIMED::${trimmedToken}` },
          ':original': { S: trimmedToken },
        },
      }));
    } catch (err) {
      // ConditionalCheckFailedException means another request claimed it first
      if ((err as Error).name === 'ConditionalCheckFailedException') {
        console.log('[resolveToken] Token was claimed by concurrent request');
        return null;
      }
      // Other errors — log but don't block (claiming is best-effort for MVP)
      console.error('[resolveToken] Failed to claim token:', err);
    }
  } else {
    console.warn('[resolveToken] SESSION_TOKEN_SECRET not configured — skipping JWT issuance');
  }

  return {
    id: candidateId,
    pipelineId,
    status: item['status'] as string,
    name: (item['name'] as string | undefined) ?? null,
    sessionToken,
  };
};
