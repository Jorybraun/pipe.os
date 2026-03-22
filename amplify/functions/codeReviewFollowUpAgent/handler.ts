/**
 * codeReviewFollowUpAgent Lambda Handler
 *
 * Triggered by the generateCodeReviewFollowUps AppSync mutation.
 *
 * Steps:
 * 1. Validate input (assessmentId)
 * 2. Fetch Assessment from DynamoDB
 * 3. Fetch linked Challenge from DynamoDB
 * 4. Build prompt from candidate annotations + challenge context
 * 5. Call Mistral on Amazon Bedrock to generate exactly 5 SHORT_ANSWER follow-up questions
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
import { buildSystemPrompt, buildUserPrompt } from './prompts';

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
  console.log('[CodeReviewFollowUpAgent] Invoked', { event: JSON.stringify(event) });

  const costTracker = createCostTracker(
    parseFloat(process.env.COST_BUDGET_PER_SESSION ?? '0.10')
  );

  // Step 1: Validate
  const { assessmentId } = validateInput(event);
  console.log('[CodeReviewFollowUpAgent] assessmentId:', assessmentId);

  // Step 2: Fetch Assessment
  const assessment = await fetchAssessment(assessmentId);
  if (!assessment) {
    throw new Error(`ASSESSMENT_NOT_FOUND: ${assessmentId}`);
  }
  console.log('[CodeReviewFollowUpAgent] Assessment loaded, challengeId:', assessment.challengeId);

  // Step 3: Fetch Challenge
  const challenge = assessment.challengeId ? await fetchChallenge(assessment.challengeId) : null;
  if (!challenge) {
    console.warn('[CodeReviewFollowUpAgent] Challenge not found — using minimal context');
  }

  // Step 4: Extract candidate review data
  const { annotations, verdict, summary } = extractReviewData(assessment);
  const codeContext = extractCodeContext(challenge);
  const challengeTitle = sanitizeForPrompt(challenge?.title ?? 'Code Review Challenge', 100);
  const challengeInstructions = sanitizeForPrompt(
    (challenge?.instructions as string | undefined) ?? 'Review the code and identify any bugs or issues.',
    500
  );

  console.log('[CodeReviewFollowUpAgent] Extracted', {
    annotationCount: annotations.length,
    verdict,
    codeContextLength: codeContext.length,
  });

  // Step 5: Call Mistral on Bedrock
  const questions = await generateQuestions(
    challengeTitle,
    challengeInstructions,
    codeContext,
    annotations,
    verdict,
    summary,
    costTracker
  );

  console.log('[CodeReviewFollowUpAgent] Generated', { questionCount: questions.length });

  // Step 6: Save to Assessment
  await saveQuestions(assessmentId, questions);
  console.log('[CodeReviewFollowUpAgent] Questions saved to Assessment');

  const processingTime = Date.now() - startTime;
  console.log('[CodeReviewFollowUpAgent] Done', {
    processingTime,
    cost: costTracker.estimatedCost.toFixed(4),
  });

  return {
    questions,
    costTracking: getCostingSummary(costTracker),
    processingTime,
  };
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

async function saveQuestions(
  assessmentId: string,
  questions: FollowUpQuestion[]
): Promise<void> {
  const followUpQuestionsJson: FollowUpQuestionsJson = {
    questions,
    answers: [],
    generatedAt: new Date().toISOString(),
  };

  await dynamo.send(new UpdateItemCommand({
    TableName: ASSESSMENT_TABLE,
    Key: marshall({ id: assessmentId }),
    UpdateExpression: 'SET followUpQuestionsJson = :fq',
    ExpressionAttributeValues: marshall({
      ':fq': JSON.stringify(followUpQuestionsJson),
    }),
    ReturnValues: ReturnValue.NONE,
  }));
}

// ─── Data Extraction Helpers ──────────────────────────────────────────────────

interface ReviewData {
  annotations: CandidateAnnotation[];
  verdict: string;
  summary: string;
}

function extractReviewData(assessment: AssessmentRecord): ReviewData {
  let annotations: CandidateAnnotation[] = [];
  let verdict = 'comment';
  let summary = '';

  // Try new-style codeReviewAnnotations field first
  if (assessment.codeReviewAnnotations) {
    try {
      const raw = typeof assessment.codeReviewAnnotations === 'string'
        ? JSON.parse(assessment.codeReviewAnnotations)
        : assessment.codeReviewAnnotations;

      if (Array.isArray(raw)) {
        annotations = raw as CandidateAnnotation[];
      }
    } catch {
      console.warn('[CodeReviewFollowUpAgent] Failed to parse codeReviewAnnotations');
    }
  }

  // Fall back to submission.annotations
  if (annotations.length === 0 && assessment.submission) {
    try {
      const submission = typeof assessment.submission === 'string'
        ? JSON.parse(assessment.submission)
        : assessment.submission;

      if (submission && typeof submission === 'object') {
        const sub = submission as Record<string, unknown>;
        if (Array.isArray(sub['annotations'])) {
          annotations = sub['annotations'] as CandidateAnnotation[];
        }
        if (typeof sub['verdict'] === 'string') {
          verdict = sub['verdict'];
        }
        if (typeof sub['summary'] === 'string') {
          summary = sub['summary'];
        }
      }
    } catch {
      console.warn('[CodeReviewFollowUpAgent] Failed to parse submission');
    }
  }

  if (assessment.codeReviewSummary) {
    summary = assessment.codeReviewSummary;
  }

  // Sanitize all string fields
  summary = sanitizeForPrompt(summary, 1000);
  annotations = annotations.map(a => ({
    ...a,
    comment: sanitizeForPrompt(a.comment ?? '', 300),
  }));

  return { annotations, verdict, summary };
}

/**
 * Renders a cachedDiffJson file as a unified-diff-style string for the prompt.
 */
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

