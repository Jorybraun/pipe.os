import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LivingContextStore } from '../persistence';

interface SqliteStatement {
  run(...bindings: unknown[]): { changes: number | bigint };
  get(...bindings: unknown[]): unknown;
  all(...bindings: unknown[]): unknown[];
  setReturnArrays(enabled: boolean): void;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const migrationSql = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const NOW = '2026-06-11T12:00:00.000Z';

function createMockD1(sqlite: SqliteDatabase): D1Database {
  return {
    prepare(query: string) {
      let bindings: unknown[] = [];
      const prepared = {
        bind(...values: unknown[]) {
          bindings = values;
          return prepared;
        },
        async run() {
          const result = sqlite.prepare(query).run(...bindings);
          return {
            success: true,
            meta: { changes: Number(result.changes) },
            results: [],
          };
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...bindings) as T | undefined) ?? null;
        },
        async all<T>() {
          return {
            success: true,
            results: sqlite.prepare(query).all(...bindings) as T[],
            meta: {},
          };
        },
        async raw<T>() {
          const statement = sqlite.prepare(query);
          statement.setReturnArrays(true);
          return statement.all(...bindings) as T[];
        },
      };
      return prepared;
    },
    async batch(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

describe('LivingContextStore', () => {
  let sqlite: SqliteDatabase;
  let store: LivingContextStore;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec(migrationSql);
    store = new LivingContextStore(createMockD1(sqlite), () => NOW);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('replays identity, workspace context, roles, and legacy application linkage idempotently', async () => {
    sqlite.prepare('INSERT INTO candidates (id) VALUES (?)').run('candidate-17');

    const person = await store.upsertPerson({
      ingestionKey: 'person:email:ada@example.com',
      displayName: 'Ada Lovelace',
      primaryEmail: ' ADA@EXAMPLE.COM ',
      externalIds: { crm: 'contact-9' },
    });
    const replayedPerson = await store.upsertPerson({
      ingestionKey: 'person:email:ada@example.com',
      displayName: 'Ada Byron Lovelace',
      primaryEmail: 'ada@example.com',
      externalIds: { crm: 'contact-9' },
    });

    const workspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace:acme:person:ada',
      workspaceId: 'acme',
      personId: person.id,
      relationshipSummary: 'Candidate and prior collaborator',
      context: { source: 'meeting' },
    });
    await store.upsertWorkspacePerson({
      ingestionKey: 'workspace:acme:person:ada',
      workspaceId: 'acme',
      personId: person.id,
      relationshipSummary: 'Candidate, prior collaborator, and advisor',
      context: { source: 'meeting', conversationCount: 2 },
    });

    const application = await store.upsertApplication({
      ingestionKey: 'application:candidate-17',
      workspacePersonId: workspacePerson.id,
      legacyCandidateId: 'candidate-17',
      pipelineId: 'pipeline-3',
      status: 'IN_PROGRESS',
    });
    await store.upsertPersonRole({
      ingestionKey: 'role:candidate-17',
      workspacePersonId: workspacePerson.id,
      applicationId: application.id,
      roleType: 'candidate',
      label: 'Backend engineer applicant',
    });
    await store.upsertPersonRole({
      ingestionKey: 'role:candidate-17',
      workspacePersonId: workspacePerson.id,
      applicationId: application.id,
      roleType: 'candidate',
      label: 'Distributed systems applicant',
    });

    expect(replayedPerson.id).toBe(person.id);
    expect(sqlite.prepare('SELECT count(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM workspace_people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM applications').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM person_roles').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      'SELECT display_name, primary_email FROM people WHERE id = ?',
    ).get(person.id)).toEqual({
      display_name: 'Ada Byron Lovelace',
      primary_email: 'ada@example.com',
    });
    expect(sqlite.prepare(
      'SELECT legacy_candidate_id FROM applications WHERE id = ?',
    ).get(application.id)).toEqual({ legacy_candidate_id: 'candidate-17' });
  });

