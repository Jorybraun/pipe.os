/**
 * Match provenance chain — given a match run ID, produces a complete end-to-end
 * trace from the match decision through candidate signals, semantic assertions,
 * source spans, artifacts, and interactions back to the original evidence.
 *
 * Unlike evidence lineage (per-candidate), this traces per-match-decision to
 * show exactly HOW and WHY a specific candidate-to-challenge match was reached.
 */

import {
  computeDecayMultiplier,
  parseObservedAtMs,
  DEFAULT_DECAY_CONFIG,
  type TemporalDecayConfig,
} from '../challengeMatching/temporalDecay';

export interface ProvenanceMatchDecision {
  matchRunId: string;
  candidateId: string;
  status: string;
  selectedPacketId: string | null;
  policyVersion: string;
  createdAt: number;
}

export interface ProvenanceDemandLink {
  demandId: string;
  demandNarrative: string;
  demandWeight: number;
  demandConcepts: string[];
  atomId: string;
  pairScore: number;
  stretch: {
    atomConcept: string;
    demandConcept: string;
    dimension: string;
  } | null;
}

export interface ProvenanceSignalNode {
  atomId: string;
  episodeId: string;
  narrative: string;
  purpose: string;
  evidenceLevel: string | null;
  evidenceStrength: number | null;
  concepts: string[];
  sourceRefs: Array<{
    artifactId: string;
    contentHash: string;
    exactText: string | null;
    startOffset: number;
    endOffset: number;
  }>;
}

export interface ProvenanceAssertionNode {
  assertionId: string;
  narrative: string;
  predicate: string;
  confidence: number | null;
  polarity: number;
  observedAt: string | null;
  decayMultiplier: number;
  concepts: string[];
  sourceSpans: Array<{
    sourceSpanId: string;
    exactText: string;
    lineStart: number | null;
    lineEnd: number | null;
    charStart: number | null;
    charEnd: number | null;
  }>;
}

export interface ProvenanceArtifactNode {
  artifactId: string;
  artifactType: string;
  logicalKey: string | null;
  mediaType: string | null;
  versionNumber: number;
  contentHash: string;
}

