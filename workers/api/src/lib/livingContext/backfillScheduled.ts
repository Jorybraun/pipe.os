/**
 * Scheduled backfill runner for the living context graph.
 *
 * Wires the BackfillOrchestrator to concrete backfill tasks executed
 * on the Cloudflare Workers cron trigger. Each invocation:
 *   1. Ensures checkpoints exist for all registered tasks
 *   2. Finds tasks whose dependencies are satisfied
 *   3. Executes the next batch for each ready task
 *   4. Persists cursor progress for resume-on-restart
 *
 * Tasks:
 *   - candidates_to_living_context: backfill all candidates missing LC identity
 *   - contacts_to_living_context: backfill all contacts missing LC identity
 *   - resumes_to_living_context: native resume ingestion for all candidates with resumes
 *   - meetings_to_living_context: ingest meeting transcripts into person graphs
 *   - phone_calls_to_living_context: ingest phone call recordings/transcripts
 *   - code_reviews_to_living_context: ingest code review session transcripts + score reports
 *   - projection_outbox_drain: process pending neo4j projection jobs
 */

import type { Env } from '../../types';
import { BackfillOrchestrator } from './backfillOrchestrator';
import type { BackfillTaskDefinition, BackfillOrchestratorStatus } from './backfillOrchestrator';
import { ensureCandidateLivingContext, ensureContactLivingContext } from './compatibility';
import { ingestResumeToLivingContext } from './resumeIngestion';
import {
  ingestMeetingTranscriptToLivingContext,
  parseStoredMeetingTranscript,
} from './meetingTranscript';
import { ingestPhoneCallToLivingContext, ingestPhoneRecruiterNote } from './phoneCall';
import {
  ingestCodeReviewTranscriptToLivingContext,
  ingestCodeReviewScoreReportToLivingContext,
} from './codeReview';
import type { CodeReviewTranscript } from './codeReview';
import { LivingContextStore } from './persistence';
import { ingestHistoricalCultureTranscript } from './cultureTranscriptBackfill';
import { ingestAssessmentToLivingContext, loadAssessmentSessionData } from './assessmentIngestion';
import { ingestSessionEventsToLivingContext, loadSessionEventsForCandidate } from './sessionEventIngestion';
import type { SessionEventRow } from './sessionEventIngestion';
import type {
  AssessmentSessionRow,
  AssessmentEvidenceEventRow,
  AssessmentEventSourceRefRow,
  AssessmentEvaluationReportRow,
  AssessmentEvaluationClaimRow,
  AssessmentClaimSourceRefRow,
} from './assessmentIngestion';
import { processProjectionOutbox } from './projection';
import { checkGate } from './rolloutEnforcement';

const BATCH_SIZE = 50;

