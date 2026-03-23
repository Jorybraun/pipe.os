/**
 * seedIntelligenceReport.ts
 *
 * Creates a complete end-to-end data fixture for the Intelligence Report:
 *   Pipeline → Stage → CODE_REVIEW Challenge
 *   Candidate (COMPLETED)
 *   Assessment with:
 *     - Rich submission (4 annotations: 1 critical, 2 major, 1 minor)
 *     - Verdict + written summary
 *     - followUpQuestionsJson (3 questions + answers)
 *     - score: 72
 *     - feedback: structured AgenticFeedback JSON (simulates Mistral output)
 *
 * Usage:
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=pass npx tsx scripts/seedIntelligenceReport.ts
 *
 * Output: playwright/intelligence-report-token.json
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

// ─── Challenge content ────────────────────────────────────────────────────────

const CACHED_DIFF_JSON = {
  files: [
    {
      path: 'src/auth/tokenValidator.ts',
      status: 'modified',
      additions: 12,
      deletions: 8,
      hunks: [
        {
          header: '@@ -1,20 +1,24 @@',
          lines: [
            { type: 'context',  lineNumber: 1,  content: 'import jwt from \'jsonwebtoken\';' },
            { type: 'context',  lineNumber: 2,  content: '' },
            { type: 'context',  lineNumber: 3,  content: 'const SECRET = process.env.JWT_SECRET;' },
            { type: 'deletion', lineNumber: 4,  content: 'export function validateToken(token: string): boolean {' },
            { type: 'addition', lineNumber: 4,  content: 'export function validateToken(token: string): any {' },
            { type: 'context',  lineNumber: 5,  content: '  try {' },
            { type: 'deletion', lineNumber: 6,  content: '    const decoded = jwt.verify(token, SECRET!);' },
            { type: 'addition', lineNumber: 6,  content: '    const decoded = jwt.verify(token, SECRET ?? \'\');' },
            { type: 'addition', lineNumber: 7,  content: '    return decoded;' },
            { type: 'context',  lineNumber: 8,  content: '  } catch (e) {' },
            { type: 'deletion', lineNumber: 9,  content: '    return false;' },
            { type: 'addition', lineNumber: 9,  content: '    console.log(\'Token error:\', e);' },
            { type: 'addition', lineNumber: 10, content: '    return null;' },
            { type: 'context',  lineNumber: 11, content: '  }' },
            { type: 'context',  lineNumber: 12, content: '}' },
            { type: 'addition', lineNumber: 14, content: 'export function getUserFromToken(token: string) {' },
            { type: 'addition', lineNumber: 15, content: '  const payload = validateToken(token);' },
            { type: 'addition', lineNumber: 16, content: '  return payload?.userId;' },
            { type: 'addition', lineNumber: 17, content: '}' },
          ],
        },
      ],
    },
  ],
};

const SERVER_CONFIG = {
  groundTruth: [
    {
      line: 6,
      type: 'security_bug',
      severity: 'critical',
      explanation: 'Fallback to empty string when SECRET is undefined — jwt.verify with empty secret accepts any token signed with empty string, creating a complete auth bypass.',
    },
    {
      line: 4,
      type: 'type_safety',
      severity: 'major',
      explanation: 'Return type changed from boolean to any — callers now lose type safety and may trust null as a valid auth result.',
    },
    {
      line: 9,
      type: 'error_handling',
      severity: 'major',
      explanation: 'Logging raw JWT errors leaks token internals (algorithm, expiry, claims) to console — a security and compliance issue in production.',
    },
  ],
};

// ─── Submission (what the candidate submitted) ────────────────────────────────

const SUBMISSION = {
  verdict: 'request_changes',
  summary: 'This PR has a critical security issue in the fallback to empty-string secret. When JWT_SECRET is undefined, the validator silently accepts tokens signed with an empty secret — any attacker who knows this can mint valid tokens. The type change to `any` is also concerning; callers like getUserFromToken now receive null on failure without any TypeScript protection. I would not approve this without addressing both issues. The helper function itself is reasonable once the security problem is fixed.',
  annotations: [
    {
      lineNumber: 6,
      file: 'src/auth/tokenValidator.ts',
      severity: 'critical',
      comment: 'Fallback `SECRET ?? \'\'` is a silent auth bypass. If JWT_SECRET is not set at runtime, jwt.verify will succeed for any token signed with an empty string. This should throw loudly at startup if the secret is missing, not fail silently at verify-time.',
    },
    {
      lineNumber: 4,
      file: 'src/auth/tokenValidator.ts',
      severity: 'major',
      comment: 'Return type `any` removes all TypeScript guarantees. Callers like getUserFromToken now do `payload?.userId` on an `any` without realising null is a valid return on failure. Should be `JwtPayload | false` or a discriminated union.',
    },
    {
      lineNumber: 9,
      file: 'src/auth/tokenValidator.ts',
      severity: 'major',
      comment: 'Logging the raw error object exposes JWT internals to the console — in production this leaks algorithm, expiry, and audience claims. Use a structured logger at warn level with only the error code, not the full error object.',
    },
    {
      lineNumber: 16,
      file: 'src/auth/tokenValidator.ts',
      severity: 'minor',
      comment: 'Optional chaining `payload?.userId` silently returns undefined when validateToken returns null (error path). Callers will get undefined userId with no indication that auth failed. Should check the null return explicitly.',
    },
  ],
};

// ─── Follow-up Q&A ────────────────────────────────────────────────────────────

const q1Id = uuidv4();
const q2Id = uuidv4();
const q3Id = uuidv4();

const FOLLOW_UP_QA = {
  generatedAt: new Date().toISOString(),
  questions: [
    {
      id: q1Id,
      question: 'You flagged the empty-string fallback as critical. What would a secure fix look like — and how would you ensure the application fails safely if JWT_SECRET is not configured?',
      context: 'Critical annotation on line 6',
    },
    {
      id: q2Id,
      question: 'The `any` return type change seems superficially minor, but you ranked it as major. Can you walk through a concrete scenario where this type erasure leads to a real bug in a downstream caller?',
      context: 'Major annotation on line 4',
    },
    {
      id: q3Id,
      question: 'This codebase uses JWT for auth. Beyond fixing these specific lines, are there any broader patterns or architectural concerns you\'d raise in a code review comment — for example around key rotation, token revocation, or short-lived tokens?',
      context: 'System design depth probe',
    },
  ],
  answers: [
    {
      questionId: q1Id,
      answer: 'The fix is to assert the secret at startup, not at call time. In practice I\'d do: `const SECRET = process.env.JWT_SECRET; if (!SECRET) throw new Error(\'JWT_SECRET must be set\');` — outside the function, at module load. This turns a silent runtime failure into a loud startup crash, which is exactly what you want for a misconfigured secret. The validator itself should then use `SECRET` without the nullish fallback. In AWS you\'d store the secret in Secrets Manager and use a Lambda extension to inject it as an env var, so it\'s never undefined in a correctly deployed environment.',
      answeredAt: new Date().toISOString(),
    },
    {
      questionId: q2Id,
      answer: 'Sure — consider getUserFromToken. It does `payload?.userId`. If validateToken returns null (the error path), `payload?.userId` evaluates to undefined, not false. If the caller does `if (getUserFromToken(token)) grantAccess()` they might think a null return is falsy and safe — but if they later change to `const userId = getUserFromToken(token); db.query(userId)` they\'ll query with undefined, which in some ORMs maps to "no WHERE clause" and returns everything. The original boolean return made the failure mode unambiguous. With `any`, TypeScript can\'t catch this. A discriminated union like `{ ok: true; payload: JwtPayload } | { ok: false }` would make both paths explicit.',
      answeredAt: new Date().toISOString(),
    },
    {
      questionId: q3Id,
      answer: 'A few things I\'d mention in the review comments: First, token revocation — JWTs are stateless by default so a compromised token is valid until expiry. I\'d ask whether there\'s a deny-list (Redis or DynamoDB) for revoked tokens, especially for a logout or breach response. Second, short expiry + refresh — if the access token TTL is long (e.g. 7 days) it dramatically raises the blast radius of a leak; I\'d recommend 15-minute access tokens with a separate short-lived refresh token stored in an HttpOnly cookie. Third, algorithm pinning — jwt.verify without specifying `algorithms: [\'RS256\']` will accept HS256 tokens, which means if an attacker can force the algorithm choice they can potentially forge tokens. Always pin the algorithm in verify options.',
      answeredAt: new Date().toISOString(),
    },
  ],
};

// ─── Agentic feedback (simulates Mistral scoring output) ──────────────────────

const AGENTIC_FEEDBACK = {
  score: 82,
  summary: 'Strong security-focused review. The candidate correctly identified the critical JWT secret fallback vulnerability and articulated the downstream type-safety consequences with a concrete attack scenario. Their follow-up answers demonstrate real depth — they proposed startup-time assertion patterns, discussed token revocation architecture, and showed awareness of algorithm pinning. Minor gaps: they missed the console.log info leakage in their initial annotations (caught only when prompted), and the written summary could be more concise. Overall a YES hire signal for a senior backend or security-aware fullstack role.',
  strengths: [
    'Immediately identified the silent auth bypass as critical and explained the mechanism precisely',
    'Demonstrated concrete downstream reasoning — traced how `any` return type leads to undefined userId in ORM queries',
    'Showed system-level security awareness: token revocation, algorithm pinning, short-lived refresh tokens unprompted',
    'Well-structured written summary with clear verdict rationale',
  ],
  concerns: [
    'Did not flag the console.log error leakage in initial review — only addressed it in follow-up',
    'Written summary was verbose; a senior reviewer would be more concise under time pressure',
  ],
  skillProfile: {
    bugIdentification: 88,
    severityJudgment: 85,
    analyticalWriting: 75,
    technicalDepth: 91,
  },
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
    console.log('[seedIntelligenceReport] Signed in as', username);

    // Pipeline
    const { data: pipeline, errors: pipelineErrors } = await client.models.Pipeline.create({
      title: 'Intelligence Report Demo Pipeline',
      status: 'ACTIVE',
      creationMode: 'BLANK',
    });
    if (pipelineErrors) throw new Error(pipelineErrors[0].message);
    if (!pipeline) throw new Error('Pipeline null');
    console.log('[seedIntelligenceReport] Pipeline:', pipeline.id);

    // Stage
    const { data: stage, errors: stageErrors } = await client.models.Stage.create({
      pipelineId: pipeline.id,
      title: 'Security Code Review',
      order: 0,
    });
    if (stageErrors) throw new Error(stageErrors[0].message);
    if (!stage) throw new Error('Stage null');
    console.log('[seedIntelligenceReport] Stage:', stage.id);

    // Challenge
    const { data: challenge, errors: challengeErrors } = await client.models.Challenge.create({
      stageId: stage.id,
      type: 'CODE_REVIEW',
      title: 'Review: JWT token validator refactor',
      instructions: 'Review the changes to tokenValidator.ts. This PR modifies the JWT verification logic. Identify any security issues, type safety problems, or error handling concerns. Select a verdict and write a summary of your findings.',
      order: 0,
      githubPrTitle: 'refactor: simplify token validation and add getUserFromToken helper',
      githubPrDescription: 'Simplifies the token validator and adds a convenience helper for extracting userId from a JWT.',
      cachedDiffJson: JSON.stringify(CACHED_DIFF_JSON),
      cachedMetadata: JSON.stringify({
        prNumber: 42,
        branch: 'refactor/token-validator',
        base: 'main',
        author: 'alex-dev',
        additions: 12,
        deletions: 8,
        filesChanged: 1,
      }),
      config: JSON.stringify({ version: 1 }),
      serverConfig: JSON.stringify(SERVER_CONFIG),
    });
    if (challengeErrors) throw new Error(challengeErrors[0].message);
    if (!challenge) throw new Error('Challenge null');
    console.log('[seedIntelligenceReport] Challenge:', challenge.id);

    // Candidate (COMPLETED)
    const inviteToken = `intel-demo-${uuidv4().slice(0, 8)}`;
    const { data: candidate, errors: candidateErrors } = await client.models.Candidate.create({
      pipelineId: pipeline.id,
      name: 'Alex Rivera',
      email: 'alex.rivera@example.com',
      inviteToken,
      status: 'COMPLETED',
    });
    if (candidateErrors) throw new Error(candidateErrors[0].message);
    if (!candidate) throw new Error('Candidate null');
    console.log('[seedIntelligenceReport] Candidate:', candidate.id);

    // Assessment with full scored data
    const { data: assessment, errors: assessmentErrors } = await client.models.Assessment.create({
      candidateId: candidate.id,
      challengeId: challenge.id,
      submission: JSON.stringify(SUBMISSION),
      followUpQuestionsJson: JSON.stringify(FOLLOW_UP_QA),
      score: AGENTIC_FEEDBACK.score,
      feedback: JSON.stringify(AGENTIC_FEEDBACK),
      completedAt: new Date().toISOString(),
    });
    if (assessmentErrors) throw new Error(assessmentErrors[0].message);
    if (!assessment) throw new Error('Assessment null');
    console.log('[seedIntelligenceReport] Assessment:', assessment.id, '| score:', AGENTIC_FEEDBACK.score);

    // Write token file
    const output = {
      candidateId: candidate.id,
      pipelineId: pipeline.id,
      challengeId: challenge.id,
      assessmentId: assessment.id,
      inviteToken,
    };
    writeFileSync(
      join(process.cwd(), 'playwright/intelligence-report-token.json'),
      JSON.stringify(output, null, 2),
    );

    console.log('[seedIntelligenceReport] ✓ Wrote playwright/intelligence-report-token.json');
    console.log('[seedIntelligenceReport] Candidate profile URL: /candidates/' + candidate.id);
  } finally {
    await signOut();
  }
}

main().catch((err: unknown) => {
  console.error('[seedIntelligenceReport] Fatal:', err);
  process.exit(1);
});
