import {
  deterministicEntityId,
  LivingContextStore,
  type JsonObject,
  type JsonValue,
} from './livingContext';

export const TALENT_POOL_MEMBERSHIP_SCHEMA_BLOCKER =
  'Current D1 schema has no TalentPoolMembership table; roleless intake records membership state in workspace_people.context_json until that table exists.';

export interface TalentPoolOperationalContextInput {
  githubUrl?: string | null;
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
  phoneScreenerConsent?: boolean;
  phoneNumber?: string | null;
  timezone?: string | null;
  availability?: string | null;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string | null): JsonObject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as JsonValue;
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringList(value: JsonValue | undefined): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === 'string' && entry.trim() ? [entry.trim()] : [],
  );
}

function uniqueStrings(...values: string[][]): string[] {
  return [...new Set(values.flat())].sort();
}

export function buildRolelessTalentPoolContext(
  existingContext: JsonObject,
  candidateId: string,
  joinedAt: string,
): JsonObject {
  const existingTalentPool = isJsonObject(existingContext.talentPool)
    ? existingContext.talentPool
    : {};
  return {
    ...existingContext,
    source: 'roleless_candidate_intake',
    sources: uniqueStrings(
      stringList(existingContext.sources),
      stringList(existingContext.source),
      ['roleless_candidate_intake'],
    ),
    legacyCandidateIds: uniqueStrings(
      stringList(existingContext.legacyCandidateIds),
      [candidateId],
    ),
    talentPool: {
      ...existingTalentPool,
      status: 'active',
      roleless: true,
      candidateId,
      joinedAt: typeof existingTalentPool.joinedAt === 'string' ? existingTalentPool.joinedAt : joinedAt,
      membershipSchemaBlocker: TALENT_POOL_MEMBERSHIP_SCHEMA_BLOCKER,
    },
  };
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadWorkspacePersonContext(
  db: D1Database,
  workspaceId: string,
  personId: string,
): Promise<JsonObject> {
  const existing = await db.prepare(
    `SELECT context_json
       FROM workspace_people
      WHERE workspace_id = ?1 AND person_id = ?2
      LIMIT 1`,
  ).bind(workspaceId, personId).first<{ context_json: string | null }>();
  return parseJsonObject(existing?.context_json ?? null);
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND name = ?1
      LIMIT 1`,
  ).bind(tableName).first<{ name: string }>();
  return Boolean(row);
}

async function tableColumnExists(
  db: D1Database,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT name
       FROM pragma_table_info(?1)
      WHERE name = ?2
      LIMIT 1`,
  ).bind(tableName, columnName).first<{ name: string }>();
  return Boolean(row);
}

async function contextRecordTablesReady(db: D1Database): Promise<boolean> {
  for (const tableName of [
    'context_records',
    'context_record_source_refs',
    'context_record_source_spans',
    'context_record_entities',
    'context_record_concepts',
  ]) {
    if (!await tableExists(db, tableName)) return false;
  }
  return true;
}

function epochFromIso(value: string): number {
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : Math.floor(Date.now() / 1000);
}

interface IntakeFieldSpan {
  key: string;
  value: string;
  line: string;
  charStart: number;
  charEnd: number;
  spanId: string;
}

function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

function buildOperationalFieldLines(input: TalentPoolOperationalContextInput): Array<{
  key: string;
  value: string;
}> {
  const fields: Array<{ key: string; value: string }> = [];
  const githubUrl = optionalTrimmed(input.githubUrl);
  const linkedinUrl = optionalTrimmed(input.linkedinUrl);
  const portfolioUrl = optionalTrimmed(input.portfolioUrl);
  const phoneNumber = optionalTrimmed(input.phoneNumber);
  const timezone = optionalTrimmed(input.timezone);
  const availability = optionalTrimmed(input.availability);

  if (githubUrl) fields.push({ key: 'githubUrl', value: githubUrl });
  if (linkedinUrl) fields.push({ key: 'linkedinUrl', value: linkedinUrl });
  if (portfolioUrl) fields.push({ key: 'portfolioUrl', value: portfolioUrl });
  if (input.phoneScreenerConsent === true) {
    fields.push({ key: 'phoneScreenerConsent', value: 'true' });
    if (phoneNumber) fields.push({ key: 'phoneNumber', value: phoneNumber });
    if (timezone) fields.push({ key: 'timezone', value: timezone });
    if (availability) fields.push({ key: 'availability', value: availability });
  }
  return fields;
}

