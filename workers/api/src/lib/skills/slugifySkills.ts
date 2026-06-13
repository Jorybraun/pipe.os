/**
 * Skill slug normalization — shared between repo discovery and candidate decomposition.
 *
 * Looks up evidence-backed aliases and otherwise preserves every observed term
 * through syntax-only open normalization.
 */

import { normalizeOpenTermSurface } from '../livingContext/openTerms';

export async function slugifySkills(
  db: D1Database,
  skills: string[],
): Promise<string[]> {
  if (skills.length === 0) return [];

  const observed = skills.flatMap((skill) => {
    const normalized = normalizeOpenTermSurface(skill);
    return normalized
      ? [{ lookupKey: normalized, openSlug: normalized.replace(/\s+/g, '-') }]
      : [];
  });
  if (observed.length === 0) return [];

  const lookupKeys = [...new Set(observed.map((term) => term.lookupKey))];
  const placeholders = lookupKeys.map(() => '?').join(', ');
  const rows = await db
    .prepare(`SELECT alias, canonical_slug FROM skill_aliases WHERE alias IN (${placeholders})`)
    .bind(...lookupKeys)
    .all<{ alias: string; canonical_slug: string }>();

  const aliasMap = new Map<string, string>(
    (rows.results ?? []).map((r) => [normalizeOpenTermSurface(r.alias), r.canonical_slug]),
  );

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const term of observed) {
    const slug = aliasMap.get(term.lookupKey) ?? term.openSlug;
    if (!seen.has(slug)) {
      seen.add(slug);
      normalized.push(slug);
    }
  }

  return normalized;
}
