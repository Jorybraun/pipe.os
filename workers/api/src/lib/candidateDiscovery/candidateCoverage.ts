/**
 * Candidate coverage is an open projection over source-backed concepts in the
 * living context graph. Concepts are dimensions because they are persisted
 * meaning from the source, not members of a code-owned semantic taxonomy.
 */

import type {
  CandidateCoverage,
  CoverageAspect,
  CoverageDimension,
  CoverageResult,
} from '../../types';

export const CANDIDATE_COVERAGE_POLICY = {
  version: 'open-concept-coverage-v1',
  evidenceSaturation: 4,
  sourceSaturation: 3,
  interactionSaturation: 3,
  overallEvidenceSaturation: 12,
  overallSourceSaturation: 4,
  overallInteractionSaturation: 6,
  probeCompleteThreshold: 0.9,
} as const;

export interface CandidateCoverageEvidenceRow {
  concept_id: string;
  canonical_key: string;
  label: string;
  assertion_id: string;
  assertion_confidence: number | null;
  assertion_observed_at: string | null;
  evidence_id: string | null;
  evidence_strength: number | null;
  evidence_polarity: number | null;
  evidence_observed_at: string | null;
  source_key: string | null;
  interaction_id: string | null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ratio(value: number, saturation: number): number {
  return clamp01(value / saturation);
}

function observedAt(row: CandidateCoverageEvidenceRow): string | null {
  return row.evidence_observed_at ?? row.assertion_observed_at;
}

function evidenceStrength(row: CandidateCoverageEvidenceRow): number | null {
  const base = row.evidence_strength ?? row.assertion_confidence;
  if (base === null) return null;
  const polarity = Math.abs(row.evidence_polarity ?? 1);
  return clamp01(base * polarity);
}

function minTimestamp(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length > 0 ? present.sort()[0]! : null;
}

function maxTimestamp(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length > 0 ? present.sort().at(-1)! : null;
}

export function computeCoverageFromRows(
  rows: CandidateCoverageEvidenceRow[],
  candidateId = '',
): CoverageResult {
  const grouped = new Map<string, CandidateCoverageEvidenceRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.concept_id);
    if (existing) existing.push(row);
    else grouped.set(row.concept_id, [row]);
  }

  const dimensions: CoverageDimension[] = [...grouped.values()].map((conceptRows) => {
    const first = conceptRows[0]!;
    const assertionIds = new Set(conceptRows.map((row) => row.assertion_id));
    const evidenceIds = new Set(
      conceptRows.flatMap((row) => (row.evidence_id ? [row.evidence_id] : [])),
    );
    const sourceKeys = new Set(
      conceptRows.flatMap((row) => (row.source_key ? [row.source_key] : [])),
    );
    const interactionIds = new Set(
      conceptRows.flatMap((row) => (row.interaction_id ? [row.interaction_id] : [])),
    );
    const strengths = conceptRows.flatMap((row) => {
      const strength = evidenceStrength(row);
      return strength === null ? [] : [strength];
    });
    const confidence =
      strengths.length > 0
        ? strengths.reduce((sum, value) => sum + value, 0) / strengths.length
        : 0;
    const evidenceCount = Math.max(evidenceIds.size, assertionIds.size);
    const score = confidence * (
      0.5
      + 0.25 * ratio(evidenceCount, CANDIDATE_COVERAGE_POLICY.evidenceSaturation)
      + 0.15 * ratio(sourceKeys.size, CANDIDATE_COVERAGE_POLICY.sourceSaturation)
      + 0.1 * ratio(interactionIds.size, CANDIDATE_COVERAGE_POLICY.interactionSaturation)
    );
    const timestamps = conceptRows.map(observedAt);

    return {
      conceptId: first.concept_id,
      canonicalKey: first.canonical_key,
      label: first.label,
      score: clamp01(score),
      confidence: clamp01(confidence),
      evidenceCount,
      assertionCount: assertionIds.size,
      sourceDiversity: sourceKeys.size,
      interactionCount: interactionIds.size,
      firstObservedAt: minTimestamp(timestamps),
      lastObservedAt: maxTimestamp(timestamps),
    };
  }).sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey));

  const evidenceIds = new Set(
    rows.flatMap((row) => (row.evidence_id ? [row.evidence_id] : [row.assertion_id])),
  );
  const sources = new Set(rows.flatMap((row) => (row.source_key ? [row.source_key] : [])));
  const interactions = new Set(
    rows.flatMap((row) => (row.interaction_id ? [row.interaction_id] : [])),
  );
  const strengths = rows.flatMap((row) => {
    const strength = evidenceStrength(row);
    return strength === null ? [] : [strength];
  });
  const confidence =
    strengths.length > 0
      ? strengths.reduce((sum, value) => sum + value, 0) / strengths.length
      : 0;
  const overallScore = dimensions.length === 0
    ? 0
    : confidence * (
        0.45
        + 0.25 * ratio(
          evidenceIds.size,
          CANDIDATE_COVERAGE_POLICY.overallEvidenceSaturation,
        )
        + 0.15 * ratio(
          sources.size,
          CANDIDATE_COVERAGE_POLICY.overallSourceSaturation,
        )
        + 0.15 * ratio(
          interactions.size,
          CANDIDATE_COVERAGE_POLICY.overallInteractionSaturation,
        )
      );
  const timestamps = rows.map(observedAt);

  return {
    candidateId,
    overallScore: clamp01(overallScore),
    evidenceCount: evidenceIds.size,
    sourceDiversity: sources.size,
    interactionCount: interactions.size,
    firstObservedAt: minTimestamp(timestamps),
    lastObservedAt: maxTimestamp(timestamps),
    policyVersion: CANDIDATE_COVERAGE_POLICY.version,
    dimensions,
  };
}

