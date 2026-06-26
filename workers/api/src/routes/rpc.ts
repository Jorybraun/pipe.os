/**
 * RPC routes — Phase 3 Candidate Flow
 *
 * Candidate-facing routes authenticated via custom JWT session tokens.
 * No Clerk. No sign-in required.
 *
 * Routes:
 *   POST /rpc/resolve-token      — Public: validate invite token, issue JWT
 *   POST /rpc/get-stage-config   — Candidate JWT: return current stage metadata
 *   POST /rpc/get-challenge      — Candidate JWT: return challenge content by order
 *   POST /rpc/refresh-session    — Public: reissue JWT from expired token
 */

import { Hono } from 'hono';
import { signJwt, verifyJwt } from '../lib/jwt';
import { candidateAuth, type CandidateVariables } from '../middleware/candidateAuth';
import { review } from './assessment/review';
import { repo } from './assessment/repo';
import { devContainer, devContainerProxyPublic } from './assessment/devContainer';
import { fetchGitHubDiff } from '../lib/fetchGitHubDiff';
import { cultureCandidate } from './screening/culture';
import { scoreImplementationSubmission } from '../lib/implementationScorer/implementationScorer';
import { processResumeFromR2 } from '../lib/enrichment/resumeIngestion';
import { runCandidateIngestion } from '../lib/candidateDiscovery/orchestrate';
import type { Env } from '../types';
import { matchReposForCandidateNeo4j } from '../lib/neo4j/matchingQueries';
import { matchReposByGroundedEdges } from '../lib/neo4j/contextualGraph';
import { matchRepos } from '../lib/repoDiscovery/matchRepos';
import {
  pickImplementationIssue,
  buildMatchRequest,
  matchImplementationReposByRoleConcepts,
} from '../lib/match/autoStageBuilder';
import { upsertCandidateChallengeAssignment } from '../lib/candidateDiscovery/persist';
import { hasSourceBackedReviewPacket, loadSourceBackedReviewDiff } from '../lib/review/sourceBackedReviewDiff';
import { createNeo4jDriver, buildNeo4jConfig } from '../lib/neo4j/driver';
import {
  loadRoleChallengeSemantics,
  matchCandidateToReviewChallenge,
} from '../lib/challengeMatching';

// ─── Blocking gate for post-screener enrichment ─────────────────────────────

interface WaitingChallenge {
  id: string;
  type: 'WAITING_FOR_MATCH';
  title: string;
  instructions: string;
  config: {
    autoRefresh: boolean;
    refreshIntervalSeconds: number;
    estimatedSecondsRemaining: number;
  };
}

interface GateResult {
  blocked: boolean;
  reason?: string;
  syntheticChallenge?: WaitingChallenge;
}

function waitingForMatch(reason: string): GateResult {
  return {
    blocked: true,
    reason,
    syntheticChallenge: {
      id: 'waiting-for-match',
      type: 'WAITING_FOR_MATCH',
      title: 'Building your personalized challenge',
      instructions: 'We are analyzing your profile to find the best open-source project match. This takes 2–3 minutes.',
      config: {
        autoRefresh: true,
        refreshIntervalSeconds: 30,
        estimatedSecondsRemaining: 180,
      },
    },
  };
}

async function checkMatchingGate(
  db: D1Database,
  candidateId: string,
  pipelineId: string,
  stageId: string,
  challengeId: string,
  nextChallengeType: string,
  env: Env,
): Promise<GateResult> {
  const isCodeStage = ['CODE_REVIEW', 'CODE_IMPLEMENTATION'].includes(nextChallengeType);
  if (!isCodeStage) {
    return { blocked: false };
  }

  const pipelineConfig = await db.prepare(
    `SELECT match_philosophy FROM pipeline_match_config WHERE pipeline_id = ?1`
  ).bind(pipelineId).first<{ match_philosophy: string | null }>();

  const isValidate = pipelineConfig?.match_philosophy === 'validate';
  if (isValidate) {
    return { blocked: false };
  }

  // 1. Check if assignment already exists for this candidate + stage
  const existingAssignment = await db.prepare(
    `SELECT id, github_repo_url, github_pr_number
       FROM candidate_challenge_assignment
      WHERE candidate_id = ?1 AND stage_id = ?2`,
  ).bind(candidateId, stageId).first<{
    id: string;
    github_repo_url: string | null;
    github_pr_number: number | null;
  }>();

  if (existingAssignment) {
    if (nextChallengeType !== 'CODE_REVIEW') {
      return { blocked: false };
    }
    if (
      existingAssignment.github_repo_url
      && existingAssignment.github_pr_number
      && await hasSourceBackedReviewPacket(
        db,
        existingAssignment.github_repo_url,
        existingAssignment.github_pr_number,
      )
    ) {
      return { blocked: false };
    }
    console.warn(
      `[checkMatchingGate] refreshing stale CODE_REVIEW assignment without source-backed graph context for candidate ${candidateId}`,
    );
  }

  if (nextChallengeType === 'CODE_REVIEW') {
    const roleContext = await db.prepare(
      `SELECT id, persona_json, rcd_json, job_description_md, non_negotiable_skills_json
         FROM role_contexts
        WHERE pipeline_id = ?1
        ORDER BY updated_at DESC
        LIMIT 1`,
    ).bind(pipelineId).first<{
      id: string;
      persona_json: string | null;
      rcd_json: string | null;
      job_description_md: string | null;
      non_negotiable_skills_json: string | null;
    }>();
    if (!roleContext) {
      return waitingForMatch('Role context is not ready for deterministic challenge matching');
    }

    const roleSemantics = await loadRoleChallengeSemantics(db, {
      ...roleContext,
      rcd_version: (() => {
        if (!roleContext.rcd_json) return null;
        try {
          const parsed = JSON.parse(roleContext.rcd_json) as { rcd_version?: unknown };
          return typeof parsed.rcd_version === 'string' ? parsed.rcd_version : null;
        } catch {
          return null;
        }
      })(),
    });
    const match = await matchCandidateToReviewChallenge(db, candidateId, {
      roleContextId: roleContext.id,
      roleSnapshotId: roleSemantics.roleSnapshotId,
      roleConcepts: roleSemantics.relevantConcepts,
      requiredConcepts: roleSemantics.requiredConcepts,
      conceptResolverVersion: roleSemantics.resolverVersion,
      roleSourceReferences: roleSemantics.sources.map((source) => ({
        entityId: source.roleNodeId,
        locator: source.sourceSection ?? 'role_context',
        conceptKeys: source.conceptKeys,
        sourceRefType: source.sourceRefType,
        sourceRefId: source.sourceRefId,
        sourceSpanId: source.sourceSpanId,
        exactText: source.exactText,
        contentHash: source.contentHash,
      })),
    });
    if (match.status !== 'MATCHED' || !match.repoId || !match.prNumber) {
      return waitingForMatch(`Deterministic challenge matcher returned ${match.status}`);
    }

    const repo = await db.prepare(
      `SELECT github_url FROM qualified_repos WHERE id = ?1`,
    ).bind(match.repoId).first<{ github_url: string | null }>();
    if (!repo?.github_url) {
      return waitingForMatch('Matched challenge repository is unavailable');
    }

    await upsertCandidateChallengeAssignment(db, {
      id: crypto.randomUUID(),
      candidateId,
      stageId,
      challengeId,
      repoId: match.repoId,
      githubRepoUrl: repo.github_url,
      githubPrNumber: match.prNumber,
      issueNumber: null,
    });
    return { blocked: false };
  }

  // CODE_REVIEW returns above through matchCandidateToReviewChallenge. From
  // here down, repo recall is only for CODE_IMPLEMENTATION issue selection;
  // Neo4j projections must not become candidate-to-PR authority.
  if (nextChallengeType !== 'CODE_IMPLEMENTATION') {
    return waitingForMatch(`Unsupported code challenge type ${nextChallengeType}`);
  }

  const roleContext = await db.prepare(
    `SELECT id, persona_json, rcd_json, job_description_md, non_negotiable_skills_json
       FROM role_contexts
      WHERE pipeline_id = ?1
      ORDER BY updated_at DESC
      LIMIT 1`,
  ).bind(pipelineId).first<{
    id: string;
    persona_json: string | null;
    rcd_json: string | null;
    job_description_md: string | null;
    non_negotiable_skills_json: string | null;
  }>();
  const roleSemantics = roleContext
    ? await loadRoleChallengeSemantics(db, {
      ...roleContext,
      rcd_version: (() => {
        if (!roleContext.rcd_json) return null;
        try {
          const parsed = JSON.parse(roleContext.rcd_json) as { rcd_version?: unknown };
          return typeof parsed.rcd_version === 'string' ? parsed.rcd_version : null;
        } catch {
          return null;
        }
      })(),
    })
    : null;
  const roleConcepts = roleSemantics?.relevantConcepts ?? [];
  const requiredConcepts = roleSemantics?.requiredConcepts ?? [];

  // 2. No assignment — use source-backed implementation issue context first.
  let repoId: number | null = null;
  let githubRepoUrl: string | null = null;

  if (roleConcepts.length > 0) {
    try {
      const contextMatches = await matchImplementationReposByRoleConcepts(
        db,
        roleConcepts,
        requiredConcepts,
        5,
      );
      const top = contextMatches[0];
      if (top) {
        repoId = top.id;
        githubRepoUrl = top.githubUrl;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[checkMatchingGate] source-backed implementation matching failed for candidate ${candidateId}:`, msg);
    }
    if (!repoId) {
      return waitingForMatch('No source-backed implementation repo matched role evidence');
    }
  } else {
    // Compatibility path for legacy pipelines with no source-backed role context.
    const primaryStore = env.PRIMARY_MATCH_STORE ?? 'neo4j';
    if (primaryStore === 'neo4j') {
      let neo4jConfig = buildNeo4jConfig(env);
      if (!neo4jConfig) {
        neo4jConfig = { uri: 'bolt://localhost:7687', user: 'neo4j', password: 'pipe-local-dev' };
      }

      let driver;
      try {
        driver = createNeo4jDriver(neo4jConfig);
        // ADR-050: prefer grounded SIMILAR_TO edge traversal (multi-region
        // structural overlap); fall back to cosine ranking when the candidate
        // has no grounded edges yet.
        const groundedResults = await matchReposByGroundedEdges(driver, candidateId, { topK: 5 });
        if (groundedResults.length > 0) {
          const top = groundedResults[0]!;
          repoId = top.repoId;
          githubRepoUrl = `https://github.com/${top.fullName}`;
        } else {
          const neo4jResults = await matchReposForCandidateNeo4j(driver, candidateId, { topK: 5 });
          if (neo4jResults.length > 0) {
            const top = neo4jResults[0]!;
            repoId = top.repo_id;
            githubRepoUrl = `https://github.com/${top.full_name}`;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[checkMatchingGate] Neo4j matching failed for candidate ${candidateId}:`, msg);
      } finally {
        if (driver) {
          try {
            await driver.close();
          } catch {
            // ignore close errors
          }
        }
      }
    }

    // Fallback to D1 SQL matcher if Neo4j returned nothing or failed.
    if (!repoId && roleContext) {
      try {
        const matchRequest = buildMatchRequest(roleContext as any);
        const d1Results = await matchRepos(db, matchRequest);
        if (d1Results.length > 0) {
          const top = d1Results[0]!;
          repoId = top.id;
          githubRepoUrl = top.githubUrl;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[checkMatchingGate] D1 fallback matching failed for candidate ${candidateId}:`, msg);
      }
    }
  }

  if (!repoId || !githubRepoUrl) {
    return waitingForMatch('No matching repos found for candidate');
  }

  // 3. Pick challenge content based on type
  let prNumber: number | null = null;
  let issueNumber: number | null = null;

  const issueResult = await pickImplementationIssue(
    db,
    repoId,
    undefined,
    roleConcepts,
  );
  if (!issueResult) {
    return waitingForMatch('No eligible implementation issue found for matched repo');
  }
  issueNumber = issueResult.issueNumber;

  // 4. Write assignment
  const assignmentId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO candidate_challenge_assignment
       (id, candidate_id, stage_id, challenge_id, repo_id, github_repo_url, github_pr_number, issue_number)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(assignmentId, candidateId, stageId, challengeId, repoId, githubRepoUrl, prNumber, issueNumber).run();

  return { blocked: false };
}

