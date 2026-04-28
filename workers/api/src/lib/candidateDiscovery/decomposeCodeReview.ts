/**
 * Code Review Graph Decomposition — converts a scored review session into
 * TechnicalDemonstration candidate sub-elements.
 *
 * Each of the 6 BARS dimensions produces one node. Decomposition failure is
 * caught and logged so it never breaks the score report write.
 */

import type { Env } from '../../types';
import type { ScoreReport } from '../scorerAgent';
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

function buildNarrative(
  dimension: string,
  score: number,
  evidence: string | undefined,
): string {
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
): Promise<void> {
  const candidateId = session.candidate_id;
  const capturedAt = Math.floor(new Date(session.updated_at).getTime() / 1000);
  const decompositionVersion = 'code_review_v1';

  const dimensionEntries = Object.entries(scoreReport.dimensions) as [
    string,
    number,
  ][];

  for (const [dimension, barsScore] of dimensionEntries) {
    const evidenceKey = DIMENSION_TO_EVIDENCE_KEY[dimension];
    const evidence = evidenceKey
      ? scoreReport.evidence[evidenceKey]
      : undefined;

    const narrativeText = buildNarrative(dimension, barsScore, evidence);

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

      await insertCandidateNode(db, {
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
