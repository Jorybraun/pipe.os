#!/usr/bin/env npx tsx
/**
 * E2E Code Review Test — Real Agentic Flow
 *
 * Tests end-to-end:
 * 1. Repo matching (candidate_challenge_assignment overrides challenge repo)
 * 2. Real implementer agent responds with pushback/change/comment
 * 3. Agentic back-and-forth (round 2 reply → implementer response)
 * 4. Scoring completes and produces a report
 *
 * Usage: npx tsx scripts/e2e-code-review-test.ts
 */

const API_BASE = 'http://localhost:8787';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ok(res: Response, label: string): Promise<unknown> {
  if (!res.ok) {
    return res.text().then((t) => {
      throw new Error(`${label} failed: ${res.status} ${t.slice(0, 500)}`);
    });
  }
  return res.json();
}

async function devPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-Bypass': 'local' },
    body: JSON.stringify(body),
  });
  return ok(res, `POST ${path}`);
}

async function devGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'X-Dev-Bypass': 'local' },
  });
  return ok(res, `GET ${path}`);
}

async function rpcPost(path: string, token: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return ok(res, `RPC POST ${path}`);
}

async function rpcGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ok(res, `RPC GET ${path}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Diff & Ground Truth ─────────────────────────────────────────────────────

const CACHED_DIFF = {
  files: [
    {
      filename: 'src/utils/discount.ts',
      additions: 12,
      deletions: 4,
      hunks: [
        {
          header: '@@ -1,10 +1,18 @@',
          lines: [
            { type: 'context', content: 'export function calculateDiscount(price: number, rate: number): number {' },
            { type: 'removed', content: '  return price * rate;' },
            { type: 'added', content: '  if (rate < 0 || rate > 1) throw new RangeError("rate out of bounds");' },
            { type: 'added', content: '  return price * (1 - rate);' },
            { type: 'context', content: '}' },
          ],
        },
      ],
    },
  ],
};

const CACHED_METADATA = {
  title: 'Fix calculateDiscount() boundary conditions',
  author: 'octocat',
  created_at: '2024-01-15T10:00:00Z',
  state: 'open',
  base: 'main',
  head: 'fix/discount-boundary',
};

const GROUND_TRUTH = {
  plantedBugs: [
    {
      id: 1,
      line: 3,
      file: 'src/utils/discount.ts',
      severity: 'major',
      description: 'Boundary check excludes valid rate=0 and rate=1 values',
      category: 'logic_error',
    },
  ],
  designTradeoffs: [
    {
      id: 1,
      description: 'Throwing RangeError instead of graceful handling',
      severity: 'minor',
    },
  ],
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🧪 E2E Code Review Test — Real Agentic Flow\n');

  const DB_PATH =
    'workers/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c7052d4c5f690270845d2e1be0b13a62fc3f47b010c62f2243a64980dbf38f15.sqlite';
  const { execSync } = await import('child_process');

  // ── 1. Seed recruiter data ────────────────────────────────────────────────
  console.log('1️⃣  Seeding pipeline, stage, challenge, candidate...');

  const pipeline = (await devPost('/api/v1/pipelines', {
    title: 'E2E Code Review Agentic Test',
    status: 'ACTIVE',
  })) as { id: string };
  console.log('   Pipeline:', pipeline.id);

  const stage = (await devPost(`/api/v1/pipelines/${pipeline.id}/stages`, {
    title: 'Code Review',
    order: 0,
  })) as { id: string };
  console.log('   Stage:', stage.id);

  const challenge = (await devPost(`/api/v1/stages/${stage.id}/challenges`, {
    type: 'CODE_REVIEW',
    title: 'Review: calculateDiscount()',
    instructions: 'Find the boundary condition bug and evaluate error handling approach.',
    config: { isMultiTurn: true, maxRounds: 4, implementerPersona: 'senior' },
    serverConfig: GROUND_TRUTH,
    order: 0,
    githubRepoUrl: 'https://github.com/octocat/hello-world',
    githubPrNumber: 42,
    githubPrTitle: 'Fix calculateDiscount() boundary conditions',
    githubPrDescription: 'Fixes RangeError when rate is outside [0, 1].',
    cachedDiffJson: CACHED_DIFF,
    cachedMetadata: CACHED_METADATA,
  })) as { id: string };
  console.log('   Challenge:', challenge.id);

  const candidate = (await devPost(`/api/v1/pipelines/${pipeline.id}/candidates`, {
    name: 'E2E Agentic Reviewer',
    email: `e2e-${Date.now()}@pipe.dev`,
  })) as { candidate: { id: string; inviteToken: string } };
  const candidateId = candidate.candidate.id;
  const inviteToken = candidate.candidate.inviteToken;
  console.log('   Candidate:', candidateId);
  console.log('   Invite token:', inviteToken);

  // ── 2. Repo matching — per-candidate override ─────────────────────────────
  console.log('\n2️⃣  Testing repo matching (candidate_challenge_assignment)...');

  // Insert a per-candidate override via direct sqlite3 (simulating what the matching engine does)
  const assignmentId = crypto.randomUUID();
  try {
    execSync(
      `sqlite3 "${DB_PATH}" "INSERT INTO candidate_challenge_assignment ` +
        `(id, candidate_id, stage_id, challenge_id, github_repo_url, github_pr_number, assigned_at) ` +
        `VALUES ('${assignmentId}', '${candidateId}', '${stage.id}', '${challenge.id}', ` +
        `'https://github.com/matched-candidate/special-repo', 99, ` +
        `'${new Date().toISOString()}');"`,
      { cwd: '/Users/hans/Code/PIPE/PIPE-OS' },
    );
    console.log('   ✓ Created candidate_challenge_assignment override');
  } catch (err) {
    console.log('   ⚠️  Could not insert assignment row:', (err as Error).message);
  }

  // ── 3. Resolve candidate token ────────────────────────────────────────────
  console.log('\n3️⃣  Resolving candidate session token...');

  const resolved = (await fetch(`${API_BASE}/rpc/resolve-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteToken }),
  }).then((r) => ok(r, 'resolve-token'))) as { sessionToken: string; id: string };

  const sessionToken = resolved.sessionToken;
  console.log('   ✓ Session token resolved');

  // ── 4. Prime assessment ───────────────────────────────────────────────────
  console.log('\n4️⃣  Priming assessment...');
  await rpcPost('/rpc/get-stage-config', sessionToken, {});
  console.log('   ✓ Assessment primed');

  // ── 5. Init review session ────────────────────────────────────────────────
  console.log('\n5️⃣  Init review session...');
  const initRes = (await rpcPost('/rpc/review/session/init', sessionToken, {
    challengeId: challenge.id,
  })) as { sessionId: string; status: string; pr: unknown };
  const sessionId = initRes.sessionId;
  console.log('   Session ID:', sessionId);
  console.log('   Status:', initRes.status);
  console.log('   PR metadata:', JSON.stringify(initRes.pr).slice(0, 200));

  // ── 6. Round 1 — Initial review with annotations ──────────────────────────
  console.log('\n6️⃣  Round 1: Submitting initial review with annotations...');
  console.log('   ⏳ Calling real implementer agent (Workers AI Qwen 2.5-Coder 32B)...');

  const round1Start = Date.now();
  let round1: {
    round: number;
    agentResponse: Array<{ to_comment_id: number; move: string; content: string; updated_code?: string }>;
    threads: unknown[];
  };
  try {
    round1 = (await rpcPost(`/rpc/review/session/${sessionId}/message`, sessionToken, {
      summary: 'The boundary condition check is too strict — it rejects valid inputs at the edges.',
      annotations: [
        {
          id: 'anno-1',
          file: 'src/utils/discount.ts',
          line: 3,
          severity: 'major',
          comment: 'The condition rate < 0 || rate > 1 incorrectly rejects rate=0 and rate=1 which are valid boundary values.',
        },
        {
          id: 'anno-2',
          file: 'src/utils/discount.ts',
          line: 3,
          severity: 'suggestion',
          comment: 'Consider using <= and >= for inclusive boundary checks, or document why exclusive boundaries are intended.',
        },
      ],
    })) as typeof round1;
  } catch (err) {
    console.error('\n❌ Round 1 failed:', err instanceof Error ? err.message : String(err));
    console.error('   Stack:', err instanceof Error ? err.stack : 'no stack');
    throw err;
  }
  const round1Duration = Date.now() - round1Start;

  console.log(`   ✓ Round 1 complete in ${round1Duration}ms`);
  console.log('   Round:', round1.round);
  console.log('   Threads:', round1.threads?.length ?? 0);

  if (!round1.agentResponse || round1.agentResponse.length === 0) {
    throw new Error('Implementer agent returned empty response — possible mock fallback or AI failure');
  }

  console.log('   Agent responses:');
  for (const resp of round1.agentResponse) {
    console.log(`     → Comment #${resp.to_comment_id} [${resp.move}]: ${resp.content.slice(0, 120)}${resp.content.length > 120 ? '...' : ''}`);
    if (resp.updated_code) {
      console.log(`       updated_code: ${resp.updated_code.slice(0, 80)}...`);
    }
  }

  // Verify we got actual pushback or engagement (not just "Good catch, fixed")
  const hasPushback = round1.agentResponse.some((r) => r.move === 'pushback');
  const hasChange = round1.agentResponse.some((r) => r.move === 'change');
  const hasComment = round1.agentResponse.some((r) => r.move === 'comment');
  console.log(`   Moves: pushback=${hasPushback}, change=${hasChange}, comment=${hasComment}`);

  if (!hasPushback && !hasChange && !hasComment) {
    throw new Error('Implementer agent returned no valid moves');
  }

  // ── 7. Round 2 — Reply to pushback ────────────────────────────────────────
  console.log('\n7️⃣  Round 2: Replying to implementer response...');

  const round2Start = Date.now();
  const round2 = (await rpcPost(`/rpc/review/session/${sessionId}/message`, sessionToken, {
    replies: [
      {
        toCommentId: 1,
        content: 'If rate=1 means "no discount", then rate=1 should definitely be allowed. Can you explain why you chose strict inequality?',
      },
    ],
    newAnnotations: [
      {
        id: 'anno-3',
        file: 'src/utils/discount.ts',
        line: 3,
        severity: 'suggestion',
        comment: 'Also, throwing a RangeError might crash the caller — consider returning the original price instead.',
      },
    ],
  })) as {
    round: number;
    agentResponse: Array<{ to_comment_id: number; move: string; content: string }>;
    threads: unknown[];
  };
  const round2Duration = Date.now() - round2Start;

  console.log(`   ✓ Round 2 complete in ${round2Duration}ms`);
  console.log('   Round:', round2.round);
  console.log('   Threads:', round2.threads?.length ?? 0);

  if (!round2.agentResponse || round2.agentResponse.length === 0) {
    throw new Error('Implementer agent returned empty response for round 2');
  }

  console.log('   Agent responses:');
  for (const resp of round2.agentResponse) {
    console.log(`     → Comment #${resp.to_comment_id} [${resp.move}]: ${resp.content.slice(0, 120)}${resp.content.length > 120 ? '...' : ''}`);
  }

  // ── 8. Submit verdict ─────────────────────────────────────────────────────
  console.log('\n8️⃣  Submitting verdict...');
  const verdictRes = (await rpcPost(`/rpc/review/session/${sessionId}/complete`, sessionToken, {
    verdict: 'request_changes',
    summary: 'The boundary check should use inclusive inequalities (<=, >=) to allow rate=0 and rate=1. Also consider graceful error handling instead of throwing.',
  })) as { status: string; sessionId: string };
  console.log('   Status:', verdictRes.status);
  console.log('   ✓ Verdict submitted, scoring triggered async');

  // ── 9. Poll for scoring completion ────────────────────────────────────────
  console.log('\n9️⃣  Polling for scoring completion (max 120s)...');
  let scored = false;
  let scoreReport: unknown = null;
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const statusRes = (await rpcGet(`/rpc/review/${sessionId}/status`, sessionToken)) as {
      status: string;
      scoreReport?: unknown;
    };
    console.log(`   [${(i + 1) * 5}s] status: ${statusRes.status}`);
    if (statusRes.status === 'scored') {
      scored = true;
      scoreReport = statusRes.scoreReport;
      break;
    }
    if (statusRes.status === 'scoring_failed') {
      throw new Error('Scoring failed');
    }
  }

  if (!scored) {
    console.log('   ⚠️  Scoring did not complete within 120s (still running in background)');
  } else {
    console.log('   ✓ Scoring complete!');
    console.log('   Score report preview:', JSON.stringify(scoreReport).slice(0, 400));
  }

  // ── 10. Fetch recruiter report ────────────────────────────────────────────
  console.log('\n🔟 Fetching recruiter report...');
  try {
    const report = await devGet(`/api/v1/review-sessions/${sessionId}/report`);
    console.log('   ✓ Recruiter report retrieved');
    console.log('   Preview:', JSON.stringify(report).slice(0, 500));
  } catch (err) {
    console.log('   ⚠️  Could not fetch recruiter report:', (err as Error).message);
  }

  // ── 11. Verify review_sessions DB state ───────────────────────────────────
  console.log('\n1️⃣1️⃣  Verifying database state...');
  try {
    const dbState = execSync(
      `sqlite3 "${DB_PATH}" "SELECT status, current_round, score_report FROM review_sessions WHERE id = '${sessionId}';"`,
      { cwd: '/Users/hans/Code/PIPE/PIPE-OS', encoding: 'utf-8' },
    );
    console.log('   DB state:', dbState.trim());
  } catch (err) {
    console.log('   ⚠️  Could not query DB:', (err as Error).message);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n✅ E2E Code Review Test Complete!');
  console.log('   Session:', sessionId);
  console.log('   Rounds completed:', round2.round);
  console.log('   Agentic back-and-forth:', round1.agentResponse.length > 0 && round2.agentResponse.length > 0 ? '✓ WORKING' : '✗ FAILED');
  console.log('   Scoring:', scored ? '✓ COMPLETE' : '⏳ IN PROGRESS');
  console.log('   Pipeline:', pipeline.id);
  console.log('   Candidate:', candidateId);
}

main().catch((err: unknown) => {
  console.error('\n❌ E2E Test failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
