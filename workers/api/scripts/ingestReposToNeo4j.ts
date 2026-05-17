#!/usr/bin/env tsx
/**
 * ingestReposToNeo4j.ts — Rich repo graph ingestion for Neo4j.
 *
 * Reads from local D1 SQLite and writes a proper graph-structured repo model:
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
 *
 * Prerequisites:
 *   1. Run `bash scripts/sync-repos-local.sh` to pull remote D1 data locally.
 *   2. Ensure Neo4j is running and NEO4J_URI / NEO4J_PASSWORD are in .dev.vars.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve('.dev.vars') });

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

import { buildNeo4jConfig, createNeo4jDriver } from '../src/lib/neo4j/driver';
import { preprocessForEmbedding } from '../src/lib/embedding/preprocess';

const DB_PATH = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c7052d4c5f690270845d2e1be0b13a62fc3f47b010c62f2243a64980dbf38f15.sqlite';
const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
const EMBED_MODEL = '@cf/baai/bge-large-en-v1.5';
const MAX_CHARS = 8192;

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
}

const env = {
  NEO4J_URI: process.env['NEO4J_URI']!,
  NEO4J_USER: process.env['NEO4J_USER']!,
  NEO4J_PASSWORD: process.env['NEO4J_PASSWORD']!,
  CLOUDFLARE_ACCOUNT_ID: process.env['CLOUDFLARE_ACCOUNT_ID']!,
  CLOUDFLARE_API_TOKEN: process.env['CLOUDFLARE_API_TOKEN']!,
};

function getDb() {
  return new Database(DB_PATH);
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

/** Build a synthetic searchable profile for repos without Pass-3 signals. */
function buildSyntheticProfile(repo: QualifiedRepo): string {
  const parts = [
    `Repository: ${repo.full_name}.`,
    `Primary language: ${repo.primary_language}.`,
    repo.seniority_band ? `Complexity level: ${repo.seniority_band}.` : '',
    repo.detected_domain ? `Domain: ${repo.detected_domain}.` : '',
    repo.description ? `Description: ${repo.description}` : '',
  ];
  return parts.filter(Boolean).join(' ');
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

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const batchSizeArg = args.find((a) => a.startsWith('--batch-size='));
  const dryRun = args.includes('--dry-run');

  const limit = limitArg ? parseInt(limitArg.split('=')[1]!, 10) : Infinity;
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]!, 10) : 50;

  // Validate env
  const config = buildNeo4jConfig(env);
  if (!config) {
    console.error('Missing Neo4j config. Set NEO4J_URI and NEO4J_PASSWORD in .dev.vars');
    process.exit(1);
  }

  const db = getDb();
  const driver = createNeo4jDriver(config);

  // Verify Neo4j connection
  {
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
    ${Number.isFinite(limit) ? 'LIMIT ' + limit : ''}
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

  const prs = db.prepare(`
    SELECT repo_id, pr_number, pr_url, title, pr_narrative,
           pr_narrative_embedding_json, changed_file_count, swe_bench_eligible
    FROM repo_sample_prs
  `).all() as RepoPR[];
  const prsByRepo = new Map<number, RepoPR[]>();
  for (const p of prs) {
    const list = prsByRepo.get(p.repo_id) ?? [];
    list.push(p);
    prsByRepo.set(p.repo_id, list);
  }
  console.log(`  Found ${prs.length} PR records`);

  // Track stats
  let reposWritten = 0;
  let elementsWritten = 0;
  let prsWritten = 0;
  let constructsWritten = 0;
  let embeddingsGenerated = 0;
  let embeddingsReused = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < repos.length; i += batchSize) {
    const batch = repos.slice(i, i + batchSize);
    console.log(`\n→ Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(repos.length / batchSize)} (${batch.length} repos)`);

    const session = driver.session();
    try {
      await session.executeWrite(async (tx) => {
        for (const repo of batch) {
          const signal = signalByRepo.get(repo.id);
          const repoConstructs = constructsByRepo.get(repo.id) ?? [];
          const repoPRs = prsByRepo.get(repo.id) ?? [];

          // Determine searchable profile and embedding
          let searchableProfile: string;
          let embedding: number[] | null = null;

          if (signal?.repo_searchable_profile) {
            searchableProfile = signal.repo_searchable_profile;
          } else {
            searchableProfile = buildSyntheticProfile(repo);
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
          if (!embedding && !dryRun && searchableProfile.length > 20) {
            embedding = await embedText(searchableProfile);
            if (embedding) embeddingsGenerated++;
          }

          // Skip repos that can't be embedded (unless dry-run)
          if (!dryRun && !embedding) {
            console.warn(`  ⚠ Skipping repo ${repo.id} (${repo.full_name}) — no embedding`);
            continue;
          }

          // Use a dummy embedding for dry-run so Cypher still works
          const embedValue = dryRun
            ? new Array(1024).fill(0.001)
            : embedding;

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
              embedding: embedValue,
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
            if (!prEmbedding && p.pr_narrative && !dryRun) {
              prEmbedding = await embedText(p.pr_narrative);
            }

            const prEmbedValue = dryRun
              ? new Array(1024).fill(0.001)
              : prEmbedding;

            await tx.run(
              `
              MATCH (r:Repo {repo_id: $repo_id})
              MERGE (pr:PullRequest {repo_id: $repo_id, pr_number: $pr_number})
              SET pr.pr_url = $pr_url,
                  pr.title = $title,
                  pr.narrative = $narrative,
                  pr.changed_file_count = $changed_file_count,
                  pr.swe_bench_eligible = $swe_bench_eligible,
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
                embedding: prEmbedValue,
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
  await driver.close();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  INGESTION COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Repos written:        ${reposWritten}`);
  console.log(`  RepoElements written: ${elementsWritten}`);
  console.log(`  Constructs written:   ${constructsWritten}`);
  console.log(`  PRs written:          ${prsWritten}`);
  console.log(`  Embeddings reused:    ${embeddingsReused}`);
  console.log(`  Embeddings generated: ${embeddingsGenerated}`);
  console.log(`  Errors:               ${errors}`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
