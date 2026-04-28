/**
 * Implementation Scorer Orchestrator — scores CODE_IMPLEMENTATION submissions
 * via Sherlock 4-dimension BARS rubric using Gemma.
 *
 * Called asynchronously via ctx.waitUntil from /rpc/score-submission.
 */

import type { Env } from '../../types';
import type { ImplementationScoreReport, ImplementationScoreDimension } from './types';
import { SHERLOCK_DIMENSIONS } from './types';
import {
  buildReasoningDecompositionPrompt,
  buildCodeConstructionPrompt,
  buildAdaptabilityPrompt,
  buildDebuggingMaintenancePrompt,
} from './prompts';
import { insertCandidateNode, embedCandidateNode } from '../candidateDiscovery/candidateNodes';
import { computeCandidateCoverage } from '../candidateDiscovery/candidateCoverage';
import { logAiUsage } from '../aiUsage';

const MODEL = '@cf/google/gemma-3-27b-it';

interface DimensionPromptBuilder {
  (input: { submissionText: string; challengeInstructions: string; repoContext?: string | undefined }): string;
}

const PROMPT_BUILDERS: Record<string, DimensionPromptBuilder> = {
  reasoning_decomposition: buildReasoningDecompositionPrompt,
  code_construction: buildCodeConstructionPrompt,
  adaptability: buildAdaptabilityPrompt,
  debugging_maintenance: buildDebuggingMaintenancePrompt,
};

interface RawDimensionResult {
  bars_score: number;
  evidence_quotes: string[];
  reasoning: string;
  confidence: number;
}

function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function scoreDimension(
  ai: Env['AI'],
  dimension: string,
  submissionText: string,
  challengeInstructions: string,
  repoContext?: string,
): Promise<ImplementationScoreDimension> {
  const builder = PROMPT_BUILDERS[dimension];
  if (!builder) {
    throw new Error(`[implementationScorer] unknown dimension: ${dimension}`);
  }

  const prompt = builder({ submissionText, challengeInstructions, repoContext });

  const response = (await ai.run(MODEL as keyof AiModels, {
    messages: [{ role: 'user', content: prompt }],
  })) as { response?: string };

  const rawText = response?.response ?? '';
  const cleaned = rawText.replace(/^```json\s*|\s*```$/g, '').trim();
  const parsed = safeParseJson<RawDimensionResult>(cleaned);

  if (!parsed || typeof parsed.bars_score !== 'number') {
    throw new Error(
      `[implementationScorer] invalid JSON for dimension ${dimension}: ${rawText.slice(0, 200)}`,
    );
  }

  return {
    dimension: dimension as ImplementationScoreDimension['dimension'],
    bars_score: Math.max(1, Math.min(5, Math.round(parsed.bars_score))),
    evidence_quotes: Array.isArray(parsed.evidence_quotes)
      ? parsed.evidence_quotes.filter((s): s is string => typeof s === 'string')
      : [],
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  };
}

export async function scoreImplementationSubmission(
  submissionId: string,
  env: Env,
): Promise<ImplementationScoreReport> {
  // Fetch submission + challenge
  const row = await env.DB.prepare(`
    SELECT
      cs.id,
      cs.response_json,
      cs.candidate_id,
      ch.instructions,
      ch.config,
      ch.server_config,
      ch.github_repo_url
    FROM challenge_submissions cs
    JOIN challenges ch ON ch.id = cs.challenge_id
    WHERE cs.id = ?1
  `)
    .bind(submissionId)
    .first<{
      id: string;
      response_json: string | null;
      candidate_id: string;
      instructions: string | null;
      config: string | null;
      server_config: string | null;
      github_repo_url: string | null;
    }>();

  if (!row) {
    throw new Error(`[implementationScorer] submission not found: ${submissionId}`);
  }

  const submissionText = row.response_json ?? '';
  const challengeInstructions = row.instructions ?? 'No instructions provided.';

  // Extract repo context from config if available
  let repoContext: string | undefined;
  if (row.config) {
    try {
      const config = JSON.parse(row.config) as Record<string, unknown>;
      if (config.issueTitle && config.issueNumber) {
        repoContext = `Issue #${config.issueNumber}: ${config.issueTitle}`;
      }
    } catch { /* ignore */ }
  }
  if (row.github_repo_url && !repoContext) {
    repoContext = `Repository: ${row.github_repo_url}`;
  }

  // Score all 4 dimensions
  const dimensions: ImplementationScoreDimension[] = [];
  for (const dim of SHERLOCK_DIMENSIONS) {
    try {
      const result = await scoreDimension(env.AI, dim, submissionText, challengeInstructions, repoContext);
      dimensions.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[implementationScorer] dimension ${dim} failed for submission ${submissionId}:`, msg);
      throw new Error(`[implementationScorer] dimension ${dim} scoring failed: ${msg}`);
    }
  }

  // Log aggregated AI usage
  void logAiUsage(env.DB, {
    feature: 'implementation_scoring',
    refId: submissionId,
    subRefId: row.candidate_id,
    provider: 'workers-ai',
    model: MODEL,
    usage: { inputTokens: 0, outputTokens: 0 }, // TODO: extract real token counts from Workers AI response when available
    success: true,
  });

  const overallConfidence = dimensions.length > 0
    ? dimensions.reduce((sum, d) => sum + d.confidence, 0) / dimensions.length
    : 0;

  const report: ImplementationScoreReport = {
    dimensions,
    telemetry_features: {
      tdd_ratio: null,
      debug_strategy_pattern: null,
      ai_collaboration_style: null,
      commit_frequency: null,
    },
    synthesis: dimensions.map((d) => `${d.dimension}: ${d.bars_score}/5 — ${d.reasoning}`).join('\n'),
    overall_confidence: overallConfidence,
    scored_at: Math.floor(Date.now() / 1000),
  };

  // Write score report to D1
  await env.DB.prepare(`
    UPDATE challenge_submissions
    SET score_report_json = ?1,
        hitl_status = 'PENDING_REVIEW',
        updated_at = ?2
    WHERE id = ?3
  `)
    .bind(JSON.stringify(report), new Date().toISOString(), submissionId)
    .run();

  // Decompose into graph nodes
  try {
    await decomposeImplementationToGraph(env, row.candidate_id, submissionId, report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[implementationScorer] graph decomposition failed for submission ${submissionId}:`, msg);
  }

  return report;
}