// ─── Standalone CV intake & code review (no pipeline / no stage rows) ───────

const INTAKE_CHALLENGE_CONTENT = {
  id: 'intake-upload',
  type: 'INTAKE',
  title: 'Upload Your CV',
  instructions: 'Please upload your CV/resume so we can learn more about your background.',
  config: JSON.stringify({ acceptedFormats: ['pdf', 'docx', 'doc'], maxSizeMb: 10 }),
};

const STANDALONE_WAITING_CHALLENGE = {
  id: 'waiting-for-match',
  type: 'WAITING_FOR_MATCH',
  title: 'Building your personalized challenge',
  instructions: 'We are analyzing your profile to find the best open-source project match.',
  config: {
    autoRefresh: true,
    refreshIntervalSeconds: 30,
  },
};

interface StandaloneReviewRow {
  id: string;
  status: string;
  matched_repo_id: number | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
  submission_json: string | null;
}

interface StandaloneDevContainerRow {
  id: string;
  status: string;
  matched_repo_id: number | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
  submission_json: string | null;
}

async function getPendingStandaloneReview(
  db: D1Database,
  candidateId: string,
): Promise<StandaloneReviewRow | null> {
  try {
    return await db.prepare(
      `SELECT id, status, matched_repo_id, github_repo_url, github_pr_number, submission_json
       FROM scheduled_interviews
       WHERE candidate_id = ?1 AND interview_type = 'CODE_REVIEW' AND stage_id IS NULL
         AND status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(candidateId).first<StandaloneReviewRow>();
  } catch (err) {
    console.error('[standaloneReview] lookup failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function getPendingDevContainerChallenge(
  db: D1Database,
  candidateId: string,
): Promise<StandaloneDevContainerRow | null> {
  try {
    return await db.prepare(
      `SELECT id, status, matched_repo_id, github_repo_url, github_pr_number, submission_json
       FROM scheduled_interviews
       WHERE candidate_id = ?1 AND interview_type = 'DEV_CONTAINER_CHALLENGE' AND stage_id IS NULL
         AND status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(candidateId).first<StandaloneDevContainerRow>();
  } catch (err) {
    console.error('[standaloneDevContainer] lookup failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** True when the candidate has neither a stored resume nor any graph nodes yet. */
async function candidateNeedsCvIntake(db: D1Database, candidateId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT c.resume_s3_key,
            (SELECT COUNT(*) FROM candidate_nodes cn WHERE cn.candidate_id = c.id) AS node_count
     FROM candidates c WHERE c.id = ?1`,
  ).bind(candidateId).first<{ resume_s3_key: string | null; node_count: number }>();
  if (!row) return false;
  return !row.resume_s3_key && (row.node_count ?? 0) === 0;
}

/** True when a pipeline code stage should be gated behind CV intake for this candidate. */
async function stageRequiresCvIntake(db: D1Database, candidateId: string, stageId: string): Promise<boolean> {
  const assignment = await db.prepare(
    `SELECT id FROM candidate_challenge_assignment WHERE candidate_id = ?1 AND stage_id = ?2`,
  ).bind(candidateId, stageId).first<{ id: string }>();
  if (assignment) return false;
  return candidateNeedsCvIntake(db, candidateId);
}

/**
 * Match a standalone code-review interview to a repo + PR from the candidate's
 * graph alone (no role context). The match is cached on the scheduled_interviews
 * row because standalone sessions have no stage/challenge rows to hold an
 * assignment.
 */
async function matchStandaloneReview(
  db: D1Database,
  candidateId: string,
  interview: StandaloneReviewRow,
): Promise<{ repoUrl: string; prNumber: number } | null> {
  if (interview.github_repo_url && interview.github_pr_number) {
    const isSourceBacked = await hasSourceBackedReviewPacket(
      db,
      interview.github_repo_url,
      interview.github_pr_number,
    );
    if (isSourceBacked) {
      return { repoUrl: interview.github_repo_url, prNumber: interview.github_pr_number };
    }
    console.warn(
      `[standaloneReview] ignoring stale cached PR without source-backed graph context for ${candidateId}`,
    );
  }

  const match = await matchCandidateToReviewChallenge(db, candidateId);
  if (match.status !== 'MATCHED' || !match.repoId || !match.prNumber) {
    console.log(`[standaloneReview] deterministic matcher returned ${match.status} for ${candidateId}`);
    return null;
  }
  const repo = await db.prepare(
    `SELECT github_url FROM qualified_repos WHERE id = ?1`,
  ).bind(match.repoId).first<{ github_url: string | null }>();
  if (!repo?.github_url) return null;

  await db.prepare(
    `UPDATE scheduled_interviews
     SET matched_repo_id = ?1, github_repo_url = ?2, github_pr_number = ?3, updated_at = ?4
     WHERE id = ?5`,
  ).bind(match.repoId, repo.github_url, match.prNumber, new Date().toISOString(), interview.id).run();
  return { repoUrl: repo.github_url, prNumber: match.prNumber };
}

/** Parse a submission (object or JSON string) and return it if it is a CV intake payload.
 *  Recognizes both R2-based uploads ({ resumeR2Key }) and text-based evidence ({ resumeText }).
 */
function parseIntakePayload(submission: unknown): Record<string, unknown> | null {
  let obj: unknown = submission;
  if (typeof submission === 'string') {
    try {
      obj = JSON.parse(submission);
    } catch {
      return null;
    }
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const record = obj as Record<string, unknown>;
  if (typeof record.resumeR2Key === 'string') return record;
  if (typeof record.resumeText === 'string' && record.resumeText.length > 0) return record;
  return null;
}

/** Persist intake form data (resume / github / linkedin) and kick off enrichment. */
async function handleIntakePayload(
  env: Env,
  executionCtx: ExecutionContext,
  candidateId: string,
  submission: unknown,
  now: string,
): Promise<void> {
  let intakePayload: Record<string, unknown> = {};
  try {
    intakePayload = typeof submission === 'string' ? (JSON.parse(submission) as Record<string, unknown>) : (submission as Record<string, unknown>);
  } catch {
    intakePayload = {};
  }

  const resumeR2Key = typeof intakePayload.resumeR2Key === 'string' ? intakePayload.resumeR2Key : '';
  const resumeText = typeof intakePayload.resumeText === 'string' ? intakePayload.resumeText.trim() : '';
  const githubHandle = typeof intakePayload.githubHandle === 'string' ? intakePayload.githubHandle : '';
  const linkedinUrl = typeof intakePayload.linkedinUrl === 'string' ? intakePayload.linkedinUrl : '';

  // 1a. R2-based resume upload — fetch and ingest from object storage
  if (resumeR2Key) {
    try {
      await env.DB.prepare(`UPDATE candidates SET resume_s3_key = ?1, updated_at = ?2 WHERE id = ?3`)
        .bind(resumeR2Key, now, candidateId)
        .run();
    } catch (err) {
      console.error(`[rpc/intake] failed to update candidate resume key:`, err);
    }

    executionCtx.waitUntil(
      (async () => {
        try {
          const result = await processResumeFromR2({
            env,
            db: env.DB,
            candidateId,
            r2Key: resumeR2Key,
          });
          console.log(`[rpc/intake] resume ingestion for candidate ${candidateId}:`, result.success);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[rpc/intake] resume ingestion failed for ${candidateId}:`, msg);
        }
      })(),
    );
  } else if (resumeText.length >= 20) {
    // 1b. Text-based resume evidence — run ingestion directly from plain text
    // Mark candidate as having a synthetic resume key so candidateNeedsCvIntake() returns false
    const syntheticKey = `text-intake/${candidateId}/${now}`;
    try {
      await env.DB.prepare(`UPDATE candidates SET resume_s3_key = ?1, updated_at = ?2 WHERE id = ?3`)
        .bind(syntheticKey, now, candidateId)
        .run();
    } catch (err) {
      console.error(`[rpc/intake] failed to set synthetic resume key:`, err);
    }

    executionCtx.waitUntil(
      (async () => {
        try {
          await runCandidateIngestion({
            env,
            db: env.DB,
            candidateId,
            parsed: { skills: [], experiences: [], educationBlocks: [], credentials: [], projects: [] },
            resumeText,
          });
          console.log(`[rpc/intake] text-based ingestion completed for candidate ${candidateId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[rpc/intake] text-based ingestion failed for ${candidateId}:`, msg);
        }
      })(),
    );
  }

  // 2. Queue GitHub enrichment
  if (githubHandle) {
    const githubUrl = `https://github.com/${githubHandle}`;
    try {
      await env.DB.prepare(
        `INSERT INTO candidate_ingestion (candidate_id, github_url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(candidate_id) DO UPDATE SET
           github_url = excluded.github_url,
           updated_at = excluded.updated_at`,
      )
        .bind(candidateId, githubUrl, now)
        .run();

      await env.DB.prepare(
        `INSERT INTO enrichment_jobs (id, candidate_id, source_type, source_url, status, created_at)
         VALUES (?1, ?2, 'github', ?3, 'PENDING', unixepoch())`,
      )
        .bind(crypto.randomUUID(), candidateId, githubUrl)
        .run();

      console.log(`[rpc/intake] queued github enrichment for candidate ${candidateId}`);
    } catch (err) {
      console.error(`[rpc/intake] failed to queue github enrichment:`, err);
    }
  }

  // 3. Store LinkedIn URL
  if (linkedinUrl) {
    try {
      await env.DB.prepare(
        `INSERT INTO candidate_ingestion (candidate_id, linkedin_url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(candidate_id) DO UPDATE SET
           linkedin_url = excluded.linkedin_url,
           updated_at = excluded.updated_at`,
      )
        .bind(candidateId, linkedinUrl, now)
        .run();
      console.log(`[rpc/intake] stored linkedin url for candidate ${candidateId}`);
    } catch (err) {
      console.error(`[rpc/intake] failed to store linkedin url:`, err);
    }
  }
}

