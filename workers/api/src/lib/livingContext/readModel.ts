const INTERACTION_LIMIT = 100;
const ARTIFACT_LIMIT = 200;
const ASSERTION_LIMIT = 500;
const CONTEXT_RECORD_LIMIT = 500;
const RELATIONSHIP_LIMIT = 500;
const SIGNAL_LIMIT = 200;
const SOURCE_SPAN_LIMIT = 1_000;
const EVIDENCE_LIMIT = 1_000;

export interface LivingContextSourceRef {
  sourceRefType: 'source_span';
  sourceRefId: string;
  sourceSpanId: string;
  evidenceRole: string | null;
  artifactId: string;
  artifactType: string;
  artifactLogicalKey: string | null;
  artifactVersionId: string;
  artifactVersionNumber: number;
  mediaType: string;
  storageKey: string | null;
  stableSegmentId: string | null;
  exactText: string;
  byteStart: number | null;
  byteEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  timestampStartMs: number | null;
  timestampEndMs: number | null;
  metadata: Record<string, unknown>;
}

export interface LivingContextGenericSourceRef {
  sourceRefType: string;
  sourceRefId: string;
  sourceSpanId: null;
  evidenceRole: string | null;
  locator: Record<string, unknown>;
  exactText: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
}

export type LivingContextRecordSourceRef =
  | LivingContextSourceRef
  | LivingContextGenericSourceRef;

export interface LivingContextArtifact {
  id: string;
  interactionId: string | null;
  artifactType: string;
  logicalKey: string | null;
  metadata: Record<string, unknown>;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  versionCount: number;
  mediaType: string | null;
  storageKey: string | null;
  createdAt: string;
  updatedAt: string;
  sourceSpans: LivingContextSourceRef[];
}

export interface LivingContextAssertion {
  id: string;
  interactionId: string | null;
  episodeId: string | null;
  subjectType: string;
  subjectId: string | null;
  predicate: string;
  narrative: string;
  confidence: number | null;
  polarity: number;
  extractionVersion: string | null;
  observedAt: string | null;
  qualifiers: Record<string, unknown>;
  concepts: Array<{
    id: string;
    canonicalKey: string;
    namespace: string;
    label: string;
    relationship: string;
    weight: number;
  }>;
  sources: LivingContextSourceRef[];
}

export interface LivingContextRecordEntity {
  entityType: string;
  entityId: string | null;
  relationship: string;
  value: unknown;
  confidence: number | null;
  metadata: Record<string, unknown>;
}

export interface LivingContextRecordConcept {
  id: string;
  canonicalKey: string;
  namespace: string;
  label: string;
  relationship: string;
  weight: number;
}

export interface LivingContextRecord {
  id: string;
  scopeType: string;
  scopeId: string;
  interactionId: string | null;
  applicationId: string | null;
  episodeId: string | null;
  assertionId: string | null;
  recordType: string;
  predicate: string | null;
  narrative: string;
  qualifiers: Record<string, unknown>;
  confidence: number | null;
  polarity: number;
  extractionVersion: string | null;
  observedAt: string | null;
  entities: LivingContextRecordEntity[];
  concepts: LivingContextRecordConcept[];
  sources: LivingContextRecordSourceRef[];
}

export interface LivingContextSignalEvidence {
  id: string;
  interactionId: string | null;
  assertionId: string;
  conceptId: string | null;
  evidenceLevel: string;
  strength: number;
  polarity: number;
  observedAt: string | null;
  assertionNarrative: string;
  assertionPredicate: string;
  sources: LivingContextSourceRef[];
}

export interface LivingContextSignal {
  signalKey: string;
  label: string;
  namespace: string | null;
  interactionId: string | null;
  asOf: string;
  conversationScore: number | null;
  totalScore: number;
  confidence: number;
  evidenceCount: number;
  sourceDiversity: number;
  dimensions: Record<string, unknown>;
  policyVersion: string;
  evidence: LivingContextSignalEvidence[];
}

