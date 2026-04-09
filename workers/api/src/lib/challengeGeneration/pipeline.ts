/**
 * Challenge Generation Pipeline — ADR-034 CA Phase 3
 *
 * 4-stage sequential pipeline (CA-1):
 *   1. Generator    — creates raw challenges (Gemma 26B / Qwen 32B)
 *   2. Content Rev  — cross-model validation (CA-4: different family)
 *   3. Linguistic   — clarity scoring (Gemma 12B)
 *   4. Calibrator   — Bloom's alignment (Gemma 12B, CA-5 caveat)
 *
 * Each stage is a standalone async function. The orchestrator runs them
 * sequentially because each stage filters/annotates for the next.
 *
 * MOCK_AI support: when env.MOCK_AI === 'true', returns canned challenges
 * for deterministic testing (same pattern as culture agent).
 */

import { createGenerationProvider } from '../llm/createProvider';
import type { LLMProvider, LLMMessage } from '../llm/types';
import type { CandidatePersona, ChallengeTemplateType, TemplateDifficulty } from '../../types';
import type {
  GenerationRequest,
  RawGeneratedChallenge,
  ContentReviewResult,
  ReviewedChallenge,
  LinguisticEvalResult,
  DifficultyCalibrationResult,
  ScoredChallenge,
  GenerationPipelineResult,
} from './types';
import {
  buildGeneratorSystemPrompt,
  buildGeneratorUserMessage,
  buildContentReviewPrompt,
  buildLinguisticEvalPrompt,
  buildDifficultyCalibrationPrompt,
} from './prompts';

// ─── Model constants ─────────────────────────────────────────────────────────

const GEMMA_26B = '@cf/google/gemma-4-26b-a4b-it';
const QWEN_CODER_32B = '@cf/qwen/qwen2.5-coder-32b-instruct';
const GEMMA_12B = '@cf/google/gemma-4-12b-it';

// ─── Helper: safe JSON parse from LLM response ──────────────────────────────

function parseLLMJson<T>(content: string | null, label: string): T {
  if (!content) {
    throw new Error(`[challengeGeneration] ${label} returned empty response`);
  }
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`[challengeGeneration] ${label} returned invalid JSON: ${content.slice(0, 200)}`);
  }
}

// ─── Resolve seniority from persona ──────────────────────────────────────────

function resolveSeniority(persona: CandidatePersona, requested?: TemplateDifficulty): TemplateDifficulty {
  if (requested) return requested;
  const s = persona.seniority.toLowerCase();
  if (s.includes('senior') || s.includes('staff') || s.includes('principal')) return 'SENIOR';
  if (s.includes('junior') || s.includes('entry') || s.includes('intern')) return 'JUNIOR';
  return 'MID';
}

// ─── Pick generator model by challenge type ──────────────────────────────────

function pickGeneratorModel(types: ChallengeTemplateType[]): string {
  // If any code implementation requested, use code-tuned model
  if (types.includes('CODE_IMPLEMENTATION')) return QWEN_CODER_32B;
  return GEMMA_26B;
}

/**
 * Pick content reviewer model — MUST be a different family from the generator (CA-4).
 * Gemma generates → Qwen reviews, Qwen generates → Gemma reviews.
 */
function pickReviewerModel(generatorModel: string): string {
  if (generatorModel.includes('qwen')) return GEMMA_26B;
  return QWEN_CODER_32B;
}

// ─── Stage 1: Generator ──────────────────────────────────────────────────────

async function runGenerator(
  provider: LLMProvider,
  persona: CandidatePersona,
  config: { types: ChallengeTemplateType[]; count: number; seniority: TemplateDifficulty },
): Promise<RawGeneratedChallenge[]> {
  const messages: LLMMessage[] = [
    { role: 'system', content: buildGeneratorSystemPrompt(persona, config) },
    { role: 'user', content: buildGeneratorUserMessage(persona) },
  ];

  const completion = await provider.complete(messages, {
    forceJson: true,
    maxTokens: 4096,
  });

  const result = parseLLMJson<{ challenges: RawGeneratedChallenge[] }>(
    completion.content,
    'Generator',
  );

  if (!Array.isArray(result.challenges) || result.challenges.length === 0) {
    throw new Error('[challengeGeneration] Generator returned no challenges');
  }

  return result.challenges;
}

// ─── Stage 2: Content Reviewer ───────────────────────────────────────────────

