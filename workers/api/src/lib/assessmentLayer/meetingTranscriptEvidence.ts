import {
  AssessmentLayerStore,
  type AssessmentActorType,
  type AssessmentEvidenceSourceRefInput,
  type AssessmentSessionMode,
  type AssessmentSessionState,
} from './persistence';
import { ensureCandidateLivingContext } from '../livingContext/compatibility';
import {
  LivingContextStore,
} from '../livingContext/persistence';
import {
  OPEN_TERM_RESOLVER_VERSION,
  openSemanticTerm,
} from '../livingContext/openTerms';
import type {
  ContextRecordConceptInput,
  ContextRecordEntityInput,
  ContextRecordSourceInput,
  JsonObject,
} from '../livingContext/types';

export interface MeetingTranscriptAssessmentSegment {
  stableSegmentId: string;
  text: string;
  sourceSpanId: string;
  charStart: number;
  charEnd: number;
  lineStart: number;
  lineEnd: number;
  speakerLabel?: string | null;
  speakerRole?: string | null;
  contactId?: string | null;
  channel?: number | null;
  timestampStartMs?: number | null;
  timestampEndMs?: number | null;
  confidence?: number | null;
  metadata?: JsonObject;
}

export interface MeetingTranscriptAssessmentEvidenceInput {
  meetingId: string;
  ownerId: string;
  scheduledInterviewId?: string | null;
  artifactId: string;
  artifactVersionId: string;
  versionNumber: number;
  provider?: string | null;
  recordingKey?: string | null;
  transcriptionAudioKey?: string | null;
  speakerMetadata?: JsonObject | null;
  speakerMetadataOrigin?: string | null;
  personContextMode?: 'attributed' | 'summary_only' | null;
  personContextReason?: string | null;
  assessmentMode?: AssessmentSessionMode;
  observedAt: string;
  segments: readonly MeetingTranscriptAssessmentSegment[];
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
  ).bind(tableName).first<{ name: string }>();
  return Boolean(row);
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

async function markAssessmentSessionInProgress(input: {
  db: D1Database;
  store: AssessmentLayerStore;
  sessionId: string;
}): Promise<void> {
  const state = await currentAssessmentState(input.db, input.sessionId);
  if (state !== 'INTAKE' && state !== 'DIAGNOSTIC') return;
  await input.store.transitionAssessmentState({
    sessionId: input.sessionId,
    toState: 'IN_PROGRESS',
    reason: state === 'DIAGNOSTIC'
      ? 'Meeting transcript retry captured source spans after a prior diagnostic failure.'
      : 'Meeting transcript source spans were captured as assessment evidence.',
    actorType: 'system',
  });
}

function candidateIdFromSegments(
  segments: readonly MeetingTranscriptAssessmentSegment[],
): string | null {
  const attributedCandidate = segments.find((segment) =>
    typeof segment.contactId === 'string'
    && segment.contactId.trim().length > 0
    && (segment.speakerRole === 'guest' || segment.speakerRole === 'candidate')
  );
  const attributedParticipant = attributedCandidate
    ?? segments.find((segment) => typeof segment.contactId === 'string' && segment.contactId.trim().length > 0);
  return attributedParticipant?.contactId?.trim() ?? null;
}

function actorForSegment(segment: MeetingTranscriptAssessmentSegment): {
  actorType: AssessmentActorType;
  actorId: string | null;
} {
  const contactId = segment.contactId?.trim() || null;
  if (segment.speakerRole === 'guest' || segment.speakerRole === 'candidate') {
    return { actorType: 'candidate', actorId: contactId };
  }
  if (segment.speakerRole === 'host' || segment.speakerRole === 'recruiter') {
    return { actorType: 'recruiter', actorId: contactId ?? 'host' };
  }
  return contactId
    ? { actorType: 'candidate', actorId: contactId }
    : { actorType: 'system', actorId: null };
}

function segmentNarrative(segment: MeetingTranscriptAssessmentSegment): string {
  const role = segment.speakerRole?.trim() || segment.speakerLabel?.trim() || 'unknown speaker';
  return `Meeting transcript segment spoken by ${role}.`;
}

