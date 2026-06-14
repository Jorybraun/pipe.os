import type { CultureTranscript } from '../cultureAgent';
import {
  decomposeAnswerContextually,
  type ContextualDecomposition,
} from '../cultureContextualDecomposition';
import type { LLMProvider } from '../llm/types';
import { ingestCultureTurnToLivingContext } from './cultureTurn';
import { ensureCandidateLivingContext } from './compatibility';
import { deterministicEntityId, LivingContextStore } from './persistence';

export interface HistoricalCultureTranscriptInput {
  candidateId: string;
  sessionId: string;
  transcript: CultureTranscript;
  provider?: LLMProvider | null;
  extractSemantics?: boolean;
  fallbackObservedAt?: string | null;
  sessionStartedAt?: string | null;
  sessionEndedAt?: string | null;
}

export interface HistoricalCultureTranscriptResult {
  answeredTurns: number;
  ingestedTurns: number;
  extractedTurns: number;
  extractionFailures: number;
  reusedTurns: number;
  sourceOnlyTurns: number;
  assertionCount: number;
  signalCount: number;
}

function sourceOnlyDecomposition(): ContextualDecomposition {
  return {
    statements: [],
    edges: [],
    discarded: false,
    probe: null,
    missingContext: [],
  };
}

function recordedDecomposition(
  transcript: CultureTranscript,
  turnIndex: number,
): ContextualDecomposition | null {
  const recorded = transcript.scratchpad.contextualTurns?.find(
    (turn) => turn.turnIdx === turnIndex,
  );
  if (!recorded) return null;
  return {
    statements: recorded.statements,
    edges: recorded.edges,
    discarded: recorded.discarded,
    probe: null,
    missingContext: recorded.missingContext ?? [],
  };
}

/**
 * Replays historical culture turns through the canonical living-context path.
 * Exact question/answer text is always persisted. Semantic extraction is
 * optional so a missing provider never blocks source preservation.
 */
export async function ingestHistoricalCultureTranscript(
  db: D1Database,
  input: HistoricalCultureTranscriptInput,
): Promise<HistoricalCultureTranscriptResult> {
  const result: HistoricalCultureTranscriptResult = {
    answeredTurns: 0,
    ingestedTurns: 0,
    extractedTurns: 0,
    extractionFailures: 0,
    reusedTurns: 0,
    sourceOnlyTurns: 0,
    assertionCount: 0,
    signalCount: 0,
  };
  const priorPhrases: string[] = [];
  const turns = [...input.transcript.turns].sort((left, right) => left.idx - right.idx);
  const answeredTurns = turns.filter((turn) => turn.candidateResponse !== null);
  const firstAnsweredAt = answeredTurns[0]?.timestamp ?? null;
  if (answeredTurns.length === 0) return result;

  const identity = await ensureCandidateLivingContext(db, input.candidateId);
  if (!identity) return result;
  const store = new LivingContextStore(db);
  await store.upsertInteraction({
    ingestionKey: `culture-session:${input.sessionId}:person:${identity.workspacePersonId}`,
    workspacePersonId: identity.workspacePersonId,
    applicationId: identity.applicationId,
    interactionType: 'culture_interview',
    externalReference: input.sessionId,
    startedAt: input.sessionStartedAt ?? firstAnsweredAt,
    endedAt: input.sessionEndedAt ?? null,
    metadata: { sessionId: input.sessionId },
  });

  for (const turn of turns) {
    if (turn.candidateResponse === null) continue;
    result.answeredTurns++;
    const contentHash = await deterministicEntityId(
      'content',
      `${turn.questionText}\n\n${turn.candidateResponse}`,
    );
    const currentProjection = await db.prepare(
      `SELECT spr.id,
              (SELECT COUNT(*)
                 FROM semantic_projection_entities spe
                WHERE spe.run_id = spr.id AND spe.entity_type = 'assertion'
              ) AS assertion_count,
              (SELECT COUNT(*)
                 FROM semantic_projection_entities spe
                 JOIN signal_evidence se ON se.assertion_id = spe.entity_id
                WHERE spe.run_id = spr.id AND spe.entity_type = 'assertion'
              ) AS signal_count
         FROM artifacts a
         JOIN artifact_versions av
           ON av.artifact_id = a.id AND av.content_hash = ?1
         JOIN semantic_projection_runs spr
           ON spr.artifact_id = a.id
          AND spr.artifact_version_id = av.id
          AND spr.projection_type = 'culture_turn_semantics'
        WHERE a.ingestion_key = ?2
        LIMIT 1`,
    ).bind(
      contentHash,
      `culture-session:${input.sessionId}:turn:${turn.idx}`,
    ).first<{ id: string; assertion_count: number; signal_count: number }>();
    if (currentProjection) {
      const existingAssertions = await db.prepare(
        `SELECT sa.narrative
           FROM semantic_projection_entities spe
           JOIN semantic_assertions sa ON sa.id = spe.entity_id
          WHERE spe.run_id = ?1 AND spe.entity_type = 'assertion'
          ORDER BY sa.id`,
      ).bind(currentProjection.id).all<{ narrative: string | null }>();
      priorPhrases.push(
        ...(existingAssertions.results ?? []).flatMap((assertion) =>
          assertion.narrative ? [assertion.narrative] : []
        ),
      );
      result.ingestedTurns++;
      result.reusedTurns++;
      result.assertionCount += Number(currentProjection.assertion_count ?? 0);
      result.signalCount += Number(currentProjection.signal_count ?? 0);
      continue;
    }

    let decomposition = recordedDecomposition(input.transcript, turn.idx);
    if (!decomposition && input.extractSemantics && input.provider) {
      decomposition = await decomposeAnswerContextually(input.provider, {
        question: turn.questionText,
        answer: turn.candidateResponse,
        priorPhrases,
      });
      if (decomposition) result.extractedTurns++;
      else result.extractionFailures++;
    }
    if (!decomposition) {
      decomposition = sourceOnlyDecomposition();
      result.sourceOnlyTurns++;
    }

    const ingested = await ingestCultureTurnToLivingContext(db, {
      candidateId: input.candidateId,
      sessionId: input.sessionId,
      turnIndex: turn.idx,
      question: turn.questionText,
      answer: turn.candidateResponse,
      observedAt: turn.timestamp || input.fallbackObservedAt || new Date(0).toISOString(),
      interactionStartedAt: input.sessionStartedAt ?? firstAnsweredAt,
      interactionEndedAt: input.sessionEndedAt ?? null,
      decomposition,
      videoStorageKey: turn.videoR2Key ?? null,
    });
    result.ingestedTurns++;
    result.assertionCount += ingested.assertionCount;
    result.signalCount += ingested.signalCount;
    priorPhrases.push(...decomposition.statements.map((statement) => statement.phrase));
  }

  return result;
}
