/**
 * Persists one answered culture-interview turn.
 *
 * The living-context artifact in D1 is authoritative. Candidate nodes remain
 * as a compatibility/search projection while older consumers are migrated;
 * they must not create a second semantic graph or write Neo4j directly.
 */

import type { Env } from '../types';
import type { ContextualDecomposition } from './cultureContextualDecomposition';
import { contextualDecompositionVersion } from './cultureContextualDecomposition';
import {
  embedCandidateNodes,
  insertCandidateNode,
} from './candidateDiscovery/candidateNodes';
import { ingestCultureTurnToLivingContext } from './livingContext';

export interface PersistContextualTurnInput {
  candidateId: string;
  sessionId: string;
  turnIndex: number;
  question: string;
  /** Exact request text before normalization for prompting. */
  answer: string;
  observedAt: string;
  decomposition?: ContextualDecomposition | null;
  videoStorageKey?: string | null;
}

function candidateNodeProperties(
  statement: ContextualDecomposition['statements'][number],
): string {
  return JSON.stringify({
    surface: statement.surface ?? null,
    source_quote: statement.sourceQuote ?? null,
    semantic_terms: (statement.semanticTerms ?? []).map((term) => ({
      surface: term.surface,
      relationship: term.relationship,
      weight: term.weight,
      evidence_level: term.evidenceLevel,
      strength: term.strength,
    })),
  });
}

async function persistCompatibilityNodes(
  env: Env,
  db: D1Database,
  input: PersistContextualTurnInput,
  decomposition: ContextualDecomposition,
): Promise<number> {
  if (decomposition.statements.length === 0) return 0;
  const vectors = await embedCandidateNodes(
    decomposition.statements.map((statement) => statement.phrase),
    env as {
      AI: {
        run: (
          model: string,
          input: { text: string[] },
        ) => Promise<{ data?: number[][] }>;
      };
    },
  );
  const capturedAt = Math.floor(new Date(input.observedAt).getTime() / 1000);
  const safeCapturedAt = Number.isFinite(capturedAt)
    ? capturedAt
    : Math.floor(Date.now() / 1000);

  for (let index = 0; index < decomposition.statements.length; index++) {
    const statement = decomposition.statements[index]!;
    await insertCandidateNode(
      db,
      {
        candidate_id: input.candidateId,
        node_type: statement.type,
        narrative_text: statement.phrase,
        extracted_properties_json: candidateNodeProperties(statement),
        embedding_json: JSON.stringify(vectors[index]!),
        source_type: 'culture_contextual',
        source_reference: `${input.sessionId}:turn:${input.turnIndex}`,
        captured_at: safeCapturedAt,
        confidence: statement.confidence ?? null,
        supersedes: null,
        superseded_at: null,
        decomposition_version: contextualDecompositionVersion(),
      },
      { mirrorLivingContext: false },
    );
  }
  return decomposition.statements.length;
}

export async function persistContextualTurn(
  env: Env,
  db: D1Database,
  input: PersistContextualTurnInput,
): Promise<void> {
  try {
    const decomposition = input.decomposition ?? {
      statements: [],
      edges: [],
      discarded: false,
      probe: null,
      missingContext: [],
    };
    const canonical = await ingestCultureTurnToLivingContext(db, {
      candidateId: input.candidateId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      question: input.question,
      answer: input.answer,
      observedAt: input.observedAt,
      decomposition,
      videoStorageKey: input.videoStorageKey,
    });

    let compatibilityNodeCount = 0;
    try {
      compatibilityNodeCount = await persistCompatibilityNodes(
        env,
        db,
        input,
        decomposition,
      );
    } catch (error) {
      console.error('[persistContextualTurn] compatibility projection failed:', {
        candidateId: input.candidateId,
        sessionId: input.sessionId,
        turnIndex: input.turnIndex,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    console.log(JSON.stringify({
      event: 'culture.contextualTurnPersisted',
      candidateId: input.candidateId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      assertionsWritten: canonical.assertionCount,
      signalsWritten: canonical.signalCount,
      compatibilityNodesWritten: compatibilityNodeCount,
    }));
  } catch (error) {
    console.error('[persistContextualTurn] canonical ingestion failed:', {
      candidateId: input.candidateId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
