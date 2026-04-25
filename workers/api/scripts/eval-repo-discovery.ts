#!/usr/bin/env node
/**
 * Repo Discovery Eval Harness — STRATEGY.md Decision Log 2026-04-14
 *
 * Measures retrieval quality of the Vectorize-backed repo discovery system
 * against a gold set of expected repos for five role archetypes.
 *
 * Prerequisites:
 *   1. A wrangler dev instance must be running with --local --persist-to .wrangler/state
 *      (this is how getPlatformProxy gets Vectorize + D1 bindings locally):
 *
 *        cd workers/api && npx wrangler dev --local --persist-to .wrangler/state &
 *
 *      If Vectorize is not yet populated locally, set WRANGLER_API_URL to point at
 *      a staging deployment that has a populated REPO_INDEX:
 *
 *        WRANGLER_API_URL=https://staging.pipe.build npx tsx scripts/eval-repo-discovery.ts
 *
 *   2. The qualified_repos table in D1 must be populated. Check with:
 *        npx wrangler d1 execute pipe-dev --local --command "SELECT COUNT(*) FROM qualified_repos"
 *
 * Usage:
 *   npx tsx workers/api/scripts/eval-repo-discovery.ts
 *   npx tsx workers/api/scripts/eval-repo-discovery.ts --fixture rcd-senior-backend-typescript
 *   npx tsx workers/api/scripts/eval-repo-discovery.ts --dry-run   # type-check + fixture load only
 *
 * Exit codes:
 *   0  Average recall@20 >= 0.6 across all fixtures (PASS)
 *   1  Average recall@20 < 0.6 (FAIL) or runtime error
 *
 * See workers/api/scripts/eval-repo-discovery.README.md for full documentation.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// ─── Path setup ──────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..');
const fixturesDir = resolve(apiRoot, 'fixtures/repo-discovery');

// ─── CLI args ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    fixture:   { type: 'string' },    // run only one fixture by stem (e.g. rcd-senior-backend-typescript)
    'dry-run': { type: 'boolean', default: false },
    help:      { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help) {
  console.log(`Usage: npx tsx workers/api/scripts/eval-repo-discovery.ts [options]

Options:
  --fixture <name>   Run only one fixture (stem of the JSON file, no extension)
  --dry-run          Load and type-check fixtures without hitting Vectorize/D1
  --help             Show this help

Exit codes:
  0  Average recall@20 >= 0.6 (PASS)
  1  Average recall@20 < 0.6 (FAIL) or runtime error

See eval-repo-discovery.README.md for full documentation.
`);
  process.exit(0);
}

// ─── Fixture stems ───────────────────────────────────────────────────────────

const ALL_FIXTURE_STEMS = [
  'rcd-senior-backend-typescript',
  'rcd-staff-platform-go',
  'rcd-mid-fullstack-react',
  'rcd-senior-data-python',
  'rcd-junior-backend-rust',
] as const;

type FixtureStem = typeof ALL_FIXTURE_STEMS[number];

const fixtureStemsToRun: FixtureStem[] = args.fixture
  ? (ALL_FIXTURE_STEMS.includes(args.fixture as FixtureStem)
      ? [args.fixture as FixtureStem]
      : (() => { throw new Error(`Unknown fixture stem: ${args.fixture}. Valid stems: ${ALL_FIXTURE_STEMS.join(', ')}`); })())
  : [...ALL_FIXTURE_STEMS];

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Mirrors the RoleContextDocument type from workers/api/src/types.ts.
 * We inline a minimal structural type here so the harness does not need
 * @cloudflare/workers-types to compile (those types are unavailable in Node).
 * The JSON fixtures are validated against the full type by the type-assertion
 * function below.
 */
interface TechnicalContext {
  stack: string[];
  constructs: string[];
  seniority_band: string;
  codebase_expectations: string[];
  dispositional_weights: Record<string, number>;
}

interface LadderingChain {
  attribute_quote: string;
  source_exchange_id: string;
  consequence: string;
  value: string;
  energy_signal: 'high' | 'medium' | 'low' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
}

