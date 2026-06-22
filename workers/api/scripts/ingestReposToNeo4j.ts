#!/usr/bin/env tsx
/**
 * ingestReposToNeo4j.ts — rebuild the Neo4j repo projection from D1.
 *
 * D1 remains the source of truth. Neo4j is a rebuildable search/graph
 * projection over crawler/pass3 repo data:
 *
 *   (:Repo {
 *     repo_id, full_name, primary_language, seniority_band,
 *     detected_domain, stars, pr_quality_score, architecture_style,
 *     searchable_profile, embedding
 *   })
 *   (:Repo)-[:HAS]->(:RepoNode { id, node_type, narrative, embedding })
 *   (:Repo)-[:HAS_CONSTRUCT {evidence_count}]->(:RepoConstruct { name })
 *   (:Repo)-[:HAS_PR {eligible, changed_file_count}]->(:PullRequest {
 *     pr_number, title, narrative, embedding
 *   })
 *
 * Usage:
 *   npx tsx scripts/ingestReposToNeo4j.ts [--limit N] [--batch-size N]
 *   npx tsx scripts/ingestReposToNeo4j.ts --dry-run
 *   npx tsx scripts/ingestReposToNeo4j.ts --database-path .wrangler/state/.../db.sqlite
 *
 * Prerequisites:
 *   1. Run `bash scripts/sync-repos-local.sh` to pull remote D1 data locally.
 *   2. Ensure Neo4j is running and NEO4J_URI / NEO4J_PASSWORD are in .dev.vars.
 */

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

import { buildNeo4jConfig, createNeo4jDriver } from '../src/lib/neo4j/driver';
import { preprocessForEmbedding } from '../src/lib/embedding/preprocess';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
const EMBED_MODEL = '@cf/baai/bge-large-en-v1.5';
const MAX_CHARS = 8192;

export interface Options {
  limit: number;
  batchSize: number;
  dryRun: boolean;
  databasePath?: string;
}

interface QualifiedRepo {
  id: number;
  full_name: string;
  primary_language: string;
  seniority_band: string | null;
  detected_domain: string | null;
  stars: number;
  pr_quality_score: number;
  description: string | null;
}

interface RepoSignal {
  repo_id: number;
  repo_searchable_profile: string | null;
  engineering_narrative: string | null;
  embedding_json: string | null;
  challenge_surfaces: string | null;
  signal_json: string | null;
  architecture_style: string | null;
}

interface RepoConstruct {
  repo_id: number;
  construct_slug: string;
  evidence_count: number;
}

interface RepoPR {
  repo_id: number;
  pr_number: number;
  pr_url: string;
  title: string | null;
  pr_narrative: string | null;
  pr_narrative_embedding_json: string | null;
  changed_file_count: number;
  swe_bench_eligible: number;
  packet_id: string;
  repo_snapshot_id: string;
  packet_content_hash: string;
  context_record_id: string;
  repo_source_ref_count: number;
  concept_link_count: number;
}

interface RepoPRQueryRow extends Omit<RepoPR, 'pr_narrative' | 'pr_narrative_embedding_json'> {
  packet_json: string;
}

const env = {
  NEO4J_URI: process.env['NEO4J_URI']!,
  NEO4J_USER: process.env['NEO4J_USER']!,
  NEO4J_PASSWORD: process.env['NEO4J_PASSWORD']!,
  CLOUDFLARE_ACCOUNT_ID: process.env['CLOUDFLARE_ACCOUNT_ID']!,
  CLOUDFLARE_API_TOKEN: process.env['CLOUDFLARE_API_TOKEN']!,
};

