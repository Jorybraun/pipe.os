/**
 * Runtime repo matcher — queries the pre-populated qualified_repos catalog.
 *
 * Replaces the real-time Libraries.io discovery pipeline with a structured
 * tag-graph query against D1. <200ms p95 at ~10k qualified rows.
 *
 * The match query:
 *   1. Hard-filters on language, seniority ±1, freshness, disqualified=0
 *   2. Requires ALL must-have skills (HAVING must_hits = must_total)
 *   3. Scores by stack fit (60%), domain (10%), constructs (10%),
 *      PR quality (15%), contamination penalty (5%)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MatchRequest {
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  seniority?: 'junior' | 'mid' | 'senior' | 'staff';
  domain?: string;
  primaryLanguage?: string;
  targetConstructs?: string[];
  limit?: number;
}

export interface MatchedRepo {
  id: number;
  fullName: string;
  githubUrl: string;
  description: string | null;
  seniorityBand: string;
  detectedDomain: string;
  prQualityScore: number;
  stars: number;
  primaryLanguage: string;
  score: number;
  matchedMustSkills: string[];
  matchedNiceSkills: string[];
  matchedConstructs: string[];
  samplePrs: SamplePR[];
}

export interface SamplePR {
  prNumber: number;
  prUrl: string;
  title: string;
  sweBenchEligible: boolean;
  changedFileCount: number;
}

import { slugifySkills } from '../skills/slugifySkills';

/** Returns adjacent seniority bands (±1). */
function adjacentBands(band: string): string[] {
  const ORDER = ['junior', 'mid', 'senior', 'staff'];
  const idx = ORDER.indexOf(band);
  if (idx === -1) return [band];
  return [
    idx > 0 ? ORDER[idx - 1] : null,
    ORDER[idx],
    idx < ORDER.length - 1 ? ORDER[idx + 1] : null,
  ].filter((b): b is string => b !== null);
}

// ─── Main matcher ─────────────────────────────────────────────────────────────

