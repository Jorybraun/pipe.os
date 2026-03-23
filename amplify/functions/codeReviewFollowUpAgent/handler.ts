/**
 * Follow-Up Agent Lambda Handler
 *
 * Triggered by the generateFollowUps AppSync mutation.
 *
 * Steps:
 * 1. Validate input (assessmentId)
 * 2. Fetch Assessment from DynamoDB
 * 3. Fetch linked Challenge from DynamoDB
 * 4. Route to correct prompt strategy based on challenge.type
 * 5. Call Mistral to generate exactly 5 SHORT_ANSWER follow-up questions
 * 6. Save questions to Assessment.followUpQuestionsJson
 * 7. Return questions
 */

import { Mistral } from '@mistralai/mistralai';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand, ReturnValue } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuid } from 'uuid';

import type {
  FollowUpAgentOutput,
  FollowUpQuestion,
  FollowUpQuestionsJson,
  CandidateAnnotation,
  AssessmentRecord,
  ChallengeRecord,
  CachedDiffJson,
  DiffFile,
  ModelQuestionsOutput,
} from './types';
import { validateInput, sanitizeForPrompt } from './validation';
import { createCostTracker, trackCost, getCostingSummary } from './costTracker';
import { buildSystemPrompt, buildUserPrompt, type FollowUpContext } from './prompts';

// ─── Clients ─────────────────────────────────────────────────────────────────

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY!,
});

const dynamo = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

// ─── Config ───────────────────────────────────────────────────────────────────

const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME ?? 'Assessment';
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE_NAME ?? 'Challenge';
const MISTRAL_AGENT_ID = process.env.MISTRAL_AGENT_ID ?? '';
const MODEL = process.env.MISTRAL_MODEL ?? 'mistral-large-latest';
const MAX_TOKENS = parseInt(process.env.MODEL_MAX_TOKENS ?? '2048', 10);

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handler(event: unknown): Promise<FollowUpAgentOutput> {
  const startTime = Date.now();
  console.log('[FollowUpAgent] Invoked', { event: JSON.stringify(event) });

  const costTracker = createCostTracker(
    parseFloat(process.env.COST_BUDGET_PER_SESSION ?? '0.10')
  );

  // Step 1: Validate
  const { assessmentId } = validateInput(event);
  console.log('[FollowUpAgent] assessmentId:', assessmentId);

  // Step 2: Fetch Assessment
  const assessment = await fetchAssessment(assessmentId);
  if (!assessment) {
    throw new Error(`ASSESSMENT_NOT_FOUND: ${assessmentId}`);
  }

  // Step 3: Fetch Challenge
  const challenge = assessment.challengeId ? await fetchChallenge(assessment.challengeId) : null;
  const challengeType = challenge?.type ?? 'CODE_REVIEW';

  console.log('[FollowUpAgent] challengeType:', challengeType, '  challengeId:', assessment.challengeId);

  if (!challenge) {
    console.warn('[FollowUpAgent] Challenge not found — using minimal context');
  }

  // Step 4: Build prompt context based on challenge type
  const ctx = buildPromptContext(challengeType, assessment, challenge);

  console.log('[FollowUpAgent] Context built for type:', challengeType);

  // Step 5: Call Mistral
  const questions = await generateQuestions(challengeType, ctx, costTracker);

  console.log('[FollowUpAgent] Generated', { questionCount: questions.length });

  // Step 6: Save to Assessment
  await saveQuestions(assessmentId, questions);
  console.log('[FollowUpAgent] Questions saved');

  const processingTime = Date.now() - startTime;
  console.log('[FollowUpAgent] Done', {
    processingTime,
    cost: costTracker.estimatedCost.toFixed(4),
  });

  return {
    questions,
    costTracking: getCostingSummary(costTracker),
    processingTime,
  };
}

// ─── Context Router ────────────────────────────────────────────────────────────

/**
 * Extracts all prompt context from the assessment + challenge record,
 * dispatching on challenge type for type-specific fields.
 */
function buildPromptContext(
  challengeType: string,
  assessment: AssessmentRecord,
  challenge: ChallengeRecord | null
): FollowUpContext {
  const challengeTitle = sanitizeForPrompt(challenge?.title ?? 'Challenge', 100);
  const challengeInstructions = sanitizeForPrompt(
    (challenge?.instructions as string | undefined) ?? 'Complete the challenge.',
    500
  );

  const base: FollowUpContext = { challengeTitle, challengeInstructions, codeContext: '' };

  switch (challengeType) {
    case 'CODE_REVIEW':
      return buildCodeReviewContext(base, assessment, challenge);
    case 'CODE_IMPLEMENTATION':
      return buildCodeImplContext(base, assessment, challenge);
    case 'QUIZ_MCQ':
      return buildMcqContext(base, assessment, challenge);
    case 'QUIZ_SHORT_ANSWER':
      return buildShortAnswerContext(base, assessment, challenge);
    default:
      return buildCodeReviewContext(base, assessment, challenge);
  }
}

// ─── Per-Type Context Builders ────────────────────────────────────────────────