  it('stores exact immutable provenance and rejects a conflicting replay', async () => {
    const person = await store.upsertPerson({ ingestionKey: 'person:1' });
    const workspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace-person:1',
      workspaceId: 'workspace-1',
      personId: person.id,
    });
    const interaction = await store.upsertInteraction({
      ingestionKey: 'meeting:42',
      workspacePersonId: workspacePerson.id,
      interactionType: 'video_meeting',
      externalReference: 'room-42',
      startedAt: '2026-06-11T10:00:00.000Z',
    });
    const artifact = await store.upsertArtifact({
      ingestionKey: 'meeting:42:transcript',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      artifactType: 'transcript',
      logicalKey: 'room-42/transcript',
    });
    const version = await store.createArtifactVersion({
      ingestionKey: 'meeting:42:transcript:sha256:abc',
      artifactId: artifact.id,
      versionNumber: 1,
      contentHash: 'sha256:abc',
      mediaType: 'text/plain',
      contentText: 'I implemented ordered replay for ecommerce orders using Kafka.',
      byteLength: 63,
      metadata: { language: 'en' },
    });
    const spanInput = {
      ingestionKey: 'meeting:42:segment:turn-7:0-63',
      artifactVersionId: version.id,
      stableSegmentId: 'turn-7',
      byteStart: 0,
      byteEnd: 63,
      charStart: 0,
      charEnd: 63,
      lineStart: 14,
      lineEnd: 14,
      timestampStartMs: 31_200,
      timestampEndMs: 38_900,
      exactText: 'I implemented ordered replay for ecommerce orders using Kafka.',
      metadata: { speaker: 'candidate' },
    } as const;
    const span = await store.createSourceSpan(spanInput);
    const replayedSpan = await store.createSourceSpan(spanInput);

