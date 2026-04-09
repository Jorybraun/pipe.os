/**
 * Challenge Generation Pipeline — Prompt Templates (ADR-034 CA Phase 3)
 *
 * Four prompt builders for the 4 AI stages:
 *   1. Generator — creates raw challenges from persona + config
 *   2. Content Reviewer — cross-model validation (CA-4)
 *   3. Linguistic Evaluator — clarity/ambiguity check
 *   4. Difficulty Calibrator — Bloom's alignment (CA-5)
 *
 * Design principles:
 *   - Chain-of-thought reasoning in generator (CA-2)
 *   - Misconception-based distractors for MCQ (CA-3)
 *   - All prompts force JSON output via the provider's forceJson mode
 */

import type { CandidatePersona, ChallengeTemplateType, TemplateDifficulty } from '../../types';
import type { RawGeneratedChallenge } from './types';

// ─── Stage 1: Generator ──────────────────────────────────────────────────────

export function buildGeneratorSystemPrompt(
  persona: CandidatePersona,
  config: {
    types: ChallengeTemplateType[];
    count: number;
    seniority: TemplateDifficulty;
  },
): string {
  const typeInstructions = config.types.map((t) => TYPE_GENERATION_RULES[t]).join('\n\n');

  return `You are an expert technical assessment designer. Your job is to create interview challenges that accurately evaluate candidates for a specific role.

## Target Role

Seniority: ${persona.seniority}
Archetype: ${persona.archetype}
Must-have skills: ${persona.mustHaveSkills.join(', ')}
Nice-to-have skills: ${persona.niceToHaveSkills.join(', ')}
Career signal: ${persona.careerSignal}

## Instructions

Generate exactly ${config.count} challenge(s) of the following type(s): ${config.types.join(', ')}.
Target difficulty: ${config.seniority}.

For each challenge, think step-by-step (chain-of-thought):
1. Pick a specific skill from the must-have list (70% of challenges) or nice-to-have list (30%).
2. Decide what cognitive level is appropriate (Bloom's taxonomy: remember → understand → apply → analyze → evaluate → create).
3. Design a challenge that tests that skill at that level.
4. Estimate realistic completion time in minutes.

${typeInstructions}

## Output Format

Return a JSON object with a single key "challenges" containing an array. Each element:

{
  "type": "CODE_IMPLEMENTATION" | "QUIZ_MCQ" | "QUIZ_SHORT_ANSWER",
  "title": "concise title (under 80 chars)",
  "instructions": "full challenge instructions in markdown",
  "difficulty": "JUNIOR" | "MID" | "SENIOR",
  "primarySkill": "the main skill being tested",
  "secondarySkills": ["other", "skills", "touched"],
  "bloomLevel": "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create",
  "estimatedMinutes": <number>,
  "config": { <type-specific config — see rules below> },
  "reasoning": "your step-by-step thought process for this challenge"
}`;
}

const TYPE_GENERATION_RULES: Record<ChallengeTemplateType, string> = {
  QUIZ_MCQ: `### MCQ Rules (CA-3: misconception-based distractors)
- Provide exactly 4 options in config.options (array of {text, isCorrect}).
- Exactly 1 option must be correct.
- Distractors MUST be based on common misconceptions, not obviously wrong.
  - Bad distractor: "A banana" for a TypeScript question.
  - Good distractor: An answer that would be correct if the candidate confused == with ===.
- The correct answer should not be obviously different in length or style from distractors.
- config format: { "options": [{ "text": "...", "isCorrect": true/false }] }`,

  QUIZ_SHORT_ANSWER: `### Short Answer Rules
- The question should have a definitive correct answer or a small set of acceptable answers.
- Provide a rubric in config.rubric describing what a good answer looks like.
- Provide expected answer keywords in config.expectedKeywords (array of strings).
- config format: { "rubric": "...", "expectedKeywords": ["keyword1", "keyword2"] }`,

  CODE_IMPLEMENTATION: `### Code Implementation Rules
- Provide a clear problem statement with input/output examples.
- Include at least 2 example inputs/outputs in the instructions.
- Specify the function signature in config.functionSignature.
- List edge cases to handle in config.edgeCases (array of strings).
- config format: { "functionSignature": "...", "edgeCases": ["...", "..."], "language": "typescript" | "python" }`,
};

export function buildGeneratorUserMessage(
  persona: CandidatePersona,
): string {
  return `Generate the challenges now. Focus on skills that matter most for this role: ${persona.mustHaveSkills.slice(0, 5).join(', ')}. The candidate should feel like these challenges were written specifically for their role, not pulled from a generic bank.`;
}

// ─── Stage 2: Content Reviewer ───────────────────────────────────────────────