function extractCodeContext(challenge: ChallengeRecord | null): string {
  if (!challenge) return 'No code context available.';

  // 1. Prefer cachedDiffJson — this is the actual diff shown to the candidate
  if (challenge.cachedDiffJson) {
    try {
      const raw = typeof challenge.cachedDiffJson === 'string'
        ? JSON.parse(challenge.cachedDiffJson)
        : challenge.cachedDiffJson;

      const diff = raw as CachedDiffJson;
      if (diff && Array.isArray(diff.files) && diff.files.length > 0) {
        const rendered = diff.files
          .map((f) => renderDiffFile(f))
          .join('\n\n');
        return sanitizeForPrompt(rendered, 6000);
      }
    } catch {
      console.warn('[CodeReviewFollowUpAgent] Failed to parse cachedDiffJson');
    }
  }

  // 2. Fall back to config.codeSnippet / config.diff / config.code
  if (challenge.config) {
    try {
      const config = typeof challenge.config === 'string'
        ? JSON.parse(challenge.config)
        : challenge.config;

      if (config && typeof config === 'object') {
        const c = config as Record<string, unknown>;
        if (typeof c['codeSnippet'] === 'string') {
          return sanitizeForPrompt(c['codeSnippet'] as string, 6000);
        } else if (typeof c['diff'] === 'string') {
          return sanitizeForPrompt(c['diff'] as string, 6000);
        } else if (typeof c['code'] === 'string') {
          return sanitizeForPrompt(c['code'] as string, 6000);
        }
      }
    } catch {
      // No code context from config
    }
  }

  // 3. Fall back to serverConfig.codeSnippet
  if (challenge.serverConfig) {
    try {
      const sc = typeof challenge.serverConfig === 'string'
        ? JSON.parse(challenge.serverConfig)
        : challenge.serverConfig;

      if (sc && typeof sc === 'object') {
        const s = sc as Record<string, unknown>;
        if (typeof s['codeSnippet'] === 'string') {
          return sanitizeForPrompt(s['codeSnippet'] as string, 6000);
        }
      }
    } catch {
      // No code context from serverConfig
    }
  }

  return 'No code snippet available in challenge config.';
}

// ─── Bedrock / Mistral Question Generation ────────────────────────────────────

async function generateQuestions(
  challengeTitle: string,
  challengeInstructions: string,
  codeContext: string,
  annotations: CandidateAnnotation[],
  verdict: string,
  summary: string,
  costTracker: ReturnType<typeof createCostTracker>
): Promise<FollowUpQuestion[]> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(
    challengeTitle,
    challengeInstructions,
    codeContext,
    annotations,
    verdict,
    summary
  );

  // Use Mistral Agent when MISTRAL_AGENT_ID is configured (system prompt lives in the agent);
  // fall back to chat completion with inline system prompt.
  // responseFormat: json_object forces JSON output regardless of prompt compliance.
  const response = MISTRAL_AGENT_ID
    ? await mistral.agents.complete({
        agentId: MISTRAL_AGENT_ID,
        messages: [{ role: 'user', content: userPrompt }],
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

  if (!text) {
    throw new Error('UNEXPECTED_RESPONSE_TYPE: Expected text from Mistral');
  }

  let parsed: ModelQuestionsOutput;
  try {
    // Strip markdown fences if present (defensive)
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned) as ModelQuestionsOutput;
  } catch (err) {
    console.error('[CodeReviewFollowUpAgent] Failed to parse Mistral response:', text);
    throw new Error('PARSE_FAILED: Model did not return valid JSON');
  }

  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error('INVALID_RESPONSE: questions array missing or empty');
  }

  // Normalise to exactly 5 questions with stable IDs
  const questions: FollowUpQuestion[] = parsed.questions.slice(0, 5).map((q, i) => ({
    id: q.id ?? uuid(),
    type: 'SHORT_ANSWER' as const,
    question: sanitizeForPrompt(q.question ?? `Question ${i + 1}`, 500),
    context: sanitizeForPrompt(q.context ?? '', 200),
  }));

  // Pad to 5 if Claude returned fewer
  while (questions.length < 5) {
    const idx = questions.length + 1;
    questions.push({
      id: uuid(),
      type: 'SHORT_ANSWER',
      question: `Can you walk through your overall approach to this code review?`,
      context: `General reasoning`,
    });
    console.warn('[CodeReviewFollowUpAgent] Padded question', idx);
  }

  return questions;
}