function fieldSpansFromText(
  content: string,
  fields: Array<{ key: string; value: string }>,
): Array<Omit<IntakeFieldSpan, 'spanId'>> {
  let cursor = 0;
  return fields.map((field) => {
    const line = `${field.key}: ${field.value}`;
    const charStart = cursor;
    const charEnd = cursor + line.length;
    cursor = charEnd + 1;
    return {
      key: field.key,
      value: field.value,
      line,
      charStart,
      charEnd: Math.min(charEnd, content.length),
    };
  });
}

async function persistRolelessOperationalContext(input: {
  db: D1Database;
  store: LivingContextStore;
  workspacePersonId: string;
  candidateId: string;
  operationalContext?: TalentPoolOperationalContextInput;
  now: string;
}): Promise<void> {
  const fields = buildOperationalFieldLines(input.operationalContext ?? {});
  if (fields.length === 0) return;

  const contentText = fields.map((field) => `${field.key}: ${field.value}`).join('\n');
  const contentHash = await sha256Hex(contentText);
  const baseKey = `candidate:${input.candidateId}:roleless-intake-fields:${contentHash}`;
  const interaction = await input.store.upsertInteraction({
    ingestionKey: `${baseKey}:interaction`,
    workspacePersonId: input.workspacePersonId,
    interactionType: 'form_submission',
    externalReference: input.candidateId,
    startedAt: input.now,
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
      evidenceKind: 'operational_intake_fields',
    },
  });
  const artifact = await input.store.upsertArtifact({
    ingestionKey: `${baseKey}:artifact`,
    workspacePersonId: input.workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'form_submission',
    logicalKey: 'roleless_candidate_intake_fields',
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
      evidenceKind: 'operational_intake_fields',
    },
  });
  const version = await input.store.createArtifactVersion({
    ingestionKey: `${baseKey}:version:1`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/plain',
    contentText,
    byteLength: new TextEncoder().encode(contentText).byteLength,
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
      evidenceKind: 'operational_intake_fields',
    },
  });

  const spanEntries: IntakeFieldSpan[] = [];
  for (const field of fieldSpansFromText(contentText, fields)) {
    const span = await input.store.createSourceSpan({
      ingestionKey: `${baseKey}:span:${field.key}`,
      artifactVersionId: version.id,
      stableSegmentId: field.key,
      charStart: field.charStart,
      charEnd: field.charEnd,
      exactText: field.line,
      metadata: {
        source: 'roleless_candidate_intake',
        roleless: true,
        evidenceKind: 'operational_intake_field',
        field: field.key,
      },
    });
    spanEntries.push({ ...field, spanId: span.id });
  }

  if (!await contextRecordTablesReady(input.db)) return;

  const spanByKey = new Map(spanEntries.map((entry) => [entry.key, entry]));
  const externalRefs = [
    ['github', 'githubUrl', 'submitted_github_profile_url', 'Candidate submitted GitHub profile URL.'],
    ['linkedin', 'linkedinUrl', 'submitted_linkedin_profile_url', 'Candidate submitted LinkedIn profile URL.'],
    ['portfolio', 'portfolioUrl', 'submitted_portfolio_url', 'Candidate submitted portfolio URL.'],
  ] as const;

  for (const [profileRefType, fieldKey, predicate, narrative] of externalRefs) {
    const field = spanByKey.get(fieldKey);
    if (!field) continue;
    await input.store.upsertContextRecord({
      ingestionKey: `candidate:${input.candidateId}:roleless-operational:profile-ref:${profileRefType}`,
      workspacePersonId: input.workspacePersonId,
      interactionId: interaction.id,
      recordType: 'talent_pool_external_profile_ref',
      predicate,
      narrative,
      qualifiers: {
        source: 'roleless_candidate_intake',
        roleless: true,
        profileRefType,
      },
      confidence: 1,
      polarity: 1,
      extractionVersion: 'talent-pool-roleless-operational-v1',
      observedAt: input.now,
      sources: [{ sourceSpanId: field.spanId, evidenceRole: 'source' }],
      entities: [
        {
          entityType: 'workspace_person',
          entityId: input.workspacePersonId,
          relationship: 'subject',
        },
        {
          entityType: 'external_profile_ref',
          relationship: profileRefType,
          value: { url: field.value, profileRefType },
        },
      ],
    });
  }

  const consent = spanByKey.get('phoneScreenerConsent');
  if (consent) {
    const phoneSources = ['phoneScreenerConsent', 'phoneNumber', 'timezone', 'availability']
      .flatMap((fieldKey) => {
        const field = spanByKey.get(fieldKey);
        return field ? [{ sourceSpanId: field.spanId, evidenceRole: 'source' as const }] : [];
      });
    await input.store.upsertContextRecord({
      ingestionKey: `candidate:${input.candidateId}:roleless-operational:phone-screener-intent`,
      workspacePersonId: input.workspacePersonId,
      interactionId: interaction.id,
      recordType: 'talent_pool_phone_screener_intent',
      predicate: 'consented_to_phone_screener',
      narrative: 'Candidate consented to Talent Pool phone screener.',
      qualifiers: {
        source: 'roleless_candidate_intake',
        roleless: true,
        hasPhoneNumber: spanByKey.has('phoneNumber'),
        hasTimezone: spanByKey.has('timezone'),
        hasAvailability: spanByKey.has('availability'),
      },
      confidence: 1,
      polarity: 1,
      extractionVersion: 'talent-pool-roleless-operational-v1',
      observedAt: input.now,
      sources: phoneSources,
      entities: [
        {
          entityType: 'workspace_person',
          entityId: input.workspacePersonId,
          relationship: 'subject',
        },
        {
          entityType: 'phone_screener_intent',
          relationship: 'operational_preference',
          value: {
            consent: true,
            hasPhoneNumber: spanByKey.has('phoneNumber'),
            hasTimezone: spanByKey.has('timezone'),
            hasAvailability: spanByKey.has('availability'),
          },
        },
      ],
    });
  }
}

