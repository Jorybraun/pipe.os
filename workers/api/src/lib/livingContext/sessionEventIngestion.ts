/**
 * Session event → living context ingestion.
 *
 * Ingests events from the `session_events` table (the cross-session observability
 * log) into the living context graph. This covers all interview types:
 * code_review, culture_interview, screening, implementation, voice, video.
 *
 * Each session_event maps to an episode; events with evidence payloads (e.g.
 * answer_submitted, scoring_complete) generate semantic assertions with
 * source spans linking back to the event payload as provenance.
 *
 * This pipeline fills the "messages continuously add context" aspect of
 * criterion #1 by treating candidate interview interactions as evidence.
 */

import { ensureCandidateLivingContext } from './compatibility';
import { deterministicEntityId, LivingContextStore, stableJson } from './persistence';
import { openSemanticTerm } from './openTerms';
import type { JsonObject, JsonValue } from './types';

export interface SessionEventRow {
  id: string;
  session_id: string;
  session_type: string;
  candidate_id: string;
  event_type: string;
  payload_json: string | null;
  created_at: string;
}

export interface SessionEventIngestionResult {
  candidateId: string;
  sessionId: string;
  eventsProcessed: number;
  episodesCreated: number;
  assertionsCreated: number;
  conceptsRegistered: number;
  skippedDuplicates: number;
}

interface EventPayload {
  question?: string;
  answer?: string;
  score?: number;
  maxScore?: number;
  feedback?: string;
  topic?: string;
  signal?: string;
  skills?: string[];
  concepts?: string[];
  narrative?: string;
  [key: string]: JsonValue | undefined;
}

const EVIDENCE_EVENT_TYPES = new Set([
  'answer_submitted',
  'scoring_complete',
  'question_asked',
  'stage_advanced',
  'match_assigned',
]);

function parsePayload(raw: string | null): EventPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as EventPayload;
    }
    return null;
  } catch {
    return null;
  }
}

