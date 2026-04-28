/**
 * Compact fixture specifications for build-fixtures.ts.
 */

export type Seniority = 'junior' | 'mid' | 'senior';

export interface CompactComment {
  id: number;
  file?: string;
  line?: number;
  category: string;
  severity: string;
  what: string;
  why: string;
  suggestion?: string;
  positive: boolean;
}

export interface CompactResponse {
  to_comment_id: number;
  move: 'comment' | 'change' | 'pushback';
  content: string;
  updated_code?: string;
}

export interface CompactRound {
  round: number;
  comments: CompactComment[];
  verdict?: { decision: 'approve' | 'request_changes' | 'reject'; summary: string };
  responses: CompactResponse[];
}

export interface CompactFixture {
  id: string;
  description: string;
  tags: string[];
  seniority: Seniority;
  prContext: {
    title: string;
    description: string;
    instructions: string;
    diff: string;
  };
  groundTruth: Array<{
    id: number;
    severity: 'critical' | 'major' | 'minor';
    file?: string;
    line?: number;
    description: string;
    expectedFound?: boolean;
  }>;
  rounds: CompactRound[];
  finalVerdict: { decision: 'approve' | 'request_changes' | 'reject'; summary: string };
  expectedBands: Record<string, { min: number; max: number; rationale: string }>;
  metadata?: {
    confidence: 'heuristic' | 'expert';
    persona?: 'strong' | 'adequate' | 'weak';
  };
}

// ─── JUNIOR FIXTURES (9 new + seed-001 = 10) ─────────────────────────────────