// ─── Public routes (no auth) ────────────────────────────────────────────────

const rpcPublic = new Hono<{ Bindings: Env }>();

// ── POST /rpc/resolve-token ─────────────────────────────────────────────────

rpcPublic.post('/resolve-token', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const inviteToken = body.inviteToken;

  if (!inviteToken || typeof inviteToken !== 'string' || inviteToken.trim() === '') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'inviteToken is required.' } }, 400);
  }

  const trimmed = inviteToken.trim();

  // Reject already-claimed tokens
  if (trimmed.startsWith('CLAIMED::')) {
    return c.json({ error: { code: 'CONFLICT', message: 'Token already claimed.' } }, 409);
  }

  // Look up candidate by invite token
  const candidate = await c.env.DB.prepare(
    `SELECT id, pipeline_id, status, name
     FROM candidates
     WHERE invite_token = ?1
     LIMIT 1`,
  )
    .bind(trimmed)
    .first<{
      id: string;
      pipeline_id: string | null;
      status: string;
      name: string | null;
    }>();

  if (!candidate) {
    // Check if the token was already claimed (handles sessionStorage loss scenario)
    const claimedCandidate = await c.env.DB.prepare(
      `SELECT id, status, name
       FROM candidates
       WHERE invite_token = ?1
       LIMIT 1`,
    )
      .bind(`CLAIMED::${trimmed}`)
      .first<{
        id: string;
        status: string;
        name: string | null;
      }>();

    if (claimedCandidate) {
      return c.json({
        error: { code: 'CONFLICT', message: 'This invite link has already been used. Please contact your recruiter for a new link.' },
        status: claimedCandidate.status,
      }, 409);
    }

    return c.json({ error: { code: 'NOT_FOUND', message: 'Invalid invite token.' } }, 404);
  }

  // Block completed candidates
  if (candidate.status === 'COMPLETED') {
    return c.json({
      error: { code: 'FORBIDDEN', message: 'You have already completed this assessment.' },
      status: 'COMPLETED',
    }, 403);
  }

  const secret = c.env.SESSION_TOKEN_SECRET;
  if (!secret) {
    console.error('[resolve-token] SESSION_TOKEN_SECRET not configured');
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Auth not configured.' } }, 500);
  }

  // Issue JWT session token
  const sessionToken = await signJwt(
    { sub: candidate.id, pid: candidate.pipeline_id },
    secret,
  );

  // Claim the invite token atomically (one-time use)
  const result = await c.env.DB.prepare(
    `UPDATE candidates
     SET invite_token = ?1, status = CASE WHEN status = 'INVITED' THEN 'IN_PROGRESS' ELSE status END, updated_at = ?2
     WHERE id = ?3 AND invite_token = ?4`,
  )
    .bind(`CLAIMED::${trimmed}`, new Date().toISOString(), candidate.id, trimmed)
    .run();

  // If no rows affected, token was claimed by concurrent request
  if (result.meta.changes === 0) {
    return c.json({ error: { code: 'CONFLICT', message: 'Token was already claimed.' } }, 409);
  }

  return c.json({
    id: candidate.id,
    pipelineId: candidate.pipeline_id,
    status: candidate.status === 'INVITED' ? 'IN_PROGRESS' : candidate.status,
    name: candidate.name,
    sessionToken,
  });
});

// ── POST /rpc/refresh-session ───────────────────────────────────────────────

rpcPublic.post('/refresh-session', async (c) => {
  const authHeader = c.req.header('Authorization');
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing session token.' } }, 401);
  }

  const secret = c.env.SESSION_TOKEN_SECRET;
  if (!secret) {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Auth not configured.' } }, 500);
  }

  // Verify signature but IGNORE expiry — this is the refresh flow
  const payload = await verifyJwt(token, secret, true);
  if (!payload) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid session token.' } }, 401);
  }

  // Check candidate still exists and is not completed
  const candidate = await c.env.DB.prepare(
    `SELECT id, status FROM candidates WHERE id = ?1`,
  )
    .bind(payload.sub)
    .first<{ id: string; status: string }>();

  if (!candidate) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Candidate not found.' } }, 404);
  }

  if (candidate.status === 'COMPLETED') {
    return c.json({
      error: { code: 'FORBIDDEN', message: 'Assessment already completed.' },
    }, 403);
  }

  // Issue fresh JWT
  const sessionToken = await signJwt(
    { sub: payload.sub, pid: payload.pid },
    secret,
  );

  return c.json({ sessionToken });
});

// ─── Authenticated routes (candidate JWT) ───────────────────────────────────

const rpcAuth = new Hono<{ Bindings: Env; Variables: CandidateVariables }>();

rpcAuth.use('*', candidateAuth);

// ── POST /rpc/get-stage-config ──────────────────────────────────────────────