async function persistRolelessMessageArtifact(input: {
  db: D1Database;
  store: LivingContextStore;
  workspacePersonId: string;
  candidateId: string;
  message: string;
  now: string;
}): Promise<void> {
  const message = input.message;
  if (!message.trim()) return;

  const contentHash = await sha256Hex(message);
  const baseKey = `candidate:${input.candidateId}:roleless-message:${contentHash}`;
  const interaction = await input.store.upsertInteraction({
    ingestionKey: baseKey,
    workspacePersonId: input.workspacePersonId,
    interactionType: 'message',
    externalReference: input.candidateId,
    startedAt: input.now,
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
    },
  });
  const artifact = await input.store.upsertArtifact({
    ingestionKey: baseKey,
    workspacePersonId: input.workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'message',
    logicalKey: 'roleless_candidate_intake_message',
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
    },
  });
  const version = await input.store.createArtifactVersion({
    ingestionKey: `${baseKey}:v1`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/plain',
    contentText: message,
    byteLength: new TextEncoder().encode(message).byteLength,
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
    },
  });
  const span = await input.store.createSourceSpan({
    ingestionKey: `${baseKey}:span:full`,
    artifactVersionId: version.id,
    stableSegmentId: 'full-message',
    charStart: 0,
    charEnd: message.length,
    exactText: message,
    exactTextHash: contentHash,
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
    },
  });

  await persistRolelessProfileCandidateNode({
    db: input.db,
    candidateId: input.candidateId,
    message,
    contentHash,
    sourceSpanId: span.id,
    now: input.now,
  });

  if (!await contextRecordTablesReady(input.db)) return;

  await input.store.upsertContextRecord({
    ingestionKey: `${baseKey}:context-record:profile-intake`,
    workspacePersonId: input.workspacePersonId,
    interactionId: interaction.id,
    recordType: 'talent_pool_profile_intake',
    predicate: 'submitted_profile_evidence',
    narrative: 'Candidate submitted Talent Pool profile evidence.',
    qualifiers: {
      source: 'roleless_candidate_intake',
      roleless: true,
    },
    confidence: 1,
    polarity: 1,
    extractionVersion: 'talent-pool-roleless-intake-v1',
    observedAt: input.now,
    sources: [{ sourceSpanId: span.id, evidenceRole: 'source' }],
    entities: [
      {
        entityType: 'workspace_person',
        entityId: input.workspacePersonId,
        relationship: 'subject',
      },
      {
        entityType: 'artifact',
        entityId: artifact.id,
        relationship: 'source_artifact',
      },
    ],
  });
}

