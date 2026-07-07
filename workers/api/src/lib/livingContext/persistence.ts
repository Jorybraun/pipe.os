import type {
  ApplicationInput,
  ArtifactInput,
  ArtifactVersionInput,
  ContextRecordInput,
  ConceptInput,
  EpisodeInput,
  InteractionInput,
  JsonValue,
  PersonInput,
  PersonRoleInput,
  PersistedEntity,
  ProjectionJobInput,
  SemanticAssertionInput,
  SemanticRelationshipInput,
  SignalEvidenceInput,
  SignalSnapshotInput,
  SourceSpanInput,
  WorkspacePersonInput,
} from './types';

type Clock = () => string;

const CONTEXT_RECORD_RELATIONSHIP_BATCH_SIZE = 50;

interface ImmutableArtifactVersionRow {
  id: string;
  artifact_id: string;
  version_number: number;
  content_hash: string;
  media_type: string;
  content_text: string | null;
  storage_key: string | null;
  byte_length: number | null;
  metadata_json: string;
}

interface ImmutableSourceSpanRow {
  id: string;
  artifact_version_id: string;
  stable_segment_id: string | null;
  byte_start: number | null;
  byte_end: number | null;
  char_start: number | null;
  char_end: number | null;
  line_start: number | null;
  line_end: number | null;
  timestamp_start_ms: number | null;
  timestamp_end_ms: number | null;
  exact_text: string;
  exact_text_hash: string;
  metadata_json: string;
}

function normalizeJson(value: JsonValue | undefined, fallback: JsonValue): JsonValue {
  return value === undefined ? fallback : value;
}

export function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function deterministicEntityId(
  entityType: string,
  ingestionKey: string,
): Promise<string> {
  const digest = await sha256(`${entityType}\u0000${ingestionKey}`);
  return `${entityType}_${digest.slice(0, 32)}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return (left ?? null) === (right ?? null);
}

function assertImmutableReplay(
  entity: string,
  ingestionKey: string,
  checks: Array<[string, unknown, unknown]>,
): void {
  const mismatch = checks.find(([, actual, expected]) => !sameValue(actual, expected));
  if (mismatch) {
    throw new Error(
      `${entity} ingestion key "${ingestionKey}" was replayed with different ${mismatch[0]}`,
    );
  }
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  return trimmed;
}

function requireScore(value: number | null | undefined, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be between 0 and 1`);
  }
  return value;
}

function requirePolarity(value: number | undefined): number {
  const polarity = value ?? 1;
  if (!Number.isFinite(polarity) || polarity < -1 || polarity > 1) {
    throw new Error('polarity must be between -1 and 1');
  }
  return polarity;
}

interface PreparedContextRecordSource {
  sourceSpanId: string | null;
  sourceRefType: string;
  sourceRefId: string;
  evidenceRole: string;
  locatorJson: string;
  exactText: string | null;
  contentHash: string | null;
  metadataJson: string;
}

interface PreparedContextRecordEntity {
  entityKey: string;
  entityType: string;
  entityId: string | null;
  relationship: string;
  valueJson: string | null;
  confidence: number | null;
  metadataJson: string;
}

interface PreparedContextRecordConcept {
  conceptId: string;
  relationship: string;
  weight: number;
}

function optionalNonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

async function requireRow(
  db: D1Database,
  sql: string,
  bindings: unknown[],
  label: string,
): Promise<void> {
  const row = await db.prepare(sql).bind(...bindings).first<{ id: string }>();
  if (!row) throw new Error(`${label} does not exist`);
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND name = ?1`,
  ).bind(tableName).first<{ name: string }>();
  return row !== null && row !== undefined;
}

async function runStatementBatches(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  const batchRunner = typeof db.batch === 'function'
    ? db.batch.bind(db)
    : null;

  for (let index = 0; index < statements.length; index += CONTEXT_RECORD_RELATIONSHIP_BATCH_SIZE) {
    const batch = statements.slice(index, index + CONTEXT_RECORD_RELATIONSHIP_BATCH_SIZE);
    if (batch.length > 0) {
      if (batchRunner) {
        await batchRunner(batch);
      } else {
        for (const statement of batch) {
          await statement.run();
        }
      }
    }
  }
}

async function requireSourceSpanForWorkspacePerson(
  db: D1Database,
  sourceSpanId: string,
  workspacePersonId: string,
): Promise<void> {
  const direct = await db.prepare(
    `SELECT ss.id
       FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
      WHERE ss.id = ?1
        AND a.workspace_person_id = ?2`,
  ).bind(sourceSpanId, workspacePersonId).first<{ id: string }>();
  if (direct) return;

  const hasArtifactInteractions = await db.prepare(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'artifact_interactions'`,
  ).first<{ name: string }>();
  if (hasArtifactInteractions) {
    const linked = await db.prepare(
      `SELECT ss.id
         FROM source_spans ss
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
         JOIN artifact_interactions ai ON ai.artifact_id = a.id
         JOIN interactions i ON i.id = ai.interaction_id
        WHERE ss.id = ?1
          AND i.workspace_person_id = ?2`,
    ).bind(sourceSpanId, workspacePersonId).first<{ id: string }>();
    if (linked) return;
  }

  throw new Error(`source span ${sourceSpanId} for workspace person ${workspacePersonId} does not exist`);
}

