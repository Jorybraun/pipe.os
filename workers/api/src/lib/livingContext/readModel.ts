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
    applicationId: string | null;
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

export interface ScopedLivingContextReadModel {
  scope: {
    scopeType: string;
    scopeId: string;
    label: string | null;
    status: string | null;
    ownerId: string | null;
    pipelineId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    metadata: Record<string, unknown>;
  };
  summary: LivingContextReadModel['summary'];
  interactions: LivingContextReadModel['interactions'];
  artifacts: LivingContextArtifact[];
  contextRecords: LivingContextRecord[];
  assertions: LivingContextAssertion[];
  signals: LivingContextSignal[];
  relationships: LivingContextReadModel['relationships'];
}

/**
 * Interaction-scoped living context. Keeps the transcript/interaction evidence
 * separately reviewable from the accumulated person graph so that rebuildable
 * person projections can be deleted and rebuilt without losing the per-event
 * source-backed record.
 */
export interface InteractionLivingContext {
  interaction: {
    id: string;
    workspacePersonId: string;
    interactionType: string;
    externalReference: string | null;
    startedAt: string | null;
    endedAt: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  artifacts: LivingContextArtifact[];
  assertions: LivingContextAssertion[];
  contextRecords: LivingContextRecord[];
  signalEvidence: Array<{
    id: string;
    signalKey: string;
    conceptId: string | null;
    evidenceLevel: string;
    strength: number;
    polarity: number;
    observedAt: string | null;
    assertionId: string;
    assertionNarrative: string;
    assertionPredicate: string;
    sources: LivingContextSourceRef[];
  }>;
  summary: {
    artifactCount: number;
    sourceSpanCount: number;
    assertionCount: number;
    contextRecordCount: number;
    signalEvidenceCount: number;
  };
}

/**
 * Meeting-level interaction context. A meeting fans out to one interaction per
 * participant, all sharing the same immutable transcript artifact. This view
 * keeps the shared transcript evidence and per-participant derived semantics
 * separately reviewable from accumulated person projections.
 */
export interface MeetingTranscriptContext {
  meetingId: string;
  interactions: InteractionLivingContext[];
  sharedArtifacts: LivingContextArtifact[];
  contextRecords: LivingContextRecord[];
  summary: {
    interactionCount: number;
    artifactCount: number;
    sourceSpanCount: number;
    assertionCount: number;
    contextRecordCount: number;
  };
}

export interface TranscriptSearchHit {
  sourceSpanId: string;
  artifactId: string;
  artifactType: string;
  artifactLogicalKey: string | null;
  artifactVersionId: string;
  artifactVersionNumber: number;
  mediaType: string;
  stableSegmentId: string | null;
  exactText: string;
  charStart: number | null;
  charEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  timestampStartMs: number | null;
  timestampEndMs: number | null;
  matchOffset: number;
  matchLength: number;
  citingAssertionIds: string[];
  citingContextRecordIds: string[];
}

export interface TranscriptSearchResult {
  meetingId: string;
  query: string;
  hits: TranscriptSearchHit[];
}

export interface SourceContentSearchHit {
  sourceSpanId: string;
  artifactId: string;
  artifactType: string;
  artifactLogicalKey: string | null;
  artifactVersionId: string;
  artifactVersionNumber: number;
  mediaType: string;
  stableSegmentId: string | null;
  exactText: string;
  charStart: number | null;
  charEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  timestampStartMs: number | null;
  timestampEndMs: number | null;
  matchOffset: number;
  matchLength: number;
  citingAssertionIds: string[];
  citingContextRecordIds: string[];
  conceptKeys: string[];
}

export interface SourceContentSearchResult {
  personId: string;
  query: string;
  hits: SourceContentSearchHit[];
}

interface IdentityRow {
  person_id: string;
  workspace_person_id: string;
  application_id: string | null;
  display_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  relationship_summary: string | null;
  application_status: string | null;
  pipeline_id: string | null;
}

interface SummaryIdentityRow extends IdentityRow {
  legacy_candidate_id: string | null;
}

interface SummaryRoleRow {
  id: string;
  application_id: string | null;
  role_type: string;
  label: string | null;
  attributes_json: string;
  active_from: string | null;
  active_to: string | null;
}

interface SummaryCountsRow {
  interaction_count: number;
  artifact_count: number;
  context_record_count: number;
  assertion_count: number;
  signal_count: number;
  source_span_count: number;
}

interface SummaryApplicationRow {
  application_id: string;
  application_status: string | null;
  pipeline_id: string | null;
  legacy_candidate_id: string | null;
}

export interface CandidateLivingContextIdentity {
  personId: string;
  workspacePersonId: string;
  applicationId: string | null;
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

interface RoleContextScopeRow {
  id: string;
  owner_id: string;
  pipeline_id: string | null;
  status: string | null;
  baseline: string | null;
  knowledge_state: string | null;
  job_description_md: string | null;
  created_at: string | null;
  updated_at: string | null;
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

function isMissingTableError(error: unknown, tableName: string): boolean {
  return String(error instanceof Error ? error.message : error).includes(`no such table: ${tableName}`);
}

async function loadLatestSummaryApplication(
  db: D1Database,
  workspacePersonId: string,
): Promise<SummaryApplicationRow | null> {
  try {
    return await db.prepare(
      `SELECT id AS application_id,
              status AS application_status,
              pipeline_id,
              legacy_candidate_id
         FROM applications
        WHERE workspace_person_id = ?1
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
    ).bind(workspacePersonId).first<SummaryApplicationRow>();
  } catch (error) {
    if (isMissingTableError(error, 'applications')) return null;
    throw error;
  }
}

async function countCandidateMatchContextRecords(
  db: D1Database,
  candidateId: string,
): Promise<number> {
  try {
    const row = await db.prepare(
      `SELECT COUNT(*) AS count
         FROM context_records cr
         JOIN match_runs mr ON mr.id = cr.scope_id
        WHERE cr.scope_type = 'match_run'
          AND mr.candidate_id = ?1`,
    ).bind(candidateId).first<{ count: number }>();
    return row?.count ?? 0;
  } catch (error) {
    if (isMissingTableError(error, 'match_runs')) return 0;
    throw error;
  }
}

async function loadCandidateIdentityRow(
  db: D1Database,
  candidateId: string,
): Promise<SummaryIdentityRow | null> {
  try {
    const applicationIdentity = await db.prepare(
      `SELECT p.id AS person_id,
              wp.id AS workspace_person_id,
              app.id AS application_id,
              p.display_name,
              p.primary_email,
              p.primary_phone,
              wp.relationship_summary,
              app.status AS application_status,
              app.pipeline_id,
              app.legacy_candidate_id
         FROM applications app
         JOIN workspace_people wp ON wp.id = app.workspace_person_id
         JOIN people p ON p.id = wp.person_id
        WHERE app.legacy_candidate_id = ?1
        LIMIT 1`,
    ).bind(candidateId).first<SummaryIdentityRow>();
    if (applicationIdentity) return applicationIdentity;
  } catch (error) {
    if (!isMissingTableError(error, 'applications')) throw error;
  }

  try {
    return await db.prepare(
      `SELECT p.id AS person_id,
              wp.id AS workspace_person_id,
              NULL AS application_id,
              p.display_name,
              p.primary_email,
              p.primary_phone,
              wp.relationship_summary,
              c.status AS application_status,
              c.pipeline_id,
              c.id AS legacy_candidate_id
         FROM candidates c
         JOIN workspace_people wp ON wp.workspace_id = c.owner_id
         JOIN people p ON p.id = wp.person_id
        WHERE c.id = ?1
          AND (
            json_extract(wp.context_json, '$.talentPool.candidateId') = c.id
            OR EXISTS (
              SELECT 1
                FROM json_each(wp.context_json, '$.legacyCandidateIds') candidate_ids
               WHERE candidate_ids.value = c.id
            )
          )
        ORDER BY CASE WHEN json_extract(wp.context_json, '$.talentPool.roleless') = 1 THEN 0 ELSE 1 END,
                 wp.created_at,
                 wp.id
        LIMIT 1`,
    ).bind(candidateId).first<SummaryIdentityRow>();
  } catch (error) {
    if (
      isMissingTableError(error, 'candidates')
      || isMissingTableError(error, 'workspace_people')
      || isMissingTableError(error, 'people')
    ) {
      return null;
    }
    throw error;
  }
}

export async function loadCandidateLivingContextIdentity(
  db: D1Database,
  candidateId: string,
): Promise<CandidateLivingContextIdentity | null> {
  const identity = await loadCandidateIdentityRow(db, candidateId);
  if (!identity) return null;
  return {
    personId: identity.person_id,
    workspacePersonId: identity.workspace_person_id,
    applicationId: identity.application_id,
  };
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
  const identity = await loadCandidateIdentityRow(db, candidateId);
  if (!identity) return null;

  return loadLivingContextByWorkspacePerson(db, identity);
}

export async function loadCandidateLivingContextSummary(
  db: D1Database,
  candidateId: string,
): Promise<LivingContextReadModel | null> {
  const identity = await loadCandidateIdentityRow(db, candidateId);
  if (!identity) return null;

  return loadLivingContextSummaryByWorkspacePerson(db, identity);
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
      WHERE json_extract(wp.context_json, '$.contactId') = ?1
      LIMIT 1`,
  ).bind(contactId).first<IdentityRow>();
  if (!identity) return null;

  return loadLivingContextByWorkspacePerson(db, identity);
}

export async function loadContactLivingContextSummary(
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
            NULL AS pipeline_id,
            NULL AS legacy_candidate_id
       FROM workspace_people wp
       JOIN people p ON p.id = wp.person_id
       JOIN contacts c ON c.id = ?1
      WHERE json_extract(wp.context_json, '$.contactId') = ?1
      LIMIT 1`,
  ).bind(contactId).first<SummaryIdentityRow>();
  if (!identity) return null;

  const application = await loadLatestSummaryApplication(db, identity.workspace_person_id);
  return loadLivingContextSummaryByWorkspacePerson(db, {
    ...identity,
    application_id: application?.application_id ?? null,
    application_status: application?.application_status ?? null,
    pipeline_id: application?.pipeline_id ?? null,
    legacy_candidate_id: application?.legacy_candidate_id ?? null,
  });
}

export async function loadWorkspacePersonLivingContext(
  db: D1Database,
  workspaceId: string,
  personId: string,
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
      WHERE wp.workspace_id = ?1
        AND p.id = ?2
      LIMIT 1`,
  ).bind(workspaceId, personId).first<IdentityRow>();
  if (!identity) return null;

  return loadLivingContextByWorkspacePerson(db, identity);
}

export async function loadWorkspacePersonLivingContextSummary(
  db: D1Database,
  workspaceId: string,
  personId: string,
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
            NULL AS pipeline_id,
            NULL AS legacy_candidate_id
       FROM workspace_people wp
       JOIN people p ON p.id = wp.person_id
      WHERE wp.workspace_id = ?1
        AND p.id = ?2
      LIMIT 1`,
  ).bind(workspaceId, personId).first<SummaryIdentityRow>();
  if (!identity) return null;

  const application = await loadLatestSummaryApplication(db, identity.workspace_person_id);
  return loadLivingContextSummaryByWorkspacePerson(db, {
    ...identity,
    application_id: application?.application_id ?? null,
    application_status: application?.application_status ?? null,
    pipeline_id: application?.pipeline_id ?? null,
    legacy_candidate_id: application?.legacy_candidate_id ?? null,
  });
}

async function loadLivingContextSummaryByWorkspacePerson(
  db: D1Database,
  identity: SummaryIdentityRow,
): Promise<LivingContextReadModel> {
  const [rolesResult, counts, matchContextRecordCount] = await Promise.all([
    db.prepare(
      `SELECT id, application_id, role_type, label, attributes_json, active_from, active_to
         FROM person_roles
        WHERE workspace_person_id = ?1
        ORDER BY created_at, id`,
    ).bind(identity.workspace_person_id).all<SummaryRoleRow>(),
    db.prepare(
      `SELECT
          (SELECT COUNT(*) FROM interactions WHERE workspace_person_id = ?1) AS interaction_count,
          (SELECT COUNT(*) FROM artifacts WHERE workspace_person_id = ?1) AS artifact_count,
          (SELECT COUNT(*) FROM context_records WHERE workspace_person_id = ?1) AS context_record_count,
          (SELECT COUNT(*) FROM semantic_assertions WHERE workspace_person_id = ?1) AS assertion_count,
          (SELECT COUNT(*) FROM signal_snapshots WHERE workspace_person_id = ?1) AS signal_count,
          (
            SELECT COUNT(*)
              FROM source_spans ss
              JOIN artifact_versions av ON av.id = ss.artifact_version_id
              JOIN artifacts a ON a.id = av.artifact_id
             WHERE a.workspace_person_id = ?1
               AND av.version_number = (
                 SELECT MAX(latest.version_number)
                   FROM artifact_versions latest
                  WHERE latest.artifact_id = a.id
               )
          ) AS source_span_count`,
    ).bind(identity.workspace_person_id).first<SummaryCountsRow>(),
    identity.legacy_candidate_id
      ? countCandidateMatchContextRecords(db, identity.legacy_candidate_id)
      : Promise.resolve(0),
  ]);

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
      interactionCount: counts?.interaction_count ?? 0,
      artifactCount: counts?.artifact_count ?? 0,
      contextRecordCount: (counts?.context_record_count ?? 0) + matchContextRecordCount,
      assertionCount: counts?.assertion_count ?? 0,
      signalCount: counts?.signal_count ?? 0,
      sourceSpanCount: counts?.source_span_count ?? 0,
    },
    interactions: [],
    artifacts: [],
    contextRecords: [],
    assertions: [],
    signals: [],
    relationships: [],
  };
}

export async function loadRoleContextLivingContext(
  db: D1Database,
  roleContextId: string,
): Promise<ScopedLivingContextReadModel | null> {
  const roleContext = await db.prepare(
    `SELECT id, owner_id, pipeline_id, status, baseline, knowledge_state,
            job_description_md, created_at, updated_at
       FROM role_contexts
      WHERE id = ?1
      LIMIT 1`,
  ).bind(roleContextId).first<RoleContextScopeRow>();
  if (!roleContext) return null;

  const baseline = parseRecord(roleContext.baseline);
  const label = typeof baseline.title === 'string'
    ? baseline.title
    : typeof baseline.roleTitle === 'string'
      ? baseline.roleTitle
      : null;

  return loadScopedLivingContext(db, {
    scopeType: 'role_context',
    scopeId: roleContext.id,
    label,
    status: roleContext.status,
    ownerId: roleContext.owner_id,
    pipelineId: roleContext.pipeline_id,
    createdAt: roleContext.created_at,
    updatedAt: roleContext.updated_at,
    metadata: {
      baseline,
      knowledgeState: parseRecord(roleContext.knowledge_state),
      hasJobDescription: Boolean(roleContext.job_description_md),
    },
  });
}

async function loadScopedLivingContext(
  db: D1Database,
  scope: ScopedLivingContextReadModel['scope'],
): Promise<ScopedLivingContextReadModel> {
  const [
    artifactsResult,
    artifactSourcesResult,
    contextRecordsResult,
    contextRecordSourcesResult,
    contextRecordEntitiesResult,
    contextRecordConceptsResult,
  ] = await Promise.all([
    db.prepare(
      `SELECT a.id,
              a.interaction_id,
              a.artifact_type,
              a.logical_key,
              a.metadata_json,
              a.created_at,
              a.updated_at,
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
        WHERE EXISTS (
          SELECT 1
            FROM artifact_versions scoped_av
            JOIN source_spans scoped_ss ON scoped_ss.artifact_version_id = scoped_av.id
            JOIN context_record_source_refs scoped_crsr
              ON scoped_crsr.source_span_id = scoped_ss.id
            JOIN context_records scoped_cr
              ON scoped_cr.id = scoped_crsr.context_record_id
           WHERE scoped_av.artifact_id = a.id
             AND scoped_cr.scope_type = ?1
             AND scoped_cr.scope_id = ?2
        )
        ORDER BY a.created_at DESC, a.id
        LIMIT ?3`,
    ).bind(scope.scopeType, scope.scopeId, ARTIFACT_LIMIT).all<ArtifactRow>(),
    db.prepare(
      `SELECT DISTINCT
              NULL AS assertion_id,
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
         FROM context_record_source_refs crsr
         JOIN context_records cr ON cr.id = crsr.context_record_id
         JOIN source_spans ss ON ss.id = crsr.source_span_id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE cr.scope_type = ?1
          AND cr.scope_id = ?2
        ORDER BY a.created_at DESC, ss.char_start, ss.timestamp_start_ms, ss.id
        LIMIT ?3`,
    ).bind(scope.scopeType, scope.scopeId, SOURCE_SPAN_LIMIT).all<SourceRow>(),
    db.prepare(
      `SELECT id, scope_type, scope_id,
              interaction_id, application_id, episode_id, assertion_id,
              record_type, predicate, narrative, qualifiers_json, confidence,
              polarity, extraction_version, observed_at
         FROM context_records cr
        WHERE cr.scope_type = ?1
          AND cr.scope_id = ?2
        ORDER BY COALESCE(observed_at, created_at) DESC, id
        LIMIT ?3`,
    ).bind(scope.scopeType, scope.scopeId, CONTEXT_RECORD_LIMIT).all<ContextRecordRow>(),
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
        WHERE cr.scope_type = ?1
          AND cr.scope_id = ?2
        ORDER BY crsr.context_record_id, ss.char_start, ss.timestamp_start_ms, crsr.source_ref_type, crsr.source_ref_id
        LIMIT ?3`,
    ).bind(scope.scopeType, scope.scopeId, SOURCE_SPAN_LIMIT).all<ContextRecordSourceRow>(),
    db.prepare(
      `SELECT cre.context_record_id, cre.entity_type, cre.entity_id,
              cre.relationship, cre.value_json, cre.confidence,
              cre.metadata_json
         FROM context_record_entities cre
         JOIN context_records cr ON cr.id = cre.context_record_id
        WHERE cr.scope_type = ?1
          AND cr.scope_id = ?2
        ORDER BY cre.context_record_id, cre.relationship, cre.entity_type, cre.entity_id`,
    ).bind(scope.scopeType, scope.scopeId).all<ContextRecordEntityRow>(),
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
        WHERE cr.scope_type = ?1
          AND cr.scope_id = ?2
        ORDER BY crc.context_record_id, crc.weight DESC, c.label`,
    ).bind(scope.scopeType, scope.scopeId).all<ContextRecordConceptRow>(),
  ]);

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

  return {
    scope,
    summary: {
      interactionCount: 0,
      artifactCount: artifacts.length,
      contextRecordCount: contextRecords.length,
      assertionCount: 0,
      signalCount: 0,
      sourceSpanCount: (artifactSourcesResult.results ?? []).length,
    },
    interactions: [],
    artifacts,
    contextRecords,
    assertions: [],
    signals: [],
    relationships: [],
  };
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
      `SELECT a.id,
              COALESCE(
                a.interaction_id,
                (
                  SELECT ai.interaction_id
                    FROM artifact_interactions ai
                    JOIN interactions i ON i.id = ai.interaction_id
                   WHERE ai.artifact_id = a.id
                     AND i.workspace_person_id = ?1
                   ORDER BY ai.created_at, ai.interaction_id
                   LIMIT 1
                )
              ) AS interaction_id,
              a.artifact_type, a.logical_key,
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
           OR EXISTS (
             SELECT 1
               FROM artifact_interactions ai
               JOIN interactions i ON i.id = ai.interaction_id
              WHERE ai.artifact_id = a.id
                AND i.workspace_person_id = ?1
           )
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
        WHERE (
            a.workspace_person_id = ?1
            OR EXISTS (
              SELECT 1
                FROM artifact_interactions ai
                JOIN interactions i ON i.id = ai.interaction_id
               WHERE ai.artifact_id = a.id
                 AND i.workspace_person_id = ?1
            )
          )
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
         FROM context_records cr
        WHERE cr.workspace_person_id = ?1
           OR EXISTS (
             SELECT 1
               FROM context_record_source_refs crsr
               JOIN source_spans ss ON ss.id = crsr.source_span_id
               JOIN artifact_versions av ON av.id = ss.artifact_version_id
               JOIN artifacts a ON a.id = av.artifact_id
              WHERE crsr.context_record_id = cr.id
                AND (
                  a.workspace_person_id = ?1
                  OR EXISTS (
                    SELECT 1
                      FROM artifact_interactions ai
                      JOIN interactions i ON i.id = ai.interaction_id
                     WHERE ai.artifact_id = a.id
                       AND i.workspace_person_id = ?1
                  )
                )
           )
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
           OR EXISTS (
             SELECT 1
               FROM context_record_source_refs scoped_crsr
               JOIN source_spans scoped_ss ON scoped_ss.id = scoped_crsr.source_span_id
               JOIN artifact_versions scoped_av ON scoped_av.id = scoped_ss.artifact_version_id
               JOIN artifacts scoped_a ON scoped_a.id = scoped_av.artifact_id
              WHERE scoped_crsr.context_record_id = cr.id
                AND (
                  scoped_a.workspace_person_id = ?1
                  OR EXISTS (
                    SELECT 1
                      FROM artifact_interactions scoped_ai
                      JOIN interactions scoped_i ON scoped_i.id = scoped_ai.interaction_id
                     WHERE scoped_ai.artifact_id = scoped_a.id
                       AND scoped_i.workspace_person_id = ?1
                  )
                )
           )
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
           OR EXISTS (
             SELECT 1
               FROM context_record_source_refs crsr
               JOIN source_spans ss ON ss.id = crsr.source_span_id
               JOIN artifact_versions av ON av.id = ss.artifact_version_id
               JOIN artifacts a ON a.id = av.artifact_id
              WHERE crsr.context_record_id = cr.id
                AND (
                  a.workspace_person_id = ?1
                  OR EXISTS (
                    SELECT 1
                      FROM artifact_interactions ai
                      JOIN interactions i ON i.id = ai.interaction_id
                     WHERE ai.artifact_id = a.id
                       AND i.workspace_person_id = ?1
                  )
                )
           )
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
           OR EXISTS (
             SELECT 1
               FROM context_record_source_refs crsr
               JOIN source_spans ss ON ss.id = crsr.source_span_id
               JOIN artifact_versions av ON av.id = ss.artifact_version_id
               JOIN artifacts a ON a.id = av.artifact_id
              WHERE crsr.context_record_id = cr.id
                AND (
                  a.workspace_person_id = ?1
                  OR EXISTS (
                    SELECT 1
                      FROM artifact_interactions ai
                      JOIN interactions i ON i.id = ai.interaction_id
                     WHERE ai.artifact_id = a.id
                       AND i.workspace_person_id = ?1
                  )
                )
           )
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

// ─── Interaction-scoped context (separately reviewable) ─────────────────────

interface InteractionScopeRow {
  id: string;
  workspace_person_id: string;
  interaction_type: string;
  external_reference: string | null;
  started_at: string | null;
  ended_at: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface MeetingTranscriptArtifactRow {
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

const TRANSCRIPT_SEARCH_LIMIT = 200;

/**
 * Load a single interaction's source-backed context. This is the per-event
 * review view: the immutable transcript artifact + exact source spans + derived
 * assertions/context records/signal evidence, all linked back to exact spans.
 * It is independent of the accumulated person graph projection.
 */
export async function loadInteractionLivingContext(
  db: D1Database,
  interactionId: string,
): Promise<InteractionLivingContext | null> {
  const interaction = await db.prepare(
    `SELECT id, workspace_person_id, interaction_type, external_reference,
            started_at, ended_at, metadata_json, created_at, updated_at
       FROM interactions
      WHERE id = ?1
      LIMIT 1`,
  ).bind(interactionId).first<InteractionScopeRow>();
  if (!interaction) return null;

  const [
    artifactsResult,
    artifactSourcesResult,
    assertionsResult,
    assertionSourcesResult,
    conceptsResult,
    contextRecordsResult,
    contextRecordSourcesResult,
    contextRecordEntitiesResult,
    contextRecordConceptsResult,
    evidenceResult,
  ] = await Promise.all([
    db.prepare(
      `SELECT DISTINCT
              a.id,
              COALESCE(a.interaction_id, ai.interaction_id) AS interaction_id,
              a.artifact_type, a.logical_key,
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
         LEFT JOIN artifact_interactions ai ON ai.artifact_id = a.id
        WHERE a.interaction_id = ?1
           OR ai.interaction_id = ?1
        ORDER BY a.created_at DESC, a.id
        LIMIT ?2`,
    ).bind(interactionId, ARTIFACT_LIMIT).all<MeetingTranscriptArtifactRow>(),
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
        WHERE av.version_number = (
            SELECT MAX(latest.version_number)
              FROM artifact_versions latest
             WHERE latest.artifact_id = a.id
          )
          AND (
            a.interaction_id = ?1
            OR EXISTS (
              SELECT 1 FROM artifact_interactions ai
               WHERE ai.artifact_id = a.id AND ai.interaction_id = ?1
            )
          )
        ORDER BY a.created_at DESC, ss.char_start, ss.timestamp_start_ms, ss.id
        LIMIT ?2`,
    ).bind(interactionId, SOURCE_SPAN_LIMIT).all<SourceRow>(),
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
        WHERE e.interaction_id = ?1
        ORDER BY COALESCE(sa.observed_at, sa.created_at) DESC, sa.id
        LIMIT ?2`,
    ).bind(interactionId, ASSERTION_LIMIT).all<AssertionRow>(),
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
         JOIN episodes e ON e.id = sa.episode_id
         JOIN source_spans ss ON ss.id = ass.source_span_id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE e.interaction_id = ?1
        ORDER BY ass.assertion_id, ss.char_start, ss.timestamp_start_ms, ss.id
        LIMIT ?2`,
    ).bind(interactionId, SOURCE_SPAN_LIMIT).all<SourceRow>(),
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
         JOIN episodes e ON e.id = sa.episode_id
         JOIN concepts c ON c.id = ac.concept_id
        WHERE e.interaction_id = ?1
        ORDER BY ac.assertion_id, ac.weight DESC, c.label`,
    ).bind(interactionId).all<ConceptRow>(),
    db.prepare(
      `SELECT id, scope_type, scope_id,
              interaction_id, application_id, episode_id, assertion_id,
              record_type, predicate, narrative, qualifiers_json, confidence,
              polarity, extraction_version, observed_at
         FROM context_records
        WHERE interaction_id = ?1
        ORDER BY COALESCE(observed_at, created_at) DESC, id
        LIMIT ?2`,
    ).bind(interactionId, CONTEXT_RECORD_LIMIT).all<ContextRecordRow>(),
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
        WHERE cr.interaction_id = ?1
        ORDER BY crsr.context_record_id, ss.char_start, ss.timestamp_start_ms,
                 crsr.source_ref_type, crsr.source_ref_id
        LIMIT ?2`,
    ).bind(interactionId, SOURCE_SPAN_LIMIT).all<ContextRecordSourceRow>(),
    db.prepare(
      `SELECT cre.context_record_id, cre.entity_type, cre.entity_id,
              cre.relationship, cre.value_json, cre.confidence,
              cre.metadata_json
         FROM context_record_entities cre
         JOIN context_records cr ON cr.id = cre.context_record_id
        WHERE cr.interaction_id = ?1
        ORDER BY cre.context_record_id, cre.relationship, cre.entity_type, cre.entity_id`,
    ).bind(interactionId).all<ContextRecordEntityRow>(),
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
        WHERE cr.interaction_id = ?1
        ORDER BY crc.context_record_id, crc.weight DESC, c.label`,
    ).bind(interactionId).all<ContextRecordConceptRow>(),
    db.prepare(
      `SELECT se.id,
              se.signal_key,
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
        WHERE se.interaction_id = ?1
        ORDER BY COALESCE(se.observed_at, se.created_at) DESC, se.id
        LIMIT ?2`,
    ).bind(interactionId, EVIDENCE_LIMIT).all<SignalEvidenceRow>(),
  ]);

