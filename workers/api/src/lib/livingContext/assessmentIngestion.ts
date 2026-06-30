/**
 * Assessment evidence → living context ingestion.
 *
 * Bridges the assessment layer (assessment_sessions, assessment_evidence_events,
 * assessment_evaluation_claims) into the living context graph so that assessment
 * behaviour signals, evaluation claims, and their source references flow into
 * the unified person graph.
 *
 * Each assessment session maps to an interaction; evidence events map to episodes
 * + assertions with exact source spans; evaluation claims map to additional
 * assertions with their own source provenance.
 */

import { ensureCandidateLivingContext } from './compatibility';
import { LivingContextStore } from './persistence';
import { openSemanticTerm } from './openTerms';
import type {
  ContextRecordConceptInput,
  ContextRecordEntityInput,
  ContextRecordSourceInput,
  JsonObject,
} from './types';

export interface AssessmentSessionRow {
  id: string;
  interview_id: string | null;
  mode: string;
  state: string;
  candidate_id: string | null;
  workspace_id: string | null;
  workspace_person_id: string | null;
  application_id: string | null;
  metadata_json: string;
  started_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AssessmentEvidenceEventRow {
  id: string;
  ingestion_key: string;
  session_id: string;
  sequence: number;
  kind: string;
  actor_type: string;
  actor_id: string | null;
  narrative: string;
  payload_json: string;
  context_record_id: string | null;
  occurred_at: string;
}

export interface AssessmentEventSourceRefRow {
  id: string;
  event_id: string;
  source_ref_type: string;
  source_ref_id: string;
  source_span_id: string | null;
  evidence_role: string;
  locator_json: string;
  exact_text: string;
  content_hash: string;
  metadata_json: string;
}

export interface AssessmentEvaluationClaimRow {
  id: string;
  report_id: string;
  polarity: string;
  dimension: string;
  narrative: string;
  confidence: number | null;
  created_at: string;
}

export interface AssessmentClaimSourceRefRow {
  id: string;
  claim_id: string;
  source_ref_type: string;
  source_ref_id: string;
  source_span_id: string | null;
  evidence_role: string;
  locator_json: string;
  exact_text: string;
  content_hash: string;
  metadata_json: string;
}

export interface AssessmentEvaluationReportRow {
  id: string;
  session_id: string;
  status: string;
  summary: string;
  output_json: string;
  created_at: string;
}

export interface AssessmentIngestionResult {
  sessionId: string;
  interactionId: string;
  episodeCount: number;
  assertionCount: number;
  claimAssertionCount: number;
  contextRecordCount: number;
}

function safeParseJson(raw: string): JsonObject {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
    return {};
  } catch {
    return {};
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Ingest a single assessment session (events + evaluation claims) into the
 * living context graph for the candidate.
 */
export async function ingestAssessmentToLivingContext(
  db: D1Database,
  session: AssessmentSessionRow,
  events: AssessmentEvidenceEventRow[],
  eventSourceRefs: Map<string, AssessmentEventSourceRefRow[]>,
  reports: AssessmentEvaluationReportRow[],
  claims: AssessmentEvaluationClaimRow[],
  claimSourceRefs: Map<string, AssessmentClaimSourceRefRow[]>,
): Promise<AssessmentIngestionResult | null> {
  if (!session.candidate_id) return null;

  const identity = await ensureCandidateLivingContext(db, session.candidate_id);
  if (!identity) return null;

  const store = new LivingContextStore(db);
  const { workspacePersonId } = identity;

  const interactionIngestionKey = `assessment:${session.id}`;
  const sessionMetadata = safeParseJson(session.metadata_json);
  const interaction = await store.upsertInteraction({
    ingestionKey: interactionIngestionKey,
    workspacePersonId,
    applicationId: identity.applicationId,
    interactionType: `assessment:${session.mode}`,
    externalReference: session.id,
    startedAt: session.started_at ?? session.created_at,
    endedAt: session.completed_at ?? session.submitted_at,
    metadata: {
      mode: session.mode,
      state: session.state,
      interviewId: session.interview_id,
      ...sessionMetadata,
    },
  });

  const artifactIngestionKey = `assessment_transcript:${session.id}`;
  const fullNarrative = events
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => `[${event.kind}] ${event.narrative}`)
    .join('\n\n');

  let artifact = null;
  let artifactVersion = null;
  if (fullNarrative.length > 0) {
    artifact = await store.upsertArtifact({
      ingestionKey: artifactIngestionKey,
      workspacePersonId,
      interactionId: interaction.id,
      artifactType: 'assessment_transcript',
      logicalKey: `assessment:${session.id}:transcript`,
      metadata: { mode: session.mode, eventCount: events.length },
    });
    const contentHash = await sha256(fullNarrative);
    artifactVersion = await store.createArtifactVersion({
      ingestionKey: `${artifactIngestionKey}:v1`,
      artifactId: artifact.id,
      versionNumber: 1,
      contentHash,
      mediaType: 'text/plain',
      contentText: fullNarrative,
      byteLength: byteLength(fullNarrative),
    });
  }

  let episodeCount = 0;
  let assertionCount = 0;
  let contextRecordCount = 0;

  let charCursor = 0;
  for (const event of events.sort((a, b) => a.sequence - b.sequence)) {
    const eventBlock = `[${event.kind}] ${event.narrative}`;
    const blockCharStart = charCursor;
    const blockCharEnd = charCursor + eventBlock.length;
    charCursor = blockCharEnd + 2; // +2 for \n\n separator

    const episodeIngestionKey = `assessment_event:${event.id}`;
    const episode = await store.upsertEpisode({
      ingestionKey: episodeIngestionKey,
      workspacePersonId,
      interactionId: interaction.id,
      narrative: event.narrative,
      startedAt: event.occurred_at,
      metadata: {
        kind: event.kind,
        actorType: event.actor_type,
        actorId: event.actor_id,
        sequence: event.sequence,
      },
    });
    episodeCount++;

    let sourceSpanId: string | null = null;
    if (artifactVersion) {
      const span = await store.createSourceSpan({
        ingestionKey: `assessment_event_span:${event.id}`,
        artifactVersionId: artifactVersion.id,
        stableSegmentId: `event:${event.sequence}`,
        charStart: blockCharStart,
        charEnd: blockCharEnd,
        byteStart: byteLength(fullNarrative.slice(0, blockCharStart)),
        byteEnd: byteLength(fullNarrative.slice(0, blockCharEnd)),
        exactText: eventBlock,
      });
      sourceSpanId = span.id;
    }

    const assertionIngestionKey = `assessment_event_assertion:${event.id}`;
    const assertion = await store.upsertAssertion({
      ingestionKey: assertionIngestionKey,
      workspacePersonId,
      episodeId: episode.id,
      subjectType: 'candidate',
      subjectId: session.candidate_id,
      predicate: `assessment:${event.kind}`,
      narrative: event.narrative,
      qualifiers: {
        actorType: event.actor_type,
        actorId: event.actor_id,
        mode: session.mode,
        payload: safeParseJson(event.payload_json),
      },
      confidence: null,
      observedAt: event.occurred_at,
    });
    assertionCount++;

    if (sourceSpanId) {
      await store.linkAssertionSourceSpan(assertion.id, sourceSpanId);
    }

    const refs = eventSourceRefs.get(event.id) ?? [];
    const sources: ContextRecordSourceInput[] = [];
    const entities: ContextRecordEntityInput[] = [];
    const concepts: ContextRecordConceptInput[] = [];

    if (sourceSpanId) {
      sources.push({
        sourceSpanId,
        evidenceRole: 'primary',
      });
    }

    for (const ref of refs) {
      sources.push({
        sourceRefType: ref.source_ref_type,
        sourceRefId: ref.source_ref_id,
        sourceSpanId: ref.source_span_id,
        evidenceRole: ref.evidence_role,
        locator: safeParseJson(ref.locator_json),
        exactText: ref.exact_text,
        contentHash: ref.content_hash,
        metadata: safeParseJson(ref.metadata_json),
      });
    }

    entities.push({
      entityType: 'assessment_session',
      entityId: session.id,
      relationship: 'source_session',
    });

    const kindTerm = openSemanticTerm(event.kind);
    if (kindTerm) {
      const concept = await store.upsertConcept({
        ingestionKey: `open-term:${kindTerm.canonicalKey}`,
        canonicalKey: kindTerm.canonicalKey,
        namespace: 'term',
        label: kindTerm.surface,
        metadata: { source: 'assessment_ingestion' },
      });
      concepts.push({
        conceptId: concept.id,
        relationship: 'event_kind',
        weight: 1.0,
      });
    }

    await store.upsertContextRecord({
      ingestionKey: `assessment_event_context:${event.id}`,
      workspacePersonId,
      interactionId: interaction.id,
      episodeId: episode.id,
      assertionId: assertion.id,
      recordType: `assessment:${event.kind}`,
      narrative: event.narrative,
      qualifiers: { mode: session.mode, sequence: event.sequence },
      confidence: null,
      observedAt: event.occurred_at,
      sources,
      entities,
      concepts,
    });
    contextRecordCount++;
  }

  let claimAssertionCount = 0;
  for (const report of reports) {
    const reportClaims = claims.filter((c) => c.report_id === report.id);
    for (const claim of reportClaims) {
      const claimEpisodeKey = `assessment_claim:${claim.id}`;
      const claimEpisode = await store.upsertEpisode({
        ingestionKey: claimEpisodeKey,
        workspacePersonId,
        interactionId: interaction.id,
        narrative: claim.narrative,
        startedAt: claim.created_at,
        metadata: {
          polarity: claim.polarity,
          dimension: claim.dimension,
          reportId: report.id,
          reportStatus: report.status,
        },
      });
      episodeCount++;

      const claimAssertionKey = `assessment_claim_assertion:${claim.id}`;
      const claimAssertion = await store.upsertAssertion({
        ingestionKey: claimAssertionKey,
        workspacePersonId,
        episodeId: claimEpisode.id,
        subjectType: 'candidate',
        subjectId: session.candidate_id,
        predicate: `evaluation:${claim.dimension}`,
        narrative: claim.narrative,
        qualifiers: {
          polarity: claim.polarity,
          dimension: claim.dimension,
          reportStatus: report.status,
          reportSummary: report.summary,
        },
        confidence: claim.confidence,
        polarity: claim.polarity === 'positive' ? 1 : claim.polarity === 'negative' ? -1 : 0,
        observedAt: claim.created_at,
      });
      claimAssertionCount++;

      const refs = claimSourceRefs.get(claim.id) ?? [];
      const claimSources: ContextRecordSourceInput[] = [];
      for (const ref of refs) {
        claimSources.push({
          sourceRefType: ref.source_ref_type,
          sourceRefId: ref.source_ref_id,
          sourceSpanId: ref.source_span_id,
          evidenceRole: ref.evidence_role,
          locator: safeParseJson(ref.locator_json),
          exactText: ref.exact_text,
          contentHash: ref.content_hash,
          metadata: safeParseJson(ref.metadata_json),
        });

        if (ref.source_span_id) {
          await store.linkAssertionSourceSpan(claimAssertion.id, ref.source_span_id);
        }
      }
      if (claimSources.length === 0) {
        claimSources.push({
          sourceRefType: 'assessment_evaluation_claim',
          sourceRefId: claim.id,
          evidenceRole: 'primary',
          exactText: claim.narrative,
          contentHash: await sha256(claim.narrative),
          locator: {
            reportId: report.id,
            dimension: claim.dimension,
            polarity: claim.polarity,
          },
        });
      }

      const claimConcepts: ContextRecordConceptInput[] = [];
      const dimTerm = openSemanticTerm(claim.dimension);
      if (dimTerm) {
        const concept = await store.upsertConcept({
          ingestionKey: `open-term:${dimTerm.canonicalKey}`,
          canonicalKey: dimTerm.canonicalKey,
          namespace: 'term',
          label: dimTerm.surface,
          metadata: { source: 'assessment_ingestion' },
        });
        claimConcepts.push({
          conceptId: concept.id,
          relationship: 'evaluation_dimension',
          weight: claim.confidence ?? 0.5,
        });
      }

      await store.upsertContextRecord({
        ingestionKey: `assessment_claim_context:${claim.id}`,
        workspacePersonId,
        interactionId: interaction.id,
        episodeId: claimEpisode.id,
        assertionId: claimAssertion.id,
        recordType: `evaluation:${claim.dimension}`,
        predicate: claim.polarity,
        narrative: claim.narrative,
        qualifiers: {
          mode: session.mode,
          dimension: claim.dimension,
          reportStatus: report.status,
        },
        confidence: claim.confidence,
        polarity: claim.polarity === 'positive' ? 1 : claim.polarity === 'negative' ? -1 : 0,
        observedAt: claim.created_at,
        sources: claimSources,
        entities: [
          {
            entityType: 'assessment_session',
            entityId: session.id,
            relationship: 'source_session',
          },
          {
            entityType: 'assessment_evaluation_report',
            entityId: report.id,
            relationship: 'evaluation_report',
          },
        ],
        concepts: claimConcepts,
      });
      contextRecordCount++;
    }
  }

  return {
    sessionId: session.id,
    interactionId: interaction.id,
    episodeCount,
    assertionCount,
    claimAssertionCount,
    contextRecordCount,
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AssessmentSessionData {
  session: AssessmentSessionRow;
  events: AssessmentEvidenceEventRow[];
  eventSourceRefs: Map<string, AssessmentEventSourceRefRow[]>;
  reports: AssessmentEvaluationReportRow[];
  claims: AssessmentEvaluationClaimRow[];
  claimSourceRefs: Map<string, AssessmentClaimSourceRefRow[]>;
}

/**
 * Load all assessment data needed for living context ingestion.
 * Used by both the real-time hook and the scheduled backfill.
 */
export async function loadAssessmentSessionData(
  db: D1Database,
  sessionId: string,
): Promise<AssessmentSessionData | null> {
  const session = await db.prepare(
    `SELECT id, interview_id, mode, state,
            candidate_id, workspace_id, workspace_person_id,
            application_id, metadata_json,
            started_at, submitted_at, completed_at, created_at
       FROM assessment_sessions WHERE id = ?1`,
  ).bind(sessionId).first<AssessmentSessionRow>();
  if (!session) return null;

  const eventRows = await db.prepare(
    `SELECT id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
            narrative, payload_json, context_record_id, occurred_at
       FROM assessment_evidence_events
      WHERE session_id = ?1
      ORDER BY sequence`,
  ).bind(sessionId).all<AssessmentEvidenceEventRow>();

  const events = eventRows.results ?? [];
  const eventSourceRefs = new Map<string, AssessmentEventSourceRefRow[]>();

  for (const event of events) {
    const refRows = await db.prepare(
      `SELECT id, event_id, source_ref_type, source_ref_id, source_span_id,
              evidence_role, locator_json, exact_text, content_hash, metadata_json
         FROM assessment_event_source_refs
        WHERE event_id = ?1`,
    ).bind(event.id).all<AssessmentEventSourceRefRow>();
    const refs = refRows.results ?? [];
    if (refs.length > 0) {
      eventSourceRefs.set(event.id, refs);
    }
  }

  const reportRows = await db.prepare(
    `SELECT id, session_id, status, summary, output_json, created_at
       FROM assessment_evaluation_reports
      WHERE session_id = ?1
      ORDER BY created_at`,
  ).bind(sessionId).all<AssessmentEvaluationReportRow>();
  const reports = reportRows.results ?? [];

  const claims: AssessmentEvaluationClaimRow[] = [];
  const claimSourceRefs = new Map<string, AssessmentClaimSourceRefRow[]>();

  for (const report of reports) {
    const claimRows = await db.prepare(
      `SELECT id, report_id, polarity, dimension, narrative, confidence, created_at
         FROM assessment_evaluation_claims
        WHERE report_id = ?1`,
    ).bind(report.id).all<AssessmentEvaluationClaimRow>();
    const reportClaims = claimRows.results ?? [];
    claims.push(...reportClaims);

    for (const claim of reportClaims) {
      const refRows = await db.prepare(
        `SELECT id, claim_id, source_ref_type, source_ref_id, source_span_id,
                evidence_role, locator_json, exact_text, content_hash, metadata_json
           FROM assessment_claim_source_refs
          WHERE claim_id = ?1`,
      ).bind(claim.id).all<AssessmentClaimSourceRefRow>();
      const refs = refRows.results ?? [];
      if (refs.length > 0) {
        claimSourceRefs.set(claim.id, refs);
      }
    }
  }

  return { session, events, eventSourceRefs, reports, claims, claimSourceRefs };
}

/**
 * Real-time assessment → living context ingestion.
 * Call after an evaluation report is created so that assessment evidence
 * flows into the person graph immediately, not deferred to scheduled backfill.
 */
export async function ingestAssessmentSessionRealTime(
  db: D1Database,
  sessionId: string,
): Promise<AssessmentIngestionResult | null> {
  const data = await loadAssessmentSessionData(db, sessionId);
  if (!data) return null;
  return ingestAssessmentToLivingContext(
    db,
    data.session,
    data.events,
    data.eventSourceRefs,
    data.reports,
    data.claims,
    data.claimSourceRefs,
  );
}
