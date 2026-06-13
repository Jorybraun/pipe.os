export interface OpenSemanticTerm {
  surface: string;
  canonicalKey: string;
}

export interface OpenSemanticTermRecord {
  surface: string;
  canonical_key: string;
  evidence_level?: string;
}

export function normalizeOpenTermSurface(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function openSemanticTerm(value: string): OpenSemanticTerm | null {
  const surface = value.trim();
  const normalized = normalizeOpenTermSurface(surface);
  if (!normalized) return null;
  return {
    surface,
    canonicalKey: `term:${normalized.replace(/\s+/g, '-')}`,
  };
}

export function openSemanticTermRecord(
  value: string,
  evidenceLevel?: string,
): OpenSemanticTermRecord | null {
  const term = openSemanticTerm(value);
  if (!term) return null;
  return {
    surface: term.surface,
    canonical_key: term.canonicalKey,
    ...(evidenceLevel ? { evidence_level: evidenceLevel } : {}),
  };
}

export function extractOpenIdentifierTerms(
  values: readonly string[],
  limit = 64,
): OpenSemanticTerm[] {
  const terms = new Map<string, OpenSemanticTerm>();
  for (const value of values) {
    const expanded = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    for (const token of expanded.match(/[A-Za-z][A-Za-z0-9+#.]*/g) ?? []) {
      if (token.length < 3) continue;
      const term = openSemanticTerm(token);
      if (term && !terms.has(term.canonicalKey)) terms.set(term.canonicalKey, term);
      if (terms.size >= limit) return [...terms.values()];
    }
  }
  return [...terms.values()];
}