export const BACKFILL_TASKS: BackfillTaskDefinition[] = [
  {
    taskKey: 'candidates_to_living_context',
    description: 'Ensure all existing candidates have a living context identity (person + workspace_person + application)',
    dependsOn: [],
  },
  {
    taskKey: 'contacts_to_living_context',
    description: 'Ensure all existing contacts have a living context identity (person + workspace_person)',
    dependsOn: [],
  },
  {
    taskKey: 'resumes_to_living_context',
    description: 'Native resume ingestion for all candidates with resume_s3_key, creating per-section source spans',
    dependsOn: ['candidates_to_living_context'],
  },
  {
    taskKey: 'meetings_to_living_context',
    description: 'Ingest meeting transcripts into contact/candidate person graphs with per-segment source spans',
    dependsOn: ['contacts_to_living_context'],
  },
  {
    taskKey: 'phone_calls_to_living_context',
    description: 'Ingest phone call recordings and transcripts into candidate person graphs',
    dependsOn: ['candidates_to_living_context'],
  },
  {
    taskKey: 'code_reviews_to_living_context',
    description: 'Ingest code review session transcripts and score reports into candidate person graphs',
    dependsOn: ['candidates_to_living_context'],
  },
  {
    taskKey: 'repo_assertions_to_living_context',
    description: 'Ingest repo semantic assertions (structural facts, code episodes, semantic assertions) into living context records with source span provenance',
    dependsOn: [],
  },
  {
    taskKey: 'culture_sessions_to_living_context',
    description: 'Ingest culture interview session transcripts into candidate person graphs with per-turn source spans',
    dependsOn: ['candidates_to_living_context'],
  },
  {
    taskKey: 'assessments_to_living_context',
    description: 'Ingest assessment evidence events and evaluation claims into candidate person graphs with source provenance',
    dependsOn: ['candidates_to_living_context'],
  },
  {
    taskKey: 'assessment_evaluations_to_living_context',
    description: 'Catch up assessment evaluation report claims missing from partially ingested assessment person graphs',
    dependsOn: ['candidates_to_living_context'],
  },
  {
    taskKey: 'session_events_to_living_context',
    description: 'Ingest session events (answer_submitted, scoring_complete, etc.) across all interview types into candidate person graphs',
    dependsOn: ['candidates_to_living_context'],
  },
  {
    taskKey: 'projection_outbox_drain',
    description: 'Process all pending neo4j projection outbox jobs',
    dependsOn: [
      'candidates_to_living_context',
      'contacts_to_living_context',
      'resumes_to_living_context',
      'meetings_to_living_context',
      'phone_calls_to_living_context',
      'culture_sessions_to_living_context',
      'code_reviews_to_living_context',
      'assessments_to_living_context',
      'assessment_evaluations_to_living_context',
      'session_events_to_living_context',
      'repo_assertions_to_living_context',
    ],
  },
];

interface CandidateRow {
  id: string;
  resume_s3_key: string | null;
}

interface ContactRow {
  id: string;
}

interface MeetingRow {
  id: string;
  owner_id: string;
  transcript_json: string;
  transcript_summary: string | null;
  recording_r2_key: string | null;
  started_at: string | null;
  ended_at: string | null;
}

interface PhoneCallRow {
  id: string;
  candidate_id: string;
  owner_id: string;
  direction: string;
  twilio_call_sid: string | null;
  duration_seconds: number | null;
  recording_s3_key: string | null;
  transcription: string | null;
  transcription_status: string | null;
  recruiter_notes: string | null;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
}

interface CodeReviewSessionRow {
  id: string;
  candidate_id: string;
  challenge_id: string;
  assessment_id: string;
  implementer_persona: string;
  status: string;
  transcript: string | null;
  score_report: string | null;
  created_at: string;
  updated_at: string;
}

interface RepoAssertionRow {
  id: string;
  repo_snapshot_id: string;
  episode_id: string | null;
  subject: string;
  predicate: string;
  object: string | null;
  narrative: string;
  qualifiers_json: string;
  confidence: number;
  assertion_version: string;
}

interface RepoAssertionSpanRow {
  assertion_id: string;
  source_span_id: string;
}

interface RepoSourceSpanRow {
  id: string;
  artifact_version_id: string;
  byte_start: number | null;
  byte_end: number | null;
  line_start: number | null;
  line_end: number | null;
  content_hash: string;
  path: string | null;
  exact_text: string;
}

interface RepoArtifactPathRow {
  path: string | null;
}

interface CultureSessionRow {
  id: string;
  candidate_id: string;
  assessment_id: string;
  state: string;
  transcript: string | null;
  created_at: string;
  updated_at: string;
}
interface BackfillBatchResult {
  processed: number;
  failed: number;
  cursor: string | null;
  done: boolean;
}

