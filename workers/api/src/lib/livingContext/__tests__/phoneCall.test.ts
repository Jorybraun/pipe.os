import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ingestPhoneCallToLivingContext,
  ingestPhoneRecruiterNote,
} from '../phoneCall';

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

function count(sqlite: SqliteDatabase, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  }).count;
}

describe('phone call living-context ingestion', () => {
  let sqlite: SqliteDatabase;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pipeline_id TEXT,
        name TEXT,
        email TEXT,
        status TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-1',
      'workspace-1',
      'pipeline-1',
      'Ada Example',
      'ada@example.com',
      'active',
    );
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('preserves audio and exact speaker-unresolved transcript idempotently', async () => {
    const input = {
      callId: 'call-1',
      candidateId: 'candidate-1',
      direction: 'OUTBOUND',
      startedAt: '2026-06-13T20:00:00.000Z',
      endedAt: '2026-06-13T20:10:00.000Z',
      twilioCallSid: 'CA123',
      recording: {
        storageKey: 'call-recordings/call-1/RE123.mp3',
        recordingSid: 'RE123',
        mediaType: 'audio/mpeg',
        byteLength: 2048,
        durationSeconds: 600,
      },
      transcript: 'Recruiter: Tell me about Kafka.\nCandidate: I used it for orders.',
      transcriptProvider: '@cf/openai/whisper-large-v3-turbo',
    };

    await ingestPhoneCallToLivingContext(db, input);
    await ingestPhoneCallToLivingContext(db, input);

    expect(count(sqlite, 'interactions')).toBe(1);
    expect(count(sqlite, 'artifacts')).toBe(2);
    expect(count(sqlite, 'artifact_versions')).toBe(2);
    expect(count(sqlite, 'source_spans')).toBe(1);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
    expect(count(sqlite, 'signal_evidence')).toBe(0);
    expect(count(sqlite, 'projection_outbox')).toBe(1);

    const interaction = sqlite.prepare(
      'SELECT interaction_type, started_at, ended_at FROM interactions',
    ).get();
    expect(interaction).toEqual({
      interaction_type: 'phone_call',
      started_at: input.startedAt,
      ended_at: input.endedAt,
    });
    const transcript = sqlite.prepare(
      `SELECT av.content_text, av.storage_key, av.metadata_json
         FROM artifact_versions av
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE a.artifact_type = 'phone_call_transcript'`,
    ).get() as {
      content_text: string;
      storage_key: string | null;
      metadata_json: string;
    };
    expect(transcript.content_text).toBe(input.transcript);
    expect(transcript.storage_key).toBeNull();
    expect(JSON.parse(transcript.metadata_json)).toMatchObject({
      speakerAttribution: 'unresolved',
    });
    const audio = sqlite.prepare(
      `SELECT av.storage_key
         FROM artifact_versions av
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE a.artifact_type = 'phone_call_recording'`,
    ).get() as { storage_key: string };
    expect(audio.storage_key).toBe(input.recording.storageKey);
  });

  it('stores recruiter note edits as attributed immutable evidence without signals', async () => {
    await ingestPhoneRecruiterNote(db, {
      callId: 'call-2',
      candidateId: 'candidate-1',
      direction: 'OUTBOUND',
      note: 'Asked a clear follow-up about retry behavior.',
      observedAt: '2026-06-13T21:00:00.000Z',
      recruiterActorId: 'recruiter-1',
    });
    await ingestPhoneRecruiterNote(db, {
      callId: 'call-2',
      candidateId: 'candidate-1',
      direction: 'OUTBOUND',
      note: 'Clarified that the follow-up concerned payment retries.',
      observedAt: '2026-06-13T21:05:00.000Z',
      recruiterActorId: 'recruiter-1',
    });

    expect(count(sqlite, 'interactions')).toBe(1);
    expect(count(sqlite, 'artifacts')).toBe(2);
    expect(count(sqlite, 'artifact_versions')).toBe(2);
    expect(count(sqlite, 'source_spans')).toBe(2);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
    expect(count(sqlite, 'signal_evidence')).toBe(0);
    const metadata = sqlite.prepare(
      'SELECT metadata_json FROM artifacts ORDER BY created_at LIMIT 1',
    ).get() as { metadata_json: string };
    expect(JSON.parse(metadata.metadata_json)).toMatchObject({
      authorType: 'recruiter',
      authorId: 'recruiter-1',
    });
  });
});