async function decomposeImplementationToGraph(
  env: Env,
  candidateId: string,
  submissionId: string,
  report: ImplementationScoreReport,
): Promise<void> {
  const capturedAt = report.scored_at;
  const decompositionVersion = 'implementation_v1';

  // 4 TechnicalDemonstration nodes (one per scored dimension)
  for (const dim of report.dimensions) {
    const narrativeText = dim.reasoning || `${dim.dimension}: scored ${dim.bars_score}/5`;
    const extractedProperties = {
      dimension: dim.dimension,
      bars_score: dim.bars_score,
      evidence_quotes: dim.evidence_quotes,
      confidence: dim.confidence,
    };

    try {
      const embedding = await embedCandidateNode(
        narrativeText,
        env as { AI: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } },
      );

      await insertCandidateNode(env.DB, {
        candidate_id: candidateId,
        node_type: 'TechnicalDemonstration',
        narrative_text: narrativeText,
        extracted_properties_json: JSON.stringify(extractedProperties),
        embedding_json: JSON.stringify(embedding),
        source_type: 'implementation_challenge',
        source_reference: submissionId,
        captured_at: capturedAt,
        confidence: dim.confidence,
        supersedes: null,
        superseded_at: null,
        decomposition_version: decompositionVersion,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[implementationScorer] failed to embed/insert TechnicalDemonstration for ${dim.dimension}:`,
        msg,
      );
    }
  }

  // 3 WorkingStyle nodes from telemetry features
  const telemetry = report.telemetry_features;
  const workingStyleEntries: Array<{ label: string; value: string | number | null }> = [
    { label: 'tdd_ratio', value: telemetry.tdd_ratio },
    { label: 'debug_strategy_pattern', value: telemetry.debug_strategy_pattern },
    { label: 'ai_collaboration_style', value: telemetry.ai_collaboration_style },
  ];

  for (const entry of workingStyleEntries) {
    if (entry.value === null) continue;

    const narrativeText = `Working style signal from implementation challenge: ${entry.label} = ${entry.value}`;
    const extractedProperties = {
      feature: entry.label,
      value: entry.value,
    };

    try {
      const embedding = await embedCandidateNode(
        narrativeText,
        env as { AI: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } },
      );

      await insertCandidateNode(env.DB, {
        candidate_id: candidateId,
        node_type: 'WorkingStyle',
        narrative_text: narrativeText,
        extracted_properties_json: JSON.stringify(extractedProperties),
        embedding_json: JSON.stringify(embedding),
        source_type: 'implementation_challenge',
        source_reference: submissionId,
        captured_at: capturedAt,
        confidence: report.overall_confidence,
        supersedes: null,
        superseded_at: null,
        decomposition_version: decompositionVersion,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[implementationScorer] failed to embed/insert WorkingStyle for ${entry.label}:`,
        msg,
      );
    }
  }

  // Update coverage
  try {
    await computeCandidateCoverage(env.DB, candidateId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[implementationScorer] computeCandidateCoverage failed for ${candidateId}:`, msg);
  }
}
