/**
 * Skill slug normalization — shared between repo discovery and candidate decomposition.
 *
 * Looks up raw skill strings against the skill_aliases table and returns canonical slugs.
 * Falls back to lowercased input if no alias is found.
 */

export async function slugifySkills(
  db: D1Database,
  skills: string[],
): Promise<string[]> {
  if (skills.length === 0) return [];

  // One query to fetch all aliases at once
  const placeholders = skills.map(() => '?').join(', ');
  const rows = await db
    .prepare(`SELECT alias, canonical_slug FROM skill_aliases WHERE alias IN (${placeholders})`)
    .bind(...skills)
    .all<{ alias: string; canonical_slug: string }>();

  const aliasMap = new Map<string, string>(
    (rows.results ?? []).map((r) => [r.alias.toLowerCase(), r.canonical_slug]),
  );

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    const lower = skill.toLowerCase().trim();
    const slug = aliasMap.get(lower) ?? lower;
    if (slug === lower && !aliasMap.has(lower)) {
      console.warn(`[slugifySkills] skill alias not found for "${skill}", falling back to lowercase slug "${lower}"`);
    }
    if (!seen.has(slug)) {
      seen.add(slug);
      normalized.push(slug);
    }
  }

  return normalized;
}
