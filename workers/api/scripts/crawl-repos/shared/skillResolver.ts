import { normalizeOpenTermSurface } from '../../../src/lib/livingContext/openTerms.js';

/**
 * Convert an observed package or topic surface into a stable open identifier.
 *
 * This intentionally performs syntax normalization only. Semantic aliases
 * belong in persisted evidence, so previously unseen concepts survive instead
 * of being dropped or silently mapped to a code-owned taxonomy.
 */
export function resolveSkillSlug(raw: string): string | null {
  const normalized = normalizeOpenTermSurface(raw);
  return normalized ? normalized.replace(/\s+/g, '-') : null;
}

export function resolveSkills(raws: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const raw of raws) {
    const slug = resolveSkillSlug(raw);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      results.push(slug);
    }
  }
  return results;
}
