import {
  CloudflareAIProvider,
  DEFAULT_CLOUDFLARE_MODEL,
} from './llm/cloudflareAIProvider';
import type { LLMProvider } from './llm/types';
import {
  RepoTaskInterviewSessionStore,
  type AssessmentDiagnosticInput,
  type AssessmentEvaluationClaimInputCompat,
  type EvaluationReportStatus,
  type PersistedAssessmentDiagnostic,
  type PersistedEvaluationReport,
  type RepoTaskInterviewMode,
} from './repoTaskInterviewSession';
import { deterministicEntityId } from './livingContext';
import type { AssessmentEvidenceSourceRefInput } from './assessmentLayer/persistence';
import type { JsonObject, JsonValue } from './livingContext/types';

interface SessionSourceRef extends AssessmentEvidenceSourceRefInput {
  readonly eventId: string;
  readonly eventKind: string;
  readonly eventSequence: number;
  readonly key: string;
}

interface AiAssessmentClaim {
  id?: unknown;
  polarity?: unknown;
  dimension?: unknown;
  narrative?: unknown;
  confidence?: unknown;
  sourceRefKeys?: unknown;
}

interface AiAssessmentDiagnostic {
  code?: unknown;
  severity?: unknown;
  message?: unknown;
  sourceRefKeys?: unknown;
}

interface AiAssessmentOutput {
  summary?: unknown;
  recommendation?: unknown;
  claims?: unknown;
  diagnostics?: unknown;
}

export interface RepoTaskAssessmentEvaluationResult {
  kind: 'evaluated' | 'diagnostic';
  report?: PersistedEvaluationReport;
  diagnostic?: PersistedAssessmentDiagnostic;
}

export interface EvaluateRepoTaskAssessmentInput {
  db: D1Database;
  store: RepoTaskInterviewSessionStore;
  env: {
    AI?: Ai;
    CLOUDFLARE_AI_MODEL?: string;
  };
  sessionId: string;
  scheduledInterviewId: string;
  requestedBy: string;
  requestedAt: string;
  requestEventId: string;
  requestSourceRef: AssessmentEvidenceSourceRefInput;
}

const REQUIRED_EVALUATION_REF_TYPES = new Set([
  'code_diff',
  'git_commit',
]);

const CHALLENGE_REF_TYPES = new Set([
  'review_challenge_packet',
  'repo_challenge_packet',
  'repo_task_challenge_packet',
  'open_source_challenge_packet',
  'challenge_packet',
]);

const ALLOWED_CLAIM_POLARITIES = new Set(['positive', 'negative', 'diagnostic']);
const ALLOWED_DIAGNOSTIC_SEVERITIES = new Set(['info', 'warning', 'blocking']);
type EvaluatorDiagnosticSeverity = 'info' | 'warning' | 'blocking';
const MAX_SOURCE_REF_EXACT_TEXT_CHARS = 1800;
const MAX_AI_PROMPT_SOURCE_REFS = 30;

function parseJsonObject(value: string | null): JsonObject {
  if (!value) return {};
  const parsed = JSON.parse(value) as JsonValue;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return {};
  return parsed;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringValue(item))
    .filter((item): item is string => Boolean(item));
}

