/**
 * codeReviewFollowUpAgent Lambda Handler
 *
 * Triggered by the generateCodeReviewFollowUps AppSync mutation.
 *
 * Steps:
 * 1. Validate input (assessmentId)
 * 2. Fetch Assessment from DynamoDB
 * 3. Fetch linked Challenge from DynamoDB
 * 4. Build Claude prompt from candidate annotations + challenge context
 * 5. Call Claude to generate exactly 5 SHORT_ANSWER follow-up questions
 * 6. Save questions to Assessment.followUpQuestionsJson
 * 7. Return questions
 */

import Anthropic from '@anthropic-ai/sdk';
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
  ClaudeQuestionsOutput,
} from './types';
import { validateInput, sanitizeForPrompt } from './validation';
import { createCostTracker, trackCost, getCostingSummary } from './costTracker';
import { buildSystemPrompt, buildUserPrompt } from './prompts';

// ─── Clients ─────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const dynamo = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

// ─── Config ───────────────────────────────────────────────────────────────────

const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME ?? 'Assessment';
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE_NAME ?? 'Challenge';
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-20250514';
const MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS ?? '2048', 10);

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

  // Step 5: Call Claude
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

function extractCodeContext(challenge: ChallengeRecord | null): string {
  if (!challenge) return 'No code context available.';

  // Try serverConfig for ground truth hints
  let context = '';

  if (challenge.config) {
    try {
      const config = typeof challenge.config === 'string'
        ? JSON.parse(challenge.config)
        : challenge.config;

      if (config && typeof config === 'object') {
        const c = config as Record<string, unknown>;
        if (typeof c['codeSnippet'] === 'string') {
          context = c['codeSnippet'] as string;
        } else if (typeof c['diff'] === 'string') {
          context = c['diff'] as string;
        } else if (typeof c['code'] === 'string') {
          context = c['code'] as string;
        }
      }
    } catch {
      // No code context from config
    }
  }

  if (!context && challenge.serverConfig) {
    try {
      const sc = typeof challenge.serverConfig === 'string'
        ? JSON.parse(challenge.serverConfig)
        : challenge.serverConfig;

      if (sc && typeof sc === 'object') {
        const s = sc as Record<string, unknown>;
        if (typeof s['codeSnippet'] === 'string') {
          context = s['codeSnippet'] as string;
        }
      }
    } catch {
      // No code context from serverConfig
    }
  }

  return sanitizeForPrompt(context || 'No code snippet available in challenge config.', 6000);
}

// ─── Claude Question Generation ───────────────────────────────────────────────

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

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  trackCost(costTracker, message.usage.input_tokens, message.usage.output_tokens);

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('UNEXPECTED_RESPONSE_TYPE: Expected text from Claude');
  }

  let parsed: ClaudeQuestionsOutput;
  try {
    // Strip markdown fences if present (defensive)
    const cleaned = content.text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned) as ClaudeQuestionsOutput;
  } catch (err) {
    console.error('[CodeReviewFollowUpAgent] Failed to parse Claude response:', content.text);
    throw new Error('PARSE_FAILED: Claude did not return valid JSON');
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
