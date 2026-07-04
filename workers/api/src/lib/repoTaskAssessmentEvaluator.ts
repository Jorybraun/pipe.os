import {
  CloudflareAIProvider,
  DEFAULT_CLOUDFLARE_MODEL,
} from './llm/cloudflareAIProvider';
import type { LLMProvider } from './llm/types';
import {
  RepoTaskInterviewSessionStore,
  type AssessmentProgressSnapshot,
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

export interface SessionSourceRef extends AssessmentEvidenceSourceRefInput {
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
    REPO_TASK_EVALUATOR_AI_TIMEOUT_MS?: string;
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
const ALLOWED_RECOMMENDATIONS = new Set([
  'strong_evidence_to_advance',
  'mixed_evidence_human_review',
  'insufficient_evidence',
  'not_demonstrated',
]);
const DEFAULT_RECOMMENDATION = 'mixed_evidence_human_review';
type EvaluatorDiagnosticSeverity = 'info' | 'warning' | 'blocking';
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_SOURCE_REF_EXACT_TEXT_CHARS = 800;
const MAX_AI_PROMPT_SOURCE_REFS = 16;
const MAX_EVALUATION_SUMMARY_CHARS = 320;
const DEFAULT_AI_EVALUATION_TIMEOUT_MS = 20_000;
const MIN_AI_EVALUATION_TIMEOUT_MS = 1_000;
const MAX_AI_EVALUATION_TIMEOUT_MS = 55_000;
const DEFAULT_STALE_EVALUATION_MS = 60_000;
const DEFAULT_STALE_EVALUATION_LIMIT = 2;

class RepoTaskAiTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`repo-task assessment AI evaluation exceeded ${timeoutMs}ms`);
    this.name = 'RepoTaskAiTimeoutError';
  }
}

const EXPECTED_HIGH_CONFIDENCE_REF_GROUPS = [
  {
    label: 'test_run',
    sourceRefTypes: ['test_run'],
    missingImpact: 'Do not make positive test_strategy, verification, or correctness claims without test_run evidence bound to the submitted commit.',
  },
  {
    label: 'verification_gap',
    sourceRefTypes: ['verification_gap'],
    missingImpact: 'Use declared verification gaps to explain missing or partial verification; never treat them as positive test_run evidence.',
  },
  {
    label: 'terminal_activity',
    sourceRefTypes: ['terminal_command', 'terminal_output', 'session_terminal_command', 'session_terminal_output'],
    missingImpact: 'Treat candidate debugging process and command-line verification as unobserved when terminal evidence is absent.',
  },
  {
    label: 'code_editor_activity',
    sourceRefTypes: ['code_editor_save', 'code_file_change', 'file_change', 'code_server_file_observation'],
    missingImpact: 'Treat edit process and intermediate code-server activity as unobserved when editor/file evidence is absent.',
  },
  {
    label: 'ai_assistance',
    sourceRefTypes: [
      'ai_user_prompt',
      'ai_user_prompt_blocked',
      'ai_agent_response',
      'ai_agent_diagnostic',
      'agent_status',
      'agent_response',
      'agent_diagnostic',
      'session_chat_agent',
      'session_chat_user',
      'ai_chat_user',
      'ai_chat_agent',
    ],
    missingImpact: 'Treat AI usage as unobserved when real agent bridge chat evidence is absent.',
  },
  {
    label: 'conversation_context',
    sourceRefTypes: ['meeting_transcript_segment', 'transcript_span', 'room_chat_message'],
    missingImpact: 'Treat reasoning, communication, and collaboration as unobserved when transcript or room chat evidence is absent.',
  },
  {
    label: 'upstream_pr_tracking',
    sourceRefTypes: ['upstream_pull_request'],
    missingImpact: 'Default assessment commits do not require upstream PRs; treat upstream usefulness as unreviewed unless candidate-approved PR tracking is captured.',
  },
] as const;
const TEST_EVIDENCE_SOURCE_REF_TYPES = ['test_run'] as const;
const VERIFICATION_GAP_SOURCE_REF_TYPES = ['verification_gap'] as const;
const AI_EVIDENCE_SOURCE_REF_TYPES = [
  'ai_user_prompt',
  'ai_user_prompt_blocked',
  'ai_agent_response',
  'ai_agent_diagnostic',
  'agent_status',
  'agent_response',
  'agent_diagnostic',
  'session_chat_agent',
  'session_chat_user',
  'ai_chat_user',
  'ai_chat_agent',
] as const;
const CONVERSATION_EVIDENCE_SOURCE_REF_TYPES = [
  'meeting_transcript_segment',
  'transcript_span',
  'room_chat_message',
] as const;
const COMMUNICATION_EVIDENCE_SOURCE_REF_TYPES = [
  ...CONVERSATION_EVIDENCE_SOURCE_REF_TYPES,
  'candidate_plan',
  'session_chat_user',
  'ai_user_prompt',
  'ai_user_prompt_blocked',
  'ai_chat_user',
] as const;
const WORKSPACE_ACTIVITY_SOURCE_REF_TYPES = [
  'terminal_command',
  'terminal_output',
  'dev_container_workspace_state',
  'code_server_file_observation',
] as const;
const PROCESS_EVIDENCE_SOURCE_REF_TYPES = [
  'terminal_command',
  'terminal_output',
  'session_terminal_command',
  'session_terminal_output',
  'code_editor_save',
  'code_file_change',
  'file_change',
  'code_server_file_observation',
  'dev_container_workspace_state',
  'meeting_transcript_segment',
  'transcript_span',
  'room_chat_message',
  'ai_user_prompt',
  'ai_user_prompt_blocked',
  'session_chat_user',
  'ai_chat_user',
] as const;
const MAX_DETERMINISTIC_FALLBACK_CLAIMS = 8;

function parseJsonObject(value: string | null): JsonObject {
  if (!value) return {};
  const parsed = JSON.parse(value) as JsonValue;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return {};
  return parsed;
}

function configuredAiEvaluationTimeoutMs(env: EvaluateRepoTaskAssessmentInput['env']): number {
  const raw = Number(env.REPO_TASK_EVALUATOR_AI_TIMEOUT_MS ?? '');
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_AI_EVALUATION_TIMEOUT_MS;
  return Math.min(
    MAX_AI_EVALUATION_TIMEOUT_MS,
    Math.max(MIN_AI_EVALUATION_TIMEOUT_MS, Math.floor(raw)),
  );
}

async function withAiTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new RepoTaskAiTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
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

function sourceRefKeysForTypes(
  sourceRefs: readonly SessionSourceRef[],
  sourceRefTypes: readonly string[],
): string[] {
  const allowedTypes = new Set(sourceRefTypes);
  return sourceRefs
    .filter((ref) => allowedTypes.has(ref.sourceRefType))
    .map((ref) => ref.key);
}

function sourceRefKeysForChallenge(sourceRefs: readonly SessionSourceRef[]): string[] {
  return sourceRefs
    .filter((ref) => CHALLENGE_REF_TYPES.has(ref.sourceRefType) || ref.evidenceRole === 'assigned_challenge')
    .map((ref) => ref.key);
}

function normalizeChallengeFocus(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
  if (normalized.length === 0) return normalized;
  return `${normalized[0]?.toUpperCase() ?? ''}${normalized.slice(1)}`;
}

function challengeFocusFromExactText(exactText: string | null | undefined): string | null {
  if (!exactText) return null;
  const taskLine = exactText.match(/^\s*Task:\s*(.+)$/im)?.[1];
  if (taskLine) {
    const normalized = normalizeChallengeFocus(taskLine);
    return normalized.length > 0 ? normalized : null;
  }

  const titleLine = exactText.match(/^\s*Title:\s*(.+)$/im)?.[1];
  if (titleLine) {
    const normalized = normalizeChallengeFocus(titleLine);
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function challengeFocusSummary(sourceRefs: readonly SessionSourceRef[]): string | null {
  const challengeRef = sourceRefs.find((ref) =>
    CHALLENGE_REF_TYPES.has(ref.sourceRefType) || ref.evidenceRole === 'assigned_challenge');
  if (!challengeRef) return null;

  const locator = challengeRef.locator ?? {};
  const metadata = challengeRef.metadata ?? {};
  const locatorTitle = stringValue(locator.challengeTitle)
    ?? stringValue(locator.title)
    ?? stringValue(locator.taskTitle);
  if (locatorTitle) return normalizeChallengeFocus(locatorTitle);

  const metadataTitle = stringValue(metadata.challengeTitle)
    ?? stringValue(metadata.title)
    ?? stringValue(metadata.taskTitle);
  if (metadataTitle) return normalizeChallengeFocus(metadataTitle);

  return challengeFocusFromExactText(challengeRef.exactText);
}

function matchedChallengeAssignmentRef(sourceRefs: readonly SessionSourceRef[]): SessionSourceRef | null {
  const challengeRef = sourceRefs.find((ref) =>
    CHALLENGE_REF_TYPES.has(ref.sourceRefType) || ref.evidenceRole === 'assigned_challenge');
  if (!challengeRef) return null;

  const locator = challengeRef.locator ?? {};
  const metadata = challengeRef.metadata ?? {};
  const source = stringValue(metadata.source);
  const matchedRepoId = locator.matchedRepoId;
  const hasMatchedRepoId = typeof matchedRepoId === 'number'
    || (typeof matchedRepoId === 'string' && matchedRepoId.trim().length > 0);
  const hasMatchProofSection = /^\s*Match proof\s*:?\s*$/im.test(challengeRef.exactText ?? '');

  if (
    challengeRef.sourceRefType === 'review_challenge_packet'
    || source === 'matched_review_challenge_packet'
    || hasMatchedRepoId
    || hasMatchProofSection
  ) {
    return challengeRef;
  }

  return null;
}

function truncateEvaluationSummary(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_EVALUATION_SUMMARY_CHARS) return normalized;
  return `${normalized.slice(0, MAX_EVALUATION_SUMMARY_CHARS - 3).trimEnd()}...`;
}

function sourceBackedEvaluationSummary(
  aiSummary: unknown,
  sourceRefs: readonly SessionSourceRef[],
): string {
  const summary = stringValue(aiSummary)
    ?? 'AI evaluator produced source-backed repo-task assessment claims.';
  const focus = challengeFocusSummary(sourceRefs);
  if (!focus) return truncateEvaluationSummary(summary);

  const normalizedSummary = summary.toLocaleLowerCase();
  if (normalizedSummary.includes(focus.toLocaleLowerCase())) {
    return truncateEvaluationSummary(summary);
  }

  return truncateEvaluationSummary(`${focus}: ${summary}`);
}

function coverageItem(input: {
  label: string;
  required: boolean;
  sourceRefTypes: readonly string[];
  sourceRefKeys: readonly string[];
  missingImpact: string;
  satisfied?: boolean;
}): JsonObject {
  return {
    label: input.label,
    required: input.required,
    sourceRefTypes: [...input.sourceRefTypes],
    satisfied: input.satisfied ?? input.sourceRefKeys.length > 0,
    sourceRefKeys: [...input.sourceRefKeys],
    missingImpact: input.missingImpact,
  };
}

function challengePacketLineValue(exactText: string, labels: readonly string[]): string | null {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = exactText.match(new RegExp(`^\\s*(?:${escapedLabels.join('|')})\\s*:\\s*(.+)$`, 'im'));
  return stringValue(match?.[1]);
}

function normalizeChallengePacketListItem(value: string): string {
  return value
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
}

function challengePacketSectionItems(exactText: string, labels: readonly string[]): string[] {
  const normalizedLabels = new Set(labels.map((label) => label.toLowerCase()));
  const lines = exactText.split(/\r?\n/);
  const items: string[] = [];
  let inSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^([A-Za-z][A-Za-z\s-]{2,})\s*:\s*$/);
    if (heading?.[1]) {
      inSection = normalizedLabels.has(heading[1].trim().toLowerCase());
      continue;
    }
    if (!inSection) continue;
    if (/^[A-Za-z][A-Za-z\s-]{2,}\s*:/.test(line) && !/^[-*]|\d+[.)]/.test(line)) {
      inSection = false;
      continue;
    }
    const item = normalizeChallengePacketListItem(line);
    if (item) items.push(item);
  }

  return items;
}

function isGitHubRepositoryUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'github.com' && segments.length === 2;
  } catch {
    return false;
  }
}

function challengePacketContractMissingFields(sourceRefs: readonly SessionSourceRef[]): string[] {
  const challengeRef = sourceRefs.find((ref) =>
    CHALLENGE_REF_TYPES.has(ref.sourceRefType) || ref.evidenceRole === 'assigned_challenge');
  if (!challengeRef) {
    return ['repo URL', 'base commit SHA', 'task', 'success criteria', 'expected evidence'];
  }

  const locator = challengeRef.locator ?? {};
  const exactText = challengeRef.exactText ?? '';
  const repositoryUrl = stringValue(locator.repositoryUrl)
    ?? stringValue(locator.githubRepoUrl)
    ?? stringValue(locator.repoUrl)
    ?? challengePacketLineValue(exactText, ['Repo', 'Repository']);
  const baseCommitSha = stringValue(locator.baseCommitSha)
    ?? stringValue(locator.baseCommit)
    ?? challengePacketLineValue(exactText, ['Base commit', 'Base commit SHA', 'Base']);
  const task = challengePacketLineValue(exactText, ['Task', 'Title']);
  const inlineSuccess = challengePacketLineValue(exactText, ['Success']);
  const successCriteria = [
    ...challengePacketSectionItems(exactText, ['Success criteria']),
    ...(inlineSuccess ? [inlineSuccess] : []),
  ];
  const expectedEvidence = challengePacketSectionItems(exactText, ['Expected evidence']);

  const missing: string[] = [];
  if (!isGitHubRepositoryUrl(repositoryUrl)) missing.push('repo URL');
  if (!baseCommitSha || !/^[0-9a-f]{40}$/i.test(baseCommitSha)) missing.push('base commit SHA');
  if (!task) missing.push('task');
  if (successCriteria.length === 0) missing.push('success criteria');
  if (expectedEvidence.length === 0) missing.push('expected evidence');
  return missing;
}

function buildEvidenceCoverage(sourceRefs: readonly SessionSourceRef[]): JsonObject {
  const sourceRefTypeCounts: JsonObject = {};
  for (const ref of sourceRefs) {
    const current = sourceRefTypeCounts[ref.sourceRefType];
    sourceRefTypeCounts[ref.sourceRefType] = typeof current === 'number' ? current + 1 : 1;
  }

  const challengeKeys = sourceRefKeysForChallenge(sourceRefs);
  const missingChallengeFields = challengePacketContractMissingFields(sourceRefs);
  const requiredForEvaluation = [
    coverageItem({
      label: 'challenge_packet',
      required: true,
      sourceRefTypes: [...CHALLENGE_REF_TYPES],
      sourceRefKeys: challengeKeys,
      satisfied: missingChallengeFields.length === 0,
      missingImpact: missingChallengeFields.length === 0
        ? 'Challenge packet contract is complete.'
        : `Cannot evaluate a real open-source assessment because the assigned challenge packet is missing ${missingChallengeFields.join(', ')}.`,
    }),
    coverageItem({
      label: 'git_commit',
      required: true,
      sourceRefTypes: ['git_commit'],
      sourceRefKeys: sourceRefKeysForTypes(sourceRefs, ['git_commit']),
      missingImpact: 'Cannot evaluate a submission without exact commit evidence.',
    }),
    coverageItem({
      label: 'code_diff',
      required: true,
      sourceRefTypes: ['code_diff'],
      sourceRefKeys: sourceRefKeysForTypes(sourceRefs, ['code_diff']),
      missingImpact: 'Cannot evaluate implementation quality without an exact diff.',
    }),
  ];

  const expectedForHighConfidence = EXPECTED_HIGH_CONFIDENCE_REF_GROUPS.map((group) =>
    coverageItem({
      label: group.label,
      required: false,
      sourceRefTypes: group.sourceRefTypes,
      sourceRefKeys: sourceRefKeysForTypes(sourceRefs, group.sourceRefTypes),
      missingImpact: group.missingImpact,
    }));

  return {
    schemaVersion: 'assessment-evidence-coverage-v1',
    sourceRefCount: sourceRefs.length,
    sourceRefTypeCounts,
    requiredForEvaluation,
    expectedForHighConfidence,
  };
}

function locatorString(
  progress: AssessmentProgressSnapshot,
  keys: readonly string[],
): string | null {
  const locator = progress.challenge?.locator;
  if (!locator) return null;
  for (const key of keys) {
    const value = stringValue(locator[key]);
    if (value) return value;
  }
  return null;
}

function sourceRefTypeCountsFromCoverage(evidenceCoverage: JsonObject): JsonObject {
  const rawCounts = evidenceCoverage.sourceRefTypeCounts;
  if (rawCounts === null || typeof rawCounts !== 'object' || Array.isArray(rawCounts)) {
    return {};
  }
  const counts: JsonObject = {};
  for (const [key, value] of Object.entries(rawCounts)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      counts[key] = value;
    }
  }
  return counts;
}

