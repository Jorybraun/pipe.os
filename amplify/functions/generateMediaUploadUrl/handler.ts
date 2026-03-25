/**
 * generateMediaUploadUrl Lambda Handler
 *
 * Called by the generateMediaUploadUrl AppSync mutation (publicApiKey auth).
 *
 * Given a candidateId + challengeId, validates the candidate exists in DynamoDB
 * and returns a presigned S3 PUT URL for the media file.
 *
 * The candidate uploads directly to S3 using the presigned URL — no proxy needed.
 * S3 path: candidate-submissions/{candidateId}/{challengeId}.webm
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppSyncResolverHandler } from 'aws-lambda';
import type { GenerateMediaUploadUrlArgs, GenerateMediaUploadUrlResult } from './types';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

const BUCKET = process.env.ASSET_BUCKET_NAME ?? 'pipeAssets';
const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME ?? 'Candidate';
const URL_EXPIRY_SECONDS = 300; // 5 minutes — sufficient for a single upload

// Cold-start diagnostic — shows in CloudWatch to verify env vars are injected
console.log('[generateMediaUploadUrl] Config', {
  bucket: BUCKET,
  candidateTable: CANDIDATE_TABLE,
});

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0 && id.length < 128;
}

function isValidMimeType(mimeType: unknown): mimeType is string {
  return typeof mimeType === 'string' && /^(video|audio)\//.test(mimeType);
}

function isValidMediaType(mediaType: unknown): mediaType is 'video' | 'audio' {
  return mediaType === 'video' || mediaType === 'audio';
}

export const handler: AppSyncResolverHandler<
  GenerateMediaUploadUrlArgs,
  GenerateMediaUploadUrlResult | null
> = async (event) => {
  const { candidateId, challengeId, mimeType, mediaType } = event.arguments;

  // Input validation
  if (!isValidId(candidateId)) {
    console.error('[generateMediaUploadUrl] Invalid candidateId');
    return null;
  }
  if (!isValidId(challengeId)) {
    console.error('[generateMediaUploadUrl] Invalid challengeId');
    return null;
  }
  if (!isValidMimeType(mimeType)) {
    console.error('[generateMediaUploadUrl] Invalid mimeType:', mimeType);
    return null;
  }
  if (!isValidMediaType(mediaType)) {
    console.error('[generateMediaUploadUrl] Invalid mediaType:', mediaType);
    return null;
  }

  // Validate candidateId exists — prevents issuing URLs for phantom candidates
  let candidateItem;
  try {
    const { Item } = await dynamo.send(new GetItemCommand({
      TableName: CANDIDATE_TABLE,
      Key: { id: { S: candidateId } },
      ProjectionExpression: 'id',
    }));
    candidateItem = Item;
  } catch (err) {
    console.error('[generateMediaUploadUrl] DynamoDB GetItem error:', err);
    console.error('[generateMediaUploadUrl] Table name used:', CANDIDATE_TABLE);
    return null;
  }

  if (!candidateItem) {
    console.error('[generateMediaUploadUrl] candidateId not found:', candidateId);
    console.error('[generateMediaUploadUrl] Table name used:', CANDIDATE_TABLE);
    return null;
  }

  // Derive S3 key — scoped to candidate + challenge for easy querying
  const s3Key = `candidate-submissions/${candidateId}/${challengeId}.webm`;

  // Generate presigned PUT URL
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    ContentType: mimeType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: URL_EXPIRY_SECONDS });

  console.log('[generateMediaUploadUrl] Issued presigned URL', {
    candidateId,
    challengeId,
    s3Key,
    mediaType,
  });

  return { uploadUrl, s3Key };
};
