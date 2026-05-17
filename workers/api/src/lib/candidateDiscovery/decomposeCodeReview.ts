/**
 * Code Review Graph Decomposition — converts a scored review session into
 * TechnicalDemonstration candidate sub-elements.
 *
 * Each of the 6 BARS dimensions produces one node. Decomposition failure is
 * caught and logged so it never breaks the score report write.
 */

import type { Env } from '../../types';
import type { ScoreReport } from '../scorerAgent';
import type { ReviewRound } from '../implementerAgent';
import { insertCandidateNode, embedCandidateNode } from './candidateNodes';
import { computeCandidateCoverage } from './candidateCoverage';

const DIMENSION_TO_EVIDENCE_KEY: Record<
  string,
  keyof ScoreReport['evidence']
> = {
  issue_identification: 'issue_identification_evidence',
  reasoning_quality: 'reasoning_quality_evidence',
  prioritization: 'prioritization_evidence',
  question_formation: 'question_formation_evidence',
  revision_evaluation: 'revision_evaluation_evidence',
  ai_direction: 'ai_direction_evidence',
};

/** Serialises candidate (reviewer) text from transcript rounds for LLM narrative generation. */
function serialiseTranscript(rounds: ReviewRound[]): string {
  const lines: string[] = [];
  for (const round of rounds) {
    lines.push(`\n--- Round ${round.round} ---`);
    if (round.reviewer_comments?.length) {
      for (const c of round.reviewer_comments) {
        lines.push(`[Comment on ${c.file ?? 'file'} line ${c.line ?? '?'}]`);
        lines.push(`What: ${c.what}`);
        if (c.why) lines.push(`Why: ${c.why}`);
        if (c.suggestion) lines.push(`Suggestion: ${c.suggestion}`);
      }
    }
    if (round.reviewer_summary) {
      lines.push(`[Round summary] ${round.reviewer_summary}`);
    }
    if (round.reviewer_verdict) {
      lines.push(`[Verdict] ${round.reviewer_verdict}`);
    }
  }
  return lines.join('\n');
}

const NARRATIVE_GENERATION_PROMPT = `You are an evidence-synthesis assistant. Given a code review transcript and a BARS scoring rubric, write a concise 2-sentence third-person evidence narrative for each of the 6 dimensions below.

Dimensions:
1. issue_identification — spotting bugs, security issues, logic errors
2. reasoning_quality — clarity and depth of explanations
3. prioritization — ranking issues by severity/importance
4. question_formation — asking clarifying questions
5. revision_evaluation — assessing whether fixes actually resolve problems
6. ai_direction — guiding the implementer toward better solutions

Output STRICTLY as a JSON object with exactly these keys: issue_identification, reasoning_quality, prioritization, question_formation, revision_evaluation, ai_direction. Each value is a single string (2 sentences). No markdown, no commentary outside the JSON.`;

interface GeneratedNarratives {
  issue_identification?: string;
  reasoning_quality?: string;
  prioritization?: string;
  question_formation?: string;
  revision_evaluation?: string;
  ai_direction?: string;
}

async function generateTranscriptNarratives(
  rounds: ReviewRound[],
  ai: Ai,
): Promise<GeneratedNarratives | null> {
  if (!rounds || rounds.length === 0) return null;

  const transcriptText = serialiseTranscript(rounds);
  const userMessage = `Transcript:\n${transcriptText}\n\nGenerate the 6 evidence narratives as JSON.`;

  try {
    const response = await ai.run(
      '@cf/qwen/qwen2.5-coder-32b-instruct' as Parameters<typeof ai.run>[0],
      {
        messages: [
          { role: 'system', content: NARRATIVE_GENERATION_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 1024,
      },
    );

    let raw = '';
    if (response instanceof ReadableStream) {
      const reader = response.getReader();
      const chunks: string[] = [];
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) chunks.push(new TextDecoder().decode(result.value));
      }
      raw = chunks.join('').trim();
    } else {
      const r = (response as { response?: unknown }).response;
      raw = typeof r === 'string' ? r.trim() : String(r ?? '').trim();
    }

    // Extract JSON using the same brace-matching logic as scorerAgent
    const parsed = extractJson<GeneratedNarratives>(raw);
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[decomposeCodeReview] transcript narrative generation failed:', msg);
    return null;
  }
}

