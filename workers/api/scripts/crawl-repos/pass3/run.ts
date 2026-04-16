#!/usr/bin/env tsx
/**
 * Pass 3 — TypeScript orchestrator.
 *
 * Calls Gemma 4 26B via Vertex AI for the summarization step.
 *
 * Usage:
 *   npx tsx scripts/crawl-repos/pass3/run.ts [--limit N] [--repo-id N] [--dry-run]
 *   npx tsx scripts/crawl-repos/pass3/run.ts [--concurrency N] (default 1)
 *
 * Env vars (loaded from .dev.vars):
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_D1_DATABASE_ID
 *   VERTEX_AI_PROJECT_ID (optional, defaults to pipe-493116)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '../../..');
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

import { D1Client, loadD1Config } from '../shared/d1Client.js';
import { logger } from '../shared/logger.js';
import { fetchBatch } from './fetch.js';
import { computeContentHash } from './hash.js';
import { validatePass3 } from './validate.js';
import { persistAndVerify } from './persist.js';
import { auditSignals } from './audit.js';
import { classifyTestStyle } from './testStyleClassifier.js';
import { classifyChallengeSurfaces } from './challengeSurfaceClassifier.js';
import { computeDeterministicStats, computeComplexityBand } from './deterministicStats.js';
import { judgeOutput } from './judge.js';
import type { Pass3Input, FetchOptions } from './types.js';
import type { Pass3Data, ArchitectureStyle } from '../shared/types.js';

// ─── Config ────────────────────────────────────────────────────────────────

const SIGNALS_VERSION = 'v2.0.0'; // migration 0028: RUC canonical enum + test_style + challenge_surfaces + repo_searchable_profile (STRATEGY Decision Log 2026-04-14)
const SUMMARIZER_MODEL = process.env['VERTEX_AI_MODEL'] ?? 'gemma-4-26b-a4b-it-maas';
const MODEL_VERSION = 'v1';
const DEFAULT_CONCURRENCY = 1;

// ─── Vertex AI call ────────────────────────────────────────────────────────

interface VertexAIPart { text?: string }
interface VertexAIResponse {
  candidates?: Array<{ content?: { parts?: VertexAIPart[] } }>;
  error?: { code: number; message: string };
}

export async function callGemma(
  accessToken: string,
  projectId: string,
  systemPrompt: string,
  userPrompt: string,
  retries = 3,
): Promise<string> {
  const region = process.env['VERTEX_AI_REGION'] ?? 'global';
  const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${SUMMARIZER_MODEL}:generateContent`;

  const combinedPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: combinedPrompt }] }],
    generationConfig: { maxOutputTokens: 4096, responseMimeType: 'application/json' },
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body,
      signal: AbortSignal.timeout(90_000), // 90s timeout per call
    });

    if (res.status === 429 && attempt < retries) {
      const delay = 2000 * (attempt + 1); // 2s, 4s, 6s
      logger.warn(`[pass3] rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Vertex AI ${res.status}: ${err}`);
    }

    const data = (await res.json()) as VertexAIResponse;
    if (data.error) throw new Error(`Vertex AI error ${data.error.code}: ${data.error.message}`);

    const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
    if (!content) throw new Error('Vertex AI returned empty response');
    return content;
  }

  throw new Error('Vertex AI max retries exceeded');
}

// ─── Summarization prompt ──────────────────────────────────────────────────
//
// Gemma receives only three tasks: pick `architecture_style` from a fixed
// enum, write a 200–400-word `engineering_narrative`, and write a 400–600-word
// `repo_searchable_profile`. All numeric facts are pre-filled and must not be
// invented or rewritten — the validator enforces that every digit in the
// narrative corresponds to a FACTS value.

export interface PromptFacts {
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  swe_bench_eligibility_rate: number | null;
  complexity_band: 'low' | 'medium' | 'high' | 'mixed' | null;
  test_style: string;
  challenge_surfaces: Record<string, number>;
  business_logic_ratio: number | null;
  cross_module_change_rate: number | null;
  open_pr_count: number | null;
  open_feature_issue_count: number | null;
}

function fmt(n: number | null): string {
  return n === null ? 'unknown' : String(n);
}

export function buildSummarizerPrompt(
  input: Pass3Input,
  facts: PromptFacts,
): { system: string; user: string } {
  const system = `You are an engineering analyst. Given structured metadata about an open-source repository, produce a JSON object describing the repo's engineering culture and discoverability profile.

Output MUST be valid JSON matching this schema EXACTLY:

{
  "architecture_style": "monolith" | "layered_service" | "microservice" | "library" | "unknown",
  "engineering_narrative": string,
  "repo_searchable_profile": string
}

architecture_style definitions:
- "library": the repo's purpose is to be imported by other projects. No deployable runtime entrypoint.
- "layered_service": single-deploy application with clear controller/service/repository or equivalent internal layers.
- "monolith": single-deploy application without strong internal layering.
- "microservice": part of a multi-service topology OR function-as-a-service.
- "unknown": cannot determine from the provided signals.

Constraints:
- Return ONLY the JSON object. No markdown, no commentary.
- "engineering_narrative": 200–400 words. MUST mention the primary language (${input.primary_language}). Cover: test discipline, review culture, architecture style, complexity profile, notable PR-sample patterns.
- "repo_searchable_profile": 400–600 words. A natural-language narrative covering (in order): repo type and purpose; primary language and detected stack; PR-shape observations verbalised from facts; test/review culture verbalised from facts; top three challenge surfaces; contribution readiness (open PR count and open feature-issue count verbalised).
- You MAY NOT invent numbers. Every numeric digit you write must correspond to a value from the FACTS block below. If a fact is "unknown", do not discuss it quantitatively.
- Be role-agnostic. Do not assume what kind of developer would work on this repo.`;

  const constructsList = input.constructs
    .slice(0, 10)
    .map((c) => `${c.slug} (${c.evidence_count})`)
    .join(', ');

  const prSummary = input.sample_prs.slice(0, 10).map((pr) => ({
    pr_number: pr.pr_number,
    title: pr.title,
    changed_files: pr.changed_file_count,
    modifies_tests: pr.modifies_tests === 1,
    resolves_issue: pr.resolves_issue_number !== null,
    swe_bench_eligible: pr.swe_bench_eligible === 1,
  }));

  const user = `FACTS (do not modify, reason from these only):
- repo: ${input.full_name}
- primary_language: ${input.primary_language}
- detected_domain: ${input.detected_domain ?? 'unknown'}
- detected_stack: ${input.detected_stack_json ?? 'unknown'}
- stars: ${input.stars}
- sloc: ${fmt(input.sloc)}
- file_count: ${fmt(input.file_count)}
- mean_ccn: ${fmt(input.mean_ccn)}
- has_ci: ${input.has_ci === 1 ? 'yes' : 'no'}
- has_tests: ${input.has_tests === 1 ? 'yes' : 'no'}
- test_framework: ${input.test_framework ?? 'unknown'}
- seniority_band: ${input.seniority_band ?? 'unknown'}
- pr_quality_score: ${input.pr_quality_score.toFixed(2)}
- test_touch_rate: ${fmt(facts.test_touch_rate)}
- mean_changed_files: ${fmt(facts.mean_changed_files)}
- p90_changed_files: ${fmt(facts.p90_changed_files)}
- issue_link_rate: ${fmt(facts.issue_link_rate)}
- swe_bench_eligibility_rate: ${fmt(facts.swe_bench_eligibility_rate)}
- complexity_band: ${facts.complexity_band ?? 'unknown'}
- test_style: ${facts.test_style}
- business_logic_ratio: ${fmt(facts.business_logic_ratio)}
- cross_module_change_rate: ${fmt(facts.cross_module_change_rate)}
- open_pr_count: ${fmt(facts.open_pr_count)}
- open_feature_issue_count: ${fmt(facts.open_feature_issue_count)}
- challenge_surfaces (top 3, sorted desc): ${topSurfaces(facts.challenge_surfaces, 3)}

Top constructs: ${constructsList || 'none detected'}

Sample PRs (${input.sample_prs.length} total, first 10):
${JSON.stringify(prSummary, null, 2)}

Choose an architecture_style from the enum, write the engineering_narrative, and write the repo_searchable_profile. Remember: use only numbers from FACTS.`;

  return { system, user };
}

function topSurfaces(surfaces: Record<string, number>, k: number): string {
  return Object.entries(surfaces)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([name, score]) => `${name}=${score.toFixed(2)}`)
    .join(', ');
}

// ─── Parse Gemma response ──────────────────────────────────────────────────
//
// Gemma only writes three fields (architecture_style, engineering_narrative,
// repo_searchable_profile). Everything else comes from deterministic stats
// and classifiers. We merge here so the rest of the pipeline sees a single
// Pass3Data value.

const ARCHITECTURE_ENUM = new Set<ArchitectureStyle>([
  'monolith',
  'layered_service',
  'microservice',
  'library',
  'unknown',
]);

export function parseGemmaResponse(
  raw: string,
  input: Pass3Input,
  contentHash: string,
  facts: PromptFacts,
): Pass3Data {
  // Strip markdown code fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(stripped) as Record<string, unknown>;

  const archCandidate = parsed.architecture_style as string | undefined;
  const architecture_style: ArchitectureStyle | null =
    archCandidate && ARCHITECTURE_ENUM.has(archCandidate as ArchitectureStyle)
      ? (archCandidate as ArchitectureStyle)
      : null;

  return {
    repo_id: input.repo_id,
    signals_version: SIGNALS_VERSION,
    content_hash: contentHash,
    test_touch_rate: facts.test_touch_rate,
    mean_changed_files: facts.mean_changed_files,
    p90_changed_files: facts.p90_changed_files,
    issue_link_rate: facts.issue_link_rate,
    complexity_band: facts.complexity_band,
    swe_bench_eligibility_rate: facts.swe_bench_eligibility_rate,
    architecture_style,
    // Review density, commit cadence, and SATD density remain LLM-unobservable
    // in this pipeline — they require git log / code inspection we don't run.
    review_density: null,
    commit_cadence: null,
    satd_density: null,
    test_style: facts.test_style as Pass3Data['test_style'],
    challenge_surfaces: JSON.stringify(facts.challenge_surfaces),
    repo_searchable_profile:
      typeof parsed.repo_searchable_profile === 'string' ? parsed.repo_searchable_profile : '',
    engineering_narrative:
      typeof parsed.engineering_narrative === 'string' ? parsed.engineering_narrative : '',
    signal_json: stripped,
    model_used: SUMMARIZER_MODEL,
    model_version: MODEL_VERSION,
  };
}

// ─── Process a single repo ─────────────────────────────────────────────────

interface RepoResult {
  repo_id: number;
  full_name: string;
  status: 'cache_hit' | 'written' | 'gemma_error' | 'parse_error' | 'validation_failed' | 'judge_failed' | 'persist_failed';
  detail?: string;
  narrative_len?: number;
}

async function processRepo(
  accessToken: string,
  projectId: string,
  db: D1Client,
  input: Pass3Input,
  dryRun: boolean,
  progress?: { index: number; total: number },
): Promise<RepoResult> {
  const base = { repo_id: input.repo_id, full_name: input.full_name };
  const tag = progress ? `[${progress.index}/${progress.total}]` : '';
  logger.info(`[pass3] ${tag} ${input.full_name} — starting`);

  // Step 1: Content hash check
  const contentHash = computeContentHash(input, SIGNALS_VERSION);
  const isCacheHit =
    input.prior_content_hash === contentHash &&
    input.prior_signals_version === SIGNALS_VERSION;

  if (isCacheHit) {
    return { ...base, status: 'cache_hit' };
  }

  if (dryRun) {
    return { ...base, status: 'written', detail: 'dry-run skip' };
  }

  // Step 2a: Deterministic stats + classifiers run BEFORE Gemma.
  // Gemma then only chooses architecture_style and writes narratives.
  const stats = computeDeterministicStats(input.sample_prs);
  const testStyle = classifyTestStyle({
    test_touch_rate: stats.test_touch_rate,
    detected_stack_json: input.detected_stack_json,
  });
  const challengeSurfaces = classifyChallengeSurfaces({
    detected_stack_json: input.detected_stack_json,
    primary_language: input.primary_language,
    constructs: input.constructs,
    detected_domain: input.detected_domain,
  });
  const facts: PromptFacts = {
    ...stats,
    complexity_band: computeComplexityBand(input.mean_ccn),
    test_style: testStyle,
    challenge_surfaces: challengeSurfaces as unknown as Record<string, number>,
    business_logic_ratio: input.business_logic_ratio,
    cross_module_change_rate: input.cross_module_change_rate,
    open_pr_count: input.open_pr_count,
    open_feature_issue_count: input.open_feature_issue_count,
  };

  // Step 2b: Call Gemma
  logger.info(`[pass3] ${tag} ${input.full_name} — calling Gemma`);
  const { system, user: factsPrompt } = buildSummarizerPrompt(input, facts);
  let raw: string;
  try {
    raw = await callGemma(accessToken, projectId, system, factsPrompt);
  } catch (err) {
    return { ...base, status: 'gemma_error', detail: err instanceof Error ? err.message : String(err) };
  }
  logger.info(`[pass3] ${tag} ${input.full_name} — Gemma done`);

  // Step 3: Parse
  let output: Pass3Data;
  try {
    output = parseGemmaResponse(raw, input, contentHash, facts);
  } catch (err) {
    return { ...base, status: 'parse_error', detail: `${err instanceof Error ? err.message : String(err)} | raw: ${raw.slice(0, 200)}` };
  }

  // Step 4: Validate — retry once if it fails
  let validation = validatePass3(input, output);
  if (!validation.valid) {
    logger.warn(
      `[pass3] ${tag} ${input.full_name} — validation failed (${validation.failures.length} issues). Retrying Gemma with corrections.`,
    );
    const retryPrompt =
      `${factsPrompt}\n\n---\nPREVIOUS ATTEMPT FAILED validation. Fix ALL of the following issues in your new response:\n` +
      validation.failures.map((f) => `- ${f}`).join('\n');

    let retryRaw: string;
    try {
      retryRaw = await callGemma(accessToken, projectId, system, retryPrompt);
    } catch (err) {
      return {
        ...base,
        status: 'validation_failed',
        detail: `validation failed; retry Gemma failed: ${err instanceof Error ? err.message : String(err)} | original_failures: ${validation.failures.join('; ')}`,
      };
    }

    try {
      output = parseGemmaResponse(retryRaw, input, contentHash, facts);
    } catch {
      return {
        ...base,
        status: 'validation_failed',
        detail: `validation failed; retry parse failed | original_failures: ${validation.failures.join('; ')}`,
      };
    }

    validation = validatePass3(input, output);
    if (!validation.valid) {
      logger.error(
        `[pass3] ${tag} ${input.full_name} — validation still failed after retry. Dropping. Failures: ${validation.failures.join('; ')}`,
      );
      return { ...base, status: 'validation_failed', detail: `after retry: ${validation.failures.join('; ')}` };
    }

    logger.info(`[pass3] ${tag} ${input.full_name} — validation passed on retry`);
  }
  if (validation.warnings.length > 0) {
    logger.warn(`[pass3] ${input.full_name} warnings: ${validation.warnings.join('; ')}`);
  }

  // Step 4.5: Devstral judge gate
  const mistralKey = process.env['MISTRAL_API_KEY'];
  if (mistralKey) {
    logger.info(`[pass3] ${tag} ${input.full_name} — running judge`);
    let judgeResult = await judgeOutput({
      factsBlock: factsPrompt,
      narrative: output.engineering_narrative,
      profile: output.repo_searchable_profile,
      architectureStyle: output.architecture_style,
      apiKey: mistralKey,
    });

    if (!judgeResult.approved) {
      logger.warn(
        `[pass3] ${tag} ${input.full_name} — judge denied (${judgeResult.failures.length} failures). Retrying Gemma with corrections.`,
      );
      const retryPrompt =
        `${factsPrompt}\n\n---\nPREVIOUS ATTEMPT REJECTED by quality gate. Fix ALL of the following issues in your new response:\n` +
        judgeResult.failures.map((f) => `- ${f}`).join('\n');

      let retryRaw: string;
      try {
        retryRaw = await callGemma(accessToken, projectId, system, retryPrompt);
      } catch (err) {
        return {
          ...base,
          status: 'judge_failed',
          detail: `judge denied; retry Gemma failed: ${err instanceof Error ? err.message : String(err)} | judge_failures: ${judgeResult.failures.join('; ')}`,
        };
      }

      let retryOutput: Pass3Data;
      try {
        retryOutput = parseGemmaResponse(retryRaw, input, contentHash, facts);
      } catch {
        return {
          ...base,
          status: 'judge_failed',
          detail: `judge denied; retry parse failed | judge_failures: ${judgeResult.failures.join('; ')}`,
        };
      }

      const retryValidation = validatePass3(input, retryOutput);
      if (!retryValidation.valid) {
        return {
          ...base,
          status: 'judge_failed',
          detail: `judge denied; retry validation failed: ${retryValidation.failures.join('; ')} | judge_failures: ${judgeResult.failures.join('; ')}`,
        };
      }

      judgeResult = await judgeOutput({
        factsBlock: factsPrompt,
        narrative: retryOutput.engineering_narrative,
        profile: retryOutput.repo_searchable_profile,
        architectureStyle: retryOutput.architecture_style,
        apiKey: mistralKey,
      });

      if (!judgeResult.approved) {
        logger.error(
          `[pass3] ${tag} ${input.full_name} — judge denied after retry. Dropping repo. Failures: ${judgeResult.failures.join('; ')}`,
        );
        return {
          ...base,
          status: 'judge_failed',
          detail: `judge denied after retry | failures: ${judgeResult.failures.join('; ')} | reasoning: ${judgeResult.reasoning.slice(0, 200)}`,
        };
      }

      // Retry passed — use the improved output
      output = retryOutput;
      logger.info(`[pass3] ${tag} ${input.full_name} — judge approved on retry`);
    } else {
      logger.info(`[pass3] ${tag} ${input.full_name} — judge approved`);
    }
  } else {
    logger.warn(`[pass3] ${tag} ${input.full_name} — MISTRAL_API_KEY not set, skipping judge gate`);
  }

  // Step 5: Persist
  const persistResult = await persistAndVerify(db, output, false);
  if (!persistResult.verified) {
    return {
      ...base,
      status: 'persist_failed',
      detail: `expected=${persistResult.expectedHash} actual=${persistResult.actualHash}`,
    };
  }

  return { ...base, status: 'written', narrative_len: output.engineering_narrative.length };
}

// ─── Concurrency helper ────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    let item: T | undefined;
    while ((item = queue.shift()) !== undefined) {
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// ─── Main ──────────────────────────────────────────────────────────────────

interface RunStats {
  total: number;
  cacheHits: number;
  written: number;
  validationFailed: number;
  gemmaErrors: number;
  judgeFailed: number;
  persistFailed: number;
}

export async function getAccessToken(): Promise<string> {
  // Read ADC credentials file and exchange refresh_token for an access token.
  // This avoids needing gcloud in the subprocess PATH.
  const { readFileSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const adcPath = process.env['GOOGLE_APPLICATION_CREDENTIALS']
    ?? `${homedir()}/.config/gcloud/application_default_credentials.json`;

  let creds: { client_id: string; client_secret: string; refresh_token: string; type: string };
  try {
    creds = JSON.parse(readFileSync(adcPath, 'utf-8')) as typeof creds;
  } catch {
    throw new Error(
      `Could not read ADC credentials at ${adcPath}. ` +
      `Run: gcloud auth application-default login --no-browser`,
    );
  }

  if (creds.type !== 'authorized_user') {
    throw new Error(`Unsupported ADC credential type: ${creds.type}. Expected authorized_user.`);
  }

  logger.info('[pass3] Refreshing Vertex AI access token via ADC...');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { access_token: string };
  if (!data.access_token) throw new Error('Token refresh returned no access_token');
  logger.info('[pass3] Access token refreshed successfully');
  return data.access_token;
}

export async function run(opts: FetchOptions & { dryRun?: boolean; concurrency?: number }): Promise<void> {
  const accessToken = await getAccessToken();
  const projectId = process.env['VERTEX_AI_PROJECT_ID'] ?? 'pipe-493116';

  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const db = new D1Client(loadD1Config());
  const runStart = new Date().toISOString();

  logger.info('[pass3/run] Fetching batch...');
  const batch = await fetchBatch(db, opts);
  logger.info(`[pass3/run] ${batch.length} repos in batch (concurrency=${concurrency})`);

  if (batch.length === 0) {
    logger.info('[pass3/run] Nothing to do.');
    return;
  }

  const stats: RunStats = {
    total: batch.length,
    cacheHits: 0,
    written: 0,
    validationFailed: 0,
    gemmaErrors: 0,
    judgeFailed: 0,
    persistFailed: 0,
  };

  const failures: Array<{ repo_id: number; full_name: string; reason: string }> = [];

  let doneCount = 0;
  await runWithConcurrency(batch, concurrency, async (input: Pass3Input) => {
    const index = ++doneCount;
    const result = await processRepo(accessToken, projectId, db, input, opts.dryRun ?? false, { index, total: batch.length });

    switch (result.status) {
      case 'cache_hit':
        stats.cacheHits++;
        logger.info(`[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=cache_hit`);
        break;
      case 'written':
        stats.written++;
        logger.info(
          `[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=written narrative_len=${result.narrative_len ?? 0}`,
        );
        break;
      case 'gemma_error':
      case 'parse_error':
        stats.gemmaErrors++;
        logger.error(`[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=${result.status} detail=${result.detail}`);
        failures.push({ repo_id: result.repo_id, full_name: result.full_name, reason: `${result.status}: ${result.detail}` });
        break;
      case 'validation_failed':
        stats.validationFailed++;
        logger.error(`[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=validation_failed failures=${result.detail}`);
        failures.push({ repo_id: result.repo_id, full_name: result.full_name, reason: `validation: ${result.detail}` });
        break;
      case 'judge_failed':
        stats.judgeFailed++;
        logger.error(`[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=judge_failed detail=${result.detail}`);
        failures.push({ repo_id: result.repo_id, full_name: result.full_name, reason: `judge: ${result.detail}` });
        break;
      case 'persist_failed':
        stats.persistFailed++;
        logger.error(`[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=persist_unverified ${result.detail}`);
        failures.push({ repo_id: result.repo_id, full_name: result.full_name, reason: `persist: ${result.detail}` });
        break;
    }
  });

  // Final report
  console.log('\n═══ Pass 3 — Vertex AI Gemma ═══');
  console.log(`Batch:             ${stats.total} repos`);
  console.log(`  Cache hits:      ${stats.cacheHits}`);
  console.log(`  Written:         ${stats.written}`);
  console.log(`  Validation fail: ${stats.validationFailed}`);
  console.log(`  Gemma errors:    ${stats.gemmaErrors}`);
  console.log(`  Judge failed:    ${stats.judgeFailed}`);
  console.log(`  Persist fail:    ${stats.persistFailed}`);
  console.log(`signals_version:   ${SIGNALS_VERSION}`);
  console.log(`model_used:        ${SUMMARIZER_MODEL}`);
  console.log(`concurrency:       ${concurrency}`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  repo_id=${f.repo_id} ${f.full_name}: ${f.reason}`);
    }
  }

  // Audit
  if (!opts.dryRun && stats.written > 0) {
    console.log('\n─── Audit (rows written this run) ───');
    const audit = await auditSignals(db, runStart);
    for (const row of audit) {
      console.log(
        `  ${row.repo_id} ${row.full_name ?? '(orphan)'} narr=${row.narrative_len} model=${row.model_used}`,
      );
    }
  }
}

// ─── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): FetchOptions & { dryRun?: boolean; concurrency?: number } {
  const opts: FetchOptions & { dryRun?: boolean; concurrency?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') {
      opts.limit = Number(argv[++i]);
    } else if (a === '--repo-id') {
      opts.repoId = Number(argv[++i]);
    } else if (a === '--only-missing') {
      opts.onlyMissing = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--concurrency') {
      opts.concurrency = Number(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: npx tsx scripts/crawl-repos/pass3/run.ts [--limit N] [--repo-id N] [--only-missing] [--dry-run] [--concurrency N]');
      process.exit(0);
    }
  }
  return opts;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  run(opts).catch((err) => {
    console.error('[pass3/run] Fatal:', err);
    process.exit(1);
  });
}
