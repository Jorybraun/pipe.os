import {
  normalizeOpenTermSurface,
  OPEN_TERM_RESOLVER_VERSION,
  openSemanticTerm,
} from '../livingContext/openTerms';

interface RoleContextSemanticRow {
  id: string;
  rcd_version: string | null;
  rcd_json: string | null;
  job_description_md?: string | null;
  non_negotiable_skills_json: string | null;
}

interface RoleNodeSemanticRow {
  id: string;
  rcd_version: string;
  source_section: string | null;
  narrative_text: string;
  extracted_properties_json: string | null;
}

interface PersistedSemanticTerm {
  surface?: unknown;
  canonical_key?: unknown;
}

export interface RoleChallengeSemantics {
  roleSnapshotId: string;
  resolverVersion: typeof OPEN_TERM_RESOLVER_VERSION;
  relevantConcepts: string[];
  requiredConcepts: string[];
  sources: Array<{
    roleNodeId: string;
    sourceSection: string | null;
    rcdVersion: string;
    conceptKeys: string[];
  }>;
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function termsFromProperties(
  value: string | null,
): Array<{ surface: string; canonicalKey: string }> {
  const terms = new Map<string, { surface: string; canonicalKey: string }>();
  const add = (surface: string): void => {
    const term = openSemanticTerm(surface);
    if (term) terms.set(term.canonicalKey, term);
  };
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as {
      value?: unknown;
      semantic_terms?: PersistedSemanticTerm[];
    };
    const explicit = Array.isArray(parsed.semantic_terms)
      ? parsed.semantic_terms.flatMap((term) =>
      typeof term.surface === 'string' && typeof term.canonical_key === 'string'
        ? [{ surface: term.surface, canonicalKey: term.canonical_key }]
        : []
      )
      : [];
    explicit.forEach((term) => terms.set(term.canonicalKey, term));
    if (typeof parsed.value === 'string') {
      add(parsed.value);
    }
    return [...terms.values()];
  } catch {
    return [];
  }
}

export async function loadRoleChallengeSemantics(
  db: D1Database,
  roleContext: RoleContextSemanticRow,
): Promise<RoleChallengeSemantics> {
  const result = await db.prepare(
    `SELECT id, rcd_version, source_section, narrative_text, extracted_properties_json
       FROM role_nodes
      WHERE role_context_id = ?1 AND superseded_at IS NULL
      ORDER BY source_section, id`,
  ).bind(roleContext.id).all<RoleNodeSemanticRow>();

  const sources: RoleChallengeSemantics['sources'] = [];
  const terms = new Map<string, string>();
  const selectedSurfaces = new Set(
    parseStringArray(roleContext.non_negotiable_skills_json).map(normalizeOpenTermSurface),
  );
  for (const row of result.results ?? []) {
    const nodeTerms = termsFromProperties(row.extracted_properties_json);
    if (nodeTerms.length === 0) continue;
    nodeTerms.forEach((term) => terms.set(term.canonicalKey, term.surface));
    sources.push({
      roleNodeId: row.id,
      sourceSection: row.source_section,
      rcdVersion: row.rcd_version,
      conceptKeys: nodeTerms.map((term) => term.canonicalKey).sort(),
    });
  }

  const normalizedJobDescription = normalizeOpenTermSurface(roleContext.job_description_md ?? '');
  const jdConceptKeys: string[] = [];
  for (const surface of parseStringArray(roleContext.non_negotiable_skills_json)) {
    const normalizedSurface = normalizeOpenTermSurface(surface);
    if (!normalizedSurface || !normalizedJobDescription.includes(normalizedSurface)) continue;
    const term = openSemanticTerm(surface);
    if (!term) continue;
    terms.set(term.canonicalKey, term.surface);
    jdConceptKeys.push(term.canonicalKey);
  }
  if (jdConceptKeys.length > 0) {
    sources.push({
      roleNodeId: `role-context:${roleContext.id}:job-description`,
      sourceSection: 'job_description_md',
      rcdVersion: roleContext.rcd_version ?? 'simple-jd',
      conceptKeys: [...new Set(jdConceptKeys)].sort(),
    });
  }

  const requiredConcepts = [...terms.entries()]
    .filter(([, surface]) => selectedSurfaces.has(normalizeOpenTermSurface(surface)))
    .map(([canonicalKey]) => canonicalKey)
    .sort();
  const rcdVersion = sources[0]?.rcdVersion ?? roleContext.rcd_version ?? 'unversioned';

  return {
    roleSnapshotId: `role-context:${roleContext.id}:source-backed:${rcdVersion}`,
    resolverVersion: OPEN_TERM_RESOLVER_VERSION,
    relevantConcepts: [...terms.keys()].sort(),
    requiredConcepts,
    sources,
  };
}