async function requireContextSourceRef(
  db: D1Database,
  source: PreparedContextRecordSource,
): Promise<void> {
  if (source.sourceRefType === 'source_span') {
    await requireRow(
      db,
      'SELECT id FROM source_spans WHERE id = ?1',
      [source.sourceRefId],
      `source span ${source.sourceRefId}`,
    );
    return;
  }
  if (source.sourceRefType === 'artifact_version') {
    const row = await db.prepare(
      'SELECT id, content_hash, content_text FROM artifact_versions WHERE id = ?1',
    ).bind(source.sourceRefId).first<{
      id: string;
      content_hash: string;
      content_text: string | null;
    }>();
    if (!row) throw new Error(`artifact version ${source.sourceRefId} does not exist`);
    if (source.contentHash !== null && source.contentHash !== row.content_hash) {
      throw new Error(`artifact version ${source.sourceRefId} contentHash does not match`);
    }
    if (source.exactText !== null && row.content_text !== null && source.exactText !== row.content_text) {
      throw new Error(`artifact version ${source.sourceRefId} exactText does not match`);
    }
    return;
  }
  if (source.sourceRefType === 'repo_source_span') {
    const row = await db.prepare(
      'SELECT id, exact_text, content_hash FROM repo_source_spans WHERE id = ?1',
    ).bind(source.sourceRefId).first<{
      id: string;
      exact_text: string;
      content_hash: string;
    }>();
    if (!row) throw new Error(`repo source span ${source.sourceRefId} does not exist`);
    if (source.exactText !== null && source.exactText !== row.exact_text) {
      throw new Error(`repo source span ${source.sourceRefId} exactText does not match`);
    }
    if (source.contentHash !== null && source.contentHash !== row.content_hash) {
      throw new Error(`repo source span ${source.sourceRefId} contentHash does not match`);
    }
    return;
  }
  if (source.sourceRefType === 'review_challenge_packet') {
    if (!await tableExists(db, 'review_challenge_packets')) return;
    const row = await db.prepare(
      'SELECT id, source_hash, packet_json FROM review_challenge_packets WHERE id = ?1',
    ).bind(source.sourceRefId).first<{
      id: string;
      source_hash: string;
      packet_json: string;
    }>();
    if (!row) throw new Error(`review challenge packet ${source.sourceRefId} does not exist`);
    if (source.contentHash === null) {
      throw new Error(`review challenge packet ${source.sourceRefId} contentHash is required`);
    }
    if (source.contentHash !== row.source_hash) {
      throw new Error(`review challenge packet ${source.sourceRefId} contentHash does not match`);
    }
    if (source.exactText !== null && source.exactText !== row.packet_json) {
      throw new Error(`review challenge packet ${source.sourceRefId} exactText does not match`);
    }
    return;
  }
  if (source.sourceRefType === 'repo_issue') {
    const row = await db.prepare(
      'SELECT id, body FROM repo_issues WHERE id = ?1',
    ).bind(source.sourceRefId).first<{
      id: number;
      body: string | null;
    }>();
    if (!row) throw new Error(`repo issue ${source.sourceRefId} does not exist`);
    const body = row.body ?? '';
    if (!body.trim()) {
      throw new Error(`repo issue ${source.sourceRefId} body is required`);
    }
    if (source.exactText === null) {
      throw new Error(`repo issue ${source.sourceRefId} exactText is required`);
    }
    if (source.exactText !== body) {
      throw new Error(`repo issue ${source.sourceRefId} exactText does not match`);
    }
    if (source.contentHash === null) {
      throw new Error(`repo issue ${source.sourceRefId} contentHash is required`);
    }
    if (source.contentHash !== await sha256(body)) {
      throw new Error(`repo issue ${source.sourceRefId} contentHash does not match`);
    }
    return;
  }
  if (source.sourceRefType === 'match_run') {
    await requireRow(
      db,
      'SELECT id FROM match_runs WHERE id = ?1',
      [source.sourceRefId],
      `match run ${source.sourceRefId}`,
    );
    return;
  }
  if (source.sourceRefType === 'role_context') {
    await requireRow(
      db,
      'SELECT id FROM role_contexts WHERE id = ?1',
      [source.sourceRefId],
      `role context ${source.sourceRefId}`,
    );
    return;
  }
  if (source.sourceRefType === 'role_source') {
    const locator = JSON.parse(source.locatorJson) as { roleContextId?: unknown };
    const roleContextId = typeof locator.roleContextId === 'string'
      ? locator.roleContextId.trim()
      : '';
    if (!roleContextId) {
      throw new Error(`role source ${source.sourceRefId} requires roleContextId`);
    }
    await requireRow(
      db,
      'SELECT id FROM role_contexts WHERE id = ?1',
      [roleContextId],
      `role context ${roleContextId}`,
    );
    return;
  }
  if (
    source.locatorJson === '{}'
    && source.exactText === null
    && source.contentHash === null
  ) {
    throw new Error(
      `source ref ${source.sourceRefType}:${source.sourceRefId} requires locator, exactText, or contentHash`,
    );
  }
}

