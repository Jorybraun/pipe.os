import {
  deterministicEntityId,
  stableJson,
} from '../livingContext/persistence';
import type { JsonObject, JsonValue } from '../livingContext/types';

type Clock = () => string;

export type AssessmentSessionMode =
  | 'CODE_REVIEW'
  | 'DEV_CONTAINER_CHALLENGE'
  | 'DEV_CONTAINER_REPO_TASK'
  | 'OPEN_SOURCE_BUG_FIX'
  | 'NINETY_FIVE_UNTIL_INFINITY_ROOM'
  | 'STANDARD_VIDEO_INTERVIEW'
  | 'CLIPPY_DEVIN_INTERACTION'
  | 'VIDEO'
  | 'TECHNICAL'
  | 'SCREENING';

export type AssessmentSessionState =
  | 'INTAKE'
  | 'IN_PROGRESS'
  | 'FINAL_SUBMITTED'
  | 'EVALUATING'
  | 'EVALUATION_PENDING'
  | 'EVALUATED'
  | 'DIAGNOSTIC'
  | 'BLOCKED'
  | 'CANCELLED';

export type AssessmentActorType =
  | 'candidate'
  | 'recruiter'
  | 'ai_agent'
  | 'ai_developer'
  | 'clippy'
  | 'devin'
  | 'dev_container'
  | 'system';

export type AssessmentEvaluationStatus =
  | 'EVALUATED'
  | 'NEEDS_MORE_EVIDENCE'
  | 'NO_ROLE_SAFE_CHALLENGE'
  | 'PROVENANCE_INCOMPLETE'
  | 'AI_DEVELOPER_UNAVAILABLE'
  | 'NEEDS_HUMAN_REVIEW'
  | 'BLOCKED';

export type AssessmentEvaluationClaimPolarity =
  | 'positive'
  | 'negative'
  | 'neutral'
  | 'diagnostic';

export type AssessmentDiagnosticSeverity =
  | 'info'
  | 'warning'
  | 'error'
  | 'blocking';

export interface AssessmentEvidenceSourceRefInput {
  sourceRefType: string;
  sourceRefId: string;
  sourceSpanId?: string | null;
  evidenceRole?: string;
  locator?: JsonObject;
  exactText?: string | null;
  contentHash?: string | null;
  metadata?: JsonObject;
}

export interface AssessmentSessionInput {
  ingestionKey: string;
  interviewId?: string | null;
  mode: AssessmentSessionMode;
  candidateId?: string | null;
  workspaceId?: string | null;
  createdBy?: string | null;
  metadata?: JsonObject;
}

