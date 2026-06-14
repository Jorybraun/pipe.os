import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextualDecomposition } from '../../cultureContextualDecomposition';
import type { LLMProvider } from '../../llm/types';
import { ingestCultureTurnToLivingContext } from '../cultureTurn';
import { ingestHistoricalCultureTranscript } from '../cultureTranscriptBackfill';

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

function openDecomposition(input: {
  term: string;
  quote: string;
  phrase?: string;
  type?: string;
  predicate?: string;
  relationship?: string;
  evidenceLevel?: 'mentioned' | 'used' | 'explained' | 'selected' | 'implemented' | 'demonstrated' | 'validated';
  strength?: number;
}): ContextualDecomposition {
  return {
    statements: [{
      id: 'statement-1',
      type: input.type ?? 'unseen operational ownership',
      phrase: input.phrase ?? input.quote,
      surface: input.term,
      sourceQuote: input.quote,
      confidence: 0.91,
      semanticTerms: [{
        surface: input.term,
        relationship: input.relationship ?? 'used as the replay substrate',
        weight: 0.93,
        evidenceLevel: input.evidenceLevel ?? 'implemented',
        strength: input.strength ?? 0.8,
      }],
    }],
    edges: [{
      from: 'candidate',
      to: 'statement-1',
      predicate: input.predicate ?? 'person directly delivered',
    }],
    discarded: false,
    probe: null,
    missingContext: [],
  };
}