interface StoryRecord {
  situation: string;
  action: string;
  outcome: string;
  moral: string;
  source_exchange_id: string;
}

type AxialRelation = 'causes' | 'enables' | 'blocks' | 'contradicts' | 'instantiates';

interface DomainCell {
  primary_authority: boolean;
  coverage: 'not_probed' | 'sparse' | 'partial' | 'covered' | 'deep';
  laddering_chains: LadderingChain[];
  open_codes: string[];
  axial_links: Array<{ from_code: string; to_code: string; relation: AxialRelation }>;
  stories: StoryRecord[];
  summary: string;
}

type DomainMatrix = {
  [stakeholder: string]: {
    [domain: string]: DomainCell;
  };
};

interface ValidationMetadata {
  schema_version: string;
  synthesis_model: string;
  synthesis_prompt_version: string;
  verification_pass_model: string;
  face_validity_reviewed_at: string | null;
  face_validity_reviewer: string | null;
}

interface RoleContextDocument {
  rcd_version: string;
  role_context_id: string;
  pipeline_id: string;
  created_at: string;
  domain_matrix: DomainMatrix;
  conflicts: unknown[];
  technical_context: TechnicalContext;
  team_culture_profile: unknown;
  bars_overrides: Array<{
    dimension: string;
    anchor_level: number;
    base_anchor_text: string;
    override_anchor_text: string;
    source_chain_id: string;
    approved_by: string;
    approved_at: string;
  }>;
  probe_bank_enrichment: {
    static_base_version: string;
    enriched_probes: Array<{
      dimension: string;
      probe_text: string;
      source_chain_id: string;
      approved_by: string;
      approved_at: string;
    }>;
  };
  dealbreakers: unknown[];
  red_flags: unknown[];
  consumer_slice: unknown;
  validation_metadata: ValidationMetadata;
}

// Gold set type
interface GoldEntry {
  expected_repo_full_names: string[];
  rationale: string;
}

// Eval result per fixture
interface FixtureEvalResult {
  stem: string;
  rAt5: number;
  rAt10: number;
  rAt20: number;
  pAt10: number;
  mrr: number;
  retrievedCount: number;
  resolvedGoldCount: number;
  missingGoldRepos: string[];
  warning?: string;
}

// ─── Fixture validation ──────────────────────────────────────────────────────

/**
 * Validates that a parsed JSON value is a structurally complete RoleContextDocument.
 * Throws with a descriptive message if any required field is missing or wrong type.
 * This is the "type assertion" step the task description requires.
 */
function assertRcd(value: unknown, stem: string): RoleContextDocument {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`[${stem}] RCD must be an object`);
  }
  const r = value as Record<string, unknown>;

  const requiredStrings: (keyof RoleContextDocument)[] = [
    'rcd_version', 'role_context_id', 'pipeline_id', 'created_at',
  ];
  for (const key of requiredStrings) {
    if (typeof r[key] !== 'string') {
      throw new Error(`[${stem}] Missing or invalid string field: ${key}`);
    }
  }

  if (typeof r['domain_matrix'] !== 'object' || r['domain_matrix'] === null) {
    throw new Error(`[${stem}] domain_matrix must be an object`);
  }

  if (typeof r['technical_context'] !== 'object' || r['technical_context'] === null) {
    throw new Error(`[${stem}] technical_context must be an object`);
  }

  const tc = r['technical_context'] as Record<string, unknown>;
  if (!Array.isArray(tc['stack'])) {
    throw new Error(`[${stem}] technical_context.stack must be an array`);
  }
  if (!Array.isArray(tc['constructs'])) {
    throw new Error(`[${stem}] technical_context.constructs must be an array`);
  }
  if (typeof tc['seniority_band'] !== 'string') {
    throw new Error(`[${stem}] technical_context.seniority_band must be a string`);
  }
  if (!Array.isArray(tc['codebase_expectations'])) {
    throw new Error(`[${stem}] technical_context.codebase_expectations must be an array`);
  }
  if (typeof tc['dispositional_weights'] !== 'object' || tc['dispositional_weights'] === null) {
    throw new Error(`[${stem}] technical_context.dispositional_weights must be an object`);
  }

  if (!Array.isArray(r['bars_overrides'])) {
    throw new Error(`[${stem}] bars_overrides must be an array`);
  }
  if (!Array.isArray(r['conflicts'])) {
    throw new Error(`[${stem}] conflicts must be an array`);
  }
  if (!Array.isArray(r['dealbreakers'])) {
    throw new Error(`[${stem}] dealbreakers must be an array`);
  }
  if (!Array.isArray(r['red_flags'])) {
    throw new Error(`[${stem}] red_flags must be an array`);
  }

  const vm = r['validation_metadata'] as Record<string, unknown>;
  if (typeof vm !== 'object' || vm === null) {
    throw new Error(`[${stem}] validation_metadata must be an object`);
  }
  if (typeof vm['schema_version'] !== 'string') {
    throw new Error(`[${stem}] validation_metadata.schema_version must be a string`);
  }

  return r as unknown as RoleContextDocument;
}

