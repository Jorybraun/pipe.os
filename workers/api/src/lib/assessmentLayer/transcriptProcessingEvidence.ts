import {
  AssessmentLayerStore,
  type AssessmentSessionState,
} from './persistence';
import { stableJson } from '../livingContext/persistence';
import type { JsonObject, JsonValue } from '../livingContext/types';

export interface MeetingTranscriptProcessingFailureInput {
  meetingId: string;
  ownerId: string;
  scheduledInterviewId?: string | null;
  guestContactId?: string | null;
  recordingKey: string;
  transcriptionSourceKey: string;
  errorMessage: string;
  errorStack?: string | null;
  observedAt: string;
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
  ).bind(tableName).first<{ name: string }>();
  return Boolean(row);
}

async function hasAssessmentSchema(db: D1Database): Promise<boolean> {
  return await tableExists(db, 'assessment_sessions')
    && await tableExists(db, 'context_records')
    && await tableExists(db, 'context_record_source_refs');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function currentAssessmentState(
  db: D1Database,
  sessionId: string,
): Promise<AssessmentSessionState | null> {
  const row = await db.prepare(
    'SELECT state FROM assessment_sessions WHERE id = ?1',
  ).bind(sessionId).first<{ state: AssessmentSessionState }>();
  return row?.state ?? null;
}

async function transitionToDiagnostic(input: {
  db: D1Database;
  store: AssessmentLayerStore;
  sessionId: string;
  reason: string;
}): Promise<void> {
  const state = await currentAssessmentState(input.db, input.sessionId);
  if (state === null || state === 'DIAGNOSTIC') return;
  if (state === 'EVALUATED' || state === 'CANCELLED') return;
  await input.store.transitionAssessmentState({
    sessionId: input.sessionId,
    toState: 'DIAGNOSTIC',
    reason: input.reason,
    actorType: 'system',
  });
}

function failureSnapshot(input: MeetingTranscriptProcessingFailureInput): JsonObject {
  return {
    sourceKind: 'meeting_transcript_processing.failure',
    meetingId: input.meetingId,
    ownerId: input.ownerId,
    scheduledInterviewId: input.scheduledInterviewId ?? null,
    guestContactId: input.guestContactId ?? null,
    recordingKey: input.recordingKey,
    transcriptionSourceKey: input.transcriptionSourceKey,
    errorMessage: input.errorMessage,
    errorStack: input.errorStack ?? null,
    observedAt: input.observedAt,
  };
}

export async function ingestMeetingTranscriptProcessingFailure(
  db: D1Database,
  input: MeetingTranscriptProcessingFailureInput,
): Promise<void> {
  if (!await hasAssessmentSchema(db)) return;

  const store = new AssessmentLayerStore(db, () => input.observedAt);
  const session = await store.createAssessmentSession({
    ingestionKey: `assessment-session:meeting-transcript:${input.meetingId}`,
    interviewId: input.scheduledInterviewId ?? input.meetingId,
    mode: 'STANDARD_VIDEO_INTERVIEW',
    candidateId: input.guestContactId ?? null,
    workspaceId: input.ownerId,
    createdBy: 'meeting-transcript-processing',
    metadata: {
      meetingId: input.meetingId,
      scheduledInterviewId: input.scheduledInterviewId ?? null,
      recordingKey: input.recordingKey,
      transcriptionSourceKey: input.transcriptionSourceKey,
      source: 'meeting_transcript_processing',
    },
  });

  const exactText = stableJson(failureSnapshot(input) as JsonValue);
  const contentHash = await sha256Hex(exactText);
  await store.recordAssessmentEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:meeting-transcript:${input.meetingId}:processing-failed:${contentHash}`,
    kind: 'system_diagnostic',
    actorType: 'system',
    narrative: `Meeting transcript processing failed: ${input.errorMessage}`,
    payload: {
      diagnosticCode: 'MEETING_TRANSCRIPT_PROCESSING_FAILED',
      meetingId: input.meetingId,
      scheduledInterviewId: input.scheduledInterviewId ?? null,
      recordingKey: input.recordingKey,
      transcriptionSourceKey: input.transcriptionSourceKey,
      errorMessage: input.errorMessage,
    },
    occurredAt: input.observedAt,
    sourceRefs: [{
      sourceRefType: 'meeting_transcript_processing',
      sourceRefId: `${input.meetingId}:processing-failed:${contentHash.slice(0, 16)}`,
      evidenceRole: 'processing_failure',
      locator: {
        meetingId: input.meetingId,
        scheduledInterviewId: input.scheduledInterviewId ?? null,
        recordingKey: input.recordingKey,
        transcriptionSourceKey: input.transcriptionSourceKey,
      },
      exactText,
      contentHash,
      metadata: {
        sourceKind: 'meeting_transcript_processing.failure',
        diagnosticCode: 'MEETING_TRANSCRIPT_PROCESSING_FAILED',
      },
    }],
  });

  await transitionToDiagnostic({
    db,
    store,
    sessionId: session.id,
    reason: 'Meeting transcript processing failed before source spans could be captured.',
  });
}
