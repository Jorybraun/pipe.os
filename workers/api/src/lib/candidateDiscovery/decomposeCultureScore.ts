/**
 * Culture Score Graph Decomposition — converts a scored culture interview into
 * CulturalSignal candidate sub-elements.
 *
 * Each of the 10 scored dimensions (5 competency + 5 profile) produces one node.
 * Decomposition failure is caught and logged so it never breaks the score report write.
 */

import type { Env, CulturalSignalProperties } from '../../types';
import type { CultureScoreReport, CompetencyScoreResult, CultureProfileScoreResult } from '../cultureScorer';
import { insertCandidateNode, embedCandidateNode } from './candidateNodes';
import { computeCandidateCoverageWithFallback } from '../neo4j/candidateGraphQueries';
import { buildNeo4jConfig, getNeo4jDriver } from '../neo4j/driver';
import { resolveCultureRoleContext, hasTeamContext } from '../cultureRoleResolution';
import { openSemanticTermRecord } from '../livingContext/openTerms';

const DECOMPOSITION_VERSION = 'culture_score_v1';

function buildNarrative(
  dimension: string,
  score: number,
  evidenceQuotes: string[],
  reasoning: string,
): string {
  const topQuotes = evidenceQuotes.slice(0, 2);
  const quoteText = topQuotes.length > 0 ? `Evidence: "${topQuotes.join('" "')}".` : '';
  const reasoningText = reasoning?.trim() ?? '';

  const parts: string[] = [];
  if (quoteText) parts.push(quoteText);
  if (reasoningText) parts.push(reasoningText);

  if (parts.length === 0) {
    return `Culture dimension "${dimension}" scored ${score}/5. No specific evidence was recorded for this dimension.`;
  }

  return parts.join(' ');
}

interface DecomposeCultureScoreInput {
  db: D1Database;
  env: Env;
  session: {
    id: string;
    candidate_id: string;
    screener_mode: 'profile_builder' | 'role_fit' | null;
    assessment_id: string;
    updated_at: string;
  };
  scoreReport: CultureScoreReport;
}

export async function decomposeCultureScoreToGraph(
  input: DecomposeCultureScoreInput,
): Promise<void> {
  const { db, env, session, scoreReport } = input;
  const candidateId = session.candidate_id;
  const capturedAt = Math.floor(new Date(session.updated_at).getTime() / 1000);

  // Resolve role context id for role_fit sessions
  let roleContextId: string | undefined;
  if (session.screener_mode === 'role_fit') {
    try {
      const roleResolution = await resolveCultureRoleContext(db, session.assessment_id);
      if (hasTeamContext(roleResolution)) {
        roleContextId = roleResolution.teamContext.roleContextId;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[decomposeCultureScore] role context resolution failed:', msg);
    }
  }

  const isRoleSpecific = session.screener_mode === 'role_fit';
  const sourceType = isRoleSpecific ? 'culture_interview' : 'automated_screener';

  const dimensions: Array<
    | { type: 'competency'; result: CompetencyScoreResult }
    | { type: 'profile'; result: CultureProfileScoreResult }
  > = [
    ...scoreReport.competencyScores.map((r) => ({ type: 'competency' as const, result: r })),
    ...scoreReport.profileScores.map((r) => ({ type: 'profile' as const, result: r })),
  ];

  for (const item of dimensions) {
    const dimName = item.result.dimension;
    const score =
      item.type === 'competency'
        ? item.result.score
        : item.result.candidatePosition;
    const evidenceQuotes = item.result.evidenceQuotes;
    const reasoning = item.result.reasoning;
    const confidence = item.result.confidence;

    const narrativeText = buildNarrative(dimName, score, evidenceQuotes, reasoning);

    const extractedProperties: CulturalSignalProperties & {
      semantic_terms: NonNullable<ReturnType<typeof openSemanticTermRecord>>[];
    } = {
      dimension_type: item.type,
      dimension: dimName,
      semantic_terms: [openSemanticTermRecord(dimName, 'explained')]
        .filter((term): term is NonNullable<typeof term> => term !== null),
      bars_score: score,
      evidence_quotes: evidenceQuotes,
      reasoning,
      confidence,
      is_role_specific: isRoleSpecific,
      ...(roleContextId ? { role_context_id: roleContextId } : {}),
    };

    try {
      const embedding = await embedCandidateNode(
        narrativeText,
        env as { AI: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } },
      );

      await insertCandidateNode(db, {
        candidate_id: candidateId,
        node_type: 'CulturalSignal',
        narrative_text: narrativeText,
        extracted_properties_json: JSON.stringify(extractedProperties),
        embedding_json: JSON.stringify(embedding),
        source_type: sourceType,
        source_reference: session.id,
        captured_at: capturedAt,
        confidence,
        supersedes: null,
        superseded_at: null,
        decomposition_version: DECOMPOSITION_VERSION,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[decomposeCultureScore] failed to create node for dimension ${dimName}, session ${session.id}:`,
        msg,
      );
      // Continue to next dimension — partial decomposition is acceptable
    }
  }

  // Update coverage after all nodes are inserted
  const neo4jConfig = buildNeo4jConfig(env);
  const driver = neo4jConfig ? getNeo4jDriver(neo4jConfig) : null;
  try {
    await computeCandidateCoverageWithFallback(db, candidateId, driver);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[decomposeCultureScore] computeCandidateCoverage failed for candidate ${candidateId}, session ${session.id}:`,
      msg,
    );
  }
}