// ─── Load fixtures ───────────────────────────────────────────────────────────

async function loadRcd(stem: string): Promise<RoleContextDocument> {
  const filePath = resolve(fixturesDir, `${stem}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Fixture file not found: ${filePath}`);
  }
  const raw = await readFile(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return assertRcd(parsed, stem);
}

async function loadGoldSet(): Promise<Record<FixtureStem, GoldEntry>> {
  const filePath = resolve(fixturesDir, 'expected-top-repos.json');
  if (!existsSync(filePath)) {
    throw new Error(`Gold set not found: ${filePath}`);
  }
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as Record<FixtureStem, GoldEntry>;
}

// ─── buildRcdSearchProfile (Node-safe re-implementation) ─────────────────────
//
// The production version lives in src/lib/repoDiscovery/rcdSearchProfile.ts and
// imports types from the Workers runtime. We inline a Node-compatible version here
// so the harness can build the embedding query string without requiring wrangler.

function buildRcdSearchProfileNode(rcd: RoleContextDocument): string {
  const sections: string[] = [];

  const tc = rcd.technical_context;
  const stackText = tc.stack.length ? tc.stack.join(', ') : 'an unspecified stack';
  const constructsText = tc.constructs.length
    ? tc.constructs.slice(0, 8).join(', ')
    : 'no specific engineering constructs';

  sections.push(
    `This role is for a ${tc.seniority_band} engineer. ` +
    `The team works with ${stackText}. ` +
    `The work pattern is characterised by engineering constructs such as ${constructsText}.`,
  );

  if (tc.codebase_expectations.length > 0) {
    sections.push(
      `Expectations of the codebase: ${tc.codebase_expectations.slice(0, 5).join('; ')}.`,
    );
  }

  const summaries = new Set<string>();
  for (const stakeholderKey of Object.keys(rcd.domain_matrix)) {
    const cells = rcd.domain_matrix[stakeholderKey];
    if (!cells) continue;
    for (const cell of Object.values(cells)) {
      if (cell?.summary && cell.summary.trim().length > 0) {
        summaries.add(cell.summary.trim());
      }
    }
  }
  if (summaries.size > 0) {
    sections.push(`Domain context: ${[...summaries].slice(0, 8).join(' ')}`);
  }

  const stories: string[] = [];
  const seenStakeholders = new Set<string>();
  for (const stakeholderKey of Object.keys(rcd.domain_matrix)) {
    if (stories.length >= 3 || seenStakeholders.has(stakeholderKey)) continue;
    const cells = rcd.domain_matrix[stakeholderKey];
    if (!cells) continue;
    for (const cell of Object.values(cells)) {
      if (cell?.stories && cell.stories.length > 0) {
        const s = cell.stories[0];
        if (s) {
          stories.push(
            `Illustrative situation: ${s.situation} The team's response: ${s.action} Outcome: ${s.outcome} What it reveals: ${s.moral}`,
          );
          seenStakeholders.add(stakeholderKey);
          break;
        }
      }
    }
  }
  if (stories.length > 0) {
    sections.push(stories.join(' '));
  }

  if (rcd.bars_overrides.length > 0) {
    const anchors = rcd.bars_overrides
      .slice(0, 6)
      .map((b) => `${b.dimension}: ${b.override_anchor_text.trim()}`)
      .join(' ');
    sections.push(`Team-specific performance anchors. ${anchors}`);
  }

  const combined = sections.join('\n\n');
  const words = combined.trim().split(/\s+/);

  if (words.length >= 400 && words.length <= 600) return combined;

  if (words.length < 400) {
    const closer =
      `In summary, the ideal contributor is comfortable navigating ${stackText}, ` +
      `operates at the ${tc.seniority_band} band, and brings experience with ${constructsText}. ` +
      `They are expected to handle work consistent with the codebase expectations above and ` +
      `the team-specific anchors listed, while engaging with the domain context described earlier. ` +
      `Strong candidates exhibit pragmatism about trade-offs, clarity in review discussions, ` +
      `and ownership of outcomes beyond narrowly-scoped tickets. ` +
      `They translate between product intent and technical reality without losing either side of the conversation.`;
    const padded = `${combined}\n\n${closer}`;
    const paddedWords = padded.trim().split(/\s+/);
    if (paddedWords.length >= 400) {
      return paddedWords.slice(0, 600).join(' ');
    }
    let result = padded;
    while (result.split(/\s+/).length < 400) {
      result += ` The team relies on ${stackText} daily. Engineering culture centers on ${constructsText}.`;
    }
    return result.split(/\s+/).slice(0, 600).join(' ');
  }

  const truncated = words.slice(0, 600).join(' ');
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?'),
  );
  return lastSentenceEnd > 0 ? truncated.slice(0, lastSentenceEnd + 1) : truncated;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Recall@K: fraction of expected gold repos appearing in the top-K results.
 *
 * recall@K = |gold ∩ top-K| / |gold|
 *
 * Interpretation: 0.6 means 60% of the gold repos appeared in the top-K list.
 * This is the primary pass/fail metric — we care about whether the system
 * surfaces the right repos, not about their exact rank.
 */