function challengeSourceRef(sourceRefs: readonly SessionSourceRef[]): SessionSourceRef | null {
  return sourceRefs.find((ref) =>
    CHALLENGE_REF_TYPES.has(ref.sourceRefType) || ref.evidenceRole === 'assigned_challenge') ?? null;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function readableList(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function expectedEvidenceSourceTypes(label: string): string[] {
  const raw = label.toLowerCase();
  const normalized = raw.replace(/[_-]+/g, ' ');
  const has = (terms: readonly string[]): boolean =>
    terms.some((term) => raw.includes(term) || normalized.includes(term.replace(/[_-]+/g, ' ')));
  const types: string[] = [];

  if (has(['git_commit', 'commit sha', 'commit hash', 'commit'])) types.push('git_commit');
  if (has(['code_diff', 'diff', 'patch'])) types.push('code_diff');
  if (has(['test_run', 'test output', 'test', 'verification', 'ci'])) types.push('test_run');
  if (has(['terminal_command', 'terminal_output', 'terminal', 'shell command', 'command output'])) {
    types.push('terminal_command', 'terminal_output');
  }
  if (has(['room_chat_message', 'chat', 'message', 'discussion'])) types.push('room_chat_message');
  if (has(['transcript_span', 'transcript', 'video'])) types.push('transcript_span');
  if (has(['code_server_file_observation', 'code_editor_save', 'file change', 'file observation', 'code-server', 'vscode'])) {
    types.push('code_server_file_observation', 'code_editor_save');
  }
  if (has(['ai_user_prompt', 'ai_agent_response', 'clippy', 'devin', 'ai', 'agent'])) {
    types.push(
      'ai_user_prompt',
      'ai_user_prompt_blocked',
      'ai_agent_response',
      'ai_agent_diagnostic',
      'agent_response',
      'agent_diagnostic',
      'agent_status',
    );
  }
  if (has(['dev_container_workspace_launch', 'dev container', 'workspace', 'container'])) {
    types.push('dev_container_workspace_launch', 'dev_container_event');
  }
  if (has(['upstream_pull_request', 'pull request', 'pr'])) types.push('upstream_pull_request');

  return uniqueStrings(types);
}

function sourceRefCountForTypes(
  sourceRefs: readonly SessionSourceRef[],
  sourceRefTypes: readonly string[],
): number {
  const allowedTypes = new Set(sourceRefTypes);
  return sourceRefs.filter((ref) => allowedTypes.has(ref.sourceRefType)).length;
}

function contractEvidenceStatusDetail(input: {
  status: 'captured' | 'gap_declared' | 'needs_human_review';
  matchedSourceRefTypes: readonly string[];
  sourceRefCount: number;
}): string {
  if (input.status === 'captured') {
    return `Captured from ${readableList(input.matchedSourceRefTypes.map((type) => type.replace(/_/g, ' ')))} source refs.`;
  }
  if (input.status === 'gap_declared') {
    return 'A verification gap was declared instead of complete test evidence, so the item remains lower-confidence.';
  }
  if (input.matchedSourceRefTypes.length === 0) {
    return 'No deterministic source-ref mapping exists for this expected evidence item; reviewer must inspect the packet.';
  }
  return `Expected ${readableList(input.matchedSourceRefTypes.map((type) => type.replace(/_/g, ' ')))} source refs, but none were captured.`;
}

function buildContractEvidenceReceipt(sourceRefs: readonly SessionSourceRef[]): JsonObject {
  const challengeRef = challengeSourceRef(sourceRefs);
  const exactText = challengeRef?.exactText ?? '';
  const expectedLabels = challengePacketSectionItems(exactText, ['Expected evidence']);
  const successCriteriaLabels = challengePacketSectionItems(exactText, ['Success criteria']);
  const expectedEvidence = expectedLabels.map((label): JsonObject => {
    const expectedSourceRefTypes = expectedEvidenceSourceTypes(label);
    const capturedSourceRefTypes = expectedSourceRefTypes.filter((type) =>
      sourceRefCountForTypes(sourceRefs, [type]) > 0);
    const hasVerificationGap = expectedSourceRefTypes.includes('test_run')
      && capturedSourceRefTypes.length === 0
      && sourceRefCountForTypes(sourceRefs, ['verification_gap']) > 0;
    const matchedSourceRefTypes = hasVerificationGap ? ['verification_gap'] : capturedSourceRefTypes;
    const sourceRefCount = sourceRefCountForTypes(sourceRefs, matchedSourceRefTypes);
    const status = capturedSourceRefTypes.length > 0
      ? 'captured'
      : hasVerificationGap
        ? 'gap_declared'
        : 'needs_human_review';
    return {
      label,
      status,
      expectedSourceRefTypes,
      matchedSourceRefTypes,
      sourceRefCount,
      detail: contractEvidenceStatusDetail({
        status,
        matchedSourceRefTypes: status === 'captured' ? matchedSourceRefTypes : expectedSourceRefTypes,
        sourceRefCount,
      }),
    };
  });
  const successCriteria = successCriteriaLabels.map((label): JsonObject => ({
    label,
    status: 'needs_human_review',
    detail: 'Success criteria are preserved from the challenge packet; they are not auto-passed.',
  }));
  const capturedCount = expectedEvidence.filter((item) => item.status === 'captured').length;
  const gapDeclaredCount = expectedEvidence.filter((item) => item.status === 'gap_declared').length;
  const needsHumanReviewCount = expectedEvidence.filter((item) => item.status !== 'captured').length
    + successCriteria.length;

  return {
    schemaVersion: 'assessment-contract-evidence-receipt-v1',
    expectedEvidence,
    successCriteria,
    summary: {
      expectedEvidenceCount: expectedEvidence.length,
      capturedCount,
      gapDeclaredCount,
      needsHumanReviewCount,
    },
  };
}

function buildReviewPacketOutput(input: {
  progress: AssessmentProgressSnapshot;
  sourceRefs: readonly SessionSourceRef[];
  evidenceCoverage: JsonObject;
  scheduledInterviewId: string;
  requestEventId: string;
  recommendation: string;
  claimIds: readonly string[];
  diagnosticCodes: readonly string[];
}): JsonObject {
  const challenge = input.progress.challenge;
  const contract = input.progress.challengePacketContract;
  const commit = input.progress.commit;
  return {
    schemaVersion: 'repo-task-review-packet-v1',
    scheduledInterviewId: input.scheduledInterviewId,
    requestEventId: input.requestEventId,
    challenge: {
      focus: challengeFocusSummary(input.sourceRefs),
      sourceRefType: challenge?.sourceRefType ?? null,
      sourceRefId: challenge?.sourceRefId ?? null,
      evidenceRole: challenge?.evidenceRole ?? null,
      repositoryUrl: locatorString(input.progress, ['repositoryUrl', 'githubRepoUrl', 'repoUrl']),
      baseCommitSha: locatorString(input.progress, ['baseCommitSha', 'baseCommit', 'base_commit_sha', 'base_commit']),
      pullRequestUrl: locatorString(input.progress, ['pullRequestUrl', 'githubPullRequestUrl', 'prUrl']),
      assignmentTrust: {
        state: input.progress.assignmentTrust.state,
        label: input.progress.assignmentTrust.label,
        detail: input.progress.assignmentTrust.detail,
        tone: input.progress.assignmentTrust.tone,
      },
      contract: {
        schemaVersion: contract.schemaVersion,
        isComplete: contract.isComplete,
        missingFields: [...contract.missingFields],
        hasRepositoryUrl: contract.hasRepositoryUrl,
        hasBaseCommitSha: contract.hasBaseCommitSha,
        hasTask: contract.hasTask,
        hasSuccessCriteria: contract.hasSuccessCriteria,
        hasExpectedEvidence: contract.hasExpectedEvidence,
      },
    },
    submission: commit
      ? {
          repositoryUrl: commit.repositoryUrl,
          forkRepositoryUrl: commit.forkRepositoryUrl,
          branchName: commit.branchName,
          baseCommitSha: commit.baseCommitSha,
          commitSha: commit.commitSha,
          commitUrl: commit.commitUrl,
          upstreamPullRequestUrl: commit.upstreamPullRequestUrl,
          upstreamPrConsent: commit.upstreamPrConsent,
          submissionSource: commit.submissionSource,
          submissionSourceLabel: commit.submissionSourceLabel,
          integrity: {
            status: commit.integrity.status,
            label: commit.integrity.label,
            detail: commit.integrity.detail,
            tone: commit.integrity.tone,
          },
          challengeBinding: {
            status: commit.challengeBinding.status,
            label: commit.challengeBinding.label,
            detail: commit.challengeBinding.detail,
            tone: commit.challengeBinding.tone,
          },
          changedFileCount: commit.changedFiles.length,
          changedFiles: commit.changedFiles.slice(0, 20),
          occurredAt: commit.occurredAt,
        }
      : null,
    evidence: {
      sourceRefCount: input.sourceRefs.length,
      sourceRefTypeCounts: sourceRefTypeCountsFromCoverage(input.evidenceCoverage),
      sourceRefCounts: input.progress.sourceRefCounts.map((row) => ({
        kind: row.kind,
        count: row.count,
      })),
      readiness: {
        status: input.progress.readiness.status,
        label: input.progress.readiness.label,
        detail: input.progress.readiness.detail,
        isReadyForEvaluation: input.progress.readiness.isReadyForEvaluation,
        isUsableHiringSignal: input.progress.readiness.isUsableHiringSignal,
        missingRequiredCount: input.progress.readiness.missingRequiredCount,
      },
      contractEvidence: buildContractEvidenceReceipt(input.sourceRefs),
      highConfidenceSignals: {
        messageEvidence: input.progress.hasMessageEvidence,
        devContainerEvidence: input.progress.hasDevContainerEvidence,
        toolUsageEvidence: input.progress.hasToolUsageEvidence,
        aiInteraction: input.progress.hasAiInteraction,
        transcriptEvidence: input.progress.hasTranscriptEvidence,
        testEvidence: input.progress.hasTestEvidence,
        verificationGap: input.progress.hasVerificationGap,
      },
    },
    evaluation: {
      recommendation: input.recommendation,
      claimIds: [...input.claimIds],
      diagnosticCodes: [...input.diagnosticCodes],
    },
  };
}

function hasRequiredEvidence(sourceRefs: readonly SessionSourceRef[]): boolean {
  const hasChallenge = sourceRefs.some((ref) =>
    CHALLENGE_REF_TYPES.has(ref.sourceRefType) || ref.evidenceRole === 'assigned_challenge');
  const hasCompleteChallengeContract = challengePacketContractMissingFields(sourceRefs).length === 0;
  const presentTypes = new Set(sourceRefs.map((ref) => ref.sourceRefType));
  return hasChallenge
    && hasCompleteChallengeContract
    && [...REQUIRED_EVALUATION_REF_TYPES].every((type) => presentTypes.has(type));
}

function firstSourceRefOfType(
  sourceRefs: readonly SessionSourceRef[],
  sourceRefType: string,
): SessionSourceRef | null {
  return sourceRefs.find((ref) => ref.sourceRefType === sourceRefType) ?? null;
}

function sourceRefsOfTypes<T extends AssessmentEvidenceSourceRefInput>(
  sourceRefs: readonly T[],
  sourceRefTypes: readonly string[],
): T[] {
  const allowedTypes = new Set(sourceRefTypes);
  return sourceRefs.filter((ref) => allowedTypes.has(ref.sourceRefType));
}

function hasSuccessfulVerification(
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[],
  sessionSourceRefs: readonly AssessmentEvidenceSourceRefInput[] = sourceRefs,
): boolean {
  return sourceRefsOfTypes(sourceRefs, ['test_run']).some((ref) => {
    if (!testRunMatchesCapturedCommit(ref, sessionSourceRefs)) return false;
    const exactText = ref.exactText ?? '';
    return /\bexitCode:\s*0\b/i.test(exactText)
      || /\bexit\s+code\s*[:=]\s*0\b/i.test(exactText)
      || /\bpassed\b/i.test(exactText);
  });
}

function testRunMatchesCapturedCommit(
  ref: AssessmentEvidenceSourceRefInput,
  sessionSourceRefs: readonly AssessmentEvidenceSourceRefInput[],
): boolean {
  if (ref.sourceRefType !== 'test_run') return false;
  const commitShas = sourceRefsOfTypes(sessionSourceRefs, ['git_commit'])
    .map((candidate) => candidate.sourceRefId.toLowerCase())
    .filter((candidate) => COMMIT_SHA_PATTERN.test(candidate));
  if (commitShas.length === 0) return false;

  const sourceRefId = ref.sourceRefId.toLowerCase();
  const locatorCommitSha = stringValue(ref.locator?.commitSha)?.toLowerCase();
  return commitShas.some((commitSha) =>
    sourceRefId === commitSha
    || sourceRefId.startsWith(`${commitSha}:`)
    || locatorCommitSha === commitSha);
}

function hasSourceRefsOfTypes(
  sourceRefs: readonly SessionSourceRef[],
  sourceRefTypes: readonly string[],
): boolean {
  const allowedTypes = new Set(sourceRefTypes);
  return sourceRefs.some((ref) => allowedTypes.has(ref.sourceRefType));
}

function deterministicFallbackSummary(sourceRefs: readonly SessionSourceRef[]): string {
  const focus = challengeFocusSummary(sourceRefs) ?? 'Open-source assessment';
  const captured: string[] = [];
  const gaps: string[] = [];
  const matchedAssignmentRef = matchedChallengeAssignmentRef(sourceRefs);

  if (challengePacketContractMissingFields(sourceRefs).length === 0) {
    captured.push(matchedAssignmentRef ? 'PIPE-matched challenge packet' : 'complete challenge packet');
  }
  if (hasSourceRefsOfTypes(sourceRefs, ['git_commit'])) captured.push('assessment commit');
  if (hasSourceRefsOfTypes(sourceRefs, ['code_diff'])) captured.push('exact diff');

  const hasVerificationGap = hasSourceRefsOfTypes(sourceRefs, VERIFICATION_GAP_SOURCE_REF_TYPES);
  if (hasSuccessfulVerification(sourceRefs)) {
    captured.push(hasVerificationGap
      ? 'successful verification with declared verification gap'
      : 'successful verification');
  } else if (hasSourceRefsOfTypes(sourceRefs, TEST_EVIDENCE_SOURCE_REF_TYPES)) {
    captured.push(hasVerificationGap
      ? 'verification evidence captured with declared gap'
      : 'verification evidence captured');
  } else if (hasVerificationGap) {
    captured.push('verification gap declared');
    gaps.push('test output missing');
  } else {
    gaps.push('test evidence missing');
  }

  if (hasSourceRefsOfTypes(sourceRefs, AI_EVIDENCE_SOURCE_REF_TYPES)) {
    captured.push('AI-use trail captured');
  } else {
    gaps.push('AI-use trail missing');
  }

  if (hasSourceRefsOfTypes(sourceRefs, CONVERSATION_EVIDENCE_SOURCE_REF_TYPES)) {
    captured.push('conversation context captured');
  } else {
    gaps.push('conversation context missing');
  }

  if (hasSourceRefsOfTypes(sourceRefs, WORKSPACE_ACTIVITY_SOURCE_REF_TYPES)) {
    captured.push('workspace activity captured');
  }

  if (hasSourceRefsOfTypes(sourceRefs, ['upstream_pull_request'])) {
    captured.push('upstream PR tracked');
  } else {
    gaps.push('upstream PR not tracked');
  }

  const capturedSummary = captured.length > 0
    ? captured.join(', ')
    : 'required source evidence captured';
  const gapSummary = gaps.length > 0
    ? gaps.join(', ')
    : 'human correctness review still required';
  return truncateEvaluationSummary(`${focus}: ${capturedSummary}; ${gapSummary}.`);
}

function missingVerificationDiagnostic(
  sourceRefs: readonly SessionSourceRef[],
): AssessmentDiagnosticInput | null {
  const verificationGapRefs = sourceRefsOfTypes(sourceRefs, VERIFICATION_GAP_SOURCE_REF_TYPES)
    .slice(0, 4);
  if (verificationGapRefs.length > 0) {
    const hasTestEvidence = sourceRefsOfTypes(sourceRefs, TEST_EVIDENCE_SOURCE_REF_TYPES).length > 0;
    return diagnosticInput({
      code: 'VERIFICATION_GAP_DECLARED',
      severity: 'warning',
      message: hasTestEvidence
        ? 'A verification_gap source ref was captured alongside test output, so PIPE preserves the declared partial verification limitation for human review.'
        : 'A verification_gap source ref was captured instead of test_run output, so PIPE preserves the declared verification limitation and cannot make positive verification or test-strategy claims.',
      retryable: false,
      sourceRefs: verificationGapRefs,
      details: hasTestEvidence
        ? {
            capturedSourceRefType: 'verification_gap',
            impact: 'Human review should inspect the declared gap before treating captured test output as complete verification.',
          }
        : {
            capturedSourceRefType: 'verification_gap',
            missingSourceRefType: 'test_run',
            impact: 'Human review can inspect the commit, diff, and declared blocker, but verification confidence is lower until test output is captured.',
          },
    });
  }
  if (sourceRefsOfTypes(sourceRefs, TEST_EVIDENCE_SOURCE_REF_TYPES).length > 0) return null;
  return diagnosticInput({
    code: 'MISSING_TEST_EVIDENCE',
    severity: 'warning',
    message: 'No test_run source evidence was captured, so PIPE cannot make positive verification or test-strategy claims.',
    retryable: false,
    details: {
      missingSourceRefType: 'test_run',
      impact: 'Human review can inspect the commit and diff, but verification confidence is lower until test output is captured.',
    },
  });
}

export function buildDeterministicAssessmentFallback(input: {
  sessionId: string;
  sourceRefs: readonly SessionSourceRef[];
  requestSourceRef: AssessmentEvidenceSourceRefInput;
}): {
  summary: string;
  recommendation: string;
  claims: AssessmentEvaluationClaimInputCompat[];
  diagnostics: AssessmentDiagnosticInput[];
} | null {
  const challengeRefs = sourceRefsOfTypes(input.sourceRefs, [...CHALLENGE_REF_TYPES])
    .filter((ref) => CHALLENGE_REF_TYPES.has(ref.sourceRefType) || ref.evidenceRole === 'assigned_challenge');
  const challengeRef = challengeRefs[0] ?? null;
  const commitRef = firstSourceRefOfType(input.sourceRefs, 'git_commit');
  const diffRef = firstSourceRefOfType(input.sourceRefs, 'code_diff');
  if (!challengeRef || !commitRef || !diffRef) return null;

  const claims: AssessmentEvaluationClaimInputCompat[] = [{
    id: `repo_task_eval_${input.sessionId}_source_contract`.replace(/[^A-Za-z0-9:_-]/g, '_'),
    polarity: 'positive',
    dimension: 'source_provenance',
    narrative: 'The assessment has a complete source-backed challenge packet, submitted commit, and exact code diff for review.',
    confidence: 0.82,
    sourceRefs: [challengeRef, commitRef, diffRef],
  }, {
    id: `repo_task_eval_${input.sessionId}_implementation_evidence`.replace(/[^A-Za-z0-9:_-]/g, '_'),
    polarity: 'positive',
    dimension: 'implementation_evidence',
    narrative: 'The submitted implementation diff is captured as exact source evidence for assessment.',
    confidence: 0.78,
    sourceRefs: [diffRef],
  }];

  const matchedAssignmentRef = matchedChallengeAssignmentRef(input.sourceRefs);
  if (matchedAssignmentRef) {
    claims.push({
      id: `repo_task_eval_${input.sessionId}_assignment_fit_provenance`.replace(/[^A-Za-z0-9:_-]/g, '_'),
      polarity: 'positive',
      dimension: 'assignment_fit_provenance',
      narrative: 'The assigned challenge packet preserves source-backed PIPE match proof for reviewer calibration.',
      confidence: 0.7,
      sourceRefs: [matchedAssignmentRef],
    });
  }

  const verificationRef = firstSourceRefOfType(input.sourceRefs, 'test_run');
  if (verificationRef && hasSuccessfulVerification(input.sourceRefs)) {
    claims.push({
      id: `repo_task_eval_${input.sessionId}_verification_evidence`.replace(/[^A-Za-z0-9:_-]/g, '_'),
      polarity: 'positive',
      dimension: 'verification',
      narrative: 'The captured verification command completed successfully for the submitted workspace state.',
      confidence: 0.72,
      sourceRefs: [verificationRef],
    });
  }

  const aiRefs = sourceRefsOfTypes(input.sourceRefs, AI_EVIDENCE_SOURCE_REF_TYPES).slice(0, 4);
  if (aiRefs.length > 0) {
    const hasAgentResponse = aiRefs.some((ref) =>
      ref.sourceRefType === 'ai_agent_response' || ref.sourceRefType === 'session_chat_agent' || ref.sourceRefType === 'ai_chat_agent');
    const hasBlockedPrompt = aiRefs.some((ref) => ref.sourceRefType === 'ai_user_prompt_blocked');
    claims.push({
      id: `repo_task_eval_${input.sessionId}_ai_use_observability`.replace(/[^A-Za-z0-9:_-]/g, '_'),
      polarity: 'positive',
      dimension: 'ai_use_observability',
      narrative: hasAgentResponse
        ? 'Candidate AI-assistance prompts and agent responses are captured as real source evidence for review.'
        : hasBlockedPrompt
          ? 'Blocked AI-assistance attempts are captured honestly instead of being treated as successful agent help.'
          : 'Candidate AI-assistance activity is captured as real source evidence for review.',
      confidence: 0.68,
      sourceRefs: aiRefs,
    });
  }

  const conversationRefs = sourceRefsOfTypes(input.sourceRefs, CONVERSATION_EVIDENCE_SOURCE_REF_TYPES).slice(0, 4);
  if (conversationRefs.length > 0) {
    claims.push({
      id: `repo_task_eval_${input.sessionId}_communication_context`.replace(/[^A-Za-z0-9:_-]/g, '_'),
      polarity: 'positive',
      dimension: 'communication_context',
      narrative: 'Candidate explanation or room conversation context is captured as source evidence for review.',
      confidence: 0.66,
      sourceRefs: conversationRefs,
    });
  }

  const upstreamPullRequestRef = firstSourceRefOfType(input.sourceRefs, 'upstream_pull_request');
  if (upstreamPullRequestRef) {
    claims.push({
      id: `repo_task_eval_${input.sessionId}_upstream_pr_tracking`.replace(/[^A-Za-z0-9:_-]/g, '_'),
      polarity: 'positive',
      dimension: 'upstream_pr_tracking',
      narrative: 'Candidate-approved upstream pull request tracking is captured for reviewer inspection.',
      confidence: 0.64,
      sourceRefs: [upstreamPullRequestRef],
    });
  }

  const activityRefs = sourceRefsOfTypes(input.sourceRefs, WORKSPACE_ACTIVITY_SOURCE_REF_TYPES).slice(0, 4);
  if (activityRefs.length > 0) {
    claims.push({
      id: `repo_task_eval_${input.sessionId}_workspace_activity`.replace(/[^A-Za-z0-9:_-]/g, '_'),
      polarity: 'positive',
      dimension: 'workspace_process',
      narrative: 'Workspace activity was captured alongside the final submitted commit evidence.',
      confidence: 0.7,
      sourceRefs: activityRefs,
    });
  }

  const focus = challengeFocusSummary(input.sourceRefs);
  const summary = deterministicFallbackSummary(input.sourceRefs);

  return {
    summary,
    recommendation: DEFAULT_RECOMMENDATION,
    claims: claims.slice(0, MAX_DETERMINISTIC_FALLBACK_CLAIMS),
    diagnostics: [
      ...[missingVerificationDiagnostic(input.sourceRefs)].filter((diagnostic): diagnostic is AssessmentDiagnosticInput => Boolean(diagnostic)),
      diagnosticInput({
        code: 'MODEL_CLAIMS_UNUSABLE',
        severity: 'warning',
        message: 'The AI evaluator did not return usable non-diagnostic claims, so PIPE generated conservative claims only from captured source evidence.',
        retryable: false,
        sourceRefs: [input.requestSourceRef],
        details: {
          fallback: 'deterministic_source_evidence',
          recommendation: DEFAULT_RECOMMENDATION,
          challengeFocus: focus,
        },
      }),
      diagnosticInput({
        code: 'HUMAN_CORRECTNESS_REVIEW_REQUIRED',
        severity: 'warning',
        message: 'A human reviewer should inspect the diff before treating the commit as proven upstream-correct.',
        retryable: false,
        sourceRefs: [diffRef],
      }),
    ],
  };
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
    'Use EVIDENCE_COVERAGE before scoring. Missing expected evidence must become diagnostics or uncertainty, never positive claims.',
    'Do not make positive test_strategy, verification, implementation correctness, quality, security, reliability, AI-usage, process, communication, reasoning, or tradeoff claims when the matching coverage item is unsatisfied.',
    'A code_diff proves what changed, not that the implementation is correct. Use implementation_evidence for diff-only claims.',
    'A test_run must be bound to the submitted git_commit before it can support positive verification or correctness claims.',
    'Use strong_evidence_to_advance only when verified implementation-quality claims survive and no warning or blocking diagnostics remain.',
    'A verification_gap explains why verification is partial or missing; it is not test_run evidence and must not support positive verification claims.',
    'If evidence is missing, uncertain, ungrounded, or insufficient, return diagnostics instead of positive claims.',
    'Keep the response compact: at most 4 claims and 4 diagnostics; summary and narratives must be one short sentence each.',
    'Return only JSON with keys: summary, recommendation, claims, diagnostics.',
    'Do not include analysis, markdown, or prose before or after the JSON object.',
    'Allowed claim polarities: positive, negative, diagnostic.',
    'Useful dimensions include source_comprehension, implementation_evidence, implementation_correctness only when verified, debugging_reasoning, test_strategy, security_and_reliability, ai_output_verification, communication.',
  ].join('\n');
}

function buildUserPrompt(input: {
  sessionMode: RepoTaskInterviewMode;
  scheduledInterviewId: string;
  sourceRefs: readonly SessionSourceRef[];
  evidenceCoverage: JsonObject;
}): string {
  const sourceRefs = input.sourceRefs.slice(0, MAX_AI_PROMPT_SOURCE_REFS).map(summarizeSourceRef);
  return JSON.stringify({
    task: 'Evaluate the submitted open-source repo-task commit from exact source evidence.',
    scheduledInterviewId: input.scheduledInterviewId,
    sessionMode: input.sessionMode,
    evidenceCoverage: input.evidenceCoverage,
    sourceRefs,
    outputContract: {
      summary: 'one short source-grounded assessment summary',
      recommendation: 'strong_evidence_to_advance | mixed_evidence_human_review | insufficient_evidence | not_demonstrated',
      claims: [{
        id: 'stable-short-id',
        polarity: 'positive | negative | diagnostic',
        dimension: 'assessment dimension',
        narrative: 'one short claim grounded only in cited source refs',
        confidence: 0.0,
        sourceRefKeys: ['one-or-more keys from SOURCE_REFS'],
      }],
      diagnostics: [{
        code: 'MISSING_TEST_EVIDENCE | VERIFICATION_GAP_DECLARED | PROVENANCE_INCOMPLETE | EVALUATION_NEEDS_HUMAN_REVIEW',
        severity: 'info | warning | blocking',
        message: 'one short sentence explaining what cannot be concluded and why',
        sourceRefKeys: ['optional keys from SOURCE_REFS'],
      }],
      limits: {
        maxClaims: 4,
        maxDiagnostics: 4,
        maxSummaryCharacters: 320,
        maxNarrativeCharacters: 240,
      },
    },
  });
}

function extractBalancedJsonObjects(value: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString: '"' | '\'' | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      inString = char;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects.reverse();
}

function extractPlainTextSourceRefKeys(value: string): string[] {
  const bracketGroups = Array.from(value.matchAll(/\[([^\]]+)\]/g)).map((match) => match[1] ?? '');
  return bracketGroups.flatMap((group) =>
    group.split(',')
      .map((item) => item.trim().replace(/^`+|`+$/g, '').replace(/^["']|["']$/g, ''))
      .filter((item) => item.includes(':') && !item.startsWith('evidenceCoverage.')));
}

function parsePlainTextAssessmentOutput(content: string): AiAssessmentOutput | null {
  const summaryMatches = Array.from(content.matchAll(/^\s*(?:[-*]\s*)?Summary:\s*(.+)$/gim));
  const recommendationMatches = Array.from(content.matchAll(/^\s*(?:[-*]\s*)?Recommendation:\s*`?([A-Za-z_]+)`?/gim));
  const summary = stringValue(summaryMatches.at(-1)?.[1]);
  const recommendationCandidate = stringValue(recommendationMatches.at(-1)?.[1]);
  const recommendation = recommendationCandidate && ALLOWED_RECOMMENDATIONS.has(recommendationCandidate)
    ? recommendationCandidate
    : null;

  const claims: AiAssessmentClaim[] = [];
  const seenClaims = new Set<string>();
  for (const match of content.matchAll(
    /^\s*[-*]\s*(positive|negative|diagnostic)\s*\|\s*([A-Za-z0-9_-]+)\s*\|\s*(.+)$/gim,
  )) {
    const polarity = match[1];
    const dimension = match[2];
    const line = (match[3] ?? '').trim();
    const narrative = stringValue(line.replace(/\s*\[[^\]]+\]\s*[.)]*\s*$/, ''));
    if (!polarity || !dimension || !narrative) continue;
    const sourceRefKeys = extractPlainTextSourceRefKeys(line);
    const seenKey = `${polarity}:${dimension}:${narrative}:${sourceRefKeys.join(',')}`;
    if (seenClaims.has(seenKey)) continue;
    seenClaims.add(seenKey);
    claims.push({
      id: `${dimension}-${claims.length + 1}`,
      polarity,
      dimension,
      narrative,
      confidence: polarity === 'positive' ? 0.65 : 0.5,
      sourceRefKeys,
    });
  }

  const diagnostics: AiAssessmentDiagnostic[] = [];
  const seenDiagnostics = new Set<string>();
  for (const match of content.matchAll(
    /^\s*[-*]\s*(info|warning|blocking)\s*\|\s*([A-Za-z0-9_-]+)\s*\|\s*(.+)$/gim,
  )) {
    const severity = match[1];
    const code = match[2];
    const line = (match[3] ?? '').trim();
    const message = stringValue(line.replace(/\s*\[[^\]]+\]\s*[.)]*\s*$/, ''));
    if (!severity || !code || !message) continue;
    const sourceRefKeys = extractPlainTextSourceRefKeys(line);
    const seenKey = `${severity}:${code}:${message}:${sourceRefKeys.join(',')}`;
    if (seenDiagnostics.has(seenKey)) continue;
    seenDiagnostics.add(seenKey);
    diagnostics.push({ code, severity, message, sourceRefKeys });
  }

  for (const match of content.matchAll(/^\s*[-*]\s*([A-Z][A-Z0-9_]+):\s*(.+)$/gm)) {
    const code = match[1];
    const line = (match[2] ?? '').trim();
    const message = stringValue(line.replace(/\s*\[[^\]]+\]\s*[.)]*\s*$/, ''));
    if (!code || !message) continue;
    const sourceRefKeys = extractPlainTextSourceRefKeys(line);
    const seenKey = `info:${code}:${message}:${sourceRefKeys.join(',')}`;
    if (seenDiagnostics.has(seenKey)) continue;
    seenDiagnostics.add(seenKey);
    diagnostics.push({ code, severity: 'info', message, sourceRefKeys });
  }

  if (!summary && !recommendation && claims.length === 0 && diagnostics.length === 0) return null;
  return {
    ...(summary ? { summary } : {}),
    ...(recommendation ? { recommendation } : {}),
    claims: claims.slice(0, 4),
    diagnostics: diagnostics.slice(0, 4),
  };
}

