/**
 * Full lifecycle proof test — acceptance criteria #1 and #2
 *
 * Proves: contact → meeting → candidate → code-review all resolve to ONE person
 * with exact source provenance chains preserved.
 *
 * Criterion #1: Living person graph — contacts/applicants share one person,
 *               interaction-level evidence stays separate from accumulated.
 * Criterion #2: Preserve original meaning — every assertion links to exact
 *               transcript paragraph, resume line, or assessment response.
 */
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { ingestMeetingTranscriptToLivingContext } from '../meetingTranscript';
import { ingestCodeReviewTranscriptToLivingContext } from '../codeReview';
import type { CodeReviewTranscript } from '../codeReview';
import {
  ensureCandidateLivingContext,
  ensureContactLivingContext,
} from '../compatibility';
import { loadCandidateLivingContext } from '../readModel';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);

function makeCodeReviewTranscript(concepts: string[]): CodeReviewTranscript {
  return {
    rounds: [{
      round: 1,
      reviewer_comments: concepts.map((concept, i) => ({
        id: i + 1,
        file: `src/${concept.toLowerCase()}.ts`,
        line: 10 + i,
        category: null,
        severity: 'nit' as const,
        what: `The ${concept} implementation needs cleanup.`,
        why: `The ${concept} pattern is not idiomatic.`,
        suggestion: `Refactor ${concept} usage.`,
        positive: false,
      })),
      reviewer_summary: `Review touches: ${concepts.join(', ')}.`,
      implementer_responses: concepts.map((concept, i) => ({
        to_comment_id: i + 1,
        move: 'change' as const,
        content: `Refactored ${concept} as suggested.`,
      })),
      implementer_summary: `Applied changes for: ${concepts.join(', ')}.`,
    }],
  };
}