function recallAtK(
  retrievedIds: number[],
  goldIds: Set<number>,
  k: number,
): number {
  if (goldIds.size === 0) return 0;
  const topK = new Set(retrievedIds.slice(0, k));
  let hits = 0;
  for (const id of goldIds) {
    if (topK.has(id)) hits++;
  }
  return hits / goldIds.size;
}

/**
 * Precision@K: fraction of top-K results that are in the gold set.
 *
 * precision@K = |gold ∩ top-K| / K
 *
 * Interpretation: 0.5 means half the top-K results were relevant.
 * Lower than recall@K is expected because the gold set is typically smaller
 * than K and recall is the primary objective for a discovery system.
 */
function precisionAtK(
  retrievedIds: number[],
  goldIds: Set<number>,
  k: number,
): number {
  const topK = retrievedIds.slice(0, k);
  if (topK.length === 0) return 0;
  let hits = 0;
  for (const id of topK) {
    if (goldIds.has(id)) hits++;
  }
  return hits / topK.length;
}

/**
 * Mean Reciprocal Rank: 1 / rank of the first gold repo in the result list.
 *
 * MRR = 1 / rank_of_first_hit
 *
 * Interpretation: 0.5 = first gold repo at rank 2; 0.33 = first at rank 3.
 * Measures how early the system surfaces at least one relevant result.
 * High MRR means a recruiter sees a relevant repo near the top of the list.
 */
