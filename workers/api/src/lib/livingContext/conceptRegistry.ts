import { deterministicEntityId } from './persistence';
import {
  normalizeOpenTermSurface,
  openSemanticTerm,
} from './openTerms';

interface ProvenanceInput {
  sourceSpanId?: string;
  artifactVersionId?: string;
  evidenceEntityType?: string;
  evidenceEntityId?: string;
  evidenceLocator?: string;
}

export interface ConceptFace extends ProvenanceInput {
  id: string;
  conceptId: string;
  surface: string;
  normalizedSurface: string;
  confidence?: number;
  observedAt: number;
  createdAt: number;
}

export interface Concept {
  id: string;
  canonicalKey: string;
  namespace: string;
  label: string;
  description?: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  resolverVersion?: string;
  modelVersion?: string;
  confidence?: number;
  firstObservedAt?: number;
  lastObservedAt?: number;
  observationCount: number;
  supersededAt?: number;
  supersededById?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptResolution extends ProvenanceInput {
  id: string;
  conceptId: string;
  resolverVersion: string;
  modelVersion?: string;
  resolvedCanonicalKey: string;
  resolutionConfidence?: number;
  resolutionMetadata: Record<string, unknown>;
  resolvedAt: number;
  createdAt: number;
}

export interface ConceptAdjacency extends ProvenanceInput {
  id: string;
  fromConceptId: string;
  toConceptId: string;
  dimension: string;
  stretchAllowed: boolean;
  confidence?: number;
  observedAt: number;
  createdAt: number;
}

export interface RegisterConceptInput extends ProvenanceInput {
  canonicalKey: string;
  namespace: string;
  label: string;
  description?: string;
  surface: string;
  confidence?: number;
  resolverVersion?: string;
  modelVersion?: string;
  metadata?: Record<string, unknown>;
  observedAt?: number;
}

export interface ResolveConceptInput extends ProvenanceInput {
  surface: string;
  resolverVersion: string;
  modelVersion?: string;
  observedAt?: number;
}

export interface ConceptRegistry {
  registerConcept(input: RegisterConceptInput): Promise<{
    conceptId: string;
    isNewConcept: boolean;
  }>;
  resolveConcept(input: ResolveConceptInput): Promise<{
    canonicalKey: string;
    conceptId: string;
    confidence: number | null;
    resolutionId: string;
  }>;
  getConcept(canonicalKey: string): Promise<Concept | null>;
  getConceptFaces(conceptId: string): Promise<ConceptFace[]>;
  getConceptResolutions(conceptId: string): Promise<ConceptResolution[]>;
  addAdjacency(adjacency: Omit<ConceptAdjacency, 'id' | 'createdAt'>): Promise<string>;
  getAdjacencies(conceptId: string): Promise<ConceptAdjacency[]>;
  backfillOpenTerms(): Promise<{
    processed: number;
    created: number;
    updated: number;
  }>;
}

function stableKey(parts: Array<string | number | boolean | null | undefined>): string {
  return JSON.stringify(parts.map((part) => part ?? null));
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function assertProvenance(input: ProvenanceInput): void {
  if (input.sourceSpanId) return;
  if (input.evidenceEntityType && input.evidenceEntityId && input.evidenceLocator) return;
  throw new Error(
    'Concept observations require sourceSpanId or evidenceEntityType/evidenceEntityId/evidenceLocator',
  );
}

function provenanceParts(input: ProvenanceInput): Array<string | null | undefined> {
  return [
    input.sourceSpanId,
    input.artifactVersionId,
    input.evidenceEntityType,
    input.evidenceEntityId,
    input.evidenceLocator,
  ];
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parseStringArrayValue(parsed);
  } catch {
    return [];
  }
}

function parseStringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function conceptNamespace(canonicalKey: string): string {
  const separator = canonicalKey.indexOf(':');
  return separator > 0 ? canonicalKey.slice(0, separator) : 'open';
}

function conceptSurface(canonicalKey: string): string {
  const separator = canonicalKey.indexOf(':');
  const tail = separator >= 0 ? canonicalKey.slice(separator + 1) : canonicalKey;
  return tail.replace(/[-_]+/g, ' ').trim() || canonicalKey;
}

function repoSpanLocator(row: {
  path: string | null;
  line_start: number | null;
  line_end: number | null;
  byte_start: number | null;
  byte_end: number | null;
  source_span_id: string;
}): string {
  const path = row.path ?? 'repo-source-span';
  const lineRange = row.line_start != null && row.line_end != null
    ? `:${row.line_start}-${row.line_end}`
    : '';
  const byteRange = row.byte_start != null && row.byte_end != null
    ? `#bytes=${row.byte_start}-${row.byte_end}`
    : '';
  return `${path}${lineRange}${byteRange}@${row.source_span_id}`;
}

class D1ConceptRegistry implements ConceptRegistry {
  constructor(private readonly db: D1Database) {}