const GENERIC_EVIDENCE_PLAN_BLOCKED_REASON =
  'Evidence-plan follow-up transcript did not include concrete candidate-owned PR, bug, code review, trade-off, or verification evidence.';

const CONCRETE_WORK_EVIDENCE_PATTERNS = [
  /\bpr\b/i,
  /\bpull request\b/i,
  /\bbug\b/i,
  /\bcode review\b/i,
  /\breview(?:ed|ing)?\b/i,
  /\bdiff\b/i,
  /\btest(?:ed|s|ing)?\b/i,
  /\bregression\b/i,
  /\bdebug(?:ged|ging)?\b/i,
  /\bfix(?:ed|ing)?\b/i,
  /\bimplement(?:ed|ing)?\b/i,
  /\bship(?:ped|ping)?\b/i,
  /\bdeploy(?:ed|ing)?\b/i,
  /\bverif(?:y|ied|ication)\b/i,
  /\btrade-?off\b/i,
  /\bconstraint\b/i,
  /\bincident\b/i,
  /\bproduction\b/i,
  /\brace condition\b/i,
  /\bidempotenc(?:y|e)\b/i,
  /\bmigration\b/i,
];

const EVIDENCE_PLAN_TERM_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'ask',
  'asked',
  'before',
  'for',
  'from',
  'had',
  'have',
  'i',
  'in',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'the',
  'this',
  'to',
  'we',
  'with',
]);

function countConcreteWorkEvidenceSignals(text: string): number {
  return CONCRETE_WORK_EVIDENCE_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
}