async function backfillCandidatesBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT c.id FROM candidates c
     LEFT JOIN workspace_people wp ON wp.id IN (
       SELECT a.workspace_person_id FROM applications a WHERE a.legacy_candidate_id = c.id
     )
     WHERE wp.id IS NULL
       AND (?1 IS NULL OR c.id > ?1)
     ORDER BY c.id
     LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<CandidateRow>();

  const candidates = rows.results ?? [];
  if (candidates.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const candidate of candidates) {
    try {
      await ensureCandidateLivingContext(db, candidate.id);
      processed++;
    } catch (err) {
      console.error('[backfill] candidate LC failed:', candidate.id, err);
      failed++;
    }
    lastId = candidate.id;
  }

  return {
    processed,
    failed,
    cursor: lastId,
    done: candidates.length < BATCH_SIZE,
  };
}

async function backfillContactsBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT c.id FROM contacts c
     LEFT JOIN workspace_people wp ON json_extract(wp.context_json, '$.contactId') = c.id
     WHERE wp.id IS NULL
       AND (?1 IS NULL OR c.id > ?1)
     ORDER BY c.id
     LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<ContactRow>();

  const contacts = rows.results ?? [];
  if (contacts.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const contact of contacts) {
    try {
      await ensureContactLivingContext(db, contact.id);
      processed++;
    } catch (err) {
      console.error('[backfill] contact LC failed:', contact.id, err);
      failed++;
    }
    lastId = contact.id;
  }

  return {
    processed,
    failed,
    cursor: lastId,
    done: contacts.length < BATCH_SIZE,
  };
}

async function backfillResumesBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT c.id, c.resume_s3_key FROM candidates c
     WHERE c.resume_s3_key IS NOT NULL AND c.resume_s3_key != ''
       AND NOT EXISTS (
         SELECT 1 FROM artifacts a
         JOIN workspace_people wp ON wp.id = a.workspace_person_id
         JOIN applications app ON app.workspace_person_id = wp.id AND app.legacy_candidate_id = c.id
         WHERE a.artifact_type = 'resume' AND a.logical_key = c.resume_s3_key
       )
       AND (?1 IS NULL OR c.id > ?1)
     ORDER BY c.id
     LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<CandidateRow>();

  const candidates = rows.results ?? [];
  if (candidates.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const candidate of candidates) {
    if (!candidate.resume_s3_key) continue;
    try {
      // Attempt to load resume text from existing parsed data
      const parsed = await db.prepare(
        `SELECT skills FROM candidates WHERE id = ?1`,
      ).bind(candidate.id).first<{ skills: string | null }>();

      // If we have skills text from prior parsing, use it as a minimal resume representation
      const resumeText = parsed?.skills ?? '';
      if (resumeText.length >= 20) {
        await ingestResumeToLivingContext(db, {
          candidateId: candidate.id,
          storageKey: candidate.resume_s3_key,
          mediaType: 'application/pdf',
          resumeText,
        });
      }
      processed++;
    } catch (err) {
      console.error('[backfill] resume LC failed:', candidate.id, err);
      failed++;
    }
    lastId = candidate.id;
  }

  return {
    processed,
    failed,
    cursor: lastId,
    done: candidates.length < BATCH_SIZE,
  };
}

async function backfillMeetingsBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT m.id, m.owner_id, m.transcript_json, m.transcript_summary,
            m.recording_r2_key, m.started_at, m.ended_at
     FROM meetings m
     WHERE m.transcript_json IS NOT NULL AND m.transcript_json != ''
       AND NOT EXISTS (
         SELECT 1 FROM interactions i
         WHERE i.interaction_type = 'meeting'
           AND i.external_reference = m.id
       )
       AND (?1 IS NULL OR m.id > ?1)
     ORDER BY m.id
     LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<MeetingRow>();

  const meetings = rows.results ?? [];
  if (meetings.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const row of meetings) {
    try {
      const { transcript, segments } = parseStoredMeetingTranscript(row.transcript_json);
      await ingestMeetingTranscriptToLivingContext(db, {
        meetingId: row.id,
        ownerId: row.owner_id,
        transcript,
        segments,
        summary: row.transcript_summary,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        recordingKey: row.recording_r2_key,
        provider: 'scheduled-backfill',
      });
      processed++;
    } catch (err) {
      console.error('[backfill] meeting LC failed:', row.id, err);
      failed++;
    }
    lastId = row.id;
  }

  return { processed, failed, cursor: lastId, done: meetings.length < BATCH_SIZE };
}