export class LivingContextStore {
  constructor(
    private readonly db: D1Database,
    private readonly clock: Clock = () => new Date().toISOString(),
  ) {}

  private async id(entityType: string, ingestionKey: string): Promise<string> {
    return deterministicEntityId(entityType, ingestionKey);
  }

  async upsertPerson(input: PersonInput): Promise<PersistedEntity> {
    const id = await this.id('person', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO people (
         id, ingestion_key, display_name, primary_email, primary_phone,
         external_ids_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, people.display_name),
         primary_email = COALESCE(excluded.primary_email, people.primary_email),
         primary_phone = COALESCE(excluded.primary_phone, people.primary_phone),
         external_ids_json = json_patch(people.external_ids_json, excluded.external_ids_json),
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.displayName ?? null,
      input.primaryEmail?.trim().toLowerCase() ?? null,
      input.primaryPhone ?? null,
      stableJson(normalizeJson(input.externalIds, {})),
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async upsertWorkspacePerson(input: WorkspacePersonInput): Promise<PersistedEntity> {
    const id = await this.id('workspace_person', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO workspace_people (
         id, ingestion_key, workspace_id, person_id, relationship_summary,
         context_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         relationship_summary = excluded.relationship_summary,
         context_json = json_patch(workspace_people.context_json, excluded.context_json),
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.workspaceId,
      input.personId,
      input.relationshipSummary ?? null,
      stableJson(normalizeJson(input.context, {})),
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async upsertApplication(input: ApplicationInput): Promise<PersistedEntity> {
    const existingByCandidate = input.legacyCandidateId
      ? await this.db.prepare(
          `SELECT id, ingestion_key
             FROM applications
            WHERE legacy_candidate_id = ?1
            LIMIT 1`,
        ).bind(input.legacyCandidateId).first<{ id: string; ingestion_key: string }>()
      : null;
    const ingestionKey = existingByCandidate?.ingestion_key ?? input.ingestionKey;
    const id = existingByCandidate?.id ?? await this.id('application', ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO applications (
         id, ingestion_key, workspace_person_id, legacy_candidate_id,
         pipeline_id, status, context_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         workspace_person_id = excluded.workspace_person_id,
         legacy_candidate_id = excluded.legacy_candidate_id,
         pipeline_id = excluded.pipeline_id,
         status = excluded.status,
         context_json = excluded.context_json,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      ingestionKey,
      input.workspacePersonId,
      input.legacyCandidateId ?? null,
      input.pipelineId ?? null,
      input.status ?? null,
      stableJson(normalizeJson(input.context, {})),
      now,
    ).run();
    return { id, ingestionKey };
  }

  async upsertPersonRole(input: PersonRoleInput): Promise<PersistedEntity> {
    const id = await this.id('person_role', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO person_roles (
         id, ingestion_key, workspace_person_id, application_id, role_type,
         label, attributes_json, active_from, active_to, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         application_id = excluded.application_id,
         role_type = excluded.role_type,
         label = excluded.label,
         attributes_json = excluded.attributes_json,
         active_from = excluded.active_from,
         active_to = excluded.active_to,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.workspacePersonId,
      input.applicationId ?? null,
      input.roleType,
      input.label ?? null,
      stableJson(normalizeJson(input.attributes, {})),
      input.activeFrom ?? null,
      input.activeTo ?? null,
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async upsertInteraction(input: InteractionInput): Promise<PersistedEntity> {
    const id = await this.id('interaction', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO interactions (
         id, ingestion_key, workspace_person_id, application_id,
         interaction_type, external_reference, started_at, ended_at,
         metadata_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         application_id = excluded.application_id,
         interaction_type = excluded.interaction_type,
         external_reference = excluded.external_reference,
         started_at = COALESCE(excluded.started_at, interactions.started_at),
         ended_at = COALESCE(excluded.ended_at, interactions.ended_at),
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.workspacePersonId,
      input.applicationId ?? null,
      input.interactionType,
      input.externalReference ?? null,
      input.startedAt ?? null,
      input.endedAt ?? null,
      stableJson(normalizeJson(input.metadata, {})),
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async upsertArtifact(input: ArtifactInput): Promise<PersistedEntity> {
    const id = await this.id('artifact', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO artifacts (
         id, ingestion_key, workspace_person_id, interaction_id, artifact_type,
         logical_key, metadata_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         workspace_person_id = excluded.workspace_person_id,
         interaction_id = excluded.interaction_id,
         artifact_type = excluded.artifact_type,
         logical_key = excluded.logical_key,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.workspacePersonId ?? null,
      input.interactionId ?? null,
      input.artifactType,
      input.logicalKey ?? null,
      stableJson(normalizeJson(input.metadata, {})),
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async createArtifactVersion(input: ArtifactVersionInput): Promise<PersistedEntity> {
    const id = await this.id('artifact_version', input.ingestionKey);
    const now = this.clock();
    const metadataJson = stableJson(normalizeJson(input.metadata, {}));
    await this.db.prepare(
      `INSERT INTO artifact_versions (
         id, ingestion_key, artifact_id, version_number, content_hash,
         media_type, content_text, storage_key, byte_length, metadata_json, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(ingestion_key) DO NOTHING`,
    ).bind(
      id,
      input.ingestionKey,
      input.artifactId,
      input.versionNumber,
      input.contentHash,
      input.mediaType,
      input.contentText ?? null,
      input.storageKey ?? null,
      input.byteLength ?? null,
      metadataJson,
      now,
    ).run();

    const row = await this.db.prepare(
      `SELECT id, artifact_id, version_number, content_hash, media_type,
              content_text, storage_key, byte_length, metadata_json
         FROM artifact_versions WHERE ingestion_key = ?1`,
    ).bind(input.ingestionKey).first<ImmutableArtifactVersionRow>();
    if (!row) throw new Error(`Artifact version "${input.ingestionKey}" was not persisted`);
    assertImmutableReplay('Artifact version', input.ingestionKey, [
      ['artifact_id', row.artifact_id, input.artifactId],
      ['version_number', row.version_number, input.versionNumber],
      ['content_hash', row.content_hash, input.contentHash],
      ['media_type', row.media_type, input.mediaType],
      ['content_text', row.content_text, input.contentText],
      ['storage_key', row.storage_key, input.storageKey],
      ['byte_length', row.byte_length, input.byteLength],
      ['metadata_json', row.metadata_json, metadataJson],
    ]);
    return { id: row.id, ingestionKey: input.ingestionKey };
  }

  async createSourceSpan(input: SourceSpanInput): Promise<PersistedEntity> {
    const id = await this.id('source_span', input.ingestionKey);
    const now = this.clock();
    const exactTextHash = input.exactTextHash ?? await sha256(input.exactText);
    const metadataJson = stableJson(normalizeJson(input.metadata, {}));
    await this.db.prepare(
      `INSERT INTO source_spans (
         id, ingestion_key, artifact_version_id, stable_segment_id,
         byte_start, byte_end, char_start, char_end, line_start, line_end,
         timestamp_start_ms, timestamp_end_ms, exact_text, exact_text_hash,
         metadata_json, created_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
       ) ON CONFLICT(ingestion_key) DO NOTHING`,
    ).bind(
      id,
      input.ingestionKey,
      input.artifactVersionId,
      input.stableSegmentId ?? null,
      input.byteStart ?? null,
      input.byteEnd ?? null,
      input.charStart ?? null,
      input.charEnd ?? null,
      input.lineStart ?? null,
      input.lineEnd ?? null,
      input.timestampStartMs ?? null,
      input.timestampEndMs ?? null,
      input.exactText,
      exactTextHash,
      metadataJson,
      now,
    ).run();

    const row = await this.db.prepare(
      `SELECT id, artifact_version_id, stable_segment_id, byte_start, byte_end,
              char_start, char_end, line_start, line_end, timestamp_start_ms,
              timestamp_end_ms, exact_text, exact_text_hash, metadata_json
         FROM source_spans WHERE ingestion_key = ?1`,
    ).bind(input.ingestionKey).first<ImmutableSourceSpanRow>();
    if (!row) throw new Error(`Source span "${input.ingestionKey}" was not persisted`);
    assertImmutableReplay('Source span', input.ingestionKey, [
      ['artifact_version_id', row.artifact_version_id, input.artifactVersionId],
      ['stable_segment_id', row.stable_segment_id, input.stableSegmentId],
      ['byte_start', row.byte_start, input.byteStart],
      ['byte_end', row.byte_end, input.byteEnd],
      ['char_start', row.char_start, input.charStart],
      ['char_end', row.char_end, input.charEnd],
      ['line_start', row.line_start, input.lineStart],
      ['line_end', row.line_end, input.lineEnd],
      ['timestamp_start_ms', row.timestamp_start_ms, input.timestampStartMs],
      ['timestamp_end_ms', row.timestamp_end_ms, input.timestampEndMs],
      ['exact_text', row.exact_text, input.exactText],
      ['exact_text_hash', row.exact_text_hash, exactTextHash],
      ['metadata_json', row.metadata_json, metadataJson],
    ]);
    return { id: row.id, ingestionKey: input.ingestionKey };
  }

  async upsertEpisode(input: EpisodeInput): Promise<PersistedEntity> {
    const id = await this.id('episode', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO episodes (
         id, ingestion_key, workspace_person_id, interaction_id, narrative,
         started_at, ended_at, metadata_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         interaction_id = excluded.interaction_id,
         narrative = excluded.narrative,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.workspacePersonId,
      input.interactionId ?? null,
      input.narrative ?? null,
      input.startedAt ?? null,
      input.endedAt ?? null,
      stableJson(normalizeJson(input.metadata, {})),
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async upsertAssertion(input: SemanticAssertionInput): Promise<PersistedEntity> {
    const id = await this.id('assertion', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO semantic_assertions (
         id, ingestion_key, workspace_person_id, episode_id, subject_type,
         subject_id, predicate, object_type, object_id, object_value_json,
         narrative, qualifiers_json, confidence, polarity, extraction_version,
         observed_at, created_at, updated_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17
       ) ON CONFLICT(ingestion_key) DO UPDATE SET
         episode_id = excluded.episode_id,
         subject_type = excluded.subject_type,
         subject_id = excluded.subject_id,
         predicate = excluded.predicate,
         object_type = excluded.object_type,
         object_id = excluded.object_id,
         object_value_json = excluded.object_value_json,
         narrative = excluded.narrative,
         qualifiers_json = excluded.qualifiers_json,
         confidence = excluded.confidence,
         polarity = excluded.polarity,
         extraction_version = excluded.extraction_version,
         observed_at = excluded.observed_at,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.workspacePersonId,
      input.episodeId ?? null,
      input.subjectType,
      input.subjectId ?? null,
      input.predicate,
      input.objectType ?? null,
      input.objectId ?? null,
      input.objectValue === undefined ? null : stableJson(input.objectValue),
      input.narrative,
      stableJson(normalizeJson(input.qualifiers, {})),
      input.confidence ?? null,
      input.polarity ?? 1,
      input.extractionVersion ?? null,
      input.observedAt ?? null,
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async upsertContextRecord(input: ContextRecordInput): Promise<PersistedEntity> {
    if (!Array.isArray(input.sources) || input.sources.length === 0) {
      throw new Error('Context record requires at least one source span or source ref');
    }
    const id = await this.id('context_record', input.ingestionKey);
    const now = this.clock();
    const workspacePersonId = optionalNonEmpty(input.workspacePersonId);
    const scopeType = requireNonEmpty(
      input.scopeType ?? (workspacePersonId ? 'workspace_person' : ''),
      'scopeType',
    );
    const scopeId = requireNonEmpty(input.scopeId ?? workspacePersonId ?? '', 'scopeId');
    if (scopeType === 'workspace_person' && !workspacePersonId) {
      throw new Error('workspacePersonId is required for workspace_person context records');
    }
    const recordType = requireNonEmpty(input.recordType, 'recordType');
    const narrative = requireNonEmpty(input.narrative, 'narrative');
    const predicate = input.predicate?.trim() || null;
    const confidence = requireScore(input.confidence, 'confidence');
    const polarity = requirePolarity(input.polarity);

    const sourceKeys = new Set<string>();
    const sources: PreparedContextRecordSource[] = [];
    for (const source of input.sources) {
      const sourceSpanId = optionalNonEmpty(source.sourceSpanId);
      const explicitRefType = optionalNonEmpty(source.sourceRefType);
      if (sourceSpanId && explicitRefType && explicitRefType !== 'source_span') {
        throw new Error('sourceSpanId can only be used with sourceRefType source_span');
      }
      const sourceRefType = requireNonEmpty(
        explicitRefType ?? (sourceSpanId ? 'source_span' : ''),
        'sourceRefType',
      );
      const sourceRefId = requireNonEmpty(source.sourceRefId ?? sourceSpanId ?? '', 'sourceRefId');
      const evidenceRole = source.evidenceRole?.trim() || 'support';
      const key = `${sourceRefType}\u0000${sourceRefId}\u0000${evidenceRole}`;
      if (sourceKeys.has(key)) continue;
      sourceKeys.add(key);
      sources.push({
        sourceSpanId,
        sourceRefType,
        sourceRefId,
        evidenceRole,
        locatorJson: stableJson(normalizeJson(source.locator, {})),
        exactText: source.exactText ?? null,
        contentHash: source.contentHash?.trim() || null,
        metadataJson: stableJson(normalizeJson(source.metadata, {})),
      });
    }
    if (sources.length === 0) {
      throw new Error('Context record requires at least one source span or source ref');
    }

    const entityKeys = new Set<string>();
    const entities: PreparedContextRecordEntity[] = [];
    for (const entity of input.entities ?? []) {
      const entityType = requireNonEmpty(entity.entityType, 'entityType');
      const relationship = requireNonEmpty(entity.relationship, 'entity relationship');
      const entityId = entity.entityId?.trim() || null;
      if (!entityId && entity.value === undefined) {
        throw new Error('Context record entity requires entityId or value');
      }
      const valueJson = entity.value === undefined ? null : stableJson(entity.value);
      const entityKey = `${entityType}\u0000${entityId ?? valueJson}`;
      const key = `${entityKey}\u0000${relationship}`;
      if (entityKeys.has(key)) continue;
      entityKeys.add(key);
      entities.push({
        entityKey,
        entityType,
        entityId,
        relationship,
        valueJson,
        confidence: requireScore(entity.confidence, 'entity confidence'),
        metadataJson: stableJson(normalizeJson(entity.metadata, {})),
      });
    }

    const conceptKeys = new Set<string>();
    const concepts: PreparedContextRecordConcept[] = [];
    for (const concept of input.concepts ?? []) {
      const conceptId = requireNonEmpty(concept.conceptId, 'conceptId');
      const relationship = requireNonEmpty(concept.relationship, 'concept relationship');
      const weight = requireScore(concept.weight ?? 1, 'concept weight') ?? 1;
      const key = `${conceptId}\u0000${relationship}`;
      if (conceptKeys.has(key)) continue;
      conceptKeys.add(key);
      concepts.push({ conceptId, relationship, weight });
    }

    if (workspacePersonId) {
      await requireRow(
        this.db,
        'SELECT id FROM workspace_people WHERE id = ?1',
        [workspacePersonId],
        `workspace person ${workspacePersonId}`,
      );
    }
    if (input.interactionId) {
      if (!workspacePersonId) throw new Error('workspacePersonId is required with interactionId');
      await requireRow(
        this.db,
        'SELECT id FROM interactions WHERE id = ?1 AND workspace_person_id = ?2',
        [input.interactionId, workspacePersonId],
        `interaction ${input.interactionId}`,
      );
    }
    if (input.applicationId) {
      if (!workspacePersonId) throw new Error('workspacePersonId is required with applicationId');
      await requireRow(
        this.db,
        'SELECT id FROM applications WHERE id = ?1 AND workspace_person_id = ?2',
        [input.applicationId, workspacePersonId],
        `application ${input.applicationId}`,
      );
    }
    if (input.episodeId) {
      if (!workspacePersonId) throw new Error('workspacePersonId is required with episodeId');
      await requireRow(
        this.db,
        'SELECT id FROM episodes WHERE id = ?1 AND workspace_person_id = ?2',
        [input.episodeId, workspacePersonId],
        `episode ${input.episodeId}`,
      );
    }
    if (input.assertionId) {
      if (!workspacePersonId) throw new Error('workspacePersonId is required with assertionId');
      await requireRow(
        this.db,
        'SELECT id FROM semantic_assertions WHERE id = ?1 AND workspace_person_id = ?2',
        [input.assertionId, workspacePersonId],
        `semantic assertion ${input.assertionId}`,
      );
    }
    for (const source of sources) {
      if (source.sourceSpanId && workspacePersonId) {
        await requireSourceSpanForWorkspacePerson(
          this.db,
          source.sourceSpanId,
          workspacePersonId,
        );
      } else {
        await requireContextSourceRef(this.db, source);
      }
    }
    for (const concept of concepts) {
      await requireRow(
        this.db,
        'SELECT id FROM concepts WHERE id = ?1',
        [concept.conceptId],
        `concept ${concept.conceptId}`,
      );
    }

    await this.db.prepare(
      `INSERT INTO context_records (
         id, ingestion_key, scope_type, scope_id, workspace_person_id,
         interaction_id, application_id, episode_id, assertion_id, record_type,
         predicate, narrative, qualifiers_json, confidence, polarity,
         extraction_version, observed_at, created_at, updated_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18
       ) ON CONFLICT(ingestion_key) DO UPDATE SET
         scope_type = excluded.scope_type,
         scope_id = excluded.scope_id,
         workspace_person_id = excluded.workspace_person_id,
         interaction_id = excluded.interaction_id,
         application_id = excluded.application_id,
         episode_id = excluded.episode_id,
         assertion_id = excluded.assertion_id,
         record_type = excluded.record_type,
         predicate = excluded.predicate,
         narrative = excluded.narrative,
         qualifiers_json = excluded.qualifiers_json,
         confidence = excluded.confidence,
         polarity = excluded.polarity,
         extraction_version = excluded.extraction_version,
         observed_at = excluded.observed_at,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      scopeType,
      scopeId,
      workspacePersonId,
      input.interactionId ?? null,
      input.applicationId ?? null,
      input.episodeId ?? null,
      input.assertionId ?? null,
      recordType,
      predicate,
      narrative,
      stableJson(normalizeJson(input.qualifiers, {})),
      confidence,
      polarity,
      input.extractionVersion ?? null,
      input.observedAt ?? null,
      now,
    ).run();

    await runStatementBatches(this.db, [
      this.db.prepare(
        'DELETE FROM context_record_source_refs WHERE context_record_id = ?1',
      ).bind(id),
      this.db.prepare(
        'DELETE FROM context_record_source_spans WHERE context_record_id = ?1',
      ).bind(id),
      this.db.prepare(
        'DELETE FROM context_record_entities WHERE context_record_id = ?1',
      ).bind(id),
      this.db.prepare(
        'DELETE FROM context_record_concepts WHERE context_record_id = ?1',
      ).bind(id),
    ]);

    const sourceRefStatements: D1PreparedStatement[] = [];
    const sourceSpanStatements: D1PreparedStatement[] = [];
    for (const source of sources) {
      sourceRefStatements.push(this.db.prepare(
        `INSERT INTO context_record_source_refs (
           context_record_id, source_ref_type, source_ref_id, source_span_id,
           evidence_role, locator_json, exact_text, content_hash, metadata_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(context_record_id, source_ref_type, source_ref_id, evidence_role)
         DO UPDATE SET
           source_span_id = excluded.source_span_id,
           locator_json = excluded.locator_json,
           exact_text = excluded.exact_text,
           content_hash = excluded.content_hash,
           metadata_json = excluded.metadata_json`,
      ).bind(
        id,
        source.sourceRefType,
        source.sourceRefId,
        source.sourceSpanId,
        source.evidenceRole,
        source.locatorJson,
        source.exactText,
        source.contentHash,
        source.metadataJson,
        now,
      ));
      if (source.sourceSpanId) {
        sourceSpanStatements.push(this.db.prepare(
          `INSERT INTO context_record_source_spans (
             context_record_id, source_span_id, evidence_role, created_at
           ) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(context_record_id, source_span_id, evidence_role)
           DO UPDATE SET created_at = excluded.created_at`,
        ).bind(id, source.sourceSpanId, source.evidenceRole, now));
      }
    }
    await runStatementBatches(this.db, sourceRefStatements);
    await runStatementBatches(this.db, sourceSpanStatements);

    const entityStatements: D1PreparedStatement[] = [];
    for (const entity of entities) {
      entityStatements.push(this.db.prepare(
        `INSERT INTO context_record_entities (
           context_record_id, entity_key, entity_type, entity_id, relationship,
           value_json, confidence, metadata_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(context_record_id, entity_key, relationship)
         DO UPDATE SET
           entity_type = excluded.entity_type,
           entity_id = excluded.entity_id,
           value_json = excluded.value_json,
           confidence = excluded.confidence,
           metadata_json = excluded.metadata_json`,
      ).bind(
        id,
        entity.entityKey,
        entity.entityType,
        entity.entityId,
        entity.relationship,
        entity.valueJson,
        entity.confidence,
        entity.metadataJson,
        now,
      ));
    }
    await runStatementBatches(this.db, entityStatements);

    const conceptStatements: D1PreparedStatement[] = [];
    for (const concept of concepts) {
      conceptStatements.push(this.db.prepare(
        `INSERT INTO context_record_concepts (
           context_record_id, concept_id, relationship, weight, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(context_record_id, concept_id, relationship)
         DO UPDATE SET weight = excluded.weight`,
      ).bind(id, concept.conceptId, concept.relationship, concept.weight, now));
    }
    await runStatementBatches(this.db, conceptStatements);

    return { id, ingestionKey: input.ingestionKey };
  }

  async linkAssertionSourceSpan(
    assertionId: string,
    sourceSpanId: string,
    evidenceRole = 'support',
  ): Promise<void> {
    await this.db.prepare(
      `INSERT INTO assertion_source_spans (
         assertion_id, source_span_id, evidence_role, created_at
       ) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(assertion_id, source_span_id, evidence_role) DO NOTHING`,
    ).bind(assertionId, sourceSpanId, evidenceRole, this.clock()).run();
  }

  async upsertConcept(input: ConceptInput): Promise<PersistedEntity> {
    const id = await this.id('concept', input.ingestionKey);
    const now = this.clock();
    const existing = await this.db.prepare(
      'SELECT id, ingestion_key FROM concepts WHERE canonical_key = ?1',
    ).bind(input.canonicalKey).first<{ id: string; ingestion_key: string }>();
    if (existing) {
      await this.db.prepare(
        `UPDATE concepts
            SET namespace = ?2,
                label = ?3,
                description = ?4,
                aliases_json = ?5,
                metadata_json = ?6,
                updated_at = ?7
          WHERE id = ?1`,
      ).bind(
        existing.id,
        input.namespace,
        input.label,
        input.description ?? null,
        stableJson(input.aliases ?? []),
        stableJson(normalizeJson(input.metadata, {})),
        now,
      ).run();
      return { id: existing.id, ingestionKey: existing.ingestion_key };
    }
    await this.db.prepare(
      `INSERT INTO concepts (
         id, ingestion_key, canonical_key, namespace, label, description,
         aliases_json, metadata_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         canonical_key = excluded.canonical_key,
         namespace = excluded.namespace,
         label = excluded.label,
         description = excluded.description,
         aliases_json = excluded.aliases_json,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.canonicalKey,
      input.namespace,
      input.label,
      input.description ?? null,
      stableJson(input.aliases ?? []),
      stableJson(normalizeJson(input.metadata, {})),
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async linkAssertionConcept(
    assertionId: string,
    conceptId: string,
    relationship = 'about',
    weight = 1,
  ): Promise<void> {
    await this.db.prepare(
      `INSERT INTO assertion_concepts (
         assertion_id, concept_id, relationship, weight, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(assertion_id, concept_id, relationship) DO UPDATE SET
         weight = excluded.weight`,
    ).bind(assertionId, conceptId, relationship, weight, this.clock()).run();
  }

  async upsertSignalEvidence(input: SignalEvidenceInput): Promise<PersistedEntity> {
    const id = await this.id('signal_evidence', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO signal_evidence (
         id, ingestion_key, workspace_person_id, interaction_id, assertion_id,
         concept_id, signal_key, evidence_level, strength, polarity,
         observed_at, metadata_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         interaction_id = excluded.interaction_id,
         assertion_id = excluded.assertion_id,
         concept_id = excluded.concept_id,
         signal_key = excluded.signal_key,
         evidence_level = excluded.evidence_level,
         strength = excluded.strength,
         polarity = excluded.polarity,
         observed_at = excluded.observed_at,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.workspacePersonId,
      input.interactionId ?? null,
      input.assertionId,
      input.conceptId ?? null,
      input.signalKey,
      input.evidenceLevel,
      input.strength,
      input.polarity ?? 1,
      input.observedAt ?? null,
      stableJson(normalizeJson(input.metadata, {})),
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async upsertSignalSnapshot(input: SignalSnapshotInput): Promise<PersistedEntity> {
    const id = await this.id('signal_snapshot', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO signal_snapshots (
         id, ingestion_key, workspace_person_id, signal_key, interaction_id,
         as_of, conversation_score, total_score, confidence, evidence_count,
         source_diversity, dimensions_json, policy_version, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         interaction_id = excluded.interaction_id,
         as_of = excluded.as_of,
         conversation_score = excluded.conversation_score,
         total_score = excluded.total_score,
         confidence = excluded.confidence,
         evidence_count = excluded.evidence_count,
         source_diversity = excluded.source_diversity,
         dimensions_json = excluded.dimensions_json,
         policy_version = excluded.policy_version,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.workspacePersonId,
      input.signalKey,
      input.interactionId ?? null,
      input.asOf,
      input.conversationScore ?? null,
      input.totalScore,
      input.confidence,
      input.evidenceCount,
      input.sourceDiversity,
      stableJson(normalizeJson(input.dimensions, {})),
      input.policyVersion,
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async upsertSemanticRelationship(
    input: SemanticRelationshipInput,
  ): Promise<PersistedEntity> {
    const id = await this.id('semantic_relationship', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO semantic_relationships (
         id, ingestion_key, workspace_person_id, from_entity_type,
         from_entity_id, predicate, to_entity_type, to_entity_id,
         to_value_json, qualifiers_json, confidence, source_assertion_id,
         created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         from_entity_type = excluded.from_entity_type,
         from_entity_id = excluded.from_entity_id,
         predicate = excluded.predicate,
         to_entity_type = excluded.to_entity_type,
         to_entity_id = excluded.to_entity_id,
         to_value_json = excluded.to_value_json,
         qualifiers_json = excluded.qualifiers_json,
         confidence = excluded.confidence,
         source_assertion_id = excluded.source_assertion_id,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.workspacePersonId,
      input.fromEntityType,
      input.fromEntityId,
      input.predicate,
      input.toEntityType ?? null,
      input.toEntityId ?? null,
      input.toValue === undefined ? null : stableJson(input.toValue),
      stableJson(normalizeJson(input.qualifiers, {})),
      input.confidence ?? null,
      input.sourceAssertionId ?? null,
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }

  async enqueueProjection(input: ProjectionJobInput): Promise<PersistedEntity> {
    const id = await this.id('projection_job', input.ingestionKey);
    const now = this.clock();
    await this.db.prepare(
      `INSERT INTO projection_outbox (
         id, ingestion_key, projection_type, aggregate_type, aggregate_id,
         operation, payload_json, status, attempts, available_at,
         created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, ?8, ?9, ?9)
       ON CONFLICT(ingestion_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         operation = excluded.operation,
         available_at = CASE
           WHEN projection_outbox.status = 'completed'
             THEN projection_outbox.available_at
           ELSE excluded.available_at
         END,
         status = CASE
           WHEN projection_outbox.status = 'completed'
             THEN projection_outbox.status
           ELSE 'pending'
         END,
         locked_at = CASE
           WHEN projection_outbox.status = 'completed'
             THEN projection_outbox.locked_at
           ELSE NULL
         END,
         locked_by = CASE
           WHEN projection_outbox.status = 'completed'
             THEN projection_outbox.locked_by
           ELSE NULL
         END,
         last_error = CASE
           WHEN projection_outbox.status = 'completed'
             THEN projection_outbox.last_error
           ELSE NULL
         END,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.projectionType,
      input.aggregateType,
      input.aggregateId,
      input.operation ?? 'upsert',
      stableJson(normalizeJson(input.payload, {})),
      input.availableAt ?? now,
      now,
    ).run();
    return { id, ingestionKey: input.ingestionKey };
  }
}
