import type { ContextualDecomposition } from '../cultureContextualDecomposition';
import { ensureCandidateLivingContext } from './compatibility';
import { rebuildLivingContextSignalSnapshot } from './meetingTranscript';
import {
  OPEN_TERM_RESOLVER_VERSION,
  openSemanticTerm,
} from './openTerms';
import {
  deterministicEntityId,
  LivingContextStore,
  stableJson,
} from './persistence';
import type { JsonValue } from './types';

const PROJECTION_TYPE = 'culture_turn_semantics';

export interface CultureTurnIngestionInput {
  candidateId: string;
  sessionId: string;
  turnIndex: number;
  question: string;
  answer: string;
  observedAt: string;
  interactionStartedAt?: string | null;
  interactionEndedAt?: string | null;
  decomposition: ContextualDecomposition;
  videoStorageKey?: string | null;
}

interface ArtifactVersionRow {
  id: string;
  version_number: number;
}

function byteOffset(text: string, charOffset: number): number {
  return new TextEncoder().encode(text.slice(0, charOffset)).byteLength;
}

function boundedScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

async function removePriorProjection(
  db: D1Database,
  artifactId: string,
): Promise<Array<{ workspace_person_id: string; signal_key: string }>> {
  const affected = await db.prepare(
    `SELECT DISTINCT se.workspace_person_id, se.signal_key
       FROM semantic_projection_runs spr
       JOIN semantic_projection_entities spe
         ON spe.run_id = spr.id AND spe.entity_type = 'assertion'
       JOIN signal_evidence se ON se.assertion_id = spe.entity_id
      WHERE spr.artifact_id = ?1 AND spr.projection_type = ?2`,
  ).bind(artifactId, PROJECTION_TYPE)
    .all<{ workspace_person_id: string; signal_key: string }>();
  await db.prepare(
    `DELETE FROM semantic_relationships
      WHERE id IN (
        SELECT spe.entity_id
          FROM semantic_projection_runs spr
          JOIN semantic_projection_entities spe ON spe.run_id = spr.id
         WHERE spr.artifact_id = ?1
           AND spr.projection_type = ?2
           AND spe.entity_type = 'semantic_relationship'
      )`,
  ).bind(artifactId, PROJECTION_TYPE).run();
  await db.prepare(
    `DELETE FROM semantic_assertions
      WHERE id IN (
        SELECT spe.entity_id
          FROM semantic_projection_runs spr
          JOIN semantic_projection_entities spe ON spe.run_id = spr.id
         WHERE spr.artifact_id = ?1
           AND spr.projection_type = ?2
           AND spe.entity_type = 'assertion'
      )`,
  ).bind(artifactId, PROJECTION_TYPE).run();
  await db.prepare(
    `DELETE FROM episodes
      WHERE id IN (
        SELECT spe.entity_id
          FROM semantic_projection_runs spr
          JOIN semantic_projection_entities spe ON spe.run_id = spr.id
         WHERE spr.artifact_id = ?1
           AND spr.projection_type = ?2
           AND spe.entity_type = 'episode'
      )`,
  ).bind(artifactId, PROJECTION_TYPE).run();
  await db.prepare(
    `DELETE FROM semantic_projection_runs
      WHERE artifact_id = ?1 AND projection_type = ?2`,
  ).bind(artifactId, PROJECTION_TYPE).run();
  return affected.results ?? [];
}

