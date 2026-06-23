/**
 * POST /api/v1/pipelines/auto-build
 *
 * The end-of-Role-Discovery wizard handoff. Takes the recruiter's match-config
 * choices + a role_context_id, runs guardrails, picks a repo + PR + issue
 * (autoStageBuilder), and writes pipeline + 2 stages + 2 challenges +
 * pipeline_match_config in one D1 batch.
 *
 * Per .claude/plans/polymorphic-wobbling-tiger.md and ADR-039.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { autoStageBuilder } from '../../lib/match/autoStageBuilder';
import { checkGuardrails, type MatchConfigInput } from '../../lib/match/guardrails';
import { getScreenerStage } from '../../lib/screener';
import type { Env, Variables, RoleContextRow } from '../../types';

type SelectedStageInput = 'SCREENING' | 'CODE_REVIEW' | 'OPEN_SOURCE' | 'LIVE_CODING';
type SelectedStage = 'SCREENING' | 'CODE_REVIEW' | 'OPEN_SOURCE';

const DEFAULT_SELECTED_STAGES: SelectedStage[] = [
  'SCREENING',
  'CODE_REVIEW',
  'OPEN_SOURCE',
];

const autoBuild = new Hono<{ Bindings: Env; Variables: Variables }>();

autoBuild.use('*', authMiddleware);

const matchConfigSchema = z.object({
  match_philosophy: z.enum(['tailored', 'hybrid', 'validate']),
  tolerance: z.enum(['strict', 'moderate', 'lenient']),
  stage_linkage: z.enum(['shared-repo', 'per-stage']),
  automation_granularity: z.enum(['per-pipeline', 'per-candidate', 'per-stage', 'recruiter-override']),
  hybrid_mix_ratio: z.number().min(0).max(1).nullable(),
  non_negotiable_skills: z.array(z.string()).default([]),
});

const selectedStagesSchema = z
  .array(z.enum(['SCREENING', 'CODE_REVIEW', 'OPEN_SOURCE', 'LIVE_CODING'] as const))
  .min(1)
  .default(DEFAULT_SELECTED_STAGES as SelectedStageInput[])
  .transform((values) => {
    const normalized = values.map((value) => (value === 'LIVE_CODING' ? 'OPEN_SOURCE' : value));
    return [...new Set(normalized)] as SelectedStage[];
  });

const bodySchema = z.object({
  role_context_id: z.string().min(1),
  pipeline_title: z.string().min(1).max(200).optional(),
  match_config: matchConfigSchema,
  selected_stages: selectedStagesSchema,
});

autoBuild.post('/auto-build', async (c) => {
  const userId = c.var.userId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }
  const input = parsed.data;

  // 1. Guardrail check (5 rules per ADR-039 §4 — v1 enforces the 3 BLOCK rules
  //    that fit current schema; the others are registered in DEFERRED_RULES).
  const guardrailInput: MatchConfigInput = {
    match_philosophy: input.match_config.match_philosophy,
    tolerance: input.match_config.tolerance,
    stage_linkage: input.match_config.stage_linkage,
    automation_granularity: input.match_config.automation_granularity,
    hybrid_mix_ratio: input.match_config.hybrid_mix_ratio,
    non_negotiable_skills: input.match_config.non_negotiable_skills,
  };
  const guardrail = checkGuardrails(guardrailInput);
  if (!guardrail.allowed) {
    return c.json(
      {
        error: {
          code: 'GUARDRAIL_BLOCKED',
          message: 'Match configuration violates one or more guardrails.',
          blocks: guardrail.blocks,
          warnings: guardrail.warnings,
        },
      },
      422,
    );
  }

  // 2. Load role context + verify ownership.
  const roleContext = await c.env.DB.prepare(
    `SELECT rc.*, rc.non_negotiable_skills_json as non_negotiable_skills_json
       FROM role_contexts rc
      WHERE rc.id = ?1`,
  )
    .bind(input.role_context_id)
    .first<RoleContextRow & { non_negotiable_skills_json: string | null }>();

  if (!roleContext) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (roleContext.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  // 3. If non_negotiable_skills came in via the wizard but the role_context
  //    column is NULL, persist the wizard's selection now so future runs
  //    inherit it. (Atomic with the rest of the batch below.)
  const persistNonNegotiable =
    input.match_config.non_negotiable_skills.length > 0 &&
    !roleContext.non_negotiable_skills_json;

  // 4. Resolve repo + stations. Only 'validate' philosophy bakes a repo into
  //    the pipeline at build time — it's the "same canonical repo for everyone"
  //    mode. 'tailored' and 'hybrid' defer repo/PR/issue selection to the
  //    Ingestion pre-stage, which fires on resume upload and writes per-candidate
  //    rows to candidate_challenge_assignment. See ADR-032 Decision Log
  //    2026-04-21 (ADR-039 sequencing override).
  const shouldMatchNow = input.match_config.match_philosophy === 'validate';
  const selectedStages = input.selected_stages;
  const includeScreening = selectedStages.includes('SCREENING');
  const includeCodeReview = selectedStages.includes('CODE_REVIEW');
  const includeImplementation = selectedStages.includes('OPEN_SOURCE');
  const requestedStationTypes: Array<'CODE_REVIEW' | 'CODE_IMPLEMENTATION'> = [];
  if (includeCodeReview) requestedStationTypes.push('CODE_REVIEW');
  if (includeImplementation) requestedStationTypes.push('CODE_IMPLEMENTATION');

  let plan: Awaited<ReturnType<typeof autoStageBuilder>> | null = null;
  if (shouldMatchNow) {
    try {
      plan = await autoStageBuilder({
        db: c.env.DB,
        roleContext: {
          ...roleContext,
          // Inject the wizard's non_negotiable list so the builder picks it up
          // even if the column has not been persisted yet.
          ...(input.match_config.non_negotiable_skills.length > 0
            ? { non_negotiable_skills_json: JSON.stringify(input.match_config.non_negotiable_skills) }
            : {}),
        } as RoleContextRow,
        matchConfig: input.match_config,
        requestedStationTypes,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'autoStageBuilder failed';
      return apiError(c, 'AUTO_BUILD_FAILED', message);
    }
  }

  // 5. Build the D1 batch: pipeline + match_config + stages + challenges + (optional) skill persist.
  const pipelineId = generateId();
  const nowIso = new Date().toISOString();
  const nowEpoch = Math.floor(Date.now() / 1000);
  const pipelineTitle =
    input.pipeline_title ?? `Auto-built pipeline (${roleContext.id.slice(0, 8)})`;

  const statements: D1PreparedStatement[] = [];

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO pipelines (id, owner_id, title, status, creation_mode)
       VALUES (?1, ?2, ?3, 'DRAFT', 'AI_DRIVEN')`,
    ).bind(pipelineId, userId, pipelineTitle),
  );

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO pipeline_match_config (
         pipeline_id, match_philosophy, tolerance, stage_linkage,
         automation_granularity, hybrid_mix_ratio, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      pipelineId,
      input.match_config.match_philosophy,
      input.match_config.tolerance,
      input.match_config.stage_linkage,
      input.match_config.automation_granularity,
      input.match_config.hybrid_mix_ratio,
      nowEpoch,
    ),
  );

  if (persistNonNegotiable) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE role_contexts SET non_negotiable_skills_json = ?1, updated_at = ?2 WHERE id = ?3`,
      ).bind(JSON.stringify(input.match_config.non_negotiable_skills), nowIso, roleContext.id),
    );
  }

  // Link the role context to the new pipeline (if not already linked).
  if (!roleContext.pipeline_id) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE role_contexts SET pipeline_id = ?1, updated_at = ?2 WHERE id = ?3`,
      ).bind(pipelineId, nowIso, roleContext.id),
    );
  }

  // Build station records. For deferred mode (tailored/hybrid), the stations
  // are placeholders — repo/PR/issue are resolved per-candidate during ingestion.
  type StageRecord = {
    stageId: string;
    challengeId: string;
    stageType: 'SCREENING' | 'CODE_REVIEW' | 'OPEN_SOURCE';
    challengeType: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION';
    title: string;
    sortOrder: number;
    repoId: number | null;
    githubRepoUrl: string | null;
    githubPrNumber: number | null;
    issueNumber: number | null;
    instructions: string;
  };

  const plannedReview = plan?.stations.find((station) => station.type === 'CODE_REVIEW') ?? null;
  const plannedImplementation =
    plan?.stations.find((station) => station.type === 'CODE_IMPLEMENTATION') ?? null;
  const stageRecords: StageRecord[] = [];
  let sortCursor = includeScreening ? 1 : 0;

  const addCodeReviewStage = (): void => {
    stageRecords.push(
      plannedReview
        ? {
            stageId: generateId(),
            challengeId: generateId(),
            stageType: 'CODE_REVIEW',
            challengeType: 'CODE_REVIEW',
            title: plannedReview.title,
            sortOrder: sortCursor,
            repoId: plannedReview.repoId,
            githubRepoUrl: plannedReview.githubRepoUrl,
            githubPrNumber: plannedReview.githubPrNumber ?? null,
            issueNumber: null,
            instructions:
              `Review pull request #${plannedReview.githubPrNumber} on ${plannedReview.githubRepoUrl}.`,
          }
        : {
            stageId: generateId(),
            challengeId: generateId(),
            stageType: 'CODE_REVIEW',
            challengeType: 'CODE_REVIEW',
            title: 'Code Review',
            sortOrder: sortCursor,
            repoId: null,
            githubRepoUrl: null,
            githubPrNumber: null,
            issueNumber: null,
            instructions:
              'A pull request from a repository matched to your background will be assigned when your profile is ingested.',
          },
    );
    sortCursor += 1;
  };

  const addImplementationStage = (): void => {
    stageRecords.push(
      plannedImplementation
        ? {
            stageId: generateId(),
            challengeId: generateId(),
            stageType: 'OPEN_SOURCE',
            challengeType: 'CODE_IMPLEMENTATION',
            title: plannedImplementation.title,
            sortOrder: sortCursor,
            repoId: plannedImplementation.repoId,
            githubRepoUrl: plannedImplementation.githubRepoUrl,
            githubPrNumber: null,
            issueNumber: plannedImplementation.issueNumber ?? null,
            instructions: `Implement issue #${plannedImplementation.issueNumber} on ${plannedImplementation.githubRepoUrl}.`,
          }
        : {
            stageId: generateId(),
            challengeId: generateId(),
            stageType: 'OPEN_SOURCE',
            challengeType: 'CODE_IMPLEMENTATION',
            title: 'Open Source Implementation',
            sortOrder: sortCursor,
            repoId: null,
            githubRepoUrl: null,
            githubPrNumber: null,
            issueNumber: null,
            instructions:
              'An issue from a repository matched to your background will be assigned when your profile is ingested.',
          },
    );
    sortCursor += 1;
  };

  if (includeCodeReview) {
    addCodeReviewStage();
  }
  if (includeImplementation) {
    addImplementationStage();
  }

  if (includeScreening) {
    const screener = getScreenerStage();
    const screenerStageId = generateId();

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO stages (id, pipeline_id, title, description, sort_order, stage_type, screening_format, owner_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        screenerStageId,
        pipelineId,
        screener.title,
        screener.description ?? null,
        0,
        'SCREENING',
        'ONLINE',
        userId,
      ),
    );

    // Insert screener challenges.
    for (let ci = 0; ci < screener.challenges.length; ci++) {
      const challenge = screener.challenges[ci];
      if (!challenge) continue;
      const configJson = JSON.stringify(challenge.config);
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO challenges (id, stage_id, type, sort_order, title, instructions, config, owner_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        ).bind(
          generateId(),
          screenerStageId,
          challenge.type,
          ci,
          challenge.title,
          challenge.instructions,
          configJson,
          userId,
        ),
      );
    }
  }

  for (const rec of stageRecords) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO stages (id, pipeline_id, title, sort_order, stage_type, owner_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(rec.stageId, pipelineId, rec.title, rec.sortOrder, rec.stageType, userId),
    );
  }

  for (const rec of stageRecords) {
    const config = JSON.stringify({
      autoBuilt: true,
      repoId: rec.repoId,
      issueNumber: rec.issueNumber,
      matchDeferred: !shouldMatchNow,
    });
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO challenges (
           id, stage_id, type, sort_order, title, instructions, config,
           github_repo_url, github_pr_number, owner_id
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(
        rec.challengeId,
        rec.stageId,
        rec.challengeType,
        0,
        rec.title,
        rec.instructions,
        config,
        rec.githubRepoUrl,
        rec.githubPrNumber,
        userId,
      ),
    );
  }

  await c.env.DB.batch(statements);

  return c.json(
    {
      pipeline: {
        id: pipelineId,
        title: pipelineTitle,
        status: 'DRAFT',
        creationMode: 'AI_DRIVEN',
        createdAt: nowIso,
      },
      stages: stageRecords.map((rec) => ({
        id: rec.stageId,
        title: rec.title,
        type: rec.challengeType,
        sortOrder: rec.sortOrder,
        repoId: rec.repoId,
        githubRepoUrl: rec.githubRepoUrl,
        githubPrNumber: rec.githubPrNumber,
        issueNumber: rec.issueNumber,
      })),
      matchConfig: input.match_config,
      matchDeferred: !shouldMatchNow,
      repoChoice: plan?.repoChoice ?? null,
      perStationRepo: plan?.perStationRepo ?? null,
      warnings: guardrail.warnings,
    },
    201,
  );
});

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { autoBuild };