function isConcreteEvidencePlanAnswer(segment: MeetingTranscriptAssessmentSegment): boolean {
  const text = segment.text.replace(/\s+/g, ' ').trim();
  if (text.length < 64) return false;
  if (!/\b(i|i'm|i’ve|ive|my|me|personally|we|our)\b/i.test(text)) return false;
  return countConcreteWorkEvidenceSignals(text) >= 3;
}

function evidencePlanOpenTerms(text: string, limit = 24): Array<{ surface: string; canonicalKey: string }> {
  const terms = new Map<string, { surface: string; canonicalKey: string }>();
  for (const token of text.match(/[A-Za-z][A-Za-z0-9+#.]*/g) ?? []) {
    const normalized = token.trim().toLowerCase();
    if (
      normalized.length < 3
      || EVIDENCE_PLAN_TERM_STOPWORDS.has(normalized)
      || /^\d+$/.test(normalized)
    ) {
      continue;
    }
    const term = openSemanticTerm(token);
    if (!term || terms.has(term.canonicalKey)) continue;
    terms.set(term.canonicalKey, {
      surface: term.surface,
      canonicalKey: term.canonicalKey,
    });
    if (terms.size >= limit) break;
  }
  return [...terms.values()];
}

async function transcriptSegmentSourceRef(input: {
  meetingId: string;
  scheduledInterviewId?: string | null;
  artifactId: string;
  artifactVersionId: string;
  provider?: string | null;
  recordingKey?: string | null;
  transcriptionAudioKey?: string | null;
  speakerMetadataOrigin?: string | null;
  evidenceRole: string;
  segment: MeetingTranscriptAssessmentSegment;
}): Promise<AssessmentEvidenceSourceRefInput> {
  const segment = input.segment;
  return {
    sourceRefType: 'source_span',
    sourceRefId: segment.sourceSpanId,
    sourceSpanId: segment.sourceSpanId,
    evidenceRole: input.evidenceRole,
    locator: {
      meetingId: input.meetingId,
      scheduledInterviewId: input.scheduledInterviewId ?? null,
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      stableSegmentId: segment.stableSegmentId,
      charStart: segment.charStart,
      charEnd: segment.charEnd,
      lineStart: segment.lineStart,
      lineEnd: segment.lineEnd,
      timestampStartMs: segment.timestampStartMs ?? null,
      timestampEndMs: segment.timestampEndMs ?? null,
      speakerRole: segment.speakerRole ?? null,
      speakerLabel: segment.speakerLabel ?? null,
      channel: segment.channel ?? null,
      recordingKey: input.recordingKey ?? null,
      transcriptionAudioKey: input.transcriptionAudioKey ?? null,
    },
    exactText: segment.text,
    contentHash: await sha256Hex(segment.text),
    metadata: {
      sourceKind: 'meeting_transcript.source_span',
      provider: input.provider ?? null,
      confidence: segment.confidence ?? null,
      contactId: segment.contactId ?? null,
      speakerMetadataOrigin: input.speakerMetadataOrigin ?? null,
      segmentMetadata: segment.metadata ?? {},
    },
  };
}

interface EvidencePlanSessionRow {
  id: string;
  state: AssessmentSessionState;
  candidate_id: string | null;
  workspace_id: string | null;
  interview_id: string | null;
  metadata_json: string;
}

function parseSessionMetadata(raw: string): JsonObject {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

async function loadEvidencePlanSessionForInterview(
  db: D1Database,
  scheduledInterviewId: string | null | undefined,
): Promise<EvidencePlanSessionRow | null> {
  if (!scheduledInterviewId) return null;
  return await db.prepare(
    `SELECT id, state, candidate_id, workspace_id, interview_id, metadata_json
       FROM assessment_sessions
      WHERE interview_id = ?1
        AND created_by = 'code-review-evidence-plan'
      ORDER BY created_at DESC
      LIMIT 1`,
  ).bind(scheduledInterviewId).first<EvidencePlanSessionRow>();
}

async function loadEvidencePlanInteractionId(input: {
  db: D1Database;
  workspacePersonId: string;
  meetingId: string;
}): Promise<string | null> {
  const row = await input.db.prepare(
    `SELECT id
       FROM interactions
      WHERE workspace_person_id = ?1
        AND external_reference = ?2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
  ).bind(input.workspacePersonId, input.meetingId).first<{ id: string }>();
  return row?.id ?? null;
}

async function materializeEvidencePlanResponseContext(input: {
  db: D1Database;
  planSession: EvidencePlanSessionRow;
  meetingId: string;
  sourceRef: AssessmentEvidenceSourceRefInput;
  segment: MeetingTranscriptAssessmentSegment;
  metadata: JsonObject;
  observedAt: string;
}): Promise<void> {
  const candidateId = input.planSession.candidate_id?.trim();
  if (!candidateId) return;
  const identity = await ensureCandidateLivingContext(input.db, candidateId);
  if (!identity) return;

  const store = new LivingContextStore(input.db, () => input.observedAt);
  const interactionId = await loadEvidencePlanInteractionId({
    db: input.db,
    workspacePersonId: identity.workspacePersonId,
    meetingId: input.meetingId,
  });
  const terms = evidencePlanOpenTerms(input.segment.text);
  if (terms.length === 0) return;

  const concepts: ContextRecordConceptInput[] = [];
  for (const term of terms) {
    const concept = await store.upsertConcept({
      ingestionKey: `open-term:${term.canonicalKey}`,
      canonicalKey: term.canonicalKey,
      namespace: 'term',
      label: term.surface,
      metadata: {
        resolver: OPEN_TERM_RESOLVER_VERSION,
        source: 'code_review_evidence_plan',
      },
    });
    concepts.push({
      conceptId: concept.id,
      relationship: 'about',
      weight: 1,
    });
  }

  const source: ContextRecordSourceInput = {
    sourceSpanId: input.sourceRef.sourceSpanId ?? input.sourceRef.sourceRefId,
    sourceRefType: 'source_span',
    sourceRefId: input.sourceRef.sourceRefId,
    evidenceRole: input.sourceRef.evidenceRole ?? 'evidence_plan_response_span',
    locator: input.sourceRef.locator,
    exactText: input.sourceRef.exactText ?? input.segment.text,
    contentHash: input.sourceRef.contentHash,
    metadata: input.sourceRef.metadata,
  };
  const originalInterviewId = typeof input.metadata.originalInterviewId === 'string'
    ? input.metadata.originalInterviewId
    : null;
  const contextCallInterviewId = typeof input.metadata.contextCallInterviewId === 'string'
    ? input.metadata.contextCallInterviewId
    : input.planSession.interview_id ?? null;
  const matchRunId = typeof input.metadata.matchRunId === 'string'
    ? input.metadata.matchRunId
    : null;
  const entities: ContextRecordEntityInput[] = [
    {
      entityType: 'workspace_person',
      entityId: identity.workspacePersonId,
      relationship: 'subject',
    },
    {
      entityType: 'assessment_session',
      entityId: input.planSession.id,
      relationship: 'source_assessment',
    },
    {
      entityType: 'meeting',
      entityId: input.meetingId,
      relationship: 'source_interaction',
    },
  ];
  if (contextCallInterviewId) {
    entities.push({
      entityType: 'scheduled_interview',
      entityId: contextCallInterviewId,
      relationship: 'context_call',
    });
  }
  if (originalInterviewId) {
    entities.push({
      entityType: 'scheduled_interview',
      entityId: originalInterviewId,
      relationship: 'original_code_review',
    });
  }
  if (matchRunId) {
    entities.push({
      entityType: 'match_run',
      entityId: matchRunId,
      relationship: 'evidence_gap_source',
    });
  }

  await store.upsertContextRecord({
    ingestionKey: `assessment-session:${input.planSession.id}:evidence-plan-response:${input.segment.sourceSpanId}`,
    workspacePersonId: identity.workspacePersonId,
    interactionId,
    applicationId: identity.applicationId,
    recordType: 'code_review_evidence_plan_response',
    predicate: 'provides concrete candidate work evidence for repo matching',
    narrative: input.segment.text,
    qualifiers: {
      evidencePlanSessionId: input.planSession.id,
      originalInterviewId,
      contextCallInterviewId,
      meetingId: input.meetingId,
      matchRunId,
      matchStatus: typeof input.metadata.matchStatus === 'string'
        ? input.metadata.matchStatus
        : null,
      concreteEvidenceSignalCount: countConcreteWorkEvidenceSignals(input.segment.text),
      extractedProperties: JSON.stringify({
        semantic_terms: terms.map((term) => ({
          surface: term.surface,
          canonical_key: term.canonicalKey,
        })),
      }),
    },
    confidence: input.segment.confidence ?? 0.85,
    extractionVersion: 'code-review-evidence-plan-response-v1',
    observedAt: input.observedAt,
    sources: [source],
    entities,
    concepts,
  });

  await store.enqueueProjection({
    ingestionKey: `assessment-session:${input.planSession.id}:evidence-plan-response:${input.segment.sourceSpanId}:neo4j`,
    projectionType: 'neo4j',
    aggregateType: 'workspace_person',
    aggregateId: identity.workspacePersonId,
    payload: {
      contextRecordType: 'code_review_evidence_plan_response',
      assessmentSessionId: input.planSession.id,
      sourceSpanId: input.segment.sourceSpanId,
      originalInterviewId,
      contextCallInterviewId,
      matchRunId,
    },
  });
}

async function transitionIfState(
  db: D1Database,
  store: AssessmentLayerStore,
  input: {
    sessionId: string;
    allowedStates: readonly AssessmentSessionState[];
    toState: AssessmentSessionState;
    reason: string;
  },
): Promise<void> {
  const state = await currentAssessmentState(db, input.sessionId);
  if (!state || !input.allowedStates.includes(state)) return;
  await store.transitionAssessmentState({
    sessionId: input.sessionId,
    toState: input.toState,
    reason: input.reason,
    actorType: 'system',
  });
}

async function captureEvidencePlanTranscriptEvidence(
  db: D1Database,
  input: MeetingTranscriptAssessmentEvidenceInput,
): Promise<void> {
  const planSession = await loadEvidencePlanSessionForInterview(db, input.scheduledInterviewId);
  if (!planSession) return;
  const store = new AssessmentLayerStore(db, () => input.observedAt);

  if (input.personContextMode !== 'attributed') {
    await transitionIfState(db, store, {
      sessionId: planSession.id,
      allowedStates: ['INTAKE', 'IN_PROGRESS'],
      toState: 'BLOCKED',
      reason: 'Evidence-plan follow-up transcript was summary-only and cannot be attributed to the candidate.',
    });
    return;
  }

  const metadata = parseSessionMetadata(planSession.metadata_json);
  const sourceRefs: AssessmentEvidenceSourceRefInput[] = [];
  const capturedResponses: Array<{
    segment: MeetingTranscriptAssessmentSegment;
    sourceRef: AssessmentEvidenceSourceRefInput;
  }> = [];
  const responseSegments = input.segments.filter((segment) =>
    actorForSegment(segment).actorType === 'candidate'
  );

  for (const segment of responseSegments) {
    const sourceRef = await transcriptSegmentSourceRef({
      meetingId: input.meetingId,
      scheduledInterviewId: input.scheduledInterviewId ?? null,
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      provider: input.provider ?? null,
      recordingKey: input.recordingKey ?? null,
      transcriptionAudioKey: input.transcriptionAudioKey ?? null,
      speakerMetadataOrigin: input.speakerMetadataOrigin ?? null,
      evidenceRole: 'evidence_plan_response_span',
      segment,
    });
    sourceRefs.push(sourceRef);
    capturedResponses.push({ segment, sourceRef });
    const { actorType, actorId } = actorForSegment(segment);
    await store.recordAssessmentEvent({
      sessionId: planSession.id,
      ingestionKey: `assessment-event:code-review-evidence-plan:${planSession.id}:${input.meetingId}:${input.artifactVersionId}:${segment.stableSegmentId}`,
      kind: 'evidence_plan_response_span',
      actorType,
      actorId,
      narrative: `Evidence-plan response transcript segment spoken by ${segment.speakerRole ?? segment.speakerLabel ?? 'participant'}.`,
      payload: {
        meetingId: input.meetingId,
        scheduledInterviewId: input.scheduledInterviewId ?? null,
        artifactId: input.artifactId,
        artifactVersionId: input.artifactVersionId,
        stableSegmentId: segment.stableSegmentId,
        originalInterviewId: typeof metadata.originalInterviewId === 'string' ? metadata.originalInterviewId : null,
        contextCallInterviewId: typeof metadata.contextCallInterviewId === 'string' ? metadata.contextCallInterviewId : input.scheduledInterviewId ?? null,
        matchRunId: typeof metadata.matchRunId === 'string' ? metadata.matchRunId : null,
        matchStatus: typeof metadata.matchStatus === 'string' ? metadata.matchStatus : null,
      },
      occurredAt: input.observedAt,
      sourceRefs: [sourceRef],
    });
  }

  if (sourceRefs.length === 0) return;

  const concreteSourceRefs = capturedResponses
    .filter(({ segment }) => isConcreteEvidencePlanAnswer(segment))
    .map(({ sourceRef }) => sourceRef);

  if (concreteSourceRefs.length === 0) {
    await transitionIfState(db, store, {
      sessionId: planSession.id,
      allowedStates: ['INTAKE', 'IN_PROGRESS', 'BLOCKED'],
      toState: 'BLOCKED',
      reason: GENERIC_EVIDENCE_PLAN_BLOCKED_REASON,
    });
    return;
  }

  for (const { segment, sourceRef } of capturedResponses) {
    if (!isConcreteEvidencePlanAnswer(segment)) continue;
    await materializeEvidencePlanResponseContext({
      db,
      planSession,
      meetingId: input.meetingId,
      sourceRef,
      segment,
      metadata,
      observedAt: input.observedAt,
    });
  }

  await transitionIfState(db, store, {
    sessionId: planSession.id,
    allowedStates: ['INTAKE', 'IN_PROGRESS', 'BLOCKED'],
    toState: 'FINAL_SUBMITTED',
    reason: 'Evidence-plan follow-up transcript source spans were captured.',
  });

  const summary = `Evidence call captured ${concreteSourceRefs.length} concrete source-backed transcript span${concreteSourceRefs.length === 1 ? '' : 's'} for repo-match refresh.`;
  await store.createEvaluationReport({
    sessionId: planSession.id,
    ingestionKey: `assessment-report:code-review-evidence-plan:${planSession.id}:${input.meetingId}:${input.artifactVersionId}:ready-for-match-refresh`,
    status: 'NEEDS_HUMAN_REVIEW',
    summary,
    output: {
      schemaVersion: 'code-review-evidence-plan-result-v1',
      status: 'READY_FOR_REPO_MATCH_REFRESH',
      meetingId: input.meetingId,
      scheduledInterviewId: input.scheduledInterviewId ?? null,
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      sourceSpanCount: concreteSourceRefs.length,
      capturedSpanCount: sourceRefs.length,
      evidenceQualityGate: 'concrete_candidate_work_evidence_v1',
      originalInterviewId: typeof metadata.originalInterviewId === 'string' ? metadata.originalInterviewId : null,
      contextCallInterviewId: typeof metadata.contextCallInterviewId === 'string' ? metadata.contextCallInterviewId : input.scheduledInterviewId ?? null,
      matchRunId: typeof metadata.matchRunId === 'string' ? metadata.matchRunId : null,
      matchStatus: typeof metadata.matchStatus === 'string' ? metadata.matchStatus : null,
    },
    claims: [{
      id: `assessment_claim_${planSession.id}_repo_match_refresh_ready`,
      polarity: 'neutral',
      dimension: 'repo_match_refresh_readiness',
      narrative: summary,
      confidence: 1,
      sourceRefs: concreteSourceRefs,
    }],
    diagnostics: [],
  });

  await transitionIfState(db, store, {
    sessionId: planSession.id,
    allowedStates: ['FINAL_SUBMITTED', 'EVALUATING', 'EVALUATION_PENDING'],
    toState: 'EVALUATED',
    reason: 'Evidence-plan transcript evidence is ready for repo-match refresh.',
  });
}

export async function ingestMeetingTranscriptAssessmentEvidence(
  db: D1Database,
  input: MeetingTranscriptAssessmentEvidenceInput,
): Promise<void> {
  if (input.segments.length === 0) return;
  if (!await tableExists(db, 'assessment_sessions')) return;

  const store = new AssessmentLayerStore(db, () => input.observedAt);
  const candidateId = candidateIdFromSegments(input.segments);
  const session = await store.createAssessmentSession({
    ingestionKey: `assessment-session:meeting-transcript:${input.meetingId}`,
    interviewId: input.scheduledInterviewId ?? input.meetingId,
    mode: input.assessmentMode ?? 'STANDARD_VIDEO_INTERVIEW',
    candidateId,
    workspaceId: input.ownerId,
    createdBy: 'meeting-transcript-ingestion',
    metadata: {
      meetingId: input.meetingId,
      scheduledInterviewId: input.scheduledInterviewId ?? null,
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      versionNumber: input.versionNumber,
      provider: input.provider ?? null,
      recordingKey: input.recordingKey ?? null,
      transcriptionAudioKey: input.transcriptionAudioKey ?? null,
      speakerMetadata: input.speakerMetadata ?? null,
      speakerMetadataOrigin: input.speakerMetadataOrigin ?? null,
      personContextMode: input.personContextMode ?? null,
      personContextReason: input.personContextReason ?? null,
      source: 'meeting_transcript_living_context',
    },
  });

  for (const segment of input.segments) {
    const { actorType, actorId } = actorForSegment(segment);
    const sourceRef = await transcriptSegmentSourceRef({
      meetingId: input.meetingId,
      scheduledInterviewId: input.scheduledInterviewId ?? null,
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      provider: input.provider ?? null,
      recordingKey: input.recordingKey ?? null,
      transcriptionAudioKey: input.transcriptionAudioKey ?? null,
      speakerMetadataOrigin: input.speakerMetadataOrigin ?? null,
      evidenceRole: 'transcript_segment',
      segment,
    });
    await store.recordAssessmentEvent({
      sessionId: session.id,
      ingestionKey: `assessment-event:meeting-transcript:${input.meetingId}:${input.artifactVersionId}:${segment.stableSegmentId}`,
      kind: 'transcript_span',
      actorType,
      actorId,
      narrative: segmentNarrative(segment),
      payload: {
        meetingId: input.meetingId,
        scheduledInterviewId: input.scheduledInterviewId ?? null,
        artifactId: input.artifactId,
        artifactVersionId: input.artifactVersionId,
        stableSegmentId: segment.stableSegmentId,
        speakerRole: segment.speakerRole ?? null,
        speakerLabel: segment.speakerLabel ?? null,
        contactId: segment.contactId ?? null,
        channel: segment.channel ?? null,
        timestampStartMs: segment.timestampStartMs ?? null,
        timestampEndMs: segment.timestampEndMs ?? null,
      },
      occurredAt: input.observedAt,
      sourceRefs: [sourceRef],
    });
  }

  await markAssessmentSessionInProgress({ db, store, sessionId: session.id });
  await captureEvidencePlanTranscriptEvidence(db, input);
}
