/**
 * Lightweight AppSync IAM caller.
 *
 * Uses Node.js built-in `crypto` and `fetch` (Node 18+) with AWS Signature
 * Version 4 to call an AppSync GraphQL endpoint from a Lambda function.
 * No external signing libraries required — only `node:crypto`.
 *
 * The Lambda must have IAM permission to call the AppSync API (appsync:GraphQL).
 * In Amplify Gen 2 this is granted via:
 *   backend.data.resources.graphqlApi.grantMutation(lambda)
 */

import { createHash, createHmac } from 'node:crypto';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * Execute a GraphQL mutation/query against an AppSync endpoint using IAM auth.
 *
 * Reads AWS credentials from the Lambda execution environment:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
 */
export async function callAppSync<T>(
  endpoint: string,
  document: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? '';
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  const url = new URL(endpoint);
  const host = url.hostname;
  const path = url.pathname;
  const service = 'appsync';

  const body = JSON.stringify({ query: document, variables });

  // Timestamps
  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z'; // yyyyMMddTHHmmssZ
  const dateStamp = amzDate.slice(0, 8); // yyyyMMdd

  // Build canonical headers
  const headersToSign: Record<string, string> = {
    'content-type': 'application/json',
    host,
    'x-amz-date': amzDate,
  };
  if (sessionToken) {
    headersToSign['x-amz-security-token'] = sessionToken;
  }

  const sortedHeaderKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders =
    sortedHeaderKeys.map((k) => `${k}:${headersToSign[k]}`).join('\n') + '\n';
  const signedHeadersList = sortedHeaderKeys.join(';');

  const payloadHash = sha256Hex(body);

  const canonicalRequest = [
    'POST',
    path,
    '', // no query string
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join('\n');

  // String to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // Derive signing key
  const signingKey = hmacSha256(
    hmacSha256(
      hmacSha256(hmacSha256(`AWS4${secretAccessKey}`, dateStamp), region),
      service
    ),
    'aws4_request'
  );
  const signature = hmacSha256(signingKey, stringToSign).toString('hex');

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeadersList}`,
    `Signature=${signature}`,
  ].join(', ');

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-amz-date': amzDate,
    Authorization: authorization,
  };
  if (sessionToken) {
    requestHeaders['x-amz-security-token'] = sessionToken;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: requestHeaders,
    body,
  });

  if (!response.ok) {
    throw new Error(
      `AppSync request failed: ${response.status} ${response.statusText}`
    );
  }

  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`AppSync error: ${json.errors[0].message}`);
  }

  return json.data as T;
}