describe('culture turn living-context ingestion', () => {
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

  it('preserves exact source offsets and persists unseen semantics idempotently', async () => {
    const question = 'What did you build?';
    const answer = '  In Zürich, I built FluxCapacitorX for order replay.\nIt cut lag by 40%.  ';
    const quote = 'In Zürich, I built FluxCapacitorX for order replay.';
    const decomposition = openDecomposition({
      term: 'FluxCapacitorX',
      quote,
      phrase: 'built FluxCapacitorX for order replay in Zürich',
      type: 'novel replay-system implementation',
      predicate: 'person built the named replay system',
      relationship: 'served as the order replay mechanism',
    });
    const input = {
      candidateId: 'candidate-1',
      sessionId: 'culture-session-1',
      turnIndex: 3,
      question,
      answer,
      observedAt: '2026-06-13T17:00:00.000Z',
      decomposition,
    };

    const first = await ingestCultureTurnToLivingContext(db, input);
    const replay = await ingestCultureTurnToLivingContext(db, input);

    expect(replay).toEqual(first);
    expect(first).toEqual({ assertionCount: 1, signalCount: 1 });
    expect(count(sqlite, 'artifacts')).toBe(1);
    expect(count(sqlite, 'artifact_versions')).toBe(1);
    expect(count(sqlite, 'source_spans')).toBe(3);
    expect(count(sqlite, 'semantic_assertions')).toBe(1);
    expect(count(sqlite, 'semantic_projection_runs')).toBe(1);
    expect(count(sqlite, 'signal_evidence')).toBe(1);
    expect(count(sqlite, 'projection_outbox')).toBe(1);

    const content = sqlite.prepare(
      'SELECT content_text FROM artifact_versions',
    ).get() as { content_text: string };
    expect(content.content_text).toBe(`${question}\n\n${answer}`);

    const answerSpan = sqlite.prepare(
      `SELECT char_start, char_end, byte_start, byte_end, exact_text
         FROM source_spans WHERE stable_segment_id = ?`,
    ).get('turn-3:answer') as {
      char_start: number;
      char_end: number;
      byte_start: number;
      byte_end: number;
      exact_text: string;
    };
    const answerStart = question.length + 2;
    expect(answerSpan).toEqual({
      char_start: answerStart,
      char_end: answerStart + answer.length,
      byte_start: new TextEncoder().encode(`${question}\n\n`).byteLength,
      byte_end: new TextEncoder().encode(`${question}\n\n${answer}`).byteLength,
      exact_text: answer,
    });

    const quoteSpan = sqlite.prepare(
      `SELECT ss.exact_text, ss.char_start, ss.char_end
         FROM assertion_source_spans ass
         JOIN source_spans ss ON ss.id = ass.source_span_id`,
    ).get() as { exact_text: string; char_start: number; char_end: number };
    const quoteStart = answerStart + answer.indexOf(quote);
    expect(quoteSpan).toEqual({
      exact_text: quote,
      char_start: quoteStart,
      char_end: quoteStart + quote.length,
    });

    const assertion = sqlite.prepare(
      'SELECT predicate, narrative FROM semantic_assertions',
    ).get() as { predicate: string; narrative: string };
    expect(assertion).toEqual({
      predicate: 'novel replay-system implementation',
      narrative: 'built FluxCapacitorX for order replay in Zürich',
    });

    const concept = sqlite.prepare(
      `SELECT c.canonical_key, c.label, ac.relationship
         FROM concepts c
         JOIN assertion_concepts ac ON ac.concept_id = c.id`,
    ).get() as { canonical_key: string; label: string; relationship: string };
    expect(concept).toEqual({
      canonical_key: 'term:flux-capacitor-x',
      label: 'FluxCapacitorX',
      relationship: 'served as the order replay mechanism',
    });

    const relationship = sqlite.prepare(
      'SELECT predicate FROM semantic_relationships',
    ).get() as { predicate: string };
    expect(relationship.predicate).toBe('person built the named replay system');
  });

  it('stores source-only turns when semantic extraction produces nothing', async () => {
    const result = await ingestCultureTurnToLivingContext(db, {
      candidateId: 'candidate-1',
      sessionId: 'culture-session-empty',
      turnIndex: 0,
      question: 'Tell me more.',
      answer: '  I would need to think about that.  ',
      observedAt: '2026-06-13T17:10:00.000Z',
      decomposition: {
        statements: [],
        edges: [],
        discarded: true,
        probe: 'Which specific situation are you thinking about?',
        missingContext: ['Which specific situation are you thinking about?'],
      },
    });

    expect(result).toEqual({ assertionCount: 0, signalCount: 0 });
    expect(count(sqlite, 'artifacts')).toBe(1);
    expect(count(sqlite, 'artifact_versions')).toBe(1);
    expect(count(sqlite, 'source_spans')).toBe(2);
    expect(count(sqlite, 'episodes')).toBe(1);
    expect(count(sqlite, 'semantic_projection_runs')).toBe(1);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
    expect(count(sqlite, 'signal_evidence')).toBe(0);
  });

  it('backfills historical turns with provider-learned open semantics', async () => {
    let providerCalls = 0;
    const provider: LLMProvider = {
      async complete() {
        providerCalls++;
        return {
          content: JSON.stringify({
            statements: [{
              id: 'n1',
              type: 'historical reliability intervention',
              phrase: 'fixed a race condition in the async test setup',
              surface: 'race condition',
              sourceQuote: 'a race condition in our async test setup',
              confidence: 0.92,
              semanticTerms: [{
                surface: 'race condition',
                relationship: 'was the identified cause of intermittent CI failures',
                weight: 0.9,
                evidenceLevel: 'implemented',
                strength: 0.82,
              }],
            }],
            edges: [{
              from: 'candidate',
              to: 'n1',
              predicate: 'person identified and corrected',
            }],
            discarded: false,
            probe: null,
            missingContext: [],
          }),
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      },
    };

    const result = await ingestHistoricalCultureTranscript(db, {
      candidateId: 'candidate-1',
      sessionId: 'historical-culture-session',
      extractSemantics: true,
      provider,
      transcript: {
        turns: [{
          idx: 0,
          questionId: 'historical-question',
          questionText: 'What did you fix?',
          probeOf: null,
          candidateResponse:
            'I found a race condition in our async test setup and fixed the harness.',
          starSlots: null,
          timestamp: '2026-05-11T13:39:06.357Z',
        }],
        scratchpad: {
          dimensionCoverage: {},
          probesUsedForCurrentQ: 0,
          runningThemes: [],
        },
      },
    });

    expect(result).toEqual({
      answeredTurns: 1,
      ingestedTurns: 1,
      extractedTurns: 1,
      extractionFailures: 0,
      reusedTurns: 0,
      sourceOnlyTurns: 0,
      assertionCount: 1,
      signalCount: 1,
    });
    const replay = await ingestHistoricalCultureTranscript(db, {
      candidateId: 'candidate-1',
      sessionId: 'historical-culture-session',
      extractSemantics: true,
      provider,
      transcript: {
        turns: [{
          idx: 0,
          questionId: 'historical-question',
          questionText: 'What did you fix?',
          probeOf: null,
          candidateResponse:
            'I found a race condition in our async test setup and fixed the harness.',
          starSlots: null,
          timestamp: '2026-05-11T13:39:06.357Z',
        }],
        scratchpad: {
          dimensionCoverage: {},
          probesUsedForCurrentQ: 0,
          runningThemes: [],
        },
      },
    });
    expect(replay.reusedTurns).toBe(1);
    expect(providerCalls).toBe(1);
    expect(count(sqlite, 'artifact_versions')).toBe(1);
    expect(count(sqlite, 'semantic_assertions')).toBe(1);
    expect(count(sqlite, 'signal_evidence')).toBe(1);
    expect(
      sqlite.prepare('SELECT started_at FROM interactions').get(),
    ).toEqual({ started_at: '2026-05-11T13:39:06.357Z' });
  });

  it('backfills exact historical source without fabricating semantics', async () => {
    const result = await ingestHistoricalCultureTranscript(db, {
      candidateId: 'candidate-1',
      sessionId: 'historical-source-only-session',
      transcript: {
        turns: [{
          idx: 0,
          questionId: 'historical-question',
          questionText: 'Tell me more.',
          probeOf: null,
          candidateResponse: 'I would need to think about that.',
          starSlots: null,
          timestamp: '2026-05-11T13:39:06.357Z',
        }],
        scratchpad: {
          dimensionCoverage: {},
          probesUsedForCurrentQ: 0,
          runningThemes: [],
        },
      },
    });

    expect(result.sourceOnlyTurns).toBe(1);
    expect(count(sqlite, 'artifact_versions')).toBe(1);
    expect(count(sqlite, 'source_spans')).toBe(2);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
  });

  it('keeps immutable source history while replacing corrected derived meaning', async () => {
    await ingestCultureTurnToLivingContext(db, {
      candidateId: 'candidate-1',
      sessionId: 'culture-session-correction',
      turnIndex: 1,
      question: 'Which system did you own?',
      answer: 'I implemented OldEngine for billing retries.',
      observedAt: '2026-06-13T17:20:00.000Z',
      decomposition: openDecomposition({
        term: 'OldEngine',
        quote: 'I implemented OldEngine for billing retries.',
      }),
    });
    await ingestCultureTurnToLivingContext(db, {
      candidateId: 'candidate-1',
      sessionId: 'culture-session-correction',
      turnIndex: 1,
      question: 'Which system did you own?',
      answer: 'Correction: I implemented NewEngine for billing retries.',
      observedAt: '2026-06-13T17:25:00.000Z',
      decomposition: openDecomposition({
        term: 'NewEngine',
        quote: 'I implemented NewEngine for billing retries.',
      }),
    });

    expect(count(sqlite, 'artifacts')).toBe(1);
    expect(count(sqlite, 'artifact_versions')).toBe(2);
    expect(count(sqlite, 'source_spans')).toBe(6);
    expect(count(sqlite, 'semantic_projection_runs')).toBe(1);
    expect(count(sqlite, 'semantic_assertions')).toBe(1);
    expect(count(sqlite, 'signal_evidence')).toBe(1);
    expect(count(sqlite, 'signal_snapshots')).toBe(1);

    const versions = sqlite.prepare(
      'SELECT version_number, content_text FROM artifact_versions ORDER BY version_number',
    ).all() as Array<{ version_number: number; content_text: string }>;
    expect(versions.map((version) => version.version_number)).toEqual([1, 2]);
    expect(versions[0]!.content_text).toContain('OldEngine');
    expect(versions[1]!.content_text).toContain('NewEngine');

    const current = sqlite.prepare(
      `SELECT sa.narrative, se.signal_key
         FROM semantic_assertions sa
         JOIN signal_evidence se ON se.assertion_id = sa.id`,
    ).get() as { narrative: string; signal_key: string };
    expect(current.narrative).toContain('NewEngine');
    expect(current.signal_key).toBe('term:new-engine');

    const staleSnapshot = sqlite.prepare(
      `SELECT id FROM signal_snapshots WHERE signal_key = 'term:old-engine'`,
    ).get();
    expect(staleSnapshot).toBeUndefined();
  });

  it('keeps interaction score separate from accumulated person evidence', async () => {
    await ingestCultureTurnToLivingContext(db, {
      candidateId: 'candidate-1',
      sessionId: 'culture-session-a',
      turnIndex: 0,
      question: 'What did you use?',
      answer: 'I implemented Kafka for order events.',
      observedAt: '2026-06-13T18:00:00.000Z',
      decomposition: openDecomposition({
        term: 'Kafka',
        quote: 'I implemented Kafka for order events.',
        strength: 0.5,
      }),
    });
    await ingestCultureTurnToLivingContext(db, {
      candidateId: 'candidate-1',
      sessionId: 'culture-session-b',
      turnIndex: 0,
      question: 'What did you operate?',
      answer: 'I operated Kafka for payment events.',
      observedAt: '2026-06-13T19:00:00.000Z',
      decomposition: openDecomposition({
        term: 'Kafka',
        quote: 'I operated Kafka for payment events.',
        strength: 0.6,
      }),
    });

    const snapshot = sqlite.prepare(
      `SELECT conversation_score, total_score, evidence_count, source_diversity
         FROM signal_snapshots WHERE signal_key = 'term:kafka'`,
    ).get() as {
      conversation_score: number;
      total_score: number;
      evidence_count: number;
      source_diversity: number;
    };
    expect(snapshot.conversation_score).toBeCloseTo(0.6, 8);
    expect(snapshot.total_score).toBeCloseTo(0.8, 8);
    expect(snapshot.evidence_count).toBe(2);
    expect(snapshot.source_diversity).toBe(2);
  });
});