function buildCodeReviewContext(
  base: FollowUpContext,
  assessment: AssessmentRecord,
  challenge: ChallengeRecord | null
): FollowUpContext {
  const { annotations, verdict, summary } = extractCodeReviewData(assessment);
  const codeContext = extractDiffContext(challenge);
  return { ...base, codeContext, annotations, verdict, summary };
}

function buildCodeImplContext(
  base: FollowUpContext,
  assessment: AssessmentRecord,
  challenge: ChallengeRecord | null
): FollowUpContext {
  let submittedCode = '';
  if (assessment.submission) {
    try {
      const sub = typeof assessment.submission === 'string'
        ? JSON.parse(assessment.submission)
        : assessment.submission;
      if (sub && typeof sub === 'object') {
        const s = sub as Record<string, unknown>;
        if (typeof s['code'] === 'string') submittedCode = sanitizeForPrompt(s['code'], 4000);
      }
    } catch { /* ignore */ }
  }

  // Starter code as fallback codeContext for "what they had to work with"
  const codeContext = extractConfigCode(challenge);
  return { ...base, codeContext, submittedCode };
}

function buildMcqContext(
  base: FollowUpContext,
  assessment: AssessmentRecord,
  challenge: ChallengeRecord | null
): FollowUpContext {
  let selectedOption = '';
  let questionText = base.challengeInstructions;
  let options: string[] = [];

  // Extract question text and options from challenge config
  if (challenge?.config) {
    try {
      const config = typeof challenge.config === 'string'
        ? JSON.parse(challenge.config)
        : challenge.config;
      const c = config as Record<string, unknown>;
      if (typeof c['question'] === 'string') questionText = sanitizeForPrompt(c['question'], 500);
      if (Array.isArray(c['options'])) {
        options = (c['options'] as unknown[]).map(o =>
          typeof o === 'string' ? o : typeof o === 'object' && o !== null
            ? sanitizeForPrompt(String((o as Record<string, unknown>)['text'] ?? ''), 200)
            : ''
        ).filter(Boolean);
      }
    } catch { /* ignore */ }
  }

  // Extract selected option from submission
  if (assessment.submission) {
    try {
      const sub = typeof assessment.submission === 'string'
        ? JSON.parse(assessment.submission)
        : assessment.submission;
      const s = sub as Record<string, unknown>;
      const answers = s['answers'] as Record<string, string> | undefined;
      if (answers?.['current']) {
        const idx = parseInt(answers['current'], 10);
        selectedOption = isNaN(idx) ? answers['current'] : (options[idx] ?? answers['current']);
      }
    } catch { /* ignore */ }
  }

  return { ...base, codeContext: '', questionText, selectedOption, options };
}

function buildShortAnswerContext(
  base: FollowUpContext,
  assessment: AssessmentRecord,
  challenge: ChallengeRecord | null
): FollowUpContext {
  let answerText = '';
  let questionText = base.challengeInstructions;

  if (challenge?.config) {
    try {
      const config = typeof challenge.config === 'string'
        ? JSON.parse(challenge.config)
        : challenge.config;
      const c = config as Record<string, unknown>;
      if (typeof c['question'] === 'string') questionText = sanitizeForPrompt(c['question'], 500);
    } catch { /* ignore */ }
  }

  if (assessment.submission) {
    try {
      const sub = typeof assessment.submission === 'string'
        ? JSON.parse(assessment.submission)
        : assessment.submission;
      const s = sub as Record<string, unknown>;
      if (typeof s['text'] === 'string') answerText = sanitizeForPrompt(s['text'], 2000);
    } catch { /* ignore */ }
  }

  return { ...base, codeContext: '', questionText, answerText };
}

// ─── DynamoDB Helpers ─────────────────────────────────────────────────────────

async function fetchAssessment(assessmentId: string): Promise<AssessmentRecord | null> {
  const response = await dynamo.send(new GetItemCommand({
    TableName: ASSESSMENT_TABLE,
    Key: marshall({ id: assessmentId }),
  }));
  if (!response.Item) return null;
  return unmarshall(response.Item) as AssessmentRecord;
}

async function fetchChallenge(challengeId: string): Promise<ChallengeRecord | null> {
  const response = await dynamo.send(new GetItemCommand({
    TableName: CHALLENGE_TABLE,
    Key: marshall({ id: challengeId }),
  }));
  if (!response.Item) return null;
  return unmarshall(response.Item) as ChallengeRecord;
}

async function saveQuestions(assessmentId: string, questions: FollowUpQuestion[]): Promise<void> {
  const followUpQuestionsJson: FollowUpQuestionsJson = {
    questions,
    answers: [],
    generatedAt: new Date().toISOString(),
  };
  await dynamo.send(new UpdateItemCommand({
    TableName: ASSESSMENT_TABLE,
    Key: marshall({ id: assessmentId }),
    UpdateExpression: 'SET followUpQuestionsJson = :fq',
    ExpressionAttributeValues: marshall({ ':fq': JSON.stringify(followUpQuestionsJson) }),
    ReturnValues: ReturnValue.NONE,
  }));
}

// ─── Data Extraction Helpers ──────────────────────────────────────────────────

