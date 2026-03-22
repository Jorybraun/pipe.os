/**
 * createCodeReviewTestCandidate.ts
 *
 * Creates a fresh Pipeline + Stage + CODE_REVIEW Challenge + Candidate for
 * the Playwright happy-path BDD test (e2e/code-review-challenge.spec.ts).
 *
 * The Challenge has a pre-built cachedDiffJson so no GitHub PR fetch is needed
 * during the test run.
 *
 * Usage:
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=secret npx tsx scripts/createCodeReviewTestCandidate.ts
 *
 * Output: playwright/code-review-token.json
 */

import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { signIn, signOut } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const outputs = JSON.parse(readFileSync(join(process.cwd(), 'amplify_outputs.json'), 'utf8')) as unknown;
Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0]);

const client = generateClient<Schema>();

// ─── Pre-built diff (no GitHub fetch needed) ──────────────────────────────────
//
// Wire format expected by parseDiffJson() in ChallengeRegistry.tsx:
// uses `lineNumber` (not `num`), which parseDiffJson converts to `num` for DiffPanel.
//
// Bug: line 3 removes the "/ 100" division from the discount calculation.
// Ground truth pins line 3 as a critical logic error.

const CACHED_DIFF_JSON = {
  files: [
    {
      path: 'src/utils/calculateDiscount.js',
      status: 'modified',
      additions: 3,
      deletions: 2,
      hunks: [
        {
          header: '@@ -1,8 +1,9 @@',
          lines: [
            { type: 'context',  lineNumber: 1, content: 'function calculateDiscount(price, discountPercent) {' },
            { type: 'context',  lineNumber: 2, content: '  if (discountPercent < 0) return price;' },
            { type: 'deletion', lineNumber: 3, content: '  const discount = price * discountPercent / 100;' },
            { type: 'addition', lineNumber: 3, content: '  const discount = price * discountPercent;' },
            { type: 'context',  lineNumber: 4, content: '  const finalPrice = price - discount;' },
            { type: 'addition', lineNumber: 5, content: '  return finalPrice;' },
            { type: 'context',  lineNumber: 6, content: '}' },
          ],
        },
      ],
    },
  ],
};

const SERVER_CONFIG = {
  groundTruth: [
    {
      line: 3,
      type: 'logic_error',
      severity: 'critical',
      explanation: 'Missing division by 100 — discountPercent is applied as a raw multiplier instead of a percentage',
    },
  ],
};

const CACHED_METADATA = {
  prNumber: 99,
  branch: 'fix/discount-calc',
  base: 'main',
  author: 'dev-candidate',
  additions: 3,
  deletions: 2,
  filesChanged: 1,
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const username = process.env['E2E_EMAIL'];
  const password = process.env['E2E_PASSWORD'];

  if (!username || !password) {
    console.error('E2E_EMAIL and E2E_PASSWORD env vars are required');
    process.exit(1);
  }

  try {
    await signIn({ username, password });
    console.log('[createCodeReviewTestCandidate] Signed in');

    // Pipeline
    const { data: pipeline, errors: pipelineErrors } = await client.models.Pipeline.create({
      title: 'E2E Code Review Pipeline',
      status: 'ACTIVE',
      creationMode: 'BLANK',
    });
    if (pipelineErrors) throw new Error(pipelineErrors[0].message);
    if (!pipeline) throw new Error('Pipeline creation returned null');
    console.log('[createCodeReviewTestCandidate] Pipeline:', pipeline.id);

    // Stage
    const { data: stage, errors: stageErrors } = await client.models.Stage.create({
      pipelineId: pipeline.id,
      title: 'Code Review Stage',
      order: 0,
    });
    if (stageErrors) throw new Error(stageErrors[0].message);
    if (!stage) throw new Error('Stage creation returned null');
    console.log('[createCodeReviewTestCandidate] Stage:', stage.id);

    // Challenge (CODE_REVIEW with pre-cached diff)
    const { data: challenge, errors: challengeErrors } = await client.models.Challenge.create({
      stageId: stage.id,
      type: 'CODE_REVIEW',
      title: 'Review: calculateDiscount() refactor',
      instructions: 'Review the changes to calculateDiscount.js. Identify any bugs, select a verdict, and provide a summary of your findings.',
      order: 0,
      githubPrTitle: 'fix: simplify discount calculation',
      githubPrDescription: 'Refactors calculateDiscount to remove unnecessary intermediate variable.',
      cachedDiffJson: JSON.stringify(CACHED_DIFF_JSON),
      cachedMetadata: JSON.stringify(CACHED_METADATA),
      config: JSON.stringify({ version: 1 }),
      serverConfig: JSON.stringify(SERVER_CONFIG),
    });
    if (challengeErrors) throw new Error(challengeErrors[0].message);
    if (!challenge) throw new Error('Challenge creation returned null');
    console.log('[createCodeReviewTestCandidate] Challenge:', challenge.id);

    // Create 3 candidates — one per test (tests run in parallel; each needs its own token)
    const tokens: { token: string; candidateId: string; pipelineId: string; challengeId: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const inviteToken = `e2e-cr-${uuidv4().slice(0, 8)}`;
      const { data: candidate, errors: candidateErrors } = await client.models.Candidate.create({
        pipelineId: pipeline.id,
        name: `E2E Code Review Candidate ${i + 1}`,
        email: `e2e-cr-${Date.now()}-${i}@example.com`,
        inviteToken,
        status: 'INVITED',
      });
      if (candidateErrors) throw new Error(candidateErrors[0].message);
      if (!candidate) throw new Error('Candidate creation returned null');
      console.log(`[createCodeReviewTestCandidate] Candidate ${i + 1}:`, candidate.id);
      tokens.push({
        token: candidate.inviteToken ?? inviteToken,
        candidateId: candidate.id,
        pipelineId: candidate.pipelineId ?? pipeline.id,
        challengeId: challenge.id,
      });
    }

    // Legacy single-token field for backwards compat (first token)
    const output = { ...tokens[0], tokens };

    writeFileSync(
      join(process.cwd(), 'playwright/code-review-token.json'),
      JSON.stringify(output, null, 2)
    );

    console.log('[createCodeReviewTestCandidate] ✓ Wrote playwright/code-review-token.json');
    console.log('Tokens:', tokens.map(t => t.token));
  } finally {
    await signOut();
  }
}

main().catch((err: unknown) => {
  console.error('[createCodeReviewTestCandidate] Fatal error:', err);
  process.exit(1);
});