async function backfillPhoneCallsBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT pc.id, pc.candidate_id, pc.owner_id, pc.direction,
            pc.twilio_call_sid, pc.duration_seconds, pc.recording_s3_key,
            pc.transcription, pc.transcription_status, pc.recruiter_notes,
            pc.started_at, pc.ended_at, pc.updated_at
     FROM phone_calls pc
     WHERE (pc.transcription IS NOT NULL OR pc.recording_s3_key IS NOT NULL OR pc.recruiter_notes IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM interactions i
         WHERE i.interaction_type = 'phone_call'
           AND i.external_reference = pc.id
       )
       AND (?1 IS NULL OR pc.id > ?1)
     ORDER BY pc.id
     LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<PhoneCallRow>();

  const calls = rows.results ?? [];
  if (calls.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const row of calls) {
    try {
      await ingestPhoneCallToLivingContext(db, {
        callId: row.id,
        candidateId: row.candidate_id,
        direction: row.direction,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        twilioCallSid: row.twilio_call_sid,
        recording: row.recording_s3_key
          ? { storageKey: row.recording_s3_key, durationSeconds: row.duration_seconds }
          : null,
        transcript: row.transcription,
        transcriptProvider: row.transcription_status === 'COMPLETED'
          ? 'scheduled-backfill'
          : null,
      });
      if (row.recruiter_notes) {
        await ingestPhoneRecruiterNote(db, {
          callId: row.id,
          candidateId: row.candidate_id,
          direction: row.direction,
          note: row.recruiter_notes,
          observedAt: row.updated_at,
          recruiterActorId: row.owner_id,
          startedAt: row.started_at,
          endedAt: row.ended_at,
        });
      }
      processed++;
    } catch (err) {
      console.error('[backfill] phone call LC failed:', row.id, err);
      failed++;
    }
    lastId = row.id;
  }

  return { processed, failed, cursor: lastId, done: calls.length < BATCH_SIZE };
}

async function backfillCodeReviewsBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT crs.id, crs.candidate_id, crs.challenge_id, crs.assessment_id,
            crs.implementer_persona, crs.status, crs.transcript, crs.score_report,
            crs.created_at, crs.updated_at
     FROM code_review_sessions crs
     WHERE crs.status IN ('verdict_submitted', 'scoring', 'scored')
       AND NOT EXISTS (
         SELECT 1 FROM interactions i
         WHERE i.interaction_type = 'code_review'
           AND i.external_reference = crs.id
       )
       AND (?1 IS NULL OR crs.id > ?1)
     ORDER BY crs.id
     LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<CodeReviewSessionRow>();

  const sessions = rows.results ?? [];
  if (sessions.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const row of sessions) {
    try {
      const transcript: CodeReviewTranscript = row.transcript
        ? JSON.parse(row.transcript) as CodeReviewTranscript
        : { rounds: [] };
      await ingestCodeReviewTranscriptToLivingContext(db, {
        sessionId: row.id,
        candidateId: row.candidate_id,
        challengeId: row.challenge_id,
        assessmentId: row.assessment_id,
        transcript,
        status: row.status,
        implementerPersona: row.implementer_persona,
        startedAt: row.created_at,
        endedAt: ['verdict_submitted', 'scoring', 'scored'].includes(row.status)
          ? row.updated_at
          : null,
        observedAt: row.updated_at,
      });
      if (row.score_report) {
        await ingestCodeReviewScoreReportToLivingContext(db, {
          sessionId: row.id,
          candidateId: row.candidate_id,
          challengeId: row.challenge_id,
          assessmentId: row.assessment_id,
          scoreReportJson: row.score_report,
          observedAt: row.updated_at,
          producer: 'automated_scorer',
          startedAt: row.created_at,
        });
      }
      processed++;
    } catch (err) {
      console.error('[backfill] code review LC failed:', row.id, err);
      failed++;
    }
    lastId = row.id;
  }

  return { processed, failed, cursor: lastId, done: sessions.length < BATCH_SIZE };
}

