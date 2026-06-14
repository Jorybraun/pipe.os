import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canonicalizeMeetingTranscript,
  ingestMeetingTranscriptToLivingContext,
  parseStoredMeetingTranscript,
} from '../meetingTranscript';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';

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

describe('meeting transcript living-context ingestion', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
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
      'Distributed systems engineer',
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
  });

  afterEach(() => {
    sqlite.close();
  });

  it('preserves exact paragraph offsets without inventing partial timestamps', () => {
    const transcript = '  First paragraph.\nline two.  \n\n\n Second paragraph. ';
    const canonical = canonicalizeMeetingTranscript({ transcript });

    expect(canonical.contentText).toBe(transcript);
    expect(canonical.segments).toHaveLength(2);
    expect(canonical.segments.map((segment) => ({
      id: segment.stableSegmentId,
      text: segment.text,
      charStart: segment.charStart,
      charEnd: segment.charEnd,
      lineStart: segment.lineStart,
      lineEnd: segment.lineEnd,
      timestampStartMs: segment.timestampStartMs,
      timestampEndMs: segment.timestampEndMs,
    }))).toEqual([
      {
        id: 'paragraph-0001',
        text: 'First paragraph.\nline two.',
        charStart: 2,
        charEnd: 28,
        lineStart: 1,
        lineEnd: 2,
        timestampStartMs: null,
        timestampEndMs: null,
      },
      {
        id: 'paragraph-0002',
        text: 'Second paragraph.',
        charStart: 34,
        charEnd: 51,
        lineStart: 5,
        lineEnd: 5,
        timestampStartMs: null,
        timestampEndMs: null,
      },
    ]);
  });

  it('normalizes legacy transcript JSON without turning a lone timestamp into a range', () => {
    const parsed = parseStoredMeetingTranscript(JSON.stringify([
      {
        speaker: 'mixed',
        text: 'Legacy mixed text.',
        timestamp_ms: 0,
      },
      {
        stable_segment_id: 'guest-turn',
        role: 'guest',
        contact_id: 'contact-1',
        text: 'Structured guest text.',
        timestamp_start_ms: 1200,
        timestamp_end_ms: 2800,
      },
    ]));

    expect(parsed.transcript).toBe('Legacy mixed text.\n\nStructured guest text.');
    expect(parsed.segments).toEqual([
      expect.objectContaining({
        stableSegmentId: 'legacy-0001',
        text: 'Legacy mixed text.',
        speakerLabel: 'mixed',
        timestampStartMs: null,
        timestampEndMs: null,
        metadata: {
          legacyTimestamp: null,
          legacyTimestampMs: 0,
        },
      }),
      expect.objectContaining({
        stableSegmentId: 'guest-turn',
        text: 'Structured guest text.',
        speakerRole: 'guest',
        contactId: 'contact-1',
        timestampStartMs: 1200,
        timestampEndMs: 2800,
      }),
    ]);
  });

  it('stores one shared immutable artifact and does not attribute mixed audio', async () => {
    const first = await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      transcript: 'One mixed paragraph.\n\nA second mixed paragraph.',
      summary: 'A mixed recording.',
      provider: 'workers-ai-whisper',
    });
    const replay = await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      transcript: 'One mixed paragraph.\n\nA second mixed paragraph.',
      summary: 'A mixed recording.',
      provider: 'workers-ai-whisper',
    });

    expect(replay).toEqual(first);
    expect(count(sqlite, 'artifacts')).toBe(1);
    expect(count(sqlite, 'artifact_versions')).toBe(1);
    expect(count(sqlite, 'source_spans')).toBe(2);
    expect(count(sqlite, 'interactions')).toBe(1);
    expect(count(sqlite, 'artifact_interactions')).toBe(1);
    expect(count(sqlite, 'source_span_attributions')).toBe(0);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
    expect(count(sqlite, 'signal_evidence')).toBe(0);

    const corrected = await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      transcript: 'Corrected mixed paragraph.',
      summary: 'A corrected recording.',
      provider: 'workers-ai-whisper',
    });
    expect(corrected.versionNumber).toBe(2);
    expect(count(sqlite, 'artifact_versions')).toBe(2);
    expect(count(sqlite, 'source_spans')).toBe(3);
  });

  it('persists unseen source-backed concepts and rebuilds interaction and total scores', async () => {
    const input = {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [
        {
          stableSegmentId: 'host-1',
          text: 'What did you build?',
          speakerRole: 'host',
          channel: 0,
          timestampStartMs: 1_000,
          timestampEndMs: 2_000,
        },
        {
          stableSegmentId: 'guest-1',
          text: 'I implemented temporal shard knitting for order replay.',
          speakerRole: 'guest',
          contactId: 'contact-1',
          channel: 1,
          timestampStartMs: 2_100,
          timestampEndMs: 6_500,
          confidence: 0.96,
        },
      ],
      semanticAssertions: [{
        sourceSegmentIds: ['host-1', 'guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented a mechanism for',
        narrative: 'Implemented temporal shard knitting for order replay.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'temporal shard knitting' },
        confidence: 0.91,
        concepts: [{
          surface: 'Temporal shard knitting',
          relationship: 'mechanism used for order replay',
          weight: 0.87,
          evidenceLevel: 'implemented' as const,
          strength: 0.9,
        }],
      }],
      extractorVersion: 'open-meeting-test-v1',
      provider: 'deepgram-multichannel',
    };
    const first = await ingestMeetingTranscriptToLivingContext(db, input);
    const replay = await ingestMeetingTranscriptToLivingContext(db, input);

    expect(first.assertionCount).toBe(1);
    expect(replay).toEqual(first);
    expect(count(sqlite, 'semantic_assertions')).toBe(1);
    expect(count(sqlite, 'assertion_source_spans')).toBe(2);
    expect(count(sqlite, 'source_span_attributions')).toBe(1);
    expect(count(sqlite, 'signal_evidence')).toBe(1);
    expect(sqlite.prepare(
      `SELECT canonical_key, label FROM concepts`,
    ).get()).toEqual({
      canonical_key: 'term:temporal-shard-knitting',
      label: 'Temporal shard knitting',
    });
    expect(sqlite.prepare(
      `SELECT relationship, weight FROM assertion_concepts`,
    ).get()).toEqual({
      relationship: 'mechanism used for order replay',
      weight: 0.87,
    });
    expect(sqlite.prepare(
      `SELECT conversation_score, total_score, evidence_count, source_diversity
         FROM signal_snapshots`,
    ).get()).toEqual({
      conversation_score: 0.9,
      total_score: 0.9,
      evidence_count: 1,
      source_diversity: 1,
    });
  });

  it('removes stale derived meaning while preserving the immutable transcript', async () => {
    const base = {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [{
        stableSegmentId: 'guest-1',
        text: 'I used an unseen queue mechanism.',
        contactId: 'contact-1',
        timestampStartMs: 1_000,
        timestampEndMs: 2_000,
      }],
      provider: 'source-test',
    };
    await ingestMeetingTranscriptToLivingContext(db, {
      ...base,
      semanticAssertions: [{
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'used',
        narrative: 'Used an unseen queue mechanism.',
        concepts: [{
          surface: 'Unseen queue mechanism',
          relationship: 'mechanism named in source',
          weight: 1,
          evidenceLevel: 'used',
          strength: 0.7,
        }],
      }],
      extractorVersion: 'extractor-v1',
    });
    await ingestMeetingTranscriptToLivingContext(db, {
      ...base,
      semanticAssertions: [],
      extractorVersion: 'extractor-v2',
    });

    expect(count(sqlite, 'artifact_versions')).toBe(1);
    expect(count(sqlite, 'source_spans')).toBe(1);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
    expect(count(sqlite, 'episodes')).toBe(0);
    expect(count(sqlite, 'signal_evidence')).toBe(0);
    expect(count(sqlite, 'signal_snapshots')).toBe(0);
    expect(count(sqlite, 'semantic_projection_runs')).toBe(1);
  });

  it('allows source-only backfill replay without deleting newer semantic projections', async () => {
    const base = {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [{
        stableSegmentId: 'guest-1',
        text: 'I implemented source-preserving replay.',
        contactId: 'contact-1',
      }],
      provider: 'source-test',
    };
    await ingestMeetingTranscriptToLivingContext(db, {
      ...base,
      semanticAssertions: [{
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Implemented source-preserving replay.',
        concepts: [{
          surface: 'source-preserving replay',
          relationship: 'mechanism implemented in source',
          weight: 0.9,
          evidenceLevel: 'implemented',
          strength: 0.8,
        }],
      }],
      extractorVersion: 'extractor-v2',
    });
    await ingestMeetingTranscriptToLivingContext(db, base);

    expect(count(sqlite, 'artifact_versions')).toBe(1);
    expect(count(sqlite, 'semantic_assertions')).toBe(1);
    expect(count(sqlite, 'signal_evidence')).toBe(1);
    expect(count(sqlite, 'semantic_projection_runs')).toBe(1);
  });

  it('does not trust an unbound diarized speaker label as person identity', async () => {
    const result = await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [{
        stableSegmentId: 'speaker-7',
        text: 'I built a novel scheduler.',
        speakerLabel: 'speaker-7',
        timestampStartMs: 1_000,
        timestampEndMs: 2_500,
      }],
      semanticAssertions: [{
        sourceSegmentIds: ['speaker-7'],
        subjectSegmentId: 'speaker-7',
        predicate: 'built',
        narrative: 'Built a novel scheduler.',
        concepts: [{
          surface: 'Novel scheduler',
          relationship: 'mechanism named in source',
          weight: 0.8,
          evidenceLevel: 'implemented',
          strength: 0.8,
        }],
      }],
    });

    expect(result.assertionCount).toBe(0);
    expect(count(sqlite, 'source_spans')).toBe(1);
    expect(count(sqlite, 'source_span_attributions')).toBe(0);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
  });
});