function extractJsonStringProperty(value: string, property: string): string | null {
  const match = new RegExp(`"${property}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`, 'i').exec(value);
  if (!match?.[1]) return null;
  try {
    return stringValue(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

function extractJsonArraySegment(value: string, property: string): string | null {
  const propertyMatch = new RegExp(`"${property}"\\s*:\\s*\\[`, 'i').exec(value);
  if (!propertyMatch) return null;
  const arrayStart = value.indexOf('[', propertyMatch.index);
  if (arrayStart < 0) return null;

  let depth = 0;
  let inString: '"' | null = null;
  let escaped = false;
  for (let index = arrayStart; index < value.length; index += 1) {
    const char = value[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === '"') {
      inString = char;
      continue;
    }

    if (char === '[') {
      depth += 1;
      continue;
    }

    if (char === ']' && depth > 0) {
      depth -= 1;
      if (depth === 0) return value.slice(arrayStart + 1, index);
    }
  }

  return value.slice(arrayStart + 1);
}

function parseJsonObjectCandidates<T extends object>(segment: string | null): T[] {
  if (!segment) return [];
  return extractBalancedJsonObjects(segment)
    .reverse()
    .flatMap((candidate): T[] => {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? [parsed as T]
          : [];
      } catch {
        return [];
      }
    });
}

function parseTruncatedJsonAssessmentOutput(content: string): AiAssessmentOutput | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || trimmed.endsWith('}')) return null;

  const claims = parseJsonObjectCandidates<AiAssessmentClaim>(
    extractJsonArraySegment(trimmed, 'claims'),
  );
  const diagnostics = parseJsonObjectCandidates<AiAssessmentDiagnostic>(
    extractJsonArraySegment(trimmed, 'diagnostics'),
  );
  const summary = extractJsonStringProperty(trimmed, 'summary');
  const recommendation = extractJsonStringProperty(trimmed, 'recommendation');
  if (!summary && !recommendation && claims.length === 0 && diagnostics.length === 0) return null;

  return {
    ...(summary ? { summary } : {}),
    ...(recommendation ? { recommendation } : {}),
    claims: claims.slice(0, 4),
    diagnostics: [
      ...diagnostics.slice(0, 3),
      {
        code: 'EVALUATOR_OUTPUT_TRUNCATED',
        severity: 'warning',
        message: 'The evaluator response ended before a complete JSON object; PIPE used only complete source-cited claims and ignored the partial tail.',
        sourceRefKeys: [],
      },
    ],
  };
}