async function runContentReview(
  provider: LLMProvider,
  challenges: RawGeneratedChallenge[],
  persona: CandidatePersona,
): Promise<ReviewedChallenge[]> {
  const messages: LLMMessage[] = [
    { role: 'system', content: buildContentReviewPrompt(challenges, persona) },
    { role: 'user', content: 'Review the challenges now. Be strict — it is better to reject a borderline challenge than to let a bad one through.' },
  ];

  const completion = await provider.complete(messages, {
    forceJson: true,
    maxTokens: 2048,
  });

  const result = parseLLMJson<{ reviews: ContentReviewResult[] }>(
    completion.content,
    'ContentReviewer',
  );

  if (!Array.isArray(result.reviews) || result.reviews.length !== challenges.length) {
    console.error('[challengeGeneration] ContentReviewer returned mismatched review count, using all-pass fallback');
    return challenges.map((challenge) => ({
      challenge,
      review: { passed: true, topicRelevance: 0.7, roleFit: 0.7, issues: [] },
    }));
  }

  return challenges.map((challenge, i) => ({
    challenge,
    review: result.reviews[i]!,
  }));
}

// ─── Stage 3: Linguistic Evaluator ───────────────────────────────────────────

async function runLinguisticEval(
  provider: LLMProvider,
  challenges: ReviewedChallenge[],
): Promise<LinguisticEvalResult[]> {
  const input = challenges.map(({ challenge }) => ({
    title: challenge.title,
    instructions: challenge.instructions,
    type: challenge.type,
    config: challenge.config,
  }));

  const messages: LLMMessage[] = [
    { role: 'system', content: buildLinguisticEvalPrompt(input) },
    { role: 'user', content: 'Evaluate the linguistic clarity of each challenge.' },
  ];

  const completion = await provider.complete(messages, {
    forceJson: true,
    maxTokens: 1024,
  });

  const result = parseLLMJson<{ evaluations: LinguisticEvalResult[] }>(
    completion.content,
    'LinguisticEvaluator',
  );

  if (!Array.isArray(result.evaluations) || result.evaluations.length !== challenges.length) {
    console.error('[challengeGeneration] LinguisticEvaluator returned mismatched count, using default scores');
    return challenges.map(() => ({ clarity: 0.7, issues: [] }));
  }

  return result.evaluations;
}

// ─── Stage 4: Difficulty Calibrator ──────────────────────────────────────────

async function runDifficultyCalibration(
  provider: LLMProvider,
  challenges: ReviewedChallenge[],
  targetSeniority: TemplateDifficulty,
): Promise<DifficultyCalibrationResult[]> {
  const input = challenges.map(({ challenge }) => ({
    title: challenge.title,
    instructions: challenge.instructions,
    type: challenge.type,
    difficulty: challenge.difficulty,
    bloomLevel: challenge.bloomLevel,
    config: challenge.config,
  }));

  const messages: LLMMessage[] = [
    { role: 'system', content: buildDifficultyCalibrationPrompt(input, targetSeniority) },
    { role: 'user', content: 'Calibrate each challenge now.' },
  ];

  const completion = await provider.complete(messages, {
    forceJson: true,
    maxTokens: 1024,
  });

  const result = parseLLMJson<{ calibrations: DifficultyCalibrationResult[] }>(
    completion.content,
    'DifficultyCalibrator',
  );

  if (!Array.isArray(result.calibrations) || result.calibrations.length !== challenges.length) {
    console.error('[challengeGeneration] DifficultyCalibrator returned mismatched count, using defaults');
    return challenges.map(() => ({
      bloomAligned: true,
      difficultyAligned: true,
      suggestedBloom: null,
      suggestedDifficulty: null,
    }));
  }

  return result.calibrations;
}

// ─── Assemble scored results ─────────────────────────────────────────────────

function assembleResults(
  reviewed: ReviewedChallenge[],
  linguisticEvals: LinguisticEvalResult[],
  calibrations: DifficultyCalibrationResult[],
): ScoredChallenge[] {
  return reviewed.map((item, i) => {
    const lingEval = linguisticEvals[i]!;
    const cal = calibrations[i]!;

    const issues = [...item.review.issues, ...lingEval.issues];
    const calibrationWarnings: string[] = [];

    if (!cal.bloomAligned && cal.suggestedBloom) {
      calibrationWarnings.push(
        `Bloom's level may be "${cal.suggestedBloom}" rather than "${item.challenge.bloomLevel}" (heuristic — CA-5)`,
      );
    }
    if (!cal.difficultyAligned && cal.suggestedDifficulty) {
      calibrationWarnings.push(
        `Difficulty may be ${cal.suggestedDifficulty} rather than ${item.challenge.difficulty}`,
      );
    }

    return {
      challenge: item.challenge,
      confidence: {
        topicRelevance: item.review.topicRelevance,
        roleFit: item.review.roleFit,
        clarity: lingEval.clarity,
      },
      issues,
      calibrationWarnings,
    };
  });
}