export async function persistCandidateCoverage(
  db: D1Database,
  candidateId: string,
  coverage: CoverageResult,
): Promise<void> {
  await db.prepare(
    `INSERT INTO candidate_coverage (
       candidate_id,
       overall_coverage,
       dimension_count,
       evidence_count,
       source_diversity,
       interaction_count,
       first_observed_at,
       last_observed_at,
       policy_version,
       updated_at
     )
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, unixepoch())
     ON CONFLICT(candidate_id) DO UPDATE SET
       overall_coverage = excluded.overall_coverage,
       dimension_count = excluded.dimension_count,
       evidence_count = excluded.evidence_count,
       source_diversity = excluded.source_diversity,
       interaction_count = excluded.interaction_count,
       first_observed_at = excluded.first_observed_at,
       last_observed_at = excluded.last_observed_at,
       policy_version = excluded.policy_version,
       updated_at = excluded.updated_at`,
  ).bind(
    candidateId,
    coverage.overallScore,
    coverage.dimensions.length,
    coverage.evidenceCount,
    coverage.sourceDiversity,
    coverage.interactionCount,
    coverage.firstObservedAt,
    coverage.lastObservedAt,
    coverage.policyVersion,
  ).run();

  await db.prepare(
    `DELETE FROM candidate_coverage_dimensions WHERE candidate_id = ?1`,
  ).bind(candidateId).run();

  for (const dimension of coverage.dimensions) {
    await db.prepare(
      `INSERT INTO candidate_coverage_dimensions (
         candidate_id,
         concept_id,
         canonical_key,
         label,
         score,
         confidence,
         evidence_count,
         assertion_count,
         source_diversity,
         interaction_count,
         first_observed_at,
         last_observed_at,
         policy_version,
         updated_at
       )
       VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7,
         ?8, ?9, ?10, ?11, ?12, ?13, unixepoch()
       )`,
    ).bind(
      candidateId,
      dimension.conceptId,
      dimension.canonicalKey,
      dimension.label,
      dimension.score,
      dimension.confidence,
      dimension.evidenceCount,
      dimension.assertionCount,
      dimension.sourceDiversity,
      dimension.interactionCount,
      dimension.firstObservedAt,
      dimension.lastObservedAt,
      coverage.policyVersion,
    ).run();
  }
}

async function loadCoverageEvidence(
  db: D1Database,
  candidateId: string,
): Promise<CandidateCoverageEvidenceRow[]> {
  const result = await db.prepare(
    `SELECT
       c.id AS concept_id,
       c.canonical_key,
       c.label,
       sa.id AS assertion_id,
       sa.confidence AS assertion_confidence,
       sa.observed_at AS assertion_observed_at,
       se.id AS evidence_id,
       se.strength AS evidence_strength,
       se.polarity AS evidence_polarity,
       se.observed_at AS evidence_observed_at,
       COALESCE(
         json_extract(se.metadata_json, '$.sourceType'),
         i.interaction_type
       ) AS source_key,
       se.interaction_id
     FROM applications app
     JOIN workspace_people wp ON wp.id = app.workspace_person_id
     JOIN semantic_assertions sa ON sa.workspace_person_id = wp.id
     JOIN assertion_concepts ac ON ac.assertion_id = sa.id
     JOIN concepts c ON c.id = ac.concept_id
     JOIN signal_evidence se
       ON se.assertion_id = sa.id
      AND se.concept_id = c.id
     LEFT JOIN interactions i ON i.id = se.interaction_id
     WHERE app.legacy_candidate_id = ?1
     ORDER BY c.canonical_key, COALESCE(se.observed_at, sa.observed_at), sa.id`,
  ).bind(candidateId).all<CandidateCoverageEvidenceRow>();

  return result.results ?? [];
}