function readValue(argv: string[], index: number, flag: string): [string, number] {
  const arg = argv[index]!;
  const inlinePrefix = `${flag}=`;
  if (arg.startsWith(inlinePrefix)) return [arg.slice(inlinePrefix.length), index];
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    limit: Infinity,
    batchSize: 50,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const [value, consumedIndex] = readValue(argv, index, '--limit');
      options.limit = positiveInteger(value, '--limit');
      index = consumedIndex;
    } else if (arg === '--batch-size' || arg.startsWith('--batch-size=')) {
      const [value, consumedIndex] = readValue(argv, index, '--batch-size');
      options.batchSize = positiveInteger(value, '--batch-size');
      index = consumedIndex;
    } else if (arg === '--database-path' || arg.startsWith('--database-path=')) {
      const [value, consumedIndex] = readValue(argv, index, '--database-path');
      options.databasePath = value;
      index = consumedIndex;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function discoverLocalDatabase(explicitPath?: string, root = apiRoot): string {
  if (explicitPath) return isAbsolute(explicitPath) ? explicitPath : resolve(root, explicitPath);

  const directory = resolve(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (!existsSync(directory)) {
    throw new Error(`Local D1 directory not found; pass --database-path. Missing: ${directory}`);
  }
  const candidates = readdirSync(directory)
    .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
    .map((name) => resolve(directory, name));
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one local D1 database; pass --database-path. Found: ${candidates.join(', ') || 'none'}`,
    );
  }
  return candidates[0]!;
}

function getDb(databasePath: string) {
  return new Database(databasePath);
}

interface SqliteLike {
  prepare(sql: string): {
    get?(...values: unknown[]): unknown;
    all?(...values: unknown[]): unknown[];
  };
}

function tableExists(db: SqliteLike, tableName: string): boolean {
  const row = db.prepare(
    `SELECT COUNT(*) AS count
       FROM sqlite_master
      WHERE type = 'table'
        AND name = ?`,
  ).get?.(tableName) as { count?: number } | undefined;
  return Number(row?.count ?? 0) > 0;
}

/** Fetch embedding from Cloudflare AI REST API. */
async function embedText(text: string): Promise<number[] | null> {
  if (!text || text.trim().length === 0) return null;

  const normalized = preprocessForEmbedding(text, 'document');

  const res = await fetch(
    `${CF_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${EMBED_MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: [normalized] }),
    },
  );

  if (!res.ok) {
    console.error(`[embed] HTTP ${res.status}: ${await res.text()}`);
    return null;
  }

  const data = (await res.json()) as { result?: { data?: number[][] } };
  const vec = data?.result?.data?.[0];
  if (!vec || vec.length !== 1024) {
    console.error(`[embed] Bad vector shape: ${vec?.length}`);
    return null;
  }

  // Sanity check
  if (vec.some((n) => !Number.isFinite(n))) {
    console.error('[embed] Non-finite values in vector');
    return null;
  }

  return vec;
}

export function sourceBackedRepoProfile(
  signal: { repo_searchable_profile?: string | null } | null | undefined,
): string | null {
  const profile = signal?.repo_searchable_profile?.trim();
  return profile ? profile : null;
}

export function sourceBackedPullRequestNarrative(packetJson: string): string | null {
  let packet: unknown;
  try {
    packet = JSON.parse(packetJson);
  } catch {
    return null;
  }
  if (typeof packet !== 'object' || packet === null) return null;
  const record = packet as {
    pullRequest?: { title?: unknown; body?: unknown };
    demands?: unknown;
  };
  const title = typeof record.pullRequest?.title === 'string'
    ? record.pullRequest.title.trim()
    : '';
  const body = typeof record.pullRequest?.body === 'string'
    ? record.pullRequest.body.trim()
    : '';
  const demandNarratives = Array.isArray(record.demands)
    ? record.demands
      .map((demand) => {
        if (typeof demand !== 'object' || demand === null) return '';
        const narrative = (demand as { narrative?: unknown }).narrative;
        return typeof narrative === 'string' ? narrative.trim() : '';
      })
      .filter(Boolean)
    : [];

  const sections = [
    title ? `Title: ${title}` : '',
    body ? `Body: ${body}` : '',
    demandNarratives.length > 0 ? `Source-backed demands:\n${demandNarratives.map((n) => `- ${n}`).join('\n')}` : '',
  ].filter(Boolean);

  return sections.length > 0 ? sections.join('\n\n') : null;
}