export interface LivingContextReadModel {
  person: {
    personId: string;
    workspacePersonId: string;
    applicationId: string;
    displayName: string | null;
    primaryEmail: string | null;
    primaryPhone: string | null;
    relationshipSummary: string | null;
    applicationStatus: string | null;
    pipelineId: string | null;
    roles: Array<{
      id: string;
      roleType: string;
      label: string | null;
      applicationId: string | null;
      attributes: Record<string, unknown>;
      activeFrom: string | null;
      activeTo: string | null;
    }>;
  };
  summary: {
    interactionCount: number;
    artifactCount: number;
    contextRecordCount: number;
    assertionCount: number;
    signalCount: number;
    sourceSpanCount: number;
  };
  interactions: Array<{
    id: string;
    interactionType: string;
    externalReference: string | null;
    startedAt: string | null;
    endedAt: string | null;
    createdAt: string;
    updatedAt: string;
    metadata: Record<string, unknown>;
    artifactIds: string[];
    contextRecordIds: string[];
    assertionIds: string[];
    signalKeys: string[];
  }>;
  artifacts: LivingContextArtifact[];
  contextRecords: LivingContextRecord[];
  assertions: LivingContextAssertion[];
  signals: LivingContextSignal[];
  relationships: Array<{
    id: string;
    fromEntityType: string;
    fromEntityId: string;
    predicate: string;
    toEntityType: string | null;
    toEntityId: string | null;
    toValue: unknown;
    qualifiers: Record<string, unknown>;
    confidence: number | null;
    sourceAssertionId: string | null;
  }>;
}

interface IdentityRow {
  person_id: string;
  workspace_person_id: string;
  application_id: string;
  display_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  relationship_summary: string | null;
  application_status: string | null;
  pipeline_id: string | null;
}