export async function computeCandidateCoverage(
  db: D1Database,
  candidateId: string,
): Promise<CoverageResult> {
  let rows: CandidateCoverageEvidenceRow[];
  try {
    rows = await loadCoverageEvidence(db, candidateId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[candidateCoverage] failed to load living-context evidence for ${candidateId}:`,
      message,
    );
    throw new Error(`[candidateCoverage] D1 query failed: ${message}`);
  }

  const coverage = computeCoverageFromRows(rows, candidateId);
  try {
    await persistCandidateCoverage(db, candidateId, coverage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[candidateCoverage] failed to persist coverage for ${candidateId}:`,
      message,
    );
    throw new Error(`[candidateCoverage] D1 persist failed: ${message}`);
  }
  return coverage;
}

export function identifyNextProbeTarget(
  coverage: CoverageResult,
  exhaustedConcepts: CoverageAspect[],
  targetDimensions: CoverageDimension[] = coverage.dimensions,
): CoverageDimension | null {
  const exhausted = new Set(exhaustedConcepts);
  const eligible = targetDimensions
    .filter((dimension) =>
      !exhausted.has(dimension.conceptId)
      && !exhausted.has(dimension.canonicalKey)
      && dimension.score < CANDIDATE_COVERAGE_POLICY.probeCompleteThreshold
    )
    .sort((left, right) =>
      left.score - right.score
      || left.canonicalKey.localeCompare(right.canonicalKey)
      || left.conceptId.localeCompare(right.conceptId)
    );
  return eligible[0] ?? null;
}

export async function updateNextProbeTarget(
  db: D1Database,
  candidateId: string,
  nextProbeConceptId: string | null,
): Promise<void> {
  try {
    await db.prepare(
      `UPDATE candidate_coverage
       SET next_probe_concept_id = ?1
       WHERE candidate_id = ?2`,
    ).bind(nextProbeConceptId, candidateId).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[candidateCoverage] failed to update next probe concept for ${candidateId}:`,
      message,
    );
    throw new Error(`[candidateCoverage] D1 update failed: ${message}`);
  }
}

export async function getCandidateCoverage(
  db: D1Database,
  candidateId: string,
): Promise<CandidateCoverage | null> {
  try {
    const row = await db.prepare(
      `SELECT
         candidate_id,
         overall_coverage,
         dimension_count,
         evidence_count,
         source_diversity,
         interaction_count,
         first_observed_at,
         last_observed_at,
         last_probed_at,
         next_probe_concept_id,
         policy_version,
         updated_at
       FROM candidate_coverage
       WHERE candidate_id = ?1`,
    ).bind(candidateId).first<Omit<CandidateCoverage, 'dimensions'>>();
    if (!row) return null;

    const dimensions = await db.prepare(
      `SELECT
         concept_id,
         canonical_key,
         label,
         score,
         confidence,
         evidence_count,
         assertion_count,
         source_diversity,
         interaction_count,
         first_observed_at,
         last_observed_at
       FROM candidate_coverage_dimensions
       WHERE candidate_id = ?1
       ORDER BY canonical_key`,
    ).bind(candidateId).all<{
      concept_id: string;
      canonical_key: string;
      label: string;
      score: number;
      confidence: number;
      evidence_count: number;
      assertion_count: number;
      source_diversity: number;
      interaction_count: number;
      first_observed_at: string | null;
      last_observed_at: string | null;
    }>();

    return {
      ...row,
      dimensions: (dimensions.results ?? []).map((dimension) => ({
        conceptId: dimension.concept_id,
        canonicalKey: dimension.canonical_key,
        label: dimension.label,
        score: dimension.score,
        confidence: dimension.confidence,
        evidenceCount: dimension.evidence_count,
        assertionCount: dimension.assertion_count,
        sourceDiversity: dimension.source_diversity,
        interactionCount: dimension.interaction_count,
        firstObservedAt: dimension.first_observed_at,
        lastObservedAt: dimension.last_observed_at,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[candidateCoverage] failed to get coverage for ${candidateId}:`,
      message,
    );
    throw new Error(`[candidateCoverage] D1 query failed: ${message}`);
  }
}