async function backfillRepoAssertionsBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT rsa.id, rsa.repo_snapshot_id, rsa.episode_id,
            rsa.subject, rsa.predicate, rsa.object, rsa.narrative,
            rsa.qualifiers_json, rsa.confidence, rsa.assertion_version
       FROM repo_semantic_assertions rsa
       LEFT JOIN context_records cr
         ON cr.ingestion_key = 'repo-assertion-context:' || rsa.id
      WHERE cr.id IS NULL
        AND (?1 IS NULL OR rsa.id > ?1)
      ORDER BY rsa.id
      LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<RepoAssertionRow>();

  const assertions = rows.results ?? [];
  if (assertions.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  const store = new LivingContextStore(db, () => new Date().toISOString());

  for (const assertion of assertions) {
    try {
      const spanRows = await db.prepare(
        `SELECT assertion_id, source_span_id
           FROM repo_assertion_source_spans
          WHERE assertion_id = ?1`,
      ).bind(assertion.id).all<RepoAssertionSpanRow>();

      const spanIds = (spanRows.results ?? []).map((r) => r.source_span_id);

      const sourceRefs: Array<{
        sourceRefType: string;
        sourceRefId: string;
        evidenceRole: string;
        locator: { [key: string]: string | number | boolean | null };
        exactText: string | null;
        contentHash: string | null;
      }> = [];

      for (const spanId of spanIds) {
        const span = await db.prepare(
          `SELECT rss.id, rss.artifact_version_id, rss.byte_start, rss.byte_end,
                  rss.line_start, rss.line_end, rss.content_hash, rss.path, rss.exact_text
             FROM repo_source_spans rss
            WHERE rss.id = ?1`,
        ).bind(spanId).first<RepoSourceSpanRow>();

        if (!span) continue;

        const artifactPath = span.path ?? (await db.prepare(
          `SELECT rsa.path FROM repo_source_artifacts rsa
             JOIN repo_artifact_versions rav ON rav.artifact_id = rsa.id
            WHERE rav.id = ?1`,
        ).bind(span.artifact_version_id).first<RepoArtifactPathRow>())?.path ?? null;

        sourceRefs.push({
          sourceRefType: 'repo_source_span',
          sourceRefId: span.id,
          evidenceRole: 'source',
          locator: {
            repoSnapshotId: assertion.repo_snapshot_id,
            artifactVersionId: span.artifact_version_id,
            path: artifactPath,
            byteStart: span.byte_start,
            byteEnd: span.byte_end,
            lineStart: span.line_start,
            lineEnd: span.line_end,
          },
          exactText: span.exact_text,
          contentHash: span.content_hash,
        });
      }

      if (sourceRefs.length === 0) {
        processed++;
        lastId = assertion.id;
        continue;
      }

      const facetRows = await db.prepare(
        `SELECT raf.facet_id, rf.family, rf.slug, rf.label, raf.weight
           FROM repo_assertion_facets raf
           JOIN repo_facets rf ON rf.id = raf.facet_id
          WHERE raf.assertion_id = ?1`,
      ).bind(assertion.id).all<{
        facet_id: string;
        family: string;
        slug: string;
        label: string;
        weight: number;
      }>();

      const concepts: Array<{ conceptId: string; relationship: string; weight: number }> = [];
      for (const facetRow of facetRows.results ?? []) {
        const concept = await store.upsertConcept({
          ingestionKey: `repo-facet-concept:${facetRow.family}:${facetRow.slug}`,
          canonicalKey: `${facetRow.family}:${facetRow.slug}`,
          namespace: facetRow.family,
          label: facetRow.label,
          metadata: { source: 'repo_assertion_backfill' },
        });
        concepts.push({
          conceptId: concept.id,
          relationship: 'tagged',
          weight: facetRow.weight,
        });
      }

      const qualifiers = JSON.parse(assertion.qualifiers_json || '{}') as Record<string, unknown>;

      await store.upsertContextRecord({
        ingestionKey: `repo-assertion-context:${assertion.id}`,
        scopeType: 'repo_snapshot',
        scopeId: assertion.repo_snapshot_id,
        recordType: 'repo_semantic_assertion',
        predicate: assertion.predicate,
        narrative: assertion.narrative,
        qualifiers: {
          ...qualifiers,
          subject: assertion.subject,
          object: assertion.object,
          assertionVersion: assertion.assertion_version,
          episodeId: assertion.episode_id,
        },
        confidence: assertion.confidence,
        extractionVersion: assertion.assertion_version,
        observedAt: new Date().toISOString(),
        sources: sourceRefs,
        entities: [
          {
            entityType: 'repo_snapshot',
            entityId: assertion.repo_snapshot_id,
            relationship: 'scope',
          },
        ],
        concepts,
      });

      processed++;
    } catch (err) {
      console.error('[backfill] repo assertion LC failed:', assertion.id, err);
      failed++;
    }
    lastId = assertion.id;
  }

  return { processed, failed, cursor: lastId, done: assertions.length < BATCH_SIZE };
}