rpcAuth.post('/get-stage-config', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  // Fetch candidate to get owner_id and current_stage_id for Assessment creation
  const candidate = await c.env.DB.prepare(
    `SELECT id, pipeline_id, owner_id, current_stage_id, resume_s3_key FROM candidates WHERE id = ?1`,
  )
    .bind(candidateId)
    .first<{ id: string; pipeline_id: string | null; owner_id: string | null; current_stage_id: string | null; resume_s3_key: string | null }>();

  if (!candidate) {
    return c.json({ isComplete: false, error: 'Candidate not found' });
  }
  const candidateRow = candidate; // narrow for nested function capture

  // Pipeline-free candidate (talent pool / standalone code review)
  if (!candidateRow.pipeline_id) {
    const needsResume = !candidateRow.resume_s3_key;
    const standaloneReview = await getPendingStandaloneReview(c.env.DB, candidateId);

    // Standalone code-review interview: once the CV is in, serve the review stage
    if (!needsResume && standaloneReview) {
      return c.json({
        isComplete: false,
        stageId: 'standalone-code-review',
        candidateId,
        stageTitle: 'Code Review',
        mode: 'ASYNC',
        timeLimit: null,
        challenges: [{ type: 'CODE_REVIEW', order: 0, title: 'Code Review' }],
        currentIndex: 0,
      });
    }

    // Standalone dev-container challenge interview: once the CV is in, serve the challenge stage
    const standaloneDevContainer = await getPendingDevContainerChallenge(c.env.DB, candidateId);
    if (!needsResume && standaloneDevContainer) {
      return c.json({
        isComplete: false,
        stageId: 'standalone-dev-container',
        candidateId,
        stageTitle: 'Dev Container Challenge',
        mode: 'ASYNC',
        timeLimit: null,
        challenges: [{ type: 'CODE_IMPLEMENTATION', order: 0, title: 'Dev Container Challenge' }],
        currentIndex: 0,
      });
    }

    const hasPendingStandalone = standaloneReview || standaloneDevContainer;
    return c.json({
      isComplete: !needsResume && !hasPendingStandalone,
      stageId: 'talent-pool-intake',
      candidateId,
      stageTitle: needsResume
        ? 'Upload Your CV'
        : hasPendingStandalone
          ? (standaloneDevContainer ? 'Dev Container Challenge' : 'Code Review Interview')
          : 'Thank You',
      mode: 'INTAKE',
      timeLimit: null,
      challenges: needsResume
        ? [{ type: 'INTAKE', order: 0, title: 'Profile & Resume' }]
        : [],
      upcoming: needsResume && hasPendingStandalone
        ? [{ type: standaloneDevContainer ? 'CODE_IMPLEMENTATION' : 'CODE_REVIEW', title: standaloneDevContainer ? 'Dev Container Challenge' : 'Code Review' }]
        : [],
      currentIndex: 0,
    });
  }

  // At this point pipeline_id is guaranteed non-null (early return above handles null)
  // Use DB value rather than JWT — candidate may have been assigned a pipeline after token issuance
  const effectivePipelineId = candidateRow.pipeline_id as string;

  // Fetch all stages with challenges in a single JOIN query
  // Include config so we can filter out empty/unconfigured challenges
  const rows = await c.env.DB.prepare(`
    SELECT
      s.id AS stage_id,
      s.title AS stage_title,
      s.sort_order AS stage_order,
      s.mode AS stage_mode,
      s.time_limit,
      s.screening_input_mode,
      s.video_config,
      ch.id AS challenge_id,
      ch.type AS challenge_type,
      ch.title AS challenge_title,
      ch.sort_order AS challenge_order,
      ch.config AS challenge_config,
      ch.instructions AS challenge_instructions
    FROM stages s
    LEFT JOIN challenges ch ON ch.stage_id = s.id
    WHERE s.pipeline_id = ?1
    ORDER BY s.sort_order ASC, ch.sort_order ASC
  `)
    .bind(effectivePipelineId)
    .all();

  if (!rows.results || rows.results.length === 0) {
    return c.json({ isComplete: true });
  }

  // Group by stage
  const stageMap = new Map<
    string,
    {
      id: string;
      title: string;
      order: number;
      mode: string | null;
      timeLimit: number | null;
      screeningInputMode: string | null;
      videoConfig: string | null;
      challenges: Array<{ id: string; type: string; title: string; order: number }>;
    }
  >();

  for (const row of rows.results) {
    const r = row as Record<string, unknown>;
    const sid = r.stage_id as string;
    if (!stageMap.has(sid)) {
      stageMap.set(sid, {
        id: sid,
        title: r.stage_title as string,
        order: r.stage_order as number,
        mode: (r.stage_mode as string | null) ?? null,
        timeLimit: (r.time_limit as number | null) ?? null,
        screeningInputMode: (r.screening_input_mode as string | null) ?? null,
        videoConfig: (r.video_config as string | null) ?? null,
        challenges: [],
      });
    }
    if (r.challenge_id) {
      // Filter out empty/unconfigured challenges — candidates should never see
      // placeholder challenges that have no meaningful content (Bug #11 fix).
      const rawConfig = r.challenge_config as string | null;
      const instructions = r.challenge_instructions as string | null;
      let hasContent = !!(instructions && instructions.trim().length > 0);
      if (rawConfig) {
        try {
          const parsed = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
          // A challenge has content if config has any truthy values
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            hasContent = true;
          }
        } catch {
          // Invalid JSON config — treat as empty
        }
      }

      if (hasContent) {
        stageMap.get(sid)!.challenges.push({
          id: r.challenge_id as string,
          type: r.challenge_type as string,
          title: (r.challenge_title as string) ?? 'Challenge',
          order: r.challenge_order as number,
        });
      }
    }
  }

  const stages = [...stageMap.values()].sort((a, b) => a.order - b.order);

  // Helper: evaluate a single stage and return config if it has unsubmitted challenges
  async function evaluateStage(stage: typeof stages[0]): Promise<Response | null> {
    if (stage.challenges.length === 0) return null;

    const subs = await c.env.DB.prepare(`
      SELECT cs.challenge_id
      FROM challenge_submissions cs
      JOIN assessments a ON a.id = cs.assessment_id
      WHERE a.candidate_id = ?1 AND a.stage_id = ?2
    `)
      .bind(candidateId, stage.id)
      .all();

    const submittedIds = new Set(
      (subs.results ?? []).map(
        (r) => (r as Record<string, unknown>).challenge_id as string,
      ),
    );

    let currentIndex = -1;
    for (let i = 0; i < stage.challenges.length; i++) {
      if (!submittedIds.has(stage.challenges[i]!.id)) {
        currentIndex = i;
        break;
      }
    }

    if (currentIndex === -1) return null;

    const existingAssessment = await c.env.DB.prepare(
      `SELECT id FROM assessments WHERE candidate_id = ?1 AND stage_id = ?2 LIMIT 1`,
    )
      .bind(candidateId, stage.id)
      .first<{ id: string }>();

    if (!existingAssessment) {
      const nextChallenge = stage.challenges[currentIndex];
      if (!nextChallenge) {
        return null;
      }
      // Code stages need a candidate graph before matching can run — if the
      // candidate has no CV and no graph yet, gate the stage behind CV intake.
      if (
        ['CODE_REVIEW', 'CODE_IMPLEMENTATION'].includes(nextChallenge.type) &&
        (await stageRequiresCvIntake(c.env.DB, candidateId, stage.id))
      ) {
        await c.env.DB.prepare(
          `UPDATE candidates SET current_stage_id = ?1 WHERE id = ?2`,
        )
          .bind(stage.id, candidateId)
          .run();
        return c.json({
          isComplete: false,
          stageId: stage.id,
          candidateId,
          stageTitle: stage.title,
          mode: 'INTAKE',
          timeLimit: null,
          challenges: [{ type: 'INTAKE', order: 0, title: 'Profile & Resume' }],
          upcoming: stage.challenges.map((ch) => ({ type: ch.type, title: ch.title })),
          currentIndex: 0,
        });
      }

      const gateResult = await checkMatchingGate(c.env.DB, candidateId, effectivePipelineId, stage.id, nextChallenge.id, nextChallenge.type, c.env);
      if (gateResult.blocked && gateResult.syntheticChallenge) {
        return c.json({
          isComplete: false,
          stageId: stage.id,
          candidateId,
          stageTitle: stage.title,
          mode: stage.mode ?? 'ASYNC',
          timeLimit: stage.timeLimit,
          screeningInputMode: stage.screeningInputMode,
          challenges: [{ type: 'WAITING_FOR_MATCH', title: gateResult.syntheticChallenge.title, order: 0 }],
          currentIndex: 0,
          waitingChallenge: gateResult.syntheticChallenge,
        });
      }

      const assessmentId = crypto.randomUUID();
      const now = new Date().toISOString();
      await c.env.DB.prepare(`
        INSERT INTO assessments (id, candidate_id, stage_id, status, owner_id, started_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'PENDING', ?4, ?5, ?5, ?5)
      `)
        .bind(assessmentId, candidateId, stage.id, candidateRow.owner_id, now)
        .run();
    }

    await c.env.DB.prepare(
      `UPDATE candidates SET current_stage_id = ?1 WHERE id = ?2`,
    )
      .bind(stage.id, candidateId)
      .run();

    const syntheticChallenges: Array<{ type: string; order: number }> = [];
    syntheticChallenges.push({ type: 'WELCOME', order: -2 });
    if (stage.mode === 'LIVE_VIDEO') {
      syntheticChallenges.push({ type: 'LIVE_VIDEO', order: -1 });
    }

    const allChallenges = [...syntheticChallenges, ...stage.challenges];
    const indexedChallenges = allChallenges.map((ch, i) => ({ type: ch.type, title: (ch as Record<string, unknown>).title as string | undefined, order: i }));
    const syntheticCount = syntheticChallenges.length;
    const hasSubmissions = currentIndex > 0;
    const adjustedIndex = hasSubmissions ? currentIndex + syntheticCount : 0;

    return c.json({
      isComplete: false,
      stageId: stage.id,
      candidateId,
      stageTitle: stage.title,
      mode: stage.mode ?? 'ASYNC',
      timeLimit: stage.timeLimit,
      screeningInputMode: stage.screeningInputMode,
      challenges: indexedChallenges,
      currentIndex: adjustedIndex,
    });
  }

  // If candidate has an explicit current_stage_id,
  // try that stage first so candidates start where they were assigned.
  if (candidate.current_stage_id) {
    const targetStage = stages.find((s) => s.id === candidate.current_stage_id);
    if (targetStage) {
      const targetConfig = await evaluateStage(targetStage);
      if (targetConfig) return targetConfig;
    }
  }

  // Walk stages to find the first with un-submitted challenges
  for (const stage of stages) {
    const result = await evaluateStage(stage);
    if (result) return result;
  }

  // All stages complete
  return c.json({ isComplete: true });
});