/** Re-implementation of scorerAgent's extractJson to avoid circular dependency. */
function extractJson<T>(raw: string): T {
  let cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  const start =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
        ? firstBrace
        : Math.min(firstBrace, firstBracket);

  if (start === -1) {
    throw new Error('No JSON start found');
  }

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  const opener = cleaned[start];
  const closer = opener === '{' ? '}' : ']';

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === opener) depth++;
    if (ch === closer) depth--;
    if (depth === 0) {
      const jsonText = cleaned.slice(start, i + 1);
      return JSON.parse(jsonText) as T;
    }
  }

  throw new Error('Unbalanced JSON braces');
}

function buildNarrative(
  dimension: string,
  score: number,
  evidence: string | undefined,
  transcriptNarrative: string | undefined,
): string {
  // Prefer LLM-generated transcript narrative, then evidence, then generic fallback
  if (transcriptNarrative && transcriptNarrative.trim().length > 0) {
    return transcriptNarrative.trim();
  }
  if (evidence && evidence.trim().length > 0) {
    return evidence.trim();
  }
  return `Code review dimension "${dimension}" scored ${score}/5. No specific evidence was recorded for this dimension.`;
}

export async function decomposeCodeReviewToGraph(
  db: D1Database,
  env: Env,
  session: {
    id: string;
    candidate_id: string;
    updated_at: string;
    implementer_persona: string;
    challenge_id: string;
  },
  scoreReport: ScoreReport,
  transcript?: ReviewRound[],
): Promise<void> {
  const candidateId = session.candidate_id;
  const capturedAt = Math.floor(new Date(session.updated_at).getTime() / 1000);
  const decompositionVersion = 'code_review_v1';

  // Generate transcript-derived narratives in one LLM call (non-blocking)
  let transcriptNarratives: GeneratedNarratives | null = null;
  if (transcript && transcript.length > 0) {
    transcriptNarratives = await generateTranscriptNarratives(transcript, env.AI);
  }

  const dimensionEntries = Object.entries(scoreReport.dimensions) as [
    string,
    number,
  ][];

  for (const [dimension, barsScore] of dimensionEntries) {
    const evidenceKey = DIMENSION_TO_EVIDENCE_KEY[dimension];
    const evidence = evidenceKey
      ? scoreReport.evidence[evidenceKey]
      : undefined;

    const transcriptNarrative = transcriptNarratives?.[dimension as keyof GeneratedNarratives];
    const narrativeText = buildNarrative(dimension, barsScore, evidence, transcriptNarrative);

    const extractedProperties = {
      dimension,
      bars_score: barsScore,
      effectiveness_metrics: {
        bugs_found_pct: scoreReport.metrics.bugs_found_pct,
        false_positive_count: scoreReport.metrics.false_positive_count,
        cave_ratio: scoreReport.metrics.cave_ratio,
        fix_verifications: scoreReport.metrics.fix_verifications,
      },
      implementer_persona: session.implementer_persona,
      challenge_repo_id: session.challenge_id,
    };

    try {
      const embedding = await embedCandidateNode(narrativeText, env as { AI: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } });

      const insertedNode = await insertCandidateNode(db, {
        candidate_id: candidateId,
        node_type: 'TechnicalDemonstration',
        narrative_text: narrativeText,
        extracted_properties_json: JSON.stringify(extractedProperties),
        embedding_json: JSON.stringify(embedding),
        source_type: 'code_review_session',
        source_reference: session.id,
        captured_at: capturedAt,
        confidence: barsScore / 5, // normalize 1-5 to 0-1
        supersedes: null,
        superseded_at: null,
        decomposition_version: decompositionVersion,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[decomposeCodeReview] failed to create node for dimension ${dimension}, session ${session.id}:`,
        msg,
      );
      // Continue to next dimension — partial decomposition is acceptable
    }
  }

  // Update coverage after all nodes are inserted
  try {
    await computeCandidateCoverage(db, candidateId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[decomposeCodeReview] computeCandidateCoverage failed for candidate ${candidateId}, session ${session.id}:`,
      msg,
    );
  }
}
