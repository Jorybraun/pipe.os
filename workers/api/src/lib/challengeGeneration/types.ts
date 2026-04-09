/**
 * Challenge Generation Pipeline types — ADR-034 CA Phase 3
 *
 * Types for the multi-agent generation pipeline (CA-1):
 *   Generator → Content Reviewer → Linguistic Evaluator → Difficulty Calibrator
 *
 * All types are internal to the Worker; the API response is GenerationPipelineResult.
 */

import type { ChallengeTemplateType, TemplateDifficulty, BloomLevel } from '../../types';

// ─── Request ─────────────────────────────────────────────────────────────────

export interface GenerationRequest {
  /** Which challenge types to generate. Defaults to mixed. */
  types?: ChallengeTemplateType[];
  /** How many challenges to generate (1-10, default 5). */
  count?: number;
  /** Target seniority level. Derived from persona if omitted. */
  seniority?: TemplateDifficulty;
}

// ─── Stage 1: Generator output ───────────────────────────────────────────────

export interface RawGeneratedChallenge {
  type: ChallengeTemplateType;
  title: string;
  instructions: string;
  difficulty: TemplateDifficulty;
  primarySkill: string;
  secondarySkills: string[];
  bloomLevel: BloomLevel;
  estimatedMinutes: number;
  /** Type-specific config (MCQ options, code starter, etc.) */
  config: Record<string, unknown>;
  /** Chain-of-thought reasoning from the generator (CA-2). Not exposed to UI. */
  reasoning: string;
}

// ─── Stage 2: Content Reviewer output ────────────────────────────────────────

export interface ContentReviewResult {
  /** Whether this challenge passed content review. */
  passed: boolean;
  /** Skill alignment score: how well the challenge tests the intended skill. */
  topicRelevance: number;
  /** Role fit: how well the challenge matches the target persona. */
  roleFit: number;
  /** Issues found (empty if passed). */
  issues: string[];
}

export interface ReviewedChallenge {
  challenge: RawGeneratedChallenge;
  review: ContentReviewResult;
}

// ─── Stage 3: Linguistic Evaluator output ────────────────────────────────────

export interface LinguisticEvalResult {
  /** Clarity score 0-1: is the question unambiguous and well-written? */
  clarity: number;
  /** Specific linguistic issues found. */
  issues: string[];
}

// ─── Stage 4: Difficulty Calibrator output ───────────────────────────────────

export interface DifficultyCalibrationResult {
  /** Whether the stated Bloom's level aligns with the actual cognitive demand. */
  bloomAligned: boolean;
  /** Whether the stated difficulty aligns with the target seniority. */
  difficultyAligned: boolean;
  /** Suggested Bloom's level if misaligned. */
  suggestedBloom: BloomLevel | null;
  /** Suggested difficulty if misaligned. */
  suggestedDifficulty: TemplateDifficulty | null;
}

// ─── Final scored output (CA-16) ─────────────────────────────────────────────

export interface ConfidenceScores {
  /** How well the challenge tests the intended skill (0-1). */
  topicRelevance: number;
  /** How well the challenge matches the target persona (0-1). */
  roleFit: number;
  /** Linguistic clarity and readability (0-1). */
  clarity: number;
}

export interface ScoredChallenge {
  challenge: RawGeneratedChallenge;
  confidence: ConfidenceScores;
  /** Issues aggregated from all review stages. */
  issues: string[];
  /** Whether Bloom's/difficulty calibration flagged misalignment (CA-5 caveat). */
  calibrationWarnings: string[];
}

// ─── Pipeline result ─────────────────────────────────────────────────────────

export interface GenerationPipelineResult {
  challenges: ScoredChallenge[];
  /** Total challenges generated before filtering. */
  totalGenerated: number;
  /** Challenges rejected by content review. */
  totalRejected: number;
  /** Models used in each pipeline stage (for transparency). */
  models: {
    generator: string;
    contentReviewer: string;
    linguisticEvaluator: string;
    difficultyCalibrator: string;
  };
}