export interface ProvenanceInteractionNode {
  interactionId: string;
  interactionType: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ProvenanceChainEntry {
  demandLink: ProvenanceDemandLink;
  signals: ProvenanceSignalNode[];
  assertions: ProvenanceAssertionNode[];
  artifacts: ProvenanceArtifactNode[];
  interactions: ProvenanceInteractionNode[];
}

export interface MatchProvenanceChain {
  decision: ProvenanceMatchDecision;
  challengeId: string | null;
  repoId: string | null;
  prNumber: number | null;
  totalDemands: number;
  alignedDemands: number;
  unmatchedDemands: number;
  stretchCount: number;
  chain: ProvenanceChainEntry[];
}

interface MatchRunRow {
  id: string;
  candidate_id: string;
  status: string;
  selected_packet_id: string | null;
  policy_version: string;
  query_json: string;
  ranked_results_json: string;
  created_at: number;
}

interface RankedResultEntry {
  challengeId: string;
  repoId: string;
  prNumber: number;
  alignments: Array<{
    atomId: string;
    demandId: string;
    pairScore: number;
    stretch: { atomConcept: string; demandConcept: string; dimension: string } | null;
    candidateSourceRefs: Array<{
      artifactId: string;
      contentHash: string;
      exactText?: string;
      startOffset: number;
      endOffset: number;
    }>;
  }>;
  stretchCount: number;
  unmatchedDemandIds: string[];
}

export interface ProvenanceChainOptions {
  decay?: Partial<TemporalDecayConfig>;
}

export async function loadMatchProvenanceChain(
  db: D1Database,
  matchRunId: string,
  options: ProvenanceChainOptions = {},
): Promise<MatchProvenanceChain> {
  const decayConfig: TemporalDecayConfig = {
    ...DEFAULT_DECAY_CONFIG,
    referenceTimeMs: Date.now(),
    ...options.decay,
  };

  const matchRow = await db.prepare(
    `SELECT id, candidate_id, status, selected_packet_id, policy_version,
            query_json, ranked_results_json, created_at
     FROM match_runs WHERE id = ?`,
  ).bind(matchRunId).first<MatchRunRow>();

  if (!matchRow) {
    throw new Error(`Match run ${matchRunId} not found`);
  }

  const decision: ProvenanceMatchDecision = {
    matchRunId: matchRow.id,
    candidateId: matchRow.candidate_id,
    status: matchRow.status,
    selectedPacketId: matchRow.selected_packet_id,
    policyVersion: matchRow.policy_version,
    createdAt: matchRow.created_at,
  };

  const queryData = JSON.parse(matchRow.query_json) as {
    validationAtoms: Array<{
      id: string;
      episodeId: string;
      narrative: string;
      purpose: string;
      evidenceLevel: string | null;
      evidenceStrength: number | null;
      concepts: string[];
      sourceRefs: Array<{
        artifactId: string;
        contentHash: string;
        exactText?: string;
        startOffset: number;
        endOffset: number;
      }>;
    }>;
    deepeningAtoms: Array<{
      id: string;
      episodeId: string;
      narrative: string;
      purpose: string;
      evidenceLevel: string | null;
      evidenceStrength: number | null;
      concepts: string[];
      sourceRefs: Array<{
        artifactId: string;
        contentHash: string;
        exactText?: string;
        startOffset: number;
        endOffset: number;
      }>;
    }>;
  };

  const allAtoms = [...queryData.validationAtoms, ...queryData.deepeningAtoms];
  const atomMap = new Map(allAtoms.map((a) => [a.id, a]));

  const rankedResults = JSON.parse(matchRow.ranked_results_json) as RankedResultEntry[];
  const selectedResult = matchRow.selected_packet_id
    ? rankedResults.find((r) => r.challengeId === matchRow.selected_packet_id) ?? null
    : rankedResults[0] ?? null;

  if (!selectedResult) {
    return {
      decision,
      challengeId: null,
      repoId: null,
      prNumber: null,
      totalDemands: 0,
      alignedDemands: 0,
      unmatchedDemands: 0,
      stretchCount: 0,
      chain: [],
    };
  }

  const packetRow = await db.prepare(
    `SELECT packet_json FROM review_challenge_packets WHERE id = ?`,
  ).bind(selectedResult.challengeId).first<{ packet_json: string }>();

  const packet = packetRow
    ? JSON.parse(packetRow.packet_json) as {
        demands: Array<{ id: string; narrative: string; weight: number; concepts: string[] }>;
      }
    : null;
  const demandMap = new Map(
    (packet?.demands ?? []).map((d) => [d.id, d]),
  );

  const wpResult = await db.prepare(
    `SELECT wp.id FROM workspace_people wp
     JOIN applications app ON app.workspace_person_id = wp.id
     JOIN candidates c ON c.id = app.legacy_candidate_id
     WHERE c.id = ?
     LIMIT 1`,
  ).bind(matchRow.candidate_id).first<{ id: string }>();

  const assertionRows = wpResult
    ? (await db.prepare(
        `SELECT sa.id AS assertion_id, sa.narrative, sa.predicate,
                sa.confidence, sa.polarity, sa.observed_at,
                c.canonical_key AS concept_key,
                ss.id AS source_span_id, ss.exact_text,
                ss.line_start, ss.line_end, ss.char_start, ss.char_end
         FROM semantic_assertions sa
         LEFT JOIN assertion_concepts ac ON ac.assertion_id = sa.id
         LEFT JOIN concepts c ON c.id = ac.concept_id
         LEFT JOIN assertion_source_spans ass ON ass.assertion_id = sa.id
         LEFT JOIN source_spans ss ON ss.id = ass.source_span_id
         WHERE sa.workspace_person_id = ?
         ORDER BY sa.observed_at DESC`,
      ).bind(wpResult.id).all<{
        assertion_id: string;
        narrative: string;
        predicate: string;
        confidence: number | null;
        polarity: number;
        observed_at: string | null;
        concept_key: string | null;
        source_span_id: string | null;
        exact_text: string | null;
        line_start: number | null;
        line_end: number | null;
        char_start: number | null;
        char_end: number | null;
      }>()).results ?? []
    : [];

  const assertionByConcept = new Map<string, typeof assertionRows>();
  for (const row of assertionRows) {
    if (!row.concept_key) continue;
    const existing = assertionByConcept.get(row.concept_key);
    if (existing) {
      existing.push(row);
    } else {
      assertionByConcept.set(row.concept_key, [row]);
    }
  }

  const artifactRows = wpResult
    ? (await db.prepare(
        `SELECT a.id AS artifact_id, a.artifact_type, a.logical_key,
                a.interaction_id,
                av.media_type, av.version_number, av.content_hash,
                ss.id AS source_span_id
         FROM artifacts a
         JOIN artifact_versions av ON av.artifact_id = a.id
         JOIN source_spans ss ON ss.artifact_version_id = av.id
         WHERE a.workspace_person_id = ?`,
      ).bind(wpResult.id).all<{
        artifact_id: string;
        artifact_type: string;
        logical_key: string | null;
        interaction_id: string | null;
        media_type: string | null;
        version_number: number;
        content_hash: string;
        source_span_id: string;
      }>()).results ?? []
    : [];

  const artifactBySpanId = new Map<string, ProvenanceArtifactNode & { interactionId: string | null }>();
  for (const row of artifactRows) {
    artifactBySpanId.set(row.source_span_id, {
      artifactId: row.artifact_id,
      artifactType: row.artifact_type,
      logicalKey: row.logical_key,
      mediaType: row.media_type,
      versionNumber: row.version_number,
      contentHash: row.content_hash,
      interactionId: row.interaction_id,
    });
  }

  const interactionRows = wpResult
    ? (await db.prepare(
        `SELECT id, interaction_type, started_at, ended_at
         FROM interactions WHERE workspace_person_id = ?`,
      ).bind(wpResult.id).all<{
        id: string;
        interaction_type: string;
        started_at: string | null;
        ended_at: string | null;
      }>()).results ?? []
    : [];

  const interactionMap = new Map(
    interactionRows.map((r) => [r.id, r]),
  );

  const chain: ProvenanceChainEntry[] = selectedResult.alignments.map((alignment) => {
    const demand = demandMap.get(alignment.demandId);
    const atom = atomMap.get(alignment.atomId);

    const demandLink: ProvenanceDemandLink = {
      demandId: alignment.demandId,
      demandNarrative: demand?.narrative ?? '',
      demandWeight: demand?.weight ?? 0,
      demandConcepts: demand?.concepts ?? [],
      atomId: alignment.atomId,
      pairScore: alignment.pairScore,
      stretch: alignment.stretch,
    };

    const signals: ProvenanceSignalNode[] = atom ? [{
      atomId: atom.id,
      episodeId: atom.episodeId,
      narrative: atom.narrative,
      purpose: atom.purpose,
      evidenceLevel: atom.evidenceLevel,
      evidenceStrength: atom.evidenceStrength,
      concepts: atom.concepts,
      sourceRefs: (atom.sourceRefs ?? []).map((ref) => ({
        artifactId: ref.artifactId,
        contentHash: ref.contentHash,
        exactText: ref.exactText ?? null,
        startOffset: ref.startOffset,
        endOffset: ref.endOffset,
      })),
    }] : [];

    const relevantConcepts = [...new Set([
      ...(demand?.concepts ?? []),
      ...(atom?.concepts ?? []),
    ])];

    const seenAssertionIds = new Set<string>();
    const assertions: ProvenanceAssertionNode[] = [];
    const seenArtifactIds = new Set<string>();
    const artifacts: ProvenanceArtifactNode[] = [];
    const seenInteractionIds = new Set<string>();
    const interactions: ProvenanceInteractionNode[] = [];

    for (const concept of relevantConcepts) {
      const conceptAssertions = assertionByConcept.get(concept) ?? [];
      for (const row of conceptAssertions) {
        if (seenAssertionIds.has(row.assertion_id)) continue;
        seenAssertionIds.add(row.assertion_id);

        const observedMs = parseObservedAtMs(row.observed_at);
        const decayMultiplier = observedMs !== null ? computeDecayMultiplier(observedMs, decayConfig) : 1.0;

        const sourceSpans: ProvenanceAssertionNode['sourceSpans'] = [];
        if (row.source_span_id) {
          sourceSpans.push({
            sourceSpanId: row.source_span_id,
            exactText: row.exact_text ?? '',
            lineStart: row.line_start,
            lineEnd: row.line_end,
            charStart: row.char_start,
            charEnd: row.char_end,
          });

          const artifact = artifactBySpanId.get(row.source_span_id);
          if (artifact && !seenArtifactIds.has(artifact.artifactId)) {
            seenArtifactIds.add(artifact.artifactId);
            artifacts.push(artifact);
          }
        }

        const relatedConcepts = assertionRows
          .filter((r) => r.assertion_id === row.assertion_id && r.concept_key)
          .map((r) => r.concept_key as string);

        assertions.push({
          assertionId: row.assertion_id,
          narrative: row.narrative,
          predicate: row.predicate,
          confidence: row.confidence,
          polarity: row.polarity,
          observedAt: row.observed_at,
          decayMultiplier,
          concepts: [...new Set(relatedConcepts)],
          sourceSpans,
        });
      }
    }

    for (const artifact of artifacts) {
      const artEntry = artifactBySpanId.get(
        [...artifactBySpanId.entries()]
          .find(([, a]) => a.artifactId === artifact.artifactId)?.[0] ?? '',
      );
      if (artEntry?.interactionId && !seenInteractionIds.has(artEntry.interactionId)) {
        const iRow = interactionMap.get(artEntry.interactionId);
        if (iRow) {
          seenInteractionIds.add(iRow.id);
          interactions.push({
            interactionId: iRow.id,
            interactionType: iRow.interaction_type,
            startedAt: iRow.started_at,
            endedAt: iRow.ended_at,
          });
        }
      }
    }

    return {
      demandLink,
      signals,
      assertions,
      artifacts,
      interactions,
    };
  });

  return {
    decision,
    challengeId: selectedResult.challengeId,
    repoId: selectedResult.repoId,
    prNumber: selectedResult.prNumber,
    totalDemands: (packet?.demands ?? []).length,
    alignedDemands: selectedResult.alignments.length,
    unmatchedDemands: selectedResult.unmatchedDemandIds.length,
    stretchCount: selectedResult.stretchCount,
    chain,
  };
}