async function backfillCultureSessionsBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT cis.id, cis.candidate_id, cis.assessment_id, cis.state,
            cis.transcript, cis.created_at, cis.updated_at
     FROM culture_interview_sessions cis
     WHERE cis.state IN ('scored', 'completed', 'scoring')
       AND cis.transcript IS NOT NULL AND cis.transcript != ''
       AND NOT EXISTS (
         SELECT 1 FROM interactions i
         WHERE i.interaction_type = 'culture_interview'
           AND i.external_reference = cis.id
       )
       AND (?1 IS NULL OR cis.id > ?1)
     ORDER BY cis.id
     LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<CultureSessionRow>();

  const sessions = rows.results ?? [];
  if (sessions.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const row of sessions) {
    try {
      const transcript = JSON.parse(row.transcript!) as import('../cultureAgent').CultureTranscript;
      await ingestHistoricalCultureTranscript(db, {
        candidateId: row.candidate_id,
        sessionId: row.id,
        transcript,
        extractSemantics: false,
        fallbackObservedAt: row.updated_at,
        sessionStartedAt: row.created_at,
        sessionEndedAt: ['scored', 'completed'].includes(row.state) ? row.updated_at : null,
      });
      processed++;
    } catch (err) {
      console.error('[backfill] culture session LC failed:', row.id, err);
      failed++;
    }
    lastId = row.id;
  }

  return { processed, failed, cursor: lastId, done: sessions.length < BATCH_SIZE };
}

