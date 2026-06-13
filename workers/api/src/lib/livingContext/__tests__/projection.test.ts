import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { processProjectionOutbox } from '../projection';

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

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);

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

describe('living-context Neo4j projection outbox', () => {
  let sqlite: SqliteDatabase;
  let db: D1Database;

  beforeEach(async () => {
    vi.clearAllMocks();
    runWriteQuery.mockResolvedValue({
      nodesCreated: 0,
      nodesSet: 0,
      relationshipsCreated: 0,
    });
    sqlite = new DatabaseSync(':memory:');
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
});