  private async tableExists(tableName: string): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
    ).bind(tableName).first<{ name: string }>();
    return Boolean(row);
  }

  async registerConcept(input: RegisterConceptInput): Promise<{
    conceptId: string;
    isNewConcept: boolean;
  }> {
    assertProvenance(input);
    const normalizedSurface = normalizeOpenTermSurface(input.surface);
    if (!normalizedSurface) throw new Error('Concept surface must not be empty');

    const existing = await this.db.prepare(
      `SELECT id
         FROM concepts
        WHERE canonical_key = ?1 AND superseded_at IS NULL`,
    ).bind(input.canonicalKey).first<{ id: string }>();
    const conceptIngestionKey = stableKey(['concept', input.canonicalKey]);
    const proposedConceptId = await deterministicEntityId('concept', conceptIngestionKey);
    const timestamp = input.observedAt ?? nowSeconds();
    const timestampText = new Date(timestamp * 1000).toISOString();

    if (!existing) {
      await this.db.prepare(
        `INSERT INTO concepts (
           id, ingestion_key, canonical_key, namespace, label, description,
           aliases_json, metadata_json, resolver_version, model_version,
           confidence, observation_count, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '[]', ?7, ?8, ?9, ?10, 0, ?11, ?11)
         ON CONFLICT(canonical_key) DO NOTHING`,
      ).bind(
        proposedConceptId,
        conceptIngestionKey,
        input.canonicalKey,
        input.namespace,
        input.label,
        input.description ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.resolverVersion ?? null,
        input.modelVersion ?? null,
        input.confidence ?? null,
        timestampText,
      ).run();
    }

    const persisted = existing ?? await this.db.prepare(
      `SELECT id
         FROM concepts
        WHERE canonical_key = ?1 AND superseded_at IS NULL`,
    ).bind(input.canonicalKey).first<{ id: string }>();
    if (!persisted) throw new Error(`Failed to persist concept "${input.canonicalKey}"`);

    const surfaceIngestionKey = stableKey([
      'concept-surface',
      persisted.id,
      input.surface,
      normalizedSurface,
      ...provenanceParts(input),
    ]);
    const surfaceId = await deterministicEntityId('concept_surface', surfaceIngestionKey);
    await this.db.prepare(
      `INSERT INTO concept_surfaces (
         id, ingestion_key, concept_id, surface, normalized_surface,
         source_span_id, artifact_version_id, evidence_entity_type,
         evidence_entity_id, evidence_locator, confidence, observed_at, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
       ON CONFLICT(ingestion_key) DO NOTHING`,
    ).bind(
      surfaceId,
      surfaceIngestionKey,
      persisted.id,
      input.surface,
      normalizedSurface,
      input.sourceSpanId ?? null,
      input.artifactVersionId ?? null,
      input.evidenceEntityType ?? null,
      input.evidenceEntityId ?? null,
      input.evidenceLocator ?? null,
      input.confidence ?? null,
      timestamp,
    ).run();

    return {
      conceptId: persisted.id,
      isNewConcept: existing === null,
    };
  }

  async resolveConcept(input: ResolveConceptInput): Promise<{
    canonicalKey: string;
    conceptId: string;
    confidence: number | null;
    resolutionId: string;
  }> {
    assertProvenance(input);
    const normalizedSurface = normalizeOpenTermSurface(input.surface);
    if (!normalizedSurface) throw new Error('Concept surface must not be empty');
    const timestamp = input.observedAt ?? nowSeconds();
    const existing = await this.db.prepare(
      `SELECT cs.concept_id, c.canonical_key, cs.confidence
         FROM concept_surfaces cs
         JOIN concepts c ON c.id = cs.concept_id
        WHERE cs.normalized_surface = ?1
          AND c.superseded_at IS NULL
        ORDER BY cs.observed_at DESC, cs.id
        LIMIT 1`,
    ).bind(normalizedSurface).first<{
      concept_id: string;
      canonical_key: string;
      confidence: number | null;
    }>();

    let conceptId: string;
    let canonicalKey: string;
    let confidence: number | null;
    if (existing) {
      conceptId = existing.concept_id;
      canonicalKey = existing.canonical_key;
      confidence = existing.confidence;
    } else {
      const term = openSemanticTerm(input.surface);
      if (!term) throw new Error('Concept surface must not be empty');
      const registered = await this.registerConcept({
        canonicalKey: term.canonicalKey,
        namespace: 'open',
        label: term.surface,
        surface: term.surface,
        resolverVersion: input.resolverVersion,
        modelVersion: input.modelVersion,
        sourceSpanId: input.sourceSpanId,
        artifactVersionId: input.artifactVersionId,
        evidenceEntityType: input.evidenceEntityType,
        evidenceEntityId: input.evidenceEntityId,
        evidenceLocator: input.evidenceLocator,
        observedAt: timestamp,
      });
      conceptId = registered.conceptId;
      canonicalKey = term.canonicalKey;
      confidence = null;
    }

    const resolutionIngestionKey = stableKey([
      'concept-resolution',
      conceptId,
      normalizedSurface,
      input.resolverVersion,
      input.modelVersion,
      ...provenanceParts(input),
    ]);
    const resolutionId = await deterministicEntityId(
      'concept_resolution',
      resolutionIngestionKey,
    );
    await this.db.prepare(
      `INSERT INTO concept_resolutions (
         id, ingestion_key, concept_id, resolver_version, model_version,
         resolved_canonical_key, resolution_confidence, resolution_metadata_json,
         source_span_id, artifact_version_id, evidence_entity_type,
         evidence_entity_id, evidence_locator, resolved_at, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '{}', ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(ingestion_key) DO NOTHING`,
    ).bind(
      resolutionId,
      resolutionIngestionKey,
      conceptId,
      input.resolverVersion,
      input.modelVersion ?? null,
      canonicalKey,
      confidence,
      input.sourceSpanId ?? null,
      input.artifactVersionId ?? null,
      input.evidenceEntityType ?? null,
      input.evidenceEntityId ?? null,
      input.evidenceLocator ?? null,
      timestamp,
    ).run();

    return { canonicalKey, conceptId, confidence, resolutionId };
  }

  async getConcept(canonicalKey: string): Promise<Concept | null> {
    const row = await this.db.prepare(
      `SELECT id, canonical_key, namespace, label, description,
              aliases_json, metadata_json, resolver_version, model_version,
              confidence, first_observed_at, last_observed_at,
              observation_count, superseded_at, superseded_by_id,
              created_at, updated_at
         FROM concepts
        WHERE canonical_key = ?1 AND superseded_at IS NULL`,
    ).bind(canonicalKey).first<{
      id: string;
      canonical_key: string;
      namespace: string;
      label: string;
      description: string | null;
      aliases_json: string;
      metadata_json: string;
      resolver_version: string | null;
      model_version: string | null;
      confidence: number | null;
      first_observed_at: number | null;
      last_observed_at: number | null;
      observation_count: number;
      superseded_at: number | null;
      superseded_by_id: string | null;
      created_at: string;
      updated_at: string;
    }>();
    if (!row) return null;
    return {
      id: row.id,
      canonicalKey: row.canonical_key,
      namespace: row.namespace,
      label: row.label,
      description: row.description ?? undefined,
      aliases: parseJsonArray(row.aliases_json),
      metadata: parseJsonRecord(row.metadata_json),
      resolverVersion: row.resolver_version ?? undefined,
      modelVersion: row.model_version ?? undefined,
      confidence: row.confidence ?? undefined,
      firstObservedAt: row.first_observed_at ?? undefined,
      lastObservedAt: row.last_observed_at ?? undefined,
      observationCount: row.observation_count,
      supersededAt: row.superseded_at ?? undefined,
      supersededById: row.superseded_by_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getConceptFaces(conceptId: string): Promise<ConceptFace[]> {
    const result = await this.db.prepare(
      `SELECT id, concept_id, surface, normalized_surface, source_span_id,
              artifact_version_id, evidence_entity_type, evidence_entity_id,
              evidence_locator, confidence, observed_at, created_at
         FROM concept_surfaces
        WHERE concept_id = ?1
        ORDER BY observed_at DESC, id`,
    ).bind(conceptId).all<{
      id: string;
      concept_id: string;
      surface: string;
      normalized_surface: string;
      source_span_id: string | null;
      artifact_version_id: string | null;
      evidence_entity_type: string | null;
      evidence_entity_id: string | null;
      evidence_locator: string | null;
      confidence: number | null;
      observed_at: number;
      created_at: number;
    }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      conceptId: row.concept_id,
      surface: row.surface,
      normalizedSurface: row.normalized_surface,
      sourceSpanId: row.source_span_id ?? undefined,
      artifactVersionId: row.artifact_version_id ?? undefined,
      evidenceEntityType: row.evidence_entity_type ?? undefined,
      evidenceEntityId: row.evidence_entity_id ?? undefined,
      evidenceLocator: row.evidence_locator ?? undefined,
      confidence: row.confidence ?? undefined,
      observedAt: row.observed_at,
      createdAt: row.created_at,
    }));
  }

  async getConceptResolutions(conceptId: string): Promise<ConceptResolution[]> {
    const result = await this.db.prepare(
      `SELECT id, concept_id, resolver_version, model_version,
              resolved_canonical_key, resolution_confidence,
              resolution_metadata_json, source_span_id, artifact_version_id,
              evidence_entity_type, evidence_entity_id, evidence_locator,
              resolved_at, created_at
         FROM concept_resolutions
        WHERE concept_id = ?1
        ORDER BY resolved_at DESC, id`,
    ).bind(conceptId).all<{
      id: string;
      concept_id: string;
      resolver_version: string;
      model_version: string | null;
      resolved_canonical_key: string;
      resolution_confidence: number | null;
      resolution_metadata_json: string;
      source_span_id: string | null;
      artifact_version_id: string | null;
      evidence_entity_type: string | null;
      evidence_entity_id: string | null;
      evidence_locator: string | null;
      resolved_at: number;
      created_at: number;
    }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      conceptId: row.concept_id,
      resolverVersion: row.resolver_version,
      modelVersion: row.model_version ?? undefined,
      resolvedCanonicalKey: row.resolved_canonical_key,
      resolutionConfidence: row.resolution_confidence ?? undefined,
      resolutionMetadata: parseJsonRecord(row.resolution_metadata_json),
      sourceSpanId: row.source_span_id ?? undefined,
      artifactVersionId: row.artifact_version_id ?? undefined,
      evidenceEntityType: row.evidence_entity_type ?? undefined,
      evidenceEntityId: row.evidence_entity_id ?? undefined,
      evidenceLocator: row.evidence_locator ?? undefined,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    }));
  }

  async addAdjacency(
    adjacency: Omit<ConceptAdjacency, 'id' | 'createdAt'>,
  ): Promise<string> {
    assertProvenance(adjacency);
    const ingestionKey = stableKey([
      'concept-adjacency',
      adjacency.fromConceptId,
      adjacency.toConceptId,
      adjacency.dimension,
      adjacency.stretchAllowed,
      ...provenanceParts(adjacency),
    ]);
    const id = await deterministicEntityId('concept_adjacency', ingestionKey);
    await this.db.prepare(
      `INSERT INTO concept_adjacency (
         id, ingestion_key, from_concept_id, to_concept_id, dimension,
         stretch_allowed, confidence, source_span_id, artifact_version_id,
         evidence_entity_type, evidence_entity_id, evidence_locator,
         observed_at, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(ingestion_key) DO NOTHING`,
    ).bind(
      id,
      ingestionKey,
      adjacency.fromConceptId,
      adjacency.toConceptId,
      adjacency.dimension,
      adjacency.stretchAllowed ? 1 : 0,
      adjacency.confidence ?? null,
      adjacency.sourceSpanId ?? null,
      adjacency.artifactVersionId ?? null,
      adjacency.evidenceEntityType ?? null,
      adjacency.evidenceEntityId ?? null,
      adjacency.evidenceLocator ?? null,
      adjacency.observedAt,
    ).run();
    return id;
  }

  async getAdjacencies(conceptId: string): Promise<ConceptAdjacency[]> {
    const result = await this.db.prepare(
      `SELECT id, from_concept_id, to_concept_id, dimension, stretch_allowed,
              confidence, source_span_id, artifact_version_id,
              evidence_entity_type, evidence_entity_id, evidence_locator,
              observed_at, created_at
         FROM concept_adjacency
        WHERE from_concept_id = ?1 OR to_concept_id = ?1
        ORDER BY observed_at DESC, id`,
    ).bind(conceptId).all<{
      id: string;
      from_concept_id: string;
      to_concept_id: string;
      dimension: string;
      stretch_allowed: number;
      confidence: number | null;
      source_span_id: string | null;
      artifact_version_id: string | null;
      evidence_entity_type: string | null;
      evidence_entity_id: string | null;
      evidence_locator: string | null;
      observed_at: number;
      created_at: number;
    }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      fromConceptId: row.from_concept_id,
      toConceptId: row.to_concept_id,
      dimension: row.dimension,
      stretchAllowed: row.stretch_allowed === 1,
      confidence: row.confidence ?? undefined,
      sourceSpanId: row.source_span_id ?? undefined,
      artifactVersionId: row.artifact_version_id ?? undefined,
      evidenceEntityType: row.evidence_entity_type ?? undefined,
      evidenceEntityId: row.evidence_entity_id ?? undefined,
      evidenceLocator: row.evidence_locator ?? undefined,
      observedAt: row.observed_at,
      createdAt: row.created_at,
    }));
  }

  async backfillOpenTerms(): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    let processed = 0;
    let created = 0;
    let updated = 0;
    const assertionRows = await this.db.prepare(
      `SELECT DISTINCT c.canonical_key, c.namespace, c.label,
              c.description, c.metadata_json, ss.artifact_version_id,
              ss.id AS source_span_id
         FROM semantic_assertions sa
         JOIN assertion_concepts ac ON ac.assertion_id = sa.id
         JOIN concepts c ON c.id = ac.concept_id
         JOIN assertion_source_spans ass ON ass.assertion_id = sa.id
         JOIN source_spans ss ON ss.id = ass.source_span_id
        WHERE c.superseded_at IS NULL`,
    ).all<{
      canonical_key: string;
      namespace: string;
      label: string;
      description: string | null;
      metadata_json: string;
      artifact_version_id: string;
      source_span_id: string;
    }>();

    for (const row of assertionRows.results ?? []) {
      const result = await this.registerConcept({
        canonicalKey: row.canonical_key,
        namespace: row.namespace,
        label: row.label,
        description: row.description ?? undefined,
        surface: row.label,
        metadata: parseJsonRecord(row.metadata_json),
        resolverVersion: 'linked-assertion-concept-v1',
        sourceSpanId: row.source_span_id,
        artifactVersionId: row.artifact_version_id,
      });
      processed++;
      if (result.isNewConcept) created++;
      else updated++;
    }

    const roleRows = await this.db.prepare(
      `SELECT id, rcd_version, source_section, narrative_text,
              extracted_properties_json
         FROM role_nodes
        WHERE superseded_at IS NULL`,
    ).all<{
      id: string;
      rcd_version: string;
      source_section: string | null;
      narrative_text: string;
      extracted_properties_json: string | null;
    }>();
    for (const row of roleRows.results ?? []) {
      const terms = new Map<string, { surface: string; canonicalKey: string }>();
      if (row.extracted_properties_json) {
        try {
          const properties = JSON.parse(row.extracted_properties_json) as {
            semantic_terms?: Array<{
              surface?: unknown;
              canonical_key?: unknown;
            }>;
          };
          for (const term of properties.semantic_terms ?? []) {
            if (
              typeof term.surface === 'string'
              && typeof term.canonical_key === 'string'
            ) {
              terms.set(term.canonical_key, {
                surface: term.surface,
                canonicalKey: term.canonical_key,
              });
            }
          }
        } catch {
          // Malformed properties remain available in the role-node source.
        }
      }
      for (const term of terms.values()) {
        const result = await this.registerConcept({
          canonicalKey: term.canonicalKey,
          namespace: 'open',
          label: term.surface,
          surface: term.surface,
          resolverVersion: 'role-node-semantic-term-v1',
          evidenceEntityType: 'role_node',
          evidenceEntityId: row.id,
          evidenceLocator: `${row.source_section ?? 'unknown'}@${row.rcd_version}`,
        });
        processed++;
        if (result.isNewConcept) created++;
        else updated++;
      }
    }

    if (
      await this.tableExists('repo_semantic_assertions')
      && await this.tableExists('repo_assertion_source_spans')
      && await this.tableExists('repo_source_spans')
    ) {
      const repoRows = await this.db.prepare(
        `SELECT rsa.id AS assertion_id, rsa.repo_snapshot_id, rsa.qualifiers_json,
                rsa.confidence, rsa.created_at, rass.source_span_id,
                rss.artifact_version_id, rss.path, rss.byte_start, rss.byte_end,
                rss.line_start, rss.line_end, rss.exact_text
           FROM repo_semantic_assertions rsa
           JOIN repo_assertion_source_spans rass ON rass.assertion_id = rsa.id
           JOIN repo_source_spans rss ON rss.id = rass.source_span_id
          ORDER BY rsa.id, rass.source_span_id`,
      ).all<{
        assertion_id: string;
        repo_snapshot_id: string;
        qualifiers_json: string;
        confidence: number;
        created_at: number;
        source_span_id: string;
        artifact_version_id: string;
        path: string | null;
        byte_start: number | null;
        byte_end: number | null;
        line_start: number | null;
        line_end: number | null;
        exact_text: string;
      }>();
      for (const row of repoRows.results ?? []) {
        const conceptKeys = parseStringArrayValue(parseJsonRecord(row.qualifiers_json).conceptKeys);
        for (const canonicalKey of conceptKeys) {
          const result = await this.registerConcept({
            canonicalKey,
            namespace: conceptNamespace(canonicalKey),
            label: conceptSurface(canonicalKey),
            surface: conceptSurface(canonicalKey),
            confidence: row.confidence,
            resolverVersion: 'repo-semantic-assertion-v1',
            metadata: {
              source: 'repo_semantic_assertion',
              assertionId: row.assertion_id,
              repoSnapshotId: row.repo_snapshot_id,
              sourceSpanId: row.source_span_id,
            },
            evidenceEntityType: 'repo_source_span',
            evidenceEntityId: row.source_span_id,
            evidenceLocator: repoSpanLocator(row),
            observedAt: row.created_at,
          });
          processed++;
          if (result.isNewConcept) created++;
          else updated++;
        }
      }
    }

    return { processed, created, updated };
  }
}

export function createConceptRegistry(db: D1Database): ConceptRegistry {
  return new D1ConceptRegistry(db);
}