interface InteractionRow {
  id: string;
  interaction_type: string;
  external_reference: string | null;
  started_at: string | null;
  ended_at: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface ArtifactRow {
  id: string;
  interaction_id: string | null;
  artifact_type: string;
  logical_key: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  latest_version_id: string | null;
  latest_version_number: number | null;
  version_count: number;
  media_type: string | null;
  storage_key: string | null;
}

interface SourceRow {
  assertion_id?: string | null;
  context_record_id?: string | null;
  evidence_role?: string | null;
  source_span_id: string;
  artifact_id: string;
  artifact_type: string;
  logical_key: string | null;
  artifact_version_id: string;
  version_number: number;
  media_type: string;
  storage_key: string | null;
  stable_segment_id: string | null;
  exact_text: string;
  byte_start: number | null;
  byte_end: number | null;
  char_start: number | null;
  char_end: number | null;
  line_start: number | null;
  line_end: number | null;
  timestamp_start_ms: number | null;
  timestamp_end_ms: number | null;
  metadata_json: string;
}

interface ContextRecordSourceRow {
  context_record_id: string | null;
  evidence_role: string | null;
  source_ref_type: string;
  source_ref_id: string;
  source_span_id: string | null;
  locator_json: string;
  ref_exact_text: string | null;
  content_hash: string | null;
  artifact_id: string | null;
  artifact_type: string | null;
  logical_key: string | null;
  artifact_version_id: string | null;
  version_number: number | null;
  media_type: string | null;
  storage_key: string | null;
  stable_segment_id: string | null;
  span_exact_text: string | null;
  byte_start: number | null;
  byte_end: number | null;
  char_start: number | null;
  char_end: number | null;
  line_start: number | null;
  line_end: number | null;
  timestamp_start_ms: number | null;
  timestamp_end_ms: number | null;
  metadata_json: string;
}

interface AssertionRow {
  id: string;
  interaction_id: string | null;
  episode_id: string | null;
  subject_type: string;
  subject_id: string | null;
  predicate: string;
  narrative: string;
  qualifiers_json: string;
  confidence: number | null;
  polarity: number;
  extraction_version: string | null;
  observed_at: string | null;
}

interface ContextRecordRow {
  id: string;
  scope_type: string;
  scope_id: string;
  interaction_id: string | null;
  application_id: string | null;
  episode_id: string | null;
  assertion_id: string | null;
  record_type: string;
  predicate: string | null;
  narrative: string;
  qualifiers_json: string;
  confidence: number | null;
  polarity: number;
  extraction_version: string | null;
  observed_at: string | null;
}

interface ContextRecordEntityRow {
  context_record_id: string;
  entity_type: string;
  entity_id: string | null;
  relationship: string;
  value_json: string | null;
  confidence: number | null;
  metadata_json: string;
}

interface ConceptRow {
  assertion_id: string;
  id: string;
  canonical_key: string;
  namespace: string;
  label: string;
  relationship: string;
  weight: number;
}

interface ContextRecordConceptRow {
  context_record_id: string;
  id: string;
  canonical_key: string;
  namespace: string;
  label: string;
  relationship: string;
  weight: number;
}

interface SignalRow {
  signal_key: string;
  concept_label: string | null;
  concept_namespace: string | null;
  interaction_id: string | null;
  as_of: string;
  conversation_score: number | null;
  total_score: number;
  confidence: number;
  evidence_count: number;
  source_diversity: number;
  dimensions_json: string;
  policy_version: string;
}

interface SignalEvidenceRow {
  id: string;
  signal_key: string;
  interaction_id: string | null;
  assertion_id: string;
  concept_id: string | null;
  evidence_level: string;
  strength: number;
  polarity: number;
  observed_at: string | null;
  assertion_narrative: string;
  assertion_predicate: string;
}

function parseRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseUnknown(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function sourceRef(row: SourceRow): LivingContextSourceRef {
  return {
    sourceRefType: 'source_span',
    sourceRefId: row.source_span_id,
    sourceSpanId: row.source_span_id,
    evidenceRole: row.evidence_role ?? null,
    artifactId: row.artifact_id,
    artifactType: row.artifact_type,
    artifactLogicalKey: row.logical_key,
    artifactVersionId: row.artifact_version_id,
    artifactVersionNumber: row.version_number,
    mediaType: row.media_type,
    storageKey: row.storage_key,
    stableSegmentId: row.stable_segment_id,
    exactText: row.exact_text,
    byteStart: row.byte_start,
    byteEnd: row.byte_end,
    charStart: row.char_start,
    charEnd: row.char_end,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    timestampStartMs: row.timestamp_start_ms,
    timestampEndMs: row.timestamp_end_ms,
    metadata: parseRecord(row.metadata_json),
  };
}

function contextRecordSourceRef(row: ContextRecordSourceRow): LivingContextRecordSourceRef {
  if (row.source_span_id && row.artifact_id && row.artifact_type && row.artifact_version_id) {
    return {
      sourceRefType: 'source_span',
      sourceRefId: row.source_ref_id,
      sourceSpanId: row.source_span_id,
      evidenceRole: row.evidence_role ?? null,
      artifactId: row.artifact_id,
      artifactType: row.artifact_type,
      artifactLogicalKey: row.logical_key,
      artifactVersionId: row.artifact_version_id,
      artifactVersionNumber: row.version_number ?? 0,
      mediaType: row.media_type ?? '',
      storageKey: row.storage_key,
      stableSegmentId: row.stable_segment_id,
      exactText: row.span_exact_text ?? row.ref_exact_text ?? '',
      byteStart: row.byte_start,
      byteEnd: row.byte_end,
      charStart: row.char_start,
      charEnd: row.char_end,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      timestampStartMs: row.timestamp_start_ms,
      timestampEndMs: row.timestamp_end_ms,
      metadata: parseRecord(row.metadata_json),
    };
  }

  return {
    sourceRefType: row.source_ref_type,
    sourceRefId: row.source_ref_id,
    sourceSpanId: null,
    evidenceRole: row.evidence_role ?? null,
    locator: parseRecord(row.locator_json),
    exactText: row.ref_exact_text,
    contentHash: row.content_hash,
    metadata: parseRecord(row.metadata_json),
  };
}

export async function loadCandidateLivingContext(
  db: D1Database,
  candidateId: string,
): Promise<LivingContextReadModel | null> {
  const identity = await db.prepare(
    `SELECT p.id AS person_id,
            wp.id AS workspace_person_id,
            app.id AS application_id,
            p.display_name,
            p.primary_email,
            p.primary_phone,
            wp.relationship_summary,
            app.status AS application_status,
            app.pipeline_id
       FROM applications app
       JOIN workspace_people wp ON wp.id = app.workspace_person_id
       JOIN people p ON p.id = wp.person_id
      WHERE app.legacy_candidate_id = ?1
      LIMIT 1`,
  ).bind(candidateId).first<IdentityRow>();
  if (!identity) return null;

  return loadLivingContextByWorkspacePerson(db, identity);
}

export async function loadContactLivingContext(
  db: D1Database,
  contactId: string,
): Promise<LivingContextReadModel | null> {
  const identity = await db.prepare(
    `SELECT p.id AS person_id,
            wp.id AS workspace_person_id,
            NULL AS application_id,
            p.display_name,
            p.primary_email,
            p.primary_phone,
            wp.relationship_summary,
            NULL AS application_status,
            NULL AS pipeline_id
       FROM workspace_people wp
       JOIN people p ON p.id = wp.person_id
       JOIN contacts c ON c.id = ?1
      WHERE wp.context_json LIKE '%"contactId":"' || ?1 || '"%'
      LIMIT 1`,
  ).bind(contactId).first<IdentityRow>();
  if (!identity) return null;

  return loadLivingContextByWorkspacePerson(db, identity);
}

async function loadLivingContextByWorkspacePerson(
  db: D1Database,
  identity: IdentityRow,
): Promise<LivingContextReadModel> {

  const [
    rolesResult,
    interactionsResult,
    artifactsResult,
    artifactSourcesResult,
    assertionsResult,
    assertionSourcesResult,
    conceptsResult,
    contextRecordsResult,
    contextRecordSourcesResult,
    contextRecordEntitiesResult,
    contextRecordConceptsResult,
    signalsResult,
    evidenceResult,
    relationshipsResult,
  ] = await Promise.all([
    db.prepare(
      `SELECT id, application_id, role_type, label, attributes_json, active_from, active_to
         FROM person_roles
        WHERE workspace_person_id = ?1
        ORDER BY created_at, id`,
    ).bind(identity.workspace_person_id).all<{
      id: string;
      application_id: string | null;
      role_type: string;
      label: string | null;
      attributes_json: string;
      active_from: string | null;
      active_to: string | null;
    }>(),
    db.prepare(
      `SELECT id, interaction_type, external_reference, started_at, ended_at,
              metadata_json, created_at, updated_at
         FROM interactions
        WHERE workspace_person_id = ?1
        ORDER BY COALESCE(started_at, created_at) DESC, id
        LIMIT ?2`,
    ).bind(identity.workspace_person_id, INTERACTION_LIMIT).all<InteractionRow>(),
    db.prepare(
      `SELECT a.id, a.interaction_id, a.artifact_type, a.logical_key,
              a.metadata_json, a.created_at, a.updated_at,
              av.id AS latest_version_id,
              av.version_number AS latest_version_number,
              av.media_type,
              av.storage_key,
              (SELECT COUNT(*) FROM artifact_versions versions
                WHERE versions.artifact_id = a.id) AS version_count
         FROM artifacts a
         LEFT JOIN artifact_versions av
           ON av.id = (
             SELECT latest.id
               FROM artifact_versions latest
              WHERE latest.artifact_id = a.id
              ORDER BY latest.version_number DESC
              LIMIT 1
           )
        WHERE a.workspace_person_id = ?1
        ORDER BY a.created_at DESC, a.id
        LIMIT ?2`,
    ).bind(identity.workspace_person_id, ARTIFACT_LIMIT).all<ArtifactRow>(),
    db.prepare(
      `SELECT NULL AS assertion_id,
              NULL AS evidence_role,
              ss.id AS source_span_id,
              a.id AS artifact_id,
              a.artifact_type,
              a.logical_key,
              av.id AS artifact_version_id,
              av.version_number,
              av.media_type,
              av.storage_key,
              ss.stable_segment_id,
              ss.exact_text,
              ss.byte_start,
              ss.byte_end,
              ss.char_start,
              ss.char_end,
              ss.line_start,
              ss.line_end,
              ss.timestamp_start_ms,
              ss.timestamp_end_ms,
              ss.metadata_json
         FROM source_spans ss
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE a.workspace_person_id = ?1
          AND av.version_number = (
            SELECT MAX(latest.version_number)
              FROM artifact_versions latest
             WHERE latest.artifact_id = a.id
          )
        ORDER BY a.created_at DESC, ss.char_start, ss.timestamp_start_ms, ss.id
        LIMIT ?2`,
    ).bind(identity.workspace_person_id, SOURCE_SPAN_LIMIT).all<SourceRow>(),
    db.prepare(
      `SELECT sa.id,
              e.interaction_id,
              sa.episode_id,
              sa.subject_type,
              sa.subject_id,
              sa.predicate,
              sa.narrative,
              sa.qualifiers_json,
              sa.confidence,
              sa.polarity,
              sa.extraction_version,
              sa.observed_at
         FROM semantic_assertions sa
         LEFT JOIN episodes e ON e.id = sa.episode_id
        WHERE sa.workspace_person_id = ?1
        ORDER BY COALESCE(sa.observed_at, sa.created_at) DESC, sa.id
        LIMIT ?2`,
    ).bind(identity.workspace_person_id, ASSERTION_LIMIT).all<AssertionRow>(),
    db.prepare(
      `SELECT ass.assertion_id,
              ass.evidence_role,
              ss.id AS source_span_id,
              a.id AS artifact_id,
              a.artifact_type,
              a.logical_key,
              av.id AS artifact_version_id,
              av.version_number,
              av.media_type,
              av.storage_key,
              ss.stable_segment_id,
              ss.exact_text,
              ss.byte_start,
              ss.byte_end,
              ss.char_start,
              ss.char_end,
              ss.line_start,
              ss.line_end,
              ss.timestamp_start_ms,
              ss.timestamp_end_ms,
              ss.metadata_json
         FROM assertion_source_spans ass
         JOIN semantic_assertions sa ON sa.id = ass.assertion_id
         JOIN source_spans ss ON ss.id = ass.source_span_id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE sa.workspace_person_id = ?1
        ORDER BY ass.assertion_id, ss.char_start, ss.timestamp_start_ms, ss.id
        LIMIT ?2`,
    ).bind(identity.workspace_person_id, SOURCE_SPAN_LIMIT).all<SourceRow>(),
    db.prepare(
      `SELECT ac.assertion_id,
              c.id,
              c.canonical_key,
              c.namespace,
              c.label,
              ac.relationship,
              ac.weight
         FROM assertion_concepts ac
         JOIN semantic_assertions sa ON sa.id = ac.assertion_id
         JOIN concepts c ON c.id = ac.concept_id
        WHERE sa.workspace_person_id = ?1
        ORDER BY ac.assertion_id, ac.weight DESC, c.label`,
    ).bind(identity.workspace_person_id).all<ConceptRow>(),
    db.prepare(
      `SELECT id, scope_type, scope_id,
              interaction_id, application_id, episode_id, assertion_id,
              record_type, predicate, narrative, qualifiers_json, confidence,
              polarity, extraction_version, observed_at
         FROM context_records
        WHERE workspace_person_id = ?1
        ORDER BY COALESCE(observed_at, created_at) DESC, id
        LIMIT ?2`,
    ).bind(identity.workspace_person_id, CONTEXT_RECORD_LIMIT).all<ContextRecordRow>(),
    db.prepare(
      `SELECT crsr.context_record_id,
              crsr.evidence_role,
              crsr.source_ref_type,
              crsr.source_ref_id,
              crsr.source_span_id,
              crsr.locator_json,
              crsr.exact_text AS ref_exact_text,
              crsr.content_hash,
              a.id AS artifact_id,
              a.artifact_type,
              a.logical_key,
              av.id AS artifact_version_id,
              av.version_number,
              av.media_type,
              av.storage_key,
              ss.stable_segment_id,
              ss.exact_text AS span_exact_text,
              ss.byte_start,
              ss.byte_end,
              ss.char_start,
              ss.char_end,
              ss.line_start,
              ss.line_end,
              ss.timestamp_start_ms,
              ss.timestamp_end_ms,
              crsr.metadata_json
         FROM context_record_source_refs crsr
         JOIN context_records cr ON cr.id = crsr.context_record_id
         LEFT JOIN source_spans ss ON ss.id = crsr.source_span_id
         LEFT JOIN artifact_versions av ON av.id = ss.artifact_version_id
         LEFT JOIN artifacts a ON a.id = av.artifact_id
        WHERE cr.workspace_person_id = ?1
        ORDER BY crsr.context_record_id, ss.char_start, ss.timestamp_start_ms, crsr.source_ref_type, crsr.source_ref_id
        LIMIT ?2`,
    ).bind(identity.workspace_person_id, SOURCE_SPAN_LIMIT).all<ContextRecordSourceRow>(),
    db.prepare(
      `SELECT cre.context_record_id, cre.entity_type, cre.entity_id,
              cre.relationship, cre.value_json, cre.confidence,
              cre.metadata_json
         FROM context_record_entities cre
         JOIN context_records cr ON cr.id = cre.context_record_id
        WHERE cr.workspace_person_id = ?1
        ORDER BY cre.context_record_id, cre.relationship, cre.entity_type, cre.entity_id`,
    ).bind(identity.workspace_person_id).all<ContextRecordEntityRow>(),
    db.prepare(
      `SELECT crc.context_record_id,
              c.id,
              c.canonical_key,
              c.namespace,
              c.label,
              crc.relationship,
              crc.weight
         FROM context_record_concepts crc
         JOIN context_records cr ON cr.id = crc.context_record_id
         JOIN concepts c ON c.id = crc.concept_id
        WHERE cr.workspace_person_id = ?1
        ORDER BY crc.context_record_id, crc.weight DESC, c.label`,
    ).bind(identity.workspace_person_id).all<ContextRecordConceptRow>(),
    db.prepare(
      `SELECT ss.signal_key,
              c.label AS concept_label,
              c.namespace AS concept_namespace,
              ss.interaction_id,
              ss.as_of,
              ss.conversation_score,
              ss.total_score,
              ss.confidence,
              ss.evidence_count,
              ss.source_diversity,
              ss.dimensions_json,
              ss.policy_version
         FROM signal_snapshots ss
         LEFT JOIN concepts c ON c.canonical_key = ss.signal_key
        WHERE ss.workspace_person_id = ?1
        ORDER BY ss.total_score DESC, ss.confidence DESC, ss.signal_key
        LIMIT ?2`,
    ).bind(identity.workspace_person_id, SIGNAL_LIMIT).all<SignalRow>(),
    db.prepare(
      `SELECT se.id,
              se.signal_key,
              se.interaction_id,
              se.assertion_id,
              se.concept_id,
              se.evidence_level,
              se.strength,
              se.polarity,
              se.observed_at,
              sa.narrative AS assertion_narrative,
              sa.predicate AS assertion_predicate
         FROM signal_evidence se
         JOIN semantic_assertions sa ON sa.id = se.assertion_id
        WHERE se.workspace_person_id = ?1
        ORDER BY COALESCE(se.observed_at, se.created_at) DESC, se.id
        LIMIT ?2`,
    ).bind(identity.workspace_person_id, EVIDENCE_LIMIT).all<SignalEvidenceRow>(),
    db.prepare(
      `SELECT id, from_entity_type, from_entity_id, predicate,
              to_entity_type, to_entity_id, to_value_json, qualifiers_json,
              confidence, source_assertion_id
         FROM semantic_relationships
        WHERE workspace_person_id = ?1
        ORDER BY created_at DESC, id
        LIMIT ?2`,
    ).bind(identity.workspace_person_id, RELATIONSHIP_LIMIT).all<{
      id: string;
      from_entity_type: string;
      from_entity_id: string;
      predicate: string;
      to_entity_type: string | null;
      to_entity_id: string | null;
      to_value_json: string | null;
      qualifiers_json: string;
      confidence: number | null;
      source_assertion_id: string | null;
    }>(),
  ]);

  const sourceByAssertion = new Map<string, LivingContextSourceRef[]>();
  for (const row of assertionSourcesResult.results ?? []) {
    if (!row.assertion_id) continue;
    const refs = sourceByAssertion.get(row.assertion_id) ?? [];
    refs.push(sourceRef(row));
    sourceByAssertion.set(row.assertion_id, refs);
  }

  const sourceByContextRecord = new Map<string, LivingContextRecordSourceRef[]>();
  for (const row of contextRecordSourcesResult.results ?? []) {
    if (!row.context_record_id) continue;
    const refs = sourceByContextRecord.get(row.context_record_id) ?? [];
    refs.push(contextRecordSourceRef(row));
    sourceByContextRecord.set(row.context_record_id, refs);
  }

  const sourcesByArtifact = new Map<string, LivingContextSourceRef[]>();
  for (const row of artifactSourcesResult.results ?? []) {
    const refs = sourcesByArtifact.get(row.artifact_id) ?? [];
    refs.push(sourceRef(row));
    sourcesByArtifact.set(row.artifact_id, refs);
  }

  const conceptsByAssertion = new Map<string, LivingContextAssertion['concepts']>();
  for (const row of conceptsResult.results ?? []) {
    const concepts = conceptsByAssertion.get(row.assertion_id) ?? [];
    concepts.push({
      id: row.id,
      canonicalKey: row.canonical_key,
      namespace: row.namespace,
      label: row.label,
      relationship: row.relationship,
      weight: row.weight,
    });
    conceptsByAssertion.set(row.assertion_id, concepts);
  }

  const entitiesByContextRecord = new Map<string, LivingContextRecordEntity[]>();
  for (const row of contextRecordEntitiesResult.results ?? []) {
    const entities = entitiesByContextRecord.get(row.context_record_id) ?? [];
    entities.push({
      entityType: row.entity_type,
      entityId: row.entity_id,
      relationship: row.relationship,
      value: parseUnknown(row.value_json),
      confidence: row.confidence,
      metadata: parseRecord(row.metadata_json),
    });
    entitiesByContextRecord.set(row.context_record_id, entities);
  }

  const conceptsByContextRecord = new Map<string, LivingContextRecordConcept[]>();
  for (const row of contextRecordConceptsResult.results ?? []) {
    const concepts = conceptsByContextRecord.get(row.context_record_id) ?? [];
    concepts.push({
      id: row.id,
      canonicalKey: row.canonical_key,
      namespace: row.namespace,
      label: row.label,
      relationship: row.relationship,
      weight: row.weight,
    });
    conceptsByContextRecord.set(row.context_record_id, concepts);
  }

  const assertions = (assertionsResult.results ?? []).map((row): LivingContextAssertion => ({
    id: row.id,
    interactionId: row.interaction_id,
    episodeId: row.episode_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    predicate: row.predicate,
    narrative: row.narrative,
    confidence: row.confidence,
    polarity: row.polarity,
    extractionVersion: row.extraction_version,
    observedAt: row.observed_at,
    qualifiers: parseRecord(row.qualifiers_json),
    concepts: conceptsByAssertion.get(row.id) ?? [],
    sources: sourceByAssertion.get(row.id) ?? [],
  }));
  const assertionsById = new Map(assertions.map((assertion) => [assertion.id, assertion]));

  const contextRecords = (contextRecordsResult.results ?? []).map((row): LivingContextRecord => ({
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    interactionId: row.interaction_id,
    applicationId: row.application_id,
    episodeId: row.episode_id,
    assertionId: row.assertion_id,
    recordType: row.record_type,
    predicate: row.predicate,
    narrative: row.narrative,
    qualifiers: parseRecord(row.qualifiers_json),
    confidence: row.confidence,
    polarity: row.polarity,
    extractionVersion: row.extraction_version,
    observedAt: row.observed_at,
    entities: entitiesByContextRecord.get(row.id) ?? [],
    concepts: conceptsByContextRecord.get(row.id) ?? [],
    sources: sourceByContextRecord.get(row.id) ?? [],
  }));

  const evidenceBySignal = new Map<string, LivingContextSignalEvidence[]>();
  for (const row of evidenceResult.results ?? []) {
    const evidence = evidenceBySignal.get(row.signal_key) ?? [];
    evidence.push({
      id: row.id,
      interactionId: row.interaction_id,
      assertionId: row.assertion_id,
      conceptId: row.concept_id,
      evidenceLevel: row.evidence_level,
      strength: row.strength,
      polarity: row.polarity,
      observedAt: row.observed_at,
      assertionNarrative: row.assertion_narrative,
      assertionPredicate: row.assertion_predicate,
      sources: assertionsById.get(row.assertion_id)?.sources ?? [],
    });
    evidenceBySignal.set(row.signal_key, evidence);
  }

  const signals = (signalsResult.results ?? []).map((row): LivingContextSignal => ({
    signalKey: row.signal_key,
    label: row.concept_label ?? row.signal_key,
    namespace: row.concept_namespace,
    interactionId: row.interaction_id,
    asOf: row.as_of,
    conversationScore: row.conversation_score,
    totalScore: row.total_score,
    confidence: row.confidence,
    evidenceCount: row.evidence_count,
    sourceDiversity: row.source_diversity,
    dimensions: parseRecord(row.dimensions_json),
    policyVersion: row.policy_version,
    evidence: evidenceBySignal.get(row.signal_key) ?? [],
  }));

  const artifacts = (artifactsResult.results ?? []).map((row): LivingContextArtifact => ({
    id: row.id,
    interactionId: row.interaction_id,
    artifactType: row.artifact_type,
    logicalKey: row.logical_key,
    metadata: parseRecord(row.metadata_json),
    latestVersionId: row.latest_version_id,
    latestVersionNumber: row.latest_version_number,
    versionCount: row.version_count,
    mediaType: row.media_type,
    storageKey: row.storage_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceSpans: sourcesByArtifact.get(row.id) ?? [],
  }));

  const artifactIdsByInteraction = new Map<string, string[]>();
  for (const artifact of artifacts) {
    if (!artifact.interactionId) continue;
    const ids = artifactIdsByInteraction.get(artifact.interactionId) ?? [];
    ids.push(artifact.id);
    artifactIdsByInteraction.set(artifact.interactionId, ids);
  }
  const assertionIdsByInteraction = new Map<string, string[]>();
  for (const assertion of assertions) {
    if (!assertion.interactionId) continue;
    const ids = assertionIdsByInteraction.get(assertion.interactionId) ?? [];
    ids.push(assertion.id);
    assertionIdsByInteraction.set(assertion.interactionId, ids);
  }
  const contextRecordIdsByInteraction = new Map<string, string[]>();
  for (const record of contextRecords) {
    if (!record.interactionId) continue;
    const ids = contextRecordIdsByInteraction.get(record.interactionId) ?? [];
    ids.push(record.id);
    contextRecordIdsByInteraction.set(record.interactionId, ids);
  }
  const signalKeysByInteraction = new Map<string, Set<string>>();
  for (const evidenceRows of evidenceBySignal.values()) {
    for (const evidence of evidenceRows) {
      if (!evidence.interactionId) continue;
      const keys = signalKeysByInteraction.get(evidence.interactionId) ?? new Set<string>();
      const signalKey = (evidenceResult.results ?? []).find(
        (row) => row.id === evidence.id,
      )?.signal_key;
      if (signalKey) keys.add(signalKey);
      signalKeysByInteraction.set(evidence.interactionId, keys);
    }
  }

  const interactions = (interactionsResult.results ?? []).map((row) => ({
    id: row.id,
    interactionType: row.interaction_type,
    externalReference: row.external_reference,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: parseRecord(row.metadata_json),
    artifactIds: artifactIdsByInteraction.get(row.id) ?? [],
    contextRecordIds: contextRecordIdsByInteraction.get(row.id) ?? [],
    assertionIds: assertionIdsByInteraction.get(row.id) ?? [],
    signalKeys: [...(signalKeysByInteraction.get(row.id) ?? new Set<string>())],
  }));

  return {
    person: {
      personId: identity.person_id,
      workspacePersonId: identity.workspace_person_id,
      applicationId: identity.application_id,
      displayName: identity.display_name,
      primaryEmail: identity.primary_email,
      primaryPhone: identity.primary_phone,
      relationshipSummary: identity.relationship_summary,
      applicationStatus: identity.application_status,
      pipelineId: identity.pipeline_id,
      roles: (rolesResult.results ?? []).map((row) => ({
        id: row.id,
        roleType: row.role_type,
        label: row.label,
        applicationId: row.application_id,
        attributes: parseRecord(row.attributes_json),
        activeFrom: row.active_from,
        activeTo: row.active_to,
      })),
    },
    summary: {
      interactionCount: interactions.length,
      artifactCount: artifacts.length,
      contextRecordCount: contextRecords.length,
      assertionCount: assertions.length,
      signalCount: signals.length,
      sourceSpanCount: (artifactSourcesResult.results ?? []).length,
    },
    interactions,
    artifacts,
    contextRecords,
    assertions,
    signals,
    relationships: (relationshipsResult.results ?? []).map((row) => ({
      id: row.id,
      fromEntityType: row.from_entity_type,
      fromEntityId: row.from_entity_id,
      predicate: row.predicate,
      toEntityType: row.to_entity_type,
      toEntityId: row.to_entity_id,
      toValue: parseUnknown(row.to_value_json),
      qualifiers: parseRecord(row.qualifiers_json),
      confidence: row.confidence,
      sourceAssertionId: row.source_assertion_id,
    })),
  };
}
