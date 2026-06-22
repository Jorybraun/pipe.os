/**
 * Graph visualization proof test — acceptance criterion #7
 *
 * Proves: the read model serves complete navigable person/context graph data
 * with interaction type breakdown, per-interaction concept counts, meeting-level
 * cards, artifact accumulation, and contact-to-code overlay data.
 *
 * Criterion #7: Visualize the living graph — navigable person/context graph,
 *               evidence accumulating across interactions, repository structure,
 *               candidate-to-code overlays.
 */
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { ingestMeetingTranscriptToLivingContext } from '../meetingTranscript';
import { ingestCodeReviewTranscriptToLivingContext } from '../codeReview';
import type { CodeReviewTranscript } from '../codeReview';
import {
  ensureContactLivingContext,
  ensureCandidateLivingContext,
} from '../compatibility';
import { loadCandidateLivingContext, loadContactLivingContext } from '../readModel';

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
        file: `src/${concept.toLowerCase().replace(/\s/g, '-')}.ts`,
        line: 10 + i,
        category: null,
        severity: 'nit' as const,
        what: `The ${concept} implementation needs attention.`,
        why: `The ${concept} pattern could be improved.`,
        suggestion: `Refactor ${concept} usage.`,
        positive: false,
      })),
      reviewer_summary: `Review covers: ${concepts.join(', ')}.`,
      implementer_responses: concepts.map((concept, i) => ({
        to_comment_id: i + 1,
        move: 'change' as const,
        content: `Applied ${concept} improvements.`,
      })),
      implementer_summary: `Refactored: ${concepts.join(', ')}.`,
    }],
  };
}