// ── POST /rpc/get-challenge ─────────────────────────────────────────────────

rpcAuth.post('/get-challenge', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const order = body.order;
  if (typeof order !== 'number' || order < 0 || !Number.isInteger(order)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'order must be a non-negative integer.' } },
      400,
    );
  }

  // Pipeline-free candidate: INTAKE first, then standalone code review or dev container if invited
  if (!pipelineId) {
    if (await candidateNeedsCvIntake(c.env.DB, candidateId)) {
      return c.json(INTAKE_CHALLENGE_CONTENT);
    }

    // Check for standalone dev-container challenge first
    const standaloneDevContainer = await getPendingDevContainerChallenge(c.env.DB, candidateId);
    if (standaloneDevContainer) {
      const repoUrl = standaloneDevContainer.github_repo_url;
      if (!repoUrl) {
        return c.json(STANDALONE_WAITING_CHALLENGE);
      }
      return c.json({
        id: `standalone-dev-container-${standaloneDevContainer.id}`,
        type: 'CODE_IMPLEMENTATION',
        title: 'Dev Container Challenge',
        instructions: 'Complete the coding challenge in the dev container workspace provided below.',
        config: JSON.stringify({ starterCode: '' }),
        cachedDiffJson: null,
        githubPrTitle: null,
        githubPrNumber: standaloneDevContainer.github_pr_number ?? null,
        githubRepoUrl: repoUrl,
        githubPrDescription: null,
        devContainerRepoUrl: repoUrl,
      });
    }

    const standaloneReview = await getPendingStandaloneReview(c.env.DB, candidateId);
    if (!standaloneReview) {
      return c.json(INTAKE_CHALLENGE_CONTENT);
    }

    const match = await matchStandaloneReview(c.env.DB, candidateId, standaloneReview);
    if (!match) {
      return c.json(STANDALONE_WAITING_CHALLENGE);
    }

    let cachedDiffJson: unknown = null;
    let githubPrTitle: string | null = null;
    let githubPrDescription: string | null = null;
    const sourceBackedDiff = await loadSourceBackedReviewDiff(c.env.DB, match.repoUrl, match.prNumber);
    if (sourceBackedDiff) {
      cachedDiffJson = sourceBackedDiff.diff;
      githubPrTitle = sourceBackedDiff.metadata.title;
      githubPrDescription = sourceBackedDiff.metadata.description ?? null;
    }

    if (!cachedDiffJson) return c.json(STANDALONE_WAITING_CHALLENGE);

    return c.json({
      id: `standalone-review-${standaloneReview.id}`,
      type: 'CODE_REVIEW',
      title: 'Code Review',
      instructions: 'Review this pull request as if a teammate opened it: call out bugs, risks, design concerns, and suggestions.',
      config: null,
      cachedDiffJson,
      githubPrTitle,
      githubPrNumber: match.prNumber,
      githubRepoUrl: match.repoUrl,
      githubPrDescription,
      devContainerRepoUrl: null,
    });
  }

  // Find candidate's current stage
  const candidate = await c.env.DB.prepare(
    `SELECT current_stage_id FROM candidates WHERE id = ?1`,
  )
    .bind(candidateId)
    .first<{ current_stage_id: string | null }>();

  if (!candidate?.current_stage_id) {
    return c.json({ error: 'No active stage' }, 404);
  }

  // Determine synthetic challenge count for this stage
  const stageInfo = await c.env.DB.prepare(
    `SELECT mode, screening_input_mode FROM stages WHERE id = ?1`
  )
    .bind(candidate.current_stage_id)
    .first<{ mode: string | null; screening_input_mode: string | null }>();

  const syntheticCount = 1 + (stageInfo?.mode === 'LIVE_VIDEO' ? 1 : 0); // WELCOME + optional LIVE_VIDEO

  // Return synthetic challenges without DB lookup
  if (order < syntheticCount) {
    const syntheticType = order === 0 ? 'WELCOME' : 'LIVE_VIDEO';
    return c.json({
      id: `synthetic-${syntheticType.toLowerCase()}`,
      type: syntheticType,
      title: syntheticType === 'WELCOME' ? 'Welcome' : 'Video Interview',
      instructions: null,
      config: null,
      cachedDiffJson: null,
      githubPrTitle: null,
      githubPrNumber: null,
      githubRepoUrl: null,
      githubPrDescription: null,
      devContainerRepoUrl: null,
    });
  }

  // Adjust order to account for synthetic entries
  const dbOrder = order - syntheticCount;

  // Fetch challenges for the current stage, ordered.
  // LEFT JOIN candidate_challenge_assignment to apply per-candidate overrides.
  const challenges = await c.env.DB.prepare(`
    SELECT
      ch.id, ch.type, ch.title, ch.instructions, ch.config,
      ch.cached_diff_json, ch.github_pr_title, ch.github_pr_number,
      ch.github_repo_url, ch.github_pr_description,
      ch.dev_container_repo_url,
      cca.id as assignment_id,
      cca.github_repo_url as assignment_repo_url,
      cca.github_pr_number as assignment_pr_number,
      COALESCE(cca.github_repo_url, ch.github_repo_url) as effective_repo_url,
      COALESCE(cca.github_pr_number, ch.github_pr_number) as effective_pr_number,
      COALESCE(cca.issue_number, NULL) as effective_issue_number
    FROM challenges ch
    LEFT JOIN candidate_challenge_assignment cca
      ON cca.challenge_id = ch.id AND cca.candidate_id = ?2
    WHERE ch.stage_id = ?1
    ORDER BY ch.sort_order ASC
  `)
    .bind(candidate.current_stage_id, candidateId)
    .all();

  const rows = challenges.results ?? [];

  if (dbOrder >= rows.length) {
    return c.json({ error: 'Challenge not found at this order index' }, 404);
  }

  const ch = rows[dbOrder] as Record<string, unknown>;

  // Use the LEFT JOIN result to skip matching when an assignment already exists
  let hasAssignment = !!(ch.assignment_id as string | null);
  if (!hasAssignment) {
    const gateResult = await checkMatchingGate(c.env.DB, candidateId, pipelineId as string, candidate.current_stage_id, ch.id as string, ch.type as string, c.env);
    if (gateResult.blocked && gateResult.syntheticChallenge) {
      return c.json(gateResult.syntheticChallenge);
    }
  } else if (
    ch.type === 'CODE_REVIEW'
    && typeof ch.assignment_repo_url === 'string'
    && typeof ch.assignment_pr_number === 'number'
    && !(await hasSourceBackedReviewPacket(
      c.env.DB,
      ch.assignment_repo_url,
      ch.assignment_pr_number,
    ))
  ) {
    const gateResult = await checkMatchingGate(
      c.env.DB,
      candidateId,
      pipelineId as string,
      candidate.current_stage_id,
      ch.id as string,
      ch.type as string,
      c.env,
    );
    if (gateResult.blocked && gateResult.syntheticChallenge) {
      return c.json(gateResult.syntheticChallenge);
    }
    const refreshed = await c.env.DB.prepare(
      `SELECT github_repo_url, github_pr_number, issue_number
         FROM candidate_challenge_assignment
        WHERE candidate_id = ?1 AND stage_id = ?2`,
    ).bind(candidateId, candidate.current_stage_id).first<{
      github_repo_url: string | null;
      github_pr_number: number | null;
      issue_number: number | null;
    }>();
    if (!refreshed?.github_repo_url || typeof refreshed.github_pr_number !== 'number') {
      return c.json(waitingForMatch('Source-backed review assignment is not ready').syntheticChallenge);
    }
    ch.effective_repo_url = refreshed.github_repo_url;
    ch.effective_pr_number = refreshed.github_pr_number;
    ch.effective_issue_number = refreshed.issue_number;
  }

  if ((ch.type as string) === 'CODE_REVIEW') {
    const currentAssignment = await c.env.DB.prepare(
      `SELECT id, github_repo_url, github_pr_number, issue_number
         FROM candidate_challenge_assignment
        WHERE candidate_id = ?1 AND stage_id = ?2`,
    ).bind(candidateId, candidate.current_stage_id).first<{
      id: string;
      github_repo_url: string | null;
      github_pr_number: number | null;
      issue_number: number | null;
    }>();
    if (currentAssignment) {
      hasAssignment = true;
      ch.assignment_id = currentAssignment.id;
      ch.assignment_repo_url = currentAssignment.github_repo_url;
      ch.assignment_pr_number = currentAssignment.github_pr_number;
      ch.effective_repo_url = currentAssignment.github_repo_url;
      ch.effective_pr_number = currentAssignment.github_pr_number;
      ch.effective_issue_number = currentAssignment.issue_number;
    }
  }

  // Apply per-candidate overrides from the LEFT JOIN
  if (ch.effective_repo_url) {
    ch.github_repo_url = ch.effective_repo_url;
  }
  if (typeof ch.effective_pr_number === 'number') {
    ch.github_pr_number = ch.effective_pr_number;
  }

  // Parse config JSON if stored as string
  let config: unknown = null;
  if (ch.config) {
    try {
      config =
        typeof ch.config === 'string' ? JSON.parse(ch.config) : ch.config;
    } catch {
      config = null;
    }
  }

  // Inject stage-level screening_input_mode into QUIZ_SHORT_ANSWER challenges
  // so candidates see the format (text / voice / video) configured by the recruiter.
  // Challenge-level config takes precedence — only fall back to stage default when
  // the challenge itself has not explicitly set an inputMode.
  if ((ch.type as string) === 'QUIZ_SHORT_ANSWER' && stageInfo?.screening_input_mode) {
    const cfg = (config ?? {}) as Record<string, unknown>;
    if (!cfg.inputMode) {
      cfg.inputMode = stageInfo.screening_input_mode;
      config = cfg;
    }
  }

  // Parse cached diff JSON if stored as string
  let cachedDiffJson: unknown = null;
  const assignmentBackedReview = (ch.type as string) === 'CODE_REVIEW' && hasAssignment;
  if (!assignmentBackedReview && ch.cached_diff_json) {
    try {
      cachedDiffJson =
        typeof ch.cached_diff_json === 'string'
          ? JSON.parse(ch.cached_diff_json as string)
          : ch.cached_diff_json;
    } catch {
      cachedDiffJson = null;
    }
  }

  // Self-heal: if diff is missing but repo+PR exist, fetch and cache it now
  // Use the potentially overridden values from candidate_challenge_assignment
  const effectiveRepoUrl = ch.github_repo_url as string | null;
  const effectivePrNumber = ch.github_pr_number as number | null;
  if (assignmentBackedReview) {
    const sourceBackedDiff = effectiveRepoUrl && effectivePrNumber
      ? await loadSourceBackedReviewDiff(c.env.DB, effectiveRepoUrl, effectivePrNumber)
      : null;
    if (sourceBackedDiff) {
      cachedDiffJson = sourceBackedDiff.diff;
      ch.github_pr_title = sourceBackedDiff.metadata.title;
      ch.github_pr_description = sourceBackedDiff.metadata.description ?? null;
    } else {
      return c.json(waitingForMatch('Source-backed review assignment is not ready').syntheticChallenge);
    }
  } else if (!cachedDiffJson && effectiveRepoUrl && effectivePrNumber) {
    try {
      const token = (c.env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
      const result = await fetchGitHubDiff(
        effectiveRepoUrl,
        effectivePrNumber,
        token,
      );
      if (result) {
        cachedDiffJson = result.diff;
        // Persist so we don't fetch again next time
        await c.env.DB.prepare(
          `UPDATE challenges SET cached_diff_json = ?1, cached_metadata = ?2, diff_cached_at = ?3 WHERE id = ?4`,
        )
          .bind(
            JSON.stringify(result.diff),
            JSON.stringify(result.metadata),
            new Date().toISOString(),
            ch.id as string,
          )
          .run();
      }
    } catch (err) {
      console.error('[rpc/get-challenge] Self-heal diff fetch failed:', err);
    }
  }

  // SECURITY: Never expose server_config or ground truth.
  // Challenge ID (UUID) is safe — needed for file browser + review session scoping.
  const response: Record<string, unknown> = {
    id: ch.id,
    type: ch.type,
    title: ch.title,
    instructions: ch.instructions,
    config,
    cachedDiffJson,
    githubPrTitle: ch.github_pr_title ?? null,
    githubPrNumber: ch.github_pr_number ?? null,
    githubRepoUrl: ch.github_repo_url ?? null,
    githubPrDescription: ch.github_pr_description ?? null,
    devContainerRepoUrl: (
      (ch.type as string) === 'CODE_IMPLEMENTATION'
        ? (ch.effective_repo_url as string | null)
        : null
    ) ?? (ch.dev_container_repo_url as string | null) ?? null,
  };

  if ((ch.type as string) === 'CODE_REVIEW') {
    const chConfig = typeof ch.config === 'string' ? JSON.parse(ch.config) : (ch.config as Record<string, unknown> | null);
    if (chConfig?.isMultiTurn === true) {
      response.reviewSession = {
        requiresInit: true,
        challengeId: ch.id as string,
      };
    }
  }

  // Fetch source issue text for CODE_IMPLEMENTATION challenges.
  const effectiveIssueNumber = ch.effective_issue_number as number | null;
  if (
    (ch.type as string) === 'CODE_IMPLEMENTATION' &&
    effectiveRepoUrl &&
    effectiveIssueNumber
  ) {
    try {
      const issueRow = await c.env.DB
        .prepare(
          `SELECT ri.title, ri.body, ri.labels_json, ri.body_cache_json
           FROM repo_issues ri
           JOIN qualified_repos qr ON ri.repo_id = qr.id
           WHERE qr.github_url = ?1 AND ri.issue_number = ?2`,
        )
        .bind(effectiveRepoUrl, effectiveIssueNumber)
        .first<{
          title: string;
          body: string | null;
          labels_json: string | null;
          body_cache_json: string | null;
        }>();

      if (issueRow?.body_cache_json) {
        try {
          const cache = JSON.parse(issueRow.body_cache_json) as {
            title?: string;
            body?: string;
            labels?: string[];
          };
          response.issueBody = {
            title: cache.title ?? null,
            body: cache.body ?? null,
            labels: cache.labels ?? [],
          };
        } catch {
          // malformed cache JSON — ignore
        }
      }
      if (issueRow && !response.issueBody) {
        let labels: string[] = [];
        try {
          const parsed = issueRow.labels_json ? JSON.parse(issueRow.labels_json) : [];
          labels = Array.isArray(parsed)
            ? parsed.filter((label): label is string => typeof label === 'string')
            : [];
        } catch {
          labels = [];
        }
        response.issueBody = {
          title: issueRow.title,
          body: issueRow.body,
          labels,
        };
      }
    } catch (err) {
      console.error('[rpc/get-challenge] Failed to load issue body cache:', err);
    }
  }

  return c.json(response);
});