export interface AssessmentSession {
  id: string;
  ingestionKey: string;
  interviewId: string | null;
  mode: AssessmentSessionMode;
  state: AssessmentSessionState;
  candidateId: string | null;
  workspaceId: string | null;
  createdBy: string | null;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface AssessmentStateTransitionInput {
  sessionId: string;
  toState: AssessmentSessionState;
  reason: string;
  actorType?: AssessmentActorType | null;
  actorId?: string | null;
}

export interface AssessmentStateTransition {
  id: string;
  sessionId: string;
  sequence: number;
  fromState: AssessmentSessionState;
  toState: AssessmentSessionState;
  reason: string;
  actorType: AssessmentActorType | null;
  actorId: string | null;
  createdAt: string;
}

export interface AssessmentEvidenceEventInput {
  sessionId: string;
  ingestionKey: string;
  kind: string;
  actorType: AssessmentActorType;
  actorId?: string | null;
  narrative: string;
  payload?: JsonObject;
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[];
  occurredAt?: string;
}

export interface AssessmentEvidenceEvent {
  id: string;
  ingestionKey: string;
  sessionId: string;
  sequence: number;
  kind: string;
  actorType: AssessmentActorType;
  actorId: string | null;
  narrative: string;
  payload: JsonObject;
  contextRecordId: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface AssessmentEvaluationDiagnosticInput {
  id?: string;
  code: string;
  severity: AssessmentDiagnosticSeverity;
  message: string;
  provider?: string | null;
  retryable?: boolean;
  details?: JsonObject;
  sourceRefs?: readonly AssessmentEvidenceSourceRefInput[];
  metadata?: JsonObject;
}

export interface AssessmentEvaluationClaimInput {
  id: string;
  polarity: AssessmentEvaluationClaimPolarity;
  dimension: string;
  narrative: string;
  confidence?: number | null;
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[];
}

export interface AssessmentEvaluationReportInput {
  sessionId: string;
  ingestionKey: string;
  status: AssessmentEvaluationStatus;
  summary: string;
  output?: JsonValue;
  claims: readonly AssessmentEvaluationClaimInput[];
  diagnostics: readonly AssessmentEvaluationDiagnosticInput[];
}

export interface AssessmentEvaluationReport {
  id: string;
  ingestionKey: string;
  sessionId: string;
  status: AssessmentEvaluationStatus;
  summary: string;
  output: JsonObject;
  contextRecordId: string | null;
  diagnostics: readonly AssessmentEvaluationDiagnosticInput[];
  createdAt: string;
  updatedAt: string;
}

interface AssessmentSessionRow {
  id: string;
  ingestion_key: string;
  interview_id: string | null;
  mode: string;
  state: string;
  candidate_id: string | null;
  workspace_id: string | null;
  created_by: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface AssessmentEventRow {
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
  created_at: string;
}

interface AssessmentReportRow {
  id: string;
  ingestion_key: string;
  session_id: string;
  status: string;
  summary: string;
  output_json?: string | null;
  context_record_id: string | null;
  diagnostics_json?: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionStateRow {
  state: string;
}

interface MaxSequenceRow {
  max_sequence: number | null;
}

interface DiagnosticMetadata {
  provider: string | null;
  retryable: number;
  details: JsonObject;
}

const DEFAULT_JSON_OBJECT: JsonObject = {};

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  return trimmed;
}

function optionalNonEmpty(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireNonEmpty(value, field);
}

function parseJsonObject(value: string): JsonObject {
  const parsed = JSON.parse(value) as JsonValue;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as JsonObject;
}

function sourceRefKey(sourceRef: AssessmentEvidenceSourceRefInput): string {
  return [
    sourceRef.sourceRefType,
    sourceRef.sourceRefId,
    sourceRef.evidenceRole ?? 'support',
    sourceRef.sourceSpanId ?? '',
    sourceRef.contentHash ?? '',
    sourceRef.exactText ?? '',
  ].join('\u0000');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function uniqueSourceRefs(
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[],
): AssessmentEvidenceSourceRefInput[] {
  const seen = new Set<string>();
  const unique: AssessmentEvidenceSourceRefInput[] = [];
  for (const sourceRef of sourceRefs) {
    const key = sourceRefKey(sourceRef);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sourceRef);
  }
  return unique;
}

function assertSourceRef(sourceRef: AssessmentEvidenceSourceRefInput): void {
  requireNonEmpty(sourceRef.sourceRefType, 'sourceRefType');
  requireNonEmpty(sourceRef.sourceRefId, 'sourceRefId');
  if (sourceRef.evidenceRole !== undefined) {
    requireNonEmpty(sourceRef.evidenceRole, 'evidenceRole');
  }
}

function assertExactSourceRef(sourceRef: AssessmentEvidenceSourceRefInput, claimId: string): void {
  assertSourceRef(sourceRef);
  requireNonEmpty(sourceRef.exactText ?? '', `positive evaluation claim ${claimId} exactText`);
  requireNonEmpty(sourceRef.contentHash ?? '', `positive evaluation claim ${claimId} contentHash`);
}

function assertExactEventSourceRef(sourceRef: AssessmentEvidenceSourceRefInput, owner: string): void {
  assertSourceRef(sourceRef);
  requireNonEmpty(sourceRef.exactText ?? '', `${owner} exactText`);
  requireNonEmpty(sourceRef.contentHash ?? '', `${owner} contentHash`);
}

function diagnosticMetadata(input: AssessmentEvaluationDiagnosticInput): DiagnosticMetadata {
  const metadata = input.metadata ?? DEFAULT_JSON_OBJECT;
  const provider = input.provider ?? (typeof metadata.provider === 'string' ? metadata.provider : null);
  const retryable = (input.retryable ?? metadata.retryable === true) ? 1 : 0;
  return {
    provider,
    retryable,
    details: input.details ?? metadata,
  };
}

function mapSession(row: AssessmentSessionRow): AssessmentSession {
  return {
    id: row.id,
    ingestionKey: row.ingestion_key,
    interviewId: row.interview_id,
    mode: row.mode as AssessmentSessionMode,
    state: row.state as AssessmentSessionState,
    candidateId: row.candidate_id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: AssessmentEventRow): AssessmentEvidenceEvent {
  return {
    id: row.id,
    ingestionKey: row.ingestion_key,
    sessionId: row.session_id,
    sequence: row.sequence,
    kind: row.kind,
    actorType: row.actor_type as AssessmentActorType,
    actorId: row.actor_id,
    narrative: row.narrative,
    payload: parseJsonObject(row.payload_json),
    contextRecordId: row.context_record_id,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function mapReport(row: AssessmentReportRow): AssessmentEvaluationReport {
  const parsedDiagnostics = JSON.parse(row.diagnostics_json ?? '[]') as AssessmentEvaluationDiagnosticInput[];
  return {
    id: row.id,
    ingestionKey: row.ingestion_key,
    sessionId: row.session_id,
    status: row.status as AssessmentEvaluationStatus,
    summary: row.summary,
    output: parseJsonObject(row.output_json ?? '{}'),
    contextRecordId: row.context_record_id,
    diagnostics: parsedDiagnostics,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchSession(db: D1Database, sessionId: string): Promise<AssessmentSession> {
  const row = await db.prepare(
    `SELECT id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
            created_by, metadata_json, created_at, updated_at
       FROM assessment_sessions
      WHERE id = ?1`,
  ).bind(sessionId).first<AssessmentSessionRow>();
  if (!row) throw new Error(`assessment session ${sessionId} not found`);
  return mapSession(row);
}

async function nextEventSequence(db: D1Database, sessionId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COALESCE(MAX(sequence), 0) AS max_sequence
       FROM assessment_evidence_events
      WHERE session_id = ?1`,
  ).bind(sessionId).first<MaxSequenceRow>();
  return (row?.max_sequence ?? 0) + 1;
}

async function requireClaimSourceBackedBySessionEvent(input: {
  db: D1Database;
  sessionId: string;
  claimId: string;
  sourceRef: AssessmentEvidenceSourceRefInput;
}): Promise<void> {
  const evidenceRole = input.sourceRef.evidenceRole ?? 'support';
  const sourceSpanId = input.sourceRef.sourceSpanId ?? '';
  const row = await input.db.prepare(
    `SELECT r.event_id
       FROM assessment_event_source_refs r
       JOIN assessment_evidence_events e ON e.id = r.event_id
      WHERE e.session_id = ?1
        AND r.source_ref_type = ?2
        AND r.source_ref_id = ?3
        AND r.evidence_role = ?4
        AND COALESCE(r.source_span_id, '') = ?5
        AND r.exact_text = ?6
        AND r.content_hash = ?7
      LIMIT 1`,
  ).bind(
    input.sessionId,
    input.sourceRef.sourceRefType,
    input.sourceRef.sourceRefId,
    evidenceRole,
    sourceSpanId,
    input.sourceRef.exactText,
    input.sourceRef.contentHash,
  ).first<{ event_id: string }>();
  if (!row) {
    throw new Error(
      `positive evaluation claim ${input.claimId} source ref ${input.sourceRef.sourceRefType}:${input.sourceRef.sourceRefId} is not backed by assessment session evidence`,
    );
  }
}

export class AssessmentLayerStore {
  readonly #db: D1Database;
  readonly #clock: Clock;

  constructor(db: D1Database, clock: Clock = () => new Date().toISOString()) {
    this.#db = db;
    this.#clock = clock;
  }

  async createAssessmentSession(input: AssessmentSessionInput): Promise<AssessmentSession> {
    const ingestionKey = requireNonEmpty(input.ingestionKey, 'ingestionKey');
    const mode = requireNonEmpty(input.mode, 'mode') as AssessmentSessionMode;
    const now = this.#clock();
    const id = await deterministicEntityId('assessment_session', ingestionKey);
    const metadata = input.metadata ?? DEFAULT_JSON_OBJECT;

    await this.#db.prepare(
      `INSERT INTO assessment_sessions (
         id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
         created_by, metadata_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, 'INTAKE', ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT(ingestion_key) DO NOTHING`,
    ).bind(
      id,
      ingestionKey,
      optionalNonEmpty(input.interviewId, 'interviewId'),
      mode,
      optionalNonEmpty(input.candidateId, 'candidateId'),
      optionalNonEmpty(input.workspaceId, 'workspaceId'),
      optionalNonEmpty(input.createdBy, 'createdBy'),
      stableJson(metadata),
      now,
    ).run();

    return fetchSession(this.#db, id);
  }

  async transitionAssessmentState(
    input: AssessmentStateTransitionInput,
  ): Promise<AssessmentStateTransition> {
    const sessionId = requireNonEmpty(input.sessionId, 'sessionId');
    const reason = requireNonEmpty(input.reason, 'reason');
    const toState = requireNonEmpty(input.toState, 'toState') as AssessmentSessionState;
    const now = this.#clock();
    const row = await this.#db.prepare(
      'SELECT state FROM assessment_sessions WHERE id = ?1',
    ).bind(sessionId).first<SessionStateRow>();
    if (!row) throw new Error(`assessment session ${sessionId} not found`);

    const maxSequence = await this.#db.prepare(
      `SELECT MAX(sequence) AS max_sequence
         FROM assessment_state_transitions
        WHERE session_id = ?1`,
    ).bind(sessionId).first<MaxSequenceRow>();
    const sequence = (maxSequence?.max_sequence ?? 0) + 1;
    const id = `assessment_state_transition_${sessionId}_${String(sequence).padStart(6, '0')}`;

    await this.#db.prepare(
      `INSERT INTO assessment_state_transitions (
         id, session_id, sequence, from_state, to_state, reason,
         actor_type, actor_id, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      id,
      sessionId,
      sequence,
      row.state,
      toState,
      reason,
      input.actorType ?? null,
      optionalNonEmpty(input.actorId, 'actorId'),
      now,
    ).run();

    await this.#db.prepare(
      `UPDATE assessment_sessions
          SET state = ?1, updated_at = ?2
        WHERE id = ?3`,
    ).bind(toState, now, sessionId).run();

    return {
      id,
      sessionId,
      sequence,
      fromState: row.state as AssessmentSessionState,
      toState,
      reason,
      actorType: input.actorType ?? null,
      actorId: input.actorId ?? null,
      createdAt: now,
    };
  }

  async recordAssessmentEvent(input: AssessmentEvidenceEventInput): Promise<AssessmentEvidenceEvent> {
    const session = await fetchSession(this.#db, requireNonEmpty(input.sessionId, 'sessionId'));
    const ingestionKey = requireNonEmpty(input.ingestionKey, 'ingestionKey');
    const kind = requireNonEmpty(input.kind, 'kind');
    const narrative = requireNonEmpty(input.narrative, 'narrative');
    if (input.sourceRefs.length === 0) {
      throw new Error(`assessment event ${ingestionKey} requires at least one source ref`);
    }
    for (const sourceRef of input.sourceRefs) {
      assertExactEventSourceRef(sourceRef, `assessment event ${ingestionKey}`);
    }

    const now = this.#clock();
    const occurredAt = input.occurredAt ?? now;
    const eventId = await deterministicEntityId('assessment_event', ingestionKey);
    const existingEvent = await this.#db.prepare(
      `SELECT id, ingestion_key, session_id, sequence, kind, actor_type, actor_id, narrative,
              payload_json, context_record_id, occurred_at, created_at
         FROM assessment_evidence_events
        WHERE id = ?1`,
    ).bind(eventId).first<AssessmentEventRow>();
    if (existingEvent) return mapEvent(existingEvent);

    const contextRecordId = await this.#upsertContextRecord({
      ingestionKey: `assessment-context:event:${ingestionKey}`,
      scopeType: 'assessment_session',
      scopeId: session.id,
      recordType: `assessment_${kind}`,
      predicate: 'records assessment evidence event',
      narrative,
      qualifiers: {
        eventId,
        kind,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        mode: session.mode,
      },
      sourceRefs: input.sourceRefs,
      observedAt: occurredAt,
      now,
    });
    const sequence = await nextEventSequence(this.#db, session.id);

    await this.#db.prepare(
      `INSERT INTO assessment_evidence_events (
         id, ingestion_key, session_id, sequence, kind, actor_type, actor_id, narrative,
         payload_json, context_record_id, occurred_at, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT(ingestion_key) DO NOTHING`,
    ).bind(
      eventId,
      ingestionKey,
      session.id,
      sequence,
      kind,
      input.actorType,
      optionalNonEmpty(input.actorId, 'actorId'),
      narrative,
      stableJson(input.payload ?? DEFAULT_JSON_OBJECT),
      contextRecordId,
      occurredAt,
      now,
    ).run();

    for (const sourceRef of uniqueSourceRefs(input.sourceRefs)) {
      const sourceRefId = await deterministicEntityId(
        'assessment_event_source_ref',
        `${eventId}:${sourceRefKey(sourceRef)}`,
      );
      await this.#db.prepare(
        `INSERT INTO assessment_event_source_refs (
           id, event_id, source_ref_type, source_ref_id, source_span_id,
           evidence_role, locator_json, exact_text, content_hash, metadata_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(event_id, source_ref_type, source_ref_id, evidence_role) DO NOTHING`,
      ).bind(
        sourceRefId,
        eventId,
        sourceRef.sourceRefType,
        sourceRef.sourceRefId,
        sourceRef.sourceSpanId ?? null,
        sourceRef.evidenceRole ?? 'support',
        stableJson(sourceRef.locator ?? DEFAULT_JSON_OBJECT),
        sourceRef.exactText,
        sourceRef.contentHash,
        stableJson(sourceRef.metadata ?? DEFAULT_JSON_OBJECT),
        now,
      ).run();
    }

    const row = await this.#db.prepare(
      `SELECT id, ingestion_key, session_id, sequence, kind, actor_type, actor_id, narrative,
              payload_json, context_record_id, occurred_at, created_at
         FROM assessment_evidence_events
        WHERE id = ?1`,
    ).bind(eventId).first<AssessmentEventRow>();
    if (!row) throw new Error(`assessment event ${eventId} was not persisted`);
    return mapEvent(row);
  }

  async createEvaluationReport(
    input: AssessmentEvaluationReportInput,
  ): Promise<AssessmentEvaluationReport> {
    const session = await fetchSession(this.#db, requireNonEmpty(input.sessionId, 'sessionId'));
    const ingestionKey = requireNonEmpty(input.ingestionKey, 'ingestionKey');
    const summary = requireNonEmpty(input.summary, 'summary');
    for (const claim of input.claims) {
      requireNonEmpty(claim.id, 'claim.id');
      requireNonEmpty(claim.dimension, `claim ${claim.id} dimension`);
      requireNonEmpty(claim.narrative, `claim ${claim.id} narrative`);
      if (claim.polarity === 'positive' && claim.sourceRefs.length === 0) {
        throw new Error(`positive evaluation claim ${claim.id} requires at least one exact source ref`);
      }
      for (const sourceRef of claim.sourceRefs) {
        if (claim.polarity === 'positive') {
          assertExactSourceRef(sourceRef, claim.id);
          await requireClaimSourceBackedBySessionEvent({
            db: this.#db,
            sessionId: session.id,
            claimId: claim.id,
            sourceRef,
          });
        } else {
          assertExactEventSourceRef(sourceRef, `evaluation claim ${claim.id}`);
        }
      }
    }
    for (const diagnostic of input.diagnostics) {
      requireNonEmpty(diagnostic.code, 'diagnostic code');
      requireNonEmpty(diagnostic.severity, 'diagnostic severity');
      requireNonEmpty(diagnostic.message, 'diagnostic message');
    }

    const now = this.#clock();
    const reportId = await deterministicEntityId('assessment_evaluation_report', ingestionKey);
    const existingReport = await this.#db.prepare(
      `SELECT id, ingestion_key, session_id, status, summary, output_json, context_record_id,
              diagnostics_json, created_at, updated_at
         FROM assessment_evaluation_reports
        WHERE id = ?1`,
    ).bind(reportId).first<AssessmentReportRow>();
    if (existingReport) return mapReport(existingReport);

    const allSourceRefs = uniqueSourceRefs([
      {
        sourceRefType: 'assessment_evaluation_report',
        sourceRefId: reportId,
        evidenceRole: 'summary',
        locator: { ingestionKey, status: input.status },
        exactText: summary,
        contentHash: await sha256Hex(summary),
        metadata: { status: input.status },
      },
      ...input.claims.flatMap((claim) => claim.sourceRefs),
      ...input.diagnostics.flatMap((diagnostic) => diagnostic.sourceRefs ?? []),
    ]);
    const contextRecordId = await this.#upsertContextRecord({
      ingestionKey: `assessment-context:evaluation:${ingestionKey}`,
      scopeType: 'assessment_session',
      scopeId: session.id,
      recordType: 'assessment_evaluation_report',
      predicate: 'summarizes assessment evidence',
      narrative: summary,
      qualifiers: {
        reportId,
        status: input.status,
        mode: session.mode,
        claimCount: input.claims.length,
        diagnosticCount: input.diagnostics.length,
      },
      sourceRefs: allSourceRefs,
      observedAt: now,
      now,
    });