    expect(replayedSpan.id).toBe(span.id);
    expect(sqlite.prepare('SELECT count(*) AS count FROM artifact_versions').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM source_spans').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      `SELECT stable_segment_id, byte_start, byte_end, char_start, char_end,
              line_start, line_end, timestamp_start_ms, timestamp_end_ms, exact_text
         FROM source_spans WHERE id = ?`,
    ).get(span.id)).toEqual({
      stable_segment_id: 'turn-7',
      byte_start: 0,
      byte_end: 63,
      char_start: 0,
      char_end: 63,
      line_start: 14,
      line_end: 14,
      timestamp_start_ms: 31_200,
      timestamp_end_ms: 38_900,
      exact_text: spanInput.exactText,
    });

    await expect(store.createSourceSpan({
      ...spanInput,
      exactText: 'A different sentence.',
    })).rejects.toThrow('replayed with different exact_text');
  });

  it('persists flexible assertions, accumulated signals, and one deduplicated projection job', async () => {
    const person = await store.upsertPerson({ ingestionKey: 'person:2' });
    const workspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace-person:2',
      workspaceId: 'workspace-1',
      personId: person.id,
    });
    const interaction = await store.upsertInteraction({
      ingestionKey: 'meeting:84',
      workspacePersonId: workspacePerson.id,
      interactionType: 'video_meeting',
    });
    const artifact = await store.upsertArtifact({
      ingestionKey: 'meeting:84:transcript',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      artifactType: 'transcript',
    });
    const version = await store.createArtifactVersion({
      ingestionKey: 'meeting:84:transcript:v1',
      artifactId: artifact.id,
      versionNumber: 1,
      contentHash: 'sha256:def',
      mediaType: 'text/plain',
      contentText: 'Kafka statement',
    });
    const span = await store.createSourceSpan({
      ingestionKey: 'meeting:84:span:1',
      artifactVersionId: version.id,
      stableSegmentId: 'turn-1',
      exactText: 'Kafka statement',
    });
    const episode = await store.upsertEpisode({
      ingestionKey: 'meeting:84:episode:order-replay',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      narrative: 'Discussion of ordered event replay',
    });
    const assertion = await store.upsertAssertion({
      ingestionKey: 'meeting:84:assertion:1',
      workspacePersonId: workspacePerson.id,
      episodeId: episode.id,
      subjectType: 'person',
      subjectId: person.id,
      predicate: 'implemented ordered replay for ecommerce orders using',
      objectType: 'technology',
      objectValue: { canonicalKey: 'technology:kafka' },
      narrative: 'Implemented Kafka-based ordered replay for ecommerce orders.',
      qualifiers: { domain: 'ecommerce', businessObject: 'order' },
      confidence: 0.91,
      observedAt: '2026-06-11T10:10:00.000Z',
    });
    await store.linkAssertionSourceSpan(assertion.id, span.id, 'direct_quote');
    const concept = await store.upsertConcept({
      ingestionKey: 'concept:technology:kafka',
      canonicalKey: 'technology:kafka',
      namespace: 'technology',
      label: 'Kafka',
    });
    await store.linkAssertionConcept(assertion.id, concept.id, 'mechanism', 0.95);
    await store.upsertSignalEvidence({
      ingestionKey: 'evidence:meeting-84:kafka-implementation',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      assertionId: assertion.id,
      conceptId: concept.id,
      signalKey: 'technology:kafka',
      evidenceLevel: 'implemented',
      strength: 0.88,
      observedAt: '2026-06-11T10:10:00.000Z',
    });
    await store.upsertSignalSnapshot({
      ingestionKey: 'snapshot:person-2:kafka:2026-06-11',
      workspacePersonId: workspacePerson.id,
      signalKey: 'technology:kafka',
      interactionId: interaction.id,
      asOf: NOW,
      conversationScore: 0.82,
      totalScore: 0.76,
      confidence: 0.84,
      evidenceCount: 3,
      sourceDiversity: 2,
      policyVersion: 'living-context-v1',
    });
    await store.upsertSemanticRelationship({
      ingestionKey: 'relationship:assertion-1:order-replay',
      workspacePersonId: workspacePerson.id,
      fromEntityType: 'assertion',
      fromEntityId: assertion.id,
      predicate: 'reduced duplicate fulfillment during ordered replay of',
      toValue: { businessObject: 'order event' },
      sourceAssertionId: assertion.id,
    });
    const firstJob = await store.enqueueProjection({
      ingestionKey: 'neo4j:workspace-person-2:revision-7',
      projectionType: 'neo4j',
      aggregateType: 'workspace_person',
      aggregateId: workspacePerson.id,
      payload: { assertionIds: [assertion.id] },
    });
    const replayedJob = await store.enqueueProjection({
      ingestionKey: 'neo4j:workspace-person-2:revision-7',
      projectionType: 'neo4j',
      aggregateType: 'workspace_person',
      aggregateId: workspacePerson.id,
      payload: { assertionIds: [assertion.id], signalKeys: ['technology:kafka'] },
    });

    expect(replayedJob.id).toBe(firstJob.id);
    expect(sqlite.prepare('SELECT count(*) AS count FROM projection_outbox').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      'SELECT predicate FROM semantic_assertions WHERE id = ?',
    ).get(assertion.id)).toEqual({
      predicate: 'implemented ordered replay for ecommerce orders using',
    });
    expect(sqlite.prepare(
      'SELECT predicate FROM semantic_relationships',
    ).get()).toEqual({
      predicate: 'reduced duplicate fulfillment during ordered replay of',
    });
    expect(sqlite.prepare(
      'SELECT status, payload_json FROM projection_outbox WHERE id = ?',
    ).get(firstJob.id)).toEqual({
      status: 'pending',
      payload_json: JSON.stringify({
        assertionIds: [assertion.id],
        signalKeys: ['technology:kafka'],
      }),
    });
    expect(sqlite.prepare(
      `SELECT conversation_score, total_score
         FROM signal_snapshots WHERE signal_key = 'technology:kafka'`,
    ).get()).toEqual({
      conversation_score: 0.82,
      total_score: 0.76,
    });
  });
});