export function parseAiJson(content: string | null): AiAssessmentOutput {
  if (!content) throw new Error('assessment evaluator returned empty content');
  const trimmed = content.trim();
  const stripTrailingCommas = (value: string): string => value.replace(/,\s*([}\]])/g, '$1');
  const quoteBareObjectKeys = (value: string): string => {
    let output = '';
    let index = 0;
    let inString: '"' | '\'' | null = null;
    let escaped = false;
    let expectingKey = false;
    while (index < value.length) {
      const char = value[index]!;
      if (inString) {
        output += char;
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === inString) {
          inString = null;
        }
        index += 1;
        continue;
      }
      if (char === '"' || char === '\'') {
        output += char;
        inString = char;
        index += 1;
        continue;
      }
      if (char === '{' || char === ',') {
        output += char;
        expectingKey = true;
        index += 1;
        continue;
      }
      if (expectingKey && /\s/.test(char)) {
        output += char;
        index += 1;
        continue;
      }
      if (expectingKey && /[A-Za-z_$]/.test(char)) {
        const keyStart = index;
        index += 1;
        while (index < value.length && /[A-Za-z0-9_$]/.test(value[index]!)) index += 1;
        let lookahead = index;
        while (lookahead < value.length && /\s/.test(value[lookahead]!)) lookahead += 1;
        if (value[lookahead] === ':') {
          output += `"${value.slice(keyStart, index)}"`;
          expectingKey = false;
          continue;
        }
        output += value.slice(keyStart, index);
        expectingKey = false;
        continue;
      }
      output += char;
      if (!/\s/.test(char)) expectingKey = false;
      index += 1;
    }
    return output;
  };
  const parseStrictOrRepairedJsonObject = (value: string): AiAssessmentOutput => {
    const candidates = [
      value,
      stripTrailingCommas(value),
      quoteBareObjectKeys(value),
      stripTrailingCommas(quoteBareObjectKeys(value)),
    ];
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as AiAssessmentOutput;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('assessment evaluator did not return parseable JSON');
  };
  try {
    return parseStrictOrRepairedJsonObject(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) return parseStrictOrRepairedJsonObject(fenced);
    const jsonObjectCandidates = extractBalancedJsonObjects(trimmed);
    for (const candidate of jsonObjectCandidates) {
      try {
        return parseStrictOrRepairedJsonObject(candidate);
      } catch {
        // Try the next balanced object candidate before falling back to plain text.
      }
    }
    const truncatedJson = parseTruncatedJsonAssessmentOutput(trimmed);
    if (truncatedJson) return truncatedJson;
    const fallback = parsePlainTextAssessmentOutput(trimmed);
    if (fallback) return fallback;
    throw new Error('assessment evaluator did not return parseable JSON or structured assessment text');
  }
}

