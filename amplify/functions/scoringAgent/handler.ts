/**
 * scoringAgent Lambda Handler (ADR-023)
 *
 * Triggered by the scoreChallengeSubmission AppSync mutation.
 *
 * Steps:
 * 1. Receive challengeSubmissionId
 * 2. Fetch ChallengeSubmission from DynamoDB (submission + challengeId + followUpQuestionsJson)
 * 3. Fetch linked Challenge from DynamoDB (serverConfig with ground truth)
 * 4. Score based on challenge type:
 *    - CODE_REVIEW with follow-up answers → agentic Mistral scoring (holistic)
 *    - CODE_REVIEW without follow-up answers → deterministic scoring (initial pass)
 *    - QUIZ_MCQ → deterministic scoring (objective)
 * 5. Update ChallengeSubmission.score and ChallengeSubmission.feedback
 * 6. Re-aggregate Assessment.score from all child ChallengeSubmissions
 * 7. Return { score, feedback }
 */

import { Mistral } from '@mistralai/mistralai';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand, ScanCommand, ReturnValue } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { scorer, scoreCodeImplementation } from './scorer';
import type { CodeReviewConfig, Bug, CodeImplPublicConfig, CodeImplServerConfig } from './types';

// ─── Clients ─────────────────────────────────────────────────────────────────

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY! });

const dynamo = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

// ─── Config ───────────────────────────────────────────────────────────────────

const CHALLENGE_SUBMISSION_TABLE = process.env.CHALLENGE_SUBMISSION_TABLE_NAME ?? 'ChallengeSubmission';
const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME ?? 'Assessment';
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE_NAME ?? 'Challenge';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL ?? 'mistral-large-latest';
const MAX_TOKENS = parseInt(process.env.MODEL_MAX_TOKENS ?? '800', 10);

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScoringResult {
  success: boolean;
  /** Score is intentionally omitted from the response to prevent candidates
   *  from seeing their score during the assessment. The score is written
   *  directly to DynamoDB — recruiters read it from there. */
  error?: string;
}

interface FollowUpAnswer {
  questionId: string;
  answer: string;
  answeredAt: string;
}

interface FollowUpQuestion {
  id: string;
  question: string;
  context?: string;
}

