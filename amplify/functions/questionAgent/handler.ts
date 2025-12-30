/**
 * Question Agent Lambda Handler
 *
 * Multi-step agent that generates contextual questions for role discovery.
 *
 * Steps:
 * 1. Extract facts from user responses (if provided)
 * 2. Assess readiness (do we have enough context?)
 * 3. Generate targeted questions with quality review loop
 *
 * Performance targets:
 * - Response time: < 5 seconds
 * - Cost per invocation: < $0.10
 */

import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';
import type {
  QuestionAgentRequest,
  QuestionAgentResponse,
  Exchange,
  ExtractorOutput,
  AssessorOutput,
  GeneratorOutput,
  ReviewerOutput,
  FormSection,
  DynamicContext,
} from './types';
import { createCostTracker, trackCost, getCostingSummary } from './costTracker';
import {
  validateQuestionAgentRequest,
  validateFormSection,
} from './validation';
import {
  buildExtractorPrompt,
  buildAssessorPrompt,
  buildGeneratorPrompt,
  buildReviewerPrompt,
} from './prompts';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '1024');
const MAX_QUALITY_ITERATIONS = parseInt(process.env.MAX_QUALITY_ITERATIONS || '2');
const GENERATION_TIMEOUT_MS = parseInt(process.env.GENERATION_TIMEOUT_MS || '4500');

/**
 * Lambda handler entry point.
 */
export async function handler(event: QuestionAgentRequest): Promise<QuestionAgentResponse> {
  const startTime = Date.now();

  console.log('[QuestionAgent] Starting request', {
    hasResponses: !!event.responses,
    responseCount: event.responses?.length || 0,
    status: event.roleContext.status,
  });

  try {
    // Step 0: Validate input
    validateQuestionAgentRequest(event);

    const costTracker = createCostTracker(
      parseFloat(process.env.COST_BUDGET_PER_SESSION || '0.50')
    );

    const { roleContext, responses } = event;
    let updatedContext: DynamicContext = { ...roleContext.context };
    const newExchanges: Exchange[] = [];
    let userSignals = roleContext.userSignals;

    // Step 1: Extract facts from responses (if provided)
    if (responses && responses.length > 0 && roleContext.baseline) {
      console.log('[QuestionAgent] Step 1: Extracting facts from responses');

      for (const { questionId, response } of responses) {
        // Find the question that prompted this response
        const question = findQuestionInHistory(roleContext.exchanges, questionId);
        if (!question) {
          console.warn('[QuestionAgent] Question not found:', questionId);
          continue;
        }

        const extractorResult = await extractFacts(
          question,
          typeof response === 'string' ? response : response.join(', '),
          updatedContext,
          costTracker
        );

        // Merge extracted context
        updatedContext = {
          ...updatedContext,
          ...extractorResult.contextUpdates,
        };

        // Update user signals
        if (extractorResult.userSignals) {
          userSignals = extractorResult.userSignals;
        }

        // Create exchange record
        newExchanges.push({
          id: uuid(),
          questionId,
          agentQuestion: question,
          userResponse: typeof response === 'string' ? response : response.join(', '),
          extractedFacts: extractorResult.extractedFacts,
          timestamp: Date.now(),
        });
      }
    }

    // Step 2: Assess readiness
    console.log('[QuestionAgent] Step 2: Assessing readiness');

    const assessmentResult = await assessReadiness(
      roleContext.baseline!,
      updatedContext,
      [...roleContext.exchanges, ...newExchanges],
      costTracker
    );

    // Step 3: Generate questions (if not ready)
    let nextSection: FormSection | null = null;

    if (assessmentResult.status !== 'ready') {
      console.log('[QuestionAgent] Step 3: Generating questions');

      try {
        nextSection = await generateQuestionsWithReview(
          roleContext.baseline!,
          updatedContext,
          assessmentResult.gaps,
          [...roleContext.exchanges, ...newExchanges],
          userSignals,
          costTracker
        );
      } catch (error) {
        console.error('[QuestionAgent] Question generation failed:', error);

        // Best-effort fallback: return simple questions
        nextSection = createFallbackQuestions(assessmentResult.gaps[0] || 'General');
      }
    }

    const processingTime = Date.now() - startTime;

    console.log('[QuestionAgent] Request complete', {
      status: assessmentResult.status,
      gapsRemaining: assessmentResult.gaps.length,
      hasNextSection: !!nextSection,
      processingTime,
      cost: costTracker.estimatedCost.toFixed(4),
    });

    return {
      updatedContext,
      newExchanges,
      nextSection,
      status: assessmentResult.status,
      gaps: assessmentResult.gaps,
      userSignals,
      reasoning: assessmentResult.reasoning,
      costTracking: getCostingSummary(costTracker),
      processingTime,
    };
  } catch (error) {
    console.error('[QuestionAgent] Error:', error);
    throw error;
  }
}

/**
 * Extracts facts from a user response.
 */
