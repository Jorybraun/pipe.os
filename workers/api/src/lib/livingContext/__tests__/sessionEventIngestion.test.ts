import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  ingestSessionEventsToLivingContext,
  loadSessionEventsForCandidate,
} from '../sessionEventIngestion';
import type { SessionEventRow } from '../sessionEventIngestion';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

function rewriteNumberedParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?(\d+)/g, () => {
    index++;
    return '?';
  });
}

describe('sessionEventIngestion', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
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
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        phone TEXT,
        company TEXT,
        role TEXT,
        type TEXT NOT NULL
      );
      CREATE TABLE session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        session_type TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX idx_session_events_candidate ON session_events(candidate_id, created_at);
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(rewriteNumberedParams(transcriptProjectionMigration));
    sqlite.exec(rewriteNumberedParams(contextRecordMigration));

    sqlite.exec(`
      INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
      VALUES ('cand-1', 'owner-1', 'pipe-1', 'Alice', 'alice@test.dev', 'active');
    `);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  function seedEvents(events: Array<Partial<SessionEventRow>>): void {
    for (const event of events) {
      sqlite.exec(`
        INSERT INTO session_events (id, session_id, session_type, candidate_id, event_type, payload_json, created_at)
        VALUES (
          '${event.id ?? `evt-${Math.random().toString(36).slice(2)}`}',
          '${event.session_id ?? 'sess-1'}',
          '${event.session_type ?? 'code_review'}',
          '${event.candidate_id ?? 'cand-1'}',
          '${event.event_type ?? 'answer_submitted'}',
          ${event.payload_json ? `'${event.payload_json}'` : 'NULL'},
          '${event.created_at ?? '2026-06-29T10:00:00.000Z'}'
        );
      `);
    }
  }

  describe('ingestSessionEventsToLivingContext', () => {
    it('returns empty result for unknown candidate', async () => {
      const events: SessionEventRow[] = [{
        id: 'evt-1',
        session_id: 'sess-1',
        session_type: 'code_review',
        candidate_id: 'unknown-cand',
        event_type: 'answer_submitted',
        payload_json: JSON.stringify({ answer: 'test answer' }),
        created_at: '2026-06-29T10:00:00.000Z',
      }];

      const result = await ingestSessionEventsToLivingContext(db, 'unknown-cand', 'sess-1', events);
      expect(result.eventsProcessed).toBe(0);
      expect(result.episodesCreated).toBe(0);
    });

    it('ingests answer_submitted events as assertions with source spans', async () => {
      const events: SessionEventRow[] = [{
        id: 'evt-1',
        session_id: 'sess-1',
        session_type: 'code_review',
        candidate_id: 'cand-1',
        event_type: 'answer_submitted',
        payload_json: JSON.stringify({
          answer: 'I used React hooks with custom state management',
          skills: ['react', 'state-management'],
        }),
        created_at: '2026-06-29T10:00:00.000Z',
      }];

      const result = await ingestSessionEventsToLivingContext(db, 'cand-1', 'sess-1', events);
      expect(result.eventsProcessed).toBe(1);
      expect(result.episodesCreated).toBe(1);
      expect(result.assertionsCreated).toBe(1);
      expect(result.conceptsRegistered).toBeGreaterThanOrEqual(1);

      const assertions = sqlite.prepare(
        `SELECT * FROM semantic_assertions WHERE workspace_person_id = (
          SELECT id FROM workspace_people LIMIT 1
        )`,
      ).all() as Array<{ narrative: string; predicate: string; confidence: number }>;
      expect(assertions.length).toBe(1);
      expect(assertions[0].predicate).toBe('demonstrated_knowledge');
      expect(assertions[0].narrative).toContain('React hooks');
      expect(assertions[0].confidence).toBe(0.7);

      const spans = sqlite.prepare(`SELECT * FROM source_spans`).all() as Array<{ exact_text: string }>;
      expect(spans.length).toBeGreaterThanOrEqual(1);
    });

    it('ingests scoring_complete events with score in narrative', async () => {
      const events: SessionEventRow[] = [{
        id: 'evt-2',
        session_id: 'sess-1',
        session_type: 'culture_interview',
        candidate_id: 'cand-1',
        event_type: 'scoring_complete',
        payload_json: JSON.stringify({
          score: 85,
          maxScore: 100,
          feedback: 'Strong communication skills demonstrated',
          concepts: ['communication', 'leadership'],
        }),
        created_at: '2026-06-29T10:05:00.000Z',
      }];

      const result = await ingestSessionEventsToLivingContext(db, 'cand-1', 'sess-1', events);
      expect(result.eventsProcessed).toBe(1);
      expect(result.assertionsCreated).toBe(1);
      expect(result.conceptsRegistered).toBeGreaterThanOrEqual(1);

      const assertions = sqlite.prepare(
        `SELECT * FROM semantic_assertions WHERE workspace_person_id = (
          SELECT id FROM workspace_people LIMIT 1
        )`,
      ).all() as Array<{ narrative: string; predicate: string; confidence: number }>;
      expect(assertions[0].predicate).toBe('received_evaluation');
      expect(assertions[0].narrative).toContain('85/100');
      expect(assertions[0].confidence).toBe(0.9);
    });

    it('skips non-evidence events (started, error, completed)', async () => {
      const events: SessionEventRow[] = [
        {
          id: 'evt-start',
          session_id: 'sess-1',
          session_type: 'code_review',
          candidate_id: 'cand-1',
          event_type: 'started',
          payload_json: null,
          created_at: '2026-06-29T09:55:00.000Z',
        },
        {
          id: 'evt-error',
          session_id: 'sess-1',
          session_type: 'code_review',
          candidate_id: 'cand-1',
          event_type: 'error',
          payload_json: JSON.stringify({ message: 'timeout' }),
          created_at: '2026-06-29T09:56:00.000Z',
        },
        {
          id: 'evt-complete',
          session_id: 'sess-1',
          session_type: 'code_review',
          candidate_id: 'cand-1',
          event_type: 'completed',
          payload_json: null,
          created_at: '2026-06-29T10:30:00.000Z',
        },
      ];

      const result = await ingestSessionEventsToLivingContext(db, 'cand-1', 'sess-1', events);
      expect(result.eventsProcessed).toBe(0);
      expect(result.episodesCreated).toBe(0);
      expect(result.assertionsCreated).toBe(0);
    });

    it('is idempotent — skips already-ingested events', async () => {
      const events: SessionEventRow[] = [{
        id: 'evt-1',
        session_id: 'sess-1',
        session_type: 'code_review',
        candidate_id: 'cand-1',
        event_type: 'answer_submitted',
        payload_json: JSON.stringify({ answer: 'test answer' }),
        created_at: '2026-06-29T10:00:00.000Z',
      }];

      const first = await ingestSessionEventsToLivingContext(db, 'cand-1', 'sess-1', events);
      expect(first.episodesCreated).toBe(1);

      const second = await ingestSessionEventsToLivingContext(db, 'cand-1', 'sess-1', events);
      expect(second.skippedDuplicates).toBe(1);
      expect(second.episodesCreated).toBe(0);
    });

    it('handles multiple events in a single session', async () => {
      const events: SessionEventRow[] = [
        {
          id: 'evt-q1',
          session_id: 'sess-1',
          session_type: 'screening',
          candidate_id: 'cand-1',
          event_type: 'question_asked',
          payload_json: JSON.stringify({ question: 'Tell me about your experience with TypeScript', topic: 'typescript' }),
          created_at: '2026-06-29T10:00:00.000Z',
        },
        {
          id: 'evt-a1',
          session_id: 'sess-1',
          session_type: 'screening',
          candidate_id: 'cand-1',
          event_type: 'answer_submitted',
          payload_json: JSON.stringify({
            answer: 'I have 5 years of TypeScript experience, including generic types and conditional types',
            skills: ['typescript', 'generics'],
          }),
          created_at: '2026-06-29T10:01:00.000Z',
        },
        {
          id: 'evt-s1',
          session_id: 'sess-1',
          session_type: 'screening',
          candidate_id: 'cand-1',
          event_type: 'scoring_complete',
          payload_json: JSON.stringify({ score: 9, maxScore: 10, feedback: 'Deep TS knowledge' }),
          created_at: '2026-06-29T10:02:00.000Z',
        },
      ];

      const result = await ingestSessionEventsToLivingContext(db, 'cand-1', 'sess-1', events);
      expect(result.eventsProcessed).toBe(3);
      expect(result.episodesCreated).toBe(3);
      expect(result.assertionsCreated).toBe(3);

      const assertions = sqlite.prepare(
        `SELECT predicate FROM semantic_assertions ORDER BY observed_at`,
      ).all() as Array<{ predicate: string }>;
      expect(assertions.map(a => a.predicate)).toEqual([
        'engaged_with_topic',
        'demonstrated_knowledge',
        'received_evaluation',
      ]);
    });

    it('handles events with null payload gracefully', async () => {
      const events: SessionEventRow[] = [{
        id: 'evt-1',
        session_id: 'sess-1',
        session_type: 'voice',
        candidate_id: 'cand-1',
        event_type: 'stage_advanced',
        payload_json: null,
        created_at: '2026-06-29T10:00:00.000Z',
      }];

      const result = await ingestSessionEventsToLivingContext(db, 'cand-1', 'sess-1', events);
      expect(result.eventsProcessed).toBe(1);
      expect(result.assertionsCreated).toBe(1);
      expect(result.conceptsRegistered).toBe(0);
    });
  });

  describe('loadSessionEventsForCandidate', () => {
    it('returns events ordered by created_at DESC with pagination', async () => {
      seedEvents([
        { id: 'evt-1', candidate_id: 'cand-1', event_type: 'answer_submitted', created_at: '2026-06-29T10:00:00.000Z' },
        { id: 'evt-2', candidate_id: 'cand-1', event_type: 'scoring_complete', created_at: '2026-06-29T10:01:00.000Z' },
        { id: 'evt-3', candidate_id: 'cand-1', event_type: 'answer_submitted', created_at: '2026-06-29T10:02:00.000Z' },
      ]);

      const { events, nextCursor } = await loadSessionEventsForCandidate(db, 'cand-1', null, 2);
      expect(events.length).toBe(2);
      expect(events[0].id).toBe('evt-3');
      expect(events[1].id).toBe('evt-2');
      expect(nextCursor).not.toBeNull();

      const page2 = await loadSessionEventsForCandidate(db, 'cand-1', nextCursor, 2);
      expect(page2.events.length).toBe(1);
      expect(page2.events[0].id).toBe('evt-1');
      expect(page2.nextCursor).toBeNull();
    });

    it('returns empty for candidate with no events', async () => {
      const { events, nextCursor } = await loadSessionEventsForCandidate(db, 'cand-1');
      expect(events).toEqual([]);
      expect(nextCursor).toBeNull();
    });

    it('does not return events for other candidates', async () => {
      seedEvents([
        { id: 'evt-1', candidate_id: 'cand-1', event_type: 'answer_submitted', created_at: '2026-06-29T10:00:00.000Z' },
        { id: 'evt-2', candidate_id: 'cand-other', event_type: 'answer_submitted', created_at: '2026-06-29T10:01:00.000Z' },
      ]);

      const { events } = await loadSessionEventsForCandidate(db, 'cand-1');
      expect(events.length).toBe(1);
      expect(events[0].id).toBe('evt-1');
    });
  });
});