// ─── Mock pipeline (MOCK_AI=true) ────────────────────────────────────────────

function mockPipelineResult(count: number): GenerationPipelineResult {
  const challenges: ScoredChallenge[] = Array.from({ length: Math.min(count, 3) }, (_, i) => ({
    challenge: {
      type: (['QUIZ_MCQ', 'CODE_IMPLEMENTATION', 'QUIZ_SHORT_ANSWER'] as const)[i % 3]!,
      title: `Mock Challenge ${i + 1}`,
      instructions: `This is a mock challenge for testing. Implement a function that returns ${i + 1}.`,
      difficulty: 'MID' as const,
      primarySkill: 'TypeScript',
      secondarySkills: ['testing'],
      bloomLevel: 'apply' as const,
      estimatedMinutes: 15,
      config: i % 3 === 0
        ? { options: [
            { text: 'Option A', isCorrect: true },
            { text: 'Option B', isCorrect: false },
            { text: 'Option C', isCorrect: false },
            { text: 'Option D', isCorrect: false },
          ] }
        : i % 3 === 1
          ? { functionSignature: 'function solve(n: number): number', edgeCases: ['n = 0'], language: 'typescript' }
          : { rubric: 'Explain clearly', expectedKeywords: ['mock', 'test'] },
      reasoning: 'Mock reasoning for deterministic testing.',
    },
    confidence: { topicRelevance: 0.85, roleFit: 0.9, clarity: 0.88 },
    issues: [],
    calibrationWarnings: [],
  }));

  return {
    challenges,
    totalGenerated: count,
    totalRejected: 0,
    models: {
      generator: 'mock',
      contentReviewer: 'mock',
      linguisticEvaluator: 'mock',
      difficultyCalibrator: 'mock',
    },
  };
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

interface PipelineEnv {
  AI?: Ai;
  MOCK_AI?: string;
}

export async function runGenerationPipeline(
  env: PipelineEnv,
  persona: CandidatePersona,
  request: GenerationRequest,
): Promise<GenerationPipelineResult> {
  const count = Math.min(Math.max(request.count ?? 5, 1), 10);
  const types = request.types?.length ? request.types : (['QUIZ_MCQ', 'CODE_IMPLEMENTATION', 'QUIZ_SHORT_ANSWER'] as const).slice() as ChallengeTemplateType[];
  const seniority = resolveSeniority(persona, request.seniority);

  // Mock path for testing
  if (env.MOCK_AI === 'true') {
    return mockPipelineResult(count);
  }

  // Resolve models
  const generatorModel = pickGeneratorModel(types);
  const reviewerModel = pickReviewerModel(generatorModel);

  // Create providers (one per model)
  const generatorProvider = createGenerationProvider(env, generatorModel);
  const reviewerProvider = createGenerationProvider(env, reviewerModel);
  const evalProvider = createGenerationProvider(env, GEMMA_12B);

  if (!generatorProvider || !reviewerProvider || !evalProvider) {
    throw new Error('[challengeGeneration] AI binding not available — cannot create providers');
  }

  // Stage 1: Generate
  const rawChallenges = await runGenerator(generatorProvider, persona, { types, count, seniority });

  // Stage 2: Content review (cross-model, CA-4)
  const reviewed = await runContentReview(reviewerProvider, rawChallenges, persona);
  const passed = reviewed.filter((r) => r.review.passed);
  const totalRejected = reviewed.length - passed.length;

  if (passed.length === 0) {
    return {
      challenges: [],
      totalGenerated: rawChallenges.length,
      totalRejected,
      models: {
        generator: generatorModel,
        contentReviewer: reviewerModel,
        linguisticEvaluator: GEMMA_12B,
        difficultyCalibrator: GEMMA_12B,
      },
    };
  }

  // Stage 3: Linguistic evaluation
  const linguisticEvals = await runLinguisticEval(evalProvider, passed);

  // Stage 4: Difficulty calibration
  const calibrations = await runDifficultyCalibration(evalProvider, passed, seniority);

  // Assemble final scored challenges
  const scoredChallenges = assembleResults(passed, linguisticEvals, calibrations);

  return {
    challenges: scoredChallenges,
    totalGenerated: rawChallenges.length,
    totalRejected,
    models: {
      generator: generatorModel,
      contentReviewer: reviewerModel,
      linguisticEvaluator: GEMMA_12B,
      difficultyCalibrator: GEMMA_12B,
    },
  };
}
