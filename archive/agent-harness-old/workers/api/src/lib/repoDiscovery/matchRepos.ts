/**
 * matchRepos.ts
 *
 * SQL-backed repo matching with skill-adjacency expansion and
 * MUST / NICE-TO-HAVE tiering.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { MatchedRepo, MatchOptions } from './types';

interface MatchReposArgs {
  client: SupabaseClient;
  roleContextId: string;
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  seniority: string;
  embedding: number[];
  matchOpts: MatchOptions;
}

export async function matchRepos(args: MatchReposArgs): Promise<MatchedRepo[]> {
  const {
    client,
    roleContextId,
    mustHaveSkills,
    niceToHaveSkills,
    seniority,
    embedding,
    matchOpts,
  } = args;

  // ── 1. Alias expansion ─────────────────────────────────────────────────
  const aliasMap = await loadSkillAliases(client, [
    ...mustHaveSkills,
    ...niceToHaveSkills,
  ]);

  const expandedMust = dedupeSkills(
    mustHaveSkills.flatMap(s => aliasMap.get(s) ?? [s])
  );
  const expandedNice = dedupeSkills(
    niceToHaveSkills.flatMap(s => aliasMap.get(s) ?? [s])
  );

  // ── 2. Adjacency expansion ─────────────────────────────────────────────
  let adjacencyBoost: Map<string, number> = new Map();
  if (matchOpts.skillAdjacencyEnabled) {
    adjacencyBoost = await loadSkillAdjacency(client, expandedMust);
  }

  // ── 3. Build vector query ──────────────────────────────────────────────
  const { data: vectorHits, error: vecErr } = await client.rpc('match_repos', {
    query_embedding: JSON.stringify(embedding),
    match_threshold: matchOpts.coverageThreshold ?? 0.72,
    match_count: 100,
  });

  if (vecErr) {
    console.error('[matchRepos] Vector match failed', {
      roleContextId,
      error: vecErr.message,
    });
    throw vecErr;
  }

  const candidateRepoIds: string[] = (vectorHits ?? []).map((h: any) => h.repo_id);

  if (candidateRepoIds.length === 0) {
    return [];
  }

  // ── 4. Skill-tier SQL filter (validate philosophy) ─────────────────────
  //    Count how many MUST skills each repo covers; require all.
  const mustTotal = expandedMust.length;

  let sql = '';
  if (mustTotal > 0) {
    sql = `
      SELECT
        rs.repo_id,
        COUNT(DISTINCT rs.skill_id) FILTER (WHERE LOWER(rs.skill_id) = ANY($2)) AS must_hits,
        ${mustTotal}::int AS must_total,
        COUNT(DISTINCT rs.skill_id) FILTER (WHERE LOWER(rs.skill_id) = ANY($3)) AS nice_hits,
        MAX(rs.score) AS max_vector_score
      FROM repo_skills rs
      WHERE rs.repo_id = ANY($1)
      GROUP BY rs.repo_id
      HAVING COUNT(DISTINCT rs.skill_id) FILTER (WHERE LOWER(rs.skill_id) = ANY($2)) = ${mustTotal}
    `;
  } else {
    // No MUST skills — use nice-to-have coverage only
    sql = `
      SELECT
        rs.repo_id,
        0::int AS must_hits,
        0::int AS must_total,
        COUNT(DISTINCT rs.skill_id) FILTER (WHERE LOWER(rs.skill_id) = ANY($3)) AS nice_hits,
        MAX(rs.score) AS max_vector_score
      FROM repo_skills rs
      WHERE rs.repo_id = ANY($1)
      GROUP BY rs.repo_id
    `;
  }

  const { data: skillHits, error: skillErr } = await client.rpc('run_raw_sql', {
    sql_text: sql,
    params: [
      candidateRepoIds,
      expandedMust,
      expandedNice,
    ],
  });

  if (skillErr) {
    console.error('[matchRepos] Skill-tier query failed', {
      roleContextId,
      error: skillErr.message,
    });
    throw skillErr;
  }

  // ── 5. Score & confidence ──────────────────────────────────────────────
  const scored = (skillHits ?? []).map((row: any) => {
    const baseScore = row.max_vector_score ?? 0;
    const adjacencyBonus = Array.from(adjacencyBoost.values()).reduce(
      (sum, w) => sum + w,
      0
    );

    const score = Math.min(1, baseScore + adjacencyBonus * 0.02);
    const confidence = computeConfidence({
      score,
      mustHits: row.must_hits,
      mustTotal: row.must_total,
      niceHits: row.nice_hits,
      niceTotal: expandedNice.length,
      seniority,
    });

    return {
      repoId: row.repo_id,
      score,
      confidence,
    };
  });

  // ── 6. Sort & return ───────────────────────────────────────────────────
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function dedupeSkills(skills: string[]): string[] {
  return [...new Set(skills.map(s => s.toLowerCase()).filter(Boolean))];
}

async function loadSkillAliases(
  client: SupabaseClient,
  skills: string[]
): Promise<Map<string, string[]>> {
  if (skills.length === 0) return new Map();

  const { data, error } = await client
    .from('skill_aliases')
    .select('canonical, alias')
    .in('alias', skills.map(s => s.toLowerCase()));

  if (error) {
    console.warn('[matchRepos] skill_aliases lookup failed', {
      error: error.message,
    });
    return new Map();
  }

  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const canonical = row.canonical.toLowerCase();
    const alias = row.alias.toLowerCase();
    const list = map.get(alias) ?? [];
    if (!list.includes(canonical)) list.push(canonical);
    map.set(alias, list);
  }

  return map;
}

async function loadSkillAdjacency(
  client: SupabaseClient,
  mustSkills: string[]
): Promise<Map<string, number>> {
  if (mustSkills.length === 0) return new Map();

  const { data, error } = await client
    .from('skill_adjacency')
    .select('source_skill_id, target_skill_id, weight')
    .in('source_skill_id', mustSkills);

  if (error) {
    console.warn('[matchRepos] skill_adjacency lookup failed', {
      error: error.message,
    });
    return new Map();
  }

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.target_skill_id.toLowerCase(), row.weight);
  }
  return map;
}

interface ConfidenceArgs {
  score: number;
  mustHits: number;
  mustTotal: number;
  niceHits: number;
  niceTotal: number;
  seniority: string;
}

function computeConfidence(args: ConfidenceArgs): number {
  const { score, mustHits, mustTotal, niceHits, niceTotal, seniority } = args;

  let seniorityMultiplier = 1.0;
  if (seniority === 'senior') seniorityMultiplier = 1.1;
  if (seniority === 'junior') seniorityMultiplier = 0.9;

  const mustRatio = mustTotal > 0 ? mustHits / mustTotal : 1;
  const niceRatio = niceTotal > 0 ? niceHits / niceTotal : 0;

  const confidence = (score * 0.5 + mustRatio * 0.35 + niceRatio * 0.15) * seniorityMultiplier;

  return Math.min(1, Math.max(0, confidence));
}