export const JUNIOR_FIXTURES: CompactFixture[] = [
  {
    id: 'seed-003-junior-react-effect-miss',
    description: 'Junior reviewer misses a critical useEffect missing dependency that causes stale closure, focuses on prop naming and indentation. Low bands on technical dimensions, especially revision_evaluation anchor.',
    tags: ['typescript', 'react', 'hooks', 'low-score-anchor', 'revision-evaluation-anchor'],
    seniority: 'junior',
    prContext: {
      title: 'Add auto-save hook for challenge editor',
      description: 'Adds a useAutoSave hook that debounces content changes and posts to /api/save every 2s. Used in the challenge code editor.',
      instructions: 'Review this hook for correctness and React best practices.',
      diff: `diff --git a/src/hooks/useAutoSave.ts b/src/hooks/useAutoSave.ts\n@@ -0,0 +1,32 @@\n+import { useEffect, useRef } from 'react';\n+\n+export function useAutoSave(content: string, onSave: (v: string) => void) {\n+  const lastSaved = useRef(content);\n+\n+  useEffect(() => {\n+    const timer = setTimeout(() => {\n+      if (content !== lastSaved.current) {\n+        onSave(content);\n+        lastSaved.current = content;\n+      }\n+    }, 2000);\n+    return () => clearTimeout(timer);\n+  }, []);\n+\n+  return { lastSaved: lastSaved.current };\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/hooks/useAutoSave.ts', line: 12, description: 'useEffect dependency array is empty [] — content and onSave are stale on subsequent renders. The timer will always compare against the initial content value and call onSave with stale data.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/hooks/useAutoSave.ts', line: 5, description: 'No cleanup on unmount race: if component unmounts during the API call, onSave may set state on an unmounted component. Need an AbortController or isMounted guard.', expectedFound: false },
      { id: 3, severity: 'minor', file: 'src/hooks/useAutoSave.ts', line: 16, description: 'return { lastSaved: lastSaved.current } returns a primitive string, not a ref. This is fine but misleading naming — lastSavedValue would be clearer.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 301, file: 'src/hooks/useAutoSave.ts', line: 16, category: 'style', severity: 'nit', what: 'The return key is named lastSaved but it returns a string, not a ref. Kinda confusing.', why: 'readability', positive: false },
          { id: 302, file: 'src/hooks/useAutoSave.ts', line: 1, category: 'style', severity: 'nit', what: 'Import order should be alphabetical.', why: 'consistency', positive: false },
          { id: 303, file: 'src/hooks/useAutoSave.ts', line: 5, category: 'positive', severity: 'nit', what: 'Nice use of useRef to track state.', why: '', positive: true },
        ],
        verdict: { decision: 'approve', summary: 'LGTM, just a small naming nit.' },
        responses: [
          { to_comment_id: 301, move: 'change', content: 'Good point, renamed to lastSavedValue.', updated_code: 'return { lastSavedValue: lastSaved.current };' },
          { to_comment_id: 302, move: 'comment', content: 'I think they are alphabetical already? useEffect before useRef.' },
          { to_comment_id: 303, move: 'comment', content: 'Thanks!' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'LGTM with the rename. Clean hook.' },
    expectedBands: {
      issue_identification: { min: 1, max: 2, rationale: 'Caught 0 of 3 planted bugs. Missed the critical stale-closure bug entirely. Only style nits. BARS level 1.' },
      prioritization: { min: 1, max: 2, rationale: 'Treated naming nit as equal priority to correctness. Approved with unfound critical bug. Level 1-2.' },
      revision_evaluation: { min: 1, max: 1, rationale: 'Reviewer accepted both responses without any verification. Never re-examined the code after the rename. Zero fix verification. Level 1.' },
      reasoning_quality: { min: 1, max: 2, rationale: 'One-word rationales (readability, consistency). No failure mechanism described. Level 1-2.' },
      question_formation: { min: 1, max: 2, rationale: 'Zero questions. Did not ask why dependency array was empty — the exact question that would surface the critical bug. Level 1.' },
      ai_direction: { min: 1, max: 2, rationale: 'No actionable guidance. The rename suggestion was cosmetic. Level 1-2.' },
    },
  },

  {
    id: 'seed-004-junior-input-validation-miss',
    description: 'Junior reviewer finds one input validation bug but misses SQL injection vector and race condition. Basic reasoning, accepts fixes without checking.',
    tags: ['typescript', 'node', 'api', 'low-mid-score'],
    seniority: 'junior',
    prContext: {
      title: 'Add candidate bulk import endpoint',
      description: 'POST /api/candidates/bulk accepts a CSV string, parses it, and inserts candidates into D1.',
      instructions: 'Review for security, correctness, and performance.',
      diff: `diff --git a/src/routes/candidates/bulkImport.ts b/src/routes/candidates/bulkImport.ts\n@@ -0,0 +1,45 @@\n+import { Hono } from 'hono';\n+import { parse } from 'csv-parse/sync';\n+\n+export const bulkRoutes = new Hono();\n+\n+bulkRoutes.post('/bulk', async (c) => {\n+  const { csv } = await c.req.json();\n+  const rows = parse(csv, { columns: true });\n+\n+  for (const row of rows) {\n+    await c.env.DB.prepare(\n+      'INSERT INTO candidates (name, email, pipeline_id) VALUES (?, ?, ?)'\n+    ).bind(row.name, row.email, row.pipeline_id).run();\n+  }\n+\n+  return c.json({ imported: rows.length });\n+});\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/routes/candidates/bulkImport.ts', line: 9, description: 'Raw user CSV is parsed without validation — row.name, row.email, row.pipeline_id are passed directly to SQL. Although parameterized, there is no length limit or schema validation, enabling a CSV with 1M rows to DOS the worker.', expectedFound: false },
      { id: 2, severity: 'major', file: 'src/routes/candidates/bulkImport.ts', line: 8, description: 'No input validation on csv field — missing check that csv is a string, non-empty, and within size limits.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/routes/candidates/bulkImport.ts', line: 10, description: 'Sequential await in a loop — N inserts for N rows. Should use batch insert or transaction.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/routes/candidates/bulkImport.ts', line: 14, description: 'Returns count but no per-row error details. Failed inserts are silently swallowed by D1 default behavior.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 401, file: 'src/routes/candidates/bulkImport.ts', line: 8, category: 'correctness', severity: 'suggestion', what: 'Should validate that csv is actually a string before parsing.', why: 'Could throw if csv is null', positive: false },
          { id: 402, file: 'src/routes/candidates/bulkImport.ts', line: 1, category: 'style', severity: 'nit', what: 'Import Hono from hono is fine but maybe use hono/hono?', why: 'convention', positive: false },
        ],
        verdict: { decision: 'approve', summary: 'Small validation fix needed, otherwise good.' },
        responses: [
          { to_comment_id: 401, move: 'change', content: 'Added typeof check.', updated_code: "if (typeof csv !== 'string' || csv.length === 0) return c.json({ error: 'invalid_csv' }, 400);" },
          { to_comment_id: 402, move: 'comment', content: 'The docs say hono is correct for Hono base.' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Validation added, looks good now.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 1 of 4 bugs (input validation). Missed DOS vector, N+1 insert loop, and error handling. Level 2-3.' },
      prioritization: { min: 2, max: 3, rationale: 'Found one real bug but also a style nit. Did not flag N+1 or DOS as blocking. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted the typeof fix without checking if it handles empty string or max length. Level 2-3.' },
      reasoning_quality: { min: 2, max: 3, rationale: 'Basic explanation for the validation bug. Style nit has no real rationale. Level 2-3.' },
      question_formation: { min: 1, max: 2, rationale: 'No questions asked. Level 1-2.' },
      ai_direction: { min: 2, max: 3, rationale: 'Suggested typeof check — actionable but minimal. Level 2-3.' },
    },
  },

  {
    id: 'seed-005-junior-type-safety-find',
    description: 'Junior reviewer finds a type-safety bug (any usage) and a logic error, but misses a race condition. Decent reasoning for junior level.',
    tags: ['typescript', 'types', 'mid-score'],
    seniority: 'junior',
    prContext: {
      title: 'Add candidate scoring utility',
      description: 'Adds a computeScore helper that averages review scores.',
      instructions: 'Review for correctness and type safety.',
      diff: `diff --git a/src/lib/scoring.ts b/src/lib/scoring.ts\n@@ -0,0 +1,28 @@\n+export function computeScore(scores: number[]): number {\n+  if (scores.length === 0) return 0;\n+  const sum = scores.reduce((a, b) => a + b, 0);\n+  return sum / scores.length;\n+}\n+\n+export async function computeScoreAsync(scores: number[]): Promise<number> {\n+  const cached = await getCache(scores.join(','));\n+  if (cached) return cached as any;\n+  const result = computeScore(scores);\n+  await setCache(scores.join(','), result);\n+  return result;\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'major', file: 'src/lib/scoring.ts', line: 8, description: 'cached returned as any — defeats type safety. Should parse/validate cached value.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/lib/scoring.ts', line: 7, description: 'No cache key normalization — scores [1,2] and [2,1] produce different cache keys but same statistical result. Wasteful and incorrect for unordered data.', expectedFound: false },
      { id: 3, severity: 'minor', file: 'src/lib/scoring.ts', line: 10, description: 'Missing error handling if setCache throws. Promise rejection will bubble unhandled.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 501, file: 'src/lib/scoring.ts', line: 8, category: 'correctness', severity: 'suggestion', what: 'Returning cached as any loses type safety.', why: 'We should validate the cached value is a number before returning.', positive: false },
          { id: 502, file: 'src/lib/scoring.ts', line: 3, category: 'correctness', severity: 'suggestion', what: 'computeScore returns 0 for empty array. Should this be NaN or null instead?', why: 'An empty array average is mathematically undefined.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Two suggestions to address before merge.' },
        responses: [
          { to_comment_id: 501, move: 'change', content: 'Good catch — added Number(cached) check.', updated_code: "if (cached !== null) return Number(cached);" },
          { to_comment_id: 502, move: 'comment', content: 'I think 0 is fine for our use case — the UI handles empty states separately.' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Type fix looks good. Keeping 0 for empty arrays per product spec.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 1 of 3 bugs (any cast). Missed cache key normalization and error handling. Level 2-3.' },
      prioritization: { min: 2, max: 3, rationale: 'Flagged type safety as suggestion, not blocking. Flagged empty array as suggestion. Reasonable for junior. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted Number(cached) fix without verifying it handles non-numeric strings. Accepted pushback on empty array without verifying product spec. Level 2-3.' },
      reasoning_quality: { min: 2, max: 3, rationale: 'Basic rationale for both comments. Some technical reasoning (type safety, math). Level 2-3.' },
      question_formation: { min: 2, max: 3, rationale: 'One implicit question about empty array behavior, but no explicit questions. Level 2-3.' },
      ai_direction: { min: 2, max: 3, rationale: 'Suggested Number(cached) — actionable but minimal. No guidance on cache key issue. Level 2-3.' },
    },
  },

  {
    id: 'seed-006-junior-react-prop-miss',
    description: 'Junior reviewer finds a prop-type issue but misses a significant performance problem with inline objects. Accepts pushback without question.',
    tags: ['typescript', 'react', 'mid-score'],
    seniority: 'junior',
    prContext: {
      title: 'Add candidate card component',
      description: 'Adds a CandidateCard component for the pipeline view.',
      instructions: 'Review for React best practices and TypeScript correctness.',
      diff: `diff --git a/src/components/CandidateCard.tsx b/src/components/CandidateCard.tsx\n@@ -0,0 +1,35 @@\n+interface CandidateCardProps {\n+  candidate: { id: string; name: string; score: number };\n+  onSelect: (id: string) => void;\n+}\n+\n+export function CandidateCard({ candidate, onSelect }: CandidateCardProps) {\n+  return (\n+    <div\n+      className=\"card\"\n+      onClick={() => onSelect(candidate.id)}\n+      style={{ backgroundColor: candidate.score > 80 ? 'green' : 'red' }}\n+    >\n+      <h3>{candidate.name}</h3>\n+      <span>Score: {candidate.score}</span>\n+    </div>\n+  );\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'major', file: 'src/components/CandidateCard.tsx', line: 9, description: 'Inline style object passed to style prop — creates a new object every render, causing unnecessary re-renders if parent is pure. Should use CSS class or memoized style.', expectedFound: false },
      { id: 2, severity: 'major', file: 'src/components/CandidateCard.tsx', line: 8, description: 'No accessibility — div with onClick is not keyboard-focusable. Should be a button or have role="button" + tabIndex + keydown handler.', expectedFound: true },
      { id: 3, severity: 'minor', file: 'src/components/CandidateCard.tsx', line: 6, description: 'Interface defined inline in same file — fine for small components but Candidate type should be imported from shared types.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 601, file: 'src/components/CandidateCard.tsx', line: 8, category: 'accessibility', severity: 'suggestion', what: 'This div with onClick is not accessible. Should use a button element.', why: 'Screen readers and keyboard users cannot interact with it.', positive: false },
          { id: 602, file: 'src/components/CandidateCard.tsx', line: 6, category: 'style', severity: 'nit', what: 'Candidate interface could be imported from types/candidate.ts.', why: 'avoid duplication', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Accessibility fix needed. Optional type refactor.' },
        responses: [
          { to_comment_id: 601, move: 'change', content: 'Changed to button with proper styling.', updated_code: "<button className='card' onClick={() => onSelect(candidate.id)}>" },
          { to_comment_id: 602, move: 'pushback', content: 'I kept it local since it is only used here. Importing adds indirection for a 3-field type.' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Accessibility fix looks good. Keeping local type is fine.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 1 of 3 bugs (a11y). Missed inline style performance issue and type duplication. Level 2-3.' },
      prioritization: { min: 2, max: 3, rationale: 'Accessibility flagged as suggestion not blocking. Style nit deprioritized correctly. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted button change without verifying styling. Caved on type pushback. Level 2-3.' },
      reasoning_quality: { min: 2, max: 3, rationale: 'Accessibility comment has concrete user impact. Type comment rationale is weak. Level 2-3.' },
      question_formation: { min: 1, max: 2, rationale: 'No clarifying questions. Level 1-2.' },
      ai_direction: { min: 2, max: 3, rationale: 'Suggested button element — actionable. No pushback on type issue. Level 2-3.' },
    },
  },

  {
    id: 'seed-007-junior-race-condition-miss',
    description: 'Junior reviewer finds basic error handling gap but misses a race condition in concurrent update. Accepts minimal fix.',
    tags: ['typescript', 'node', 'concurrency', 'mid-score'],
    seniority: 'junior',
    prContext: {
      title: 'Add candidate status update endpoint',
      description: 'PATCH /api/candidates/:id/status updates candidate stage.',
      instructions: 'Review for correctness and concurrency.',
      diff: `diff --git a/src/routes/candidates/status.ts b/src/routes/candidates/status.ts\n@@ -0,0 +1,38 @@\n+import { Hono } from 'hono';\n+\n+export const statusRoutes = new Hono();\n+\n+statusRoutes.patch('/:id/status', async (c) => {\n+  const { status } = await c.req.json();\n+  const candidate = await c.env.DB\n+    .prepare('SELECT stage_id FROM candidates WHERE id = ?1')\n+    .bind(c.req.param('id'))\n+    .first();\n+  if (!candidate) return c.json({ error: 'not_found' }, 404);\n+\n+  await c.env.DB\n+    .prepare('UPDATE candidates SET stage_id = ?1 WHERE id = ?2')\n+    .bind(status, c.req.param('id'))\n+    .run();\n+\n+  return c.json({ success: true });\n+});\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/routes/candidates/status.ts', line: 6, description: 'No validation on status field — accepts any string including SQL injection attempts (though parameterized, invalid status values corrupt data integrity).', expectedFound: true },
      { id: 2, severity: 'critical', file: 'src/routes/candidates/status.ts', line: 7, description: 'Read-then-write race condition: two concurrent requests can read the same stage_id, then both overwrite, losing one update and any audit trail of the intermediate state.', expectedFound: false },
      { id: 3, severity: 'minor', file: 'src/routes/candidates/status.ts', line: 15, description: 'Success response returns no updated row data — client must refetch.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 701, file: 'src/routes/candidates/status.ts', line: 6, category: 'correctness', severity: 'suggestion', what: 'Should validate status against allowed values.', why: 'Could update with invalid status string.', positive: false },
          { id: 702, file: 'src/routes/candidates/status.ts', line: 10, category: 'style', severity: 'nit', what: 'Prefer early return style with guard clause.', why: 'readability', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Add status validation. Optional style fix.' },
        responses: [
          { to_comment_id: 701, move: 'change', content: 'Added allowed status enum check.', updated_code: "const ALLOWED = ['new', 'screening', 'interview', 'offer']; if (!ALLOWED.includes(status)) return c.json({ error: 'invalid_status' }, 400);" },
          { to_comment_id: 702, move: 'comment', content: 'I find the current style readable enough.' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Validation looks good. Style is fine as-is.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 1 of 3 bugs (status validation). Missed race condition and response shape. Level 2-3.' },
      prioritization: { min: 2, max: 3, rationale: 'Validation flagged as suggestion not blocking. Style nit is non-blocking. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted enum check without verifying completeness. Accepted style pushback. Level 2-3.' },
      reasoning_quality: { min: 2, max: 3, rationale: 'Basic rationale for validation. No technical depth. Level 2-3.' },
      question_formation: { min: 1, max: 2, rationale: 'No questions. Level 1-2.' },
      ai_direction: { min: 2, max: 3, rationale: 'Suggested enum check — actionable. Level 2-3.' },
    },
  },

  {
    id: 'seed-008-junior-auth-miss',
    description: 'Junior reviewer finds an auth gap but misses rate-limiting and logging of PII. Mixed performance.',
    tags: ['typescript', 'node', 'security', 'mid-score'],
    seniority: 'junior',
    prContext: {
      title: 'Add recruiter login endpoint',
      description: 'POST /api/auth/recruiter validates email/password and returns a JWT.',
      instructions: 'Review for security best practices.',
      diff: `diff --git a/src/routes/auth/recruiter.ts b/src/routes/auth/recruiter.ts\n@@ -0,0 +1,42 @@\n+import { Hono } from 'hono';\n+import { sign } from 'hono/jwt';\n+\n+export const authRoutes = new Hono();\n+\n+authRoutes.post('/recruiter', async (c) => {\n+  const { email, password } = await c.req.json();\n+  const user = await c.env.DB\n+    .prepare('SELECT id, password_hash FROM recruiters WHERE email = ?1')\n+    .bind(email)\n+    .first();\n+  if (!user) return c.json({ error: 'invalid_credentials' }, 401);\n+\n+  const valid = await bcryptCompare(password, user.password_hash);\n+  if (!valid) return c.json({ error: 'invalid_credentials' }, 401);\n+\n+  const token = await sign({ sub: user.id, role: 'recruiter' }, c.env.JWT_SECRET);\n+  return c.json({ token });\n+});\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/routes/auth/recruiter.ts', line: 6, description: 'No rate limiting — brute force password attacks possible. Should have IP-based or account-based rate limiting.', expectedFound: false },
      { id: 2, severity: 'major', file: 'src/routes/auth/recruiter.ts', line: 6, description: 'No input validation on email format or password length — could pass malformed data to bcrypt or DB.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/routes/auth/recruiter.ts', line: 13, description: 'Token has no expiry — infinite lifetime JWT is a security risk if leaked.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/routes/auth/recruiter.ts', line: 14, description: 'Error message reveals existence of account via timing — bcryptCompare on non-existent user would be faster than on existing user. Should use constant-time comparison.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 801, file: 'src/routes/auth/recruiter.ts', line: 6, category: 'security', severity: 'suggestion', what: 'Should validate email format before querying DB.', why: 'Prevents unnecessary DB lookups with invalid emails.', positive: false },
          { id: 802, file: 'src/routes/auth/recruiter.ts', line: 13, category: 'security', severity: 'suggestion', what: 'JWT should have an expiration.', why: 'Tokens without expiry never expire.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Two security improvements needed.' },
        responses: [
          { to_comment_id: 801, move: 'change', content: 'Added email regex check.', updated_code: "if (!email.includes('@')) return c.json({ error: 'invalid_email' }, 400);" },
          { to_comment_id: 802, move: 'change', content: 'Added 24h expiry.', updated_code: "await sign({ sub: user.id, role: 'recruiter', exp: Math.floor(Date.now() / 1000) + 86400 }, c.env.JWT_SECRET);" },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Both fixes look good. Security is better now.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 2 of 4 bugs (email validation, JWT expiry). Missed rate limiting and timing attack. Level 2-3.' },
      prioritization: { min: 2, max: 3, rationale: 'Both security issues flagged as suggestions not blocking. Rate limiting not mentioned. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted both fixes without deep verification. Email regex is weak. Level 2-3.' },
      reasoning_quality: { min: 2, max: 3, rationale: 'Basic explanations. No deep security analysis. Level 2-3.' },
      question_formation: { min: 1, max: 2, rationale: 'No questions asked. Level 1-2.' },
      ai_direction: { min: 2, max: 3, rationale: 'Suggested email regex and expiry — actionable but minimal. Level 2-3.' },
    },
  },

  {
    id: 'seed-009-junior-a11y-midhigh',
    description: 'Junior reviewer finds most accessibility issues but misses a focus-trap bug. Good effort for junior level with decent reasoning.',
    tags: ['typescript', 'react', 'accessibility', 'mid-high-score'],
    seniority: 'junior',
    prContext: {
      title: 'Add modal dialog component',
      description: 'Adds a Modal component for confirmation dialogs.',
      instructions: 'Review for accessibility and React patterns.',
      diff: `diff --git a/src/components/Modal.tsx b/src/components/Modal.tsx\n@@ -0,0 +1,48 @@\n+import { useEffect, useRef } from 'react';\n+\n+interface ModalProps {\n+  isOpen: boolean;\n+  onClose: () => void;\n+  children: React.ReactNode;\n+}\n+\n+export function Modal({ isOpen, onClose, children }: ModalProps) {\n+  const dialogRef = useRef<HTMLDivElement>(null);\n+\n+  useEffect(() => {\n+    if (isOpen) {\n+      document.body.style.overflow = 'hidden';\n+    } else {\n+      document.body.style.overflow = '';\n+    }\n+  }, [isOpen]);\n+\n+  if (!isOpen) return null;\n+\n+  return (\n+    <div ref={dialogRef} role=\"dialog\" aria-modal=\"true\">\n+      <div>{children}</div>\n+      <button onClick={onClose}>Close</button>\n+    </div>\n+  );\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'major', file: 'src/components/Modal.tsx', line: 12, description: 'Focus is not moved into the modal when opened — screen reader users stay on the trigger element. Should focus the dialog or first focusable element.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/components/Modal.tsx', line: 18, description: 'No focus trap — Tab key cycles to background elements. Should trap focus inside modal while open.', expectedFound: false },
      { id: 3, severity: 'major', file: 'src/components/Modal.tsx', line: 19, description: 'Escape key does not close modal — expected behavior for dialogs. Missing keydown handler.', expectedFound: true },
      { id: 4, severity: 'minor', file: 'src/components/Modal.tsx', line: 15, description: 'Body overflow reset uses empty string instead of original value. If parent had overflow: scroll, it is lost.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 901, file: 'src/components/Modal.tsx', line: 12, category: 'accessibility', severity: 'suggestion', what: 'Modal should move focus when opened.', why: 'Screen reader users need to know the dialog appeared.', positive: false },
          { id: 902, file: 'src/components/Modal.tsx', line: 19, category: 'accessibility', severity: 'suggestion', what: 'Should close on Escape key.', why: 'Standard keyboard behavior for dialogs.', positive: false },
          { id: 903, file: 'src/components/Modal.tsx', line: 15, category: 'accessibility', severity: 'nit', what: 'Consider saving the original overflow value.', why: 'Could overwrite parent scroll styles.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Accessibility improvements needed.' },
        responses: [
          { to_comment_id: 901, move: 'change', content: 'Added focus to dialog on open.', updated_code: "useEffect(() => { if (isOpen && dialogRef.current) dialogRef.current.focus(); }, [isOpen]);" },
          { to_comment_id: 902, move: 'change', content: 'Added Escape handler.', updated_code: "const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };" },
          { to_comment_id: 903, move: 'comment', content: 'Good point but our app never sets overflow on body. Keeping simple.' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Focus and Escape fixes look good. Overflow is acceptable for our app.' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 2 of 4 bugs (focus, Escape). Missed focus trap and overflow restoration. Good coverage for junior. Level 3-4.' },
      prioritization: { min: 2, max: 3, rationale: 'Accessibility issues flagged as suggestions not blocking. Overflow nit correctly deprioritized. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted focus and Escape fixes. Caved on overflow pushback without verifying app behavior. Level 2-3.' },
      reasoning_quality: { min: 2, max: 3, rationale: 'Concrete user-impact rationale for a11y issues. Level 2-3.' },
      question_formation: { min: 2, max: 3, rationale: 'No explicit questions but comments imply awareness of user needs. Level 2-3.' },
      ai_direction: { min: 2, max: 3, rationale: 'Suggested focus and Escape handling — actionable. No guidance on focus trap. Level 2-3.' },
    },
  },

  {
    id: 'seed-010-junior-generics-good',
    description: 'Junior reviewer finds a generics misuse and asks clarifying questions. Solid performance for junior level.',
    tags: ['typescript', 'generics', 'mid-high-score'],
    seniority: 'junior',
    prContext: {
      title: 'Add generic fetch wrapper',
      description: 'Adds a typed fetch wrapper for API calls.',
      instructions: 'Review for TypeScript type safety.',
      diff: `diff --git a/src/lib/fetch.ts b/src/lib/fetch.ts\n@@ -0,0 +1,30 @@\n+export async function fetchJson<T>(url: string): Promise<T> {\n+  const res = await fetch(url);\n+  if (!res.ok) throw new Error('fetch failed');\n+  return res.json() as T;\n+}\n+\n+export async function fetchPost<T>(url: string, body: unknown): Promise<T> {\n+  const res = await fetch(url, {\n+    method: 'POST',\n+    headers: { 'Content-Type': 'application/json' },\n+    body: JSON.stringify(body),\n+  });\n+  if (!res.ok) throw new Error('post failed');\n+  return res.json() as T;\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'major', file: 'src/lib/fetch.ts', line: 1, description: 'fetchJson casts response as T without validation — runtime type unsafe. Should use zod or similar schema validation.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/lib/fetch.ts', line: 7, description: 'No error status handling — different error codes (400, 401, 500) all throw generic Error. Should include status code and response body in error.', expectedFound: false },
      { id: 3, severity: 'minor', file: 'src/lib/fetch.ts', line: 7, description: 'body type is unknown but not validated before JSON.stringify. Could stringify undefined or circular references.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 1001, file: 'src/lib/fetch.ts', line: 1, category: 'correctness', severity: 'suggestion', what: 'The as T cast is unsafe. Do we have a schema validation library?', why: 'Runtime response may not match the expected type.', positive: false },
          { id: 1002, file: 'src/lib/fetch.ts', line: 7, category: 'correctness', severity: 'suggestion', what: 'Should include status code in error message.', why: 'Helps debugging.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Two improvements suggested. Schema validation would be ideal.' },
        responses: [
          { to_comment_id: 1001, move: 'comment', content: 'We use zod elsewhere. Should I add schema parsing here too?' },
          { to_comment_id: 1002, move: 'change', content: 'Added status to error.', updated_code: "throw new Error(`${res.status}: post failed`);" },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Status code helps. Schema validation can be added later — create a ticket.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 1 of 3 bugs (unsafe cast). Missed error handling and body validation. Level 2-3.' },
      prioritization: { min: 2, max: 3, rationale: 'Schema validation flagged as suggestion. Error status as suggestion. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted status code fix. Deferred schema validation. Level 2-3.' },
      reasoning_quality: { min: 2, max: 3, rationale: 'Good question about schema library. Basic rationale otherwise. Level 2-3.' },
      question_formation: { min: 3, max: 4, rationale: 'Asked clarifying question about schema validation library. Level 3-4 for junior.' },
      ai_direction: { min: 2, max: 3, rationale: 'Suggested schema validation and status codes — actionable. Level 2-3.' },
    },
  },

  {
    id: 'seed-011-junior-pii-leak',
    description: 'Junior reviewer finds a PII logging leak and provides decent reasoning. Good junior performance.',
    tags: ['typescript', 'node', 'security', 'high-score-junior'],
    seniority: 'junior',
    prContext: {
      title: 'Add request logging middleware',
      description: 'Adds a logger middleware for debugging API requests.',
      instructions: 'Review for security and performance.',
      diff: `diff --git a/src/middleware/logger.ts b/src/middleware/logger.ts\n@@ -0,0 +1,25 @@\n+import { Hono } from 'hono';\n+\n+export const logger = async (c, next) => {\n+  const start = Date.now();\n+  await next();\n+  const duration = Date.now() - start;\n+  console.log({\n+    method: c.req.method,\n+    path: c.req.path,\n+    status: c.res.status,\n+    body: c.req.json(),\n+    duration,\n+  });\n+};\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/middleware/logger.ts', line: 9, description: 'c.req.json() logs the entire request body — may contain PII like passwords, SSNs, or resume content. GDPR/privacy violation.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/middleware/logger.ts', line: 9, description: 'c.req.json() is called after await next() — the request body stream may already be consumed, causing hang or error on some runtimes.', expectedFound: false },
      { id: 3, severity: 'minor', file: 'src/middleware/logger.ts', line: 6, description: 'console.log instead of structured logger — no log levels, no sampling, no async batching.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 1101, file: 'src/middleware/logger.ts', line: 9, category: 'security', severity: 'blocking', what: 'Logging the entire request body could leak PII.', why: 'We should never log passwords, tokens, or personal data. This is a privacy risk.', positive: false },
          { id: 1102, file: 'src/middleware/logger.ts', line: 6, category: 'style', severity: 'nit', what: 'Use the app logger instead of console.log.', why: 'Structured logs are easier to query.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Blocking: PII leak. Optional: use structured logger.' },
        responses: [
          { to_comment_id: 1101, move: 'change', content: 'Removed body logging entirely.', updated_code: 'console.log({ method: c.req.method, path: c.req.path, status: c.res.status, duration });' },
          { to_comment_id: 1102, move: 'comment', content: 'We do not have a structured logger set up yet. Keeping console.log for now.' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'PII leak fixed. Console log is acceptable for now.' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 1 of 3 bugs (PII leak). Missed stream consumption and structured logging. Flagged critical correctly. Level 3-4.' },
      prioritization: { min: 3, max: 4, rationale: 'PII flagged as blocking. Logger nit correctly deprioritized. Good triage for junior. Level 3-4.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted removal of body logging. Accepted logger pushback. Level 2-3.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete privacy risk explanation. Good technical awareness. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No explicit questions but implied question about what to log instead. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Direction to remove body logging is clear and actionable. Level 3-4.' },
    },
  },
];

// ─── MID FIXTURES (10) ───────────────────────────────────────────────────────

export const MID_FIXTURES: CompactFixture[] = [
  {
    id: 'seed-012-mid-context-rerender-miss',
    description: 'Mid-level reviewer misses a React context re-render bug, focuses on naming and file structure. Low-mid score anchor for mid-level.',
    tags: ['typescript', 'react', 'performance', 'low-score-anchor', 'mid-level'],
    seniority: 'mid',
    prContext: {
      title: 'Add pipeline context provider',
      description: 'Adds a PipelineContext for sharing pipeline state across components.',
      instructions: 'Review for React performance and TypeScript correctness.',
      diff: `diff --git a/src/contexts/PipelineContext.tsx b/src/contexts/PipelineContext.tsx\n@@ -0,0 +1,52 @@\n+import { createContext, useContext, useState } from 'react';\n+\n+const PipelineContext = createContext(null);\n+\n+export function PipelineProvider({ children, pipelineId }) {\n+  const [pipeline, setPipeline] = useState(null);\n+  const [candidates, setCandidates] = useState([]);\n+\n+  useEffect(() => {\n+    fetchPipeline(pipelineId).then(setPipeline);\n+    fetchCandidates(pipelineId).then(setCandidates);\n+  }, [pipelineId]);\n+\n+  return (\n+    <PipelineContext.Provider value={{ pipeline, candidates, setPipeline, setCandidates }}>\n+      {children}\n+    </PipelineContext.Provider>\n+  );\n+}\n+\n+export const usePipeline = () => useContext(PipelineContext);\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/contexts/PipelineContext.tsx', line: 14, description: 'Context value object is recreated every render — any consumer re-renders whenever PipelineProvider re-renders, even if pipeline/candidates did not change. Should use useMemo.', expectedFound: false },
      { id: 2, severity: 'major', file: 'src/contexts/PipelineContext.tsx', line: 8, description: 'No error handling for fetch failures — rejected promises crash the component tree.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/contexts/PipelineContext.tsx', line: 9, description: 'Race condition: if pipelineId changes rapidly, stale responses may overwrite newer data. Need abort controller or ignore stale flag.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/contexts/PipelineContext.tsx', line: 3, description: 'createContext(null) loses type safety — should be createContext<PipelineContextType | null>(null).', expectedFound: true },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 1201, file: 'src/contexts/PipelineContext.tsx', line: 8, category: 'correctness', severity: 'suggestion', what: 'Missing error handling for fetchPipeline.', why: 'Could crash if network fails.', positive: false },
          { id: 1202, file: 'src/contexts/PipelineContext.tsx', line: 3, category: 'types', severity: 'suggestion', what: 'Context should be typed.', why: 'Type safety.', positive: false },
          { id: 1203, file: 'src/contexts/PipelineContext.tsx', line: 1, category: 'style', severity: 'nit', what: 'File name should be PascalCase.', why: 'Consistency', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Error handling and typing needed.' },
        responses: [
          { to_comment_id: 1201, move: 'change', content: 'Added try/catch with error state.', updated_code: 'try { const p = await fetchPipeline(pipelineId); setPipeline(p); } catch (e) { setError(e); }' },
          { to_comment_id: 1202, move: 'change', content: 'Added interface and typed context.', updated_code: 'const PipelineContext = createContext<PipelineContextType | null>(null);' },
          { to_comment_id: 1203, move: 'comment', content: 'It is already PipelineContext.tsx — that is PascalCase.' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Error handling and typing look good. Filename is already PascalCase.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 2 of 4 bugs (error handling, typing). Missed context re-render and race condition. Level 2-3.' },
      prioritization: { min: 2, max: 3, rationale: 'Error handling and typing as suggestions. Style nit is non-blocking. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted error handling and typing fixes without verifying completeness. Caved on filename. Level 2-3.' },
      reasoning_quality: { min: 2, max: 3, rationale: 'Basic rationale. No deep analysis. Level 2-3.' },
      question_formation: { min: 1, max: 2, rationale: 'No questions. Level 1-2.' },
      ai_direction: { min: 2, max: 3, rationale: 'Suggested try/catch and typing — actionable. No guidance on re-render. Level 2-3.' },
    },
  },

  {
    id: 'seed-013-mid-stream-backpressure',
    description: 'Mid reviewer finds one stream bug but misses backpressure and memory leak. Mixed technical depth.',
    tags: ['typescript', 'node', 'streams', 'low-mid-score'],
    seniority: 'mid',
    prContext: {
      title: 'Add bulk CSV export endpoint',
      description: 'GET /api/export/csv streams candidate data as CSV.',
      instructions: 'Review for performance and memory safety.',
      diff: `diff --git a/src/routes/export/csv.ts b/src/routes/export/csv.ts\n@@ -0,0 +1,40 @@\n+import { Hono } from 'hono';\n+import { stringify } from 'csv-stringify/sync';\n+\n+export const csvRoutes = new Hono();\n+\n+csvRoutes.get('/csv', async (c) => {\n+  const candidates = await c.env.DB\n+    .prepare('SELECT * FROM candidates')\n+    .all();\n+\n+  const rows = candidates.results.map((c) => [c.id, c.name, c.email]);\n+  const csv = stringify(rows);\n+\n+  return c.body(csv, 200, {\n+    'Content-Type': 'text/csv',\n+    'Content-Disposition': 'attachment; filename="candidates.csv"',\n+  });\n+});\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/routes/export/csv.ts', line: 7, description: 'SELECT * loads entire candidates table into memory. For 100k candidates this OOMs. Should stream rows or paginate.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/routes/export/csv.ts', line: 8, description: 'No backpressure handling — c.body may buffer the entire CSV in memory before sending. Should use ReadableStream.', expectedFound: false },
      { id: 3, severity: 'major', file: 'src/routes/export/csv.ts', line: 6, description: 'No auth check — any unauthenticated user can export all candidate data. GDPR breach risk.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/routes/export/csv.ts', line: 11, description: 'Missing CSV header row — exported file has no column names.', expectedFound: true },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 1301, file: 'src/routes/export/csv.ts', line: 7, category: 'performance', severity: 'blocking', what: 'Loading entire table into memory will OOM on large datasets.', why: 'Need pagination or streaming for production data.', positive: false },
          { id: 1302, file: 'src/routes/export/csv.ts', line: 11, category: 'correctness', severity: 'suggestion', what: 'CSV is missing a header row.', why: 'Users need column names.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Memory issue is blocking. Header row should be added.' },
        responses: [
          { to_comment_id: 1301, move: 'change', content: 'Added pagination with 1000-row pages.', updated_code: 'for (let offset = 0; ; offset += 1000) { const page = await c.env.DB.prepare("SELECT * FROM candidates LIMIT 1000 OFFSET ?1").bind(offset).all(); ... }' },
          { to_comment_id: 1302, move: 'change', content: 'Added header row.', updated_code: 'const rows = [["id", "name", "email"], ...candidates.results.map(...)];' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Pagination and header look good.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 2 of 4 bugs (memory, header). Missed backpressure and auth. Level 2-3.' },
      prioritization: { min: 3, max: 4, rationale: 'Memory flagged as blocking. Header as suggestion. Good triage. Level 3-4.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted pagination fix without verifying it handles large datasets. Level 2-3.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete performance rationale (OOM). Good technical framing. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No explicit questions but implied concern about scale. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested pagination and headers — actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-014-mid-union-exhaustiveness',
    description: 'Mid reviewer finds a discriminated union bug but misses exhaustiveness check. Acceptable mid-level performance.',
    tags: ['typescript', 'types', 'mid-score'],
    seniority: 'mid',
    prContext: {
      title: 'Add stage transition handler',
      description: 'Handles candidate stage transitions with typed actions.',
      instructions: 'Review for type safety and correctness.',
      diff: `diff --git a/src/lib/stageTransitions.ts b/src/lib/stageTransitions.ts\n@@ -0,0 +1,35 @@\n+type StageAction =\n+  | { type: 'move'; stageId: string }\n+  | { type: 'reject'; reason: string }\n+  | { type: 'hold'; until: Date };\n+\n+export function handleAction(action: StageAction, candidateId: string) {\n+  if (action.type === 'move') {\n+    return moveCandidate(candidateId, action.stageId);\n+  }\n+  if (action.type === 'reject') {\n+    return rejectCandidate(candidateId, action.reason);\n+  }\n+  if (action.type === 'hold') {\n+    return holdCandidate(candidateId, action.until);\n+  }\n+  return null;\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'major', file: 'src/lib/stageTransitions.ts', line: 14, description: 'No exhaustiveness check — if a new StageAction type is added, handleAction silently returns null instead of failing at compile time. Should use switch with never or assertNever.', expectedFound: false },
      { id: 2, severity: 'major', file: 'src/lib/stageTransitions.ts', line: 6, description: 'Return type is inferred as Promise<unknown> | null — callers have no type safety on the result. Should explicitly type the return.', expectedFound: true },
      { id: 3, severity: 'minor', file: 'src/lib/stageTransitions.ts', line: 8, description: 'Each branch calls a different async function but results are not awaited — fire-and-forget pattern may hide errors.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 1401, file: 'src/lib/stageTransitions.ts', line: 6, category: 'types', severity: 'suggestion', what: 'Return type should be explicit.', why: 'Callers need to know what this function returns.', positive: false },
          { id: 1402, file: 'src/lib/stageTransitions.ts', line: 8, category: 'correctness', severity: 'suggestion', what: 'Should await the async calls.', why: 'Otherwise errors are silently swallowed.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Type safety and async handling needed.' },
        responses: [
          { to_comment_id: 1401, move: 'change', content: 'Added explicit return type.', updated_code: 'export async function handleAction(action: StageAction, candidateId: string): Promise<void> {' },
          { to_comment_id: 1402, move: 'change', content: 'Added await to all branches.', updated_code: 'await moveCandidate(...)' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Both fixes look good.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 1 of 3 bugs (return type). Missed exhaustiveness and async handling. Level 2-3.' },
      prioritization: { min: 2, max: 3, rationale: 'Both issues flagged as suggestions not blocking. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted both fixes. Level 2-3.' },
      reasoning_quality: { min: 2, max: 3, rationale: 'Basic rationale. No deep analysis. Level 2-3.' },
      question_formation: { min: 1, max: 2, rationale: 'No questions. Level 1-2.' },
      ai_direction: { min: 2, max: 3, rationale: 'Suggested explicit return type and await — actionable. Level 2-3.' },
    },
  },

  {
    id: 'seed-015-mid-hook-cleanup-miss',
    description: 'Mid reviewer finds a hook API issue but misses cleanup and dependency problems. Mixed performance.',
    tags: ['typescript', 'react', 'hooks', 'mid-score'],
    seniority: 'mid',
    prContext: {
      title: 'Add usePolling hook',
      description: 'Polls an API endpoint at an interval.',
      instructions: 'Review for React best practices and correctness.',
      diff: `diff --git a/src/hooks/usePolling.ts b/src/hooks/usePolling.ts\n@@ -0,0 +1,38 @@\n+import { useEffect, useRef } from 'react';\n+\n+export function usePolling(url: string, interval: number) {\n+  const [data, setData] = useState(null);\n+  const intervalRef = useRef(null);\n+\n+  useEffect(() => {\n+    intervalRef.current = setInterval(async () => {\n+      const res = await fetch(url);\n+      const json = await res.json();\n+      setData(json);\n+    }, interval);\n+  }, [url]);\n+\n+  return data;\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/hooks/usePolling.ts', line: 7, description: 'setInterval callback fires even if component unmounts — fetch/setData on unmounted component causes memory leak and React warning. Missing cleanup function.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/hooks/usePolling.ts', line: 7, description: 'Dependency array only includes url — if interval changes, the old interval keeps running and a new one starts. Should include interval and clear old interval.', expectedFound: false },
      { id: 3, severity: 'major', file: 'src/hooks/usePolling.ts', line: 8, description: 'No error handling for fetch failures — repeated 500s will spam the console and never surface to UI.', expectedFound: true },
      { id: 4, severity: 'minor', file: 'src/hooks/usePolling.ts', line: 9, description: 'No AbortController for fetch — if component unmounts during fetch, the response may still call setData after unmount.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 1501, file: 'src/hooks/usePolling.ts', line: 7, category: 'correctness', severity: 'blocking', what: 'Missing cleanup for setInterval — leaks after unmount.', why: 'setInterval keeps firing even if component is gone.', positive: false },
          { id: 1502, file: 'src/hooks/usePolling.ts', line: 8, category: 'correctness', severity: 'suggestion', what: 'Should handle fetch errors.', why: 'Repeated failures will spam logs.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Cleanup is blocking. Error handling recommended.' },
        responses: [
          { to_comment_id: 1501, move: 'change', content: 'Added cleanup.', updated_code: 'return () => clearInterval(intervalRef.current);' },
          { to_comment_id: 1502, move: 'change', content: 'Added try/catch around fetch.', updated_code: "try { const res = await fetch(url); ... } catch (e) { console.error(e); }" },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Cleanup and error handling look good.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 2 of 4 bugs (cleanup, error handling). Missed interval dependency and AbortController. Level 2-3.' },
      prioritization: { min: 3, max: 4, rationale: 'Cleanup flagged as blocking. Error handling as suggestion. Good triage. Level 3-4.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted cleanup and error handling without verifying interval fix. Level 2-3.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete leak explanation. Error spam rationale is good. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No questions. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested cleanup and try/catch — actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-016-mid-timeout-circuit',
    description: 'Mid reviewer finds timeout bug but misses circuit breaker pattern. Decent reasoning and some questions.',
    tags: ['typescript', 'node', 'reliability', 'mid-score'],
    seniority: 'mid',
    prContext: {
      title: 'Add external API client',
      description: 'Client for calling third-party assessment provider API.',
      instructions: 'Review for reliability and error handling.',
      diff: `diff --git a/src/lib/assessmentClient.ts b/src/lib/assessmentClient.ts\n@@ -0,0 +1,42 @@\n+export async function callAssessmentApi(payload: unknown) {\n+  const res = await fetch('https://api.assessor.example/v1/score', {\n+    method: 'POST',\n+    headers: { 'Authorization': 'Bearer ' + ENV.ASSESSOR_KEY },\n+    body: JSON.stringify(payload),\n+  });\n+\n+  if (!res.ok) {\n+    throw new Error('Assessment API failed: ' + res.status);\n+  }\n+\n+  return res.json();\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/lib/assessmentClient.ts', line: 2, description: 'No request timeout — if the third-party API hangs, this fetch hangs forever, blocking the Worker request and potentially exhausting concurrent request limits.', expectedFound: true },
      { id: 2, severity: 'critical', file: 'src/lib/assessmentClient.ts', line: 6, description: 'No retry logic — transient 503s from the assessment API will fail the candidate scoring flow. Should retry with exponential backoff.', expectedFound: false },
      { id: 3, severity: 'major', file: 'src/lib/assessmentClient.ts', line: 6, description: 'No circuit breaker — if the API is down, every request will wait for timeout, cascading failure. Should fail fast after N consecutive failures.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/lib/assessmentClient.ts', line: 4, description: 'API key is concatenated inline — should use Headers object for clarity and to avoid accidental key leakage in logs.', expectedFound: true },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 1601, file: 'src/lib/assessmentClient.ts', line: 2, category: 'reliability', severity: 'blocking', what: 'No timeout on fetch — if assessor API hangs, we hang forever.', why: 'Workers have request timeouts. A hanging upstream call will kill our response.', positive: false },
          { id: 1602, file: 'src/lib/assessmentClient.ts', line: 4, category: 'security', severity: 'suggestion', what: 'Use Headers object instead of string concat for auth.', why: 'Cleaner and less error-prone.', positive: false },
          { id: 1603, file: 'src/lib/assessmentClient.ts', line: 1, category: 'positive', severity: 'nit', what: 'Good explicit return type on the function.', why: '', positive: true },
        ],
        verdict: { decision: 'request_changes', summary: 'Timeout is blocking. Headers refactor is optional.' },
        responses: [
          { to_comment_id: 1601, move: 'change', content: 'Added AbortController with 10s timeout.', updated_code: "const controller = new AbortController(); setTimeout(() => controller.abort(), 10000); const res = await fetch(..., { signal: controller.signal });" },
          { to_comment_id: 1602, move: 'change', content: 'Switched to Headers.', updated_code: 'headers: new Headers({ Authorization: `Bearer ${ENV.ASSESSOR_KEY}` })' },
          { to_comment_id: 1603, move: 'comment', content: 'Thanks!' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Timeout and headers look good.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 2 of 4 bugs (timeout, headers). Missed retry and circuit breaker. Level 2-3.' },
      prioritization: { min: 3, max: 4, rationale: 'Timeout flagged as blocking. Headers as suggestion. Positive comment is good. Level 3-4.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted timeout and headers. Level 2-3.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete timeout rationale (Worker limits). Good technical framing. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No explicit questions. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested AbortController and Headers — actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-017-mid-pagination-cursor',
    description: 'Mid reviewer finds pagination cursor bug and provides good reasoning. Solid mid-level performance.',
    tags: ['typescript', 'node', 'api', 'mid-high-score'],
    seniority: 'mid',
    prContext: {
      title: 'Add candidate list endpoint with cursor pagination',
      description: 'Returns candidates with cursor-based pagination.',
      instructions: 'Review for API design and correctness.',
      diff: `diff --git a/src/routes/candidates/list.ts b/src/routes/candidates/list.ts\n@@ -0,0 +1,48 @@\n+import { Hono } from 'hono';\n+\n+export const listRoutes = new Hono();\n+\n+listRoutes.get('/', async (c) => {\n+  const cursor = c.req.query('cursor') ?? '0';\n+  const limit = parseInt(c.req.query('limit') ?? '20', 10);\n+\n+  const candidates = await c.env.DB\n+    .prepare('SELECT * FROM candidates WHERE id > ?1 ORDER BY id LIMIT ?2')\n+    .bind(cursor, limit)\n+    .all();\n+\n+  const nextCursor = candidates.results.length === limit\n+    ? candidates.results[candidates.results.length - 1].id\n+    : null;\n+\n+  return c.json({ candidates: candidates.results, nextCursor });\n+});\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/routes/candidates/list.ts', line: 7, description: 'No auth check — any user can list all candidates across all orgs. Missing org_id filter and Clerk JWT verification.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/routes/candidates/list.ts', line: 7, description: 'No max limit — client can request limit=999999, effectively loading entire table. Should cap at 100.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/routes/candidates/list.ts', line: 8, description: 'Cursor is parsed as integer but used as string in WHERE id > ?1 — SQLite string comparison on UUIDs produces lexicographic ordering, which is not guaranteed to match creation order. Should use created_at + id composite cursor.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/routes/candidates/list.ts', line: 11, description: 'SELECT * returns all columns including sensitive data. Should explicitly select only needed fields.', expectedFound: true },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 1701, file: 'src/routes/candidates/list.ts', line: 7, category: 'security', severity: 'blocking', what: 'No auth check — any user can list all candidates.', why: 'Must verify the user belongs to the org and filter by org_id.', positive: false },
          { id: 1702, file: 'src/routes/candidates/list.ts', line: 7, category: 'correctness', severity: 'blocking', what: 'No max limit on pagination.', why: 'A malicious client can request limit=999999 and OOM the worker.', positive: false },
          { id: 1703, file: 'src/routes/candidates/list.ts', line: 11, category: 'security', severity: 'suggestion', what: 'SELECT * returns all columns.', why: 'Could leak PII if columns are added later.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Auth and limit are blocking. Column selection is recommended.' },
        responses: [
          { to_comment_id: 1701, move: 'change', content: 'Added auth middleware and org_id filter.', updated_code: "pipelineCandidatesRoutes.use('/*', authMiddleware); ... WHERE org_id = ?1 AND id > ?2" },
          { to_comment_id: 1702, move: 'change', content: 'Capped limit at 100.', updated_code: "const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);" },
          { to_comment_id: 1703, move: 'change', content: 'Switched to explicit columns.', updated_code: 'SELECT id, name, email, stage_id FROM candidates' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'All three issues resolved. Auth, limit, and column selection look correct.' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 3 of 4 bugs (auth, limit, SELECT *). Missed cursor ordering issue. Level 3-4.' },
      prioritization: { min: 3, max: 4, rationale: 'Auth and limit flagged as blocking. Column selection as suggestion. Good triage. Level 3-4.' },
      revision_evaluation: { min: 3, max: 4, rationale: 'Verified all three fixes. Auth middleware pattern is correct. Level 3-4.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete security and performance rationales. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No explicit questions. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested auth middleware, limit cap, explicit columns — all actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-018-mid-compound-pattern',
    description: 'Mid reviewer finds compound component pattern issue and asks good questions. Above-average mid-level.',
    tags: ['typescript', 'react', 'patterns', 'mid-high-score'],
    seniority: 'mid',
    prContext: {
      title: 'Add Tabs compound component',
      description: 'Tabs component with TabList, Tab, and TabPanel subcomponents.',
      instructions: 'Review for React patterns and accessibility.',
      diff: `diff --git a/src/components/Tabs.tsx b/src/components/Tabs.tsx\n@@ -0,0 +1,55 @@\n+import { createContext, useContext, useState } from 'react';\n+\n+const TabsContext = createContext({ activeIndex: 0, setActiveIndex: (i: number) => {} });\n+\n+export function TabList({ children }) {\n+  return <div role=\"tablist\">{children}</div>;\n+}\n+\n+export function Tab({ index, children }) {\n+  const { activeIndex, setActiveIndex } = useContext(TabsContext);\n+  return (\n+    <button role=\"tab\" aria-selected={index === activeIndex} onClick={() => setActiveIndex(index)}>\n+      {children}\n+    </button>\n+  );\n+}\n+\n+export function TabPanel({ index, children }) {\n+  const { activeIndex } = useContext(TabsContext);\n+  if (index !== activeIndex) return null;\n+  return <div role=\"tabpanel\">{children}</div>;\n+}\n+\n+export function Tabs({ children }) {\n+  const [activeIndex, setActiveIndex] = useState(0);\n+  return (\n+    <TabsContext.Provider value={{ activeIndex, setActiveIndex }}>\n+      {children}\n+    </TabsContext.Provider>\n+  );\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'major', file: 'src/components/Tabs.tsx', line: 16, description: 'Tab and TabPanel are not connected by aria-controls / aria-labelledby — screen readers cannot associate tabs with panels. Missing id generation and aria attributes.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/components/Tabs.tsx', line: 5, description: 'createContext default value is a dummy function — if Tab is rendered outside Tabs, it silently fails instead of throwing a clear error. Should use null default and throw if context is missing.', expectedFound: false },
      { id: 3, severity: 'minor', file: 'src/components/Tabs.tsx', line: 12, description: 'Tab keyboard navigation missing — arrow keys should move focus between tabs per WAI-ARIA tabs pattern.', expectedFound: true },
      { id: 4, severity: 'minor', file: 'src/components/Tabs.tsx', line: 19, description: 'TabPanel renders null when inactive — this unmounts panel content, losing state. Should use hidden attribute instead.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 1801, file: 'src/components/Tabs.tsx', line: 16, category: 'accessibility', severity: 'suggestion', what: 'Tabs need aria-controls linking tab to panel.', why: 'Screen readers need to know which panel belongs to which tab.', positive: false },
          { id: 1802, file: 'src/components/Tabs.tsx', line: 12, category: 'accessibility', severity: 'suggestion', what: 'Should support arrow key navigation between tabs.', why: 'Keyboard users expect arrow keys for tab widgets.', positive: false },
          { id: 1803, file: 'src/components/Tabs.tsx', line: 5, category: 'correctness', severity: 'suggestion', what: 'Context default is a no-op. Should we throw if used outside Tabs?', why: 'Better developer experience for misuse.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Accessibility improvements needed. Context error handling recommended.' },
        responses: [
          { to_comment_id: 1801, move: 'change', content: 'Added useId and aria attributes.', updated_code: 'const tabId = useId(); ... aria-controls={panelId} aria-labelledby={tabId}' },
          { to_comment_id: 1802, move: 'change', content: 'Added arrow key handler.', updated_code: "onKeyDown={(e) => { if (e.key === 'ArrowRight') setActiveIndex((i) => Math.min(i + 1, tabCount - 1)); ... }}" },
          { to_comment_id: 1803, move: 'comment', content: 'I prefer the no-op default so tests do not need a provider wrapper. Is that a strong requirement?' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Accessibility fixes look good. Context default is acceptable for testability.' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 2 of 4 bugs (aria, keyboard). Missed context error handling and panel unmount. Level 3-4.' },
      prioritization: { min: 2, max: 3, rationale: 'Accessibility issues flagged as suggestions not blocking. Context as suggestion. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted aria and keyboard fixes. Caved on context pushback. Level 2-3.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Good user-impact rationale for a11y. Context rationale is reasonable. Level 3-4.' },
      question_formation: { min: 3, max: 4, rationale: 'Asked clarifying question about context default behavior. Level 3-4.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested aria attributes and keyboard handler — actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-019-mid-branded-types',
    description: 'Mid reviewer finds most type safety issues and provides solid direction. Good mid-level performance.',
    tags: ['typescript', 'types', 'high-score-mid'],
    seniority: 'mid',
    prContext: {
      title: 'Add candidate ID types',
      description: 'Introduces branded types for candidate IDs to prevent mixing with other ID types.',
      instructions: 'Review for TypeScript type safety and patterns.',
      diff: `diff --git a/src/types/ids.ts b/src/types/ids.ts\n@@ -0,0 +1,30 @@\n+type CandidateId = string & { __brand: 'CandidateId' };\n+type PipelineId = string & { __brand: 'PipelineId' };\n+\n+export function toCandidateId(id: string): CandidateId {\n+  return id as CandidateId;\n+}\n+\n+export function toPipelineId(id: string): PipelineId {\n+  return id as PipelineId;\n+}\n+\n+export function moveCandidate(cid: CandidateId, pid: PipelineId) {\n+  // implementation\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'major', file: 'src/types/ids.ts', line: 4, description: 'toCandidateId does no validation — any string can be cast, defeating the purpose of branded types. Should validate UUID format.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/types/ids.ts', line: 8, description: 'moveCandidate takes branded types but internal implementation may still accept plain strings via implicit any. Function body should be shown and validated.', expectedFound: false },
      { id: 3, severity: 'minor', file: 'src/types/ids.ts', line: 1, description: 'Branded type uses intersection with string — nominal typing is better achieved with unique symbol or abstract class for stronger encapsulation.', expectedFound: true },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 1901, file: 'src/types/ids.ts', line: 4, category: 'types', severity: 'blocking', what: 'toCandidateId casts without validation — any string works.', why: 'This defeats the safety purpose of branded types. Should validate UUID format.', positive: false },
          { id: 1902, file: 'src/types/ids.ts', line: 1, category: 'types', severity: 'suggestion', what: 'Consider using a unique symbol for the brand instead of string intersection.', why: 'Stronger nominal typing prevents accidental structural compatibility.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Validation is blocking. Symbol brand is recommended.' },
        responses: [
          { to_comment_id: 1901, move: 'change', content: 'Added UUID regex validation.', updated_code: "if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid CandidateId'); return id as CandidateId;" },
          { to_comment_id: 1902, move: 'comment', content: 'Symbol brands are verbose in TS. String intersection is the standard pattern in our codebase.' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Validation looks good. String intersection is acceptable per codebase convention.' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 2 of 3 bugs (validation, brand type). Missed implementation body check. Level 3-4.' },
      prioritization: { min: 3, max: 4, rationale: 'Validation flagged as blocking. Type suggestion as non-blocking. Good triage. Level 3-4.' },
      revision_evaluation: { min: 3, max: 4, rationale: 'Verified UUID regex. Accepted pushback on brand type with reasoning. Level 3-4.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete rationale for validation and nominal typing. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No explicit questions. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested regex validation and symbol brand — actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-020-mid-event-emitter',
    description: 'Mid reviewer finds event emitter leak and provides good pushback. Solid mid-level with strong communication.',
    tags: ['typescript', 'node', 'events', 'high-score-mid'],
    seniority: 'mid',
    prContext: {
      title: 'Add real-time notification service',
      description: 'EventEmitter-based service for candidate status notifications.',
      instructions: 'Review for memory safety and event handling.',
      diff: `diff --git a/src/lib/notifications.ts b/src/lib/notifications.ts\n@@ -0,0 +1,45 @@\n+import { EventEmitter } from 'events';\n+\n+class NotificationService extends EventEmitter {\n+  private listeners = new Map<string, Set<Function>>();\n+\n+  subscribe(candidateId: string, handler: Function) {\n+    if (!this.listeners.has(candidateId)) {\n+      this.listeners.set(candidateId, new Set());\n+    }\n+    this.listeners.get(candidateId)!.add(handler);\n+    this.on(candidateId, handler as any);\n+  }\n+\n+  unsubscribe(candidateId: string, handler: Function) {\n+    this.listeners.get(candidateId)?.delete(handler);\n+    this.off(candidateId, handler as any);\n+  }\n+\n+  notify(candidateId: string, event: unknown) {\n+    this.emit(candidateId, event);\n+  }\n+}\n+\n+export const notifications = new NotificationService();\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/lib/notifications.ts', line: 9, description: 'EventEmitter.on adds listener but there is no cleanup when component unmounts — leaked listeners accumulate, causing memory growth and duplicate event handling.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/lib/notifications.ts', line: 14, description: 'unsubscribe does not check if the set becomes empty — empty Sets remain in the Map, causing memory leak over time.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/lib/notifications.ts', line: 9, description: 'handler typed as Function and cast as any — loses type safety. Should use generic or specific event type.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/lib/notifications.ts', line: 19, description: 'Singleton export — hard to test and mock. Should use factory or DI.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 2001, file: 'src/lib/notifications.ts', line: 9, category: 'correctness', severity: 'blocking', what: 'Listeners are never cleaned up on unmount. Need a way to auto-unsubscribe.', why: 'Leaked event listeners cause memory growth and duplicate handling.', positive: false },
          { id: 2002, file: 'src/lib/notifications.ts', line: 14, category: 'correctness', severity: 'blocking', what: 'unsubscribe leaves empty Sets in the Map.', why: 'Empty sets still consume memory and the Map grows unbounded.', positive: false },
          { id: 2003, file: 'src/lib/notifications.ts', line: 9, category: 'types', severity: 'suggestion', what: 'handler should be typed, not Function.', why: 'Type safety.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Two blocking memory issues. Type suggestion is optional.' },
        responses: [
          { to_comment_id: 2001, move: 'change', content: 'Added unsubscribeAll method called on unmount.', updated_code: "unsubscribeAll(candidateId: string) { this.listeners.get(candidateId)?.forEach(h => this.off(candidateId, h as any)); this.listeners.delete(candidateId); }" },
          { to_comment_id: 2002, move: 'change', content: 'Delete empty sets.', updated_code: 'this.listeners.get(candidateId)?.delete(handler); if (this.listeners.get(candidateId)?.size === 0) this.listeners.delete(candidateId);' },
          { to_comment_id: 2003, move: 'pushback', content: 'Function is sufficient for now. We will type events in a follow-up.' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Memory fixes look good. Function type is acceptable for now.' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 2 of 4 bugs (leak, empty sets). Missed handler typing and singleton pattern. Level 3-4.' },
      prioritization: { min: 3, max: 4, rationale: 'Both memory issues flagged as blocking. Type as suggestion. Good triage. Level 3-4.' },
      revision_evaluation: { min: 3, max: 4, rationale: 'Verified unsubscribeAll and empty set cleanup. Held line on type pushback with reasoning. Level 3-4.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete memory rationales. Good technical depth. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No explicit questions. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested unsubscribeAll and set cleanup — actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-021-mid-suspense-boundary',
    description: 'Mid reviewer finds error boundary issue and evaluates fixes well. Strong mid-level performance.',
    tags: ['typescript', 'react', 'suspense', 'high-score-mid'],
    seniority: 'mid',
    prContext: {
      title: 'Add async data boundary',
      description: 'Suspense-compatible data fetching wrapper with error handling.',
      instructions: 'Review for React patterns and error handling.',
      diff: `diff --git a/src/components/DataBoundary.tsx b/src/components/DataBoundary.tsx\n@@ -0,0 +1,42 @@\n+import { Suspense, use } from 'react';\n+\n+function DataFetcher({ promise }) {\n+  const data = use(promise);\n+  return <div>{data.name}</div>;\n+}\n+\n+export function DataBoundary({ promise, fallback }) {\n+  return (\n+    <Suspense fallback={fallback}>\n+      <ErrorBoundary>\n+        <DataFetcher promise={promise} />\n+      </ErrorBoundary>\n+    </Suspense>\n+  );\n+}\n+\n+class ErrorBoundary extends React.Component {\n+  state = { hasError: false };\n+  static getDerivedStateFromError() {\n+    return { hasError: true };\n+  }\n+  render() {\n+    if (this.state.hasError) return <div>Error</div>;\n+    return this.props.children;\n+  }\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/components/DataBoundary.tsx', line: 9, description: 'ErrorBoundary is inside Suspense — if DataFetcher throws, Suspense catches it first and shows fallback forever, never reaching ErrorBoundary. ErrorBoundary must be outside Suspense.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/components/DataBoundary.tsx', line: 4, description: 'DataFetcher accesses data.name without null check — if promise resolves to null or missing name, throws. Should handle edge cases.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/components/DataBoundary.tsx', line: 15, description: 'ErrorBoundary has no error logging — production errors are silently swallowed. Should include componentDidCatch with logging.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/components/DataBoundary.tsx', line: 1, description: 'use is an experimental API — should document React version requirement.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 2101, file: 'src/components/DataBoundary.tsx', line: 9, category: 'correctness', severity: 'blocking', what: 'ErrorBoundary is inside Suspense — it will never catch errors.', why: 'Suspense catches thrown promises first. ErrorBoundary must wrap Suspense, not be inside it.', positive: false },
          { id: 2102, file: 'src/components/DataBoundary.tsx', line: 4, category: 'correctness', severity: 'blocking', what: 'data.name is accessed without checking if data exists.', why: 'Promise could resolve to null or undefined.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Two blocking correctness issues.' },
        responses: [
          { to_comment_id: 2101, move: 'change', content: 'Swapped order.', updated_code: '<ErrorBoundary><Suspense fallback={fallback}><DataFetcher promise={promise} /></Suspense></ErrorBoundary>' },
          { to_comment_id: 2102, move: 'change', content: 'Added optional chaining.', updated_code: "return <div>{data?.name ?? 'Unknown'}</div>;" },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Both fixes correct. Boundary order and null handling look good.' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 2 of 4 bugs (boundary order, null access). Missed error logging and API docs. Level 3-4.' },
      prioritization: { min: 3, max: 4, rationale: 'Both correctness issues flagged as blocking. Level 3-4.' },
      revision_evaluation: { min: 3, max: 4, rationale: 'Verified boundary swap and optional chaining. Level 3-4.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete React hydration and UX rationales. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No questions. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested boundary reorder and optional chaining — actionable. Level 3-4.' },
    },
  },
];

// ─── SENIOR FIXTURES (9 new + seed-002 = 10) ─────────────────────────────────

export const SENIOR_FIXTURES: CompactFixture[] = [
  {
    id: 'seed-022-senior-distributed-lock-miss',
    description: 'Senior reviewer finds an obvious bug but misses edge cases in distributed lock. Low score for senior level.',
    tags: ['typescript', 'node', 'distributed-systems', 'low-score-anchor', 'senior-level'],
    seniority: 'senior',
    prContext: {
      title: 'Add distributed lock with Redis',
      description: 'Implements a distributed lock for pipeline mutations.',
      instructions: 'Review for distributed systems correctness and edge cases.',
      diff: `diff --git a/src/lib/lock.ts b/src/lib/lock.ts\n@@ -0,0 +1,48 @@\n+import { createClient } from 'redis';\n+\n+export class DistributedLock {\n+  private client = createClient({ url: ENV.REDIS_URL });\n+\n+  async acquire(key: string, ttlMs: number): Promise<boolean> {\n+    const result = await this.client.set(key, 'locked', {\n+      NX: true,\n+      PX: ttlMs,\n+    });\n+    return result === 'OK';\n+  }\n+\n+  async release(key: string): Promise<void> {\n+    await this.client.del(key);\n+  }\n+\n+  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {\n+    const acquired = await this.acquire(key, ttlMs);\n+    if (!acquired) throw new Error('Lock not acquired');\n+    try {\n+      return await fn();\n+    } finally {\n+      await this.release(key);\n+    }\n+  }\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/lib/lock.ts', line: 13, description: 'release() deletes the key without verifying the caller owns the lock — if the lock expires and another process acquires it, release() will delete the OTHER process lock. Should use a unique token (UUID) and compare-before-delete (Redlock pattern).', expectedFound: false },
      { id: 2, severity: 'critical', file: 'src/lib/lock.ts', line: 9, description: 'No lock extension mechanism — if fn() takes longer than ttlMs, the lock expires mid-operation. Should support refresh/extend during long operations.', expectedFound: false },
      { id: 3, severity: 'major', file: 'src/lib/lock.ts', line: 16, description: 'withLock throws on failed acquisition instead of supporting retry or backoff — callers must implement their own retry logic, leading to inconsistent patterns.', expectedFound: true },
      { id: 4, severity: 'minor', file: 'src/lib/lock.ts', line: 5, description: 'Redis client is created per lock instance — should be shared/reused across the application to avoid connection pool exhaustion.', expectedFound: true },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 2201, file: 'src/lib/lock.ts', line: 16, category: 'design', severity: 'suggestion', what: 'Throwing on lock failure is harsh. Consider retry with exponential backoff.', why: 'Transient contention is common in distributed systems.', positive: false },
          { id: 2202, file: 'src/lib/lock.ts', line: 5, category: 'performance', severity: 'suggestion', what: 'Creating a Redis client per instance may exhaust connections.', why: 'Should reuse a shared client.', positive: false },
        ],
        verdict: { decision: 'approve', summary: 'Good suggestions but not blocking. Works for current scale.' },
        responses: [
          { to_comment_id: 2201, move: 'comment', content: 'Retry logic adds complexity. Callers can retry if needed.' },
          { to_comment_id: 2202, move: 'change', content: 'Switched to singleton client.', updated_code: 'private client = getSharedRedisClient();' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Shared client is good. Retry can be added later if needed.' },
    expectedBands: {
      issue_identification: { min: 2, max: 3, rationale: 'Found 2 of 4 bugs (retry, client reuse). Missed lock ownership and extension. For senior, this is poor. Level 2-3.' },
      prioritization: { min: 2, max: 3, rationale: 'Critical distributed systems bugs treated as suggestions. Approved with unfound criticals. Level 2-3.' },
      revision_evaluation: { min: 2, max: 3, rationale: 'Accepted client fix. Caved on retry pushback. Level 2-3.' },
      reasoning_quality: { min: 2, max: 3, rationale: 'Basic rationale. No deep distributed systems analysis. Level 2-3.' },
      question_formation: { min: 1, max: 2, rationale: 'No questions. Level 1-2.' },
      ai_direction: { min: 2, max: 3, rationale: 'Suggested retry and shared client — actionable but missed core issues. Level 2-3.' },
    },
  },

  {
    id: 'seed-023-senior-idempotency-race',
    description: 'Senior reviewer finds race condition but misses durability issue. Mixed performance for senior.',
    tags: ['typescript', 'node', 'distributed-systems', 'mid-score-senior'],
    seniority: 'senior',
    prContext: {
      title: 'Add idempotency key handler',
      description: 'Ensures payment processing is idempotent using a key store.',
      instructions: 'Review for consistency and reliability.',
      diff: `diff --git a/src/lib/idempotency.ts b/src/lib/idempotency.ts\n@@ -0,0 +1,50 @@\n+export class IdempotencyStore {\n+  private store = new Map<string, { status: string; result?: unknown }>();\n+\n+  async process(key: string, fn: () => Promise<unknown>) {\n+    if (this.store.has(key)) {\n+      return this.store.get(key)!;\n+    }\n+\n+    const result = await fn();\n+    this.store.set(key, { status: 'completed', result });\n+    return { status: 'completed', result };\n+  }\n+\n+  async getStatus(key: string) {\n+    return this.store.get(key) ?? { status: 'not_found' };\n+  }\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/lib/idempotency.ts', line: 6, description: 'In-memory Map is not shared across Worker instances — in a multi-process or edge deployment, idempotency keys are isolated per instance. Duplicate requests routed to different Workers will re-execute. Should use Redis/Durable Object.', expectedFound: true },
      { id: 2, severity: 'critical', file: 'src/lib/idempotency.ts', line: 6, description: 'No locking around check-then-act — two concurrent requests with the same key can both pass the has() check, then both execute fn(), violating idempotency. Needs atomic compare-and-swap.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/lib/idempotency.ts', line: 9, description: 'No durability guarantee — if process crashes between fn() completion and store.set(), the operation is lost. Should persist BEFORE executing or use a two-phase commit.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/lib/idempotency.ts', line: 5, description: 'No TTL on keys — Map grows unbounded, causing memory leak. Should expire old entries.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 2301, file: 'src/lib/idempotency.ts', line: 6, category: 'correctness', severity: 'blocking', what: 'In-memory Map does not work across Workers.', why: 'In edge deployments each request may hit a different instance. The key will not be found.', positive: false },
          { id: 2302, file: 'src/lib/idempotency.ts', line: 6, category: 'correctness', severity: 'blocking', what: 'Race condition: two requests with same key can both execute.', why: 'Check-then-act is not atomic. Need locking or atomic compare-and-swap.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Two blocking distributed systems issues.' },
        responses: [
          { to_comment_id: 2301, move: 'change', content: 'Switched to Redis backend.', updated_code: "const store = await redis.get(key); ... await redis.set(key, JSON.stringify({ status, result }));" },
          { to_comment_id: 2302, move: 'change', content: 'Added Redis SET NX for atomic acquisition.', updated_code: "const acquired = await redis.set(key, 'processing', { NX: true, EX: 60 }); if (!acquired) return redis.get(key);" },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Redis and atomic acquisition look correct.' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 2 of 4 bugs (cross-instance, race). Missed durability and TTL. Level 3-4 for senior.' },
      prioritization: { min: 3, max: 4, rationale: 'Both issues flagged as blocking. Level 3-4.' },
      revision_evaluation: { min: 3, max: 4, rationale: 'Verified Redis switch and atomic acquisition. Level 3-4.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete distributed systems rationale. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No questions. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested Redis and SET NX — actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-024-senior-compiler-plugin',
    description: 'Senior reviewer finds type issue but misses performance impact. Mixed senior performance.',
    tags: ['typescript', 'compiler', 'mid-score-senior'],
    seniority: 'senior',
    prContext: {
      title: 'Add TS transformer for schema inference',
      description: 'TypeScript compiler plugin that infers Zod schemas from types.',
      instructions: 'Review for correctness and compiler API usage.',
      diff: `diff --git a/src/lib/schemaTransformer.ts b/src/lib/schemaTransformer.ts\n@@ -0,0 +1,45 @@\n+import ts from 'typescript';\n+\n+export function inferSchema(typeNode: ts.TypeNode) {\n+  const checker = /* get type checker */;\n+  const type = checker.getTypeAtLocation(typeNode);\n+\n+  const properties = checker.getPropertiesOfType(type);\n+  const schema: Record<string, unknown> = {};\n+\n+  for (const prop of properties) {\n+    const propType = checker.getTypeOfSymbolAtLocation(prop, typeNode);\n+    schema[prop.name] = tsTypeToZod(propType, checker);\n+  }\n+\n+  return schema;\n+}\n+\n+function tsTypeToZod(type: ts.Type, checker: ts.TypeChecker) {\n+  if (type.flags & ts.TypeFlags.String) return 'z.string()';\n+  if (type.flags & ts.TypeFlags.Number) return 'z.number()';\n+  return 'z.unknown()';\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/lib/schemaTransformer.ts', line: 4, description: 'Type checker is obtained via inline comment placeholder — actual implementation likely creates a new Program/TypeChecker per call, which is extremely expensive (seconds per call). Should reuse the existing Program from the transformer context.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/lib/schemaTransformer.ts', line: 14, description: 'tsTypeToZod only handles string and number — unions, arrays, objects, enums, and literals all fall through to z.unknown(), producing incorrect schemas.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/lib/schemaTransformer.ts', line: 5, description: 'No caching of inferred schemas — same type inferred repeatedly in large codebases, causing O(n^2) behavior. Should memoize by type ID.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/lib/schemaTransformer.ts', line: 14, description: 'Returns string literals like z.string() instead of actual Zod objects — the consumer must eval() or parse these strings, which is unsafe.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 2401, file: 'src/lib/schemaTransformer.ts', line: 4, category: 'performance', severity: 'blocking', what: 'Creating a type checker per call is extremely expensive.', why: 'TypeScript type checking is the most expensive operation. Reusing the existing checker is critical.', positive: false },
          { id: 2402, file: 'src/lib/schemaTransformer.ts', line: 14, category: 'correctness', severity: 'blocking', what: 'Only string and number are handled. Unions, arrays, and objects will silently produce z.unknown().', why: 'This defeats the purpose of schema inference for complex types.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Performance and coverage are blocking.' },
        responses: [
          { to_comment_id: 2401, move: 'change', content: 'Now accepts checker as parameter.', updated_code: 'export function inferSchema(typeNode: ts.TypeNode, checker: ts.TypeChecker) {' },
          { to_comment_id: 2402, move: 'change', content: 'Added union, array, and object handling.', updated_code: 'if (type.isUnion()) return `z.union([${type.types.map(t => tsTypeToZod(t, checker)).join(\',\')}])`; ...' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'Both fixes correct. Checker reuse and expanded type coverage look good.' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 2 of 4 bugs (checker reuse, type coverage). Missed caching and string return. Level 3-4.' },
      prioritization: { min: 3, max: 4, rationale: 'Both flagged as blocking. Level 3-4.' },
      revision_evaluation: { min: 3, max: 4, rationale: 'Verified checker parameter and expanded types. Level 3-4.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete performance and coverage rationales. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No questions. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested checker parameter and expanded types — actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-025-senior-rsc-hydration',
    description: 'Senior reviewer finds hydration issue and asks design questions. Good senior performance.',
    tags: ['typescript', 'react', 'rsc', 'mid-high-score'],
    seniority: 'senior',
    prContext: {
      title: 'Add server/client boundary component',
      description: 'A component that renders differently on server and client.',
      instructions: 'Review for React Server Components and hydration correctness.',
      diff: `diff --git a/src/components/Boundary.tsx b/src/components/Boundary.tsx\n@@ -0,0 +1,42 @@\n+import { useEffect, useState } from 'react';\n+\n+export function Boundary({ serverComponent, clientComponent }) {\n+  const [isClient, setIsClient] = useState(false);\n+\n+  useEffect(() => {\n+    setIsClient(true);\n+  }, []);\n+\n+  if (!isClient) {\n+    return <div>{serverComponent}</div>;\n+  }\n+\n+  return <div>{clientComponent}</div>;\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/components/Boundary.tsx', line: 10, description: 'Client and server render different content — React hydration will fail because the server HTML does not match the client DOM. Should use suppressHydrationWarning or ensure consistent initial render.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/components/Boundary.tsx', line: 4, description: 'useState(false) + useEffect causes a layout shift on hydration — the server renders serverComponent, then client immediately re-renders to clientComponent, causing visual flash. Should use initial props or CSS-based solution.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/components/Boundary.tsx', line: 1, description: 'Props are untyped — serverComponent and clientComponent should be ReactNode, not any. Also no validation that both are provided.', expectedFound: false },
      { id: 4, severity: 'minor', file: 'src/components/Boundary.tsx', line: 7, description: 'No fallback for environments where neither server nor client is defined (e.g., test environments).', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 2501, file: 'src/components/Boundary.tsx', line: 10, category: 'correctness', severity: 'blocking', what: 'Server and client render different content — hydration mismatch.', why: 'React requires server and client initial HTML to match. This will cause hydration errors.', positive: false },
          { id: 2502, file: 'src/components/Boundary.tsx', line: 4, category: 'ux', severity: 'blocking', what: 'Visual flash on hydration — server renders A, client immediately switches to B.', why: 'Users see a flicker. Need a no-JS-first approach or consistent initial state.', positive: false },
          { id: 2503, file: 'src/components/Boundary.tsx', line: 1, category: 'types', severity: 'suggestion', what: 'Props should be typed as ReactNode.', why: 'Type safety.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Hydration and flash are blocking. Typing is recommended.' },
        responses: [
          { to_comment_id: 2501, move: 'change', content: 'Added suppressHydrationWarning and consistent wrapper.', updated_code: "return <div suppressHydrationWarning>{isClient ? clientComponent : serverComponent}</div>;" },
          { to_comment_id: 2502, move: 'pushback', content: 'The serverComponent is a placeholder. The flash is acceptable for our use case.' },
          { to_comment_id: 2503, move: 'change', content: 'Added interface.', updated_code: 'interface BoundaryProps { serverComponent: React.ReactNode; clientComponent: React.ReactNode; }' },
        ],
      },
    ],
    finalVerdict: { decision: 'request_changes', summary: 'Hydration fix looks good. Still concerned about the flash — can we use CSS visibility instead of full swap?' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 2 of 4 bugs (hydration, flash). Missed prop typing and test env. Level 3-4.' },
      prioritization: { min: 3, max: 4, rationale: 'Hydration and flash as blocking. Typing as suggestion. Level 3-4.' },
      revision_evaluation: { min: 3, max: 4, rationale: 'Verified hydration fix. Pushed back on flash with counter-proposal (CSS visibility). Level 3-4.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete React hydration and UX rationales. Level 3-4.' },
      question_formation: { min: 3, max: 4, rationale: 'Implicit question about flash acceptability, leading to follow-up. Level 3-4.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested suppressHydrationWarning and CSS visibility — actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-026-senior-worker-threads',
    description: 'Senior reviewer finds thread safety issue and provides good direction. Solid senior performance.',
    tags: ['typescript', 'node', 'concurrency', 'mid-high-score'],
    seniority: 'senior',
    prContext: {
      title: 'Add worker thread pool',
      description: 'Manages a pool of worker threads for CPU-intensive scoring.',
      instructions: 'Review for concurrency and resource management.',
      diff: `diff --git a/src/lib/workerPool.ts b/src/lib/workerPool.ts\n@@ -0,0 +1,52 @@\n+import { Worker } from 'worker_threads';\n+\n+export class WorkerPool {\n+  private workers: Worker[] = [];\n+  private queue: Array<{ task: unknown; resolve: Function; reject: Function }> = [];\n+\n+  constructor(private size: number) {\n+    for (let i = 0; i < size; i++) {\n+      const worker = new Worker('./scorer.js');\n+      worker.on('message', (result) => {\n+        /* resolve task */\n+      });\n+      this.workers.push(worker);\n+    }\n+  }\n+\n+  run(task: unknown): Promise<unknown> {\n+    return new Promise((resolve, reject) => {\n+      this.queue.push({ task, resolve, reject });\n+      this.dispatch();\n+    });\n+  }\n+\n+  private dispatch() {\n+    const worker = this.workers.find((w) => !w.onmessage); // pseudo check\n+    if (worker && this.queue.length > 0) {\n+      const item = this.queue.shift()!;\n+      worker.postMessage(item.task);\n+    }\n+  }\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/lib/workerPool.ts', line: 7, description: 'Worker path is relative ./scorer.js — in bundled or distributed code, the worker script path may not resolve. Should use __dirname or workerData for path resolution.', expectedFound: true },
      { id: 2, severity: 'critical', file: 'src/lib/workerPool.ts', line: 9, description: 'Message handler is shared across all tasks — if a worker completes a task after a timeout, the wrong promise may be resolved. Need task ID correlation.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/lib/workerPool.ts', line: 22, description: 'No worker error handling — if a worker crashes, the pool loses a worker permanently and queued tasks stall. Should respawn crashed workers.', expectedFound: false },
      { id: 4, severity: 'major', file: 'src/lib/workerPool.ts', line: 18, description: 'No backpressure or queue limit — unbounded queue can grow until OOM under load. Should limit queue size and reject or shed load.', expectedFound: true },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 2601, file: 'src/lib/workerPool.ts', line: 7, category: 'correctness', severity: 'blocking', what: 'Worker path may not resolve in production builds.', why: 'Relative paths break with bundlers and monorepos. Use __dirname or resolve path at runtime.', positive: false },
          { id: 2602, file: 'src/lib/workerPool.ts', line: 9, category: 'correctness', severity: 'blocking', what: 'Message handler does not correlate responses with tasks.', why: 'Without task IDs, the wrong promise could be resolved on concurrent tasks.', positive: false },
          { id: 2603, file: 'src/lib/workerPool.ts', line: 18, category: 'performance', severity: 'blocking', what: 'Unbounded queue can OOM under load.', why: 'Need a max queue size with backpressure.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Three blocking issues: path, correlation, and backpressure.' },
        responses: [
          { to_comment_id: 2601, move: 'change', content: 'Using __dirname now.', updated_code: "new Worker(path.resolve(__dirname, 'scorer.js'))" },
          { to_comment_id: 2602, move: 'change', content: 'Added task IDs.', updated_code: "worker.postMessage({ taskId: ++this.taskId, task: item.task }); ... worker.on('message', ({ taskId, result }) => { const item = this.pending.get(taskId); ... });" },
          { to_comment_id: 2603, move: 'change', content: 'Added queue limit.', updated_code: "if (this.queue.length >= this.maxQueue) return Promise.reject(new Error('Queue full')); ... this.maxQueue = size * 10;" },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'All three fixes verified. Path resolution, task correlation, and backpressure look correct.' },
    expectedBands: {
      issue_identification: { min: 3, max: 4, rationale: 'Found 3 of 4 bugs (path, correlation, queue). Missed worker respawn. Level 3-4.' },
      prioritization: { min: 3, max: 4, rationale: 'All three flagged as blocking. Good triage. Level 3-4.' },
      revision_evaluation: { min: 3, max: 4, rationale: 'Verified all three fixes. Path and task ID changes are correct. Level 3-4.' },
      reasoning_quality: { min: 3, max: 4, rationale: 'Concrete concurrency and deployment rationales. Level 3-4.' },
      question_formation: { min: 2, max: 3, rationale: 'No questions. Level 2-3.' },
      ai_direction: { min: 3, max: 4, rationale: 'Suggested __dirname, task IDs, queue limit — all actionable. Level 3-4.' },
    },
  },

  {
    id: 'seed-027-senior-graphql-nplus-authz',
    description: 'Senior reviewer finds N+1 and authorization gap. Strong technical identification.',
    tags: ['typescript', 'node', 'graphql', 'high-score-senior'],
    seniority: 'senior',
    prContext: {
      title: 'Add GraphQL candidate resolver',
      description: 'GraphQL resolver for candidate data with nested assessments.',
      instructions: 'Review for performance and security.',
      diff: `diff --git a/src/graphql/candidateResolver.ts b/src/graphql/candidateResolver.ts\n@@ -0,0 +1,55 @@\n+export const candidateResolvers = {\n+  Query: {\n+    candidate: async (_: unknown, { id }: { id: string }, { db, user }) => {\n+      const candidate = await db.prepare('SELECT * FROM candidates WHERE id = ?1').bind(id).first();\n+      return candidate;\n+    },\n+  },\n+  Candidate: {\n+    assessments: async (parent: any, _: unknown, { db }) => {\n+      const rows = await db.prepare('SELECT * FROM assessments WHERE candidate_id = ?1').bind(parent.id).all();\n+      return rows.results;\n+    },\n+    scores: async (parent: any, _: unknown, { db }) => {\n+      const rows = await db.prepare('SELECT * FROM review_scores WHERE assessment_id IN (SELECT id FROM assessments WHERE candidate_id = ?1)').bind(parent.id).all();\n+      return rows.results;\n+    },\n+  },\n+};\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/graphql/candidateResolver.ts', line: 4, description: 'No authorization check — any authenticated user can query any candidate by ID. Missing org_id ownership verification.', expectedFound: true },
      { id: 2, severity: 'critical', file: 'src/graphql/candidateResolver.ts', line: 8, description: ' assessments resolver is N+1 — GraphQL will call this once per candidate in a list query. For 100 candidates this is 100 DB round-trips. Should use DataLoader.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/graphql/candidateResolver.ts', line: 4, description: 'SELECT * returns all columns including PII (email, phone). Should explicitly select only fields defined in the GraphQL schema.', expectedFound: true },
      { id: 4, severity: 'minor', file: 'src/graphql/candidateResolver.ts', line: 12, description: 'scores resolver uses IN subquery — functional but could be a single JOIN with GROUP BY for better performance.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 2701, file: 'src/graphql/candidateResolver.ts', line: 4, category: 'security', severity: 'blocking', what: 'No authorization — any user can query any candidate.', why: 'Must verify the requesting user owns the org that owns this candidate. Add org_id filter and user check.', positive: false },
          { id: 2702, file: 'src/graphql/candidateResolver.ts', line: 8, category: 'performance', severity: 'blocking', what: 'assessments resolver is N+1 for list queries.', why: 'GraphQL calls this per parent. Need DataLoader to batch fetch assessments by candidate_id.', positive: false },
          { id: 2703, file: 'src/graphql/candidateResolver.ts', line: 4, category: 'security', severity: 'suggestion', what: 'SELECT * returns all columns including PII.', why: 'Explicit column selection prevents data leaks when new columns are added.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Auth and N+1 are blocking. Column selection is recommended.' },
        responses: [
          { to_comment_id: 2701, move: 'change', content: 'Added user org check.', updated_code: "const candidate = await db.prepare('SELECT * FROM candidates WHERE id = ?1 AND org_id = ?2').bind(id, user.orgId).first(); if (!candidate) throw new Error('Not found');" },
          { to_comment_id: 2702, move: 'change', content: 'Added DataLoader.', updated_code: 'const assessmentLoader = new DataLoader(async (candidateIds: string[]) => { ... });' },
          { to_comment_id: 2703, move: 'change', content: 'Switched to explicit columns.', updated_code: 'SELECT id, name, email, stage_id FROM candidates' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'All fixes verified. Auth filter, DataLoader, and explicit columns look correct.' },
    expectedBands: {
      issue_identification: { min: 4, max: 5, rationale: 'Found 3 of 4 bugs (auth, N+1, SELECT *). Missed JOIN optimization. Excellent coverage. Level 4-5.' },
      prioritization: { min: 4, max: 5, rationale: 'Auth and N+1 as blocking. Column selection as suggestion. Perfect triage. Level 4-5.' },
      revision_evaluation: { min: 4, max: 5, rationale: 'Verified all three fixes. Auth pattern and DataLoader usage are correct. Level 4-5.' },
      reasoning_quality: { min: 4, max: 5, rationale: 'Concrete security and performance rationales with specific mechanisms. Level 4-5.' },
      question_formation: { min: 2, max: 3, rationale: 'No explicit questions. Level 2-3.' },
      ai_direction: { min: 4, max: 5, rationale: 'Suggested auth filter, DataLoader, explicit columns — all actionable and specific. Level 4-5.' },
    },
  },

  {
    id: 'seed-028-senior-virtual-list',
    description: 'Senior reviewer finds scroll bug and accessibility issue with deep reasoning. Strong senior performance.',
    tags: ['typescript', 'react', 'performance', 'high-score-senior'],
    seniority: 'senior',
    prContext: {
      title: 'Add virtual scroll list',
      description: 'Virtualized list for large candidate tables.',
      instructions: 'Review for performance and accessibility.',
      diff: `diff --git a/src/components/VirtualList.tsx b/src/components/VirtualList.tsx\n@@ -0,0 +1,58 @@\n+import { useRef, useState, useCallback } from 'react';\n+\n+export function VirtualList({ items, itemHeight, renderItem }) {\n+  const containerRef = useRef<HTMLDivElement>(null);\n+  const [scrollTop, setScrollTop] = useState(0);\n+\n+  const handleScroll = useCallback(() => {\n+    setScrollTop(containerRef.current?.scrollTop ?? 0);\n+  }, []);\n+\n+  const startIndex = Math.floor(scrollTop / itemHeight);\n+  const endIndex = startIndex + Math.ceil(500 / itemHeight);\n+  const visibleItems = items.slice(startIndex, endIndex);\n+\n+  return (\n+    <div ref={containerRef} onScroll={handleScroll} style={{ height: 500, overflow: 'auto' }}>\n+      <div style={{ height: items.length * itemHeight }}>\n+        {visibleItems.map((item, i) => (\n+          <div key={item.id} style={{ position: 'absolute', top: (startIndex + i) * itemHeight }}>\n+            {renderItem(item)}\n+          </div>\n+        ))}\n+      </div>\n+    </div>\n+  );\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/components/VirtualList.tsx', line: 16, description: 'Position absolute without relative parent — items are positioned relative to the nearest positioned ancestor, which may not be the scroll container. Causes items to render in wrong locations. The inner div should be position: relative.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/components/VirtualList.tsx', line: 12, description: 'No overscan — items at the edge of the viewport appear blank while scrolling fast. Should render 2-3 items above and below the visible range.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/components/VirtualList.tsx', line: 8, description: 'onScroll updates state every scroll event — high-frequency scroll events cause excessive React re-renders. Should throttle or use requestAnimationFrame.', expectedFound: true },
      { id: 4, severity: 'minor', file: 'src/components/VirtualList.tsx', line: 14, description: 'No aria attributes — screen readers see only the visible items and lose context of total list size. Should add aria-setsize and aria-posinset.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 2801, file: 'src/components/VirtualList.tsx', line: 16, category: 'correctness', severity: 'blocking', what: 'Position absolute needs a positioned parent. Items will render in wrong locations.', why: 'Without position: relative on the inner div, absolute positioning is relative to the viewport or nearest positioned ancestor.', positive: false },
          { id: 2802, file: 'src/components/VirtualList.tsx', line: 12, category: 'performance', severity: 'blocking', what: 'No overscan — blank gaps while scrolling fast.', why: 'Need 2-3 buffer rows above and below the viewport for smooth scrolling.', positive: false },
          { id: 2803, file: 'src/components/VirtualList.tsx', line: 8, category: 'performance', severity: 'blocking', what: 'onScroll updates state on every event — too many re-renders.', why: 'Should throttle or use rAF to batch scroll updates.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Three blocking issues: layout, overscan, and scroll performance.' },
        responses: [
          { to_comment_id: 2801, move: 'change', content: 'Added position: relative.', updated_code: "<div style={{ height: items.length * itemHeight, position: 'relative' }}>" },
          { to_comment_id: 2802, move: 'change', content: 'Added overscan.', updated_code: 'const overscan = 3; const visibleItems = items.slice(Math.max(0, startIndex - overscan), endIndex + overscan);' },
          { to_comment_id: 2803, move: 'change', content: 'Throttled scroll handler.', updated_code: "const handleScroll = useCallback(throttle(() => setScrollTop(containerRef.current?.scrollTop ?? 0), 16), []);" },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'All three fixes verified. Layout, overscan, and throttling look correct.' },
    expectedBands: {
      issue_identification: { min: 4, max: 5, rationale: 'Found 3 of 4 bugs (layout, overscan, throttle). Missed aria attributes. Level 4-5.' },
      prioritization: { min: 4, max: 5, rationale: 'All three flagged as blocking. Level 4-5.' },
      revision_evaluation: { min: 4, max: 5, rationale: 'Verified all three fixes. Layout and overscan changes are correct. Level 4-5.' },
      reasoning_quality: { min: 4, max: 5, rationale: 'Concrete CSS, performance, and React rationales. Level 4-5.' },
      question_formation: { min: 2, max: 3, rationale: 'No questions. Level 2-3.' },
      ai_direction: { min: 4, max: 5, rationale: 'Suggested position: relative, overscan, throttle — all actionable. Level 4-5.' },
    },
  },

  {
    id: 'seed-029-senior-schema-inference',
    description: 'Senior reviewer finds inference bug and mentors implementer. Strong technical and communication performance.',
    tags: ['typescript', 'types', 'high-score-senior'],
    seniority: 'senior',
    prContext: {
      title: 'Add schema inference engine',
      description: 'Infers Zod schemas from TypeScript interfaces at compile time.',
      instructions: 'Review for type system correctness and performance.',
      diff: `diff --git a/src/lib/inferSchema.ts b/src/lib/inferSchema.ts\n@@ -0,0 +1,48 @@\n+import ts from 'typescript';\n+import { z } from 'zod';\n+\n+export function inferSchema(sourceFile: ts.SourceFile, typeName: string) {\n+  const checker = /* get checker */;\n+  const type = checker.getTypeAtLocation(\n+    sourceFile.statements.find(\n+      (s): s is ts.TypeAliasDeclaration =>\n+        ts.isTypeAliasDeclaration(s) && s.name.text === typeName\n+    )!\n+  );\n+\n+  return typeToZod(type, checker);\n+}\n+\n+function typeToZod(type: ts.Type, checker: ts.TypeChecker): z.ZodTypeAny {\n+  if (type.flags & ts.TypeFlags.String) return z.string();\n+  if (type.flags & ts.TypeFlags.Number) return z.number();\n+  if (type.flags & ts.TypeFlags.Boolean) return z.boolean();\n+\n+  const properties = checker.getPropertiesOfType(type);\n+  if (properties.length > 0) {\n+    const shape: Record<string, z.ZodTypeAny> = {};\n+    for (const prop of properties) {\n+      shape[prop.name] = typeToZod(\n+        checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!),\n+        checker\n+      );\n+    }\n+    return z.object(shape);\n+  }\n+\n+  return z.unknown();\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/lib/inferSchema.ts', line: 4, description: 'Type checker is a comment placeholder — actual implementation likely creates a new Program per call, which is extremely expensive. Must reuse the existing TypeScript program/checker.', expectedFound: true },
      { id: 2, severity: 'major', file: 'src/lib/inferSchema.ts', line: 14, description: 'No handling for arrays, unions, enums, tuples, or intersections — these all fall through to z.unknown(), producing incorrect schemas for common types.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/lib/inferSchema.ts', line: 7, description: 'Non-null assertion (!) on find result — if typeName does not exist in the file, this throws at runtime. Should validate and throw a descriptive error.', expectedFound: true },
      { id: 4, severity: 'minor', file: 'src/lib/inferSchema.ts', line: 18, description: 'No memoization — recursive types will cause infinite recursion and stack overflow. Should cache visited types.', expectedFound: true },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 2901, file: 'src/lib/inferSchema.ts', line: 4, category: 'performance', severity: 'blocking', what: 'Creating a new TypeScript program per call is extremely expensive.', why: 'TypeScript type checking is the dominant cost. Reuse the existing checker from the transformer context.', positive: false, suggestion: 'Pass the checker as a parameter or store it in module state.' },
          { id: 2902, file: 'src/lib/inferSchema.ts', line: 14, category: 'correctness', severity: 'blocking', what: 'Arrays, unions, enums, and tuples all fall through to z.unknown().', why: 'These are common types. The schema inference will silently produce wrong validators.', positive: false, suggestion: 'Add cases for ts.TypeFlags.Array, type.isUnion(), and type.isEnumLiteral().' },
          { id: 2903, file: 'src/lib/inferSchema.ts', line: 7, category: 'correctness', severity: 'suggestion', what: 'Non-null assertion on find() result will throw a confusing error if typeName is missing.', why: 'Better to throw a descriptive error like `Type ${typeName} not found in file`.', positive: false },
          { id: 2904, file: 'src/lib/inferSchema.ts', line: 18, category: 'correctness', severity: 'suggestion', what: 'Recursive types will cause infinite recursion here.', why: 'interface Node { next: Node } will recurse forever. Add a visited Set keyed by type ID.', positive: false },
        ],
        verdict: { decision: 'request_changes', summary: 'Performance and coverage are blocking. Error handling and recursion are recommended.' },
        responses: [
          { to_comment_id: 2901, move: 'change', content: 'Refactored to accept checker parameter.', updated_code: 'export function inferSchema(checker: ts.TypeChecker, sourceFile: ts.SourceFile, typeName: string) {' },
          { to_comment_id: 2902, move: 'change', content: 'Added array, union, and enum handling.', updated_code: 'if (type.symbol?.name === "Array") return z.array(typeToZod((type as ts.TypeReference).typeArguments![0], checker)); if (type.isUnion()) return z.union(type.types.map(t => typeToZod(t, checker))); ...' },
          { to_comment_id: 2903, move: 'change', content: 'Added descriptive error.', updated_code: "const decl = sourceFile.statements.find(...); if (!decl) throw new Error(`Type ${typeName} not found in ${sourceFile.fileName}`);" },
          { to_comment_id: 2904, move: 'change', content: 'Added visited set.', updated_code: 'const visited = new Set<number>(); function typeToZod(type: ts.Type, checker: ts.TypeChecker): z.ZodTypeAny { if (visited.has(type.id)) return z.lazy(() => typeToZod(type, checker)); visited.add(type.id); ... }' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'All four fixes verified. Checker reuse, expanded types, error messages, and recursion guard are all correct.' },
    expectedBands: {
      issue_identification: { min: 4, max: 5, rationale: 'Found 4 of 4 bugs. Perfect coverage. Level 4-5.' },
      prioritization: { min: 4, max: 5, rationale: 'Performance and coverage as blocking. Error handling and recursion as suggestions. Excellent triage. Level 4-5.' },
      revision_evaluation: { min: 4, max: 5, rationale: 'Verified all four fixes. Recursion guard with lazy() is the correct pattern. Level 4-5.' },
      reasoning_quality: { min: 4, max: 5, rationale: 'Every comment explains the failure mechanism: type checking cost, silent wrong validators, confusing error, stack overflow. Level 4-5.' },
      question_formation: { min: 4, max: 5, rationale: 'Comments frame design choices as probing questions (e.g. "Should we use unique symbol instead of string intersection?") that elicit implementer intent and surface tradeoffs. Level 4-5.' },
      ai_direction: { min: 4, max: 5, rationale: 'Each suggestion includes a concrete implementation path. Level 4-5.' },
    },
  },

  {
    id: 'seed-030-senior-distributed-saga',
    description: 'Senior reviewer finds consistency issue and asks deep design questions. Excellent all-around performance with question_formation anchor at ~5.',
    tags: ['typescript', 'node', 'distributed-systems', 'high-score-anchor', 'question-formation-anchor'],
    seniority: 'senior',
    prContext: {
      title: 'Add distributed transaction saga',
      description: 'Saga pattern for multi-service candidate onboarding.',
      instructions: 'Review for distributed consistency and failure handling.',
      diff: `diff --git a/src/lib/onboardingSaga.ts b/src/lib/onboardingSaga.ts\n@@ -0,0 +1,62 @@\n+export class OnboardingSaga {\n+  private steps: Array<{\n+    service: string;\n+    action: () => Promise<void>;\n+    compensate: () => Promise<void>;\n+  }> = [];\n+\n+  addStep(service: string, action: () => Promise<void>, compensate: () => Promise<void>) {\n+    this.steps.push({ service, action, compensate });\n+  }\n+\n+  async execute() {\n+    const completed: number[] = [];\n+    for (let i = 0; i < this.steps.length; i++) {\n+      try {\n+        await this.steps[i].action();\n+        completed.push(i);\n+      } catch (err) {\n+        for (let j = completed.length - 1; j >= 0; j--) {\n+          await this.steps[j].compensate();\n+        }\n+        throw err;\n+      }\n+    }\n+  }\n+}\n`,
    },
    groundTruth: [
      { id: 1, severity: 'critical', file: 'src/lib/onboardingSaga.ts', line: 12, description: 'Compensation is not idempotent — if a compensation step fails and is retried, it may undo the same action twice or error out. Each compensate() must be idempotent with a deduplication key.', expectedFound: true },
      { id: 2, severity: 'critical', file: 'src/lib/onboardingSaga.ts', line: 12, description: 'No persistence of saga state — if the process crashes mid-saga, there is no record of which steps completed. On restart, the saga starts from scratch, potentially double-executing actions. Should persist state to a saga log.', expectedFound: true },
      { id: 3, severity: 'major', file: 'src/lib/onboardingSaga.ts', line: 12, description: 'Compensation ignores failures — if a compensation step throws, the error is swallowed and the loop continues. Failed compensations must be logged and escalated for manual intervention.', expectedFound: true },
      { id: 4, severity: 'major', file: 'src/lib/onboardingSaga.ts', line: 7, description: 'No timeout on action or compensation steps — a hanging service will block the saga forever. Should wrap each step in a timeout with circuit breaker.', expectedFound: true },
      { id: 5, severity: 'minor', file: 'src/lib/onboardingSaga.ts', line: 5, description: 'Saga is not reusable — the steps array is instance state, making the saga a singleton pattern. Should return a new saga instance per transaction.', expectedFound: false },
    ],
    rounds: [
      {
        round: 1,
        comments: [
          { id: 3001, file: 'src/lib/onboardingSaga.ts', line: 12, category: 'correctness', severity: 'blocking', what: 'Compensation is not idempotent. If a step fails and is retried, it may double-undo.', why: 'In distributed systems, retries are inevitable. Each compensate must be safe to run multiple times.', positive: false, suggestion: 'Add a deduplication key per step and check before compensating.' },
          { id: 3002, file: 'src/lib/onboardingSaga.ts', line: 12, category: 'reliability', severity: 'blocking', what: 'No saga state persistence. If the process crashes, we lose track of completed steps.', why: 'A crash between step 2 and step 3 means step 1 and 2 may re-execute on restart. Use a saga log table.', positive: false, suggestion: 'Persist each step transition to D1 before executing the next step.' },
          { id: 3003, file: 'src/lib/onboardingSaga.ts', line: 12, category: 'reliability', severity: 'blocking', what: 'Compensation failures are silently swallowed.', why: 'A failed compensation means the system is in an inconsistent state. This needs alerting and a dead-letter queue.', positive: false, suggestion: 'Catch compensation errors, log them, and publish to a DLQ for manual review.' },
          { id: 3004, file: 'src/lib/onboardingSaga.ts', line: 7, category: 'reliability', severity: 'suggestion', what: 'No timeouts on actions. A hanging service blocks the saga forever.', why: 'Each step should have a bounded execution time.', positive: false, suggestion: 'Wrap action and compensate in Promise.race with a timeout.' },
        ],
        verdict: { decision: 'request_changes', summary: 'Three blocking issues: idempotency, persistence, and compensation failure handling. Timeout is recommended.' },
        responses: [
          { to_comment_id: 3001, move: 'change', content: 'Added idempotency keys.', updated_code: 'const key = `compensate-${sagaId}-${stepIndex}`; if (await isCompensated(key)) return; ... await markCompensated(key);' },
          { to_comment_id: 3002, move: 'change', content: 'Added saga log persistence.', updated_code: 'await db.prepare("INSERT INTO saga_log (saga_id, step_index, status) VALUES (?1, ?2, ?3)").bind(sagaId, i, "completed").run();' },
          { to_comment_id: 3003, move: 'change', content: 'Added DLQ on compensation failure.', updated_code: 'try { await step.compensate(); } catch (e) { await dlq.publish({ sagaId, stepIndex: j, error: e }); throw new CompensationFailedError(sagaId, j); }' },
          { to_comment_id: 3004, move: 'change', content: 'Added 30s timeout.', updated_code: 'await Promise.race([step.action(), sleep(30000).then(() => { throw new TimeoutError(); })]);' },
        ],
      },
      {
        round: 2,
        comments: [
          { id: 3005, file: 'src/lib/onboardingSaga.ts', line: 7, category: 'design', severity: 'blocking', what: 'The timeout is fixed at 30s. Is that appropriate for all steps?', why: 'Some steps (e.g., email verification) may need minutes, while others (e.g., DB insert) should fail fast. A one-size-fits-all timeout will either timeout legitimate long operations or wait too long for fast ones.', positive: false, suggestion: 'Make timeout per-step configurable with sensible defaults.' },
        ],
        verdict: { decision: 'request_changes', summary: 'Timeout should be per-step, not global. Otherwise all fixes look correct.' },
        responses: [
          { to_comment_id: 3005, move: 'change', content: 'Made timeout configurable per step.', updated_code: 'addStep(service, action, compensate, { timeoutMs: 5000 })' },
        ],
      },
    ],
    finalVerdict: { decision: 'approve', summary: 'All fixes verified. Idempotency, saga log, DLQ, and per-step timeouts are all correct. Excellent iteration on the timeout design question.' },
    expectedBands: {
      issue_identification: { min: 4, max: 5, rationale: 'Found 4 of 5 bugs (idempotency, persistence, compensation failure, timeout). Missed saga reusability. Excellent coverage. Level 4-5.' },
      prioritization: { min: 4, max: 5, rationale: 'Three critical issues flagged as blocking. Timeout as suggestion initially, then elevated to blocking in round 2 with reasoning. Perfect triage evolution. Level 4-5.' },
      revision_evaluation: { min: 4, max: 5, rationale: 'Round 2 behavior is key: reviewer re-examined the timeout fix, identified a design flaw (global timeout), and elevated it to blocking with specific reasoning. Level 4-5.' },
      reasoning_quality: { min: 4, max: 5, rationale: 'Every comment explains the failure mechanism: double-undo, crash recovery, inconsistent state, bounded execution. Round 2 reasoning about per-step timeouts shows explicit tradeoff analysis. Level 4-5.' },
      question_formation: { min: 4, max: 5, rationale: 'Round 2 comment is framed as a design question that surfaced a second-order issue: "Is 30s appropriate for all steps?" This is a probing question that elicits design intent and exposes a flaw. Level 4-5.' },
      ai_direction: { min: 4, max: 5, rationale: 'Each comment includes a concrete suggestion: deduplication key, saga log table, DLQ, Promise.race. Round 2 suggests per-step config. Level 4-5.' },
    },
  },
];
