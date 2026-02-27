/**
 * scripts/purgeTestData.ts
 *
 * One-time dev data reset. Deletes all Assessment and Candidate records.
 * Pre-launch only — no real user data exists (~5 test records).
 *
 * Assessments must be deleted BEFORE Candidates (FK reference order).
 *
 * Usage:
 *   PIPE_USERNAME=you@example.com PIPE_PASSWORD=yourpassword npx tsx scripts/purgeTestData.ts
 *
 * Requirements:
 *   - `npx ampx sandbox` must be running (or sandbox already deployed)
 *   - amplify_outputs.json must exist at repo root
 *   - Credentials must be a valid Cognito recruiter account (owner-auth required for delete)
 */

import { Amplify } from 'aws-amplify';
import { signIn, signOut } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const outputs = require('../amplify_outputs.json') as Record<string, unknown>;
Amplify.configure(outputs);

const client = generateClient<Schema>();

async function purgeAssessments(): Promise<number> {
  console.log('\n[purge] Fetching Assessment records...');
  let deleted = 0;
  let nextToken: string | undefined = undefined;

  do {
    const result = await client.models.Assessment.list({
      limit: 100,
      ...(nextToken ? { nextToken } : {}),
    });

    if (result.errors) {
      throw new Error(`[purge] List assessments failed: ${result.errors[0].message}`);
    }

    if (result.data.length === 0 && deleted === 0) {
      console.log('[purge]   No Assessment records found.');
      break;
    }

    for (const item of result.data) {
      const { errors } = await client.models.Assessment.delete({ id: item.id });
      if (errors) {
        throw new Error(`[purge] Delete assessment ${item.id} failed: ${errors[0].message}`);
      }
      console.log(`[purge]   ✓ Deleted Assessment ${item.id}`);
      deleted++;
    }

    nextToken = result.nextToken ?? undefined;
  } while (nextToken);

  return deleted;
}

async function purgeCandidates(): Promise<number> {
  console.log('\n[purge] Fetching Candidate records...');
  let deleted = 0;
  let nextToken: string | undefined = undefined;

  do {
    const result = await client.models.Candidate.list({
      limit: 100,
      ...(nextToken ? { nextToken } : {}),
    });

    if (result.errors) {
      throw new Error(`[purge] List candidates failed: ${result.errors[0].message}`);
    }

    if (result.data.length === 0 && deleted === 0) {
      console.log('[purge]   No Candidate records found.');
      break;
    }

    for (const item of result.data) {
      const { errors } = await client.models.Candidate.delete({ id: item.id });
      if (errors) {
        throw new Error(`[purge] Delete candidate ${item.id} failed: ${errors[0].message}`);
      }
      console.log(`[purge]   ✓ Deleted Candidate ${item.id} (${item.email ?? 'no email'})`);
      deleted++;
    }

    nextToken = result.nextToken ?? undefined;
  } while (nextToken);

  return deleted;
}

async function main(): Promise<void> {
  const username = process.env.PIPE_USERNAME;
  const password = process.env.PIPE_PASSWORD;

  if (!username || !password) {
    console.error('[purge] Error: PIPE_USERNAME and PIPE_PASSWORD env vars are required.');
    console.error('[purge] Usage:');
    console.error('[purge]   PIPE_USERNAME=you@example.com PIPE_PASSWORD=yourpassword npx tsx scripts/purgeTestData.ts');
    process.exit(1);
  }

  console.log('[purge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[purge]  Pipe — Dev Data Purge Script');
  console.log('[purge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[purge] WARNING: This will permanently delete all Candidate');
  console.log('[purge]          and Assessment records. Pre-launch use only.');
  console.log('[purge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`[purge] Signing in as ${username}...`);

  try {
    await signIn({ username, password });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[purge] Auth failed: ${message}`);
    console.error('[purge] Check that PIPE_USERNAME and PIPE_PASSWORD are correct Cognito credentials.');
    process.exit(1);
  }

  console.log('[purge] Authenticated ✓');

  try {
    // Always delete Assessments first — they reference Candidates
    const assessmentsDeleted = await purgeAssessments();
    const candidatesDeleted = await purgeCandidates();

    console.log('\n[purge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[purge] ✅ Purge complete.');
    console.log(`[purge]    Assessments deleted: ${assessmentsDeleted}`);
    console.log(`[purge]    Candidates deleted:  ${candidatesDeleted}`);
    console.log('[purge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } finally {
    await signOut();
    console.log('\n[purge] Signed out.');
  }
}

main().catch((err: unknown) => {
  console.error('[purge] Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