interface FollowUpQuestionsJson {
  questions: FollowUpQuestion[];
  answers: FollowUpAnswer[];
  generatedAt: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: unknown): Promise<ScoringResult> => {
  console.log('[ScoringAgent] Invoked', { event: JSON.stringify(event) });

  try {
    // Extract challengeSubmissionId from AppSync event
    const args = (event as Record<string, unknown>)['arguments'] as Record<string, unknown> | undefined;
    const challengeSubmissionId = (args?.['challengeSubmissionId'] ?? (event as Record<string, unknown>)['challengeSubmissionId']) as string | undefined;

    if (!challengeSubmissionId || typeof challengeSubmissionId !== 'string') {
      throw new Error('VALIDATION: challengeSubmissionId is required');
    }

    console.log('[ScoringAgent] challengeSubmissionId:', challengeSubmissionId);

    // Step 2: Fetch ChallengeSubmission
    const submissionResponse = await dynamo.send(new GetItemCommand({
      TableName: CHALLENGE_SUBMISSION_TABLE,
      Key: marshall({ id: challengeSubmissionId }),
    }));

    if (!submissionResponse.Item) {
      throw new Error(`CHALLENGE_SUBMISSION_NOT_FOUND: ${challengeSubmissionId}`);
    }

    const challengeSubmission = unmarshall(submissionResponse.Item) as Record<string, unknown>;
    const challengeId = challengeSubmission['challengeId'] as string | undefined;
    const assessmentId = challengeSubmission['assessmentId'] as string | undefined;
    const submissionRaw = challengeSubmission['submission'];
    const followUpRaw = challengeSubmission['followUpQuestionsJson'];
    const codeReviewSummary = challengeSubmission['codeReviewSummary'] as string | undefined;
    const codeReviewAnnotationsRaw = challengeSubmission['codeReviewAnnotations'];

    if (!challengeId) {
      console.warn('[ScoringAgent] No challengeId on ChallengeSubmission — cannot score');
      return { success: true };
    }

    // Step 3: Fetch Challenge
    const challengeResponse = await dynamo.send(new GetItemCommand({
      TableName: CHALLENGE_TABLE,
      Key: marshall({ id: challengeId }),
    }));

    if (!challengeResponse.Item) {
      console.warn('[ScoringAgent] Challenge not found:', challengeId);
      return { success: true };
    }

    const challenge = unmarshall(challengeResponse.Item) as Record<string, unknown>;
    const challengeType = challenge['type'] as string | undefined;
    const serverConfigRaw = challenge['serverConfig'];
    const challengeInstructions = (challenge['instructions'] as string | undefined) ?? '';

    if (!challengeType) {
      console.warn('[ScoringAgent] Challenge has no type');
      return { success: true };
    }

    // Step 4: Parse submission and serverConfig
    let submission: unknown = submissionRaw;
    if (typeof submissionRaw === 'string') {
      try { submission = JSON.parse(submissionRaw); } catch { /* keep raw */ }
    }

    let serverConfig: unknown = serverConfigRaw;
    if (typeof serverConfigRaw === 'string') {
      try { serverConfig = JSON.parse(serverConfigRaw); } catch { /* keep raw */ }
    }

    if (!serverConfig) {
      console.warn('[ScoringAgent] Missing serverConfig', { challengeType });
      return { success: true };
    }

    // Step 5: Score
    let score: number;
    let feedback: string;

    if (challengeType === 'CODE_REVIEW') {
      // Parse follow-up Q&A if present
      let followUpData: FollowUpQuestionsJson | null = null;
      if (followUpRaw) {
        try {
          const raw = typeof followUpRaw === 'string' ? JSON.parse(followUpRaw) : followUpRaw;
          if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>)['answers'])) {
            followUpData = raw as FollowUpQuestionsJson;
          }
        } catch {
          console.warn('[ScoringAgent] Failed to parse followUpQuestionsJson');
        }
      }

      const hasFollowUpAnswers = followUpData !== null && followUpData.answers.length > 0;

      if (hasFollowUpAnswers) {
        // Agentic scoring: Mistral evaluates submission + follow-up answers holistically
        console.log('[ScoringAgent] Running agentic CODE_REVIEW scoring with follow-up answers');

        // Parse codeReviewAnnotations (prefer explicit field over submission.annotations)
        let annotations: unknown[] = [];
        if (codeReviewAnnotationsRaw) {
          try {
            const parsed = typeof codeReviewAnnotationsRaw === 'string'
              ? JSON.parse(codeReviewAnnotationsRaw)
              : codeReviewAnnotationsRaw;
            if (Array.isArray(parsed)) annotations = parsed as unknown[];
          } catch { /* ignore */ }
        } else if (submission && typeof submission === 'object') {
          const sub = submission as Record<string, unknown>;
          if (Array.isArray(sub['annotations'])) {
            annotations = sub['annotations'] as unknown[];
          }
        }

        const verdict = (
          typeof submission === 'object' && submission !== null
            ? (submission as Record<string, unknown>)['verdict']
            : undefined
        ) as string | undefined;

        const summary = codeReviewSummary ?? (
          typeof submission === 'object' && submission !== null
            ? (submission as Record<string, unknown>)['summary']
            : undefined
        ) as string | undefined ?? '';

        const groundTruth: Bug[] = (serverConfig as CodeReviewConfig).groundTruth ?? [];

        // Extract code context for the prompt
        let codeContext = '';
        if (serverConfig && typeof serverConfig === 'object') {
          const sc = serverConfig as Record<string, unknown>;
          if (typeof sc['codeSnippet'] === 'string') codeContext = sc['codeSnippet'];
          else if (typeof sc['diff'] === 'string') codeContext = sc['diff'];
          else if (typeof sc['code'] === 'string') codeContext = sc['code'];
        }

        const result = await agenticScoreCodeReview({
          annotations,
          verdict: verdict ?? 'comment',
          summary,
          groundTruth,
          followUpData: followUpData!,
          challengeInstructions,
          codeContext,
        });

        score = result.score;
        feedback = result.feedback;
      } else {
        // No follow-up answers yet — deterministic preliminary score
        console.log('[ScoringAgent] Running deterministic CODE_REVIEW scoring (no follow-up answers yet)');
        score = scorer(challengeType, submission, serverConfig as CodeReviewConfig);
        feedback = buildFeedback(challengeType, score);
      }
    } else if (challengeType === 'CODE_IMPLEMENTATION') {
      // CODE_IMPLEMENTATION: execute candidate code against test suite
      console.log('[ScoringAgent] Running CODE_IMPLEMENTATION scoring');

      // Parse public config for mode + files
      const configRaw = challenge['config'];
      let publicConfig: unknown = configRaw;
      if (typeof configRaw === 'string') {
        try { publicConfig = JSON.parse(configRaw); } catch { publicConfig = {}; }
      }

      const result = await scoreCodeImplementation(
        submission,
        serverConfig as CodeImplServerConfig,
        (publicConfig ?? {}) as CodeImplPublicConfig,
      );
      score = result.score;
      feedback = result.feedback;
    } else {
      // Non-CODE_REVIEW, non-CODE_IMPL: deterministic scoring
      if (!submission) {
        return { success: true };
      }
      score = scorer(challengeType, submission, serverConfig);
      feedback = buildFeedback(challengeType, score);
    }

    console.log('[ScoringAgent] Score calculated', { challengeSubmissionId, challengeType, score });

    // Step 6: Update ChallengeSubmission
    const now = new Date().toISOString();
    await dynamo.send(new UpdateItemCommand({
      TableName: CHALLENGE_SUBMISSION_TABLE,
      Key: marshall({ id: challengeSubmissionId }),
      UpdateExpression: 'SET score = :score, feedback = :feedback, scoredAt = :scoredAt',
      ExpressionAttributeValues: marshall({
        ':score': score,
        ':feedback': feedback,
        ':scoredAt': now,
      }),
      ReturnValues: ReturnValue.NONE,
    }));

    console.log('[ScoringAgent] ChallengeSubmission updated', { challengeSubmissionId, score });

    // Step 7: Re-aggregate Assessment.score from all child ChallengeSubmissions
    if (assessmentId) {
      await aggregateAssessmentScore(assessmentId);
    }

    return { success: true };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    console.error('[ScoringAgent] Error:', message);
    return { success: false, error: message };
  }
};

