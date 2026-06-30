/**
 * Evidence lineage tracing — traces a match decision back through the full
 * evidence chain to its original source material.
 *
 * Chain: match_decision → signal_evidence → semantic_assertion → source_span
 *        → artifact_version → artifact → interaction
 *
 * Each node in the lineage includes provenance metadata so recruiters can
 * follow exactly how a conclusion was reached.
 */

import {
  computeDecayMultiplier,
  parseObservedAtMs,
  DEFAULT_DECAY_CONFIG,
  type TemporalDecayConfig,
} from '../challengeMatching/temporalDecay';

export interface LineageSourceSpan {
  sourceSpanId: string;
  artifactVersionId: string;
  contentHash: string;
  exactText: string;
  byteStart: number | null;
  byteEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  timestampStartMs: number | null;
  timestampEndMs: number | null;
  stableSegmentId: string | null;
}

export interface LineageArtifact {
  artifactId: string;
  artifactType: string;
  logicalKey: string | null;
  mediaType: string | null;
  versionNumber: number;
}

export interface LineageInteraction {
  interactionId: string;
  interactionType: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface LineageAssertion {
  assertionId: string;
  narrative: string;
  predicate: string;
  confidence: number | null;
  polarity: number;
  observedAt: string | null;
  concepts: Array<{
    canonicalKey: string;
    namespace: string;
    weight: number;
  }>;
  sources: LineageSourceSpan[];
}

export interface LineageSignalEvidence {
  signalEvidenceId: string;
  evidenceLevel: string;
  strength: number;
  polarity: number;
  conceptKey: string | null;
}

export interface LineageNode {
  assertion: LineageAssertion;
  signalEvidence: LineageSignalEvidence | null;
  artifact: LineageArtifact | null;
  interaction: LineageInteraction | null;
  decayMultiplier: number;
  effectiveStrength: number;
}

export interface EvidenceLineage {
  candidateId: string;
  workspacePersonId: string | null;
  totalNodes: number;
  nodes: LineageNode[];
  conceptSummary: Array<{
    canonicalKey: string;
    nodeCount: number;
    avgEffectiveStrength: number;
    oldestObservedAt: string | null;
    newestObservedAt: string | null;
  }>;
}

interface AssertionRow {
  assertion_id: string;
  narrative: string;
  predicate: string;
  confidence: number | null;
  polarity: number;
  observed_at: string | null;
  episode_id: string | null;
  workspace_person_id: string;
}

interface SourceSpanRow {
  source_span_id: string;
  assertion_id: string;
  artifact_version_id: string;
  content_hash: string;
  exact_text: string;
  byte_start: number | null;
  byte_end: number | null;
  char_start: number | null;
  char_end: number | null;
  line_start: number | null;
  line_end: number | null;
  timestamp_start_ms: number | null;
  timestamp_end_ms: number | null;
  stable_segment_id: string | null;
}

interface ConceptRow {
  assertion_id: string;
  canonical_key: string;
  namespace: string;
  weight: number;
}

interface SignalEvidenceRow {
  id: string;
  assertion_id: string;
  evidence_level: string;
  strength: number;
  polarity: number;
  concept_key: string | null;
}

interface ArtifactRow {
  artifact_version_id: string;
  artifact_id: string;
  artifact_type: string;
  logical_key: string | null;
  media_type: string | null;
  version_number: number;
}

interface InteractionRow {
  episode_id: string;
  interaction_id: string;
  interaction_type: string;
  started_at: string | null;
  ended_at: string | null;
}

/**
 * Traces the full evidence lineage for a candidate, optionally filtered
 * by concept keys. Returns the chain from assertions through source spans
 * back to artifacts and interactions.
 */
export async function traceEvidenceLineage(
  db: D1Database,
  candidateId: string,
  options?: {
    conceptKeys?: string[];
    limit?: number;
    decayConfig?: Partial<TemporalDecayConfig>;
  },
): Promise<EvidenceLineage> {
  const limit = Math.min(options?.limit ?? 200, 500);
  const decay: TemporalDecayConfig = {
    ...DEFAULT_DECAY_CONFIG,
    referenceTimeMs: Date.now(),
    ...options?.decayConfig,
  };

  const personResult = await db.prepare(
    `SELECT workspace_person_id FROM applications WHERE legacy_candidate_id = ?1 LIMIT 1`,
  ).bind(candidateId).first<{ workspace_person_id: string }>();

  if (!personResult) {
    return {
      candidateId,
      workspacePersonId: null,
      totalNodes: 0,
      nodes: [],
      conceptSummary: [],
    };
  }

  const personId = personResult.workspace_person_id;

  const conceptFilter = options?.conceptKeys && options.conceptKeys.length > 0
    ? options.conceptKeys
    : null;

  const assertionQuery = conceptFilter
    ? `SELECT DISTINCT sa.id AS assertion_id, sa.narrative, sa.predicate,
              sa.confidence, sa.polarity,
              COALESCE(sa.observed_at, sa.created_at) AS observed_at,
              sa.episode_id, sa.workspace_person_id
         FROM semantic_assertions sa
         JOIN assertion_concepts ac ON ac.assertion_id = sa.id
         JOIN concepts c ON c.id = ac.concept_id
        WHERE sa.workspace_person_id = ?1
          AND c.canonical_key IN (${conceptFilter.map((_, i) => `?${i + 2}`).join(', ')})
        ORDER BY COALESCE(sa.observed_at, sa.created_at) DESC
        LIMIT ?${conceptFilter.length + 2}`
    : `SELECT sa.id AS assertion_id, sa.narrative, sa.predicate,
              sa.confidence, sa.polarity,
              COALESCE(sa.observed_at, sa.created_at) AS observed_at,
              sa.episode_id, sa.workspace_person_id
         FROM semantic_assertions sa
        WHERE sa.workspace_person_id = ?1
        ORDER BY COALESCE(sa.observed_at, sa.created_at) DESC
        LIMIT ?2`;

  const assertionBindings: Array<string | number> = [personId];
  if (conceptFilter) {
    assertionBindings.push(...conceptFilter);
  }
  assertionBindings.push(limit);

  const assertionsResult = await db.prepare(assertionQuery)
    .bind(...assertionBindings)
    .all<AssertionRow>();

  const assertions = assertionsResult.results ?? [];
  if (assertions.length === 0) {
    return {
      candidateId,
      workspacePersonId: personId,
      totalNodes: 0,
      nodes: [],
      conceptSummary: [],
    };
  }

  const assertionIds = assertions.map((a) => a.assertion_id);
  const idPlaceholders = assertionIds.map((_, i) => `?${i + 1}`).join(', ');

  const [sourceSpans, concepts, signalEvidence] = await Promise.all([
    db.prepare(
      `SELECT ass.source_span_id, ass.assertion_id,
              ss.artifact_version_id, av.content_hash,
              ss.exact_text, ss.byte_start, ss.byte_end,
              ss.char_start, ss.char_end, ss.line_start, ss.line_end,
              ss.timestamp_start_ms, ss.timestamp_end_ms, ss.stable_segment_id
         FROM assertion_source_spans ass
         JOIN source_spans ss ON ss.id = ass.source_span_id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
        WHERE ass.assertion_id IN (${idPlaceholders})`,
    ).bind(...assertionIds).all<SourceSpanRow>(),

    db.prepare(
      `SELECT ac.assertion_id, c.canonical_key, c.namespace, ac.weight
         FROM assertion_concepts ac
         JOIN concepts c ON c.id = ac.concept_id
        WHERE ac.assertion_id IN (${idPlaceholders})`,
    ).bind(...assertionIds).all<ConceptRow>(),

    db.prepare(
      `SELECT se.id, se.assertion_id, se.evidence_level, se.strength, se.polarity,
              c.canonical_key AS concept_key
         FROM signal_evidence se
         LEFT JOIN concepts c ON c.id = se.concept_id
        WHERE se.assertion_id IN (${idPlaceholders})
        ORDER BY se.strength DESC`,
    ).bind(...assertionIds).all<SignalEvidenceRow>(),
  ]);

  const sourcesByAssertion = new Map<string, SourceSpanRow[]>();
  for (const span of sourceSpans.results ?? []) {
    const existing = sourcesByAssertion.get(span.assertion_id);
    if (existing) existing.push(span);
    else sourcesByAssertion.set(span.assertion_id, [span]);
  }

  const conceptsByAssertion = new Map<string, ConceptRow[]>();
  for (const concept of concepts.results ?? []) {
    const existing = conceptsByAssertion.get(concept.assertion_id);
    if (existing) existing.push(concept);
    else conceptsByAssertion.set(concept.assertion_id, [concept]);
  }

  const signalsByAssertion = new Map<string, SignalEvidenceRow>();
  for (const signal of signalEvidence.results ?? []) {
    if (!signalsByAssertion.has(signal.assertion_id)) {
      signalsByAssertion.set(signal.assertion_id, signal);
    }
  }

  const artifactVersionIds = new Set<string>();
  for (const spans of sourcesByAssertion.values()) {
    for (const span of spans) {
      artifactVersionIds.add(span.artifact_version_id);
    }
  }

  let artifactsByVersion = new Map<string, ArtifactRow>();
  if (artifactVersionIds.size > 0) {
    const avIds = [...artifactVersionIds];
    const avPlaceholders = avIds.map((_, i) => `?${i + 1}`).join(', ');
    const artifactResult = await db.prepare(
      `SELECT av.id AS artifact_version_id, a.id AS artifact_id,
              a.artifact_type, a.logical_key, av.media_type, av.version_number
         FROM artifact_versions av
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE av.id IN (${avPlaceholders})`,
    ).bind(...avIds).all<ArtifactRow>();
    for (const row of artifactResult.results ?? []) {
      artifactsByVersion.set(row.artifact_version_id, row);
    }
  }

  const episodeIds = assertions
    .map((a) => a.episode_id)
    .filter((id): id is string => id !== null);
  let interactionsByEpisode = new Map<string, InteractionRow>();
  if (episodeIds.length > 0) {
    const uniqueEpisodeIds = [...new Set(episodeIds)];
    const epPlaceholders = uniqueEpisodeIds.map((_, i) => `?${i + 1}`).join(', ');
    const interactionResult = await db.prepare(
      `SELECT ep.id AS episode_id, i.id AS interaction_id,
              i.interaction_type, i.started_at, i.ended_at
         FROM episodes ep
         JOIN interactions i ON i.id = ep.interaction_id
        WHERE ep.id IN (${epPlaceholders})`,
    ).bind(...uniqueEpisodeIds).all<InteractionRow>();
    for (const row of interactionResult.results ?? []) {
      interactionsByEpisode.set(row.episode_id, row);
    }
  }

  const nodes: LineageNode[] = [];
  for (const assertion of assertions) {
    const spans = sourcesByAssertion.get(assertion.assertion_id) ?? [];
    const assertionConcepts = conceptsByAssertion.get(assertion.assertion_id) ?? [];
    const signal = signalsByAssertion.get(assertion.assertion_id) ?? null;

    const observedMs = parseObservedAtMs(assertion.observed_at);
    const decayMult = observedMs != null
      ? computeDecayMultiplier(observedMs, decay)
      : 1.0;

    const rawStrength = signal ? signal.strength : 0.5;
    const effectiveStrength = rawStrength * decayMult;

    const firstSpan = spans[0];
    const artifactRow = firstSpan
      ? artifactsByVersion.get(firstSpan.artifact_version_id) ?? null
      : null;

    const interactionRow = assertion.episode_id
      ? interactionsByEpisode.get(assertion.episode_id) ?? null
      : null;

    nodes.push({
      assertion: {
        assertionId: assertion.assertion_id,
        narrative: assertion.narrative,
        predicate: assertion.predicate,
        confidence: assertion.confidence,
        polarity: assertion.polarity,
        observedAt: assertion.observed_at,
        concepts: assertionConcepts.map((c) => ({
          canonicalKey: c.canonical_key,
          namespace: c.namespace,
          weight: c.weight,
        })),
        sources: spans.map((s) => ({
          sourceSpanId: s.source_span_id,
          artifactVersionId: s.artifact_version_id,
          contentHash: s.content_hash,
          exactText: s.exact_text,
          byteStart: s.byte_start,
          byteEnd: s.byte_end,
          charStart: s.char_start,
          charEnd: s.char_end,
          lineStart: s.line_start,
          lineEnd: s.line_end,
          timestampStartMs: s.timestamp_start_ms,
          timestampEndMs: s.timestamp_end_ms,
          stableSegmentId: s.stable_segment_id,
        })),
      },
      signalEvidence: signal
        ? {
            signalEvidenceId: signal.id,
            evidenceLevel: signal.evidence_level,
            strength: signal.strength,
            polarity: signal.polarity,
            conceptKey: signal.concept_key,
          }
        : null,
      artifact: artifactRow
        ? {
            artifactId: artifactRow.artifact_id,
            artifactType: artifactRow.artifact_type,
            logicalKey: artifactRow.logical_key,
            mediaType: artifactRow.media_type,
            versionNumber: artifactRow.version_number,
          }
        : null,
      interaction: interactionRow
        ? {
            interactionId: interactionRow.interaction_id,
            interactionType: interactionRow.interaction_type,
            startedAt: interactionRow.started_at,
            endedAt: interactionRow.ended_at,
          }
        : null,
      decayMultiplier: decayMult,
      effectiveStrength,
    });
  }

  const conceptMap = new Map<string, {
    nodeCount: number;
    totalStrength: number;
    oldest: string | null;
    newest: string | null;
  }>();

  for (const node of nodes) {
    for (const concept of node.assertion.concepts) {
      const existing = conceptMap.get(concept.canonicalKey);
      if (existing) {
        existing.nodeCount++;
        existing.totalStrength += node.effectiveStrength;
        if (node.assertion.observedAt) {
          if (!existing.oldest || node.assertion.observedAt < existing.oldest) {
            existing.oldest = node.assertion.observedAt;
          }
          if (!existing.newest || node.assertion.observedAt > existing.newest) {
            existing.newest = node.assertion.observedAt;
          }
        }
      } else {
        conceptMap.set(concept.canonicalKey, {
          nodeCount: 1,
          totalStrength: node.effectiveStrength,
          oldest: node.assertion.observedAt,
          newest: node.assertion.observedAt,
        });
      }
    }
  }

  const conceptSummary = [...conceptMap.entries()]
    .map(([key, data]) => ({
      canonicalKey: key,
      nodeCount: data.nodeCount,
      avgEffectiveStrength: data.nodeCount > 0 ? data.totalStrength / data.nodeCount : 0,
      oldestObservedAt: data.oldest,
      newestObservedAt: data.newest,
    }))
    .sort((a, b) => b.avgEffectiveStrength - a.avgEffectiveStrength);

  return {
    candidateId,
    workspacePersonId: personId,
    totalNodes: nodes.length,
    nodes,
    conceptSummary,
  };
}
