/**
 * generateMediaUploadUrl Lambda Handler
 *
 * Called by the generateMediaUploadUrl AppSync mutation.
 *
 * Two auth paths:
 * 1. Lambda auth (preferred): candidateId from sessionAuthorizer resolverContext.
 * 2. publicApiKey (transition): candidateId from client argument (validated exists).
 *
 * Returns a presigned S3 PUT URL for the media file.
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
const URL_EXPIRY_SECONDS = 300; // 5 minutes

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
  const { challengeId, mimeType, mediaType } = event.arguments;

  // ── 1. Resolve candidateId ───────────────────────────────────────────────
  // Prefer resolverContext (Lambda auth) over client-supplied candidateId
  const identity = (event as unknown as Record<string, unknown>)['identity'] as Record<string, unknown> | undefined;
  const resolverContext = identity?.['resolverContext'] as Record<string, string> | undefined;
  const candidateId = resolverContext?.['candidateId'] ?? event.arguments.candidateId;

  // ── 2. Input validation ──────────────────────────────────────────────────
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

  // ── 3. Validate candidateId exists (prevents URLs for phantom candidates)
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
    return null;
  }

  if (!candidateItem) {
    console.error('[generateMediaUploadUrl] candidateId not found:', candidateId);
    return null;
  }

  // ── 4. Generate presigned PUT URL ────────────────────────────────────────
  const s3Key = `candidate-submissions/${candidateId}/${challengeId}.webm`;

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