function compactExactText(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= MAX_SOURCE_REF_EXACT_TEXT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_SOURCE_REF_EXACT_TEXT_CHARS - 15).trimEnd()} [truncated]`;
}

function sourceRefKey(row: {
  source_ref_type: string;
  source_ref_id: string;
  evidence_role: string | null;
  source_span_id: string | null;
}): string {
  return [
    row.source_ref_type,
    row.source_ref_id,
    row.evidence_role ?? 'support',
    row.source_span_id ?? '',
  ].join(':');
}

function summarizeSourceRef(ref: SessionSourceRef): JsonObject {
  return {
    key: ref.key,
    eventKind: ref.eventKind,
    eventSequence: ref.eventSequence,
    sourceRefType: ref.sourceRefType,
    sourceRefId: ref.sourceRefId,
    evidenceRole: ref.evidenceRole ?? 'support',
    exactText: compactExactText(ref.exactText ?? ''),
  };
}

function hasRequiredEvidence(sourceRefs: readonly SessionSourceRef[]): boolean {
  const hasChallenge = sourceRefs.some((ref) =>
    CHALLENGE_REF_TYPES.has(ref.sourceRefType) || ref.evidenceRole === 'assigned_challenge');
  const presentTypes = new Set(sourceRefs.map((ref) => ref.sourceRefType));
  return hasChallenge && [...REQUIRED_EVALUATION_REF_TYPES].every((type) => presentTypes.has(type));
}

function diagnosticInput(input: {
  code: string;
  message: string;
  severity?: 'info' | 'warning' | 'blocking';
  retryable?: boolean;
  provider?: string;
  sourceRefs?: readonly AssessmentEvidenceSourceRefInput[];
  details?: JsonObject;
}): AssessmentDiagnosticInput {
  return {
    code: input.code,
    severity: input.severity ?? 'blocking',
    message: input.message,
    provider: input.provider ?? 'repo_task_assessment_evaluator',
    retryable: input.retryable ?? false,
    details: input.details,
    sourceRefs: input.sourceRefs,
  };
}

async function loadSessionSourceRefs(
  db: D1Database,
  sessionId: string,
): Promise<SessionSourceRef[]> {
  const result = await db.prepare(
    `SELECT e.id AS event_id,
            e.kind AS event_kind,
            e.sequence AS event_sequence,
            sr.source_ref_type,
            sr.source_ref_id,
            sr.source_span_id,
            sr.evidence_role,
            sr.locator_json,
            sr.exact_text,
            sr.content_hash,
            sr.metadata_json
       FROM assessment_event_source_refs sr
       JOIN assessment_evidence_events e ON e.id = sr.event_id
      WHERE e.session_id = ?1
        AND sr.exact_text IS NOT NULL
        AND sr.content_hash IS NOT NULL
      ORDER BY e.sequence ASC, sr.created_at ASC`,
  ).bind(sessionId).all<{
    event_id: string;
    event_kind: string;
    event_sequence: number;
    source_ref_type: string;
    source_ref_id: string;
    source_span_id: string | null;
    evidence_role: string | null;
    locator_json: string | null;
    exact_text: string;
    content_hash: string;
    metadata_json: string | null;
  }>();

  return (result.results ?? []).map((row) => ({
    eventId: row.event_id,
    eventKind: row.event_kind,
    eventSequence: row.event_sequence,
    key: sourceRefKey(row),
    sourceRefType: row.source_ref_type,
    sourceRefId: row.source_ref_id,
    sourceSpanId: row.source_span_id,
    evidenceRole: row.evidence_role ?? 'support',
    locator: parseJsonObject(row.locator_json),
    exactText: row.exact_text,
    contentHash: row.content_hash,
    metadata: parseJsonObject(row.metadata_json),
  }));
}

function buildSystemPrompt(): string {
  return [
    'You are PIPE-OS source-backed evaluator for real open-source coding assessments.',
    'Assess only the evidence provided in SOURCE_REFS. Do not invent repo behavior, tests, seniority, intent, or correctness.',
    'Every positive or negative claim must cite one or more exact sourceRefKeys from SOURCE_REFS.',
    'If evidence is missing, uncertain, ungrounded, or insufficient, return diagnostics instead of positive claims.',
    'Return only JSON with keys: summary, recommendation, claims, diagnostics.',
    'Allowed claim polarities: positive, negative, diagnostic.',
    'Useful dimensions include source_comprehension, implementation_correctness, debugging_reasoning, test_strategy, security_and_reliability, ai_output_verification, communication.',
  ].join('\n');
}

function buildUserPrompt(input: {
  sessionMode: RepoTaskInterviewMode;
  scheduledInterviewId: string;
  sourceRefs: readonly SessionSourceRef[];
}): string {
  const sourceRefs = input.sourceRefs.slice(0, MAX_AI_PROMPT_SOURCE_REFS).map(summarizeSourceRef);
  return JSON.stringify({
    task: 'Evaluate the submitted open-source repo-task commit from exact source evidence.',
    scheduledInterviewId: input.scheduledInterviewId,
    sessionMode: input.sessionMode,
    sourceRefs,
    outputContract: {
      summary: 'short source-grounded assessment summary',
      recommendation: 'strong_evidence_to_advance | mixed_evidence_human_review | insufficient_evidence | not_demonstrated',
      claims: [{
        id: 'stable-short-id',
        polarity: 'positive | negative | diagnostic',
        dimension: 'assessment dimension',
        narrative: 'claim grounded only in cited source refs',
        confidence: 0.0,
        sourceRefKeys: ['one-or-more keys from SOURCE_REFS'],
      }],
      diagnostics: [{
        code: 'MISSING_TEST_EVIDENCE | PROVENANCE_INCOMPLETE | EVALUATION_NEEDS_HUMAN_REVIEW',
        severity: 'info | warning | blocking',
        message: 'what cannot be concluded and why',
        sourceRefKeys: ['optional keys from SOURCE_REFS'],
      }],
    },
  });
}

function parseAiJson(content: string | null): AiAssessmentOutput {
  if (!content) throw new Error('assessment evaluator returned empty content');
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as AiAssessmentOutput;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) return JSON.parse(fenced) as AiAssessmentOutput;
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1)) as AiAssessmentOutput;
    }
    throw new Error('assessment evaluator did not return parseable JSON');
  }
}

function normalizeAiClaims(
  rawClaims: unknown,
  sourceRefByKey: ReadonlyMap<string, SessionSourceRef>,
  sessionId: string,
): AssessmentEvaluationClaimInputCompat[] {
  if (!Array.isArray(rawClaims)) return [];

  const claims: AssessmentEvaluationClaimInputCompat[] = [];
  rawClaims.forEach((rawClaim, index) => {
    if (rawClaim === null || typeof rawClaim !== 'object' || Array.isArray(rawClaim)) return;
    const claim = rawClaim as AiAssessmentClaim;
    const polarity = stringValue(claim.polarity) ?? 'diagnostic';
    if (!ALLOWED_CLAIM_POLARITIES.has(polarity)) return;
    const narrative = stringValue(claim.narrative);
    const dimension = stringValue(claim.dimension);
    if (!narrative || !dimension) return;
    const citedRefs = stringArrayValue(claim.sourceRefKeys)
      .map((key) => sourceRefByKey.get(key))
      .filter((ref): ref is SessionSourceRef => Boolean(ref));
    if (polarity !== 'diagnostic' && citedRefs.length === 0) return;
    const confidence = numberValue(claim.confidence);
    const rawId = stringValue(claim.id) ?? `${dimension}-${index + 1}`;
    claims.push({
      id: `repo_task_eval_${sessionId}_${rawId}`.replace(/[^A-Za-z0-9:_-]/g, '_'),
      polarity: polarity as AssessmentEvaluationClaimInputCompat['polarity'],
      dimension,
      narrative,
      confidence,
      sourceRefs: citedRefs,
    });
  });

  return claims.slice(0, 12);
}

function normalizeAiDiagnostics(
  rawDiagnostics: unknown,
  sourceRefByKey: ReadonlyMap<string, SessionSourceRef>,
): AssessmentDiagnosticInput[] {
  if (!Array.isArray(rawDiagnostics)) return [];

  return rawDiagnostics.flatMap((rawDiagnostic): AssessmentDiagnosticInput[] => {
    if (rawDiagnostic === null || typeof rawDiagnostic !== 'object' || Array.isArray(rawDiagnostic)) return [];
    const diagnostic = rawDiagnostic as AiAssessmentDiagnostic;
    const code = stringValue(diagnostic.code);
    const message = stringValue(diagnostic.message);
    if (!code || !message) return [];
    const rawSeverity = stringValue(diagnostic.severity) ?? 'warning';
    const severity: EvaluatorDiagnosticSeverity = ALLOWED_DIAGNOSTIC_SEVERITIES.has(rawSeverity)
      ? rawSeverity as EvaluatorDiagnosticSeverity
      : 'warning';
    const sourceRefs = stringArrayValue(diagnostic.sourceRefKeys)
      .map((key) => sourceRefByKey.get(key))
      .filter((ref): ref is SessionSourceRef => Boolean(ref));
    return [diagnosticInput({
      code,
      severity,
      message,
      retryable: false,
      sourceRefs,
    })];
  }).slice(0, 8);
}

async function recordAiInteraction(input: {
  store: RepoTaskInterviewSessionStore;
  sessionId: string;
  requestedAt: string;
  requestedBy: string;
  provider: LLMProvider;
  prompt: string;
  response: string;
}): Promise<void> {
  const exactText = [
    `Provider: ${input.provider.name}`,
    `Model: ${input.provider.model}`,
    `Requested by: ${input.requestedBy}`,
    'Prompt:',
    input.prompt,
    'Response:',
    input.response,
  ].join('\n');
  const contentHash = await deterministicEntityId('content', exactText);
  await input.store.recordEvent({
    sessionId: input.sessionId,
    ingestionKey: `assessment-event:${input.sessionId}:ai-evaluation:${contentHash}`,
    kind: 'ai_interaction',
    actorType: 'system',
    actorId: 'repo-task-assessment-evaluator',
    narrative: 'AI evaluator reviewed the submitted repo-task evidence.',
    payload: {
      provider: input.provider.name,
      model: input.provider.model,
      action: 'repo_task_assessment_evaluation',
    },
    occurredAt: input.requestedAt,
    sourceRefs: [{
      sourceRefType: 'ai_usage_event',
      sourceRefId: `repo-task-evaluation:${input.sessionId}:${contentHash}`,
      evidenceRole: 'ai_evaluation_trace',
      locator: {
        provider: input.provider.name,
        model: input.provider.model,
      },
      exactText,
      contentHash,
    }],
  });
}

async function createDiagnostic(input: {
  store: RepoTaskInterviewSessionStore;
  sessionId: string;
  diagnostic: AssessmentDiagnosticInput;
}): Promise<RepoTaskAssessmentEvaluationResult> {
  const diagnostic = await input.store.recordDiagnostic(input.diagnostic, {
    sessionId: input.sessionId,
    reportId: null,
  });
  return { kind: 'diagnostic', diagnostic };
}

export async function evaluateRepoTaskAssessmentSession(
  input: EvaluateRepoTaskAssessmentInput,
): Promise<RepoTaskAssessmentEvaluationResult> {
  const session = await input.store.loadSession(input.sessionId);
  const sourceRefs = await loadSessionSourceRefs(input.db, input.sessionId);
  const sourceRefByKey = new Map(sourceRefs.map((ref) => [ref.key, ref]));

  if (!hasRequiredEvidence(sourceRefs)) {
    return createDiagnostic({
      store: input.store,
      sessionId: input.sessionId,
      diagnostic: diagnosticInput({
        code: 'PROVENANCE_INCOMPLETE',
        message: 'Assessment evaluation requires an assigned challenge packet plus exact git_commit and code_diff evidence before scoring.',
        sourceRefs: [input.requestSourceRef],
        details: {
          scheduledInterviewId: input.scheduledInterviewId,
          sourceRefCount: sourceRefs.length,
        },
      }),
    });
  }

  if (!input.env.AI) {
    return createDiagnostic({
      store: input.store,
      sessionId: input.sessionId,
      diagnostic: diagnosticInput({
        code: 'AI_DEVELOPER_UNAVAILABLE',
        message: 'Workers AI is not configured for source-backed repo-task evaluation.',
        provider: 'cloudflare-ai',
        retryable: true,
        sourceRefs: [input.requestSourceRef],
        details: {
          scheduledInterviewId: input.scheduledInterviewId,
          requestEventId: input.requestEventId,
        },
      }),
    });
  }

  const provider = new CloudflareAIProvider(
    input.env.AI,
    input.env.CLOUDFLARE_AI_MODEL ?? DEFAULT_CLOUDFLARE_MODEL,
  );
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    scheduledInterviewId: input.scheduledInterviewId,
    sessionMode: session.mode,
    sourceRefs,
  });
  const promptTrace = [
    'System prompt:',
    systemPrompt,
    'User prompt:',
    userPrompt,
  ].join('\n');

  let aiOutput: AiAssessmentOutput;
  let rawResponse = '';
  try {
    const completion = await provider.complete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { forceJson: true, maxTokens: 2048 });
    rawResponse = completion.content ?? '';
    await recordAiInteraction({
      store: input.store,
      sessionId: input.sessionId,
      requestedAt: input.requestedAt,
      requestedBy: input.requestedBy,
      provider,
      prompt: promptTrace,
      response: rawResponse,
    });
    aiOutput = parseAiJson(rawResponse);
  } catch (error) {
    return createDiagnostic({
      store: input.store,
      sessionId: input.sessionId,
      diagnostic: diagnosticInput({
        code: 'AI_DEVELOPER_UNAVAILABLE',
        message: `Source-backed repo-task evaluator failed: ${error instanceof Error ? error.message : String(error)}`,
        provider: provider.name,
        retryable: true,
        sourceRefs: [input.requestSourceRef],
        details: {
          scheduledInterviewId: input.scheduledInterviewId,
          model: provider.model,
        },
      }),
    });
  }

  const claims = normalizeAiClaims(aiOutput.claims, sourceRefByKey, input.sessionId);
  const diagnostics = normalizeAiDiagnostics(aiOutput.diagnostics, sourceRefByKey);
  const groundedClaims = claims.filter((claim) => claim.polarity !== 'diagnostic');
  if (groundedClaims.length === 0) {
    return createDiagnostic({
      store: input.store,
      sessionId: input.sessionId,
      diagnostic: diagnosticInput({
        code: 'EVALUATION_NEEDS_HUMAN_REVIEW',
        message: 'The AI evaluator did not produce any non-diagnostic claims backed by exact session evidence. Human review is required.',
        sourceRefs: [input.requestSourceRef],
        details: {
          scheduledInterviewId: input.scheduledInterviewId,
          model: provider.model,
          rawClaimCount: Array.isArray(aiOutput.claims) ? aiOutput.claims.length : 0,
        },
      }),
    });
  }

  const summary = stringValue(aiOutput.summary)
    ?? 'AI evaluator produced source-backed repo-task assessment claims.';
  const recommendation = stringValue(aiOutput.recommendation) ?? 'mixed_evidence_human_review';
  const status: EvaluationReportStatus = 'EVALUATED';
  const report = await input.store.createEvaluationReport({
    sessionId: input.sessionId,
    ingestionKey: `assessment-report:${input.sessionId}:ai-evaluation:${await deterministicEntityId('content', rawResponse || summary)}`,
    status,
    summary,
    output: {
      schemaVersion: 'repo-task-assessment-output-v1',
      status,
      mode: session.mode,
      recommendation,
      provider: provider.name,
      model: provider.model,
      scheduledInterviewId: input.scheduledInterviewId,
      requestEventId: input.requestEventId,
      claimIds: claims.map((claim) => claim.id),
      diagnosticCodes: diagnostics.map((diagnostic) => diagnostic.code),
    },
    claims,
    diagnostics,
  });

  await input.store.transitionState({
    sessionId: input.sessionId,
    toState: 'EVALUATED',
    reason: 'AI evaluator produced source-backed assessment claims.',
    createdBy: 'repo-task-assessment-evaluator',
  });

  return { kind: 'evaluated', report };
}
