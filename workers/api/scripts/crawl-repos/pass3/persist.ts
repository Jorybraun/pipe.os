/**
 * Pass 3: Persist
 *
 * Writes repo_engineering_signals rows — the offline AI-summarized signals
 * output (ADR-036 §2). Role-agnostic by design; one row per repo.
 *
 * Idempotent on repo_id via INSERT OR REPLACE so unchanged repos can be
 * re-submitted without duplication. Content hashing is done upstream in the
 * slash command; this function just receives the hash and writes it.
 *
 * `persistAndVerify` wraps the bare writer with a SELECT-back round-trip —
 * after each INSERT we read the row we just wrote and confirm the
 * content_hash matches what was sent. This catches silent write failures
 * (e.g. a schema mismatch swallowed by SQLite's lenient INSERT) that the
 * bare persistPass3 would miss. The skill calls persistAndVerify, not
 * persistPass3 directly.
 */

import { D1Client, loadD1Config } from '../shared/d1Client.js';
import type { Pass3Data, Pass3Output, RepoSubElement } from '../shared/types.js';
import { logger } from '../shared/logger.js';
import { preprocessForEmbedding } from '../../../src/lib/embedding/preprocess';
import { writeRepoGraph } from '../../../src/lib/neo4j/writeRepoGraph';
import type { PersistResult } from './types.js';

const VECTORIZE_INDEX_NAME = 'repo-searchable-profiles';
const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';
const API_BASE = 'https://api.cloudflare.com/client/v4';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Embed the repo_searchable_profile via Workers AI REST and upsert into
 * Vectorize. Best-effort: logged on failure, does not throw. SQL remains the
 * authoritative store (STRATEGY Decision Log 2026-04-14).
 */