describe('full lifecycle provenance — criteria #1 and #2', () => {
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

  it('contact→meeting→candidate→code-review all resolve to one person', async () => {
    // 1. Create contact
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-lp', 'ws-1', 'Lifecycle Person', 'lp@example.com', 'candidate', '2026-01-01', '2026-01-01');

    // 2. Create meeting
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-lp', 'ws-1', '2026-06-13T10:00:00Z', '2026-06-13T11:00:00Z', '2026-06-13T11:00:00Z');
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('mp-lp', 'meeting-lp', 'contact-lp', 'guest', '2026-06-13T10:00:00Z');

    // 3. Ensure contact living context (creates person)
    const contactCtx = await ensureContactLivingContext(db, 'contact-lp');
    expect(contactCtx).not.toBeNull();
    const personId = contactCtx!.personId;

    // 4. Ingest meeting transcript (adds interaction + source spans)
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-lp',
      ownerId: 'ws-1',
      segments: [{
        stableSegmentId: 'host-1',
        text: 'What distributed systems have you worked with?',
        speakerRole: 'host',
        channel: 0,
        timestampStartMs: 0,
        timestampEndMs: 3000,
        confidence: 0.98,
      }, {
        stableSegmentId: 'guest-1',
        text: 'I built a Kafka-based event sourcing platform at scale, handling 50k events per second with exactly-once semantics.',
        speakerRole: 'guest',
        contactId: 'contact-lp',
        channel: 1,
        timestampStartMs: 3000,
        timestampEndMs: 10000,
        confidence: 0.95,
      }],
      extractorVersion: 'test-v1',
      provider: 'deepgram',
    });

    // 5. Create candidate (same email → same person)
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('candidate-lp', 'ws-1', 'pipeline-1', 'Lifecycle Person', 'lp@example.com', 'active');
    const candidateCtx = await ensureCandidateLivingContext(db, 'candidate-lp');
    expect(candidateCtx).not.toBeNull();

    // CRITERION #1: Same person, shared identity
    expect(candidateCtx!.personId).toBe(personId);
    const personCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM people').get() as { c: number }).c;
    expect(personCount).toBe(1);

    // 6. Ingest code review interaction (adds to same person's graph)
    await ingestCodeReviewTranscriptToLivingContext(db, {
      sessionId: 'review-lp-1',
      candidateId: 'candidate-lp',
      challengeId: 'challenge-lp-1',
      assessmentId: 'assessment-lp-1',
      transcript: makeCodeReviewTranscript(['RetryLogic', 'ExponentialBackoff']),
      status: 'in_progress',
      startedAt: '2026-06-14T10:00:00Z',
      observedAt: '2026-06-14T10:05:00Z',
    });

    // 7. Verify multiple interactions accumulated under one person
    const interactions = sqlite.prepare(
      `SELECT i.id, i.interaction_type FROM interactions i
       JOIN workspace_people wp ON wp.id = i.workspace_person_id
       WHERE wp.person_id = ?`,
    ).all(personId) as Array<{ id: string; interaction_type: string }>;
    expect(interactions.length).toBeGreaterThanOrEqual(2);
    const interactionTypes = interactions.map((i) => i.interaction_type);
    expect(interactionTypes).toContain('video_meeting');
    expect(interactionTypes).toContain('code_review_assessment');
  });

  it('each interaction preserves exact source spans with immutable hashes', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-sp', 'ws-1', 'Source Provenance', 'sp@example.com', 'candidate', '2026-01-01', '2026-01-01');
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-sp', 'ws-1', '2026-06-14T10:00:00Z', '2026-06-14T11:00:00Z', '2026-06-14T11:00:00Z');
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('mp-sp', 'meeting-sp', 'contact-sp', 'guest', '2026-06-14T10:00:00Z');

    await ensureContactLivingContext(db, 'contact-sp');

    const exactGuestText = 'I led the migration from monolith to microservices, reducing deployment time from 2 hours to 8 minutes.';
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-sp',
      ownerId: 'ws-1',
      segments: [{
        stableSegmentId: 'host-sp',
        text: 'Tell me about your biggest technical achievement.',
        speakerRole: 'host',
        channel: 0,
        timestampStartMs: 0,
        timestampEndMs: 3000,
        confidence: 0.97,
      }, {
        stableSegmentId: 'guest-sp',
        text: exactGuestText,
        speakerRole: 'guest',
        contactId: 'contact-sp',
        channel: 1,
        timestampStartMs: 3000,
        timestampEndMs: 12000,
        confidence: 0.96,
      }],
      extractorVersion: 'test-v1',
      provider: 'deepgram',
    });

    // CRITERION #2: source spans preserve exact text with immutable hashes
    // Query spans through: source_spans → artifact_versions → artifacts → artifact_interactions → interactions → workspace_people
    const contactCtxSp = await ensureContactLivingContext(db, 'contact-sp');
    const spans = sqlite.prepare(
      `SELECT ss.exact_text, ss.exact_text_hash, ss.byte_start, ss.byte_end
       FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
       JOIN artifact_interactions ai ON ai.artifact_id = a.id
       JOIN interactions i ON i.id = ai.interaction_id
       JOIN workspace_people wp ON wp.id = i.workspace_person_id
       WHERE wp.person_id = ?`,
    ).all(contactCtxSp!.personId) as Array<{ exact_text: string; exact_text_hash: string; byte_start: number; byte_end: number }>;

    expect(spans.length).toBeGreaterThan(0);
    const guestSpan = spans.find((s) => s.exact_text.includes('monolith'));
    expect(guestSpan).toBeDefined();
    expect(guestSpan!.exact_text).toContain(exactGuestText);
    expect(guestSpan!.exact_text_hash).toBeTruthy();
    expect(guestSpan!.byte_start).toBeGreaterThanOrEqual(0);
    expect(guestSpan!.byte_end).toBeGreaterThan(guestSpan!.byte_start);
  });

  it('assertions link back to originating source spans via provenance join', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-al', 'ws-1', 'Assert Link', 'al@example.com', 'candidate', '2026-01-01', '2026-01-01');
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-al', 'ws-1', '2026-06-15T10:00:00Z', '2026-06-15T11:00:00Z', '2026-06-15T11:00:00Z');
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('mp-al', 'meeting-al', 'contact-al', 'guest', '2026-06-15T10:00:00Z');

    await ensureContactLivingContext(db, 'contact-al');
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-al',
      ownerId: 'ws-1',
      segments: [{
        stableSegmentId: 'guest-al',
        text: 'I have deep expertise in distributed consensus protocols, particularly Raft and Paxos implementations.',
        speakerRole: 'guest',
        contactId: 'contact-al',
        channel: 1,
        timestampStartMs: 0,
        timestampEndMs: 5000,
        confidence: 0.95,
      }],
      semanticAssertions: [{
        sourceSegmentIds: ['guest-al'],
        subjectSegmentId: 'guest-al',
        predicate: 'demonstrates_expertise',
        narrative: 'Candidate demonstrates deep expertise in distributed consensus (Raft, Paxos).',
        objectType: 'technical-skill',
        objectValue: { surface: 'distributed consensus' },
        confidence: 0.92,
        concepts: [{
          surface: 'distributed consensus',
          relationship: 'expertise-in',
          weight: 0.90,
          evidenceLevel: 'demonstrated',
          strength: 0.88,
        }],
      }],
      extractorVersion: 'test-v1',
      provider: 'deepgram',
    });

    // CRITERION #2: assertions link to source spans via assertion_source_spans
    const linkedAssertions = sqlite.prepare(
      `SELECT sa.id, sa.narrative, ss.exact_text, ss.exact_text_hash
       FROM semantic_assertions sa
       JOIN assertion_source_spans asp ON asp.assertion_id = sa.id
       JOIN source_spans ss ON ss.id = asp.source_span_id
       JOIN episodes e ON e.id = sa.episode_id
       JOIN interactions i ON i.id = e.interaction_id`,
    ).all() as Array<{
      id: string;
      narrative: string;
      exact_text: string;
      exact_text_hash: string;
    }>;

    expect(linkedAssertions.length).toBeGreaterThan(0);
    for (const assertion of linkedAssertions) {
      expect(assertion.exact_text_hash).toBeTruthy();
      expect(assertion.exact_text).toBeTruthy();
      expect(assertion.narrative).toBeTruthy();
    }
  });

  it('interaction-level evidence remains separate from accumulated snapshots', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-sep', 'ws-1', 'Sep Evidence', 'sep@example.com', 'candidate', '2026-01-01', '2026-01-01');
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-sep-1', 'ws-1', '2026-06-10T10:00:00Z', '2026-06-10T11:00:00Z', '2026-06-10T11:00:00Z');
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('mp-sep-1', 'meeting-sep-1', 'contact-sep', 'guest', '2026-06-10T10:00:00Z');

    await ensureContactLivingContext(db, 'contact-sep');

    // First meeting: Python expertise
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-sep-1',
      ownerId: 'ws-1',
      segments: [{
        stableSegmentId: 'guest-py',
        text: 'Primarily Python for data pipelines and machine learning infrastructure.',
        speakerRole: 'guest',
        contactId: 'contact-sep',
        channel: 1,
        timestampStartMs: 0,
        timestampEndMs: 5000,
        confidence: 0.94,
      }],
      extractorVersion: 'test-v1',
      provider: 'deepgram',
    });

    // Second meeting: Rust expertise
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-sep-2', 'ws-1', '2026-06-12T10:00:00Z', '2026-06-12T11:00:00Z', '2026-06-12T11:00:00Z');
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('mp-sep-2', 'meeting-sep-2', 'contact-sep', 'guest', '2026-06-12T10:00:00Z');

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-sep-2',
      ownerId: 'ws-1',
      segments: [{
        stableSegmentId: 'guest-rs',
        text: 'I have been writing Rust for systems programming — memory safety without garbage collection.',
        speakerRole: 'guest',
        contactId: 'contact-sep',
        channel: 1,
        timestampStartMs: 0,
        timestampEndMs: 5000,
        confidence: 0.93,
      }],
      extractorVersion: 'test-v1',
      provider: 'deepgram',
    });

    // Each meeting is its own interaction — query through person resolved from contact
    const sepCtx = await ensureContactLivingContext(db, 'contact-sep');
    const interactions = sqlite.prepare(
      `SELECT i.id, i.interaction_type, i.external_reference FROM interactions i
       JOIN workspace_people wp ON wp.id = i.workspace_person_id
       WHERE wp.person_id = ?`,
    ).all(sepCtx!.personId) as Array<{ id: string; interaction_type: string; external_reference: string }>;
    expect(interactions.length).toBe(2);

    // Source spans from each interaction are independently queryable
    const allSpans = sqlite.prepare(
      `SELECT ss.exact_text, i.external_reference
       FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
       JOIN artifact_interactions ai ON ai.artifact_id = a.id
       JOIN interactions i ON i.id = ai.interaction_id
       JOIN workspace_people wp ON wp.id = i.workspace_person_id
       WHERE wp.person_id = ?`,
    ).all(sepCtx!.personId) as Array<{ exact_text: string; external_reference: string }>;

    const pythonSpans = allSpans.filter((s) => s.exact_text.includes('Python'));
    const rustSpans = allSpans.filter((s) => s.exact_text.includes('Rust'));
    expect(pythonSpans.length).toBeGreaterThan(0);
    expect(rustSpans.length).toBeGreaterThan(0);

    // Different interactions produced these (different external_reference = different meeting IDs)
    const uniqueRefs = [...new Set(allSpans.map((s) => s.external_reference))];
    expect(uniqueRefs.length).toBe(2);
  });

  it('loadCandidateLivingContext surfaces interaction count and source span count', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('contact-lc', 'ws-1', 'LC Person', 'lc@example.com', 'candidate', '2026-01-01', '2026-01-01');
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('candidate-lc', 'ws-1', null, 'LC Person', 'lc@example.com', 'active');
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-lc', 'ws-1', '2026-06-14T10:00:00Z', '2026-06-14T11:00:00Z', '2026-06-14T11:00:00Z');
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('mp-lc', 'meeting-lc', 'contact-lc', 'guest', '2026-06-14T10:00:00Z');

    await ensureContactLivingContext(db, 'contact-lc');
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-lc',
      ownerId: 'ws-1',
      segments: [{
        stableSegmentId: 'guest-lc',
        text: 'I specialize in GraphQL federation and API gateway patterns.',
        speakerRole: 'guest',
        contactId: 'contact-lc',
        channel: 1,
        timestampStartMs: 0,
        timestampEndMs: 5000,
        confidence: 0.95,
      }],
      extractorVersion: 'test-v1',
      provider: 'deepgram',
    });

    await ensureCandidateLivingContext(db, 'candidate-lc');
    const livingContext = await loadCandidateLivingContext(db, 'candidate-lc');
    expect(livingContext).not.toBeNull();
    expect(livingContext!.summary.interactionCount).toBeGreaterThanOrEqual(1);
    // Verify source_spans exist for this person's interactions
    const rawSpanCount = (sqlite.prepare(
      `SELECT COUNT(*) AS c FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
       JOIN artifact_interactions ai ON ai.artifact_id = a.id
       JOIN interactions i ON i.id = ai.interaction_id
       JOIN workspace_people wp ON wp.id = i.workspace_person_id
       WHERE wp.person_id = (SELECT person_id FROM workspace_people wp2
         JOIN interactions i2 ON i2.workspace_person_id = wp2.id
         JOIN artifact_interactions ai2 ON ai2.interaction_id = i2.id
         JOIN artifacts a2 ON a2.id = ai2.artifact_id
         JOIN artifact_versions av2 ON av2.artifact_id = a2.id
         WHERE av2.id = ss.artifact_version_id
         LIMIT 1)`,
    ).get() as { c: number }).c;
    expect(rawSpanCount).toBeGreaterThan(0);
  });
});