function resolveAiSourceRefs(
  rawKeys: unknown,
  sourceRefByKey: ReadonlyMap<string, SessionSourceRef>,
): SessionSourceRef[] {
  const refs: SessionSourceRef[] = [];
  const seen = new Set<string>();
  const allRefs = Array.from(sourceRefByKey.values());
  for (const rawKey of stringArrayValue(rawKeys)) {
    const key = rawKey.trim();
    const exactRef = sourceRefByKey.get(key);
    const ref = exactRef ?? allRefs.find((candidate) => (
      candidate.sourceRefId === key
      || `${candidate.sourceRefType}:${candidate.sourceRefId}` === key
      || candidate.key.startsWith(`${key}:`)
      || candidate.key.startsWith(`${candidate.sourceRefType}:${key}:`)
    ));
    if (!ref || seen.has(ref.key)) continue;
    refs.push(ref);
    seen.add(ref.key);
  }
  return refs;
}

function normalizeAiClaims(
  rawClaims: unknown,
  sourceRefByKey: ReadonlyMap<string, SessionSourceRef>,
  sessionId: string,
): {
  claims: AssessmentEvaluationClaimInputCompat[];
  diagnostics: AssessmentDiagnosticInput[];
} {
  if (!Array.isArray(rawClaims)) return { claims: [], diagnostics: [] };

  const claims: AssessmentEvaluationClaimInputCompat[] = [];
  const diagnostics: AssessmentDiagnosticInput[] = [];
  rawClaims.forEach((rawClaim, index) => {
    if (rawClaim === null || typeof rawClaim !== 'object' || Array.isArray(rawClaim)) return;
    const claim = rawClaim as AiAssessmentClaim;
    const polarity = stringValue(claim.polarity) ?? 'diagnostic';
    if (!ALLOWED_CLAIM_POLARITIES.has(polarity)) return;
    const narrative = stringValue(claim.narrative);
    const dimension = stringValue(claim.dimension);
    if (!narrative || !dimension) return;
    const citedRefs = resolveAiSourceRefs(claim.sourceRefKeys, sourceRefByKey);
    if (polarity !== 'diagnostic' && citedRefs.length === 0) return;
    const confidence = numberValue(claim.confidence);
    const rawId = stringValue(claim.id) ?? `${dimension}-${index + 1}`;
    const normalizedClaim: AssessmentEvaluationClaimInputCompat = {
      id: `repo_task_eval_${sessionId}_${rawId}`.replace(/[^A-Za-z0-9:_-]/g, '_'),
      polarity: polarity as AssessmentEvaluationClaimInputCompat['polarity'],
      dimension,
      narrative,
      confidence,
      sourceRefs: citedRefs,
    };
    const unsupportedDiagnostic = positiveClaimUnsupportedDiagnostic(
      normalizedClaim,
      citedRefs,
      Array.from(sourceRefByKey.values()),
    );
    if (unsupportedDiagnostic) {
      diagnostics.push(unsupportedDiagnostic);
      return;
    }
    claims.push(normalizedClaim);
  });

  return {
    claims: claims.slice(0, 12),
    diagnostics: diagnostics.slice(0, 8),
  };
}

function positiveClaimUnsupportedDiagnostic(
  claim: AssessmentEvaluationClaimInputCompat,
  citedRefs: readonly SessionSourceRef[],
  sessionSourceRefs: readonly SessionSourceRef[],
): AssessmentDiagnosticInput | null {
  if (claim.polarity !== 'positive') return null;

  const dimension = claim.dimension.toLowerCase();
  const hasTestRunRef = citedRefs.some((ref) => ref.sourceRefType === 'test_run');
  const hasSuccessfulTestRunRef = hasSuccessfulVerification(citedRefs, sessionSourceRefs);
  if (dimension.includes('verification') && !hasSuccessfulTestRunRef) {
    return unsupportedPositiveClaimDiagnostic(
      claim,
      citedRefs,
      'Positive verification claims require a successful test_run source ref bound to the submitted commit.',
    );
  }
  if (dimension.includes('test') && !hasTestRunRef) {
    return unsupportedPositiveClaimDiagnostic(
      claim,
      citedRefs,
      'Positive test-strategy claims require a test_run source ref.',
    );
  }
  if (dimension.includes('ai') && sourceRefsOfTypes(citedRefs, AI_EVIDENCE_SOURCE_REF_TYPES).length === 0) {
    return unsupportedPositiveClaimDiagnostic(
      claim,
      citedRefs,
      'Positive AI-use claims require real AI prompt, response, blocked-prompt, or agent diagnostic source refs.',
    );
  }
  if (positiveCorrectnessDimensionRequiresVerification(dimension) && !hasSuccessfulTestRunRef) {
    return unsupportedPositiveClaimDiagnostic(
      claim,
      citedRefs,
      'Positive implementation correctness, quality, security, reliability, or performance claims require a successful test_run source ref bound to the submitted commit; use implementation_evidence for diff-only claims.',
    );
  }
  if (positiveProcessDimensionRequiresEvidence(dimension)
    && sourceRefsOfTypes(citedRefs, PROCESS_EVIDENCE_SOURCE_REF_TYPES).length === 0) {
    return unsupportedPositiveClaimDiagnostic(
      claim,
      citedRefs,
      'Positive process or debugging claims require terminal, code-editor, workspace, transcript, chat, or candidate AI-prompt source refs.',
    );
  }
  if (positiveCommunicationDimensionRequiresEvidence(dimension)
    && sourceRefsOfTypes(citedRefs, COMMUNICATION_EVIDENCE_SOURCE_REF_TYPES).length === 0) {
    return unsupportedPositiveClaimDiagnostic(
      claim,
      citedRefs,
      'Positive communication, reasoning, or tradeoff claims require transcript, chat, candidate plan, or candidate-authored AI prompt source refs.',
    );
  }
  return null;
}

function positiveCorrectnessDimensionRequiresVerification(dimension: string): boolean {
  return dimension.includes('correctness')
    || dimension.includes('correct_')
    || dimension.endsWith('_correct')
    || dimension.includes('quality')
    || dimension.includes('security')
    || dimension.includes('reliability')
    || dimension.includes('reliable')
    || dimension.includes('performance')
    || dimension.includes('production_readiness')
    || dimension.includes('upstream_correct');
}

function positiveProcessDimensionRequiresEvidence(dimension: string): boolean {
  return dimension.includes('process')
    || dimension.includes('debugging')
    || dimension.includes('workflow')
    || dimension.includes('terminal')
    || dimension.includes('tool');
}

function positiveCommunicationDimensionRequiresEvidence(dimension: string): boolean {
  return dimension.includes('communication')
    || dimension.includes('collaboration')
    || dimension.includes('conversation')
    || dimension.includes('explanation')
    || dimension.includes('reasoning')
    || dimension.includes('rationale')
    || dimension.includes('tradeoff')
    || dimension.includes('trade-off');
}

function unsupportedPositiveClaimDiagnostic(
  claim: AssessmentEvaluationClaimInputCompat,
  sourceRefs: readonly SessionSourceRef[],
  reason: string,
): AssessmentDiagnosticInput {
  return diagnosticInput({
    code: 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE',
    severity: 'warning',
    message: `Dropped unsupported positive ${claim.dimension} claim from the AI evaluator: ${reason}`,
    retryable: false,
    sourceRefs,
    details: {
      dimension: claim.dimension,
      rejectedClaimId: claim.id,
      rejectedNarrative: claim.narrative,
    },
  });
}