// ── POST /rpc/submit-challenge-response ─────────────────────────────────────

rpcAuth.post('/submit-challenge-response', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const order = body.order;
  const submission = body.submission;

  if (typeof order !== 'number' || order < 0 || !Number.isInteger(order)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'order must be a non-negative integer.' } },
      400,
    );
  }

  if (submission === undefined || submission === null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'submission is required.' } },
      400,
    );
  }

  // Pipeline-free candidate (talent pool / standalone code review)
  if (!pipelineId) {
    if (parseIntakePayload(submission)) {
      await handleIntakePayload(c.env, c.executionCtx, candidateId, submission, new Date().toISOString());
      return c.json({ success: true, next: true, message: 'INTAKE submission received' });
    }

    const standaloneReview = await getPendingStandaloneReview(c.env.DB, candidateId);
    if (standaloneReview) {
      const match = await matchStandaloneReview(c.env.DB, candidateId, standaloneReview);
      if (!match) {
        return c.json({
          error: {
            code: 'WAITING_FOR_MATCH',
            message: 'A source-backed review challenge has not been selected yet.',
          },
          challenge: STANDALONE_WAITING_CHALLENGE,
        }, 409);
      }
      const now = new Date().toISOString();
      const responseJson = typeof submission === 'string' ? submission : JSON.stringify(submission);
      await c.env.DB.prepare(
        `UPDATE scheduled_interviews
         SET submission_json = ?1, status = 'COMPLETED', completed_at = ?2, updated_at = ?2
         WHERE id = ?3`,
      ).bind(responseJson, now, standaloneReview.id).run();
      return c.json({ success: true, next: true, message: 'Code review submission received' });
    }

    return c.json({ success: true, next: true, message: 'INTAKE submission received' });
  }

  // Find candidate's current stage
  const candidate = await c.env.DB.prepare(
    `SELECT current_stage_id FROM candidates WHERE id = ?1`,
  )
    .bind(candidateId)
    .first<{ current_stage_id: string | null }>();

  if (!candidate?.current_stage_id) {
    return c.json({ success: false, error: 'No active stage' }, 404);
  }

  const stageId = candidate.current_stage_id;

  // Determine synthetic challenge count for this stage
  const stageInfo = await c.env.DB.prepare(
    `SELECT mode FROM stages WHERE id = ?1`
  )
    .bind(stageId)
    .first<{ mode: string | null }>();

  const syntheticCount = 1 + (stageInfo?.mode === 'LIVE_VIDEO' ? 1 : 0);

  // Synthetic CV intake submission (code-stage gate): the stage has no INTAKE
  // challenge row, so persist the intake data directly.
  if (parseIntakePayload(submission)) {
    const codeChallenge = await c.env.DB.prepare(
      `SELECT id FROM challenges WHERE stage_id = ?1 AND type IN ('CODE_REVIEW', 'CODE_IMPLEMENTATION') LIMIT 1`,
    ).bind(stageId).first<{ id: string }>();
    const intakeChallenge = await c.env.DB.prepare(
      `SELECT id FROM challenges WHERE stage_id = ?1 AND type = 'INTAKE' LIMIT 1`,
    ).bind(stageId).first<{ id: string }>();
    if (codeChallenge && !intakeChallenge) {
      await handleIntakePayload(c.env, c.executionCtx, candidateId, submission, new Date().toISOString());
      return c.json({ success: true, next: true });
    }
  }

  // Synthetic challenges (WELCOME, LIVE_VIDEO) — no DB write needed
  if (order < syntheticCount) {
    return c.json({ success: true, next: true });
  }

  const dbOrder = order - syntheticCount;

  // Fetch challenges for the current stage, ordered
  const challenges = await c.env.DB.prepare(`
    SELECT id, type, sort_order, server_config
    FROM challenges
    WHERE stage_id = ?1
    ORDER BY sort_order ASC
  `)
    .bind(stageId)
    .all();

  const rows = challenges.results ?? [];

  if (dbOrder >= rows.length) {
    return c.json({ success: false, error: 'Challenge not found at this order index' }, 404);
  }

  const challenge = rows[dbOrder] as Record<string, unknown>;

  if (challenge.type === 'WAITING_FOR_MATCH') {
    return c.json({ error: 'Challenge not ready. Please wait for matching to complete.' }, 409);
  }

  const challengeId = challenge.id as string;

  // Get or create assessment for this stage
  let assessment = await c.env.DB.prepare(
    `SELECT id FROM assessments WHERE candidate_id = ?1 AND stage_id = ?2 LIMIT 1`,
  )
    .bind(candidateId, stageId)
    .first<{ id: string }>();

  const now = new Date().toISOString();

  if (!assessment) {
    const assessmentId = crypto.randomUUID();
    const ownerRow = await c.env.DB.prepare(
      `SELECT owner_id FROM candidates WHERE id = ?1`,
    )
      .bind(candidateId)
      .first<{ owner_id: string }>();

    await c.env.DB.prepare(`
      INSERT INTO assessments (id, candidate_id, stage_id, status, owner_id, started_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, 'IN_PROGRESS', ?4, ?5, ?5, ?5)
    `)
      .bind(assessmentId, candidateId, stageId, ownerRow?.owner_id ?? null, now)
      .run();

    assessment = { id: assessmentId };
  }

  // Check for duplicate submission
  const existing = await c.env.DB.prepare(
    `SELECT id, response_json FROM challenge_submissions
     WHERE assessment_id = ?1 AND challenge_id = ?2 LIMIT 1`,
  )
    .bind(assessment.id, challengeId)
    .first<{ id: string; response_json: string | null }>();

  const responseJson = typeof submission === 'string' ? submission : JSON.stringify(submission);
  let submissionId: string;

  if (existing) {
    // Allow resubmission if the previous response was empty (fixes React input
    // race-condition that creates blank submissions — Bug #1).
    let wasEmpty = false;
    try {
      const prev = JSON.parse(existing.response_json || '{}') as Record<string, unknown>;
      wasEmpty =
        !prev ||
        Object.keys(prev).length === 0 ||
        (prev.inputMode === 'text' && (prev.text as string)?.trim() === '');
    } catch {
      wasEmpty = true;
    }

    if (!wasEmpty) {
      return c.json(
        { success: false, error: 'Challenge already submitted' },
        409,
      );
    }

    // Update existing empty submission with new response
    submissionId = existing.id;
    await c.env.DB.prepare(`
      UPDATE challenge_submissions
      SET response_json = ?1, updated_at = ?2, submitted_at = ?2
      WHERE id = ?3
    `)
      .bind(responseJson, now, submissionId)
      .run();
  } else {
    // Create ChallengeSubmission
    submissionId = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO challenge_submissions (id, assessment_id, challenge_id, candidate_id, response_json, submitted_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
    `)
      .bind(submissionId, assessment.id, challengeId, candidateId, responseJson, now)
      .run();
  }

  // ── INTAKE challenge: trigger background enrichment ────────────────────────
  if (challenge.type === 'INTAKE') {
    await handleIntakePayload(c.env, c.executionCtx, candidateId, submission, now);
  }

  return c.json({
    success: true,
    challengeSubmissionId: submissionId,
  });
});

// ── POST /rpc/score-submission ──────────────────────────────────────────────

rpcAuth.post('/score-submission', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const challengeSubmissionId = body.challengeSubmissionId;
  if (typeof challengeSubmissionId !== 'string' || !challengeSubmissionId) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'challengeSubmissionId is required.' } },
      400,
    );
  }

  // Fetch submission + challenge
  const sub = await c.env.DB.prepare(`
    SELECT cs.id, cs.response_json, cs.assessment_id,
           ch.type, ch.server_config
    FROM challenge_submissions cs
    JOIN challenges ch ON ch.id = cs.challenge_id
    WHERE cs.id = ?1
  `)
    .bind(challengeSubmissionId)
    .first<{
      id: string;
      response_json: string | null;
      assessment_id: string;
      type: string;
      server_config: string | null;
    }>();

  if (!sub) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Submission not found.' } }, 404);
  }

  // CODE_IMPLEMENTATION: trigger async Sherlock scoring, return 202 immediately
  if (sub.type === 'CODE_IMPLEMENTATION') {
    console.log(`[submissions] implementation scoring triggered for submission ${challengeSubmissionId}`);
    c.executionCtx.waitUntil(scoreImplementationSubmission(challengeSubmissionId, c.env));
    return c.json({ success: true, status: 'scoring_in_progress' }, 202);
  }

  let score: number | null = null;
  let feedback: string | null = null;
  const now = new Date().toISOString();

  // Deterministic scoring for QUIZ_MCQ
  if (sub.type === 'QUIZ_MCQ') {
    let serverConfig: Record<string, unknown> = {};
    if (sub.server_config) {
      try {
        serverConfig = JSON.parse(sub.server_config) as Record<string, unknown>;
      } catch { /* empty config */ }
    }

    let response: Record<string, unknown> = {};
    if (sub.response_json) {
      try {
        response = JSON.parse(sub.response_json) as Record<string, unknown>;
      } catch { /* empty response */ }
    }

    const correctOptionId = serverConfig.correctOptionId as string | undefined;
    const answers = response.answers as Record<string, string> | undefined;
    const selectedAnswer = answers?.current;

    if (correctOptionId && selectedAnswer) {
      score = selectedAnswer === correctOptionId ? 100 : 0;
      feedback = score === 100 ? 'Correct answer' : 'Incorrect answer';
    } else {
      // No correct answer configured — score as 0
      score = 0;
      feedback = 'No scoring criteria configured for this challenge';
    }
  }

  // Auto-scoring for QUIZ_SHORT_ANSWER (heuristic + keyword-based)
  if (sub.type === 'QUIZ_SHORT_ANSWER') {
    let serverConfig: Record<string, unknown> = {};
    if (sub.server_config) {
      try {
        serverConfig = JSON.parse(sub.server_config) as Record<string, unknown>;
      } catch { /* empty config */ }
    }

    let response: Record<string, unknown> = {};
    if (sub.response_json) {
      try {
        response = JSON.parse(sub.response_json) as Record<string, unknown>;
      } catch { /* empty response */ }
    }

    // QUIZ_SHORT_ANSWER submissions use either { text: '...' } or { answers: { current: '...' } }
    const textAnswer = (response.text as string | undefined)?.trim() ?? '';
    const answers = response.answers as Record<string, string> | undefined;
    const answerText = textAnswer || (answers?.current ?? '').trim();

    if (!answerText) {
      score = 0;
      feedback = 'No answer provided.';
    } else {
      // Keyword-based scoring if configured
      const keywords = serverConfig.keywords as Array<{ word: string; weight: number }> | undefined;
      if (keywords && keywords.length > 0) {
        const normalized = answerText.toLowerCase();
        const totalWeight = keywords.reduce((s, k) => s + k.weight, 0);
        const earned = keywords.reduce((s, k) =>
          normalized.includes(k.word.toLowerCase()) ? s + k.weight : s, 0);
        score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 70;
        feedback = `Auto-scored: ${earned}/${totalWeight} keyword criteria matched.`;
      } else {
        // Heuristic length-based scoring for engagement
        const len = answerText.length;
        if (len < 5) {
          score = 20;
          feedback = 'Very brief answer — auto-scored at 20.';
        } else if (len < 20) {
          score = 50;
          feedback = 'Short answer — auto-scored at 50.';
        } else if (len < 50) {
          score = 70;
          feedback = 'Reasonable answer — auto-scored at 70.';
        } else {
          score = 90;
          feedback = 'Detailed answer — auto-scored at 90.';
        }
      }
    }
  }

  // Update submission with score
  if (score !== null) {
    await c.env.DB.prepare(`
      UPDATE challenge_submissions
      SET score = ?1, feedback = ?2, scored_at = ?3, updated_at = ?3
      WHERE id = ?4
    `)
      .bind(score, feedback, now, challengeSubmissionId)
      .run();

    // Re-aggregate assessment score (average of all child submissions)
    await c.env.DB.prepare(`
      UPDATE assessments
      SET score = (
        SELECT AVG(score) FROM challenge_submissions
        WHERE assessment_id = ?1 AND score IS NOT NULL
      ), updated_at = ?2
      WHERE id = ?1
    `)
      .bind(sub.assessment_id, now)
      .run();
  }

  return c.json({
    success: true,
    score,
    feedback,
  });
});

// ── POST /rpc/submit-status ────────────────────────────────────────────────

rpcAuth.post('/submit-status', async (c) => {
  const candidateId = c.get('candidateId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const status = body.status;
  if (typeof status !== 'string' || !['COMPLETED', 'ABANDONED'].includes(status)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'status must be COMPLETED or ABANDONED.' } },
      400,
    );
  }

  const now = new Date().toISOString();

  // Update candidate status
  await c.env.DB.prepare(
    `UPDATE candidates SET status = ?1, updated_at = ?2 WHERE id = ?3`,
  )
    .bind(status, now, candidateId)
    .run();

  // Also update any in-progress assessments for this candidate
  await c.env.DB.prepare(
    `UPDATE assessments SET status = ?1, completed_at = ?2, updated_at = ?2
     WHERE candidate_id = ?3 AND status = 'IN_PROGRESS'`,
  )
    .bind(status, now, candidateId)
    .run();

  return c.json({ success: true });
});

// ── GET /rpc/candidate-profile ──────────────────────────────────────────────

rpcAuth.get('/candidate-profile', async (c) => {
  const candidateId = c.get('candidateId');
  const db = c.env.DB;

  const row = await db.prepare(
    `SELECT candidate_profile_json FROM candidate_ingestion WHERE candidate_id = ?1`
  )
    .bind(candidateId)
    .first<{ candidate_profile_json: string | null }>();

  if (!row || !row.candidate_profile_json) {
    return c.json({ profile: null, error: 'profile_not_found' }, 404);
  }

  try {
    const profile = JSON.parse(row.candidate_profile_json) as unknown;
    return c.json({ profile });
  } catch {
    return c.json({ profile: null, error: 'profile_parse_error' }, 500);
  }
});

// ── POST /rpc/upload-media ──────────────────────────────────────────────────
//
// Accepts a media file (audio or video) as multipart/form-data and writes it
// directly to R2. Returns the R2 key so the frontend can store it in the
// submission JSON.
//
// Field layout:
//   file        — the binary blob (Blob/File)
//   challengeId — string identifier for the challenge (used in R2 path)
//
// R2 path: candidate-submissions/{candidateId}/{challengeId}.webm
// Auth: candidate JWT (candidateId extracted from verified token)

/** Maximum accepted media file size: 50 MB. */
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

/** MIME type guard — accepts audio/*, video/*, and document uploads. */
function isAllowedMime(mimeType: string): boolean {
  return (
    /^(audio|video)\//.test(mimeType) ||
    mimeType === 'application/pdf' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

// ── GET /rpc/ingestion-status ───────────────────────────────────────────────
// Candidate-facing ingestion status — returns the current state of the
// candidate_ingestion row so the intake app can show live progress.

rpcAuth.get('/ingestion-status', async (c) => {
  const candidateId = c.get('candidateId');

  const row = await c.env.DB.prepare(
    `SELECT status, current_step, candidate_searchable_profile, key_concepts_json,
            error_text, estimated_completion_at, updated_at
     FROM candidate_ingestion
     WHERE candidate_id = ?1`,
  )
    .bind(candidateId)
    .first<{
      status: string;
      current_step: string | null;
      candidate_searchable_profile: string | null;
      key_concepts_json: string | null;
      error_text: string | null;
      estimated_completion_at: string | null;
      updated_at: string | null;
    }>();

  if (!row) {
    return c.json({ status: 'not_started', current_step: null, candidate_searchable_profile: null, key_concepts_json: null, error_text: null, estimated_completion_at: null });
  }

  return c.json(row);
});

rpcAuth.post('/upload-media', async (c) => {
  const candidateId = c.get('candidateId');

  // Parse multipart/form-data
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Request must be multipart/form-data.' } },
      400,
    );
  }

  const fileEntry = formData.get('file') as File | string | null;
  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'No "file" field found in the request.' } },
      400,
    );
  }

  const challengeIdEntry = formData.get('challengeId');
  if (typeof challengeIdEntry !== 'string' || !challengeIdEntry.trim()) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: '"challengeId" field is required.' } },
      400,
    );
  }
  const challengeId = challengeIdEntry.trim();

  // Validate MIME type — must be audio/*, video/*, PDF, or DOCX
  if (!isAllowedMime(fileEntry.type)) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Only audio/*, video/*, application/pdf, and application/vnd.openxmlformats-officedocument.wordprocessingml.document MIME types are accepted.',
        },
      },
      415,
    );
  }

  // Validate size
  if (fileEntry.size > MAX_MEDIA_BYTES) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'File exceeds the 50 MB limit.' } },
      413,
    );
  }

  // Derive R2 key and extension based on file type
  const isDocument = fileEntry.type === 'application/pdf' || fileEntry.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  let ext: string;
  let r2Key: string;
  if (isDocument) {
    ext = fileEntry.type === 'application/pdf' ? 'pdf' : 'docx';
    const rawName = fileEntry.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    r2Key = `candidate-documents/${candidateId}/${rawName}`;
  } else {
    const mimeSubtype = fileEntry.type.split('/')[1] ?? 'webm';
    ext = mimeSubtype.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'webm';
    r2Key = `candidate-submissions/${candidateId}/${challengeId}.${ext}`;
  }

  // Write to R2
  if (!c.env.STORAGE) {
    console.error('[rpc/upload-media] R2 STORAGE binding not configured');
    return c.json(
      { error: { code: 'SERVER_ERROR', message: 'Storage not configured.' } },
      503,
    );
  }
  const arrayBuffer = await fileEntry.arrayBuffer();
  await c.env.STORAGE.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: fileEntry.type },
    customMetadata: { candidateId, challengeId },
  });

  console.log('[rpc/upload-media] Stored media', { candidateId, challengeId, r2Key, size: fileEntry.size });

  // ── Auto-ingest resume documents ───────────────────────────────────────────
  // Document uploads (PDF/DOCX) are always resumes. Run ingestion immediately
  // so the candidate graph is live before they proceed to the next stage.
  if (isDocument) {
    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare(`UPDATE candidates SET resume_s3_key = ?1, updated_at = ?2 WHERE id = ?3`)
        .bind(r2Key, now, candidateId)
        .run();
    } catch (err) {
      console.error(`[rpc/upload-media] failed to update candidate resume key:`, err);
    }

    // Run ingestion immediately — candidate graph must be live before they proceed
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const result = await processResumeFromR2({
            env: c.env,
            db: c.env.DB,
            candidateId,
            r2Key,
          });
          console.log(`[rpc/upload-media] resume ingestion for candidate ${candidateId}:`, result.success);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[rpc/upload-media] resume ingestion failed for ${candidateId}:`, msg);
        }
      })(),
    );
  }

  // Auto-transcribe audio files via Workers AI Whisper (free, at-edge)
  let transcript: string | null = null;
  if (fileEntry.type.startsWith('audio/') && c.env.AI) {
    try {
      const result = await c.env.AI.run('@cf/openai/whisper' as Parameters<typeof c.env.AI.run>[0], {
        audio: [...new Uint8Array(arrayBuffer)],
      }) as { text?: string };
      transcript = result.text?.trim() || null;
      console.log('[rpc/upload-media] Whisper transcript:', transcript?.slice(0, 100));
    } catch (err) {
      console.error('[rpc/upload-media] Whisper transcription failed:', err);
    }
  }

  return c.json({ r2Key, uploadUrl: null, transcript }, 201);
});