    await this.#db.prepare(
      `INSERT INTO assessment_evaluation_reports (
         id, ingestion_key, session_id, status, summary, context_record_id,
         output_json, diagnostics_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT(ingestion_key) DO NOTHING`,
    ).bind(
      reportId,
      ingestionKey,
      session.id,
      input.status,
      summary,
      contextRecordId,
      stableJson(input.output ?? DEFAULT_JSON_OBJECT),
      stableJson(input.diagnostics as unknown as JsonValue),
      now,
    ).run();

    for (const claim of input.claims) {
      await this.#db.prepare(
          `INSERT INTO assessment_evaluation_claims (
           id, report_id, polarity, dimension, narrative, confidence, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO NOTHING`,
      ).bind(
        claim.id,
        reportId,
        claim.polarity,
        claim.dimension,
        claim.narrative,
        claim.confidence ?? null,
        now,
      ).run();

      for (const sourceRef of uniqueSourceRefs(claim.sourceRefs)) {
        const claimSourceRefId = await deterministicEntityId(
          'assessment_claim_source_ref',
          `${claim.id}:${sourceRefKey(sourceRef)}`,
        );
        await this.#db.prepare(
          `INSERT INTO assessment_claim_source_refs (
             id, claim_id, source_ref_type, source_ref_id, source_span_id,
             evidence_role, locator_json, exact_text, content_hash, metadata_json, created_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
           ON CONFLICT(claim_id, source_ref_type, source_ref_id, evidence_role) DO NOTHING`,
        ).bind(
          claimSourceRefId,
          claim.id,
          sourceRef.sourceRefType,
          sourceRef.sourceRefId,
          sourceRef.sourceSpanId ?? null,
          sourceRef.evidenceRole ?? 'support',
          stableJson(sourceRef.locator ?? DEFAULT_JSON_OBJECT),
          sourceRef.exactText,
          sourceRef.contentHash,
          stableJson(sourceRef.metadata ?? DEFAULT_JSON_OBJECT),
          now,
        ).run();
      }
    }

    for (const diagnostic of input.diagnostics) {
      const diagnosticMeta = diagnosticMetadata(diagnostic);
      const diagnosticId = await deterministicEntityId(
        'assessment_diagnostic',
        `${reportId}:${diagnostic.code}:${diagnostic.severity}:${diagnostic.message}`,
      );
      await this.#db.prepare(
        `INSERT INTO assessment_diagnostics (
           id, session_id, report_id, event_id, code, severity, message, provider,
           retryable, details_json, metadata_json, created_at
         ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)
         ON CONFLICT(id) DO NOTHING`,
      ).bind(
        diagnosticId,
        session.id,
        reportId,
        diagnostic.code,
        diagnostic.severity,
        diagnostic.message,
        diagnosticMeta.provider,
        diagnosticMeta.retryable,
        stableJson(diagnosticMeta.details),
        now,
      ).run();

      for (const sourceRef of uniqueSourceRefs(diagnostic.sourceRefs ?? [])) {
        assertExactEventSourceRef(sourceRef, `assessment diagnostic ${diagnosticId}`);
        const diagnosticSourceRefId = await deterministicEntityId(
          'assessment_diagnostic_source_ref',
          `${diagnosticId}:${sourceRefKey(sourceRef)}`,
        );
        await this.#db.prepare(
          `INSERT INTO assessment_diagnostic_source_refs (
             id, diagnostic_id, source_ref_type, source_ref_id, source_span_id,
             evidence_role, locator_json, exact_text, content_hash, metadata_json, created_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
           ON CONFLICT(diagnostic_id, source_ref_type, source_ref_id, evidence_role) DO NOTHING`,
        ).bind(
          diagnosticSourceRefId,
          diagnosticId,
          sourceRef.sourceRefType,
          sourceRef.sourceRefId,
          sourceRef.sourceSpanId ?? null,
          sourceRef.evidenceRole ?? 'support',
          stableJson(sourceRef.locator ?? DEFAULT_JSON_OBJECT),
          sourceRef.exactText,
          sourceRef.contentHash,
          stableJson(sourceRef.metadata ?? DEFAULT_JSON_OBJECT),
          now,
        ).run();
      }
    }

    const row = await this.#db.prepare(
      `SELECT id, ingestion_key, session_id, status, summary, output_json, context_record_id,
              diagnostics_json, created_at, updated_at
         FROM assessment_evaluation_reports
        WHERE id = ?1`,
    ).bind(reportId).first<AssessmentReportRow>();
    if (!row) throw new Error(`assessment evaluation report ${reportId} was not persisted`);
    return mapReport(row);
  }

  async #upsertContextRecord(input: {
    ingestionKey: string;
    scopeType: string;
    scopeId: string;
    recordType: string;
    predicate: string;
    narrative: string;
    qualifiers: JsonObject;
    sourceRefs: readonly AssessmentEvidenceSourceRefInput[];
    observedAt: string;
    now: string;
  }): Promise<string> {
    const id = await deterministicEntityId('context_record', input.ingestionKey);
    await this.#db.prepare(
      `INSERT INTO context_records (
         id, ingestion_key, scope_type, scope_id, workspace_person_id,
         interaction_id, application_id, episode_id, assertion_id, record_type,
         predicate, narrative, qualifiers_json, confidence, polarity,
         extraction_version, observed_at, created_at, updated_at
       ) VALUES (
         ?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL, NULL, ?5,
         ?6, ?7, ?8, NULL, 1, 'assessment-layer-v1', ?9, ?10, ?10
       )
       ON CONFLICT(ingestion_key) DO UPDATE SET
         scope_type = excluded.scope_type,
         scope_id = excluded.scope_id,
         record_type = excluded.record_type,
         predicate = excluded.predicate,
         narrative = excluded.narrative,
         qualifiers_json = excluded.qualifiers_json,
         observed_at = excluded.observed_at,
         updated_at = excluded.updated_at`,
    ).bind(
      id,
      input.ingestionKey,
      input.scopeType,
      input.scopeId,
      input.recordType,
      input.predicate,
      input.narrative,
      stableJson(input.qualifiers),
      input.observedAt,
      input.now,
    ).run();

    await this.#db.prepare(
      'DELETE FROM context_record_source_refs WHERE context_record_id = ?1',
    ).bind(id).run();
    for (const sourceRef of uniqueSourceRefs(input.sourceRefs)) {
      await this.#db.prepare(
        `INSERT INTO context_record_source_refs (
           context_record_id, source_ref_type, source_ref_id, source_span_id,
           evidence_role, locator_json, exact_text, content_hash, metadata_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(
        id,
        sourceRef.sourceRefType,
        sourceRef.sourceRefId,
        sourceRef.sourceSpanId ?? null,
        sourceRef.evidenceRole ?? 'support',
        stableJson(sourceRef.locator ?? DEFAULT_JSON_OBJECT),
        sourceRef.exactText ?? null,
        sourceRef.contentHash ?? null,
        stableJson(sourceRef.metadata ?? DEFAULT_JSON_OBJECT),
        input.now,
      ).run();
    }
    return id;
  }
}