export async function matchRepos(
  db: D1Database,
  req: MatchRequest,
): Promise<MatchedRepo[]> {
  const limit = req.limit ?? 10;

  // 1. Slugify skills via alias table
  const mustSlugs = await slugifySkills(db, req.mustHaveSkills);
  const niceSlugs = await slugifySkills(db, req.niceToHaveSkills);
  const constructSlugs = req.targetConstructs ?? [];

  const mustTotal = mustSlugs.length;
  const niceTotal = niceSlugs.length;
  const constructTotal = constructSlugs.length;

  // Edge case: no must-haves → return empty (no fallback)
  if (mustTotal === 0) {
    return [];
  }

  // 2. Apply seniority only when persisted role evidence establishes it.
  const bands = req.seniority ? adjacentBands(req.seniority.toLowerCase()) : [];

  // 3. Build the scoring query dynamically (D1 doesn't support array params in IN)
  const mustPlaceholders = mustSlugs.map(() => '?').join(', ');
  const nicePlaceholders = niceSlugs.length > 0 ? niceSlugs.map(() => '?').join(', ') : "'__none__'";
  const constructPlaceholders = constructSlugs.length > 0 ? constructSlugs.map(() => '?').join(', ') : "'__none__'";
  const bandPlaceholders = bands.map(() => '?').join(', ');
  const seniorityClause = bands.length > 0
    ? `AND r.seniority_band IN (${bandPlaceholders})`
    : '';

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const staleCutoff = sixMonthsAgo.toISOString();

  const lang = req.primaryLanguage?.trim().toLowerCase() || null;
  const languageClause = lang ? 'AND r.primary_language = ?' : '';

  const sql = `
    WITH scored AS (
      SELECT
        r.id,
        r.full_name,
        r.github_url,
        r.description,
        r.seniority_band,
        r.detected_domain,
        r.pr_quality_score,
        r.contamination_risk,
        r.stars,
        r.primary_language,
        COUNT(DISTINCT CASE WHEN rs.skill_slug IN (${mustPlaceholders}) THEN rs.skill_slug END) AS must_hits,
        COUNT(DISTINCT CASE WHEN rs.skill_slug IN (${nicePlaceholders}) THEN rs.skill_slug END) AS nice_hits,
        COUNT(DISTINCT CASE WHEN rc.construct_slug IN (${constructPlaceholders}) THEN rc.construct_slug END) AS construct_hits
      FROM qualified_repos r
      LEFT JOIN repo_skills rs ON rs.repo_id = r.id
      LEFT JOIN repo_constructs rc ON rc.repo_id = r.id
      LEFT JOIN repo_engineering_signals es ON es.repo_id = r.id
      WHERE r.disqualified = 0
        ${languageClause}
        ${seniorityClause}
        AND r.last_pushed_at >= ?
        -- Canonical RUC: library repos never make it into the candidate pool.
        AND (es.architecture_style IS NULL OR es.architecture_style != 'library')
        -- Challenge-ready gate: skip repos that can't host a meaningful challenge.
        AND NOT (COALESCE(r.open_pr_count, 0) = 0 AND COALESCE(r.open_feature_issue_count, 0) < 5)
      GROUP BY r.id
      HAVING must_hits = ?
    )
    SELECT
      *,
      (must_hits * 1.0 / ?) * 0.45
      + (nice_hits * 1.0 / MAX(?, 1)) * 0.15
      + (CASE WHEN detected_domain = ? THEN 1.0 ELSE 0.0 END) * 0.10
      + (construct_hits * 1.0 / MAX(?, 1)) * 0.10
      + pr_quality_score * 0.15
      + (1.0 - contamination_risk) * 0.05 AS score
    FROM scored
    ORDER BY score DESC
    LIMIT ?
  `;

  const params: (string | number)[] = [
    // must IN
    ...mustSlugs,
    // nice IN
    ...niceSlugs,
    // construct IN
    ...constructSlugs,
    // WHERE primary_language, when evidence establishes one
    ...(lang ? [lang] : []),
    // WHERE seniority_band IN
    ...bands,
    // WHERE last_pushed_at >=
    staleCutoff,
    // HAVING must_hits =
    mustTotal,
    // score: must_total denominator
    mustTotal,
    // score: nice_total denominator
    Math.max(niceTotal, 1),
    // score: domain match
    req.domain ?? '',
    // score: construct_total denominator
    Math.max(constructTotal, 1),
    // LIMIT
    limit,
  ];

  type ScoredRow = {
    id: number;
    full_name: string;
    github_url: string;
    description: string | null;
    seniority_band: string;
    detected_domain: string;
    pr_quality_score: number;
    contamination_risk: number;
    stars: number;
    primary_language: string;
    must_hits: number;
    nice_hits: number;
    construct_hits: number;
    score: number;
  };

  const { results: scoredRows } = await db
    .prepare(sql)
    .bind(...params)
    .all<ScoredRow>();

  if (!scoredRows || scoredRows.length === 0) {
    // No repos matched must-haves — return empty instead of falling back
    return [];
  }

  // 4. Second query: fetch matched skill + construct slugs per repo
  const repoIds = scoredRows.map((r) => r.id);
  const idPlaceholders = repoIds.map(() => '?').join(', ');

  const [skillRows, constructRows, prRows] = await Promise.all([
    db.prepare(`
      SELECT repo_id, skill_slug, source
      FROM repo_skills
      WHERE repo_id IN (${idPlaceholders})
        AND skill_slug IN (${[...mustSlugs, ...niceSlugs].map(() => '?').join(', ') || "'__none__'"})
    `).bind(...repoIds, ...mustSlugs, ...niceSlugs).all<{ repo_id: number; skill_slug: string; source: string }>(),

    constructSlugs.length > 0
      ? db.prepare(`
          SELECT repo_id, construct_slug
          FROM repo_constructs
          WHERE repo_id IN (${idPlaceholders})
            AND construct_slug IN (${constructSlugs.map(() => '?').join(', ')})
        `).bind(...repoIds, ...constructSlugs).all<{ repo_id: number; construct_slug: string }>()
      : Promise.resolve({ results: [] as Array<{ repo_id: number; construct_slug: string }> }),

    db.prepare(`
      SELECT repo_id, pr_number, pr_url, title, swe_bench_eligible, changed_file_count
      FROM repo_sample_prs
      WHERE repo_id IN (${idPlaceholders})
        AND swe_bench_eligible = 1
      ORDER BY repo_id, pr_number
      LIMIT ?
    `).bind(...repoIds, limit * 5).all<{
      repo_id: number;
      pr_number: number;
      pr_url: string;
      title: string;
      swe_bench_eligible: number;
      changed_file_count: number;
    }>(),
  ]);

  // Group by repo_id
  const skillsByRepo = groupBy(skillRows.results ?? [], 'repo_id');
  const constructsByRepo = groupBy(constructRows.results ?? [], 'repo_id');
  const prsByRepo = groupBy(prRows.results ?? [], 'repo_id');

  const mustSet = new Set(mustSlugs);
  const niceSet = new Set(niceSlugs);

  return scoredRows.map((row) => {
    const repoSkills = skillsByRepo.get(row.id) ?? [];
    const repoConstructs = constructsByRepo.get(row.id) ?? [];
    const repoPrs = prsByRepo.get(row.id) ?? [];

    return {
      id: row.id,
      fullName: row.full_name,
      githubUrl: row.github_url,
      description: row.description,
      seniorityBand: row.seniority_band,
      detectedDomain: row.detected_domain,
      prQualityScore: row.pr_quality_score,
      stars: row.stars,
      primaryLanguage: row.primary_language,
      score: row.score,
      matchedMustSkills: repoSkills
        .filter((s) => mustSet.has(s.skill_slug))
        .map((s) => s.skill_slug),
      matchedNiceSkills: repoSkills
        .filter((s) => niceSet.has(s.skill_slug))
        .map((s) => s.skill_slug),
      matchedConstructs: repoConstructs.map((c) => c.construct_slug),
      samplePrs: repoPrs.map((p) => ({
        prNumber: p.pr_number,
        prUrl: p.pr_url,
        title: p.title,
        sweBenchEligible: p.swe_bench_eligible === 1,
        changedFileCount: p.changed_file_count,
      })),
    };
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function groupBy<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const k = row[key] as number;
    const existing = map.get(k);
    if (existing) {
      existing.push(row);
    } else {
      map.set(k, [row]);
    }
  }
  return map;
}