export async function upsertToVectorize(data: Pass3Data): Promise<void> {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'];
  if (!accountId || !apiToken) {
    logger.warn('[pass3/persist] Vectorize skipped — missing CLOUDFLARE_ACCOUNT_ID/API_TOKEN');
    return;
  }
  if (!data.repo_searchable_profile || data.repo_searchable_profile.trim().length === 0) {
    logger.warn('[pass3/persist] Vectorize skipped — empty repo_searchable_profile', {
      repo_id: data.repo_id,
    });
    return;
  }

  try {
    // 1. Embed via Workers AI REST API.
    const embedRes = await globalThis.fetch(
      `${API_BASE}/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: [data.repo_searchable_profile] }),
      },
    );
    if (!embedRes.ok) {
      const text = await embedRes.text();
      logger.warn('[pass3/persist] Embedding call failed', {
        repo_id: data.repo_id,
        status: embedRes.status,
        body: text.slice(0, 300),
      });
      return;
    }
    const embedBody = (await embedRes.json()) as {
      result?: { data?: number[][]; shape?: number[] };
      success?: boolean;
    };
    const vector = embedBody.result?.data?.[0];
    if (!vector || !Array.isArray(vector)) {
      logger.warn('[pass3/persist] Embedding response missing vector', { repo_id: data.repo_id });
      return;
    }

    // 2. Upsert to Vectorize (NDJSON body).
    const ndjson = JSON.stringify({
      id: `repo_${data.repo_id}`,
      values: vector,
      metadata: {
        repo_id: data.repo_id,
        signals_version: data.signals_version,
        architecture_style: data.architecture_style ?? 'unknown',
      },
    }) + '\n';

    const upsertRes = await globalThis.fetch(
      `${API_BASE}/accounts/${accountId}/vectorize/v2/indexes/${VECTORIZE_INDEX_NAME}/upsert`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/x-ndjson',
        },
        body: ndjson,
      },
    );
    if (!upsertRes.ok) {
      const text = await upsertRes.text();
      logger.warn('[pass3/persist] Vectorize upsert failed', {
        repo_id: data.repo_id,
        status: upsertRes.status,
        body: text.slice(0, 300),
      });
      return;
    }

    logger.debug('[pass3/persist] Vectorize upserted', { repo_id: data.repo_id });
  } catch (err) {
    logger.warn('[pass3/persist] Vectorize upsert threw', {
      repo_id: data.repo_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function persistPass3(
  db: D1Client,
  data: Pass3Data,
  dryRun = false,
): Promise<void> {
  if (dryRun) {
    logger.info('[pass3/persist] DRY RUN — would upsert repo_engineering_signals', {
      repo_id: data.repo_id,
      content_hash: data.content_hash,
    });
    return;
  }

  await db.query(
    `INSERT OR REPLACE INTO repo_engineering_signals (
      repo_id,
      signals_version,
      content_hash,
      test_touch_rate,
      mean_changed_files,
      p90_changed_files,
      issue_link_rate,
      complexity_band,
      swe_bench_eligibility_rate,
      architecture_style,
      review_density,
      commit_cadence,
      satd_density,
      test_style,
      challenge_surfaces,
      repo_searchable_profile,
      engineering_narrative,
      signal_json,
      model_used,
      model_version,
      challenge_suitability_verdict,
      challenge_suitability_reason,
      top_pr_picks_json,
      red_flags_json,
      seniority_justification,
      ideal_role_match,
      confidence_score,
      confidence_scores_json,
      confidence_verdict,
      confidence_scored_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.repo_id,
      data.signals_version,
      data.content_hash,
      data.test_touch_rate,
      data.mean_changed_files,
      data.p90_changed_files,
      data.issue_link_rate,
      data.complexity_band,
      data.swe_bench_eligibility_rate,
      data.architecture_style,
      data.review_density,
      data.commit_cadence,
      data.satd_density,
      data.test_style,
      data.challenge_surfaces,
      data.repo_searchable_profile,
      data.engineering_narrative,
      data.signal_json,
      data.model_used,
      data.model_version,
      data.challenge_suitability_verdict,
      data.challenge_suitability_reason,
      JSON.stringify(data.top_pr_picks ?? []),
      JSON.stringify(data.red_flags ?? []),
      data.seniority_justification,
      data.ideal_role_match,
      data.confidence_score,
      data.confidence_scores_json,
      data.confidence_verdict,
      data.confidence_scored_at,
    ],
  );

  logger.debug('[pass3/persist] Pass-3 persisted', {
    repo_id: data.repo_id,
    content_hash: data.content_hash,
  });
}

/**
 * Persist and then SELECT the row back to confirm the write landed.
 *
 * The verification is a single `SELECT content_hash FROM ... WHERE repo_id = ?`
 * after the INSERT. If the fetched hash doesn't match what was sent, or the
 * row is missing entirely, we return `verified: false` and the skill
 * records the failure without moving on to the next repo. A silent-write
 * failure here — e.g. schema drift that SQLite accepted as a NOP — is the
 * exact class of bug the bare persistPass3 cannot catch.
 */
async function embedText(text: string): Promise<number[] | null> {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'];
  if (!accountId || !apiToken) {
    logger.warn('[pass3/persist] Embedding skipped — missing CLOUDFLARE_ACCOUNT_ID/API_TOKEN');
    return null;
  }

  try {
    const embedRes = await globalThis.fetch(
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
      logger.warn('[pass3/persist] Embedding call failed', { status: embedRes.status, body: t.slice(0, 300) });
      return null;
    }
    const embedBody = (await embedRes.json()) as {
      result?: { data?: number[][]; shape?: number[] };
      success?: boolean;
    };
    const vector = embedBody.result?.data?.[0];
    if (!vector || !Array.isArray(vector)) {
      logger.warn('[pass3/persist] Embedding response missing vector');
      return null;
    }
    return vector;
  } catch (err) {
    logger.warn('[pass3/persist] Embedding call threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function persistRepoNodes(
  db: D1Client,
  data: Pass3Output,
  dryRun = false,
): Promise<Array<{ id: string; vector: number[] }>> {
  if (dryRun) {
    logger.info('[pass3/persist] DRY RUN — would upsert repo_nodes', {
      repo_id: data.repo_id,
      sub_element_count: data.subElements.length,
    });
    return [];
  }

  // Pre-generate embeddings so embedding_json is populated on insert
  const embeddingMap = new Map<string, number[]>();
  for (const el of data.subElements) {
    const text = `${el.node_type}: ${el.narrative_text}`;
    const vector = await embedText(text);
    if (vector) {
      const id = `${data.repo_id}_${el.node_type}_${el.slug}`;
      embeddingMap.set(id, vector);
    }
  }

  // Transactional delete + insert per repo
  await db.query(
    `DELETE FROM repo_nodes WHERE repo_id = ? AND signals_version = ?`,
    [data.repo_id, data.signals_version],
  );

  const now = nowSeconds();
  const statements = data.subElements.map((el) => {
    const id = `${data.repo_id}_${el.node_type}_${el.slug}`;
    const vector = embeddingMap.get(id);
    return {
      sql: `INSERT INTO repo_nodes (
        id, repo_id, signals_version, node_type, narrative_text,
        extracted_properties_json, embedding_json, source_reference,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.repo_id,
        data.signals_version,
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

  logger.debug('[pass3/persist] repo_nodes persisted', {
    repo_id: data.repo_id,
    count: data.subElements.length,
    with_embeddings: embeddingMap.size,
  });

  return Array.from(embeddingMap.entries()).map(([id, vector]) => ({ id, vector }));
}

async function upsertRepoNodesToVectorize(
  data: Pass3Output,
  embeddings: Array<{ id: string; vector: number[] }>,
): Promise<void> {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'];
  if (!accountId || !apiToken) {
    logger.warn('[pass3/persist] Vectorize skipped — missing CLOUDFLARE_ACCOUNT_ID/API_TOKEN');
    return;
  }

  const lines: string[] = [];
  for (const el of data.subElements) {
    const localId = `${data.repo_id}_${el.node_type}_${el.slug}`;
    const embedding = embeddings.find((e) => e.id === localId);
    if (!embedding) continue;

    const vectorizeId = `repo_node_${localId}`;
    lines.push(
      JSON.stringify({
        id: vectorizeId,
        values: embedding.vector,
        metadata: {
          entity_type: 'repo',
          entity_id: data.repo_id,
          node_type: el.node_type,
          signals_version: data.signals_version,
          admin_status: 'approved',
        },
      }),
    );
  }

  if (lines.length === 0) {
    logger.warn('[pass3/persist] No sub-element vectors to upsert', { repo_id: data.repo_id });
    return;
  }

  try {
    const upsertRes = await globalThis.fetch(
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
      logger.warn('[pass3/persist] Vectorize upsert failed for repo_nodes', {
        repo_id: data.repo_id,
        status: upsertRes.status,
        body: text.slice(0, 300),
      });
      return;
    }

    logger.debug('[pass3/persist] repo_nodes Vectorize upserted', {
      repo_id: data.repo_id,
      count: lines.length,
    });
  } catch (err) {
    logger.warn('[pass3/persist] repo_nodes Vectorize upsert threw', {
      repo_id: data.repo_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function persistAndVerify(
  db: D1Client,
  data: Pass3Output,
  dryRun = false,
): Promise<PersistResult> {
  await persistPass3(db, data, dryRun);
  const repoNodeEmbeddings = await persistRepoNodes(db, data, dryRun);

  if (dryRun) {
    return {
      persisted: false,
      verified: true,
      expectedHash: data.content_hash,
      actualHash: null,
    };
  }

  const rows = await db.query<{ content_hash: string }>(
    `SELECT content_hash FROM repo_engineering_signals WHERE repo_id = ?`,
    [data.repo_id],
  );

  if (rows.length === 0) {
    return {
      persisted: true,
      verified: false,
      expectedHash: data.content_hash,
      actualHash: null,
    };
  }

  const actualHash = rows[0]!.content_hash;
  const verified = actualHash === data.content_hash;

  // Embed + upsert into Vectorize only after D1 confirmed the write.
  // Keeps SQL authoritative — an orphan Vectorize row without a matching D1
  // signal would be worse than no vector at all.
  // Auto-approve verdict bypasses the human ingest gate; manual_review and
  // auto_reject skip Vectorize until a human or re-run changes the verdict.
  if (verified && data.confidence_verdict === 'auto_approve') {
    await upsertToVectorize(data);
    await upsertRepoNodesToVectorize(data, repoNodeEmbeddings);
  }

  // Neo4j dual-write (fire-and-forget, non-blocking)
  if (process.env['DUAL_WRITE_NEO4J'] === 'true' && verified) {
    const neo4jUri = process.env['NEO4J_URI'];
    const neo4jPassword = process.env['NEO4J_PASSWORD'];
    if (neo4jUri && neo4jPassword) {
      const subElementsWithEmbeddings = data.subElements.map((el) => {
        const localId = `${data.repo_id}_${el.node_type}_${el.slug}`;
        const embedding = repoNodeEmbeddings.find((e) => e.id === localId)?.vector ?? null;
        return { ...el, embedding };
      });
      writeRepoGraph({
        repoId: data.repo_id,
        signalsVersion: data.signals_version,
        subElements: subElementsWithEmbeddings,
        env: {
          NEO4J_URI: neo4jUri,
          NEO4J_USER: process.env['NEO4J_USER'],
          NEO4J_PASSWORD: neo4jPassword,
        },
      }).catch((err) => {
        logger.warn('[pass3/persist] Neo4j dual-write failed (non-blocking)', {
          repo_id: data.repo_id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  return {
    persisted: true,
    verified,
    expectedHash: data.content_hash,
    actualHash,
  };
}

// ─── CLI entry ───────────────────────────────────────────────────────────────
// Reads a Pass3Data JSON payload on stdin, calls persistAndVerify, writes
// the PersistResult on stdout. Exit code 0 on verified write, 2 on
// verification failure, 1 on unexpected error.

async function readStdin(): Promise<string> {
  let buf = '';
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const raw = await readStdin();
  const data = JSON.parse(raw) as Pass3Output;
  if (!data.subElements) data.subElements = [];

  const db = new D1Client(loadD1Config());
  const result = await persistAndVerify(db, data, dryRun);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!dryRun && !result.verified) process.exit(2);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error('[pass3/persist] failed:', err);
    process.exit(1);
  });
}