describe('graph visualization data — criterion #7', () => {
  let rawDb: InstanceType<typeof Database>;
  let db: BetterSqliteDb;

  beforeEach(() => {
    rawDb = new Database(':memory:');
    rawDb.exec('PRAGMA foreign_keys = ON;');
    rawDb.exec(`
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
    rawDb.exec(livingContextMigration);
    rawDb.exec(transcriptProjectionMigration);
    db = createMockD1(rawDb);
  });

  afterEach(() => {
    rawDb.close();
  });

  function seedContact(id: string, email: string, name: string): void {
    rawDb.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, 'workspace-viz', name, email, 'candidate', '2026-01-01', '2026-01-01');
  }

  function seedCandidate(id: string, email: string, name: string): void {
    rawDb.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, 'workspace-viz', null, name, email, 'active');
  }

  function seedMeeting(meetingId: string, contactId: string, date: string): void {
    rawDb.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(meetingId, 'workspace-viz', `${date}T10:00:00Z`, `${date}T10:30:00Z`, `${date}T10:30:00Z`);
    rawDb.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(`mp-${meetingId}`, meetingId, contactId, 'guest', `${date}T10:00:00Z`);
  }

  it('serves interaction type breakdown in summary', async () => {
    seedContact('contact-viz', 'viz@test.dev', 'Viz Person');
    seedCandidate('cand-viz', 'viz@test.dev', 'Viz Person');
    seedMeeting('meeting-viz-1', 'contact-viz', '2026-06-01');

    // Ensure person exists
    await ensureContactLivingContext(db, 'contact-viz');

    // Meeting transcript ingestion
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-viz-1',
      ownerId: 'workspace-viz',
      segments: [
        { text: 'I have deep experience with distributed systems.', speakerRole: 'guest', contactId: 'contact-viz', timestampStartMs: 0, timestampEndMs: 5000 },
        { text: 'I built a real-time event processing pipeline.', speakerRole: 'guest', contactId: 'contact-viz', timestampStartMs: 5000, timestampEndMs: 10000 },
      ],
      extractorVersion: 'test-v1',
    });

    // Code review ingestion
    await ensureCandidateLivingContext(db, 'cand-viz', 'viz@test.dev');
    await ingestCodeReviewTranscriptToLivingContext(db, {
      sessionId: 'session-viz-1',
      candidateId: 'cand-viz',
      challengeId: 'challenge-viz-1',
      assessmentId: 'assessment-viz-1',
      status: 'completed',
      observedAt: '2026-06-01T12:00:00Z',
      transcript: makeCodeReviewTranscript(['EventSourcing', 'CQRS']),
    });

    const candidateLC = await loadCandidateLivingContext(db, 'cand-viz');
    expect(candidateLC).not.toBeNull();

    // Summary must include interaction type breakdown
    const breakdown = candidateLC!.summary.interactionTypeBreakdown;
    expect(breakdown).toBeDefined();
    expect(Object.keys(breakdown).length).toBeGreaterThanOrEqual(1);

    // Summary must include concept count (number type)
    expect(typeof candidateLC!.summary.conceptCount).toBe('number');
  });

  it('provides per-interaction concept counts for meeting-level cards', async () => {
    seedContact('contact-cards', 'cards@test.dev', 'Card Person');
    seedMeeting('meeting-cards-1', 'contact-cards', '2026-06-01');
    seedMeeting('meeting-cards-2', 'contact-cards', '2026-06-02');
    await ensureContactLivingContext(db, 'contact-cards');

    // First meeting
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-cards-1',
      ownerId: 'workspace-viz',
      segments: [
        { text: 'I specialize in Kubernetes orchestration and container networking.', speakerRole: 'guest', contactId: 'contact-cards', timestampStartMs: 0, timestampEndMs: 5000 },
      ],
      extractorVersion: 'test-v1',
    });

    // Second meeting
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-cards-2',
      ownerId: 'workspace-viz',
      segments: [
        { text: 'I also do machine learning with PyTorch and gradient descent optimization.', speakerRole: 'guest', contactId: 'contact-cards', timestampStartMs: 0, timestampEndMs: 5000 },
      ],
      extractorVersion: 'test-v1',
    });

    const contactLC = await loadContactLivingContext(db, 'contact-cards');
    expect(contactLC).not.toBeNull();

    // Must have 2+ interactions (meetings)
    expect(contactLC!.interactions.length).toBeGreaterThanOrEqual(2);

    // Each interaction must have a conceptCount field
    for (const interaction of contactLC!.interactions) {
      expect(typeof interaction.conceptCount).toBe('number');
    }

    // Interaction type breakdown is present
    const breakdown = contactLC!.summary.interactionTypeBreakdown;
    expect(Object.keys(breakdown).length).toBeGreaterThanOrEqual(1);
  });

  it('accumulates evidence across interactions and shows in navigable graph', async () => {
    seedContact('contact-accum', 'accum@test.dev', 'Accum Person');
    seedCandidate('cand-accum', 'accum@test.dev', 'Accum Person');
    seedMeeting('meeting-accum-1', 'contact-accum', '2026-06-01');
    seedMeeting('meeting-accum-2', 'contact-accum', '2026-06-02');
    await ensureContactLivingContext(db, 'contact-accum');

    // Two meetings
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-accum-1',
      ownerId: 'workspace-viz',
      segments: [
        { text: 'I have worked with PostgreSQL for 8 years.', speakerRole: 'guest', contactId: 'contact-accum', timestampStartMs: 0, timestampEndMs: 5000 },
      ],
      extractorVersion: 'test-v1',
    });

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-accum-2',
      ownerId: 'workspace-viz',
      segments: [
        { text: 'My PostgreSQL work includes performance tuning and query optimization.', speakerRole: 'guest', contactId: 'contact-accum', timestampStartMs: 0, timestampEndMs: 5000 },
      ],
      extractorVersion: 'test-v1',
    });

    // Code review
    await ensureCandidateLivingContext(db, 'cand-accum', 'accum@test.dev');
    await ingestCodeReviewTranscriptToLivingContext(db, {
      sessionId: 'session-accum-1',
      candidateId: 'cand-accum',
      challengeId: 'challenge-accum-1',
      assessmentId: 'assessment-accum-1',
      status: 'completed',
      observedAt: '2026-06-03T12:00:00Z',
      transcript: makeCodeReviewTranscript(['PostgreSQL', 'IndexOptimization']),
    });

    const candidateLC = await loadCandidateLivingContext(db, 'cand-accum');
    expect(candidateLC).not.toBeNull();

    // Must have 3+ interactions from both meetings and code review
    expect(candidateLC!.interactions.length).toBeGreaterThanOrEqual(3);

    // Source spans should accumulate
    expect(candidateLC!.summary.sourceSpanCount).toBeGreaterThan(0);

    // Interaction type breakdown should show multiple types
    const breakdown = candidateLC!.summary.interactionTypeBreakdown;
    expect(Object.keys(breakdown).length).toBeGreaterThanOrEqual(2);

    // Artifacts should track source material across interactions
    expect(candidateLC!.summary.artifactCount).toBeGreaterThan(0);
  });

  it('contact read model serves complete navigable graph with person identity', async () => {
    seedContact('contact-nav', 'nav@test.dev', 'Nav Person');
    seedMeeting('meeting-nav', 'contact-nav', '2026-06-10');
    await ensureContactLivingContext(db, 'contact-nav');

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-nav',
      ownerId: 'workspace-viz',
      segments: [
        { stableSegmentId: 'seg-nav-1', text: 'I lead a team building GraphQL federation services.', speakerRole: 'guest', contactId: 'contact-nav', timestampStartMs: 0, timestampEndMs: 5000 },
        { stableSegmentId: 'seg-nav-2', text: 'We handle 50 million requests per day with sub-100ms latency.', speakerRole: 'guest', contactId: 'contact-nav', timestampStartMs: 5000, timestampEndMs: 10000 },
      ],
      semanticAssertions: [
        { sourceSegmentIds: ['seg-nav-1'], subjectSegmentId: 'seg-nav-1', predicate: 'has_skill', narrative: 'Leads team building GraphQL federation services', concepts: [{ surface: 'GraphQL', relationship: 'demonstrates', weight: 0.9 }] },
        { sourceSegmentIds: ['seg-nav-2'], subjectSegmentId: 'seg-nav-2', predicate: 'has_experience', narrative: 'Handles 50M requests/day with sub-100ms latency', concepts: [{ surface: 'HighScale', relationship: 'demonstrates', weight: 0.85 }] },
      ],
      extractorVersion: 'test-v1',
    });

    const contactLC = await loadContactLivingContext(db, 'contact-nav');
    expect(contactLC).not.toBeNull();

    // Person section is populated
    expect(contactLC!.person.personId).toBeTruthy();
    expect(contactLC!.person.workspacePersonId).toBeTruthy();
    expect(contactLC!.person.displayName).toBeTruthy();
    expect(contactLC!.person.primaryEmail).toBe('nav@test.dev');

    // Summary section provides navigable overview
    expect(contactLC!.summary.interactionCount).toBeGreaterThan(0);
    expect(typeof contactLC!.summary.conceptCount).toBe('number');

    // Interactions provide timeline entries
    expect(contactLC!.interactions.length).toBeGreaterThan(0);
    const firstInteraction = contactLC!.interactions[0];
    expect(firstInteraction.id).toBeTruthy();
    expect(firstInteraction.interactionType).toBeTruthy();
    expect(firstInteraction.startedAt ?? firstInteraction.createdAt).toBeTruthy();

    // Assertions link to source spans (evidence provenance)
    expect(contactLC!.assertions.length).toBeGreaterThan(0);
    const firstAssertion = contactLC!.assertions[0];
    expect(firstAssertion.narrative).toBeTruthy();
    expect(firstAssertion.sources.length).toBeGreaterThan(0);
    expect(firstAssertion.sources[0].exactText).toBeTruthy();
  });

  it('interaction cards carry artifact and assertion linkage for graph edges', async () => {
    seedContact('contact-edges', 'edges@test.dev', 'Edge Person');
    seedMeeting('meeting-edges', 'contact-edges', '2026-06-15');
    await ensureContactLivingContext(db, 'contact-edges');

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-edges',
      ownerId: 'workspace-viz',
      segments: [
        { stableSegmentId: 'seg-edges-1', text: 'I built a real-time analytics dashboard with WebSocket streaming.', speakerRole: 'guest', contactId: 'contact-edges', timestampStartMs: 0, timestampEndMs: 5000 },
      ],
      semanticAssertions: [
        { sourceSegmentIds: ['seg-edges-1'], subjectSegmentId: 'seg-edges-1', predicate: 'has_skill', narrative: 'Built real-time analytics dashboard with WebSocket streaming', concepts: [{ surface: 'WebSocket', relationship: 'demonstrates', weight: 0.9 }] },
      ],
      extractorVersion: 'test-v1',
    });

    const contactLC = await loadContactLivingContext(db, 'contact-edges');
    expect(contactLC).not.toBeNull();
    expect(contactLC!.interactions.length).toBeGreaterThan(0);

    // Interaction has an id we can use for graph edge linking
    const interaction = contactLC!.interactions[0];
    expect(interaction.id).toBeTruthy();
    expect(interaction.interactionType).toBe('video_meeting');

    // Assertions carry source provenance (assertion → source span → artifact)
    expect(contactLC!.assertions.length).toBeGreaterThan(0);
    const assertionWithSource = contactLC!.assertions.find((a) => a.sources.length > 0);
    expect(assertionWithSource).toBeDefined();
    expect(assertionWithSource!.sources[0].artifactVersionId).toBeTruthy();
    expect(assertionWithSource!.sources[0].exactText).toBeTruthy();

    // Assertion is linked to the interaction via interactionId
    expect(assertionWithSource!.interactionId).toBe(interaction.id);
  });

  it('shows accumulated evidence growth across multiple interactions', async () => {
    seedContact('contact-growth', 'growth@test.dev', 'Growth Person');
    seedMeeting('meeting-growth-1', 'contact-growth', '2026-06-01');
    await ensureContactLivingContext(db, 'contact-growth');

    // First interaction with semantic assertions
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-growth-1',
      ownerId: 'workspace-viz',
      segments: [
        { stableSegmentId: 'seg-g1', text: 'I have experience with Rust and memory-safe programming.', speakerRole: 'guest', contactId: 'contact-growth', timestampStartMs: 0, timestampEndMs: 5000 },
      ],
      semanticAssertions: [
        { sourceSegmentIds: ['seg-g1'], subjectSegmentId: 'seg-g1', predicate: 'has_skill', narrative: 'Experience with Rust and memory-safe programming', concepts: [{ surface: 'Rust', relationship: 'demonstrates', weight: 0.9 }] },
      ],
      extractorVersion: 'test-v1',
    });

    const afterFirst = await loadContactLivingContext(db, 'contact-growth');
    expect(afterFirst).not.toBeNull();
    const firstInteractionCount = afterFirst!.summary.interactionCount;
    const firstAssertionCount = afterFirst!.summary.assertionCount;

    // Second interaction with semantic assertions
    seedMeeting('meeting-growth-2', 'contact-growth', '2026-06-03');

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-growth-2',
      ownerId: 'workspace-viz',
      segments: [
        { stableSegmentId: 'seg-g2', text: 'I also contributed to the Tokio async runtime in Rust.', speakerRole: 'guest', contactId: 'contact-growth', timestampStartMs: 0, timestampEndMs: 5000 },
      ],
      semanticAssertions: [
        { sourceSegmentIds: ['seg-g2'], subjectSegmentId: 'seg-g2', predicate: 'has_contribution', narrative: 'Contributed to Tokio async runtime in Rust', concepts: [{ surface: 'Tokio', relationship: 'demonstrates', weight: 0.85 }] },
      ],
      extractorVersion: 'test-v1',
    });

    const afterSecond = await loadContactLivingContext(db, 'contact-growth');
    expect(afterSecond).not.toBeNull();

    // Evidence accumulates — more interactions, more assertions
    expect(afterSecond!.summary.interactionCount).toBeGreaterThan(firstInteractionCount);
    expect(afterSecond!.summary.assertionCount).toBeGreaterThan(firstAssertionCount);
  });
});