async function extractFacts(
  question: string,
  response: string,
  currentContext: DynamicContext,
  costTracker: ReturnType<typeof createCostTracker>
): Promise<ExtractorOutput> {
  const prompt = buildExtractorPrompt(question, response, currentContext);

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  trackCost(costTracker, message.usage.input_tokens, message.usage.output_tokens);

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  try {
    const result = JSON.parse(content.text) as ExtractorOutput;
    return result;
  } catch (error) {
    console.error('[Extractor] Failed to parse JSON:', content.text);
    throw new Error('EXTRACTION_FAILED: Invalid JSON response');
  }
}

/**
 * Assesses if we have enough context to generate job description.
 */
async function assessReadiness(
  baseline: QuestionAgentRequest['roleContext']['baseline'],
  context: DynamicContext,
  exchanges: Exchange[],
  costTracker: ReturnType<typeof createCostTracker>
): Promise<AssessorOutput> {
  const prompt = buildAssessorPrompt(baseline!, context, exchanges);

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  trackCost(costTracker, message.usage.input_tokens, message.usage.output_tokens);

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  try {
    const result = JSON.parse(content.text) as AssessorOutput;
    return result;
  } catch (error) {
    console.error('[Assessor] Failed to parse JSON:', content.text);
    throw new Error('ASSESSMENT_FAILED: Invalid JSON response');
  }
}

/**
 * Generates questions with quality review loop.
 */
async function generateQuestionsWithReview(
  baseline: QuestionAgentRequest['roleContext']['baseline'],
  context: DynamicContext,
  gaps: string[],
  exchanges: Exchange[],
  userSignals: QuestionAgentRequest['roleContext']['userSignals'],
  costTracker: ReturnType<typeof createCostTracker>
): Promise<FormSection> {
  let iteration = 0;
  let revisionFeedback: string | undefined;
  let section: FormSection | null = null;

  const timeoutTime = Date.now() + GENERATION_TIMEOUT_MS;

  while (iteration < MAX_QUALITY_ITERATIONS) {
    // Check timeout
    if (Date.now() > timeoutTime) {
      console.warn('[Generator] Timeout reached, returning best effort');
      if (section) {
        return section;  // Return what we have
      }
      throw new Error('TIME_BUDGET_EXCEEDED: Question generation timeout');
    }

    // Generate questions
    const prompt = buildGeneratorPrompt(
      baseline!,
      context,
      gaps,
      exchanges,
      userSignals,
      revisionFeedback
    );

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });

    trackCost(costTracker, message.usage.input_tokens, message.usage.output_tokens);

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic');
    }

    let generatorResult: GeneratorOutput;
    try {
      generatorResult = JSON.parse(content.text) as GeneratorOutput;
      section = generatorResult.section;
    } catch (error) {
      console.error('[Generator] Failed to parse JSON:', content.text);
      throw new Error('GENERATION_FAILED: Invalid JSON response');
    }

    // Validate section
    try {
      validateFormSection(section);
    } catch (error) {
      console.error('[Generator] Section validation failed:', error);
      throw new Error(`GENERATION_FAILED: ${error}`);
    }

    // Review quality (skip on last iteration)
    if (iteration < MAX_QUALITY_ITERATIONS - 1) {
      const reviewPrompt = buildReviewerPrompt(section, baseline!, context, exchanges);

      const reviewMessage = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: reviewPrompt }],
      });

      trackCost(costTracker, reviewMessage.usage.input_tokens, reviewMessage.usage.output_tokens);

      const reviewContent = reviewMessage.content[0];
      if (reviewContent.type !== 'text') {
        throw new Error('Unexpected response type from Anthropic');
      }

      let reviewResult: ReviewerOutput;
      try {
        reviewResult = JSON.parse(reviewContent.text) as ReviewerOutput;
      } catch (error) {
        console.error('[Reviewer] Failed to parse JSON:', reviewContent.text);
        // Skip review on parse error
        return section;
      }

      if (reviewResult.approved) {
        console.log('[Generator] Questions approved on iteration', iteration + 1);
        return section;
      }

      console.log('[Generator] Questions need revision:', reviewResult.feedback);
      revisionFeedback = reviewResult.feedback;
      iteration++;
    } else {
      // Last iteration, return what we have
      console.log('[Generator] Max iterations reached, returning section');
      return section;
    }
  }

  // Should not reach here, but TypeScript needs a return
  throw new Error('REVIEW_LOOP_EXCEEDED');
}

/**
 * Creates fallback questions when generation fails.
 */
function createFallbackQuestions(gap: string): FormSection {
  return {
    id: uuid(),
    title: gap.toUpperCase().replace(/\s+/g, '_'),
    description: `I'd like to understand more about ${gap}.`,
    questions: [
      {
        id: uuid(),
        text: `Can you tell me more about ${gap} for this role?`,
        type: 'textarea',
        placeholder: 'Please provide details...',
      },
    ],
  };
}

/**
 * Finds the question text from history.
 */
function findQuestionInHistory(exchanges: Exchange[], questionId: string): string | null {
  const exchange = exchanges.find((e) => e.questionId === questionId);
  return exchange ? exchange.agentQuestion : null;
}