async function persistRolelessProfileCandidateNode(input: {
  db: D1Database;
  candidateId: string;
  message: string;
  contentHash: string;
  sourceSpanId: string;
  now: string;
}): Promise<void> {
  const sourceText = input.message.trim();
  if (!sourceText || !await tableExists(input.db, 'candidate_nodes')) return;

  const ingestionKey = `candidate:${input.candidateId}:talent-pool-profile-node:${input.contentHash}`;
  const id = await deterministicEntityId('candidate_node', ingestionKey);
  const sourceQuote = sourceText.slice(0, 4000);
  const capturedAt = epochFromIso(input.now);
  const sourceReference = `source_span:${input.sourceSpanId}`;
  const narrative = 'Candidate submitted Talent Pool profile evidence.';
  const properties = JSON.stringify({
    source: 'roleless_candidate_intake',
    roleless: true,
    evidence_kind: 'profile_text_intake',
    source_span_id: input.sourceSpanId,
    source_quote: sourceQuote,
    source_quote_validated: true,
    source_quote_char_start: 0,
    source_quote_char_end: sourceQuote.length,
    exact_text_hash: input.contentHash,
  });
  const hasIngestionKey = await tableColumnExists(input.db, 'candidate_nodes', 'ingestion_key');

  if (hasIngestionKey) {
    await input.db.prepare(
      `INSERT INTO candidate_nodes (
         id, candidate_id, node_type, narrative_text,
         extracted_properties_json, embedding_json, source_type,
         source_reference, captured_at, confidence,
         supersedes, superseded_at, decomposition_version, ingestion_key,
         created_at, updated_at
       ) VALUES (
         ?1, ?2, 'TalentPoolProfileIntake', ?3,
         ?4, NULL, 'talent_pool_profile_intake',
         ?5, ?6, 1,
         NULL, NULL, 'talent-pool-roleless-intake-v1', ?7,
         unixepoch(), unixepoch()
       )
       ON CONFLICT(id) DO UPDATE SET
         narrative_text = excluded.narrative_text,
         extracted_properties_json = excluded.extracted_properties_json,
         source_reference = excluded.source_reference,
         captured_at = excluded.captured_at,
         confidence = excluded.confidence,
         updated_at = unixepoch()`,
    ).bind(
      id,
      input.candidateId,
      narrative,
      properties,
      sourceReference,
      capturedAt,
      ingestionKey,
    ).run();
    return;
  }

  await input.db.prepare(
    `INSERT INTO candidate_nodes (
       id, candidate_id, node_type, narrative_text,
       extracted_properties_json, embedding_json, source_type,
       source_reference, captured_at, confidence,
       supersedes, superseded_at, decomposition_version,
       created_at, updated_at
     ) VALUES (
       ?1, ?2, 'TalentPoolProfileIntake', ?3,
       ?4, NULL, 'talent_pool_profile_intake',
       ?5, ?6, 1,
       NULL, NULL, 'talent-pool-roleless-intake-v1',
       unixepoch(), unixepoch()
     )
     ON CONFLICT(id) DO UPDATE SET
       narrative_text = excluded.narrative_text,
       extracted_properties_json = excluded.extracted_properties_json,
       source_reference = excluded.source_reference,
       captured_at = excluded.captured_at,
       confidence = excluded.confidence,
       updated_at = unixepoch()`,
  ).bind(
    id,
    input.candidateId,
    narrative,
    properties,
    sourceReference,
    capturedAt,
  ).run();
}

export async function ensureRolelessTalentPoolIdentity(input: {
  db: D1Database;
  userId: string;
  candidateId: string;
  name: string;
  email: string;
  message?: string;
  operationalContext?: TalentPoolOperationalContextInput;
  now: string;
}): Promise<{ personId: string; workspacePersonId: string }> {
  const { db, userId, candidateId, name, email, message, operationalContext, now } = input;
  const normalizedEmail = email.trim().toLowerCase();
  const store = new LivingContextStore(db);
  const existingPerson = await db.prepare(
    `SELECT id, ingestion_key
       FROM people
      WHERE primary_email = ?1
      ORDER BY created_at
      LIMIT 1`,
  ).bind(normalizedEmail).first<{ id: string; ingestion_key: string }>();

  const person = await store.upsertPerson({
    ingestionKey: existingPerson?.ingestion_key ?? `email:${normalizedEmail}`,
    displayName: name,
    primaryEmail: normalizedEmail,
    externalIds: { legacyCandidateId: candidateId },
  });

  const existingContext = await loadWorkspacePersonContext(db, userId, person.id);
  const workspacePerson = await store.upsertWorkspacePerson({
    ingestionKey: `workspace:${userId}:person:${person.id}`,
    workspaceId: userId,
    personId: person.id,
    context: buildRolelessTalentPoolContext(existingContext, candidateId, now),
  });

  await persistRolelessMessageArtifact({
    db,
    store,
    workspacePersonId: workspacePerson.id,
    candidateId,
    message: message ?? '',
    now,
  });
  await persistRolelessOperationalContext({
    db,
    store,
    workspacePersonId: workspacePerson.id,
    candidateId,
    operationalContext,
    now,
  });

  return { personId: person.id, workspacePersonId: workspacePerson.id };
}