function extractCodeReviewData(assessment: AssessmentRecord): {
  annotations: CandidateAnnotation[];
  verdict: string;
  summary: string;
} {
  let annotations: CandidateAnnotation[] = [];
  let verdict = 'comment';
  let summary = '';

  if (assessment.codeReviewAnnotations) {
    try {
      const raw = typeof assessment.codeReviewAnnotations === 'string'
        ? JSON.parse(assessment.codeReviewAnnotations)
        : assessment.codeReviewAnnotations;
      if (Array.isArray(raw)) annotations = raw as CandidateAnnotation[];
    } catch { /* ignore */ }
  }

  if (annotations.length === 0 && assessment.submission) {
    try {
      const sub = typeof assessment.submission === 'string'
        ? JSON.parse(assessment.submission)
        : assessment.submission;
      if (sub && typeof sub === 'object') {
        const s = sub as Record<string, unknown>;
        if (Array.isArray(s['annotations'])) annotations = s['annotations'] as CandidateAnnotation[];
        if (typeof s['verdict'] === 'string') verdict = s['verdict'];
        if (typeof s['summary'] === 'string') summary = s['summary'];
      }
    } catch { /* ignore */ }
  }

  if (assessment.codeReviewSummary) summary = assessment.codeReviewSummary;

  summary = sanitizeForPrompt(summary, 1000);
  annotations = annotations.map(a => ({
    ...a,
    comment: sanitizeForPrompt(a.comment ?? '', 300),
  }));

  return { annotations, verdict, summary };
}

function renderDiffFile(file: DiffFile): string {
  const lines: string[] = [`--- a/${file.path}`, `+++ b/${file.path}`];
  for (const hunk of file.hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';
      lines.push(`${prefix} ${line.content}`);
    }
  }
  return lines.join('\n');
}

function extractDiffContext(challenge: ChallengeRecord | null): string {
  if (!challenge) return 'No code context available.';

  if (challenge.cachedDiffJson) {
    try {
      const raw = typeof challenge.cachedDiffJson === 'string'
        ? JSON.parse(challenge.cachedDiffJson)
        : challenge.cachedDiffJson;
      const diff = raw as CachedDiffJson;
      if (diff && Array.isArray(diff.files) && diff.files.length > 0) {
        return sanitizeForPrompt(diff.files.map(renderDiffFile).join('\n\n'), 6000);
      }
    } catch { /* ignore */ }
  }

  return extractConfigCode(challenge) || 'No code snippet available.';
}

function extractConfigCode(challenge: ChallengeRecord | null): string {
  if (!challenge?.config) return '';
  try {
    const c = (typeof challenge.config === 'string'
      ? JSON.parse(challenge.config)
      : challenge.config) as Record<string, unknown>;
    for (const key of ['codeSnippet', 'starterCode', 'diff', 'code']) {
      if (typeof c[key] === 'string') return sanitizeForPrompt(c[key] as string, 4000);
    }
  } catch { /* ignore */ }
  return '';
}

// ─── Mistral Question Generation ──────────────────────────────────────────────

async function generateQuestions(
  challengeType: string,
  ctx: FollowUpContext,
  costTracker: ReturnType<typeof createCostTracker>
): Promise<FollowUpQuestion[]> {
  const systemPrompt = buildSystemPrompt(challengeType);
  const userPrompt = buildUserPrompt(challengeType, ctx);

  const response = MISTRAL_AGENT_ID
    ? await mistral.agents.complete({
        agentId: MISTRAL_AGENT_ID,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        responseFormat: { type: 'json_object' },
      })
    : await mistral.chat.complete({
        model: MODEL,
        maxTokens: MAX_TOKENS,
        responseFormat: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

  trackCost(
    costTracker,
    response.usage?.promptTokens ?? 0,
    response.usage?.completionTokens ?? 0
  );

  const rawContent = response.choices?.[0]?.message?.content;
  const text = typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map((c) => ('text' in c ? (c as { text: string }).text : '')).join('')
      : '';

  if (!text) throw new Error('UNEXPECTED_RESPONSE_TYPE: Expected text from Mistral');

  let parsed: ModelQuestionsOutput;
  try {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned) as ModelQuestionsOutput;
  } catch (err) {
    console.error('[FollowUpAgent] Failed to parse Mistral response:', text);
    throw new Error('PARSE_FAILED: Model did not return valid JSON');
  }

  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error('INVALID_RESPONSE: questions array missing or empty');
  }

  const questions: FollowUpQuestion[] = parsed.questions.slice(0, 5).map((q, i) => ({
    id: q.id ?? uuid(),
    type: 'SHORT_ANSWER' as const,
    question: sanitizeForPrompt(q.question ?? `Question ${i + 1}`, 500),
    context: sanitizeForPrompt(q.context ?? '', 200),
  }));

  while (questions.length < 5) {
    questions.push({
      id: uuid(),
      type: 'SHORT_ANSWER',
      question: `Can you walk through your overall approach to this challenge?`,
      context: `General reasoning`,
    });
    console.warn('[FollowUpAgent] Padded question', questions.length);
  }

  return questions;
}
