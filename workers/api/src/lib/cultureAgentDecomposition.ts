/**
 * Culture Interview — Answer Decomposition (graph construction).
 *
 * After each candidate answer, run a decomposition prompt that extracts
 * structured sub-elements: CulturalSignal nodes, new Experiences, new Projects.
 *
 * When `candidate_nodes` table exists (future migration), these are inserted
 * as rows. Until then, the structured output is returned to the caller for
 * logging / audit, and the DB write is skipped with a warning.
 *
 * This module does NOT block the interview on decomposition failure.
 */

import type { LLMProvider, LLMMessage } from './llm/types';
import type { CompetencyDimension } from './cultureQuestionBank';
import { COMPETENCY_DIMENSIONS } from './cultureQuestionBank';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DecomposedCulturalSignal {
  dimension: CompetencyDimension;
  evidence: string;
  scoreEstimate: 1 | 2 | 3 | 4 | 5;
  confidence: number;
}

export interface DecomposedExperience {
  company: string | undefined;
  role: string | undefined;
  narrative: string;
}

export interface DecomposedProject {
  name: string | undefined;
  narrative: string;
}

export interface DecomposedAnswer {
  culturalSignals: DecomposedCulturalSignal[];
  newExperiences: DecomposedExperience[];
  newProjects: DecomposedProject[];
  clarificationNeeded: boolean;
}

export interface DecompositionInput {
  provider: LLMProvider | null;
  questionText: string;
  candidateAnswer: string;
  targetDimension: CompetencyDimension;
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

export function buildDecompositionSystemPrompt(): string {
  return `You are a structured information extraction system. Your job is to read a candidate's behavioral interview answer and extract structured sub-elements.

# Output contract
Respond with ONE JSON object. No prose. No markdown fences. Exactly this shape:

{
  "culturalSignals": [
    {
      "dimension": "ownership | collaboration | learning-orientation | conflict-handling | self-awareness",
      "evidence": "verbatim quote from the answer that demonstrates this dimension",
      "scoreEstimate": 1-5,
      "confidence": 0.0-1.0
    }
  ],
  "newExperiences": [
    {
      "company": "string or omit",
      "role": "string or omit",
      "narrative": "one-sentence summary of the experience described"
    }
  ],
  "newProjects": [
    {
      "name": "string or omit",
      "narrative": "one-sentence summary of the project described"
    }
  ],
  "clarificationNeeded": false
}

Rules:
- culturalSignals: extract every dimension evidenced in the answer. Use verbatim quotes for evidence.
- scoreEstimate: rough BARS estimate (1=vague/generic, 3=specific, 5=quantified+reflective).
- confidence: your certainty that the signal is real (not the candidate's quality).
- newExperiences: only if the answer describes a workplace the candidate hasn't mentioned before.
- newProjects: only if the answer describes a project not previously mentioned.
- clarificationNeeded: true if the answer was evasive, off-topic, or too vague to extract anything meaningful.

Return ONLY the JSON object.`;
}

export function buildDecompositionUserMessage(input: DecompositionInput): string {
  return `# Question
${input.questionText}

# Target dimension
${input.targetDimension}

# Candidate answer
"""
${input.candidateAnswer.trim()}
"""

# Your task
Extract structured sub-elements from this answer. Produce the JSON object.`;
}

// ─── LLM call + parse ────────────────────────────────────────────────────────

export async function decomposeCandidateAnswer(
  input: DecompositionInput,
): Promise<DecomposedAnswer | null> {
  if (!input.provider) {
    // No provider — skip decomposition silently. The interview continues.
    return null;
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: buildDecompositionSystemPrompt() },
    { role: 'user', content: buildDecompositionUserMessage(input) },
  ];

  let content: string;
  try {
    const completion = await input.provider.complete(messages, { forceJson: true, maxTokens: 768 });
    content = (completion.content ?? '').trim();
  } catch (err) {
    console.error('[decomposeCandidateAnswer] LLM call failed:', err);
    return null;
  }