// ── POST /rpc/get-scheduled-interview ──────────────────────────────────────

rpcAuth.post('/get-scheduled-interview', async (c) => {
  const candidateId = c.get('candidateId');
  const db = c.env.DB;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const stageId = body['stageId'];
  if (!stageId || typeof stageId !== 'string') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'stageId is required.' } }, 400);
  }

  const interview = await db
    .prepare(
      `SELECT id, candidate_id, pipeline_id, stage_id, status,
              scheduled_at, meeting_url, scheduling_provider, scheduling_url,
              created_at, updated_at
       FROM scheduled_interviews
       WHERE candidate_id = ? AND stage_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(candidateId, stageId)
    .first<{
      id: string;
      candidate_id: string;
      pipeline_id: string;
      stage_id: string;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (!interview) {
    return c.json({ interview: null });
  }

  return c.json({
    interview: {
      id: interview.id,
      candidateId: interview.candidate_id,
      pipelineId: interview.pipeline_id,
      stageId: interview.stage_id,
      status: interview.status,
      scheduledAt: interview.scheduled_at,
      meetingUrl: interview.meeting_url,
      schedulingProvider: interview.scheduling_provider,
      schedulingUrl: interview.scheduling_url,
      createdAt: interview.created_at,
      updatedAt: interview.updated_at,
    },
  });
});

// ─── Mount multi-turn review sub-router ─────────────────────────────────────

rpcAuth.route('/review', review);
rpcAuth.route('/repo', repo);
rpcAuth.route('/dev-container', devContainer);

// ─── Mount agent-interview bridge router ──────────────────────────────────────
// Bridges frontend candidateConversationAdapter to the culture interview engine.
import { agentInterviewRouter } from './assessment/agentInterview';
rpcAuth.route('/agent-interview', agentInterviewRouter);

// ─── Mount culture interview candidate sub-router ────────────────────────────
// Culture routes use path-param token auth (the session JWT is the :token URL
// param, not an Authorization header). Mount on rpcPublic so candidateAuth
// middleware doesn't intercept before the route handler reads its own token.
// Each handler calls verifyJwt internally. See screening/culture.ts.
rpcPublic.route('/culture', cultureCandidate);

// ─── Mount dev-container exchange-token proxy (public) ────────────────────────
// The iframe proxy accepts exchange tokens instead of JWTs to prevent token
// leakage via Referer headers. Exchange tokens are single-use, 30-second TTL.
// The client calls POST /rpc/dev-container/:sessionId/exchange-token (authed)
// to get a token, then loads the iframe at /rpc/dev-container-proxy/:sessionId/?exchangeToken=...
rpcPublic.route('/dev-container-proxy', devContainerProxyPublic);

export { rpcPublic, rpcAuth };
