import type { RoleContextDocument } from '../../types';
import {
  normalizeOpenTermSurface,
  openSemanticTerm,
} from '../livingContext/openTerms';

interface RoleContextSemanticRow {
  id: string;
  rcd_version: string | null;
  rcd_json: string | null;
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
  resolverVersion: 'open-source-term-v1';
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
  narrative: string,
): Array<{ surface: string; canonicalKey: string }> {
  const terms = new Map<string, { surface: string; canonicalKey: string }>();
  const add = (surface: string): void => {
    const term = openSemanticTerm(surface);
    if (term) terms.set(term.canonicalKey, term);
  };
  if (!value) {
    add(narrative);
    return [...terms.values()];
  }
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
    if (terms.size === 0) add(narrative);
    return [...terms.values()];
  } catch {
    add(narrative);
    return [...terms.values()];
  }
}

function fallbackRcdTerms(
  rcdJson: string | null,
): Array<{ surface: string; canonicalKey: string; sourceSection: string }> {
  if (!rcdJson) return [];
  try {
    const rcd = JSON.parse(rcdJson) as RoleContextDocument;
    const sections = [
      {
        sourceSection: 'technical_context.stack',
        surfaces: rcd.technical_context.stack ?? [],
      },
      {
        sourceSection: 'technical_context.constructs',
        surfaces: rcd.technical_context.constructs ?? [],
      },
      {
        sourceSection: 'technical_context.codebase_expectations',
        surfaces: rcd.technical_context.codebase_expectations ?? [],
      },
      {
        sourceSection: 'consumer_slice.mustHaveSkills',
        surfaces: rcd.consumer_slice?.mustHaveSkills ?? [],
      },
      {
        sourceSection: 'consumer_slice.niceToHaveSkills',
        surfaces: rcd.consumer_slice?.niceToHaveSkills ?? [],
      },
    ];
    return sections.flatMap(({ sourceSection, surfaces }) =>
      surfaces.flatMap((surface) => {
        const term = openSemanticTerm(surface);
        return term
          ? [{ surface: term.surface, canonicalKey: term.canonicalKey, sourceSection }]
          : [];
      }),
    );
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
  for (const row of result.results ?? []) {
    const nodeTerms = termsFromProperties(row.extracted_properties_json, row.narrative_text);
    if (nodeTerms.length === 0) continue;
    nodeTerms.forEach((term) => terms.set(term.canonicalKey, term.surface));
    sources.push({
      roleNodeId: row.id,
      sourceSection: row.source_section,
      rcdVersion: row.rcd_version,
      conceptKeys: nodeTerms.map((term) => term.canonicalKey).sort(),
    });
  }

  for (const term of fallbackRcdTerms(roleContext.rcd_json)) {
    terms.set(term.canonicalKey, term.surface);
    sources.push({
      roleNodeId: `role-context:${roleContext.id}`,
      sourceSection: term.sourceSection,
      rcdVersion: roleContext.rcd_version ?? 'unversioned',
      conceptKeys: [term.canonicalKey],
    });
  }

  const selectedSurfaces = new Set(
    parseStringArray(roleContext.non_negotiable_skills_json).map(normalizeOpenTermSurface),
  );
  const requiredConcepts = [...terms.entries()]
    .filter(([, surface]) => selectedSurfaces.has(normalizeOpenTermSurface(surface)))
    .map(([canonicalKey]) => canonicalKey)
    .sort();
  const rcdVersion = sources[0]?.rcdVersion ?? roleContext.rcd_version ?? 'unversioned';

  return {
    roleSnapshotId: `role-context:${roleContext.id}:rcd:${rcdVersion}`,
    resolverVersion: 'open-source-term-v1',
    relevantConcepts: [...terms.keys()].sort(),
    requiredConcepts,
    sources,
  };
}
