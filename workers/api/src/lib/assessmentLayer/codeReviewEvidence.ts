import { AssessmentLayerStore, type AssessmentSessionState } from './persistence';
import type { ScoreAndPropagateTranscript } from '../review/scoreAndPropagate';
import { stableJson } from '../livingContext/persistence';
import type { JsonObject, JsonValue } from '../livingContext/types';

export interface CodeReviewAssessmentEvidenceInput {
  sessionId: string;
  candidateId: string;
  challengeId: string;
  assessmentId: string;
  transcript: ScoreAndPropagateTranscript;
  scoreReportJson: string;
  observedAt: string;
  producer: 'automated_scorer' | 'recruiter_override';
  producerId?: string | null;
  startedAt?: string | null;
}

interface ScoreReportSummary {
  summary: string;
  score: number | null;
  band: string | null;
  output: JsonValue;
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

async function transitionIfCurrentState(input: {
  db: D1Database;
  store: AssessmentLayerStore;
  sessionId: string;
  fromStates: readonly AssessmentSessionState[];
  toState: AssessmentSessionState;
  reason: string;
}): Promise<void> {
  const current = await currentAssessmentState(input.db, input.sessionId);
  if (current === input.toState || current === null) return;
  if (!input.fromStates.includes(current)) return;
  await input.store.transitionAssessmentState({
    sessionId: input.sessionId,
    toState: input.toState,
    reason: input.reason,
    actorType: 'system',
  });
}

function parseScoreReport(scoreReportJson: string): ScoreReportSummary {
  let parsed: JsonValue = {};
  try {
    parsed = JSON.parse(scoreReportJson) as JsonValue;
  } catch {
    parsed = { raw: scoreReportJson };
  }
  const object = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as JsonObject
    : {};
  const overall = object.overall && typeof object.overall === 'object' && !Array.isArray(object.overall)
    ? object.overall as JsonObject
    : {};
  const score = typeof overall.score === 'number' && Number.isFinite(overall.score)
    ? overall.score
    : null;
  const band = typeof overall.band === 'string' ? overall.band : null;
  const narrative = typeof overall.narrative === 'string' && overall.narrative.trim()
    ? overall.narrative.trim()
    : 'Automated CODE_REVIEW scoring report captured.';

  return {
    summary: narrative,
    score,
    band,
    output: parsed,
  };
}

function scorePolarity(score: number | null): 'positive' | 'negative' | 'neutral' {
  if (score === null) return 'neutral';
  if (score >= 70) return 'positive';
  if (score <= 40) return 'negative';
  return 'neutral';
}

export async function ingestCodeReviewAssessmentEvidence(
  db: D1Database,
  input: CodeReviewAssessmentEvidenceInput,
): Promise<void> {
  if (!await tableExists(db, 'assessment_sessions')) return;

  const store = new AssessmentLayerStore(db, () => input.observedAt);
  const transcriptJson = JSON.stringify(input.transcript);
  const transcriptHash = await sha256Hex(transcriptJson);
  const scoreReportHash = await sha256Hex(input.scoreReportJson);
  const reportSummary = parseScoreReport(input.scoreReportJson);

  const session = await store.createAssessmentSession({
    ingestionKey: `assessment-session:code-review:${input.sessionId}`,
    interviewId: input.assessmentId,
    mode: 'CODE_REVIEW',
    candidateId: input.candidateId,
    metadata: {
      reviewSessionId: input.sessionId,
      challengeId: input.challengeId,
      assessmentId: input.assessmentId,
      producer: input.producer,
      producerId: input.producerId ?? null,
      startedAt: input.startedAt ?? null,
    },
  });

  await transitionIfCurrentState({
    db,
    store,
    sessionId: session.id,
    fromStates: ['INTAKE'],
    toState: 'IN_PROGRESS',
    reason: 'CODE_REVIEW session entered scoring ingestion.',
  });

  await store.recordAssessmentEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:code-review:${input.sessionId}:final-submission`,
    kind: 'final_submission',
    actorType: 'candidate',
    actorId: input.candidateId,
    narrative: 'Candidate submitted the final CODE_REVIEW verdict, summary, comments, and pushback transcript.',
    payload: {
      reviewSessionId: input.sessionId,
      challengeId: input.challengeId,
      assessmentId: input.assessmentId,
    },
    occurredAt: input.observedAt,
    sourceRefs: [{
      sourceRefType: 'code_review_transcript',
      sourceRefId: input.sessionId,
      evidenceRole: 'candidate_submission',
      locator: {
        reviewSessionId: input.sessionId,
        challengeId: input.challengeId,
        assessmentId: input.assessmentId,
      },
      exactText: transcriptJson,
      contentHash: transcriptHash,
      metadata: {
        sourceKind: 'review_sessions.transcript',
      },
    }],
  });

  await transitionIfCurrentState({
    db,
    store,
    sessionId: session.id,
    fromStates: ['IN_PROGRESS'],
    toState: 'FINAL_SUBMITTED',
    reason: 'CODE_REVIEW final transcript was captured as exact-source assessment evidence.',
  });

  await store.recordAssessmentEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:code-review:${input.sessionId}:score-report:${input.producer}`,
    kind: 'automated_score_report',
    actorType: 'ai_agent',
    actorId: input.producerId ?? input.producer,
    narrative: 'Automated scorer produced a CODE_REVIEW evaluation report from the submitted transcript and selected PR evidence.',
    payload: {
      reviewSessionId: input.sessionId,
      challengeId: input.challengeId,
      assessmentId: input.assessmentId,
      producer: input.producer,
      score: reportSummary.score,
      band: reportSummary.band,
    },
    occurredAt: input.observedAt,
    sourceRefs: [{
      sourceRefType: 'code_review_score_report',
      sourceRefId: input.sessionId,
      evidenceRole: 'automated_evaluation',
      locator: {
        reviewSessionId: input.sessionId,
        challengeId: input.challengeId,
        assessmentId: input.assessmentId,
        producer: input.producer,
      },
      exactText: input.scoreReportJson,
      contentHash: scoreReportHash,
      metadata: {
        sourceKind: 'review_sessions.score_report',
      },
    }],
  });

  await transitionIfCurrentState({
    db,
    store,
    sessionId: session.id,
    fromStates: ['FINAL_SUBMITTED'],
    toState: 'EVALUATION_PENDING',
    reason: 'CODE_REVIEW score report was captured and is ready for final assessment projection.',
  });

  await store.createEvaluationReport({
    sessionId: session.id,
    ingestionKey: `assessment-evaluation:code-review:${input.sessionId}:${input.producer}`,
    status: 'EVALUATED',
    summary: reportSummary.summary,
    output: reportSummary.output,
    claims: [{
      id: `assessment-claim:code-review:${input.sessionId}:overall`,
      polarity: scorePolarity(reportSummary.score),
      dimension: 'code_review_overall',
      narrative: reportSummary.score === null
        ? reportSummary.summary
        : `Automated scorer assigned ${Math.round(reportSummary.score)}/100${reportSummary.band ? ` (${reportSummary.band})` : ''}: ${reportSummary.summary}`,
      sourceRefs: [
        {
          sourceRefType: 'code_review_transcript',
          sourceRefId: input.sessionId,
          evidenceRole: 'candidate_submission',
          locator: {
            reviewSessionId: input.sessionId,
            challengeId: input.challengeId,
          },
          exactText: transcriptJson,
          contentHash: transcriptHash,
        },
        {
          sourceRefType: 'code_review_score_report',
          sourceRefId: input.sessionId,
          evidenceRole: 'automated_evaluation',
          locator: {
            reviewSessionId: input.sessionId,
            challengeId: input.challengeId,
            producer: input.producer,
          },
          exactText: input.scoreReportJson,
          contentHash: scoreReportHash,
        },
      ],
    }],
    diagnostics: [],
  });

  await transitionIfCurrentState({
    db,
    store,
    sessionId: session.id,
    fromStates: ['EVALUATION_PENDING'],
    toState: 'EVALUATED',
    reason: 'CODE_REVIEW evaluation report was projected into the assessment evidence spine.',
  });
}
