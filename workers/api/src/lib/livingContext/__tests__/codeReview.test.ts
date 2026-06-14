import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ingestCodeReviewScoreReportToLivingContext,
  ingestCodeReviewTranscriptToLivingContext,
  type CodeReviewTranscript,
} from '../codeReview';

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

function transcript(withVerdict: boolean): CodeReviewTranscript {
  return {
    rounds: [
      {
        round: 1,
        reviewer_comments: [
          {
            id: 1,
            file: 'src/orders.ts',
            line: 42,
            category: null,
            severity: 'blocking',
            what: 'This retry loop can publish the same order twice.\nThe offset is committed too early.',
            why: 'A crash between publish and acknowledgement replays the message.',
            suggestion: 'Commit only after the publish is acknowledged.',
            positive: false,
          },
        ],
        reviewer_summary: 'The ordering bug is release-blocking.',
        implementer_responses: [
          {
            to_comment_id: 1,
            move: 'change',
            content: 'I moved the commit after the publish acknowledgement.',
            updated_code: 'await publish(order);\nawait commit(offset);',
          },
        ],
      },
    ],
    explainer_exchanges: [
      {
        round: 1,
        question: {
          text: 'Where is the consumer retry policy configured?',
          file: 'src/orders.ts',
          line: 18,
        },
        answer: {
          content: 'The retry policy is supplied when the consumer is constructed.',
          context_provided: ['surrounding_code'],
          depth_level: 'moderate',
        },
      },
    ],
    ...(withVerdict
      ? {
          verdict: {
            decision: 'request_changes',
            summary: 'The revised order is safer, but the failure path still needs a test.',
            submittedAt: '2026-06-13T22:15:00.000Z',
          },
        }
      : {}),
  };
}

describe('code-review living-context ingestion', () => {
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

  it('versions exact review text and attributes only candidate-authored spans', async () => {
    const base = {
      sessionId: 'review-1',
      candidateId: 'candidate-1',
      challengeId: 'challenge-1',
      assessmentId: 'assessment-1',
      implementerPersona: 'junior',
      startedAt: '2026-06-13T22:00:00.000Z',
    };
    await ingestCodeReviewTranscriptToLivingContext(db, {
      ...base,
      transcript: transcript(false),
      status: 'in_progress',
      observedAt: '2026-06-13T22:10:00.000Z',
    });
    await ingestCodeReviewTranscriptToLivingContext(db, {
      ...base,
      transcript: transcript(true),
      status: 'verdict_submitted',
      endedAt: '2026-06-13T22:15:00.000Z',
      observedAt: '2026-06-13T22:15:00.000Z',
    });
    await ingestCodeReviewTranscriptToLivingContext(db, {
      ...base,
      transcript: transcript(true),
      status: 'verdict_submitted',
      endedAt: '2026-06-13T22:15:00.000Z',
      observedAt: '2026-06-13T22:15:00.000Z',
    });

    expect(count(sqlite, 'interactions')).toBe(1);
    expect(count(sqlite, 'artifacts')).toBe(1);
    expect(count(sqlite, 'artifact_versions')).toBe(2);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
    expect(count(sqlite, 'signal_evidence')).toBe(0);
    expect(count(sqlite, 'projection_outbox')).toBe(2);

    const latest = sqlite.prepare(
      `SELECT av.id, av.content_text
         FROM artifact_versions av
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE a.artifact_type = 'code_review_transcript'
        ORDER BY av.version_number DESC
        LIMIT 1`,
    ).get() as { id: string; content_text: string };
    const spans = sqlite.prepare(
      `SELECT exact_text, char_start, char_end, metadata_json
         FROM source_spans
        WHERE artifact_version_id = ?
        ORDER BY char_start`,
    ).all(latest.id) as Array<{
      exact_text: string;
      char_start: number;
      char_end: number;
      metadata_json: string;
    }>;
    expect(spans.length).toBe(10);
    for (const span of spans) {
      expect(latest.content_text.slice(span.char_start, span.char_end)).toBe(span.exact_text);
    }
    expect(spans.map((span) => span.exact_text)).toContain(
      'This retry loop can publish the same order twice.\nThe offset is committed too early.',
    );
    expect(spans.map((span) => span.exact_text)).toContain(
      'The revised order is safer, but the failure path still needs a test.',
    );

    const attributed = sqlite.prepare(
      `SELECT ss.exact_text
         FROM source_span_attributions ssa
         JOIN source_spans ss ON ss.id = ssa.source_span_id
        WHERE ss.artifact_version_id = ?
        ORDER BY ss.char_start`,
    ).all(latest.id) as Array<{ exact_text: string }>;
    expect(attributed.map((row) => row.exact_text)).toContain(
      'Where is the consumer retry policy configured?',
    );
    expect(attributed.map((row) => row.exact_text)).not.toContain(
      'I moved the commit after the publish acknowledgement.',
    );

    const interaction = sqlite.prepare(
      'SELECT started_at, ended_at FROM interactions',
    ).get();
    expect(interaction).toEqual({
      started_at: base.startedAt,
      ended_at: '2026-06-13T22:15:00.000Z',
    });
  });

  it('preserves scorer and recruiter reports without candidate attribution or signals', async () => {
    const common = {
      sessionId: 'review-2',
      candidateId: 'candidate-1',
      challengeId: 'challenge-2',
      assessmentId: 'assessment-2',
      startedAt: '2026-06-13T23:00:00.000Z',
    };
    await ingestCodeReviewScoreReportToLivingContext(db, {
      ...common,
      scoreReportJson: '{"overall":{"score":72},"evidence":"generated"}',
      observedAt: '2026-06-13T23:20:00.000Z',
      producer: 'automated_scorer',
    });
    await ingestCodeReviewScoreReportToLivingContext(db, {
      ...common,
      scoreReportJson: '{"overall":{"score":76},"evidence":"reviewed"}',
      observedAt: '2026-06-13T23:30:00.000Z',
      producer: 'recruiter_override',
      producerId: 'recruiter-1',
    });

    expect(count(sqlite, 'interactions')).toBe(1);
    expect(count(sqlite, 'artifacts')).toBe(2);
    expect(count(sqlite, 'artifact_versions')).toBe(2);
    expect(count(sqlite, 'source_spans')).toBe(2);
    expect(count(sqlite, 'source_span_attributions')).toBe(0);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
    expect(count(sqlite, 'signal_evidence')).toBe(0);
    expect(count(sqlite, 'projection_outbox')).toBe(2);
  });
});
