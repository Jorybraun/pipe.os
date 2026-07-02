import {
  LivingContextStore,
  type JsonObject,
  type JsonValue,
} from './livingContext';

export const TALENT_POOL_MEMBERSHIP_SCHEMA_BLOCKER =
  'Current D1 schema has no TalentPoolMembership table; roleless intake records membership state in workspace_people.context_json until that table exists.';

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

export async function ensureRolelessTalentPoolIdentity(input: {
  db: D1Database;
  userId: string;
  candidateId: string;
  name: string;
  email: string;
  message?: string;
  now: string;
}): Promise<{ personId: string; workspacePersonId: string }> {
  const { db, userId, candidateId, name, email, message, now } = input;
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

  return { personId: person.id, workspacePersonId: workspacePerson.id };
}