export function buildContentReviewPrompt(
  challenges: RawGeneratedChallenge[],
  persona: CandidatePersona,
): string {
  return `You are a senior assessment quality reviewer. Your job is to validate AI-generated interview challenges for accuracy, fairness, and role alignment.

## Target Role

Seniority: ${persona.seniority}
Must-have skills: ${persona.mustHaveSkills.join(', ')}
Nice-to-have skills: ${persona.niceToHaveSkills.join(', ')}

## Challenges to Review

${JSON.stringify(challenges.map(({ reasoning: _r, ...rest }) => rest), null, 2)}

## Review Criteria

For each challenge, evaluate:

1. **Topic Relevance (0-1)**: Does this challenge actually test the stated primarySkill? Is the skill relevant to the role's must-have or nice-to-have list?
2. **Role Fit (0-1)**: Is the difficulty appropriate for the seniority? Would this challenge make sense in an interview for this specific archetype?
3. **Accuracy**: For MCQ, is the correct answer actually correct? Are distractors plausible but wrong? For code, is the problem statement unambiguous?
4. **Fairness**: Does the challenge avoid cultural bias, require proprietary knowledge, or assume a specific tech stack not mentioned in the role?

## Output Format

Return a JSON object with a single key "reviews" containing an array (same order as input). Each element:

{
  "passed": true/false,
  "topicRelevance": <0-1>,
  "roleFit": <0-1>,
  "issues": ["issue description", ...]
}

Mark passed=false if topicRelevance < 0.5 OR roleFit < 0.5 OR any accuracy/fairness issue found.`;
}

// ─── Stage 3: Linguistic Evaluator ───────────────────────────────────────────

export function buildLinguisticEvalPrompt(
  challenges: Array<{ title: string; instructions: string; type: ChallengeTemplateType; config: Record<string, unknown> }>,
): string {
  return `You are a technical writing specialist evaluating the clarity of interview challenges.

## Challenges to Evaluate

${JSON.stringify(challenges, null, 2)}

## Evaluation Criteria

For each challenge, score:

1. **Clarity (0-1)**: Can a qualified candidate understand exactly what is being asked on first read? Deduct for:
   - Ambiguous pronouns or references
   - Instructions that could be interpreted multiple ways
   - Missing constraints or assumptions
   - Overly complex sentence structure
   - MCQ options that are confusingly similar in wording (not content — content similarity is fine for good distractors)

2. **Issues**: List specific linguistic problems found.

## Output Format

Return a JSON object with a single key "evaluations" containing an array (same order as input). Each element:

{
  "clarity": <0-1>,
  "issues": ["specific issue", ...]
}`;
}

// ─── Stage 4: Difficulty Calibrator ──────────────────────────────────────────

export function buildDifficultyCalibrationPrompt(
  challenges: Array<{
    title: string;
    instructions: string;
    type: ChallengeTemplateType;
    difficulty: TemplateDifficulty;
    bloomLevel: string;
    config: Record<string, unknown>;
  }>,
  targetSeniority: TemplateDifficulty,
): string {
  return `You are an assessment calibration specialist. Your job is to verify that challenge difficulty and Bloom's taxonomy level are correctly assigned.

IMPORTANT CAVEAT: Bloom's taxonomy mapping to software developer roles is not yet empirically validated for this system (CA-5). Your assessments are heuristic guidance, not ground truth. Flag uncertainty when present.

## Target Seniority: ${targetSeniority}

## Bloom's Level Reference for Developer Assessments

| Level | Developer Example |
|---|---|
| remember | Recall syntax, name a design pattern |
| understand | Explain what a closure does, describe REST vs GraphQL |
| apply | Implement a function given a spec, use an API correctly |
| analyze | Debug a failing test, identify a race condition in code |
| evaluate | Review code and justify which approach is better |
| create | Design a system, architect a solution from requirements |

## Expected Difficulty Mapping

| Seniority | Typical Bloom's Range |
|---|---|
| JUNIOR | remember, understand, apply |
| MID | apply, analyze |
| SENIOR | analyze, evaluate, create |

## Challenges to Calibrate

${JSON.stringify(challenges, null, 2)}

## Output Format

Return a JSON object with a single key "calibrations" containing an array (same order as input). Each element:

{
  "bloomAligned": true/false,
  "difficultyAligned": true/false,
  "suggestedBloom": null or "remember"|"understand"|"apply"|"analyze"|"evaluate"|"create",
  "suggestedDifficulty": null or "JUNIOR"|"MID"|"SENIOR"
}

Set suggestedBloom/suggestedDifficulty to null when the original values are correct.`;
}

// ─── Refinement prompt ───────────────────────────────────────────────────────

export function buildRefinementPrompt(
  challenge: {
    type: ChallengeTemplateType;
    title: string;
    instructions: string;
    difficulty: string;
    primarySkill: string;
    secondarySkills: string[];
    bloomLevel: string | null;
    estimatedMinutes: number | null;
    config: Record<string, unknown>;
  },
  instructions: string,
): string {
  return `You are an expert technical assessment designer refining an existing interview challenge.

## Current Challenge

Type: ${challenge.type}
Title: ${challenge.title}
Difficulty: ${challenge.difficulty}
Primary Skill: ${challenge.primarySkill}
Secondary Skills: ${challenge.secondarySkills.join(', ') || 'none'}
Bloom's Level: ${challenge.bloomLevel ?? 'unset'}
Estimated Minutes: ${challenge.estimatedMinutes ?? 'unset'}

Instructions:
${challenge.instructions}

Config:
${JSON.stringify(challenge.config, null, 2)}

## Refinement Request

${instructions}

## Output Format

Return a JSON object with the refined challenge. Keep all fields that weren't mentioned in the refinement request unchanged. The output must have the same structure:

{
  "type": "${challenge.type}",
  "title": "refined title",
  "instructions": "refined instructions in markdown",
  "difficulty": "JUNIOR" | "MID" | "SENIOR",
  "primarySkill": "skill",
  "secondarySkills": ["skill1", "skill2"],
  "bloomLevel": "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create",
  "estimatedMinutes": <number>,
  "config": { <type-specific config> }
}`;
}
