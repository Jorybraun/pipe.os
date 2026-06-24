import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';

const { runWriteQuery, closeDriver } = vi.hoisted(() => ({
  runWriteQuery: vi.fn().mockResolvedValue({
    nodesCreated: 0,
    nodesSet: 0,
    relationshipsCreated: 0,
  }),
  closeDriver: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../neo4j/driver', () => ({
  buildNeo4jConfig: vi.fn().mockReturnValue({
    uri: 'bolt://test',
    user: 'neo4j',
    password: 'test',
  }),
  createNeo4jDriver: vi.fn().mockReturnValue({
    close: closeDriver,
  }),
}));

vi.mock('../../neo4j/query', () => ({
  runWriteQuery,
}));

import { ingestMeetingTranscriptToLivingContext } from '../meetingTranscript';
import { LivingContextStore } from '../persistence';
import { processProjectionOutbox } from '../projection';
import type { ContextRecordInput } from '../types';



const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);



describe('living-context Neo4j projection outbox', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(async () => {
    vi.clearAllMocks();
    runWriteQuery.mockResolvedValue({
      nodesCreated: 0,
      nodesSet: 0,
      relationshipsCreated: 0,
    });
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (id TEXT PRIMARY KEY);
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        phone TEXT,
        company TEXT,
        role TEXT,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE meeting_participants (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id),
        contact_id TEXT NOT NULL REFERENCES contacts(id),
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.prepare(
      `INSERT INTO contacts (
         id, owner_id, name, email, phone, company, role, type, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    ).run(
      'contact-1',
      'workspace-1',
      'Ada Example',
      'ada@example.com',
      'Engineer',
      'candidate',
      '2026-06-13T09:00:00.000Z',
      '2026-06-13T09:00:00.000Z',
    );
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'meeting-1',
      'workspace-1',
      '2026-06-13T10:00:00.000Z',
      '2026-06-13T10:30:00.000Z',
      '2026-06-13T10:31:00.000Z',
    );
    sqlite.prepare(
      `INSERT INTO meeting_participants (
         id, meeting_id, contact_id, role, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'participant-1',
      'meeting-1',
      'contact-1',
      'ATTENDEE',
      '2026-06-13T09:00:00.000Z',
      '2026-06-13T09:00:00.000Z',
    );
    db = createMockD1(sqlite);
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [{
        stableSegmentId: 'guest-1',
        text: 'I implemented previously unseen temporal routing.',
        contactId: 'contact-1',
        speakerRole: 'guest',
        channel: 1,
        timestampStartMs: 1_000,
        timestampEndMs: 3_000,
      }],
      semanticAssertions: [{
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Implemented previously unseen temporal routing.',
        concepts: [{
          surface: 'previously unseen temporal routing',
          relationship: 'mechanism implemented in source',
          weight: 0.9,
          evidenceLevel: 'implemented',
          strength: 0.88,
        }],
      }],
      extractorVersion: 'projection-test-v1',
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('claims a rebuild job and projects the complete source-backed context shape', async () => {
    const result = await processProjectionOutbox({
      DB: db,
      NEO4J_URI: 'bolt://test',
      NEO4J_PASSWORD: 'test',
    } as unknown as Parameters<typeof processProjectionOutbox>[0]);

    expect(result).toEqual({ completed: 1, failed: 0 });
    expect(sqlite.prepare(
      `SELECT status, locked_at, locked_by FROM projection_outbox`,
    ).get()).toEqual({
      status: 'completed',
      locked_at: null,
      locked_by: null,
    });
    const calls = runWriteQuery.mock.calls as Array<[unknown, string, Record<string, unknown>]>;
    const cypher = calls.map((call) => call[1]).join('\n');
    expect(cypher).toContain('HAS_CONTEXT_ENTITY');
    expect(cypher).toContain('MERGE (i:Interaction');
    expect(cypher).toContain('MERGE (a:Artifact');
    expect(cypher).toContain('MERGE (v:ArtifactVersion');
    expect(cypher).toContain('MERGE (s:SourceSpan');
    expect(cypher).toContain('timestamp_start_ms');
    expect(cypher).toContain('MERGE (a:SemanticAssertion');
    expect(cypher).toContain('MERGE (a)-[r:RELATES_TO');
    expect(cypher).toContain('MERGE (se:SignalEvidence');
    expect(cypher).toContain('MERGE (ss:SignalSnapshot');
    expect(cypher).toContain('ATTRIBUTED_TO');

    const conceptCall = calls.find((call) => call[1].includes('MERGE (a)-[r:RELATES_TO'));
    expect(conceptCall?.[2]).toMatchObject({
      rows: [{
        relationship: 'mechanism implemented in source',
        weight: 0.9,
      }],
    });
  });

  it('recovers a stale processing job through the conditional claim', async () => {
    sqlite.prepare(
      `UPDATE projection_outbox
          SET status = 'processing',
              locked_at = '2026-01-01T00:00:00.000Z',
              locked_by = 'dead-worker'`,
    ).run();

    const result = await processProjectionOutbox({
      DB: db,
      NEO4J_URI: 'bolt://test',
      NEO4J_PASSWORD: 'test',
    } as unknown as Parameters<typeof processProjectionOutbox>[0]);

    expect(result).toEqual({ completed: 1, failed: 0 });
    expect(sqlite.prepare(
      `SELECT status, attempts FROM projection_outbox`,
    ).get()).toEqual({
      status: 'completed',
      attempts: 1,
    });
  });

  it('honors delete operations by removing the workspace projection identity', async () => {
    sqlite.prepare(
      `UPDATE projection_outbox
          SET operation = 'delete', status = 'pending',
              completed_at = NULL, attempts = 0`,
    ).run();

    const result = await processProjectionOutbox({
      DB: db,
      NEO4J_URI: 'bolt://test',
      NEO4J_PASSWORD: 'test',
    } as unknown as Parameters<typeof processProjectionOutbox>[0]);

    expect(result).toEqual({ completed: 1, failed: 0 });
    const cypher = (runWriteQuery.mock.calls as Array<[unknown, string]>)
      .map((call) => call[1])
      .join('\n');
    expect(cypher).toContain('DETACH DELETE wp');
  });

  it('preserves unseen context-record-only concepts through a projection rebuild', async () => {
    const store = new LivingContextStore(db, () => '2026-06-13T11:00:00.000Z');
    const workspacePerson = sqlite.prepare(
      `SELECT id FROM workspace_people LIMIT 1`,
    ).get() as { id: string };
    const sourceSpan = sqlite.prepare(
      `SELECT ss.id FROM source_spans ss LIMIT 1`,
    ).get() as { id: string };
    const interaction = sqlite.prepare(
      `SELECT id FROM interactions LIMIT 1`,
    ).get() as { id: string };

    // An "unseen" concept: persisted only as open data, never linked to any
    // semantic assertion. It must survive ingestion and a projection rebuild
    // purely through its context_record_concepts edge.
    const unseenConcept = await store.upsertConcept({
      ingestionKey: 'open-term:unseen-context-only-quantum-replay',
      canonicalKey: 'term:unseen-context-only-quantum-replay',
      namespace: 'term',
      label: 'unseen context only quantum replay',
      metadata: { source: 'has-96-unseen-concept-projection' },
    });
    expect(
      sqlite.prepare(
        `SELECT COUNT(*) AS count FROM assertion_concepts WHERE concept_id = ?`,
      ).get(unseenConcept.id),
    ).toEqual({ count: 0 });

    const contextRecordInput: ContextRecordInput = {
      ingestionKey: 'context-record:has-96:unseen-concept-rebuild',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      recordType: 'source_backed_meaning',
      predicate: 'designed',
      narrative: 'Designed an unseen quantum replay strategy for order events.',
      qualifiers: { sourceSegmentId: 'guest-1' },
      confidence: 0.9,
      extractionVersion: 'has-96-projection-v1',
      observedAt: '2026-06-13T11:00:00.000Z',
      sources: [{ sourceSpanId: sourceSpan.id, evidenceRole: 'source' }],
      entities: [
        {
          entityType: 'workspace_person',
          entityId: workspacePerson.id,
          relationship: 'speaker',
        },
        {
          entityType: 'business_object',
          relationship: 'object',
          value: { literal: 'quantum order events' },
        },
      ],
      concepts: [
        {
          conceptId: unseenConcept.id,
          relationship: 'mechanism',
          weight: 0.92,
        },
      ],
    };
    const contextRecord = await store.upsertContextRecord(contextRecordInput);
    // Idempotent replay must not duplicate the unseen concept linkage.
    await store.upsertContextRecord(contextRecordInput);

    // Scope counts to the record under test: the beforeEach meeting-transcript
    // ingestion already persists its own context records, so a global count
    // would conflate them with the unseen-concept record under test.
    expect(
      sqlite.prepare(
        `SELECT COUNT(*) AS count FROM context_records WHERE ingestion_key = ?`,
      ).get(contextRecordInput.ingestionKey),
    ).toEqual({ count: 1 });
    expect(
      sqlite.prepare(
        `SELECT COUNT(*) AS count FROM context_record_concepts WHERE context_record_id = ?`,
      ).get(contextRecord.id),
    ).toEqual({ count: 1 });
    expect(
      sqlite.prepare(
        `SELECT canonical_key FROM context_record_concepts crc
           JOIN concepts c ON c.id = crc.concept_id
          WHERE crc.context_record_id = ?`,
      ).get(contextRecord.id),
    ).toEqual({
      canonical_key: 'term:unseen-context-only-quantum-replay',
    });

    const result = await processProjectionOutbox({
      DB: db,
      NEO4J_URI: 'bolt://test',
      NEO4J_PASSWORD: 'test',
    } as unknown as Parameters<typeof processProjectionOutbox>[0]);

    expect(result).toEqual({ completed: 1, failed: 0 });
    const calls = runWriteQuery.mock.calls as Array<
      [unknown, string, Record<string, unknown>]
    >;
    const cypher = calls.map((call) => call[1]).join('\n');

    // The unseen concept node is projected even though no assertion references it.
    expect(cypher).toContain('MERGE (c:Concept {concept_id: row.concept_id})');
    expect(cypher).toContain('RELATES_TO_CONCEPT');
    expect(cypher).toContain('MERGE (cr:ContextRecord {context_record_id: row.id})');

    const conceptCall = calls.find((call) =>
      call[1].includes('RELATES_TO_CONCEPT'),
    );
    // The RELATES_TO_CONCEPT batch projects every context-record concept for
    // the workspace person, including the beforeEach assertion concept. Assert
    // the unseen concept is present rather than the sole row.
    expect(conceptCall?.[2]).toMatchObject({
      rows: expect.arrayContaining([
        expect.objectContaining({
          concept_id: unseenConcept.id,
          canonical_key: 'term:unseen-context-only-quantum-replay',
          relationship: 'mechanism',
          weight: 0.92,
        }),
      ]),
    });

    // A second rebuild (delete + re-project) must still surface the unseen
    // concept, proving it survives projection rebuild rather than being dropped.
    sqlite.prepare(
      `UPDATE projection_outbox
          SET status = 'pending', completed_at = NULL, attempts = 0`,
    ).run();
    runWriteQuery.mockClear();
    const rebuild = await processProjectionOutbox({
      DB: db,
      NEO4J_URI: 'bolt://test',
      NEO4J_PASSWORD: 'test',
    } as unknown as Parameters<typeof processProjectionOutbox>[0]);

    expect(rebuild).toEqual({ completed: 1, failed: 0 });
    const rebuildCalls = runWriteQuery.mock.calls as Array<
      [unknown, string, Record<string, unknown>]
    >;
    const rebuildConceptCall = rebuildCalls.find((call) =>
      call[1].includes('RELATES_TO_CONCEPT'),
    );
    expect(rebuildConceptCall?.[2]).toMatchObject({
      rows: expect.arrayContaining([
        expect.objectContaining({
          concept_id: unseenConcept.id,
          canonical_key: 'term:unseen-context-only-quantum-replay',
        }),
      ]),
    });
  });
});