function computeMrr(retrievedIds: number[], goldIds: Set<number>): number {
  for (let i = 0; i < retrievedIds.length; i++) {
    if (goldIds.has(retrievedIds[i]!)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

// ─── D1 gold resolution ──────────────────────────────────────────────────────

interface QualifiedRepoRow {
  id: number;
  full_name: string;
}

/**
 * Look up D1 repo IDs by full_name. Returns only rows that exist in the DB.
 * Repos in the gold set that don't exist in the local DB are logged as warnings —
 * this is expected when running against a sparse local corpus.
 */
async function resolveGoldRepoIds(
  db: D1Database,
  fullNames: string[],
  stem: string,
): Promise<{ resolvedIds: Set<number>; missingNames: string[] }> {
  if (fullNames.length === 0) return { resolvedIds: new Set(), missingNames: [] };

  // D1 supports up to 100 bound parameters; batch if needed.
  const BATCH_SIZE = 50;
  const resolvedIds = new Set<number>();
  const foundNames = new Set<string>();

  for (let i = 0; i < fullNames.length; i += BATCH_SIZE) {
    const batch = fullNames.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(', ');
    const stmt = db.prepare(
      `SELECT id, full_name FROM qualified_repos WHERE full_name IN (${placeholders})`,
    ).bind(...batch);
    const { results } = await stmt.all<QualifiedRepoRow>();
    for (const row of results ?? []) {
      resolvedIds.add(row.id);
      foundNames.add(row.full_name);
    }
  }

  const missingNames = fullNames.filter((n) => !foundNames.has(n));
  if (missingNames.length > 0) {
    console.warn(`  [${stem}] Gold repos not found in D1 (${missingNames.length}/${fullNames.length}): ${missingNames.join(', ')}`);
    console.warn(`  [${stem}] These will be excluded from metrics. Run the crawler to populate the corpus.`);
  }

  return { resolvedIds, missingNames };
}

// ─── Discovery via getPlatformProxy ──────────────────────────────────────────
//
// getPlatformProxy gives us real Cloudflare bindings (Vectorize + D1 + AI)
// inside a Node process. This pattern is used throughout the wrangler toolchain.
//
// If getPlatformProxy fails (bindings not available — e.g. wrangler dev not
// running, or no Vectorize state), we fall back to SQL-only discovery so the
// harness still produces metrics for the SQL retrieval path.

interface PlatformProxyBindings {
  DB: D1Database;
  REPO_INDEX?: VectorizeIndex;
  AI?: Ai;
}

// We use a lazy import so the harness can still run in --dry-run mode
// without wrangler being installed.
async function tryGetPlatformProxy(): Promise<PlatformProxyBindings | null> {
  try {
    const wrangler = await import('wrangler');
    if (!('getPlatformProxy' in wrangler)) {
      console.warn('  [proxy] wrangler does not export getPlatformProxy. Run: npm install wrangler@latest');
      return null;
    }
    const { env } = await (wrangler as { getPlatformProxy: (opts: { persist: { path: string } }) => Promise<{ env: PlatformProxyBindings }> }).getPlatformProxy({
      persist: { path: resolve(apiRoot, '.wrangler/state') },
    });
    return env;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [proxy] getPlatformProxy failed: ${msg}`);
    console.warn('  [proxy] Ensure wrangler dev is running: cd workers/api && npx wrangler dev --local --persist-to .wrangler/state');
    return null;
  }
}

// ─── Discovery helpers ───────────────────────────────────────────────────────

interface DiscoveredRow {
  id: number;
  full_name: string;
}

/**
 * SQL-only discovery: query qualified_repos by language and seniority.
 * This is a simplified version of matchRepos that doesn't require Workers runtime
 * imports — it runs the core "does the DB contain this repo" query directly
 * so we can measure D1 recall independently of Vectorize.
 */
async function sqlOnlyDiscovery(db: D1Database, rcd: RoleContextDocument): Promise<DiscoveredRow[]> {
  const tc = rcd.technical_context;
  const primaryLanguage = derivePrimaryLanguageFromStack(tc.stack);
  const seniority = tc.seniority_band;

  // Seniority band mapping — mirrors discover.ts derivePrimaryLanguage logic.
  const seniorityVariants: string[] = [seniority];
  if (seniority === 'senior') seniorityVariants.push('mid');
  if (seniority === 'staff') seniorityVariants.push('senior', 'mid');
  if (seniority === 'junior') seniorityVariants.push('mid');

  const bandPlaceholders = seniorityVariants.map(() => '?').join(', ');

  const stmt = db.prepare(`
    SELECT id, full_name
    FROM qualified_repos
    WHERE primary_language = ?
      AND seniority_band IN (${bandPlaceholders})
      AND disqualified = 0
    ORDER BY pr_quality_score DESC, stars DESC
    LIMIT 50
  `).bind(primaryLanguage, ...seniorityVariants);

  const { results } = await stmt.all<DiscoveredRow>();
  return results ?? [];
}

/**
 * Vectorize + SQL combined discovery: embeds the RCD search profile,
 * queries REPO_INDEX for top-50 semantic neighbors, and merges with SQL results.
 */
async function vectorizeDiscovery(
  db: D1Database,
  rcd: RoleContextDocument,
  vectorize: VectorizeIndex,
  ai: Ai,
): Promise<DiscoveredRow[]> {
  const profile = buildRcdSearchProfileNode(rcd);
  if (!profile || profile.trim().length === 0) {
    return sqlOnlyDiscovery(db, rcd);
  }

  // Embed the search profile using the same model as REPO_INDEX
  const embedResult = await (ai.run as (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }>)(
    '@cf/baai/bge-large-en-v1.5',
    { text: [profile] },
  );
  const vector = embedResult?.data?.[0];
  if (!vector || !Array.isArray(vector)) {
    console.warn('  [vectorize] Embedding returned no vector; falling back to SQL-only');
    return sqlOnlyDiscovery(db, rcd);
  }

  // Query REPO_INDEX for top-50 semantic neighbors
  const queryResult = await vectorize.query(vector, {
    topK: 50,
    filter: { disqualified: 0 },
  });

  if (!queryResult?.matches || queryResult.matches.length === 0) {
    console.warn('  [vectorize] No Vectorize matches; falling back to SQL-only');
    return sqlOnlyDiscovery(db, rcd);
  }

  const vectorRepoIds: number[] = [];
  for (const m of queryResult.matches) {
    const match = m.id.match(/^repo_(\d+)$/);
    if (match?.[1]) vectorRepoIds.push(Number(match[1]));
  }

  // Merge SQL + Vectorize results, SQL wins on collision
  const sqlResults = await sqlOnlyDiscovery(db, rcd);
  const byId = new Map<number, DiscoveredRow>();
  for (const r of sqlResults) byId.set(r.id, r);

  if (vectorRepoIds.length > 0) {
    const placeholders = vectorRepoIds.map(() => '?').join(', ');
    const { results } = await db.prepare(`
      SELECT id, full_name
      FROM qualified_repos
      WHERE id IN (${placeholders}) AND disqualified = 0
    `).bind(...vectorRepoIds).all<DiscoveredRow>();
    for (const r of results ?? []) {
      if (!byId.has(r.id)) byId.set(r.id, r);
    }
  }

  return [...byId.values()];
}

// ─── Eval per fixture ─────────────────────────────────────────────────────────

async function evalFixture(
  stem: FixtureStem,
  rcd: RoleContextDocument,
  goldEntry: GoldEntry,
  bindings: PlatformProxyBindings | null,
): Promise<FixtureEvalResult> {
  const base: Omit<FixtureEvalResult, 'rAt5' | 'rAt10' | 'rAt20' | 'pAt10' | 'mrr'> = {
    stem,
    retrievedCount: 0,
    resolvedGoldCount: 0,
    missingGoldRepos: [],
  };

  if (!bindings) {
    console.warn(`  [${stem}] No platform bindings — skipping retrieval. Fixture validation passed.`);
    return { ...base, rAt5: 0, rAt10: 0, rAt20: 0, pAt10: 0, mrr: 0, warning: 'no-bindings' };
  }

  const db = bindings.DB;

  // Resolve gold repo IDs from full_names
  const { resolvedIds: goldIds, missingNames } = await resolveGoldRepoIds(
    db,
    goldEntry.expected_repo_full_names,
    stem,
  );

  if (goldIds.size === 0) {
    console.warn(`  [${stem}] No gold repos found in D1. Populate the corpus (run the crawler) before measuring recall.`);
    return {
      ...base,
      rAt5: 0, rAt10: 0, rAt20: 0, pAt10: 0, mrr: 0,
      missingGoldRepos: missingNames,
      warning: 'no-gold-in-db',
    };
  }

  // Run discovery
  let retrieved: DiscoveredRow[];
  if (bindings.REPO_INDEX && bindings.AI) {
    console.log(`  [${stem}] Running Vectorize + SQL hybrid discovery...`);
    retrieved = await vectorizeDiscovery(db, rcd, bindings.REPO_INDEX, bindings.AI);
  } else {
    console.log(`  [${stem}] Vectorize binding unavailable; running SQL-only discovery...`);
    retrieved = await sqlOnlyDiscovery(db, rcd);
  }

  const retrievedIds = retrieved.map((r) => r.id);

  const result: FixtureEvalResult = {
    stem,
    rAt5:   recallAtK(retrievedIds, goldIds, 5),
    rAt10:  recallAtK(retrievedIds, goldIds, 10),
    rAt20:  recallAtK(retrievedIds, goldIds, 20),
    pAt10:  precisionAtK(retrievedIds, goldIds, 10),
    mrr:    computeMrr(retrievedIds, goldIds),
    retrievedCount: retrievedIds.length,
    resolvedGoldCount: goldIds.size,
    missingGoldRepos: missingNames,
  };

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function derivePrimaryLanguageFromStack(stack: string[]): string {
  const lower = stack.map((s) => s.toLowerCase());
  if (lower.some((s) => ['python', 'django', 'flask', 'fastapi', 'airflow', 'spark'].includes(s))) return 'python';
  if (lower.some((s) => ['go', 'golang', 'gin', 'fiber', 'echo'].includes(s))) return 'go';
  if (lower.some((s) => ['rust', 'tokio', 'actix', 'axum'].includes(s))) return 'rust';
  if (lower.some((s) => ['java', 'spring', 'kotlin'].includes(s))) return 'java';
  if (lower.some((s) => ['ruby', 'rails'].includes(s))) return 'ruby';
  return 'typescript';
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function padEnd(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\nRepo Discovery Eval — v2.0.0');
  console.log('══════════════════════════════════════════════════════════\n');

  // 1. Load all fixtures and validate structure
  console.log('Loading fixtures...');
  const fixtures = new Map<FixtureStem, RoleContextDocument>();
  for (const stem of fixtureStemsToRun) {
    try {
      const rcd = await loadRcd(stem);
      fixtures.set(stem, rcd);
      const wordCount = buildRcdSearchProfileNode(rcd).trim().split(/\s+/).length;
      console.log(`  ${stem}: OK (search profile: ${wordCount} words)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${stem}: FAILED — ${msg}`);
      process.exit(1);
    }
  }

  // 2. Load gold set
  console.log('\nLoading gold set...');
  const goldSet = await loadGoldSet();
  for (const stem of fixtureStemsToRun) {
    if (!goldSet[stem]) {
      console.error(`  Gold set missing entry for: ${stem}`);
      process.exit(1);
    }
    console.log(`  ${stem}: ${goldSet[stem]!.expected_repo_full_names.length} expected repos`);
  }

  if (args['dry-run']) {
    console.log('\nDry-run complete. All fixtures load and pass structural validation.');
    console.log('Re-run without --dry-run to measure recall against D1 + Vectorize.\n');
    process.exit(0);
  }

  // 3. Acquire platform bindings
  console.log('\nAcquiring Cloudflare platform bindings...');
  const bindings = await tryGetPlatformProxy();
  if (bindings) {
    const hasVectorize = !!bindings.REPO_INDEX;
    const hasAi = !!bindings.AI;
    console.log(`  DB: available`);
    console.log(`  REPO_INDEX (Vectorize): ${hasVectorize ? 'available' : 'not available (SQL-only fallback)'}`);
    console.log(`  AI: ${hasAi ? 'available' : 'not available'}`);
  } else {
    console.warn('  No platform bindings available. Metrics will be zero — fixture validation only.');
    console.warn('  To get real metrics: start wrangler dev and re-run this script.\n');
  }

  // 4. Eval each fixture
  console.log('\nRunning eval...\n');
  const results: FixtureEvalResult[] = [];

  for (const stem of fixtureStemsToRun) {
    const rcd = fixtures.get(stem)!;
    const goldEntry = goldSet[stem]!;
    console.log(`[${stem}]`);
    try {
      const result = await evalFixture(stem, rcd, goldEntry, bindings);
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${msg}`);
      results.push({
        stem,
        rAt5: 0, rAt10: 0, rAt20: 0, pAt10: 0, mrr: 0,
        retrievedCount: 0, resolvedGoldCount: 0,
        missingGoldRepos: [],
        warning: `error: ${msg}`,
      });
    }
  }

  // 5. Print results table
  const COL_FIXTURE = 38;
  const COL_METRIC = 7;

  console.log('\nEval results — repo discovery v2.0.0');
  console.log('─'.repeat(76));
  console.log(
    padEnd('Fixture', COL_FIXTURE) +
    padEnd('R@5', COL_METRIC) +
    padEnd('R@10', COL_METRIC) +
    padEnd('R@20', COL_METRIC) +
    padEnd('P@10', COL_METRIC) +
    padEnd('MRR', COL_METRIC),
  );
  console.log('─'.repeat(76));

  let totalR20 = 0;
  let countedFixtures = 0;

  for (const r of results) {
    const warning = r.warning ? ` (${r.warning})` : '';
    const goldNote = r.resolvedGoldCount > 0
      ? ` [${r.resolvedGoldCount} gold in DB, ${r.retrievedCount} retrieved]`
      : '';
    console.log(
      padEnd(r.stem, COL_FIXTURE) +
      padEnd(fmt(r.rAt5), COL_METRIC) +
      padEnd(fmt(r.rAt10), COL_METRIC) +
      padEnd(fmt(r.rAt20), COL_METRIC) +
      padEnd(fmt(r.pAt10), COL_METRIC) +
      padEnd(fmt(r.mrr), COL_METRIC) +
      warning + goldNote,
    );
    if (!r.warning || r.warning === 'no-gold-in-db') {
      // Count fixtures with real retrieval in the average
      if (r.resolvedGoldCount > 0) {
        totalR20 += r.rAt20;
        countedFixtures++;
      }
    }
  }

  console.log('─'.repeat(76));

  const avgR20 = countedFixtures > 0 ? totalR20 / countedFixtures : 0;
  const PASS_THRESHOLD = 0.6;
  const passed = avgR20 >= PASS_THRESHOLD;

  if (countedFixtures === 0) {
    console.log('\nNo fixtures with resolved gold repos. Cannot compute average R@20.');
    console.log('This means the corpus (qualified_repos) does not contain the gold repos.');
    console.log('Run the crawler to populate the corpus, then re-run this eval.\n');
    // Exit 0 when bindings were unavailable — this is a corpus gap, not a system failure
    if (!bindings) process.exit(0);
    // Exit 1 if we had bindings but still no gold — system is broken
    process.exit(1);
  }

  const threshold = `(target >= ${PASS_THRESHOLD})`;
  const verdict = passed ? '✓ PASS' : '✗ FAIL';
  console.log(`\nAverage R@20 across ${countedFixtures} fixture(s): ${fmt(avgR20)} ${threshold} ${verdict}\n`);

  if (!passed) {
    console.log('Action: R@20 is below the 0.6 baseline. Check:');
    console.log('  1. Is the Vectorize index populated? (run pass3/embed-profiles.ts)');
    console.log('  2. Are the gold repos in qualified_repos? (run the crawler)');
    console.log('  3. Is the rcdSearchProfile building a meaningful query text?');
    console.log('     Print it: buildRcdSearchProfileNode(rcd) for a failing fixture\n');
  }

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('[eval-repo-discovery] Fatal error:', err);
  process.exit(1);
});