async function backfillAssessmentsBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const hasTable = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assessment_sessions'`,
  ).first<{ name: string }>();
  if (!hasTable) return { processed: 0, failed: 0, cursor, done: true };

  const rows = await db.prepare(
    `SELECT ass.id, ass.interview_id, ass.mode, ass.state,
            ass.candidate_id, ass.workspace_id, ass.workspace_person_id,
            ass.application_id, ass.metadata_json,
            ass.started_at, ass.submitted_at, ass.completed_at, ass.created_at
       FROM assessment_sessions ass
      WHERE ass.candidate_id IS NOT NULL
        AND ass.state NOT IN ('INTAKE', 'CANCELLED')
        AND (
          NOT EXISTS (
            SELECT 1 FROM interactions i
             WHERE i.interaction_type LIKE 'assessment:%'
               AND i.external_reference = ass.id
          )
          OR EXISTS (
            SELECT 1
              FROM assessment_evaluation_reports aer
             WHERE aer.session_id = ass.id
               AND NOT EXISTS (
                 SELECT 1
                   FROM context_record_entities cre
                  WHERE cre.entity_type = 'assessment_evaluation_report'
                    AND cre.entity_id = aer.id
               )
          )
        )
        AND (?1 IS NULL OR ass.id > ?1)
      ORDER BY ass.id
      LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<AssessmentSessionRow>();

  const sessions = rows.results ?? [];
  if (sessions.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const session of sessions) {
    try {
      const data = await loadAssessmentSessionData(db, session.id);
      if (data) {
        await ingestAssessmentToLivingContext(
          db,
          data.session,
          data.events,
          data.eventSourceRefs,
          data.reports,
          data.claims,
          data.claimSourceRefs,
        );
      }
      processed++;
    } catch (err) {
      console.error('[backfill] assessment LC failed:', session.id, err);
      failed++;
    }
    lastId = session.id;
  }

  return { processed, failed, cursor: lastId, done: sessions.length < BATCH_SIZE };
}

async function backfillAssessmentEvaluationsBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const hasTable = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assessment_sessions'`,
  ).first<{ name: string }>();
  if (!hasTable) return { processed: 0, failed: 0, cursor, done: true };

  const rows = await db.prepare(
    `SELECT ass.id, ass.interview_id, ass.mode, ass.state,
            ass.candidate_id, ass.workspace_id, ass.workspace_person_id,
            ass.application_id, ass.metadata_json,
            ass.started_at, ass.submitted_at, ass.completed_at, ass.created_at
       FROM assessment_sessions ass
      WHERE ass.candidate_id IS NOT NULL
        AND ass.state NOT IN ('INTAKE', 'CANCELLED')
        AND EXISTS (
          SELECT 1
            FROM assessment_evaluation_reports aer
           WHERE aer.session_id = ass.id
             AND NOT EXISTS (
               SELECT 1
                 FROM context_record_entities cre
                WHERE cre.entity_type = 'assessment_evaluation_report'
                  AND cre.entity_id = aer.id
             )
        )
        AND (?1 IS NULL OR ass.id > ?1)
      ORDER BY ass.id
      LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<AssessmentSessionRow>();

  const sessions = rows.results ?? [];
  if (sessions.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const session of sessions) {
    try {
      const data = await loadAssessmentSessionData(db, session.id);
      if (data) {
        await ingestAssessmentToLivingContext(
          db,
          data.session,
          data.events,
          data.eventSourceRefs,
          data.reports,
          data.claims,
          data.claimSourceRefs,
        );
      }
      processed++;
    } catch (err) {
      console.error('[backfill] assessment evaluation LC failed:', session.id, err);
      failed++;
    }
    lastId = session.id;
  }

  return { processed, failed, cursor: lastId, done: sessions.length < BATCH_SIZE };
}

interface SessionEventCandidateRow {
  candidate_id: string;
  session_id: string;
}

async function backfillSessionEventsBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const hasTable = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_events'`,
  ).first<{ name: string }>();
  if (!hasTable) return { processed: 0, failed: 0, cursor, done: true };

  const rows = await db.prepare(
    `SELECT DISTINCT se.candidate_id, se.session_id
       FROM session_events se
      WHERE se.event_type IN ('answer_submitted', 'scoring_complete', 'question_asked', 'stage_advanced', 'match_assigned')
        AND NOT EXISTS (
          SELECT 1 FROM interactions i
           WHERE i.interaction_type LIKE 'interview_session:%'
             AND i.external_reference = se.session_id
        )
        AND (?1 IS NULL OR se.session_id > ?1)
      ORDER BY se.session_id
      LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<SessionEventCandidateRow>();

  const sessions = rows.results ?? [];
  if (sessions.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const row of sessions) {
    try {
      const { events } = await loadSessionEventsForCandidate(db, row.candidate_id);
      const sessionEvents = events.filter((e: SessionEventRow) => e.session_id === row.session_id);
      if (sessionEvents.length > 0) {
        await ingestSessionEventsToLivingContext(db, row.candidate_id, row.session_id, sessionEvents);
      }
      processed++;
    } catch (err) {
      console.error('[backfill] session event LC failed:', row.session_id, err);
      failed++;
    }
    lastId = row.session_id;
  }

  return { processed, failed, cursor: lastId, done: sessions.length < BATCH_SIZE };
}

export interface BackfillScheduledResult {
  gateEnabled: boolean;
  status: BackfillOrchestratorStatus;
  tasksExecuted: string[];
  batchResults: Record<string, BackfillBatchResult>;
}

/**
 * Run a single batch of backfill work. Designed to be called from a cron trigger.
 * Respects rollout gates — only runs when 'living_context_backfill' gate is enabled.
 */
export async function runScheduledBackfill(env: Env): Promise<BackfillScheduledResult> {
  const db = env.DB;
  const orchestrator = new BackfillOrchestrator(db, BACKFILL_TASKS);

  // Check rollout gate
  const gateResult = await checkGate(db, 'living_context_backfill');
  if (!gateResult.allowed) {
    return {
      gateEnabled: false,
      status: await orchestrator.getStatus(),
      tasksExecuted: [],
      batchResults: {},
    };
  }

  await orchestrator.ensureCheckpoints();

  const readyTasks = await orchestrator.getReadyTasks();
  const tasksExecuted: string[] = [];
  const batchResults: Record<string, BackfillBatchResult> = {};

  for (const taskKey of readyTasks) {
    const checkpoint = (await orchestrator.getStatus()).tasks.find((t) => t.taskKey === taskKey);
    const cursor = checkpoint?.cursor ?? null;

    await orchestrator.markRunning(taskKey);
    tasksExecuted.push(taskKey);

    let result: BackfillBatchResult;
    try {
      switch (taskKey) {
        case 'candidates_to_living_context':
          result = await backfillCandidatesBatch(db, cursor);
          break;
        case 'contacts_to_living_context':
          result = await backfillContactsBatch(db, cursor);
          break;
        case 'resumes_to_living_context':
          result = await backfillResumesBatch(db, cursor);
          break;
        case 'meetings_to_living_context':
          result = await backfillMeetingsBatch(db, cursor);
          break;
        case 'phone_calls_to_living_context':
          result = await backfillPhoneCallsBatch(db, cursor);
          break;
        case 'code_reviews_to_living_context':
          result = await backfillCodeReviewsBatch(db, cursor);
          break;
        case 'repo_assertions_to_living_context':
          result = await backfillRepoAssertionsBatch(db, cursor);
          break;
        case 'culture_sessions_to_living_context':
          result = await backfillCultureSessionsBatch(db, cursor);
          break;
        case 'assessments_to_living_context':
          result = await backfillAssessmentsBatch(db, cursor);
          break;
        case 'assessment_evaluations_to_living_context':
          result = await backfillAssessmentEvaluationsBatch(db, cursor);
          break;
        case 'session_events_to_living_context':
          result = await backfillSessionEventsBatch(db, cursor);
          break;
        case 'projection_outbox_drain': {
          const projResult = await processProjectionOutbox(env);
          result = {
            processed: projResult.completed,
            failed: projResult.failed,
            cursor: null,
            done: projResult.completed === 0 && projResult.failed === 0,
          };
          break;
        }
        default:
          result = { processed: 0, failed: 0, cursor: null, done: true };
      }

      batchResults[taskKey] = result;
      await orchestrator.updateProgress(
        taskKey,
        result.cursor ?? '',
        (checkpoint?.processed ?? 0) + result.processed,
        (checkpoint?.failed ?? 0) + result.failed,
      );

      if (result.done) {
        await orchestrator.markCompleted(taskKey);
      } else {
        await orchestrator.markPending(taskKey);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await orchestrator.markFailed(taskKey, msg);
      batchResults[taskKey] = { processed: 0, failed: 1, cursor, done: false };
    }
  }

  return {
    gateEnabled: true,
    status: await orchestrator.getStatus(),
    tasksExecuted,
    batchResults,
  };
}