  if (!content) {
    console.warn('[decomposeCandidateAnswer] LLM returned empty content.');
    return null;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return parseDecomposedAnswer(parsed);
  } catch (err) {
    console.error('[decomposeCandidateAnswer] Failed to parse JSON:', content.slice(0, 300), err);
    return null;
  }
}

// ─── JSON parser ─────────────────────────────────────────────────────────────

function parseDecomposedAnswer(raw: unknown): DecomposedAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  return {
    culturalSignals: parseCulturalSignals(r.culturalSignals),
    newExperiences: parseExperiences(r.newExperiences),
    newProjects: parseProjects(r.newProjects),
    clarificationNeeded: r.clarificationNeeded === true,
  };
}

function parseCulturalSignals(raw: unknown): DecomposedCulturalSignal[] {
  if (!Array.isArray(raw)) return [];
  const out: DecomposedCulturalSignal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const dim = parseCompetencyDimension((item as Record<string, unknown>).dimension);
    if (!dim) continue;
    const evidence = typeof (item as Record<string, unknown>).evidence === 'string'
      ? ((item as Record<string, unknown>).evidence as string).trim()
      : '';
    const scoreEstimate = parseScoreInt((item as Record<string, unknown>).scoreEstimate);
    const confidence = parseConfidence((item as Record<string, unknown>).confidence);
    out.push({ dimension: dim, evidence, scoreEstimate, confidence });
  }
  return out;
}

function parseExperiences(raw: unknown): DecomposedExperience[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => item && typeof item === 'object')
    .map((item) => ({
      company: typeof item.company === 'string' ? item.company.trim() : (undefined as string | undefined),
      role: typeof item.role === 'string' ? item.role.trim() : (undefined as string | undefined),
      narrative: typeof item.narrative === 'string' ? item.narrative.trim() : '',
    }))
    .filter((e) => e.narrative.length > 0);
}

function parseProjects(raw: unknown): DecomposedProject[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => item && typeof item === 'object')
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim() : (undefined as string | undefined),
      narrative: typeof item.narrative === 'string' ? item.narrative.trim() : '',
    }))
    .filter((p) => p.narrative.length > 0);
}

function parseCompetencyDimension(v: unknown): CompetencyDimension | null {
  if (typeof v !== 'string') return null;
  const dim = v.trim().toLowerCase() as CompetencyDimension;
  return COMPETENCY_DIMENSIONS.includes(dim) ? dim : null;
}

function parseScoreInt(v: unknown): 1 | 2 | 3 | 4 | 5 {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 3;
  if (v < 1) return 1;
  if (v > 5) return 5;
  return Math.round(v) as 1 | 2 | 3 | 4 | 5;
}

function parseConfidence(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ─── Persistence (stub — candidate_nodes table does not exist yet) ───────────

export interface PersistDecompositionInput {
  db: unknown; // D1Database — typed as unknown to avoid import when table doesn't exist
  candidateId: string;
  sessionId: string;
  turnTimestamp: string;
  mode: 'profile_builder' | 'role_fit';
  decomposition: DecomposedAnswer;
}

/**
 * Persist decomposed CulturalSignal nodes to `candidate_nodes`.
 *
 * TODO: Enable when `candidate_nodes` table is created (migration 0045).
 * Until then, this function logs and returns without writing.
 */
export async function persistDecomposition(_input: PersistDecompositionInput): Promise<void> {
  // Stub: candidate_nodes table does not exist yet.
  // When enabled, insert rows with:
  //   node_type = 'CulturalSignal'
  //   source_type = mode === 'profile_builder' ? 'automated_screener' : 'culture_interview'
  //   source_reference = sessionId
  //   captured_at = turnTimestamp
  //   confidence = decomposition.culturalSignals[i].confidence
  console.log('[persistDecomposition] skipped — candidate_nodes table not yet created');
}
