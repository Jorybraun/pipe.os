import {
  normalizeOpenTermSurface,
  OPEN_TERM_RESOLVER_VERSION,
  openSemanticTerm,
} from '../livingContext/openTerms';
import type { RoleSourceReference } from './types';

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

interface RoleContextConceptRow {
  context_record_id: string;
  record_type: string;
  extraction_version: string | null;
  canonical_key: string | null;
  label: string | null;
  source_ref_type: string | null;
  source_ref_id: string | null;
  source_span_id: string | null;
  exact_text: string | null;
  content_hash: string | null;
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
  sources: Array<RoleSourceReference & {
    roleNodeId: string;
    sourceSection: string | null;
    rcdVersion: string;
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
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as {
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

  const contextResult = await db.prepare(
    `SELECT cr.id AS context_record_id,
            cr.record_type,
            cr.extraction_version,
            c.canonical_key,
            c.label,
            crsr.source_ref_type,
            crsr.source_ref_id,
            crsr.source_span_id,
            crsr.exact_text,
            crsr.content_hash
       FROM context_records cr
       JOIN context_record_concepts crc ON crc.context_record_id = cr.id
       JOIN concepts c ON c.id = crc.concept_id
       LEFT JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
      WHERE cr.scope_type = 'role_context'
        AND cr.scope_id = ?1
      ORDER BY cr.id, c.canonical_key, crsr.source_ref_type, crsr.source_ref_id`,
  ).bind(roleContext.id).all<RoleContextConceptRow>();

  const contextConceptKeys = new Set<string>();
  const contextSources = new Map<string, {
    sourceSection: string;
    rcdVersion: string;
    sourceRefType: string | undefined;
    sourceRefId: string | undefined;
    sourceSpanId: string | undefined;
    exactText: string | undefined;
    contentHash: string | undefined;
    conceptKeys: Set<string>;
  }>();
  for (const row of contextResult.results ?? []) {
    if (!row.canonical_key) continue;
    terms.set(row.canonical_key, row.label ?? row.canonical_key);
    contextConceptKeys.add(row.canonical_key);
    const sourceKey = [
      row.context_record_id,
      row.source_ref_type ?? '',
      row.source_ref_id ?? '',
    ].join('\u0000');
    const source = contextSources.get(sourceKey) ?? {
      sourceSection: row.source_ref_type && row.source_ref_id
        ? `${row.record_type}:${row.source_ref_type}:${row.source_ref_id}`
        : row.record_type,
      rcdVersion: row.extraction_version ?? roleContext.rcd_version ?? 'context-record',
      sourceRefType: row.source_ref_type ?? undefined,
      sourceRefId: row.source_ref_id ?? undefined,
      sourceSpanId: row.source_span_id ?? undefined,
      exactText: row.exact_text ?? undefined,
      contentHash: row.content_hash ?? undefined,
      conceptKeys: new Set<string>(),
    };
    source.conceptKeys.add(row.canonical_key);
    contextSources.set(sourceKey, source);
  }
  for (const [sourceKey, source] of [...contextSources.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const [roleNodeId] = sourceKey.split('\u0000');
    sources.push({
      roleNodeId: roleNodeId || 'role-context-record',
      entityId: roleNodeId || 'role-context-record',
      sourceSection: source.sourceSection,
      locator: source.sourceSection,
      rcdVersion: source.rcdVersion,
      sourceRefType: source.sourceRefType,
      sourceRefId: source.sourceRefId,
      sourceSpanId: source.sourceSpanId,
      exactText: source.exactText,
      contentHash: source.contentHash,
      conceptKeys: [...source.conceptKeys].sort(),
    });
  }

  for (const row of result.results ?? []) {
    const nodeTerms = termsFromProperties(row.extracted_properties_json);
    if (nodeTerms.length === 0) continue;
    nodeTerms.forEach((term) => terms.set(term.canonicalKey, term.surface));
    sources.push({
      roleNodeId: row.id,
      entityId: row.id,
      sourceSection: row.source_section,
      locator: row.source_section ?? 'role_node',
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
    if (!contextConceptKeys.has(term.canonicalKey)) {
      jdConceptKeys.push(term.canonicalKey);
    }
  }
  if (jdConceptKeys.length > 0) {
    sources.push({
      roleNodeId: `role-context:${roleContext.id}:job-description`,
      entityId: `role-context:${roleContext.id}:job-description`,
      sourceSection: 'job_description_md',
      locator: 'job_description_md',
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