export function loadSourceBackedReviewPullRequests(db: SqliteLike): RepoPR[] {
  const requiredTables = [
    'qualified_repos',
    'repo_sample_prs',
    'review_challenge_packets',
    'context_records',
    'context_record_source_refs',
    'context_record_concepts',
  ];
  if (!requiredTables.every((tableName) => tableExists(db, tableName))) return [];

  const rows = db.prepare(`
    SELECT
      rsp.repo_id,
      rsp.pr_number,
      rsp.pr_url,
      rsp.title,
      rsp.changed_file_count,
      rsp.swe_bench_eligible,
      rcp.id AS packet_id,
      rcp.repo_snapshot_id,
      rcp.source_hash AS packet_content_hash,
      rcp.packet_json,
      cr.id AS context_record_id,
      (
        SELECT COUNT(*)
          FROM context_record_source_refs crsr
         WHERE crsr.context_record_id = cr.id
           AND crsr.source_ref_type = 'repo_source_span'
      ) AS repo_source_ref_count,
      (
        SELECT COUNT(*)
          FROM context_record_concepts crc
         WHERE crc.context_record_id = cr.id
      ) AS concept_link_count
    FROM repo_sample_prs rsp
    JOIN qualified_repos qr ON qr.id = rsp.repo_id
    JOIN review_challenge_packets rcp
      ON rcp.repo_id = rsp.repo_id
     AND rcp.pr_number = rsp.pr_number
     AND rcp.production_ready = 1
    JOIN context_records cr
      ON cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
     AND cr.scope_type = 'repo_snapshot'
     AND cr.scope_id = rcp.repo_snapshot_id
     AND cr.record_type = 'repo_challenge_packet'
    WHERE COALESCE(qr.disqualified, 0) = 0
      AND COALESCE(qr.test_framework, '') <> 'source-backed-fixture'
      AND (
        SELECT COUNT(*)
          FROM context_record_source_refs crsr
         WHERE crsr.context_record_id = cr.id
           AND crsr.source_ref_type = 'repo_source_span'
      ) > 0
      AND (
        SELECT COUNT(*)
          FROM context_record_concepts crc
         WHERE crc.context_record_id = cr.id
      ) > 0
    ORDER BY rsp.repo_id, rsp.pr_number
  `).all?.() ?? [];
  return (rows as RepoPRQueryRow[])
    .map((row) => {
      const prNarrative = sourceBackedPullRequestNarrative(row.packet_json);
      if (!prNarrative) return null;
      return {
        ...row,
        pr_narrative: prNarrative,
        pr_narrative_embedding_json: null,
      } satisfies RepoPR;
    })
    .filter((row): row is RepoPR => row !== null);
}