// ─── Agentic CODE_REVIEW Scoring ─────────────────────────────────────────────

interface AgenticScoringInput {
  annotations: unknown[];
  verdict: string;
  summary: string;
  groundTruth: Bug[];
  followUpData: FollowUpQuestionsJson;
  challengeInstructions: string;
  codeContext: string;
}

async function agenticScoreCodeReview(input: AgenticScoringInput): Promise<{ score: number; feedback: string }> {
  const { annotations, verdict, summary, groundTruth, followUpData, challengeInstructions, codeContext } = input;

  // Build the Q&A section from follow-up answers
  const qaSection = followUpData.questions.map((q) => {
    const answer = followUpData.answers.find((a) => a.questionId === q.id);
    return `Q: ${q.question}\nA: ${answer?.answer ?? '(no answer)'}`;
  }).join('\n\n');

  // Summarize ground truth bugs for the scorer
  const groundTruthSummary = groundTruth.length > 0
    ? groundTruth.map((b, i) => `${i + 1}. Line ${b.line} — ${b.severity}: ${b.explanation}`).join('\n')
    : 'No specific ground truth defined.';

  // Summarize candidate annotations
  const annotationSummary = annotations.length > 0
    ? annotations.map((a, i) => {
        const ann = a as Record<string, unknown>;
        return `${i + 1}. Line ${ann['lineNumber'] ?? ann['line']} — ${ann['severity']}: ${ann['comment']}`;
      }).join('\n')
    : 'No annotations submitted.';

  const systemPrompt = `You are a senior technical interviewer evaluating a developer's code review submission.

Score the candidate from 0-100 across four dimensions:
- bugIdentification (40%): Did they find the actual issues? Miss any critical ones?
- severityJudgment (20%): Were annotations well-explained and correctly prioritised?
- analyticalWriting (20%): Was their written summary accurate, clear and insightful?
- technicalDepth (20%): Do their follow-up answers show real understanding, or surface-level responses?

The overall score is the weighted sum of the four dimension scores.

Respond with ONLY valid JSON in this exact format (no markdown, no extra keys):
{"score":<integer 0-100>,"summary":"<2-3 sentence holistic assessment for the recruiter>","strengths":["<strength 1>","<strength 2>"],"concerns":["<concern 1>","<concern 2>"],"skillProfile":{"bugIdentification":<integer 0-100>,"severityJudgment":<integer 0-100>,"analyticalWriting":<integer 0-100>,"technicalDepth":<integer 0-100>}}`;

  const userPrompt = `## Challenge Instructions
${challengeInstructions || 'Review the code and identify any bugs or issues.'}

## Code
\`\`\`
${codeContext || '(no code context)'}
\`\`\`

## Ground Truth Issues
${groundTruthSummary}

## Candidate Annotations
${annotationSummary}

## Candidate Verdict
${verdict}

## Candidate Summary
${summary || '(none provided)'}

## Follow-up Q&A
${qaSection}`;

  const response = await mistral.chat.complete({
    model: MISTRAL_MODEL,
    maxTokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const rawContent = response.choices?.[0]?.message?.content;
  const text = typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map((c) => ('text' in c ? (c as { text: string }).text : '')).join('')
      : '';

  if (!text) {
    console.error('[ScoringAgent] Empty response from Mistral');
    return { score: 0, feedback: 'Scoring failed — model returned no content.' };
  }

  try {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const score = Math.round(Math.max(0, Math.min(100, Number(parsed['score']))));

    // Build the structured AgenticFeedback stored in the feedback field.
    // The frontend detects this shape via JSON.parse and renders the rich view.
    const skillProfileRaw = parsed['skillProfile'];
    const skillProfile = (
      skillProfileRaw && typeof skillProfileRaw === 'object' && !Array.isArray(skillProfileRaw)
    ) ? (skillProfileRaw as Record<string, unknown>) : {};

    const clampDim = (key: string): number =>
      Math.round(Math.max(0, Math.min(100, Number(skillProfile[key] ?? 50))));

    const strengths = Array.isArray(parsed['strengths'])
      ? (parsed['strengths'] as unknown[]).filter(s => typeof s === 'string') as string[]
      : [];
    const concerns = Array.isArray(parsed['concerns'])
      ? (parsed['concerns'] as unknown[]).filter(s => typeof s === 'string') as string[]
      : [];

    const agenticFeedback = {
      score,
      summary: typeof parsed['summary'] === 'string' ? parsed['summary'] : buildFeedback('CODE_REVIEW', score),
      strengths,
      concerns,
      skillProfile: {
        bugIdentification: clampDim('bugIdentification'),
        severityJudgment: clampDim('severityJudgment'),
        analyticalWriting: clampDim('analyticalWriting'),
        technicalDepth: clampDim('technicalDepth'),
      },
    };

    return { score, feedback: JSON.stringify(agenticFeedback) };
  } catch (err) {
    console.error('[ScoringAgent] Failed to parse Mistral scoring response:', text, err);
    return { score: 0, feedback: 'Scoring failed — could not parse model response.' };
  }
}

// ─── Assessment Score Aggregation ─────────────────────────────────────────────

/**
 * Re-aggregate Assessment.score as the average of all child ChallengeSubmission scores.
 */
async function aggregateAssessmentScore(assessmentId: string): Promise<void> {
  try {
    const { Items } = await dynamo.send(new ScanCommand({
      TableName: CHALLENGE_SUBMISSION_TABLE,
      FilterExpression: 'assessmentId = :aid AND attribute_exists(score) AND (attribute_not_exists(#del) OR #del = :false)',
      ExpressionAttributeNames: { '#del': '_deleted' },
      ExpressionAttributeValues: marshall({
        ':aid': assessmentId,
        ':false': false,
      }),
      ProjectionExpression: 'score',
    }));

    if (!Items || Items.length === 0) {
      console.log('[ScoringAgent] No scored submissions for assessment', assessmentId);
      return;
    }

    const scores = Items.map(item => {
      const record = unmarshall(item);
      return typeof record['score'] === 'number' ? record['score'] : null;
    }).filter((s): s is number => s !== null);

    if (scores.length === 0) return;

    const avgScore = Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);

    await dynamo.send(new UpdateItemCommand({
      TableName: ASSESSMENT_TABLE,
      Key: marshall({ id: assessmentId }),
      UpdateExpression: 'SET score = :score',
      ExpressionAttributeValues: marshall({ ':score': avgScore }),
      ReturnValues: ReturnValue.NONE,
    }));

    console.log('[ScoringAgent] Assessment score aggregated', { assessmentId, avgScore, submissionCount: scores.length });
  } catch (err) {
    console.error('[ScoringAgent] Failed to aggregate assessment score:', err);
    // Non-fatal — don't fail the scoring operation
  }
}

// ─── Feedback Helper ──────────────────────────────────────────────────────────

function buildFeedback(challengeType: string, score: number): string {
  if (challengeType === 'CODE_REVIEW') {
    if (score >= 80) return 'Excellent code review — most issues identified with good severity accuracy.';
    if (score >= 60) return 'Good code review — caught the main issues. Some were missed or misclassified.';
    if (score >= 40) return 'Code review needs improvement — several issues were missed.';
    return 'Code review requires significant improvement — most issues were not identified.';
  }
  if (challengeType === 'QUIZ_MCQ') {
    return score === 100 ? 'Correct answer.' : 'Incorrect answer.';
  }
  return `Score: ${score}/100`;
}
