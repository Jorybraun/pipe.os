#!/usr/bin/env tsx
/**
 * Backfill repo_nodes for existing pass >= 3 repos.
 *
 * Usage:
 *   npx tsx scripts/backfillRepoNodes.ts [--dry-run] [--batch=N] [--repo-id=<id>]
 *
 * Queries repos where pass >= 3 and no repo_nodes rows exist.
 * Uses existing engineering_narrative as input to a cheaper Gemma extraction call
 * when available; falls back to full Pass 3 re-run when missing.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..');
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

import { z } from 'zod';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';
import { logger } from './crawl-repos/shared/logger.js';
import {
  callGemma,
  getAccessToken,
  buildPrAndIssueSubElements,
} from './crawl-repos/pass3/run.js';
import { preprocessForEmbedding } from '../src/lib/embedding/preprocess';
import type { RepoSubElement } from './crawl-repos/shared/types.js';
import type { RepoIssueSummary, SamplePRSummary } from './crawl-repos/pass3/types.js';

const SIGNALS_VERSION = 'v2.0.0';
const VECTORIZE_INDEX_NAME = 'repo-searchable-profiles';
const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';
const API_BASE = 'https://api.cloudflare.com/client/v4';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── Fetch repos needing backfill ──────────────────────────────────────────

interface RepoNeedingBackfill {
  repo_id: number;
  full_name: string;
  primary_language: string;
  stars: number;
  sloc: number | null;
  file_count: number | null;
  mean_ccn: number | null;
  seniority_band: 'junior' | 'mid' | 'senior' | 'staff' | null;
  has_ci: 0 | 1;
  has_tests: 0 | 1;
  test_framework: string | null;
  detected_domain: string | null;
  detected_stack_json: string | null;
  pr_quality_score: number;
  open_pr_count: number | null;
  open_feature_issue_count: number | null;
  business_logic_ratio: number | null;
  cross_module_change_rate: number | null;
  readme_excerpt: string | null;
  root_tree_json: string | null;
  engineering_narrative: string | null;
  repo_searchable_profile: string | null;
  signal_json: string | null;
}

async function fetchReposNeedingBackfill(
  db: D1Client,
  opts: { batch?: number; repoId?: number },
): Promise<RepoNeedingBackfill[]> {
  const whereClauses = ['qr.pass >= 3', 'qr.disqualified = 0'];
  const params: (string | number)[] = [];

  if (opts.repoId !== undefined) {
    whereClauses.push('qr.id = ?');
    params.push(opts.repoId);
  } else {
    whereClauses.push('rn.repo_id IS NULL');
  }

  const limitClause = opts.batch && opts.batch > 0 ? `LIMIT ${Math.floor(opts.batch)}` : '';

  const sql = `
    SELECT
      qr.id                       AS repo_id,
      qr.full_name                AS full_name,
      qr.primary_language         AS primary_language,
      qr.stars                    AS stars,
      qr.sloc                     AS sloc,
      qr.file_count               AS file_count,
      qr.mean_ccn                 AS mean_ccn,
      qr.seniority_band           AS seniority_band,
      qr.has_ci                   AS has_ci,
      qr.has_tests                AS has_tests,
      qr.test_framework           AS test_framework,
      qr.detected_domain          AS detected_domain,
      qr.detected_stack_json      AS detected_stack_json,
      qr.pr_quality_score         AS pr_quality_score,
      qr.open_pr_count            AS open_pr_count,
      qr.open_feature_issue_count AS open_feature_issue_count,
      qr.business_logic_ratio     AS business_logic_ratio,
      qr.cross_module_change_rate AS cross_module_change_rate,
      qr.readme_excerpt           AS readme_excerpt,
      qr.root_tree_json           AS root_tree_json,
      res.engineering_narrative   AS engineering_narrative,
      res.repo_searchable_profile AS repo_searchable_profile,
      res.signal_json             AS signal_json
    FROM qualified_repos qr
    LEFT JOIN repo_engineering_signals res ON res.repo_id = qr.id
    LEFT JOIN repo_nodes rn ON rn.repo_id = qr.id
    WHERE ${whereClauses.join(' AND ')}
    GROUP BY qr.id
    ORDER BY qr.id
    ${limitClause}
  `;

  return db.query<RepoNeedingBackfill>(sql, params);
}

// ─── Fetch per-repo details ────────────────────────────────────────────────

async function fetchRepoDetails(
  db: D1Client,
  repoId: number,
): Promise<{
  constructs: Array<{ slug: string; evidence_count: number }>;
  sample_prs: SamplePRSummary[];
  issues: RepoIssueSummary[];
}> {
  const constructs = await db.query<{ slug: string; evidence_count: number }>(
    `SELECT construct_slug AS slug, evidence_count
     FROM repo_constructs
     WHERE repo_id = ?
     ORDER BY evidence_count DESC, construct_slug`,
    [repoId],
  );

  const sample_prs = await db.query<SamplePRSummary>(
    `SELECT pr_number, title, changed_file_count, modifies_tests,
            resolves_issue_number, additions, deletions,
            construct_slugs_json, swe_bench_eligible,
            changed_file_paths_json
     FROM repo_sample_prs
     WHERE repo_id = ?
     ORDER BY pr_number`,
    [repoId],
  );

  const issues = await db.query<RepoIssueSummary>(
    `SELECT issue_number, title, state_at_crawl, labels_json, comment_count, has_merged_pr
     FROM repo_issues
     WHERE repo_id = ?
     ORDER BY issue_number
     LIMIT 20`,
    [repoId],
  );

  return { constructs, sample_prs, issues };
}

// ─── Cheaper extraction prompt ─────────────────────────────────────────────

function buildExtractionPrompt(
  narrative: string,
  profile: string,
  fullName: string,
  primaryLanguage: string,
): { system: string; user: string } {
  const system = `You are an engineering analyst. Given an existing repo engineering narrative and searchable profile, produce ONLY a JSON object with structured sub-elements.

Output MUST be valid JSON matching this schema EXACTLY:

{
  "sub_elements": {
    "features": [{ "slug": string, "narrative": string }],
    "architectural_patterns": [{ "slug": string, "narrative": string }],
    "technical_stack": [{ "slug": string, "narrative": string }],
    "constructs": [{ "slug": string, "narrative": string }],
    "challenge_surfaces": [{ "slug": string, "narrative": string }],
    "quality_signals": [{ "slug": string, "narrative": string }],
    "domain_contexts": [{ "slug": string, "narrative": string }]
  }
}

Constraints:
- Each sub-element must have:
  - "slug": short kebab-case identifier
  - "narrative": 2–3 sentences, repo-specific (not generic), citing specific technologies.
- Do not force a fixed count per type; thin repos may have 0–2 entries per type, rich repos may have 5–8.
- Do not invent features absent from the narrative.
- Return ONLY the JSON object. No markdown, no commentary.`;

  const user = `Repository: ${fullName}
Primary language: ${primaryLanguage}

Engineering narrative:
${narrative}

Searchable profile:
${profile}

Produce sub_elements only.`;

  return { system, user };
}

function parseExtractionResponse(raw: string): RepoSubElement[] {
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(stripped) as Record<string, unknown>;

  const subElementsSchema = z.object({
    sub_elements: z.object({
      features: z.array(z.object({ slug: z.string(), narrative: z.string() })).optional().default([]),
      architectural_patterns: z.array(z.object({ slug: z.string(), narrative: z.string() })).optional().default([]),
      technical_stack: z.array(z.object({ slug: z.string(), narrative: z.string() })).optional().default([]),
      constructs: z.array(z.object({ slug: z.string(), narrative: z.string() })).optional().default([]),
      challenge_surfaces: z.array(z.object({ slug: z.string(), narrative: z.string() })).optional().default([]),
      quality_signals: z.array(z.object({ slug: z.string(), narrative: z.string() })).optional().default([]),
      domain_contexts: z.array(z.object({ slug: z.string(), narrative: z.string() })).optional().default([]),
    }),
  });

  const validated = subElementsSchema.parse(parsed);
  const result: RepoSubElement[] = [];
  const mappings: Array<[keyof typeof validated.sub_elements, string]> = [
    ['features', 'Feature'],
    ['architectural_patterns', 'ArchitecturalPattern'],
    ['technical_stack', 'TechnicalStack'],
    ['constructs', 'Construct'],
    ['challenge_surfaces', 'ChallengeSurface'],
    ['quality_signals', 'QualitySignal'],
    ['domain_contexts', 'DomainContext'],
  ];

  for (const [key, nodeType] of mappings) {
    const arr = validated.sub_elements[key];
    for (const item of arr) {
      result.push({
        node_type: nodeType as RepoSubElement['node_type'],
        slug: item.slug,
        narrative_text: item.narrative,
      });
    }
  }

  return result;
}

// ─── Embedding helpers ─────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[] | null> {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'];
  if (!accountId || !apiToken) {
    logger.warn('[backfill] Embedding skipped — missing CLOUDFLARE_ACCOUNT_ID/API_TOKEN');
    return null;
  }

  try {
    const embedRes = await fetch(
      `${API_BASE}/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: [preprocessForEmbedding(text, 'document')] }),
      },
    );
    if (!embedRes.ok) {
      const t = await embedRes.text();
      logger.warn('[backfill] Embedding call failed', { status: embedRes.status, body: t.slice(0, 300) });
      return null;
    }
    const embedBody = (await embedRes.json()) as {
      result?: { data?: number[][]; shape?: number[] };
      success?: boolean;
    };
    const vector = embedBody.result?.data?.[0];
    if (!vector || !Array.isArray(vector)) {
      logger.warn('[backfill] Embedding response missing vector');
      return null;
    }
    return vector;
  } catch (err) {
    logger.warn('[backfill] Embedding call threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Persist repo_nodes ────────────────────────────────────────────────────

async function persistRepoNodes(
  db: D1Client,
  repoId: number,
  subElements: RepoSubElement[],
  dryRun: boolean,
): Promise<Array<{ id: string; vector: number[] }>> {
  if (dryRun) {
    logger.info('[backfill] DRY RUN — would upsert repo_nodes', { repo_id: repoId, count: subElements.length });
    return [];
  }

  await db.query(
    `DELETE FROM repo_nodes WHERE repo_id = ? AND signals_version = ?`,
    [repoId, SIGNALS_VERSION],
  );

  const embeddingMap = new Map<string, number[]>();
  for (const el of subElements) {
    const text = `${el.node_type}: ${el.narrative_text}`;
    const vector = await embedText(text);
    if (vector) {
      const id = `${repoId}_${el.node_type}_${el.slug}`;
      embeddingMap.set(id, vector);
    }
  }

  const now = nowSeconds();
  const statements = subElements.map((el) => {
    const id = `${repoId}_${el.node_type}_${el.slug}`;
    const vector = embeddingMap.get(id);
    return {
      sql: `INSERT INTO repo_nodes (
        id, repo_id, signals_version, node_type, narrative_text,
        extracted_properties_json, embedding_json, source_reference,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        repoId,
        SIGNALS_VERSION,
        el.node_type,
        el.narrative_text,
        el.extracted_properties ? JSON.stringify(el.extracted_properties) : null,
        vector ? JSON.stringify(vector) : null,
        el.source_reference ?? null,
        now,
        now,
      ] as (string | number | null)[],
    };
  });

  await db.batch(statements);

  logger.debug('[backfill] repo_nodes persisted', { repo_id: repoId, count: subElements.length });
  return Array.from(embeddingMap.entries()).map(([id, vector]) => ({ id, vector }));
}

// ─── Vectorize upsert ──────────────────────────────────────────────────────

async function upsertRepoNodesToVectorize(
  repoId: number,
  subElements: RepoSubElement[],
  embeddings: Array<{ id: string; vector: number[] }>,
): Promise<void> {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'];
  if (!accountId || !apiToken) {
    logger.warn('[backfill] Vectorize skipped — missing CLOUDFLARE_ACCOUNT_ID/API_TOKEN');
    return;
  }

  const lines: string[] = [];
  for (const el of subElements) {
    const localId = `${repoId}_${el.node_type}_${el.slug}`;
    const embedding = embeddings.find((e) => e.id === localId);
    if (!embedding) continue;

    const vectorizeId = `repo_node_${localId}`;
    lines.push(
      JSON.stringify({
        id: vectorizeId,
        values: embedding.vector,
        metadata: {
          entity_type: 'repo',
          entity_id: repoId,
          node_type: el.node_type,
          signals_version: SIGNALS_VERSION,
          admin_status: 'approved',
        },
      }),
    );
  }

  if (lines.length === 0) {
    logger.warn('[backfill] No sub-element vectors to upsert', { repo_id: repoId });
    return;
  }

  try {
    const upsertRes = await fetch(
      `${API_BASE}/accounts/${accountId}/vectorize/v2/indexes/${VECTORIZE_INDEX_NAME}/upsert`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/x-ndjson',
        },
        body: lines.map((l) => l + '\n').join(''),
      },
    );
    if (!upsertRes.ok) {
      const text = await upsertRes.text();
      logger.warn('[backfill] Vectorize upsert failed', { repo_id: repoId, status: upsertRes.status, body: text.slice(0, 300) });
      return;
    }
    logger.debug('[backfill] Vectorize upserted', { repo_id: repoId, count: lines.length });
  } catch (err) {
    logger.warn('[backfill] Vectorize upsert threw', {
      repo_id: repoId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Process one repo ──────────────────────────────────────────────────────

interface BackfillResult {
  repo_id: number;
  full_name: string;
  status: 'written' | 'gemma_error' | 'parse_error' | 'validation_failed' | 'persist_failed' | 'skipped';
  detail?: string;
}

async function processRepoBackfill(
  accessToken: string,
  projectId: string,
  db: D1Client,
  repo: RepoNeedingBackfill,
  dryRun: boolean,
): Promise<BackfillResult> {
  const base = { repo_id: repo.repo_id, full_name: repo.full_name };

  if (!repo.engineering_narrative || !repo.repo_searchable_profile) {
    return { ...base, status: 'skipped', detail: 'missing existing engineering_narrative or repo_searchable_profile' };
  }

  // Fetch per-repo details for PR/Issue sub-elements
  const details = await fetchRepoDetails(db, repo.repo_id);

  // Build Pass3Input shape for PR/Issue helpers
  const pass3InputLike = {
    repo_id: repo.repo_id,
    full_name: repo.full_name,
    primary_language: repo.primary_language,
    sample_prs: details.sample_prs,
    issues: details.issues,
    constructs: details.constructs,
  };

  // Cheaper extraction prompt using existing narrative
  const { system, user } = buildExtractionPrompt(
    repo.engineering_narrative,
    repo.repo_searchable_profile,
    repo.full_name,
    repo.primary_language,
  );

  let raw: string;
  try {
    raw = await callGemma(accessToken, projectId, system, user);
  } catch (err) {
    return { ...base, status: 'gemma_error', detail: err instanceof Error ? err.message : String(err) };
  }

  let subElements: RepoSubElement[];
  try {
    subElements = parseExtractionResponse(raw);
  } catch (err) {
    return { ...base, status: 'parse_error', detail: `${err instanceof Error ? err.message : String(err)} | raw: ${raw.slice(0, 200)}` };
  }

  // Append PRSample and IssueCandidate from existing rows
  const prIssueElements = buildPrAndIssueSubElements(pass3InputLike as unknown as Parameters<typeof buildPrAndIssueSubElements>[0]);
  subElements = [...subElements, ...prIssueElements];

  if (subElements.length === 0) {
    return { ...base, status: 'skipped', detail: 'no sub-elements produced' };
  }

  // Persist
  try {
    const embeddings = await persistRepoNodes(db, repo.repo_id, subElements, dryRun);
    if (!dryRun) {
      await upsertRepoNodesToVectorize(repo.repo_id, subElements, embeddings);
    }
  } catch (err) {
    return { ...base, status: 'persist_failed', detail: err instanceof Error ? err.message : String(err) };
  }

  return { ...base, status: 'written', detail: `${subElements.length} sub-elements` };
}

// ─── Main ──────────────────────────────────────────────────────────────────

interface BackfillOpts {
  dryRun: boolean;
  batch?: number;
  repoId?: number;
}

function parseArgs(argv: string[]): BackfillOpts {
  const opts: BackfillOpts = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--batch') {
      opts.batch = Number(argv[++i]);
    } else if (a === '--repo-id') {
      opts.repoId = Number(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: npx tsx scripts/backfillRepoNodes.ts [--dry-run] [--batch=N] [--repo-id=<id>]');
      process.exit(0);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const accessToken = await getAccessToken();
  const projectId = process.env['VERTEX_AI_PROJECT_ID'] ?? 'pipe-493116';
  const db = new D1Client(loadD1Config());

  logger.info('[backfill] Fetching repos needing backfill...');
  const repos = await fetchReposNeedingBackfill(db, opts);
  logger.info(`[backfill] ${repos.length} repos to process`);

  if (repos.length === 0) {
    console.log('No repos need backfill.');
    return;
  }

  let written = 0;
  let skipped = 0;
  let errors = 0;

  for (const repo of repos) {
    const result = await processRepoBackfill(accessToken, projectId, db, repo, opts.dryRun);
    switch (result.status) {
      case 'written':
        written++;
        logger.info(`[backfill] repo_id=${result.repo_id} ${result.full_name} written (${result.detail})`);
        break;
      case 'skipped':
        skipped++;
        logger.info(`[backfill] repo_id=${result.repo_id} ${result.full_name} skipped: ${result.detail}`);
        break;
      default:
        errors++;
        logger.error(`[backfill] repo_id=${result.repo_id} ${result.full_name} ${result.status}: ${result.detail}`);
        break;
    }
  }

  console.log('\n═══ Backfill Report ═══');
  console.log(`Repos processed: ${repos.length}`);
  console.log(`  Written:  ${written}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`Dry run:    ${opts.dryRun}`);
}

main().catch((err) => {
  console.error('[backfill] Fatal:', err);
  process.exit(1);
});