/** Parse challenge surfaces JSON into flat key/value pairs. */
function parseChallengeSurfaces(json: string | null): Array<{ name: string; score: number }> {
  if (!json) return [];
  try {
    const obj = JSON.parse(json) as Record<string, number>;
    return Object.entries(obj)
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([k, v]) => ({ name: k.replace(/_/g, ' '), score: v }));
  } catch {
    return [];
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const databasePath = discoverLocalDatabase(options.databasePath);
  const db = getDb(databasePath);
  let driver: ReturnType<typeof createNeo4jDriver> | undefined;

  console.log(`[neo4j-repo-projection] source D1=${databasePath}`);

  if (options.dryRun) {
    console.log('[neo4j-repo-projection] dry-run: Neo4j writes and embedding generation disabled');
  } else {
    const config = buildNeo4jConfig(env);
    if (!config) {
      throw new Error('Missing Neo4j config. Set NEO4J_URI and NEO4J_PASSWORD in .dev.vars');
    }
    driver = createNeo4jDriver(config);
    const session = driver.session();
    try {
      const result = await session.run('RETURN 1 AS n');
      const n = result.records[0]?.get('n');
      if (n !== 1 && n?.toNumber?.() !== 1) {
        throw new Error('Neo4j health check failed');
      }
      console.log('✓ Neo4j connection verified');
    } finally {
      await session.close();
    }
  }

  // Load data from D1
  console.log('\n→ Loading repos from D1...');
  const repos = db.prepare(`
    SELECT q.id, q.full_name, q.primary_language, q.seniority_band, q.detected_domain,
           q.stars, q.pr_quality_score, q.description
    FROM qualified_repos q
    LEFT JOIN repo_engineering_signals s ON s.repo_id = q.id
    WHERE q.disqualified = 0
    ORDER BY CASE WHEN s.repo_id IS NOT NULL THEN 0 ELSE 1 END, q.stars DESC
    ${Number.isFinite(options.limit) ? 'LIMIT ' + options.limit : ''}
  `).all() as QualifiedRepo[];

  console.log(`  Found ${repos.length} qualified repos`);

  const signals = db.prepare(`
    SELECT repo_id, repo_searchable_profile, engineering_narrative, embedding_json,
           challenge_surfaces, signal_json, architecture_style
    FROM repo_engineering_signals
  `).all() as RepoSignal[];
  const signalByRepo = new Map<number, RepoSignal>();
  for (const s of signals) signalByRepo.set(s.repo_id, s);
  console.log(`  Found ${signals.length} repos with AI signals`);

  const constructs = db.prepare(`
    SELECT repo_id, construct_slug, evidence_count FROM repo_constructs
  `).all() as RepoConstruct[];
  const constructsByRepo = new Map<number, RepoConstruct[]>();
  for (const c of constructs) {
    const list = constructsByRepo.get(c.repo_id) ?? [];
    list.push(c);
    constructsByRepo.set(c.repo_id, list);
  }
  console.log(`  Found ${constructs.length} construct records`);

  const prs = loadSourceBackedReviewPullRequests(db);
  const prsByRepo = new Map<number, RepoPR[]>();
  for (const p of prs) {
    const list = prsByRepo.get(p.repo_id) ?? [];
    list.push(p);
    prsByRepo.set(p.repo_id, list);
  }
  console.log(`  Found ${prs.length} source-backed review PR packet records`);

  // Track stats
  let reposWritten = 0;
  let elementsWritten = 0;
  let prsWritten = 0;
  let constructsWritten = 0;
  let embeddingsGenerated = 0;
  let embeddingsReused = 0;
  let skippedNoProfile = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < repos.length; i += options.batchSize) {
    const batch = repos.slice(i, i + options.batchSize);
    console.log(`\n→ Batch ${Math.floor(i / options.batchSize) + 1}/${Math.ceil(repos.length / options.batchSize)} (${batch.length} repos)`);

    if (options.dryRun) {
      for (const repo of batch) {
        const signal = signalByRepo.get(repo.id);
        const searchableProfile = sourceBackedRepoProfile(signal);
        if (!searchableProfile) {
          skippedNoProfile++;
          continue;
        }
        const repoConstructs = constructsByRepo.get(repo.id) ?? [];
        const repoPRs = prsByRepo.get(repo.id) ?? [];

        reposWritten++;
        elementsWritten += parseChallengeSurfaces(signal?.challenge_surfaces ?? null).length;
        if (signal?.engineering_narrative) elementsWritten++;
        constructsWritten += repoConstructs.length;
        prsWritten += repoPRs.slice(0, 5).length;

        if (signal?.embedding_json) {
          try {
            const embedding = JSON.parse(signal.embedding_json) as unknown;
            if (Array.isArray(embedding) && embedding.length === 1024) embeddingsReused++;
          } catch {
            /* dry-run summary only */
          }
        }
      }
      continue;
    }

    const session = driver!.session();
    try {
      await session.executeWrite(async (tx) => {
        for (const repo of batch) {
          const signal = signalByRepo.get(repo.id);
          const repoConstructs = constructsByRepo.get(repo.id) ?? [];
          const repoPRs = prsByRepo.get(repo.id) ?? [];

          // Determine searchable profile and embedding. Do not invent a profile:
          // D1 must already contain source-backed repo_searchable_profile text.
          const searchableProfile = sourceBackedRepoProfile(signal);
          let embedding: number[] | null = null;

          if (!searchableProfile) {
            skippedNoProfile++;
            console.warn(
              `  ⚠ Skipping repo ${repo.id} (${repo.full_name}) — no source-backed repo_searchable_profile`,
            );
            continue;
          }

          // Try to reuse existing embedding
          if (signal?.embedding_json) {
            try {
              embedding = JSON.parse(signal.embedding_json);
              if (embedding.length === 1024) {
                embeddingsReused++;
              } else {
                embedding = null;
              }
            } catch {
              embedding = null;
            }
          }

          // Generate embedding if missing and not dry-run
          if (!embedding && searchableProfile.length > 20) {
            embedding = await embedText(searchableProfile);
            if (embedding) embeddingsGenerated++;
          }

          // Skip repos that can't be embedded.
          if (!embedding) {
            console.warn(`  ⚠ Skipping repo ${repo.id} (${repo.full_name}) — no embedding`);
            continue;
          }

          // 1. MERGE Repo root node
          await tx.run(
            `
            MERGE (r:Repo {repo_id: $repo_id})
            SET r.full_name = $full_name,
                r.primary_language = $primary_language,
                r.seniority_band = $seniority_band,
                r.detected_domain = $detected_domain,
                r.stars = $stars,
                r.pr_quality_score = $pr_quality_score,
                r.architecture_style = $architecture_style,
                r.searchable_profile = $searchable_profile,
                r.embedding = $embedding,
                r.updated_at = datetime()
            `,
            {
              repo_id: repo.id,
              full_name: repo.full_name,
              primary_language: repo.primary_language,
              seniority_band: repo.seniority_band,
              detected_domain: repo.detected_domain,
              stars: repo.stars,
              pr_quality_score: repo.pr_quality_score,
              architecture_style: signal?.architecture_style ?? 'unknown',
              searchable_profile: searchableProfile.slice(0, MAX_CHARS),
              embedding,
            },
          );
          reposWritten++;

          // 2. Create RepoElement nodes for challenge surfaces
          const surfaces = parseChallengeSurfaces(signal?.challenge_surfaces ?? null);
          for (const surface of surfaces) {
            const elId = `${repo.id}_surface_${surface.name.replace(/\s+/g, '_')}`;
            await tx.run(
              `
              MATCH (r:Repo {repo_id: $repo_id})
              MERGE (e:RepoNode:ChallengeSurface {id: $el_id})
              SET e.node_type = 'ChallengeSurface',
                  e.narrative = $narrative,
                  e.score = $score
              MERGE (r)-[:HAS]->(e)
              `,
              {
                repo_id: repo.id,
                el_id: elId,
                narrative: `${repo.full_name} has ${surface.name} potential (score: ${surface.score.toFixed(2)})`,
                score: surface.score,
              },
            );
            elementsWritten++;
          }

          // 3. Create RepoElement for engineering narrative (if available)
          if (signal?.engineering_narrative) {
            const elId = `${repo.id}_narrative`;
            await tx.run(
              `
              MATCH (r:Repo {repo_id: $repo_id})
              MERGE (e:RepoNode:EngineeringNarrative {id: $el_id})
              SET e.node_type = 'EngineeringNarrative',
                  e.narrative = $narrative
              MERGE (r)-[:HAS]->(e)
              `,
              {
                repo_id: repo.id,
                el_id: elId,
                narrative: signal.engineering_narrative.slice(0, MAX_CHARS),
              },
            );
            elementsWritten++;
          }

          // 4. Create Construct nodes
          for (const c of repoConstructs) {
            await tx.run(
              `
              MATCH (r:Repo {repo_id: $repo_id})
              MERGE (c:RepoConstruct {name: $name})
              MERGE (r)-[:HAS_CONSTRUCT {evidence_count: $evidence_count}]->(c)
              `,
              {
                repo_id: repo.id,
                name: c.construct_slug,
                evidence_count: c.evidence_count,
              },
            );
            constructsWritten++;
          }

          // 5. Create PR nodes (with embeddings when available)
          for (const p of repoPRs.slice(0, 5)) {
            let prEmbedding: number[] | null = null;
            if (p.pr_narrative_embedding_json) {
              try {
                prEmbedding = JSON.parse(p.pr_narrative_embedding_json);
                if (prEmbedding.length !== 1024) prEmbedding = null;
              } catch {
                /* ignore */
              }
            }

            // Generate PR embedding if missing and we have a narrative
            if (!prEmbedding && p.pr_narrative) {
              prEmbedding = await embedText(p.pr_narrative);
            }

            await tx.run(
              `
              MATCH (r:Repo {repo_id: $repo_id})
              MERGE (pr:PullRequest {repo_id: $repo_id, pr_number: $pr_number})
              SET pr.pr_url = $pr_url,
                  pr.title = $title,
                  pr.narrative = $narrative,
                  pr.changed_file_count = $changed_file_count,
                  pr.swe_bench_eligible = $swe_bench_eligible,
                  pr.review_challenge_packet_id = $packet_id,
                  pr.repo_snapshot_id = $repo_snapshot_id,
                  pr.packet_content_hash = $packet_content_hash,
                  pr.context_record_id = $context_record_id,
                  pr.repo_source_ref_count = $repo_source_ref_count,
                  pr.concept_link_count = $concept_link_count,
                  pr.context_ready = true,
                  pr.embedding = $embedding
              MERGE (r)-[:HAS_PR]->(pr)
              `,
              {
                repo_id: repo.id,
                pr_number: p.pr_number,
                pr_url: p.pr_url,
                title: p.title ?? '',
                narrative: (p.pr_narrative ?? p.title ?? '').slice(0, MAX_CHARS),
                changed_file_count: p.changed_file_count,
                swe_bench_eligible: p.swe_bench_eligible === 1,
                packet_id: p.packet_id,
                repo_snapshot_id: p.repo_snapshot_id,
                packet_content_hash: p.packet_content_hash,
                context_record_id: p.context_record_id,
                repo_source_ref_count: p.repo_source_ref_count,
                concept_link_count: p.concept_link_count,
                embedding: prEmbedding,
              },
            );
            prsWritten++;
          }
        }
      });
    } catch (err) {
      console.error(`  ✗ Batch failed:`, err instanceof Error ? err.message : String(err));
      errors += batch.length;
    } finally {
      await session.close();
    }
  }

  db.close();
  await driver?.close();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(options.dryRun ? '  INGESTION DRY RUN COMPLETE' : '  INGESTION COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Repos ${options.dryRun ? 'projected' : 'written'}:        ${reposWritten}`);
  console.log(`  RepoElements ${options.dryRun ? 'projected' : 'written'}: ${elementsWritten}`);
  console.log(`  Constructs ${options.dryRun ? 'projected' : 'written'}:   ${constructsWritten}`);
  console.log(`  PRs ${options.dryRun ? 'projected' : 'written'}:          ${prsWritten}`);
  console.log(`  Embeddings reused:    ${embeddingsReused}`);
  console.log(`  Embeddings generated: ${embeddingsGenerated}`);
  console.log(`  Skipped no profile:   ${skippedNoProfile}`);
  console.log(`  Errors:               ${errors}`);
  console.log('═══════════════════════════════════════════════════════');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