function dedupeDiagnostics(
  diagnostics: readonly AssessmentDiagnosticInput[],
): AssessmentDiagnosticInput[] {
  const output: AssessmentDiagnosticInput[] = [];
  const indexByKey = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.severity}`;
    const existingIndex = indexByKey.get(key);
    if (existingIndex !== undefined) {
      const existing = output[existingIndex];
      const existingSourceRefCount = existing?.sourceRefs?.length ?? 0;
      const nextSourceRefCount = diagnostic.sourceRefs?.length ?? 0;
      if (existing && nextSourceRefCount > existingSourceRefCount) {
        output[existingIndex] = diagnostic;
      }
      continue;
    }
    indexByKey.set(key, output.length);
    output.push(diagnostic);
  }
  return output;
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
    const sourceRefs = resolveAiSourceRefs(diagnostic.sourceRefKeys, sourceRefByKey);
    return [diagnosticInput({
      code,
      severity,
      message,
      retryable: false,
      sourceRefs,
    })];
  }).slice(0, 8);
}

function normalizeAiRecommendation(rawRecommendation: unknown): {
  recommendation: string;
  diagnostics: AssessmentDiagnosticInput[];
} {
  const recommendation = stringValue(rawRecommendation);
  if (recommendation && ALLOWED_RECOMMENDATIONS.has(recommendation)) {
    return { recommendation, diagnostics: [] };
  }

  const message = recommendation
    ? `AI evaluator returned unsupported recommendation "${recommendation}"; PIPE defaulted to human review.`
    : 'AI evaluator did not return an allowed recommendation; PIPE defaulted to human review.';

  return {
    recommendation: DEFAULT_RECOMMENDATION,
    diagnostics: [
      diagnosticInput({
        code: recommendation
          ? 'MODEL_RECOMMENDATION_UNSUPPORTED'
          : 'MODEL_RECOMMENDATION_MISSING',
        severity: 'warning',
        message,
        retryable: false,
        details: {
          returnedRecommendation: recommendation,
          defaultRecommendation: DEFAULT_RECOMMENDATION,
          allowedRecommendations: Array.from(ALLOWED_RECOMMENDATIONS),
        },
      }),
    ],
  };
}

function evidenceCappedRecommendation(input: {
  recommendation: string;
  claims: readonly AssessmentEvaluationClaimInputCompat[];
  diagnostics: readonly AssessmentDiagnosticInput[];
  sessionSourceRefs: readonly AssessmentEvidenceSourceRefInput[];
}): {
  recommendation: string;
  diagnostics: AssessmentDiagnosticInput[];
} {
  if (input.recommendation !== 'strong_evidence_to_advance') {
    return { recommendation: input.recommendation, diagnostics: [] };
  }

  const hasBlockingOrWarningDiagnostic = input.diagnostics.some((diagnostic) =>
    diagnostic.severity === 'blocking' || diagnostic.severity === 'warning');
  const allSourceRefs = allClaimSourceRefs(input.claims);
  const hasVerifiedImplementationClaim = input.claims.some((claim) => {
    if (claim.polarity !== 'positive') return false;
    const dimension = claim.dimension.toLowerCase();
    if (
      !dimension.includes('verification')
      && !positiveCorrectnessDimensionRequiresVerification(dimension)
    ) {
      return false;
    }
    return hasSuccessfulVerification(claim.sourceRefs ?? [], input.sessionSourceRefs);
  });

  if (hasVerifiedImplementationClaim && !hasBlockingOrWarningDiagnostic) {
    return { recommendation: input.recommendation, diagnostics: [] };
  }

  return {
    recommendation: DEFAULT_RECOMMENDATION,
    diagnostics: [
      diagnosticInput({
        code: 'MODEL_RECOMMENDATION_DOWNGRADED_BY_EVIDENCE',
        severity: 'warning',
        message: 'AI evaluator recommendation "strong_evidence_to_advance" was downgraded because surviving claims or diagnostics do not prove verified implementation quality.',
        retryable: false,
        sourceRefs: allSourceRefs.slice(0, 4),
        details: {
          returnedRecommendation: input.recommendation,
          defaultRecommendation: DEFAULT_RECOMMENDATION,
          hasVerifiedImplementationClaim,
          hasBlockingOrWarningDiagnostic,
        },
      }),
    ],
  };
}

function allClaimSourceRefs(
  claims: readonly AssessmentEvaluationClaimInputCompat[],
): AssessmentEvidenceSourceRefInput[] {
  const refs: AssessmentEvidenceSourceRefInput[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    for (const ref of claim.sourceRefs ?? []) {
      const key = `${ref.sourceRefType}:${ref.sourceRefId}:${ref.evidenceRole ?? ''}:${ref.sourceSpanId ?? ''}`;
      if (seen.has(key)) continue;
      refs.push(ref);
      seen.add(key);
    }
  }
  return refs;
}

async function recordAiInteraction(input: {
  store: RepoTaskInterviewSessionStore;
  sessionId: string;
  requestedAt: string;
  requestedBy: string;
  provider: LLMProvider;
  prompt: string;
  response: string;
  evidenceCoverage: JsonObject;
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
      evidenceCoverage: input.evidenceCoverage,
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

async function createDeterministicFallbackReport(input: {
  store: RepoTaskInterviewSessionStore;
  sessionId: string;
  sessionMode: RepoTaskInterviewMode;
  scheduledInterviewId: string;
  requestEventId: string;
  requestSourceRef: AssessmentEvidenceSourceRefInput;
  progress: AssessmentProgressSnapshot;
  sourceRefs: readonly SessionSourceRef[];
  evidenceCoverage: JsonObject;
  provider: LLMProvider;
  rawResponse: string;
  diagnostics?: readonly AssessmentDiagnosticInput[];
  fallbackReason: string;
  fallbackReasonCode: string;
}): Promise<RepoTaskAssessmentEvaluationResult | null> {
  const deterministicFallback = buildDeterministicAssessmentFallback({
    sessionId: input.sessionId,
    sourceRefs: input.sourceRefs,
    requestSourceRef: input.requestSourceRef,
  });
  if (!deterministicFallback?.claims.some((claim) => claim.polarity !== 'diagnostic')) {
    return null;
  }

  const diagnostics = dedupeDiagnostics([
    ...(input.diagnostics ?? []),
    ...[missingVerificationDiagnostic(input.sourceRefs)].filter((diagnostic): diagnostic is AssessmentDiagnosticInput => Boolean(diagnostic)),
    ...deterministicFallback.diagnostics,
  ]);
  const status: EvaluationReportStatus = 'EVALUATED';
  const report = await input.store.createEvaluationReport({
    sessionId: input.sessionId,
    ingestionKey: `assessment-report:${input.sessionId}:deterministic-fallback:${await deterministicEntityId('content', input.rawResponse || deterministicFallback.summary)}`,
    status,
    summary: deterministicFallback.summary,
    output: {
      schemaVersion: 'repo-task-assessment-output-v1',
      status,
      mode: input.sessionMode,
      recommendation: deterministicFallback.recommendation,
      provider: input.provider.name,
      model: input.provider.model,
      scheduledInterviewId: input.scheduledInterviewId,
      requestEventId: input.requestEventId,
      challengeFocus: challengeFocusSummary(input.sourceRefs),
      evidenceCoverage: input.evidenceCoverage,
      reviewPacket: buildReviewPacketOutput({
        progress: input.progress,
        sourceRefs: input.sourceRefs,
        evidenceCoverage: input.evidenceCoverage,
        scheduledInterviewId: input.scheduledInterviewId,
        requestEventId: input.requestEventId,
        recommendation: deterministicFallback.recommendation,
        claimIds: deterministicFallback.claims.map((claim) => claim.id),
        diagnosticCodes: diagnostics.map((diagnostic) => diagnostic.code),
      }),
      claimIds: deterministicFallback.claims.map((claim) => claim.id),
      diagnosticCodes: diagnostics.map((diagnostic) => diagnostic.code),
      fallback: 'deterministic_source_evidence',
      fallbackReason: input.fallbackReason,
      fallbackReasonCode: input.fallbackReasonCode,
    },
    claims: deterministicFallback.claims,
    diagnostics,
  });

  await input.store.transitionState({
    sessionId: input.sessionId,
    toState: 'EVALUATED',
    reason: 'PIPE produced a conservative source-backed assessment report from captured evidence.',
    createdBy: 'repo-task-assessment-evaluator',
  });

  return { kind: 'evaluated', report };
}

export async function evaluateRepoTaskAssessmentSession(
  input: EvaluateRepoTaskAssessmentInput,
): Promise<RepoTaskAssessmentEvaluationResult> {
  const session = await input.store.loadSession(input.sessionId);
  const sourceRefs = await loadSessionSourceRefs(input.db, input.sessionId);
  const sourceRefByKey = new Map(sourceRefs.map((ref) => [ref.key, ref]));
  const evidenceCoverage = buildEvidenceCoverage(sourceRefs);
  const progress = await input.store.loadProgress(input.sessionId);

  if (!hasRequiredEvidence(sourceRefs)) {
    const missingChallengeFields = challengePacketContractMissingFields(sourceRefs);
    return createDiagnostic({
      store: input.store,
      sessionId: input.sessionId,
      diagnostic: diagnosticInput({
        code: 'PROVENANCE_INCOMPLETE',
        message: 'Assessment evaluation requires a complete assigned challenge packet plus exact git_commit and code_diff evidence before scoring.',
        sourceRefs: [input.requestSourceRef],
        details: {
          scheduledInterviewId: input.scheduledInterviewId,
          sourceRefCount: sourceRefs.length,
          missingChallengePacketFields: missingChallengeFields,
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
    evidenceCoverage,
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
    const completionPromise = provider.complete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { forceJson: true, maxTokens: 4096 });
    completionPromise.catch(() => undefined);
    const completion = await withAiTimeout(
      completionPromise,
      configuredAiEvaluationTimeoutMs(input.env),
    );
    rawResponse = completion.content ?? '';
  } catch (error) {
    if (error instanceof RepoTaskAiTimeoutError) {
      const fallback = await createDeterministicFallbackReport({
        store: input.store,
        sessionId: input.sessionId,
        sessionMode: session.mode,
        scheduledInterviewId: input.scheduledInterviewId,
        requestEventId: input.requestEventId,
        requestSourceRef: input.requestSourceRef,
        progress,
        sourceRefs,
        evidenceCoverage,
        provider,
        rawResponse,
        fallbackReason: 'The AI evaluator exceeded the Worker time budget after source-backed evidence was captured.',
        fallbackReasonCode: 'MODEL_RESPONSE_TIMEOUT',
        diagnostics: [
          diagnosticInput({
            code: 'MODEL_RESPONSE_TIMEOUT',
            severity: 'warning',
            message: `The AI evaluator exceeded ${error.timeoutMs}ms, so PIPE generated conservative claims only from captured source evidence.`,
            provider: provider.name,
            retryable: true,
            sourceRefs: [input.requestSourceRef],
            details: {
              scheduledInterviewId: input.scheduledInterviewId,
              model: provider.model,
              timeoutMs: error.timeoutMs,
              fallback: 'deterministic_source_evidence',
            },
          }),
        ],
      });
      if (fallback) return fallback;
    }
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

  await recordAiInteraction({
    store: input.store,
    sessionId: input.sessionId,
    requestedAt: input.requestedAt,
    requestedBy: input.requestedBy,
    provider,
    prompt: promptTrace,
    response: rawResponse,
    evidenceCoverage,
  });

  try {
    aiOutput = parseAiJson(rawResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = await createDeterministicFallbackReport({
      store: input.store,
      sessionId: input.sessionId,
      sessionMode: session.mode,
      scheduledInterviewId: input.scheduledInterviewId,
      requestEventId: input.requestEventId,
      requestSourceRef: input.requestSourceRef,
      progress,
      sourceRefs,
      evidenceCoverage,
      provider,
      rawResponse,
      fallbackReason: 'The AI evaluator returned unparseable text after source-backed evidence was captured.',
      fallbackReasonCode: 'MODEL_RESPONSE_UNPARSEABLE',
      diagnostics: [
        diagnosticInput({
          code: 'MODEL_RESPONSE_UNPARSEABLE',
          severity: 'warning',
          message: `The AI evaluator response could not be parsed, so PIPE generated conservative claims only from captured source evidence: ${message}`,
          provider: provider.name,
          retryable: false,
          sourceRefs: [input.requestSourceRef],
          details: {
            scheduledInterviewId: input.scheduledInterviewId,
            model: provider.model,
            fallback: 'deterministic_source_evidence',
          },
        }),
      ],
    });
    if (fallback) return fallback;

    return createDiagnostic({
      store: input.store,
      sessionId: input.sessionId,
      diagnostic: diagnosticInput({
        code: 'EVALUATION_NEEDS_HUMAN_REVIEW',
        message: `The AI evaluator response could not be parsed and PIPE could not build a deterministic evidence report: ${message}`,
        sourceRefs: [input.requestSourceRef],
        details: {
          scheduledInterviewId: input.scheduledInterviewId,
          model: provider.model,
        },
      }),
    });
  }

  const normalizedClaims = normalizeAiClaims(aiOutput.claims, sourceRefByKey, input.sessionId);
  const claims = normalizedClaims.claims;
  const diagnostics = dedupeDiagnostics([
    ...normalizedClaims.diagnostics,
    ...normalizeAiDiagnostics(aiOutput.diagnostics, sourceRefByKey),
    ...[missingVerificationDiagnostic(sourceRefs)].filter((diagnostic): diagnostic is AssessmentDiagnosticInput => Boolean(diagnostic)),
  ]);
  const normalizedRecommendation = normalizeAiRecommendation(aiOutput.recommendation);
  const recommendationDiagnosticsSeed = dedupeDiagnostics([
    ...diagnostics,
    ...normalizedRecommendation.diagnostics,
  ]);
  const cappedRecommendation = evidenceCappedRecommendation({
    recommendation: normalizedRecommendation.recommendation,
    claims,
    diagnostics: recommendationDiagnosticsSeed,
    sessionSourceRefs: sourceRefs,
  });
  const groundedClaims = claims.filter((claim) => claim.polarity !== 'diagnostic');
  if (groundedClaims.length === 0) {
    const fallback = await createDeterministicFallbackReport({
      store: input.store,
      sessionId: input.sessionId,
      sessionMode: session.mode,
      scheduledInterviewId: input.scheduledInterviewId,
      requestEventId: input.requestEventId,
      requestSourceRef: input.requestSourceRef,
      progress,
      sourceRefs,
      evidenceCoverage,
      provider,
      rawResponse,
      fallbackReason: 'The AI evaluator returned no usable non-diagnostic claims backed by exact source evidence.',
      fallbackReasonCode: 'MODEL_CLAIMS_UNUSABLE',
      diagnostics: [
        ...recommendationDiagnosticsSeed,
        ...cappedRecommendation.diagnostics,
      ],
    });
    if (fallback) return fallback;

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

  const summary = sourceBackedEvaluationSummary(aiOutput.summary, sourceRefs);
  const challengeFocus = challengeFocusSummary(sourceRefs);
  const recommendation = cappedRecommendation.recommendation;
  const reportDiagnostics = dedupeDiagnostics([
    ...recommendationDiagnosticsSeed,
    ...cappedRecommendation.diagnostics,
  ]);
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
      challengeFocus,
      evidenceCoverage,
      reviewPacket: buildReviewPacketOutput({
        progress,
        sourceRefs,
        evidenceCoverage,
        scheduledInterviewId: input.scheduledInterviewId,
        requestEventId: input.requestEventId,
        recommendation,
        claimIds: claims.map((claim) => claim.id),
        diagnosticCodes: reportDiagnostics.map((diagnostic) => diagnostic.code),
      }),
      claimIds: claims.map((claim) => claim.id),
      diagnosticCodes: reportDiagnostics.map((diagnostic) => diagnostic.code),
    },
    claims,
    diagnostics: reportDiagnostics,
  });

  await input.store.transitionState({
    sessionId: input.sessionId,
    toState: 'EVALUATED',
    reason: 'AI evaluator produced source-backed assessment claims.',
    createdBy: 'repo-task-assessment-evaluator',
  });

  return { kind: 'evaluated', report };
}

export interface ProcessStaleRepoTaskAssessmentEvaluationsResult {
  scanned: number;
  evaluated: number;
  diagnostics: number;
  failed: number;
}

export async function processStaleRepoTaskAssessmentEvaluations(
  env: {
    DB: D1Database;
    AI?: Ai;
    CLOUDFLARE_AI_MODEL?: string;
    REPO_TASK_EVALUATOR_AI_TIMEOUT_MS?: string;
  },
  options: {
    staleMs?: number;
    limit?: number;
    now?: string;
  } = {},
): Promise<ProcessStaleRepoTaskAssessmentEvaluationsResult> {
  const now = options.now ?? new Date().toISOString();
  const staleMs = Number.isFinite(options.staleMs) && options.staleMs !== undefined
    ? Math.max(0, options.staleMs)
    : DEFAULT_STALE_EVALUATION_MS;
  const limit = Number.isInteger(options.limit) && options.limit !== undefined
    ? Math.max(1, Math.min(10, options.limit))
    : DEFAULT_STALE_EVALUATION_LIMIT;
  const staleBefore = new Date(Date.parse(now) - staleMs).toISOString();
  const rows = await env.DB.prepare(
    `SELECT s.id AS session_id,
            s.interview_id,
            e.id AS request_event_id,
            e.actor_id AS requested_by,
            e.occurred_at AS requested_at,
            sr.source_ref_type,
            sr.source_ref_id,
            sr.source_span_id,
            sr.evidence_role,
            sr.locator_json,
            sr.exact_text,
            sr.content_hash,
            sr.metadata_json
       FROM assessment_sessions s
       JOIN assessment_evidence_events e
         ON e.session_id = s.id
        AND e.kind = 'recruiter_note'
       JOIN assessment_event_source_refs sr
         ON sr.event_id = e.id
        AND sr.source_ref_type = 'assessment_evaluation_request'
      WHERE s.state IN ('EVALUATING', 'EVALUATION_PENDING')
        AND s.updated_at <= ?1
        AND NOT EXISTS (
          SELECT 1
            FROM assessment_evaluation_reports r
           WHERE r.session_id = s.id
             AND r.status = 'EVALUATED'
        )
      ORDER BY s.updated_at ASC
      LIMIT ?2`,
  ).bind(staleBefore, limit).all<{
    session_id: string;
    interview_id: string | null;
    request_event_id: string;
    requested_by: string | null;
    requested_at: string | null;
    source_ref_type: string;
    source_ref_id: string;
    source_span_id: string | null;
    evidence_role: string | null;
    locator_json: string | null;
    exact_text: string | null;
    content_hash: string | null;
    metadata_json: string | null;
  }>();

  const store = new RepoTaskInterviewSessionStore(env.DB);
  let evaluated = 0;
  let diagnostics = 0;
  let failed = 0;

  for (const row of rows.results ?? []) {
    const requestSourceRef: AssessmentEvidenceSourceRefInput = {
      sourceRefType: row.source_ref_type,
      sourceRefId: row.source_ref_id,
      sourceSpanId: row.source_span_id,
      evidenceRole: row.evidence_role ?? 'evaluation_request',
      locator: parseJsonObject(row.locator_json),
      exactText: row.exact_text,
      contentHash: row.content_hash,
      metadata: parseJsonObject(row.metadata_json),
    };

    try {
      const result = await evaluateRepoTaskAssessmentSession({
        db: env.DB,
        store,
        env,
        sessionId: row.session_id,
        scheduledInterviewId: row.interview_id ?? row.session_id,
        requestedBy: row.requested_by ?? 'scheduled-assessment-evaluator',
        requestedAt: row.requested_at ?? now,
        requestEventId: row.request_event_id,
        requestSourceRef,
      });
      if (result.kind === 'evaluated') evaluated += 1;
      else diagnostics += 1;
    } catch (error) {
      failed += 1;
      console.error('[repoTaskAssessmentEvaluator/processStale] failed:', {
        sessionId: row.session_id,
        interviewId: row.interview_id,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await store.transitionState({
          sessionId: row.session_id,
          toState: 'DIAGNOSTIC',
          reason: 'Scheduled source-backed assessment evaluation recovery failed.',
          eventId: row.request_event_id,
          createdBy: 'scheduled-assessment-evaluator',
        });
      } catch (transitionError) {
        console.error('[repoTaskAssessmentEvaluator/processStale] diagnostic transition failed:', {
          sessionId: row.session_id,
          error: transitionError instanceof Error ? transitionError.message : String(transitionError),
        });
      }
    }
  }

  return {
    scanned: rows.results?.length ?? 0,
    evaluated,
    diagnostics,
    failed,
  };
}
