import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { LivingContextStore } from '../persistence';
import { ingestMeetingTranscriptToLivingContext } from '../meetingTranscript';
import {
  ensureCandidateLivingContext,
  ensureContactLivingContext,
} from '../compatibility';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);

function count(sqlite: BetterSqliteDb, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe('contact-to-applicant identity unification — acceptance criterion #1', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, pipeline_id TEXT,
        name TEXT, email TEXT, status TEXT NOT NULL
      );
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT, email TEXT,
        phone TEXT, company TEXT, role TEXT, type TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, started_at TEXT,
        ended_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE meeting_participants (
        id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id),
        contact_id TEXT NOT NULL REFERENCES contacts(id), role TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    db = createMockD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('contact and candidate with the same email share one person record', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-1', 'workspace-1', 'Ada L.', 'ada@example.com', 'candidate', '2026-01-01', '2026-01-01');
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('candidate-1', 'workspace-1', 'pipeline-1', 'Ada Lovelace', 'ada@example.com', 'active');

    const contactCtx = await ensureContactLivingContext(db, 'contact-1');
    expect(contactCtx).not.toBeNull();

    const candidateCtx = await ensureCandidateLivingContext(db, 'candidate-1');
    expect(candidateCtx).not.toBeNull();

    expect(candidateCtx!.personId).toBe(contactCtx!.personId);
    expect(count(sqlite, 'people')).toBe(1);
    expect(count(sqlite, 'workspace_people')).toBe(1);

    const person = sqlite.prepare(
      `SELECT display_name, primary_email FROM people WHERE id = ?`,
    ).get(contactCtx!.personId) as { display_name: string; primary_email: string };
    expect(person.primary_email).toBe('ada@example.com');
  });

  it('meeting ingestion then candidate creation unifies to one person', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-1', 'workspace-1', 'Ada', 'ada@example.com', 'candidate', '2026-01-01', '2026-01-01');
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-1', 'workspace-1', '2026-06-13T10:00:00Z', '2026-06-13T11:00:00Z', '2026-06-13T11:00:00Z');
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('mp-1', 'meeting-1', 'contact-1', 'guest', '2026-06-13T10:00:00Z');

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [{
        stableSegmentId: 'guest-1',
        text: 'I have experience building distributed caches.',
        speakerRole: 'guest',
        contactId: 'contact-1',
        channel: 1,
        timestampStartMs: 1_000,
        timestampEndMs: 3_000,
        confidence: 0.95,
      }],
      extractorVersion: 'test-v1',
      provider: 'deepgram',
    });

    expect(count(sqlite, 'people')).toBe(1);
    const meetingPersonId = (sqlite.prepare(
      `SELECT person_id FROM workspace_people LIMIT 1`,
    ).get() as { person_id: string }).person_id;

    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('candidate-1', 'workspace-1', 'pipeline-1', 'Ada Lovelace', 'ada@example.com', 'active');

    const candidateCtx = await ensureCandidateLivingContext(db, 'candidate-1');
    expect(candidateCtx).not.toBeNull();
    expect(candidateCtx!.personId).toBe(meetingPersonId);
    expect(count(sqlite, 'people')).toBe(1);
  });

  it('interaction-level and accumulated evidence remain separate', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-1', 'workspace-1', 'Ada', 'ada@example.com', 'candidate', '2026-01-01', '2026-01-01');
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-1', 'workspace-1', '2026-06-13T10:00:00Z', '2026-06-13T11:00:00Z', '2026-06-13T11:00:00Z');
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('mp-1', 'meeting-1', 'contact-1', 'guest', '2026-06-13T10:00:00Z');
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-2', 'workspace-1', '2026-06-14T10:00:00Z', '2026-06-14T11:00:00Z', '2026-06-14T11:00:00Z');
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('mp-2', 'meeting-2', 'contact-1', 'guest', '2026-06-14T10:00:00Z');

    const meeting1Assertion = {
      sourceSegmentIds: ['guest-1'],
      subjectSegmentId: 'guest-1',
      predicate: 'designed',
      narrative: 'Designed a cache invalidation protocol.',
      objectType: 'technical-artifact',
      objectValue: { surface: 'cache invalidation protocol' },
      confidence: 0.88,
      concepts: [{
        surface: 'cache invalidation',
        relationship: 'designed pattern',
        weight: 0.85,
        evidenceLevel: 'implemented' as const,
        strength: 0.82,
      }],
    };

    const meeting2Assertion = {
      sourceSegmentIds: ['guest-2'],
      subjectSegmentId: 'guest-2',
      predicate: 'optimized',
      narrative: 'Optimized the cache invalidation for sub-millisecond TTLs.',
      objectType: 'technical-optimization',
      objectValue: { surface: 'cache invalidation' },
      confidence: 0.90,
      concepts: [{
        surface: 'cache invalidation',
        relationship: 'optimized for performance',
        weight: 0.88,
        evidenceLevel: 'demonstrated' as const,
        strength: 0.87,
      }],
    };

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [{
        stableSegmentId: 'guest-1',
        text: 'I designed a cache invalidation protocol.',
        speakerRole: 'guest',
        contactId: 'contact-1',
        channel: 1,
        timestampStartMs: 1_000,
        timestampEndMs: 3_000,
        confidence: 0.95,
      }],
      semanticAssertions: [meeting1Assertion],
      extractorVersion: 'test-v1',
      provider: 'deepgram',
    });

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-2',
      ownerId: 'workspace-1',
      segments: [{
        stableSegmentId: 'guest-2',
        text: 'I optimized the cache invalidation for sub-millisecond TTLs.',
        speakerRole: 'guest',
        contactId: 'contact-1',
        channel: 1,
        timestampStartMs: 1_000,
        timestampEndMs: 3_500,
        confidence: 0.93,
      }],
      semanticAssertions: [meeting2Assertion],
      extractorVersion: 'test-v1',
      provider: 'deepgram',
    });

    expect(count(sqlite, 'people')).toBe(1);
    expect(count(sqlite, 'interactions')).toBe(2);

    const interactions = sqlite.prepare(
      `SELECT interaction_type, external_reference FROM interactions ORDER BY external_reference`,
    ).all() as Array<{ interaction_type: string; external_reference: string }>;
    expect(interactions).toEqual([
      { interaction_type: 'video_meeting', external_reference: 'meeting-1' },
      { interaction_type: 'video_meeting', external_reference: 'meeting-2' },
    ]);

    expect(count(sqlite, 'semantic_assertions')).toBe(2);
    expect(count(sqlite, 'artifact_versions')).toBe(2);
    expect(count(sqlite, 'signal_evidence')).toBe(2);

    const snapshots = sqlite.prepare(
      `SELECT total_score, evidence_count, source_diversity
         FROM signal_snapshots
        ORDER BY evidence_count DESC LIMIT 1`,
    ).get() as { total_score: number; evidence_count: number; source_diversity: number };
    expect(snapshots.evidence_count).toBe(2);
    expect(snapshots.source_diversity).toBe(2);
    expect(snapshots.total_score).toBeGreaterThan(0);
  });

  it('case-insensitive email matching unifies across entry points', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-1', 'workspace-1', 'Ada', ' ADA@Example.COM ', 'candidate', '2026-01-01', '2026-01-01');

    const ctx1 = await ensureContactLivingContext(db, 'contact-1');
    expect(ctx1).not.toBeNull();

    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('candidate-1', 'workspace-1', 'pipeline-1', 'Ada L', 'ada@example.com', 'active');
    const ctx2 = await ensureCandidateLivingContext(db, 'candidate-1');
    expect(ctx2).not.toBeNull();

    expect(ctx2!.personId).toBe(ctx1!.personId);
    expect(count(sqlite, 'people')).toBe(1);
  });

  it('distinct emails produce separate person records', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-1', 'workspace-1', 'Ada', 'ada@example.com', 'candidate', '2026-01-01', '2026-01-01');
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-2', 'workspace-1', 'Bob', 'bob@example.com', 'candidate', '2026-01-01', '2026-01-01');

    const ctx1 = await ensureContactLivingContext(db, 'contact-1');
    const ctx2 = await ensureContactLivingContext(db, 'contact-2');
    expect(ctx1!.personId).not.toBe(ctx2!.personId);
    expect(count(sqlite, 'people')).toBe(2);
  });
});
