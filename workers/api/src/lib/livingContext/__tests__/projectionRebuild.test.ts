/**
 * Projection rebuild proof test — acceptance criteria #4 and #8
 *
 * Proves:
 * - D1 projection outbox entries are created during ingestion
 * - Projection outbox processing produces Neo4j write queries
 * - Force-rebuild (reset + re-process) produces identical Neo4j writes
 * - Failed outbox entries are retried correctly
 * - Projection is fully rebuildable from D1 source of truth
 */
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';

const capturedQueries: Array<{ cypher: string; params: Record<string, unknown> }> = [];

const { runWriteQuery, closeDriver } = vi.hoisted(() => ({
  runWriteQuery: vi.fn().mockImplementation(
    (_driver: unknown, cypher: string, params: Record<string, unknown>) => {
      capturedQueries.push({ cypher, params });
      return Promise.resolve({ nodesCreated: 0, nodesSet: 0, relationshipsCreated: 0 });
    },
  ),
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

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);

function makeEnv(db: D1Database): Parameters<typeof processProjectionOutbox>[0] {
  return {
    DB: db,
    NEO4J_URI: 'bolt://test',
    NEO4J_PASSWORD: 'test',
  } as unknown as Parameters<typeof processProjectionOutbox>[0];
}

describe('projection rebuild proof — criteria #4 and #8', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(async () => {
    vi.clearAllMocks();
    runWriteQuery.mockImplementation(
      (_driver: unknown, cypher: string, params: Record<string, unknown>) => {
        capturedQueries.push({ cypher, params });
        return Promise.resolve({ nodesCreated: 0, nodesSet: 0, relationshipsCreated: 0 });
      },
    );

    sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.exec(`
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

    // Seed contact and meeting data
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    ).run('contact-rb-1', 'ws-rebuild', 'Rebuild Test', 'rebuild@example.com', 'Engineer', 'candidate',
      '2026-06-21T00:00:00.000Z', '2026-06-21T00:00:00.000Z');
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-rb-1', 'ws-rebuild', '2026-06-21T10:00:00.000Z', '2026-06-21T10:30:00.000Z', '2026-06-21T10:31:00.000Z');
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('participant-rb-1', 'meeting-rb-1', 'contact-rb-1', 'ATTENDEE', '2026-06-21T00:00:00.000Z', '2026-06-21T00:00:00.000Z');

    db = createMockD1(sqlite);

    // Ingest a meeting transcript
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-rb-1',
      ownerId: 'ws-rebuild',
      segments: [{
        stableSegmentId: 'seg-rb-1',
        text: 'I built a Kafka-based event sourcing pipeline for distributed systems.',
        contactId: 'contact-rb-1',
        speakerRole: 'guest',
        channel: 1,
        timestampStartMs: 1_000,
        timestampEndMs: 5_000,
      }],
      semanticAssertions: [{
        sourceSegmentIds: ['seg-rb-1'],
        subjectSegmentId: 'seg-rb-1',
        predicate: 'built',
        narrative: 'Built a Kafka-based event sourcing pipeline for distributed systems.',
        concepts: [{
          surface: 'kafka event sourcing',
          relationship: 'technology used',
          weight: 0.92,
          evidenceLevel: 'implemented',
          strength: 0.85,
        }],
      }],
      extractorVersion: 'rebuild-test-v1',
    });

    capturedQueries.length = 0;
  });

  afterEach(() => {
    sqlite.close();
  });

  it('ingestion creates projection outbox entries', () => {
    const outbox = sqlite.prepare(
      `SELECT aggregate_type, status, operation FROM projection_outbox WHERE projection_type = 'neo4j'`,
    ).all() as Array<{ aggregate_type: string; status: string; operation: string }>;

    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox[0]!.aggregate_type).toBe('workspace_person');
    expect(outbox[0]!.status).toBe('pending');
    expect(outbox[0]!.operation).toBe('rebuild');
  });

  it('outbox processing produces Neo4j write queries', async () => {
    const result = await processProjectionOutbox(makeEnv(db));

    expect(result.completed).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(capturedQueries.length).toBeGreaterThan(0);

    const outboxAfter = sqlite.prepare(
      `SELECT status FROM projection_outbox WHERE projection_type = 'neo4j'`,
    ).all() as Array<{ status: string }>;
    expect(outboxAfter.every((row) => row.status === 'completed')).toBe(true);
  });

  it('force-rebuild produces identical Neo4j write query templates', async () => {
    // First projection run
    await processProjectionOutbox(makeEnv(db));
    const firstRunCyphers = capturedQueries.map((q) => q.cypher);
    capturedQueries.length = 0;

    // Reset outbox to pending (simulate force-rebuild)
    sqlite.exec(
      `UPDATE projection_outbox SET status = 'pending', attempts = 0, locked_at = NULL, locked_by = NULL WHERE projection_type = 'neo4j'`,
    );

    // Second projection run
    await processProjectionOutbox(makeEnv(db));
    const secondRunCyphers = capturedQueries.map((q) => q.cypher);

    expect(secondRunCyphers.length).toBe(firstRunCyphers.length);
    expect(secondRunCyphers).toEqual(firstRunCyphers);
  });

  it('failed outbox entries are retried with backoff', async () => {
    runWriteQuery.mockRejectedValueOnce(new Error('Neo4j connection refused'));

    const result = await processProjectionOutbox(makeEnv(db));
    expect(result.failed).toBeGreaterThan(0);

    const failedEntry = sqlite.prepare(
      `SELECT status, attempts, available_at, last_error FROM projection_outbox WHERE projection_type = 'neo4j' AND status = 'failed' LIMIT 1`,
    ).get() as { status: string; attempts: number; available_at: string; last_error: string } | undefined;

    expect(failedEntry).toBeDefined();
    expect(failedEntry!.status).toBe('failed');
    expect(failedEntry!.attempts).toBe(1);
    expect(failedEntry!.last_error).toContain('Neo4j connection refused');

    // Reset available_at so retry picks it up
    sqlite.exec(`UPDATE projection_outbox SET available_at = datetime('now') WHERE status = 'failed'`);

    capturedQueries.length = 0;
    runWriteQuery.mockImplementation(
      (_driver: unknown, cypher: string, params: Record<string, unknown>) => {
        capturedQueries.push({ cypher, params });
        return Promise.resolve({ nodesCreated: 0, nodesSet: 0, relationshipsCreated: 0 });
      },
    );

    const retryResult = await processProjectionOutbox(makeEnv(db));
    expect(retryResult.completed).toBeGreaterThan(0);
    expect(retryResult.failed).toBe(0);
  });

  it('projection is fully rebuildable from D1 source data alone', async () => {
    // Verify D1 has source data
    const people = sqlite.prepare('SELECT COUNT(*) as count FROM people').get() as { count: number };
    const interactions = sqlite.prepare('SELECT COUNT(*) as count FROM interactions').get() as { count: number };
    const assertions = sqlite.prepare('SELECT COUNT(*) as count FROM semantic_assertions').get() as { count: number };
    const sourceSpans = sqlite.prepare('SELECT COUNT(*) as count FROM source_spans').get() as { count: number };

    expect(people.count).toBeGreaterThan(0);
    expect(interactions.count).toBeGreaterThan(0);
    expect(assertions.count).toBeGreaterThan(0);
    expect(sourceSpans.count).toBeGreaterThan(0);

    // Clear outbox (simulate cold start)
    sqlite.exec('DELETE FROM projection_outbox');

    // Re-insert rebuild entries for all workspace_people
    const wpIds = sqlite.prepare('SELECT id FROM workspace_people').all() as Array<{ id: string }>;
    for (const wp of wpIds) {
      const rebuildId = crypto.randomUUID();
      sqlite.prepare(
        `INSERT INTO projection_outbox (id, ingestion_key, projection_type, aggregate_type, aggregate_id, operation, status, available_at, created_at, updated_at)
         VALUES (?, ?, 'neo4j', 'workspace_person', ?, 'rebuild', 'pending', datetime('now'), datetime('now'), datetime('now'))`,
      ).run(rebuildId, `rebuild:${wp.id}:${rebuildId}`, wp.id);
    }

    capturedQueries.length = 0;
    const result = await processProjectionOutbox(makeEnv(db), 100);

    expect(result.completed).toBe(wpIds.length);
    expect(result.failed).toBe(0);
    expect(capturedQueries.length).toBeGreaterThan(0);

    const pending = sqlite.prepare(
      `SELECT COUNT(*) as count FROM projection_outbox WHERE status != 'completed'`,
    ).get() as { count: number };
    expect(pending.count).toBe(0);
  });
});
