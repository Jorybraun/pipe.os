/**
 * resetCandidateToken.ts
 *
 * Resets a claimed invite token so it can be reused for testing.
 * Also resets candidate status to INVITED and deletes associated assessments.
 *
 * Accepts either:
 *   - A token string (looks for CLAIMED::{token} in DynamoDB)
 *   - A candidate ID (direct lookup)
 *
 * Usage:
 *   npx tsx scripts/resetCandidateToken.ts <token-or-candidateId>
 *
 * Uses E2E_EMAIL / E2E_PASSWORD from .env.local (or env vars).
 *
 * Requirements:
 *   - `npx ampx sandbox` running (or sandbox deployed)
 *   - amplify_outputs.json at repo root
 */

import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { signIn, signOut } from 'aws-amplify/auth';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Schema } from '../amplify/data/resource';

// Load .env.local if available
try {
  const envPath = join(process.cwd(), '.env.local');
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && match[1] && match[2]) {
      const key = match[1].trim();
      const val = match[2].trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch { /* no .env.local — use env vars */ }

const outputs = JSON.parse(
  readFileSync(join(process.cwd(), 'amplify_outputs.json'), 'utf8'),
) as unknown;
Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0]);

const client = generateClient<Schema>();

const input = process.argv[2];
if (!input) {
  console.error('Usage: npx tsx scripts/resetCandidateToken.ts <token-or-candidateId>');
  console.error('  token: the original invite token (before CLAIMED:: prefix)');
  console.error('  candidateId: the DynamoDB candidate ID');
  process.exit(1);
}

const username = process.env['E2E_EMAIL'];
const password = process.env['E2E_PASSWORD'];
if (!username || !password) {
  console.error('E2E_EMAIL and E2E_PASSWORD must be set (in .env.local or env vars)');
  process.exit(1);
}

console.log('[reset] Signing in...');
await signIn({ username, password });
console.log('[reset] Authenticated');

try {
  // Find the candidate — try by ID first, then by token
  let candidateId: string | null = null;
  let originalToken: string | null = null;

  // Check if input looks like a UUID (candidateId)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);

  if (isUUID) {
    // Direct ID lookup
    const { data: candidate, errors } = await client.models.Candidate.get({ id: input });
    if (errors) throw new Error(errors[0]?.message ?? 'Candidate lookup failed');
    if (!candidate) throw new Error(`No candidate found with ID: ${input}`);

    candidateId = candidate.id;
    const storedToken = candidate.inviteToken;
    originalToken = storedToken.startsWith('CLAIMED::')
      ? storedToken.replace('CLAIMED::', '')
      : storedToken;
    console.log(`[reset] Found candidate ${candidateId} (token: ${originalToken})`);
  } else {
    // Token search — try unclaimed first, then claimed
    originalToken = input;
    for (const tokenVariant of [input, `CLAIMED::${input}`]) {
      const { data: candidates, errors } = await client.models.Candidate.list({
        filter: { inviteToken: { eq: tokenVariant } },
      });
      if (errors) throw new Error(errors[0]?.message ?? 'Candidate search failed');
      if (candidates && candidates.length > 0) {
        const candidate = candidates[0]!;
        candidateId = candidate.id;
        const isClaimed = tokenVariant.startsWith('CLAIMED::');
        console.log(`[reset] Found candidate ${candidateId} (${isClaimed ? 'CLAIMED' : 'ACTIVE'})`);
        break;
      }
    }

    if (!candidateId) {
      // Last resort: check playwright fixture files for a matching candidateId
      console.error(`[reset] No candidate found with token: ${input}`);
      console.error('[reset] Try passing the candidateId (UUID) directly instead.');
      process.exit(1);
    }
  }

  // 1. Delete assessments for this candidate
  const { data: assessments } = await client.models.Assessment.list({
    filter: { candidateId: { eq: candidateId } },
  });

  if (assessments && assessments.length > 0) {
    for (const assessment of assessments) {
      await client.models.Assessment.delete({ id: assessment.id });
      console.log(`[reset]   Deleted Assessment ${assessment.id}`);
    }
  } else {
    console.log('[reset]   No assessments to delete');
  }

  // 2. Reset inviteToken and status
  const { errors: updateErrors } = await client.models.Candidate.update({
    id: candidateId,
    inviteToken: originalToken,
    status: 'INVITED',
  });

  if (updateErrors) throw new Error(updateErrors[0]?.message ?? 'Candidate update failed');

  console.log('[reset] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`[reset] Token reset: ${originalToken}`);
  console.log(`[reset] Status reset: INVITED`);
  console.log(`[reset] URL: /assess/${originalToken}`);
  console.log('[reset] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
} finally {
  await signOut();
  console.log('[reset] Signed out.');
}