  const sourcesByArtifact = new Map<string, LivingContextSourceRef[]>();
  for (const row of artifactSourcesResult.results ?? []) {
    const refs = sourcesByArtifact.get(row.artifact_id) ?? [];
    refs.push(sourceRef(row));
    sourcesByArtifact.set(row.artifact_id, refs);
  }
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

  const signalEvidence = (evidenceResult.results ?? []).map((row) => ({
    id: row.id,
    signalKey: row.signal_key,
    conceptId: row.concept_id,
    evidenceLevel: row.evidence_level,
    strength: row.strength,
    polarity: row.polarity,
    observedAt: row.observed_at,
    assertionId: row.assertion_id,
    assertionNarrative: row.assertion_narrative,
    assertionPredicate: row.assertion_predicate,
    sources: assertionsById.get(row.assertion_id)?.sources ?? [],
  }));

  return {
    interaction: {
      id: interaction.id,
      workspacePersonId: interaction.workspace_person_id,
      interactionType: interaction.interaction_type,
      externalReference: interaction.external_reference,
      startedAt: interaction.started_at,
      endedAt: interaction.ended_at,
      metadata: parseRecord(interaction.metadata_json),
      createdAt: interaction.created_at,
      updatedAt: interaction.updated_at,
    },
    artifacts,
    assertions,
    contextRecords,
    signalEvidence,
    summary: {
      artifactCount: artifacts.length,
      sourceSpanCount: (artifactSourcesResult.results ?? []).length,
      assertionCount: assertions.length,
      contextRecordCount: contextRecords.length,
      signalEvidenceCount: signalEvidence.length,
    },
  };
}

/**
 * Load the meeting-level interaction context: every participant interaction for
 * a meeting plus the shared immutable transcript artifact. Keeps interaction
 * context separately reviewable while person projections rebuild independently.
 */
export async function loadMeetingTranscriptContext(
  db: D1Database,
  meetingId: string,
): Promise<MeetingTranscriptContext | null> {
  const interactions = await db.prepare(
    `SELECT id
       FROM interactions
      WHERE external_reference = ?1
        AND interaction_type = 'video_meeting'
      ORDER BY created_at, id`,
  ).bind(meetingId).all<{ id: string }>();

  const sharedArtifactsResult = await db.prepare(
    `SELECT a.id,
            NULL AS interaction_id,
            a.artifact_type, a.logical_key,
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
      WHERE a.artifact_type = 'meeting_transcript'
        AND a.logical_key = ?1
      ORDER BY a.created_at DESC, a.id
      LIMIT ?2`,
  ).bind(meetingId, ARTIFACT_LIMIT).all<MeetingTranscriptArtifactRow>();

  const sharedArtifactIds = (sharedArtifactsResult.results ?? []).map((row) => row.id);
  const sharedSourcesResult = sharedArtifactIds.length > 0
    ? await db.prepare(
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
        WHERE a.id IN (${sharedArtifactIds.map((_, i) => `?${i + 1}`).join(', ')})
        ORDER BY av.version_number DESC, ss.char_start, ss.timestamp_start_ms, ss.id
        LIMIT ?${sharedArtifactIds.length + 1}`,
      ).bind(...sharedArtifactIds, SOURCE_SPAN_LIMIT).all<SourceRow>()
    : { results: [] as SourceRow[] };

  const sourcesByArtifact = new Map<string, LivingContextSourceRef[]>();
  for (const row of sharedSourcesResult.results ?? []) {
    const refs = sourcesByArtifact.get(row.artifact_id) ?? [];
    refs.push(sourceRef(row));
    sourcesByArtifact.set(row.artifact_id, refs);
  }
  const sharedArtifacts: LivingContextArtifact[] = (sharedArtifactsResult.results ?? []).map((row) => ({
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

  const interactionContexts: InteractionLivingContext[] = [];
  for (const row of interactions.results ?? []) {
    const ctx = await loadInteractionLivingContext(db, row.id);
    if (ctx) interactionContexts.push(ctx);
  }

  // Meeting-scoped context records (e.g. the meeting_transcript record that
  // preserves the full transcript) are scoped to the meeting rather than a
  // single participant interaction. Load them here so the meeting-level view
  // stays separately reviewable alongside the per-interaction semantics.
  const [
    meetingContextRecordsResult,
    meetingContextRecordSourcesResult,
    meetingContextRecordEntitiesResult,
    meetingContextRecordConceptsResult,
  ] = await Promise.all([
    db.prepare(
      `SELECT id, scope_type, scope_id,
              interaction_id, application_id, episode_id, assertion_id,
              record_type, predicate, narrative, qualifiers_json, confidence,
              polarity, extraction_version, observed_at
         FROM context_records
        WHERE scope_type = 'meeting'
          AND scope_id = ?1
        ORDER BY COALESCE(observed_at, created_at) DESC, id
        LIMIT ?2`,
    ).bind(meetingId, CONTEXT_RECORD_LIMIT).all<ContextRecordRow>(),
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
        WHERE cr.scope_type = 'meeting'
          AND cr.scope_id = ?1
        ORDER BY crsr.context_record_id, ss.char_start, ss.timestamp_start_ms,
                 crsr.source_ref_type, crsr.source_ref_id
        LIMIT ?2`,
    ).bind(meetingId, SOURCE_SPAN_LIMIT).all<ContextRecordSourceRow>(),
    db.prepare(
      `SELECT cre.context_record_id, cre.entity_type, cre.entity_id,
              cre.relationship, cre.value_json, cre.confidence,
              cre.metadata_json
         FROM context_record_entities cre
         JOIN context_records cr ON cr.id = cre.context_record_id
        WHERE cr.scope_type = 'meeting'
          AND cr.scope_id = ?1
        ORDER BY cre.context_record_id, cre.relationship, cre.entity_type, cre.entity_id`,
    ).bind(meetingId).all<ContextRecordEntityRow>(),
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
        WHERE cr.scope_type = 'meeting'
          AND cr.scope_id = ?1
        ORDER BY crc.context_record_id, crc.weight DESC, c.label`,
    ).bind(meetingId).all<ContextRecordConceptRow>(),
  ]);

  const meetingSourceByRecord = new Map<string, LivingContextRecordSourceRef[]>();
  for (const row of meetingContextRecordSourcesResult.results ?? []) {
    if (!row.context_record_id) continue;
    const refs = meetingSourceByRecord.get(row.context_record_id) ?? [];
    refs.push(contextRecordSourceRef(row));
    meetingSourceByRecord.set(row.context_record_id, refs);
  }
  const meetingEntitiesByRecord = new Map<string, LivingContextRecordEntity[]>();
  for (const row of meetingContextRecordEntitiesResult.results ?? []) {
    const entities = meetingEntitiesByRecord.get(row.context_record_id) ?? [];
    entities.push({
      entityType: row.entity_type,
      entityId: row.entity_id,
      relationship: row.relationship,
      value: parseUnknown(row.value_json),
      confidence: row.confidence,
      metadata: parseRecord(row.metadata_json),
    });
    meetingEntitiesByRecord.set(row.context_record_id, entities);
  }
  const meetingConceptsByRecord = new Map<string, LivingContextRecordConcept[]>();
  for (const row of meetingContextRecordConceptsResult.results ?? []) {
    const concepts = meetingConceptsByRecord.get(row.context_record_id) ?? [];
    concepts.push({
      id: row.id,
      canonicalKey: row.canonical_key,
      namespace: row.namespace,
      label: row.label,
      relationship: row.relationship,
      weight: row.weight,
    });
    meetingConceptsByRecord.set(row.context_record_id, concepts);
  }
  const meetingContextRecords: LivingContextRecord[] = (meetingContextRecordsResult.results ?? []).map((row) => ({
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
    entities: meetingEntitiesByRecord.get(row.id) ?? [],
    concepts: meetingConceptsByRecord.get(row.id) ?? [],
    sources: meetingSourceByRecord.get(row.id) ?? [],
  }));

  const sourceSpanCount = sharedArtifacts.reduce(
    (sum, artifact) => sum + artifact.sourceSpans.length,
    0,
  );
  const assertionCount = interactionContexts.reduce(
    (sum, ctx) => sum + ctx.assertions.length,
    0,
  );
  const interactionContextRecordCount = interactionContexts.reduce(
    (sum, ctx) => sum + ctx.contextRecords.length,
    0,
  );
  const contextRecordCount = meetingContextRecords.length + interactionContextRecordCount;

  return {
    meetingId,
    interactions: interactionContexts,
    sharedArtifacts,
    contextRecords: meetingContextRecords,
    summary: {
      interactionCount: interactionContexts.length,
      artifactCount: sharedArtifacts.length,
      sourceSpanCount,
      assertionCount,
      contextRecordCount,
    },
  };
}

/**
 * Search original transcript text for a meeting. Returns explainable hits that
 * point back to exact source spans (with char/line/timestamp offsets) plus the
 * assertions and context records that cite each matching span.
 */
export async function searchTranscriptSourceSpans(
  db: D1Database,
  meetingId: string,
  query: string,
  limit = TRANSCRIPT_SEARCH_LIMIT,
): Promise<TranscriptSearchResult> {
  const trimmed = query.trim();
  const result: TranscriptSearchResult = { meetingId, query: trimmed, hits: [] };
  if (!trimmed) return result;

  const artifact = await db.prepare(
    `SELECT a.id
       FROM artifacts a
      WHERE a.artifact_type = 'meeting_transcript'
        AND a.logical_key = ?1
      LIMIT 1`,
  ).bind(meetingId).first<{ id: string }>();
  if (!artifact) return result;

  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const like = `%${escaped}%`;
  const spans = await db.prepare(
    `SELECT ss.id AS source_span_id,
            a.id AS artifact_id,
            a.artifact_type,
            a.logical_key,
            av.id AS artifact_version_id,
            av.version_number,
            av.media_type,
            ss.stable_segment_id,
            ss.exact_text,
            ss.char_start,
            ss.char_end,
            ss.line_start,
            ss.line_end,
            ss.timestamp_start_ms,
            ss.timestamp_end_ms
       FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
      WHERE a.id = ?1
        AND LOWER(ss.exact_text) LIKE LOWER(?2) ESCAPE '\\'
      ORDER BY av.version_number DESC, ss.char_start, ss.timestamp_start_ms, ss.id
      LIMIT ?3`,
  ).bind(artifact.id, like, limit).all<{
    source_span_id: string;
    artifact_id: string;
    artifact_type: string;
    logical_key: string | null;
    artifact_version_id: string;
    version_number: number;
    media_type: string;
    stable_segment_id: string | null;
    exact_text: string;
    char_start: number | null;
    char_end: number | null;
    line_start: number | null;
    line_end: number | null;
    timestamp_start_ms: number | null;
    timestamp_end_ms: number | null;
  }>();

  const spanIds = (spans.results ?? []).map((row) => row.source_span_id);
  if (spanIds.length === 0) return result;

  const placeholders = spanIds.map((_, i) => `?${i + 1}`).join(', ');
  const [assertionLinks, contextRecordLinks] = await Promise.all([
    db.prepare(
      `SELECT ass.source_span_id, ass.assertion_id
         FROM assertion_source_spans ass
        WHERE ass.source_span_id IN (${placeholders})`,
    ).bind(...spanIds).all<{ source_span_id: string; assertion_id: string }>(),
    db.prepare(
      `SELECT crsr.source_span_id, crsr.context_record_id
         FROM context_record_source_refs crsr
        WHERE crsr.source_span_id IN (${placeholders})`,
    ).bind(...spanIds).all<{ source_span_id: string; context_record_id: string }>(),
  ]);

  const assertionsBySpan = new Map<string, string[]>();
  for (const row of assertionLinks.results ?? []) {
    const ids = assertionsBySpan.get(row.source_span_id) ?? [];
    ids.push(row.assertion_id);
    assertionsBySpan.set(row.source_span_id, ids);
  }
  const contextRecordsBySpan = new Map<string, string[]>();
  for (const row of contextRecordLinks.results ?? []) {
    const ids = contextRecordsBySpan.get(row.source_span_id) ?? [];
    ids.push(row.context_record_id);
    contextRecordsBySpan.set(row.source_span_id, ids);
  }

  const lowerQuery = trimmed.toLowerCase();
  result.hits = (spans.results ?? []).map((row) => {
    const matchOffset = row.exact_text.toLowerCase().indexOf(lowerQuery);
    return {
      sourceSpanId: row.source_span_id,
      artifactId: row.artifact_id,
      artifactType: row.artifact_type,
      artifactLogicalKey: row.logical_key,
      artifactVersionId: row.artifact_version_id,
      artifactVersionNumber: row.version_number,
      mediaType: row.media_type,
      stableSegmentId: row.stable_segment_id,
      exactText: row.exact_text,
      charStart: row.char_start,
      charEnd: row.char_end,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      timestampStartMs: row.timestamp_start_ms,
      timestampEndMs: row.timestamp_end_ms,
      matchOffset: matchOffset >= 0 ? matchOffset : 0,
      matchLength: trimmed.length,
      citingAssertionIds: assertionsBySpan.get(row.source_span_id) ?? [],
      citingContextRecordIds: contextRecordsBySpan.get(row.source_span_id) ?? [],
    };
  });

  return result;
}

const SOURCE_CONTENT_SEARCH_LIMIT = 50;

/**
 * Search all source content linked to a workspace person. Returns hits across
 * every artifact (transcripts, resumes, assessment responses, code review
 * evidence) with exact source span provenance, linked citing assertions and
 * context records, and concept keys. Enables criterion #2: "original content
 * remains semantically searchable — PIPE can always explain where a conclusion
 * originated."
 */
export async function searchSourceContent(
  db: D1Database,
  workspacePersonId: string,
  query: string,
  limit = SOURCE_CONTENT_SEARCH_LIMIT,
): Promise<SourceContentSearchResult> {
  const trimmed = query.trim();
  const result: SourceContentSearchResult = { personId: workspacePersonId, query: trimmed, hits: [] };
  if (!trimmed) return result;

  const person = await db.prepare(
    `SELECT person_id FROM workspace_people WHERE id = ?1 LIMIT 1`,
  ).bind(workspacePersonId).first<{ person_id: string }>();
  if (!person) return result;

  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const like = `%${escaped}%`;

  const spans = await db.prepare(
    `SELECT ss.id AS source_span_id,
            a.id AS artifact_id,
            a.artifact_type,
            a.logical_key,
            av.id AS artifact_version_id,
            av.version_number,
            av.media_type,
            ss.stable_segment_id,
            ss.exact_text,
            ss.char_start,
            ss.char_end,
            ss.line_start,
            ss.line_end,
            ss.timestamp_start_ms,
            ss.timestamp_end_ms
       FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
       JOIN interactions i ON i.id = a.interaction_id
      WHERE i.workspace_person_id = ?1
        AND LOWER(ss.exact_text) LIKE LOWER(?2) ESCAPE '\\'
      ORDER BY av.version_number DESC, ss.char_start, ss.timestamp_start_ms, ss.id
      LIMIT ?3`,
  ).bind(workspacePersonId, like, limit).all<{
    source_span_id: string;
    artifact_id: string;
    artifact_type: string;
    logical_key: string | null;
    artifact_version_id: string;
    version_number: number;
    media_type: string;
    stable_segment_id: string | null;
    exact_text: string;
    char_start: number | null;
    char_end: number | null;
    line_start: number | null;
    line_end: number | null;
    timestamp_start_ms: number | null;
    timestamp_end_ms: number | null;
  }>();

  const spanIds = (spans.results ?? []).map((row) => row.source_span_id);
  if (spanIds.length === 0) {
    // Also search assertion narratives for concept-linked content
    const assertionHits = await db.prepare(
      `SELECT sa.id AS assertion_id, sa.narrative, sa.predicate
         FROM semantic_assertions sa
        WHERE sa.workspace_person_id = ?1
          AND LOWER(sa.narrative) LIKE LOWER(?2) ESCAPE '\\'
        ORDER BY sa.observed_at DESC, sa.id
        LIMIT ?3`,
    ).bind(workspacePersonId, like, limit).all<{
      assertion_id: string;
      narrative: string;
      predicate: string;
    }>();

    const assertionIds = (assertionHits.results ?? []).map((row) => row.assertion_id);
    if (assertionIds.length === 0) return result;

    const aPlaceholders = assertionIds.map((_, i) => `?${i + 1}`).join(', ');
    const conceptRows = await db.prepare(
      `SELECT ac.assertion_id, c.canonical_key
         FROM assertion_concepts ac
         JOIN concepts c ON c.id = ac.concept_id
        WHERE ac.assertion_id IN (${aPlaceholders})`,
    ).bind(...assertionIds).all<{ assertion_id: string; canonical_key: string }>();

    const conceptsByAssertion = new Map<string, string[]>();
    for (const row of conceptRows.results ?? []) {
      const keys = conceptsByAssertion.get(row.assertion_id) ?? [];
      keys.push(row.canonical_key);
      conceptsByAssertion.set(row.assertion_id, keys);
    }

    const lowerQuery = trimmed.toLowerCase();
    result.hits = (assertionHits.results ?? []).map((row) => {
      const matchOffset = row.narrative.toLowerCase().indexOf(lowerQuery);
      return {
        sourceSpanId: '',
        artifactId: '',
        artifactType: 'assertion',
        artifactLogicalKey: null,
        artifactVersionId: '',
        artifactVersionNumber: 0,
        mediaType: 'text/plain',
        stableSegmentId: null,
        exactText: row.narrative,
        charStart: null,
        charEnd: null,
        lineStart: null,
        lineEnd: null,
        timestampStartMs: null,
        timestampEndMs: null,
        matchOffset: matchOffset >= 0 ? matchOffset : 0,
        matchLength: trimmed.length,
        citingAssertionIds: [row.assertion_id],
        citingContextRecordIds: [],
        conceptKeys: conceptsByAssertion.get(row.assertion_id) ?? [],
      };
    });

    return result;
  }

  const placeholders = spanIds.map((_, i) => `?${i + 1}`).join(', ');
  const [assertionLinks, contextRecordLinks, conceptLinks] = await Promise.all([
    db.prepare(
      `SELECT ass.source_span_id, ass.assertion_id
         FROM assertion_source_spans ass
        WHERE ass.source_span_id IN (${placeholders})`,
    ).bind(...spanIds).all<{ source_span_id: string; assertion_id: string }>(),
    db.prepare(
      `SELECT crsr.source_span_id, crsr.context_record_id
         FROM context_record_source_refs crsr
        WHERE crsr.source_span_id IN (${placeholders})`,
    ).bind(...spanIds).all<{ source_span_id: string; context_record_id: string }>(),
    db.prepare(
      `SELECT ass.source_span_id, c.canonical_key
         FROM assertion_source_spans ass
         JOIN assertion_concepts ac ON ac.assertion_id = ass.assertion_id
         JOIN concepts c ON c.id = ac.concept_id
        WHERE ass.source_span_id IN (${placeholders})`,
    ).bind(...spanIds).all<{ source_span_id: string; canonical_key: string }>(),
  ]);

  const assertionsBySpan = new Map<string, string[]>();
  for (const row of assertionLinks.results ?? []) {
    const ids = assertionsBySpan.get(row.source_span_id) ?? [];
    ids.push(row.assertion_id);
    assertionsBySpan.set(row.source_span_id, ids);
  }
  const contextRecordsBySpan = new Map<string, string[]>();
  for (const row of contextRecordLinks.results ?? []) {
    const ids = contextRecordsBySpan.get(row.source_span_id) ?? [];
    ids.push(row.context_record_id);
    contextRecordsBySpan.set(row.source_span_id, ids);
  }
  const conceptsBySpan = new Map<string, string[]>();
  for (const row of conceptLinks.results ?? []) {
    const keys = conceptsBySpan.get(row.source_span_id) ?? [];
    if (!keys.includes(row.canonical_key)) keys.push(row.canonical_key);
    conceptsBySpan.set(row.source_span_id, keys);
  }

  const lowerQuery = trimmed.toLowerCase();
  result.hits = (spans.results ?? []).map((row) => {
    const matchOffset = row.exact_text.toLowerCase().indexOf(lowerQuery);
    return {
      sourceSpanId: row.source_span_id,
      artifactId: row.artifact_id,
      artifactType: row.artifact_type,
      artifactLogicalKey: row.logical_key,
      artifactVersionId: row.artifact_version_id,
      artifactVersionNumber: row.version_number,
      mediaType: row.media_type,
      stableSegmentId: row.stable_segment_id,
      exactText: row.exact_text,
      charStart: row.char_start,
      charEnd: row.char_end,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      timestampStartMs: row.timestamp_start_ms,
      timestampEndMs: row.timestamp_end_ms,
      matchOffset: matchOffset >= 0 ? matchOffset : 0,
      matchLength: trimmed.length,
      citingAssertionIds: assertionsBySpan.get(row.source_span_id) ?? [],
      citingContextRecordIds: contextRecordsBySpan.get(row.source_span_id) ?? [],
      conceptKeys: conceptsBySpan.get(row.source_span_id) ?? [],
    };
  });

  return result;
}

// ─── Person Evidence Timeline ────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  timestamp: string;
  entryType: 'interaction' | 'assertion' | 'context_record' | 'artifact';
  interactionId: string | null;
  interactionType: string | null;
  narrative: string;
  concepts: string[];
  sourceCount: number;
  confidence: number | null;
}

export interface PersonEvidenceTimeline {
  workspacePersonId: string;
  totalEntries: number;
  entries: TimelineEntry[];
}

/**
 * Load a chronological timeline of evidence accumulation for a workspace person.
 * Merges interactions, assertions, and context records into a single time-ordered
 * feed, enabling visualization of how evidence builds over time (criterion #7).
 */
export async function loadPersonEvidenceTimeline(
  db: D1Database,
  workspacePersonId: string,
  options?: { limit?: number; before?: string; after?: string },
): Promise<PersonEvidenceTimeline> {
  const limit = Math.min(options?.limit ?? 100, 500);
  const entries: TimelineEntry[] = [];

  // 1. Interactions with their timestamps
  interface InteractionTimelineRow {
    id: string;
    interaction_type: string;
    started_at: string | null;
    ended_at: string | null;
    created_at: string;
    metadata_json: string;
  }

  const interactionRows = await db.prepare(
    `SELECT i.id, i.interaction_type, i.started_at, i.ended_at, i.created_at, i.metadata_json
       FROM interactions i
      WHERE i.workspace_person_id = ?1
      ORDER BY COALESCE(i.started_at, i.created_at) DESC
      LIMIT ?2`,
  ).bind(workspacePersonId, limit).all<InteractionTimelineRow>();

  for (const row of interactionRows.results ?? []) {
    const ts = row.started_at ?? row.created_at;
    if (options?.before && ts >= options.before) continue;
    if (options?.after && ts <= options.after) continue;

    let description = '';
    try {
      const meta: unknown = JSON.parse(row.metadata_json || '{}');
      if (meta && typeof meta === 'object' && 'description' in meta) {
        description = String((meta as Record<string, unknown>).description ?? '');
      }
    } catch { /* ignore */ }

    entries.push({
      id: row.id,
      timestamp: ts,
      entryType: 'interaction',
      interactionId: row.id,
      interactionType: row.interaction_type,
      narrative: description || `${row.interaction_type} interaction`,
      concepts: [],
      sourceCount: 0,
      confidence: null,
    });
  }

  // 2. Assertions with observation timestamps (join through episodes to get interaction)
  interface AssertionTimelineRow {
    id: string;
    interaction_id: string | null;
    interaction_type: string | null;
    predicate: string;
    narrative: string;
    confidence: number | null;
    observed_at: string | null;
    created_at: string;
    source_count: number;
  }

  const assertionRows = await db.prepare(
    `SELECT sa.id, e.interaction_id,
            i.interaction_type,
            sa.predicate, sa.narrative, sa.confidence,
            sa.observed_at, sa.created_at,
            (SELECT COUNT(*) FROM assertion_source_spans ass WHERE ass.assertion_id = sa.id) AS source_count
       FROM semantic_assertions sa
       LEFT JOIN episodes e ON e.id = sa.episode_id
       LEFT JOIN interactions i ON i.id = e.interaction_id
      WHERE sa.workspace_person_id = ?1
      ORDER BY COALESCE(sa.observed_at, sa.created_at) DESC
      LIMIT ?2`,
  ).bind(workspacePersonId, limit).all<AssertionTimelineRow>();

  for (const row of assertionRows.results ?? []) {
    const ts = row.observed_at ?? row.created_at;
    if (options?.before && ts >= options.before) continue;
    if (options?.after && ts <= options.after) continue;

    // Load concepts for this assertion
    interface ConceptKeyRow { canonical_key: string }
    const conceptRows = await db.prepare(
      `SELECT c.canonical_key
         FROM assertion_concepts ac
         JOIN concepts c ON c.id = ac.concept_id
        WHERE ac.assertion_id = ?1`,
    ).bind(row.id).all<ConceptKeyRow>();

    entries.push({
      id: row.id,
      timestamp: ts,
      entryType: 'assertion',
      interactionId: row.interaction_id,
      interactionType: row.interaction_type,
      narrative: row.narrative,
      concepts: (conceptRows.results ?? []).map((c) => c.canonical_key),
      sourceCount: row.source_count,
      confidence: row.confidence,
    });
  }

  // 3. Context records with observation timestamps
  interface ContextRecordTimelineRow {
    id: string;
    interaction_id: string | null;
    interaction_type: string | null;
    record_type: string;
    narrative: string;
    confidence: number | null;
    observed_at: string | null;
    created_at: string;
  }

  const contextRows = await db.prepare(
    `SELECT cr.id, cr.interaction_id,
            i.interaction_type,
            cr.record_type, cr.narrative, cr.confidence,
            cr.observed_at, cr.created_at
       FROM context_records cr
       LEFT JOIN interactions i ON i.id = cr.interaction_id
      WHERE cr.scope_type = 'workspace_person' AND cr.scope_id = ?1
      ORDER BY COALESCE(cr.observed_at, cr.created_at) DESC
      LIMIT ?2`,
  ).bind(workspacePersonId, limit).all<ContextRecordTimelineRow>();

  for (const row of contextRows.results ?? []) {
    const ts = row.observed_at ?? row.created_at;
    if (options?.before && ts >= options.before) continue;
    if (options?.after && ts <= options.after) continue;

    entries.push({
      id: row.id,
      timestamp: ts,
      entryType: 'context_record',
      interactionId: row.interaction_id,
      interactionType: row.interaction_type,
      narrative: row.narrative,
      concepts: [],
      sourceCount: 0,
      confidence: row.confidence,
    });
  }

  // Sort all entries chronologically (most recent first) and trim to limit
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const trimmedEntries = entries.slice(0, limit);

  return {
    workspacePersonId,
    totalEntries: trimmedEntries.length,
    entries: trimmedEntries,
  };
}