async function linkProjectionEntity(
  db: D1Database,
  runId: string,
  entityType: string,
  entityId: string,
  createdAt: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO semantic_projection_entities (
       run_id, entity_type, entity_id, created_at
     ) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(run_id, entity_type, entity_id) DO NOTHING`,
  ).bind(runId, entityType, entityId, createdAt).run();
}

export async function ingestCultureTurnToLivingContext(
  db: D1Database,
  input: CultureTurnIngestionInput,
): Promise<{ assertionCount: number; signalCount: number }> {
  const identity = await ensureCandidateLivingContext(db, input.candidateId);
  if (!identity) return { assertionCount: 0, signalCount: 0 };
  const store = new LivingContextStore(db);
  const interaction = await store.upsertInteraction({
    ingestionKey: `culture-session:${input.sessionId}:person:${identity.workspacePersonId}`,
    workspacePersonId: identity.workspacePersonId,
    applicationId: identity.applicationId,
    interactionType: 'culture_interview',
    externalReference: input.sessionId,
    startedAt: input.interactionStartedAt ?? null,
    endedAt: input.interactionEndedAt ?? null,
    metadata: { sessionId: input.sessionId },
  });
  const artifact = await store.upsertArtifact({
    ingestionKey: `culture-session:${input.sessionId}:turn:${input.turnIndex}`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'culture_interview_turn',
    logicalKey: `${input.sessionId}:turn:${input.turnIndex}`,
    metadata: {
      turnIndex: input.turnIndex,
      videoStorageKey: input.videoStorageKey ?? null,
    },
  });
  const contentText = `${input.question}\n\n${input.answer}`;
  const answerStart = input.question.length + 2;
  const contentHash = await deterministicEntityId('content', contentText);
  let version = await db.prepare(
    `SELECT id, version_number
       FROM artifact_versions
      WHERE artifact_id = ?1 AND content_hash = ?2`,
  ).bind(artifact.id, contentHash).first<ArtifactVersionRow>();
  if (!version) {
    const latest = await db.prepare(
      `SELECT COALESCE(MAX(version_number), 0) AS version_number
         FROM artifact_versions WHERE artifact_id = ?1`,
    ).bind(artifact.id).first<{ version_number: number }>();
    const versionNumber = Number(latest?.version_number ?? 0) + 1;
    const persisted = await store.createArtifactVersion({
      ingestionKey: `culture-session:${input.sessionId}:turn:${input.turnIndex}:${contentHash}`,
      artifactId: artifact.id,
      versionNumber,
      contentHash,
      mediaType: 'text/plain',
      contentText,
      byteLength: new TextEncoder().encode(contentText).byteLength,
      metadata: { turnIndex: input.turnIndex },
    });
    version = { id: persisted.id, version_number: versionNumber };
  }
  const questionSpan = await store.createSourceSpan({
    ingestionKey: `culture-session:${input.sessionId}:turn:${input.turnIndex}:${version.id}:question`,
    artifactVersionId: version.id,
    stableSegmentId: `turn-${input.turnIndex}:question`,
    byteStart: 0,
    byteEnd: byteOffset(contentText, input.question.length),
    charStart: 0,
    charEnd: input.question.length,
    lineStart: 1,
    lineEnd: Math.max(1, input.question.split('\n').length),
    exactText: input.question,
    metadata: { role: 'interviewer', turnIndex: input.turnIndex },
  });
  const answerLineStart = input.question.split('\n').length + 2;
  const answerSpan = await store.createSourceSpan({
    ingestionKey: `culture-session:${input.sessionId}:turn:${input.turnIndex}:${version.id}:answer`,
    artifactVersionId: version.id,
    stableSegmentId: `turn-${input.turnIndex}:answer`,
    byteStart: byteOffset(contentText, answerStart),
    byteEnd: byteOffset(contentText, contentText.length),
    charStart: answerStart,
    charEnd: contentText.length,
    lineStart: answerLineStart,
    lineEnd: answerLineStart + Math.max(0, input.answer.split('\n').length - 1),
    exactText: input.answer,
    metadata: { role: 'candidate', turnIndex: input.turnIndex },
  });

  const priorSignals = await removePriorProjection(db, artifact.id);
  const outputHash = await deterministicEntityId(
    'semantic_projection',
    stableJson(input.decomposition as unknown as JsonValue),
  );
  const extractorVersion = 'culture-contextual-v3';
  const runId = await deterministicEntityId(
    'semantic_projection_run',
    `${artifact.id}:${version.id}:${extractorVersion}:${outputHash}`,
  );
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO semantic_projection_runs (
       id, ingestion_key, artifact_id, artifact_version_id, projection_type,
       extractor_version, output_hash, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(
    runId,
    `culture-session:${input.sessionId}:turn:${input.turnIndex}:semantics:${version.id}:${outputHash}`,
    artifact.id,
    version.id,
    PROJECTION_TYPE,
    extractorVersion,
    outputHash,
    now,
  ).run();
  const episode = await store.upsertEpisode({
    ingestionKey: `culture-session:${input.sessionId}:turn:${input.turnIndex}:episode:${version.id}`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    narrative: input.decomposition.statements.map((statement) => statement.phrase).join(' '),
    metadata: {
      turnIndex: input.turnIndex,
      artifactVersionId: version.id,
      semanticProjectionRunId: runId,
    },
  });
  await linkProjectionEntity(db, runId, 'episode', episode.id, now);

  const assertionByStatementId = new Map<string, string>();
  const affectedSignals = new Map<string, string>();
  for (const prior of priorSignals) {
    affectedSignals.set(
      `${prior.workspace_person_id}\u0000${prior.signal_key}`,
      prior.signal_key,
    );
  }
  let assertionCount = 0;
  let signalCount = 0;
  for (const statement of input.decomposition.statements) {
    const sourceQuote = statement.sourceQuote
      && input.answer.includes(statement.sourceQuote)
      ? statement.sourceQuote
      : null;
    let supportingSpanId = answerSpan.id;
    if (sourceQuote) {
      const quoteOffset = input.answer.indexOf(sourceQuote);
      const charStart = answerStart + quoteOffset;
      const quoteSpan = await store.createSourceSpan({
        ingestionKey: `culture-session:${input.sessionId}:turn:${input.turnIndex}:${version.id}:quote:${statement.id}`,
        artifactVersionId: version.id,
        stableSegmentId: `turn-${input.turnIndex}:statement-${statement.id}`,
        byteStart: byteOffset(contentText, charStart),
        byteEnd: byteOffset(contentText, charStart + sourceQuote.length),
        charStart,
        charEnd: charStart + sourceQuote.length,
        exactText: sourceQuote,
        metadata: {
          role: 'candidate',
          turnIndex: input.turnIndex,
          statementId: statement.id,
        },
      });
      supportingSpanId = quoteSpan.id;
    }
    const semanticKey = await deterministicEntityId(
      'culture_statement',
      stableJson({
        statementId: statement.id,
        type: statement.type,
        phrase: statement.phrase,
        sourceQuote,
      }),
    );
    const assertion = await store.upsertAssertion({
      ingestionKey: `culture-session:${input.sessionId}:turn:${input.turnIndex}:assertion:${version.id}:${semanticKey}`,
      workspacePersonId: identity.workspacePersonId,
      episodeId: episode.id,
      subjectType: 'workspace_person',
      subjectId: identity.workspacePersonId,
      predicate: statement.type,
      narrative: statement.phrase,
      qualifiers: {
        questionSpanId: questionSpan.id,
        answerSpanId: answerSpan.id,
        statementId: statement.id,
        artifactVersionId: version.id,
        semanticProjectionRunId: runId,
      },
      confidence: boundedScore(statement.confidence),
      extractionVersion: extractorVersion,
      observedAt: input.observedAt,
    });
    assertionByStatementId.set(statement.id, assertion.id);
    await linkProjectionEntity(db, runId, 'assertion', assertion.id, now);
    await store.linkAssertionSourceSpan(assertion.id, supportingSpanId, 'source');
    for (const termInput of statement.semanticTerms ?? []) {
      if (!sourceQuote || !sourceQuote.includes(termInput.surface)) continue;
      const term = openSemanticTerm(termInput.surface);
      const relationship = termInput.relationship.trim();
      const weight = boundedScore(termInput.weight);
      if (!term || !relationship || weight === null) continue;
      const concept = await store.upsertConcept({
        ingestionKey: `open-term:${term.canonicalKey}`,
        canonicalKey: term.canonicalKey,
        namespace: 'term',
        label: term.surface,
        metadata: {
          resolver: OPEN_TERM_RESOLVER_VERSION,
          source: 'culture_interview_turn',
        },
      });
      await store.linkAssertionConcept(assertion.id, concept.id, relationship, weight);
      const strength = boundedScore(termInput.strength);
      if (termInput.evidenceLevel && strength !== null) {
        await store.upsertSignalEvidence({
          ingestionKey: `culture-session:${input.sessionId}:turn:${input.turnIndex}:evidence:${assertion.id}:${term.canonicalKey}`,
          workspacePersonId: identity.workspacePersonId,
          interactionId: interaction.id,
          assertionId: assertion.id,
          conceptId: concept.id,
          signalKey: term.canonicalKey,
          evidenceLevel: termInput.evidenceLevel,
          strength,
          observedAt: input.observedAt,
          metadata: {
            artifactVersionId: version.id,
            semanticProjectionRunId: runId,
          },
        });
        affectedSignals.set(
          `${identity.workspacePersonId}\u0000${term.canonicalKey}`,
          term.canonicalKey,
        );
        signalCount++;
      }
    }
    assertionCount++;
  }

  for (const edge of input.decomposition.edges) {
    const fromAssertionId = edge.from === 'candidate'
      ? null
      : assertionByStatementId.get(edge.from) ?? null;
    const toAssertionId = assertionByStatementId.get(edge.to);
    if (!toAssertionId || (edge.from !== 'candidate' && !fromAssertionId)) continue;
    const relationship = await store.upsertSemanticRelationship({
      ingestionKey: `culture-session:${input.sessionId}:turn:${input.turnIndex}:relationship:${runId}:${edge.from}:${edge.to}:${edge.predicate}`,
      workspacePersonId: identity.workspacePersonId,
      fromEntityType: edge.from === 'candidate' ? 'workspace_person' : 'assertion',
      fromEntityId: edge.from === 'candidate'
        ? identity.workspacePersonId
        : fromAssertionId!,
      predicate: edge.predicate,
      toEntityType: 'assertion',
      toEntityId: toAssertionId,
      sourceAssertionId: fromAssertionId ?? toAssertionId,
    });
    await linkProjectionEntity(
      db,
      runId,
      'semantic_relationship',
      relationship.id,
      now,
    );
  }
  for (const signalKey of affectedSignals.values()) {
    await rebuildLivingContextSignalSnapshot(
      db,
      store,
      identity.workspacePersonId,
      signalKey,
      interaction.id,
      version.id,
      input.observedAt,
    );
  }
  await store.enqueueProjection({
    ingestionKey: `culture-session:${input.sessionId}:turn:${input.turnIndex}:projection:${version.id}:${outputHash}`,
    projectionType: 'neo4j',
    aggregateType: 'workspace_person',
    aggregateId: identity.workspacePersonId,
    operation: 'rebuild',
    payload: {
      artifactId: artifact.id,
      artifactVersionId: version.id,
      semanticProjectionRunId: runId,
    },
  });
  return { assertionCount, signalCount };
}
