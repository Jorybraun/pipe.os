import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  canonicalizeMeetingTranscript,
  ingestMeetingTranscriptToLivingContext,
  parseStoredMeetingTranscript,
} from '../meetingTranscript';
import { ensureCandidateLivingContext } from '../compatibility';
import { loadCandidateLivingContext, loadContactLivingContext } from '../readModel';
import {
  loadInteractionLivingContext,
  loadMeetingTranscriptContext,
  searchTranscriptSourceSpans,
} from '../readModel';



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
    expect(count(sqlite, 'context_records')).toBe(1);
    expect(count(sqlite, 'context_record_source_spans')).toBe(2);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
    expect(count(sqlite, 'signal_evidence')).toBe(0);
    expect(sqlite.prepare(
      `SELECT record_type, predicate FROM context_records`,
    ).get()).toEqual({
      record_type: 'meeting_transcript',
      predicate: 'preserves meeting transcript',
    });

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
    expect(count(sqlite, 'context_records')).toBe(2);
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
    expect(count(sqlite, 'context_records')).toBe(2);
    expect(count(sqlite, 'context_record_source_spans')).toBe(4);
    expect(count(sqlite, 'context_record_concepts')).toBe(1);
    expect(count(sqlite, 'source_span_attributions')).toBe(1);
    expect(count(sqlite, 'signal_evidence')).toBe(1);
    expect(sqlite.prepare(
      `SELECT record_type, predicate
         FROM context_records
        ORDER BY record_type`,
    ).all()).toEqual([
      {
        record_type: 'meeting_transcript',
        predicate: 'preserves meeting transcript',
      },
      {
        record_type: 'meeting_transcript_assertion',
        predicate: 'implemented a mechanism for',
      },
    ]);
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
      `SELECT crc.relationship, crc.weight, c.canonical_key
         FROM context_record_concepts crc
         JOIN concepts c ON c.id = crc.concept_id`,
    ).get()).toEqual({
      relationship: 'mechanism used for order replay',
      weight: 0.87,
      canonical_key: 'term:temporal-shard-knitting',
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

  it('grows a person-centered living context graph from a meeting transcript', async () => {
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
      startedAt: '2026-06-13T10:00:00.000Z',
      endedAt: '2026-06-13T10:30:00.000Z',
    };

    const result = await ingestMeetingTranscriptToLivingContext(db, input);

    // --- person / workspace person identity ---
    const person = sqlite.prepare(
      `SELECT id, display_name, primary_email FROM people`,
    ).get() as { id: string; display_name: string; primary_email: string };
    expect(person).toBeTruthy();
    expect(person.display_name).toBe('Ada Example');
    expect(person.primary_email).toBe('ada@example.com');
    expect(count(sqlite, 'people')).toBe(1);

    const workspacePerson = sqlite.prepare(
      `SELECT id, workspace_id, person_id FROM workspace_people`,
    ).get() as { id: string; workspace_id: string; person_id: string };
    expect(workspacePerson).toBeTruthy();
    expect(workspacePerson.workspace_id).toBe('workspace-1');
    expect(workspacePerson.person_id).toBe(person.id);
    expect(count(sqlite, 'workspace_people')).toBe(1);

    // --- meeting interaction ---
    const interaction = sqlite.prepare(
      `SELECT id, workspace_person_id, interaction_type, external_reference
         FROM interactions`,
    ).get() as {
      id: string;
      workspace_person_id: string;
      interaction_type: string;
      external_reference: string;
    };
    expect(interaction.workspace_person_id).toBe(workspacePerson.id);
    expect(interaction.interaction_type).toBe('video_meeting');
    expect(interaction.external_reference).toBe('meeting-1');
    expect(count(sqlite, 'interactions')).toBe(1);

    // --- immutable transcript artifact version ---
    expect(count(sqlite, 'artifacts')).toBe(1);
    expect(count(sqlite, 'artifact_versions')).toBe(1);
    expect(result.versionNumber).toBe(1);
    const artifactVersion = sqlite.prepare(
      `SELECT id, content_hash, media_type FROM artifact_versions`,
    ).get() as { id: string; content_hash: string; media_type: string };
    expect(artifactVersion.media_type).toBe('text/plain');

    // --- exact source spans ---
    expect(result.sourceSpanCount).toBe(2);
    expect(count(sqlite, 'source_spans')).toBe(2);
    const spans = sqlite.prepare(
      `SELECT stable_segment_id, char_start, char_end, exact_text
         FROM source_spans ORDER BY char_start`,
    ).all() as Array<{
      stable_segment_id: string;
      char_start: number;
      char_end: number;
      exact_text: string;
    }>;
    expect(spans[0]!.stable_segment_id).toBe('host-1');
    expect(spans[0]!.exact_text).toBe('What did you build?');
    expect(spans[1]!.stable_segment_id).toBe('guest-1');
    expect(spans[1]!.exact_text).toBe(
      'I implemented temporal shard knitting for order replay.',
    );

    // --- semantic assertion with open predicate ---
    expect(result.assertionCount).toBe(1);
    const assertion = sqlite.prepare(
      `SELECT predicate, narrative, object_type, confidence
         FROM semantic_assertions`,
    ).get() as {
      predicate: string;
      narrative: string;
      object_type: string;
      confidence: number;
    };
    expect(assertion.predicate).toBe('implemented a mechanism for');
    expect(assertion.narrative).toBe(
      'Implemented temporal shard knitting for order replay.',
    );
    expect(assertion.object_type).toBe('source-described mechanism');

    // --- persisted concept / signal evidence ---
    expect(sqlite.prepare(
      `SELECT canonical_key, label FROM concepts`,
    ).get()).toEqual({
      canonical_key: 'term:temporal-shard-knitting',
      label: 'Temporal shard knitting',
    });
    expect(count(sqlite, 'signal_evidence')).toBe(1);

    // --- signal snapshot ---
    expect(count(sqlite, 'signal_snapshots')).toBe(1);
    expect(sqlite.prepare(
      `SELECT conversation_score, total_score, evidence_count, source_diversity
         FROM signal_snapshots`,
    ).get()).toEqual({
      conversation_score: 0.9,
      total_score: 0.9,
      evidence_count: 1,
      source_diversity: 1,
    });

    // --- projection outbox entry for rebuildable graph projection ---
    expect(count(sqlite, 'projection_outbox')).toBe(1);
    const outbox = sqlite.prepare(
      `SELECT projection_type, aggregate_type, aggregate_id, operation
         FROM projection_outbox`,
    ).get() as {
      projection_type: string;
      aggregate_type: string;
      aggregate_id: string;
      operation: string;
    };
    expect(outbox.projection_type).toBe('neo4j');
    expect(outbox.aggregate_type).toBe('workspace_person');
    expect(outbox.aggregate_id).toBe(workspacePerson.id);
    expect(outbox.operation).toBe('rebuild');

    // --- idempotency: reprocessing produces identical result ---
    const replay = await ingestMeetingTranscriptToLivingContext(db, input);
    expect(replay).toEqual(result);
    expect(count(sqlite, 'people')).toBe(1);
    expect(count(sqlite, 'workspace_people')).toBe(1);
    expect(count(sqlite, 'interactions')).toBe(1);
    expect(count(sqlite, 'artifact_versions')).toBe(1);
    expect(count(sqlite, 'source_spans')).toBe(2);
    expect(count(sqlite, 'semantic_assertions')).toBe(1);
    expect(count(sqlite, 'signal_evidence')).toBe(1);
    expect(count(sqlite, 'signal_snapshots')).toBe(1);
    expect(count(sqlite, 'projection_outbox')).toBe(1);

    // --- corrected transcript creates new immutable version ---
    const corrected = await ingestMeetingTranscriptToLivingContext(db, {
      ...input,
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
          text: 'I implemented temporal shard knitting for order-replay pipelines.',
          speakerRole: 'guest',
          contactId: 'contact-1',
          channel: 1,
          timestampStartMs: 2_100,
          timestampEndMs: 6_500,
          confidence: 0.98,
        },
      ],
    });
    expect(corrected.versionNumber).toBe(2);
    expect(count(sqlite, 'artifact_versions')).toBe(2);
    expect(count(sqlite, 'people')).toBe(1);
    expect(count(sqlite, 'workspace_people')).toBe(1);
  });

  it('keeps meeting evidence on the same person graph when a contact later joins the talent pool', async () => {
    const input = {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [
        {
          stableSegmentId: 'host-1',
          text: 'Can you describe a system you owned?',
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
        sourceSegmentIds: ['guest-1'],
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
      startedAt: '2026-06-13T10:00:00.000Z',
      endedAt: '2026-06-13T10:30:00.000Z',
    };

    await ingestMeetingTranscriptToLivingContext(db, input);
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-joined-pool',
      'workspace-1',
      null,
      'Ada Candidate',
      'ADA@example.com',
      'talent_pool',
    );
    const candidateIdentity = await ensureCandidateLivingContext(db, 'candidate-joined-pool');

    const contactGraph = await loadContactLivingContext(db, 'contact-1');
    const candidateGraph = await loadCandidateLivingContext(db, 'candidate-joined-pool');

    expect(candidateIdentity).not.toBeNull();
    expect(contactGraph).not.toBeNull();
    expect(candidateGraph).not.toBeNull();
    expect(candidateGraph?.person.personId).toBe(contactGraph?.person.personId);
    expect(candidateGraph?.person.workspacePersonId).toBe(contactGraph?.person.workspacePersonId);
    expect(candidateGraph?.person.applicationId).toBe(candidateIdentity?.applicationId);
    expect(candidateGraph?.person.pipelineId).toBeNull();
    expect(candidateGraph?.person.applicationStatus).toBe('talent_pool');
    expect(candidateGraph?.person.roles.map((role) => role.roleType).sort()).toEqual([
      'candidate',
      'candidate',
    ]);

    expect(candidateGraph?.summary).toMatchObject({
      interactionCount: 1,
      artifactCount: 1,
      contextRecordCount: 2,
      assertionCount: 1,
      signalCount: 1,
      sourceSpanCount: 2,
    });
    expect(candidateGraph?.interactions).toHaveLength(1);
    expect(candidateGraph?.interactions[0]).toMatchObject({
      interactionType: 'video_meeting',
      externalReference: 'meeting-1',
    });
    expect(candidateGraph?.interactions[0]?.assertionIds).toHaveLength(1);
    expect(candidateGraph?.interactions[0]?.signalKeys).toEqual(['term:temporal-shard-knitting']);

    expect(candidateGraph?.assertions[0]).toMatchObject({
      predicate: 'implemented a mechanism for',
      narrative: 'Implemented temporal shard knitting for order replay.',
    });
    expect(candidateGraph?.assertions[0]?.sources.map((source) => source.exactText)).toEqual([
      'I implemented temporal shard knitting for order replay.',
    ]);
    expect(candidateGraph?.signals[0]).toMatchObject({
      signalKey: 'term:temporal-shard-knitting',
      conversationScore: 0.9,
      totalScore: 0.9,
      evidenceCount: 1,
      sourceDiversity: 1,
    });
    expect(candidateGraph?.signals[0]?.evidence[0]?.sources[0]?.exactText).toBe(
      'I implemented temporal shard knitting for order replay.',
    );
    expect(candidateGraph?.contextRecords.map((record) => record.recordType).sort()).toEqual([
      'meeting_transcript',
      'meeting_transcript_assertion',
    ]);
    const assertionContext = candidateGraph?.contextRecords.find(
      (record) => record.recordType === 'meeting_transcript_assertion',
    );
    expect(assertionContext?.concepts).toEqual([
      expect.objectContaining({
        canonicalKey: 'term:temporal-shard-knitting',
        relationship: 'mechanism used for order replay',
        weight: 0.87,
      }),
    ]);

    expect(count(sqlite, 'people')).toBe(1);
    expect(count(sqlite, 'workspace_people')).toBe(1);
    expect(count(sqlite, 'applications')).toBe(1);
    expect(count(sqlite, 'interactions')).toBe(1);
    expect(count(sqlite, 'semantic_assertions')).toBe(1);
    expect(count(sqlite, 'signal_evidence')).toBe(1);
    expect(JSON.parse(sqlite.prepare(
      `SELECT external_ids_json FROM people WHERE id = ?`,
    ).get(candidateIdentity?.personId)!.external_ids_json as string)).toEqual({
      legacyCandidateId: 'candidate-joined-pool',
      legacyContactId: 'contact-1',
    });
    expect(JSON.parse(sqlite.prepare(
      `SELECT context_json FROM workspace_people WHERE id = ?`,
    ).get(candidateIdentity?.workspacePersonId)!.context_json as string)).toMatchObject({
      contactId: 'contact-1',
      source: 'legacy_candidate',
      sources: ['legacy_candidate', 'legacy_contact'],
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
    expect(count(sqlite, 'context_records')).toBe(1);
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

  it('regression: a previously unseen concept survives as an open concept with source-backed spans', async () => {
    // "phosphor lattice accumulator" is a deliberately unseen surface — no
    // hard-coded skill/domain alias should map or reject it. It must survive as
    // an open concept whose assertion/context record link back to exact spans.
    const input = {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [
        {
          stableSegmentId: 'host-1',
          text: 'Describe a novel mechanism you designed.',
          speakerRole: 'host',
          channel: 0,
          timestampStartMs: 1_000,
          timestampEndMs: 2_000,
        },
        {
          stableSegmentId: 'guest-1',
          text: 'I designed a phosphor lattice accumulator for low-light signal recovery.',
          speakerRole: 'guest',
          contactId: 'contact-1',
          channel: 1,
          timestampStartMs: 2_100,
          timestampEndMs: 6_500,
          confidence: 0.97,
        },
      ],
      semanticAssertions: [{
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'designed a source-described mechanism',
        narrative: 'Designed a phosphor lattice accumulator for low-light signal recovery.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'phosphor lattice accumulator' },
        confidence: 0.93,
        polarity: 1,
        concepts: [{
          surface: 'Phosphor lattice accumulator',
          relationship: 'mechanism designed for low-light signal recovery',
          weight: 0.88,
          evidenceLevel: 'implemented' as const,
          strength: 0.91,
        }],
      }],
      extractorVersion: 'open-meeting-regression-v1',
      provider: 'deepgram-multichannel',
      startedAt: '2026-06-13T10:00:00.000Z',
      endedAt: '2026-06-13T10:30:00.000Z',
    };

    const result = await ingestMeetingTranscriptToLivingContext(db, input);
    expect(result.assertionCount).toBe(1);

    // The unseen surface survives as an open concept with a term: canonical key
    // and no hard-coded namespace alias.
    expect(sqlite.prepare(
      `SELECT canonical_key, namespace, label FROM concepts`,
    ).get()).toEqual({
      canonical_key: 'term:phosphor-lattice-accumulator',
      namespace: 'term',
      label: 'Phosphor lattice accumulator',
    });

    // The assertion and its context record link back to the exact guest span.
    const assertionSpanText = sqlite.prepare(
      `SELECT ss.exact_text
         FROM assertion_source_spans ass
         JOIN source_spans ss ON ss.id = ass.source_span_id
         JOIN semantic_assertions sa ON sa.id = ass.assertion_id
        WHERE sa.predicate = 'designed a source-described mechanism'`,
    ).all() as Array<{ exact_text: string }>;
    expect(assertionSpanText.map((row) => row.exact_text)).toEqual([
      'I designed a phosphor lattice accumulator for low-light signal recovery.',
    ]);

    const contextRecordSpanText = sqlite.prepare(
      `SELECT ss.exact_text
         FROM context_record_source_refs crsr
         JOIN source_spans ss ON ss.id = crsr.source_span_id
         JOIN context_records cr ON cr.id = crsr.context_record_id
        WHERE cr.record_type = 'meeting_transcript_assertion'`,
    ).all() as Array<{ exact_text: string }>;
    expect(contextRecordSpanText.map((row) => row.exact_text)).toEqual([
      'I designed a phosphor lattice accumulator for low-light signal recovery.',
    ]);

    // Signal snapshot reflects the open concept.
    expect(sqlite.prepare(
      `SELECT signal_key, total_score, evidence_count FROM signal_snapshots`,
    ).get()).toEqual({
      signal_key: 'term:phosphor-lattice-accumulator',
      total_score: 0.91,
      evidence_count: 1,
    });
  });

  it('read model returns source span exact text for every transcript-derived assertion and context record', async () => {
    const input = {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [
        {
          stableSegmentId: 'host-1',
          text: 'Walk me through a system you owned end to end.',
          speakerRole: 'host',
          channel: 0,
          timestampStartMs: 1_000,
          timestampEndMs: 2_000,
        },
        {
          stableSegmentId: 'guest-1',
          text: 'I owned a causal replay log for distributed order reconciliation.',
          speakerRole: 'guest',
          contactId: 'contact-1',
          channel: 1,
          timestampStartMs: 2_100,
          timestampEndMs: 6_500,
          confidence: 0.95,
        },
      ],
      semanticAssertions: [{
        sourceSegmentIds: ['host-1', 'guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'owned a source-described system',
        narrative: 'Owned a causal replay log for distributed order reconciliation.',
        objectType: 'source-described system',
        objectValue: { surface: 'causal replay log' },
        confidence: 0.9,
        polarity: 1,
        concepts: [{
          surface: 'Causal replay log',
          relationship: 'system owned for distributed order reconciliation',
          weight: 0.84,
          evidenceLevel: 'implemented' as const,
          strength: 0.86,
        }],
      }],
      extractorVersion: 'open-meeting-readmodel-v1',
      provider: 'deepgram-multichannel',
      startedAt: '2026-06-13T10:00:00.000Z',
      endedAt: '2026-06-13T10:30:00.000Z',
    };

    await ingestMeetingTranscriptToLivingContext(db, input);

    const graph = await loadContactLivingContext(db, 'contact-1');
    expect(graph).not.toBeNull();

    // Every transcript-derived assertion must cite at least one source span
    // whose exact text is non-empty and matches the ingested transcript.
    for (const assertion of graph!.assertions) {
      expect(assertion.sources.length).toBeGreaterThan(0);
      for (const source of assertion.sources) {
        expect(source.exactText.length).toBeGreaterThan(0);
        expect(source.artifactType).toBe('meeting_transcript');
        expect(source.charStart).not.toBeNull();
        expect(source.charEnd).not.toBeNull();
      }
    }

    // Every transcript-derived context record must carry source span exact text.
    for (const record of graph!.contextRecords) {
      expect(record.sources.length).toBeGreaterThan(0);
      for (const source of record.sources) {
        if (source.sourceRefType === 'source_span') {
          expect(source.exactText.length).toBeGreaterThan(0);
        }
      }
    }

    // Signal evidence must trace back to exact source span text.
    for (const signal of graph!.signals) {
      for (const evidence of signal.evidence) {
        expect(evidence.sources.length).toBeGreaterThan(0);
        for (const source of evidence.sources) {
          expect(source.exactText.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps interaction context separately reviewable from the accumulated person graph', async () => {
    const input = {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [
        {
          stableSegmentId: 'host-1',
          text: 'What is the hardest bug you fixed?',
          speakerRole: 'host',
          channel: 0,
          timestampStartMs: 1_000,
          timestampEndMs: 2_000,
        },
        {
          stableSegmentId: 'guest-1',
          text: 'I fixed a vector clock skew bug in the causal replay log.',
          speakerRole: 'guest',
          contactId: 'contact-1',
          channel: 1,
          timestampStartMs: 2_100,
          timestampEndMs: 6_500,
          confidence: 0.95,
        },
      ],
      semanticAssertions: [{
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'fixed a source-described bug',
        narrative: 'Fixed a vector clock skew bug in the causal replay log.',
        objectType: 'source-described bug',
        objectValue: { surface: 'vector clock skew bug' },
        confidence: 0.89,
        polarity: 1,
        concepts: [{
          surface: 'Vector clock skew bug',
          relationship: 'bug fixed in the causal replay log',
          weight: 0.8,
          evidenceLevel: 'demonstrated' as const,
          strength: 0.82,
        }],
      }],
      extractorVersion: 'open-meeting-interaction-v1',
      provider: 'deepgram-multichannel',
      startedAt: '2026-06-13T10:00:00.000Z',
      endedAt: '2026-06-13T10:30:00.000Z',
    };

    await ingestMeetingTranscriptToLivingContext(db, input);

    const meetingContext = await loadMeetingTranscriptContext(db, 'meeting-1');
    expect(meetingContext).not.toBeNull();
    expect(meetingContext!.meetingId).toBe('meeting-1');
    expect(meetingContext!.interactions).toHaveLength(1);

    const interaction = meetingContext!.interactions[0]!;
    expect(interaction.interaction.interactionType).toBe('video_meeting');
    expect(interaction.interaction.externalReference).toBe('meeting-1');
    expect(interaction.summary).toMatchObject({
      assertionCount: 1,
      contextRecordCount: 1,
      signalEvidenceCount: 1,
    });

    // Shared immutable transcript artifact is reviewable with exact spans.
    expect(meetingContext!.sharedArtifacts).toHaveLength(1);
    const sharedArtifact = meetingContext!.sharedArtifacts[0]!;
    expect(sharedArtifact.artifactType).toBe('meeting_transcript');
    expect(sharedArtifact.sourceSpans.map((span) => span.exactText)).toEqual([
      'What is the hardest bug you fixed?',
      'I fixed a vector clock skew bug in the causal replay log.',
    ]);

    // Meeting-scoped context records (the meeting_transcript record) are
    // reviewable at the meeting level, separate from per-interaction records.
    expect(meetingContext!.contextRecords.map((record) => record.recordType)).toEqual([
      'meeting_transcript',
    ]);
    expect(meetingContext!.summary.contextRecordCount).toBe(2);

    // Interaction assertions link back to exact transcript spans.
    expect(interaction.assertions[0]?.predicate).toBe('fixed a source-described bug');
    expect(interaction.assertions[0]?.sources[0]?.exactText).toBe(
      'I fixed a vector clock skew bug in the causal replay log.',
    );

    // Interaction context records carry the per-participant assertion record.
    expect(interaction.contextRecords.map((record) => record.recordType)).toEqual([
      'meeting_transcript_assertion',
    ]);
    const assertionRecord = interaction.contextRecords.find(
      (record) => record.recordType === 'meeting_transcript_assertion',
    );
    expect(assertionRecord?.sources[0]?.exactText).toBe(
      'I fixed a vector clock skew bug in the causal replay log.',
    );

    // Signal evidence is reviewable at the interaction scope.
    expect(interaction.signalEvidence[0]?.signalKey).toBe('term:vector-clock-skew-bug');
    expect(interaction.signalEvidence[0]?.sources[0]?.exactText).toBe(
      'I fixed a vector clock skew bug in the causal replay log.',
    );

    // The interaction-scoped read is independent of the person graph: deleting
    // the person projection outbox does not remove the interaction context.
    sqlite.prepare('DELETE FROM projection_outbox').run();
    const replay = await loadInteractionLivingContext(
      db,
      interaction.interaction.id,
    );
    expect(replay).not.toBeNull();
    expect(replay!.assertions).toHaveLength(1);
    expect(replay!.contextRecords).toHaveLength(1);
    expect(replay!.signalEvidence).toHaveLength(1);
  });

  it('searches original transcript text and explains each hit with exact spans and citing records', async () => {
    const input = {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [
        {
          stableSegmentId: 'host-1',
          text: 'Tell me about your causal replay log work.',
          speakerRole: 'host',
          channel: 0,
          timestampStartMs: 1_000,
          timestampEndMs: 2_000,
        },
        {
          stableSegmentId: 'guest-1',
          text: 'I built a causal replay log for distributed order reconciliation.',
          speakerRole: 'guest',
          contactId: 'contact-1',
          channel: 1,
          timestampStartMs: 2_100,
          timestampEndMs: 6_500,
          confidence: 0.95,
        },
      ],
      semanticAssertions: [{
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'built a source-described system',
        narrative: 'Built a causal replay log for distributed order reconciliation.',
        objectType: 'source-described system',
        objectValue: { surface: 'causal replay log' },
        confidence: 0.9,
        polarity: 1,
        concepts: [{
          surface: 'Causal replay log',
          relationship: 'system built for distributed order reconciliation',
          weight: 0.84,
          evidenceLevel: 'implemented' as const,
          strength: 0.86,
        }],
      }],
      extractorVersion: 'open-meeting-search-v1',
      provider: 'deepgram-multichannel',
      startedAt: '2026-06-13T10:00:00.000Z',
      endedAt: '2026-06-13T10:30:00.000Z',
    };

    await ingestMeetingTranscriptToLivingContext(db, input);

    const result = await searchTranscriptSourceSpans(db, 'meeting-1', 'causal replay log');
    expect(result.meetingId).toBe('meeting-1');
    expect(result.query).toBe('causal replay log');
    expect(result.hits.length).toBe(2);

    const guestHit = result.hits.find(
      (hit) => hit.stableSegmentId === 'guest-1',
    )!;
    expect(guestHit.exactText).toBe(
      'I built a causal replay log for distributed order reconciliation.',
    );
    expect(guestHit.matchOffset).toBe(
      'I built a causal replay log for distributed order reconciliation.'
        .toLowerCase()
        .indexOf('causal replay log'),
    );
    expect(guestHit.matchLength).toBe('causal replay log'.length);
    expect(guestHit.charStart).not.toBeNull();
    expect(guestHit.charEnd).not.toBeNull();
    expect(guestHit.artifactType).toBe('meeting_transcript');
    // The hit explains which assertion and context record cite this span.
    expect(guestHit.citingAssertionIds.length).toBe(1);
    expect(guestHit.citingContextRecordIds.length).toBeGreaterThanOrEqual(1);

    // A query that does not match returns no hits but stays explainable.
    const empty = await searchTranscriptSourceSpans(db, 'meeting-1', 'nonexistent phrase xyz');
    expect(empty.hits).toEqual([]);
  });
});