function narrativeFromEvent(event: SessionEventRow, payload: EventPayload | null): string {
  switch (event.event_type) {
    case 'answer_submitted':
      return payload?.answer
        ? `Candidate answered: ${truncate(String(payload.answer), 200)}`
        : `Candidate submitted an answer in ${event.session_type} session`;
    case 'scoring_complete':
      return payload?.score != null
        ? `Scored ${payload.score}/${payload.maxScore ?? '?'}: ${payload.feedback ?? payload.narrative ?? ''}`
        : `Scoring completed for ${event.session_type} session`;
    case 'question_asked':
      return payload?.question
        ? `Question: ${truncate(String(payload.question), 200)}`
        : `Question posed in ${event.session_type} session`;
    case 'stage_advanced':
      return `Advanced to next stage in ${event.session_type} session`;
    case 'match_assigned':
      return `Match assigned in ${event.session_type} session`;
    default:
      return `${event.event_type} in ${event.session_type} session`;
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function extractConceptsFromPayload(payload: EventPayload | null): string[] {
  if (!payload) return [];
  const concepts: string[] = [];
  if (Array.isArray(payload.skills)) {
    for (const skill of payload.skills) {
      if (typeof skill === 'string' && skill.trim()) {
        const resolved = openSemanticTerm(skill.trim());
        if (resolved) concepts.push(resolved.canonicalKey);
      }
    }
  }
  if (Array.isArray(payload.concepts)) {
    for (const concept of payload.concepts) {
      if (typeof concept === 'string' && concept.trim()) {
        const resolved = openSemanticTerm(concept.trim());
        if (resolved) concepts.push(resolved.canonicalKey);
      }
    }
  }
  if (typeof payload.topic === 'string' && payload.topic.trim()) {
    const resolved = openSemanticTerm(payload.topic.trim());
    if (resolved) concepts.push(resolved.canonicalKey);
  }
  if (typeof payload.signal === 'string' && payload.signal.trim()) {
    const resolved = openSemanticTerm(payload.signal.trim());
    if (resolved) concepts.push(resolved.canonicalKey);
  }
  return [...new Set(concepts)];
}

function confidenceFromEventType(eventType: string, payload: EventPayload | null): number {
  switch (eventType) {
    case 'scoring_complete':
      return 0.9;
    case 'answer_submitted':
      return 0.7;
    case 'match_assigned':
      return 0.8;
    case 'question_asked':
      return 0.5;
    case 'stage_advanced':
      return 0.6;
    default:
      return 0.5;
  }
}

export async function ingestSessionEventsToLivingContext(
  db: D1Database,
  candidateId: string,
  sessionId: string,
  events: SessionEventRow[],
): Promise<SessionEventIngestionResult> {
  const identity = await ensureCandidateLivingContext(db, candidateId);
  if (!identity) {
    return {
      candidateId,
      sessionId,
      eventsProcessed: 0,
      episodesCreated: 0,
      assertionsCreated: 0,
      conceptsRegistered: 0,
      skippedDuplicates: 0,
    };
  }

  const store = new LivingContextStore(db);
  const workspacePersonId = identity.workspacePersonId;

  const interactionKey = `session-event-interaction:${sessionId}`;
  const interaction = await store.upsertInteraction({
    ingestionKey: interactionKey,
    workspacePersonId,
    interactionType: `interview_session:${events[0]?.session_type ?? 'unknown'}`,
    externalReference: sessionId,
    startedAt: events[0]?.created_at ?? null,
    endedAt: events[events.length - 1]?.created_at ?? null,
    metadata: {
      sessionType: events[0]?.session_type ?? 'unknown',
      eventCount: events.length,
    } as JsonObject,
  });

  let episodesCreated = 0;
  let assertionsCreated = 0;
  let conceptsRegistered = 0;
  let skippedDuplicates = 0;

  const evidenceEvents = events.filter(e => EVIDENCE_EVENT_TYPES.has(e.event_type));
  let versionCounter = 0;

  for (const event of evidenceEvents) {
    const payload = parsePayload(event.payload_json);
    const narrative = narrativeFromEvent(event, payload);

    const episodeKey = `session-event-episode:${event.id}`;
    const existingEpisode = await db.prepare(
      `SELECT id FROM episodes WHERE ingestion_key = ?1`,
    ).bind(episodeKey).first<{ id: string }>();
    if (existingEpisode) {
      skippedDuplicates++;
      continue;
    }

    const episode = await store.upsertEpisode({
      ingestionKey: episodeKey,
      workspacePersonId,
      interactionId: interaction.id,
      narrative,
      startedAt: event.created_at,
      metadata: {
        eventType: event.event_type,
        sessionType: event.session_type,
      } as JsonObject,
    });
    episodesCreated++;

    const sourceText = payload
      ? stableJson(payload as JsonObject)
      : event.event_type;
    const artifactKey = `session-event-artifact:${sessionId}`;
    const artifact = await store.upsertArtifact({
      ingestionKey: artifactKey,
      workspacePersonId,
      interactionId: interaction.id,
      artifactType: 'session_event_log',
      logicalKey: `session_events:${sessionId}`,
    });

    const versionKey = `session-event-version:${event.id}`;
    versionCounter++;
    const contentHash = await deterministicEntityId('content', sourceText);
    const version = await store.createArtifactVersion({
      ingestionKey: versionKey,
      artifactId: artifact.id,
      versionNumber: versionCounter,
      contentHash,
      mediaType: 'application/json',
      contentText: sourceText,
      byteLength: new TextEncoder().encode(sourceText).length,
    });

    const spanKey = `session-event-span:${event.id}`;
    const sourceSpan = await store.createSourceSpan({
      ingestionKey: spanKey,
      artifactVersionId: version.id,
      byteStart: 0,
      byteEnd: new TextEncoder().encode(sourceText).length,
      charStart: 0,
      charEnd: sourceText.length,
      exactText: truncate(sourceText, 2000),
      metadata: {
        eventId: event.id,
        eventType: event.event_type,
        createdAt: event.created_at,
      } as JsonObject,
    });

    const concepts = extractConceptsFromPayload(payload);
    const conceptIds: string[] = [];
    for (const canonicalKey of concepts) {
      const ns = canonicalKey.includes(':') ? canonicalKey.split(':')[0]! : 'open';
      const label = canonicalKey.includes(':')
        ? canonicalKey.split(':').slice(1).join(':').replace(/[-_]+/g, ' ')
        : canonicalKey.replace(/[-_]+/g, ' ');
      const concept = await store.upsertConcept({
        ingestionKey: `concept:${canonicalKey}`,
        canonicalKey,
        namespace: ns,
        label,
      });
      conceptIds.push(concept.id);
      conceptsRegistered++;
    }

    const assertionKey = `session-event-assertion:${event.id}`;
    const confidence = confidenceFromEventType(event.event_type, payload);
    const assertion = await store.upsertAssertion({
      ingestionKey: assertionKey,
      workspacePersonId,
      episodeId: episode.id,
      subjectType: 'workspace_person',
      subjectId: workspacePersonId,
      predicate: eventTypeToPredicate(event.event_type),
      objectType: event.session_type,
      objectValue: payload?.score != null ? payload.score : null,
      narrative,
      confidence,
      qualifiers: {
        eventType: event.event_type,
        sessionType: event.session_type,
        extractedProperties: payload
          ? stableJson({ semantic_terms: concepts.map(k => ({ canonical_key: k })) })
          : undefined,
      } as JsonObject,
      observedAt: event.created_at,
    });
    assertionsCreated++;

    await store.linkAssertionSourceSpan(assertion.id, sourceSpan.id);

    for (const conceptId of conceptIds) {
      await store.linkAssertionConcept(assertion.id, conceptId, 'about', 1.0);
    }
  }

  return {
    candidateId,
    sessionId,
    eventsProcessed: evidenceEvents.length,
    episodesCreated,
    assertionsCreated,
    conceptsRegistered,
    skippedDuplicates,
  };
}

function eventTypeToPredicate(eventType: string): string {
  switch (eventType) {
    case 'answer_submitted':
      return 'demonstrated_knowledge';
    case 'scoring_complete':
      return 'received_evaluation';
    case 'question_asked':
      return 'engaged_with_topic';
    case 'stage_advanced':
      return 'progressed_stage';
    case 'match_assigned':
      return 'matched_to_challenge';
    default:
      return 'participated_in';
  }
}

export async function loadSessionEventsForCandidate(
  db: D1Database,
  candidateId: string,
  cursor?: string | null,
  limit?: number,
): Promise<{ events: SessionEventRow[]; nextCursor: string | null }> {
  const effectiveLimit = Math.min(limit ?? 100, 500);
  const cursorClause = cursor
    ? `AND se.created_at < ?3`
    : '';
  const params = cursor
    ? [candidateId, effectiveLimit + 1, cursor]
    : [candidateId, effectiveLimit + 1];

  const result = await db.prepare(
    `SELECT se.id, se.session_id, se.session_type, se.candidate_id,
            se.event_type, se.payload_json, se.created_at
       FROM session_events se
      WHERE se.candidate_id = ?1
        ${cursorClause}
      ORDER BY se.created_at DESC
      LIMIT ?2`,
  ).bind(...params).all<SessionEventRow>();

  const rows = result.results ?? [];
  const hasMore = rows.length > effectiveLimit;
  const items = hasMore ? rows.slice(0, effectiveLimit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? lastItem.created_at : null;

  return { events: items, nextCursor };
}
