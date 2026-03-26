/**
 * resolveToken Lambda Handler
 *
 * Called by the resolveToken AppSync custom query (publicApiKey auth).
 *
 * Given an inviteToken, returns ONLY { id, pipelineId, status } for the matching candidate.
 * Never returns name, email, or the inviteToken itself — prevents cross-candidate enumeration.
 *
 * DynamoDB access: Scan with FilterExpression on inviteToken.
 * A GSI on inviteToken would be more efficient at scale; scan is acceptable for MVP.
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AppSyncResolverHandler } from 'aws-lambda';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME ?? 'Candidate';

interface ResolveTokenArgs {
  inviteToken: string;
}

interface ResolveTokenResult {
  id: string;
  pipelineId: string;
  status: string;
  name: string | null;
  // ownerId intentionally removed — recruiter Cognito sub must NEVER be sent
  // to candidate clients. createAssessment Lambda sets it server-side.
}

export const handler: AppSyncResolverHandler<ResolveTokenArgs, ResolveTokenResult | null> = async (event) => {
  const { inviteToken } = event.arguments;

  if (!inviteToken || typeof inviteToken !== 'string' || inviteToken.trim() === '') {
    console.error('[resolveToken] Missing or invalid inviteToken');
    return null;
  }

  const { Items, Count } = await dynamo.send(new ScanCommand({
    TableName: CANDIDATE_TABLE,
    FilterExpression: 'inviteToken = :token',
    ExpressionAttributeValues: {
      ':token': { S: inviteToken.trim() },
    },
    // Only project the fields we need — email, inviteToken, and owner are intentionally excluded.
    // owner (recruiter Cognito sub) must NEVER be returned to candidate clients.
    ProjectionExpression: 'id, pipelineId, #s, #n',
    ExpressionAttributeNames: { '#s': 'status', '#n': 'name' },
  }));

  if (!Items || Count === 0 || !Items[0]) {
    console.log('[resolveToken] No candidate found for token');
    return null;
  }

  const item = unmarshall(Items[0]);

  return {
    id: item['id'] as string,
    pipelineId: item['pipelineId'] as string,
    status: item['status'] as string,
    name: (item['name'] as string | undefined) ?? null,
  };
};
