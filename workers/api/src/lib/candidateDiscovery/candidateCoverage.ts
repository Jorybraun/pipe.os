/**
 * Candidate coverage scoring — computes per-dimension completeness scores from
 * active candidate_nodes and persists the result to candidate_coverage.
 *
 * Used by the screener and re-engagement pipelines to decide which dimension
 * to probe next.
 */

import type {
  CandidateNodeType,
  CoverageAspect,
  CoverageResult,
  CandidateCoverage,
} from '../../types';

const TIE_BREAK_ORDER: CoverageAspect[] = [
  'experience',
  'technical',
  'cultural',
  'motivation',
  'context',
];

const EXPERIENCE_NODE_TYPES: CandidateNodeType[] = [
  'Experience',
  'Accomplishment',
  'Project',
];

const TECHNICAL_NODE_TYPES: CandidateNodeType[] = [
  'Skill',
  'TechnicalDemonstration',
  'Education',
  'Credential',
];

const MOTIVATION_NODE_TYPES: CandidateNodeType[] = [
  'Motivation',
  'WorkingStyle',
  'CareerArc',
];

const CULTURAL_DIMENSIONS = new Set([
  // Competency dimensions (5)
  'ownership',
  'collaboration',
  'learning-orientation',
  'conflict-handling',
  'self-awareness',
  // Profile dimensions (5)
  'autonomy',
  'risk-tolerance',
  'work-pace',
  'collaboration-style',
  'feedback-orientation',
]);

const CONTEXT_SUBTYPES = new Set([
  'location',
  'availability',
  'compensation',
  'timezone',
]);

const SOURCE_WEIGHTS: Record<string, number> = {
  code_review_session: 1.0,
  implementation_challenge: 1.0,
  culture_interview: 1.0,
  automated_screener: 0.9,
  github_enrichment: 0.7,
  resume: 0.6,
  recruiter_note: 0.5,
};

function safeConfidence(value: number | null): number {
  return value ?? 0;
}

function sourceWeight(sourceType: string | null): number {
  if (!sourceType) return 0.5;
  return SOURCE_WEIGHTS[sourceType] ?? 0.5;
}

function safeParseJson(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeExperience(
  nodes: { confidence: number | null; source_type: string | null }[],
): number {
  if (nodes.length === 0) return 0.0;

  let totalWeight = 0;
  let weightedConfidence = 0;
  for (const node of nodes) {
    const w = sourceWeight(node.source_type);
    totalWeight += w;
    weightedConfidence += safeConfidence(node.confidence) * w;
  }

  const avgConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;

  if (totalWeight >= 3 && avgConfidence >= 0.7) return 1.0;

  // Linear interpolation between 1 node-weight (0.3) and 3 node-weights (1.0)
  const linear = totalWeight >= 3 ? 1.0 : 0.3 + (totalWeight - 1) * 0.35;
  return clamp(linear * (avgConfidence / 0.7), 0, 1);
}

function computeCultural(
  nodes: {
    confidence: number | null;
    extracted_properties_json: string | null;
    source_type: string | null;
  }[],
): number {
  // Track max weight per dimension
  const dimensionWeights = new Map<string, number>();

  for (const node of nodes) {
    if (safeConfidence(node.confidence) < 0.6) continue;
    const props = safeParseJson(node.extracted_properties_json);
    const dimension =
      typeof props?.dimension === 'string' ? props.dimension : null;
    if (dimension && CULTURAL_DIMENSIONS.has(dimension)) {
      const w = sourceWeight(node.source_type);
      const existing = dimensionWeights.get(dimension) ?? 0;
      if (w > existing) {
        dimensionWeights.set(dimension, w);
      }
    }
  }

  let weightedCoverage = 0;
  for (const w of dimensionWeights.values()) {
    weightedCoverage += 0.2 * w;
  }

  return Math.min(weightedCoverage, 1.0);
}

function computeTechnical(
  nodes: { confidence: number | null; extracted_properties_json: string | null; source_type: string | null }[],
): number {
  if (nodes.length === 0) return 0.0;

  let totalWeight = 0;
  let weightedConfidence = 0;
  for (const node of nodes) {
    const w = sourceWeight(node.source_type);
    totalWeight += w;
    weightedConfidence += safeConfidence(node.confidence) * w;
  }

  const avgConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;

  // Tenure bonus: skills with >=1 year attributed contribute more (weighted)
  let weightedTenure = 0;
  for (const node of nodes) {
    if (node.extracted_properties_json) {
      const props = safeParseJson(node.extracted_properties_json);
      const years = typeof props?.years_attributed === 'number' ? props.years_attributed : null;
      if (years !== null && years >= 1) {
        weightedTenure += sourceWeight(node.source_type);
      }
    }
  }

  const baseScore = Math.min(totalWeight / 5, 1.0) * (avgConfidence / 0.65);
  const tenureBonus = Math.min(weightedTenure / 5, 0.3); // max 0.3 bonus

  return clamp(baseScore + tenureBonus, 0, 1);
}

function computeMotivation(
  nodes: { node_type: CandidateNodeType; confidence: number | null; source_type: string | null }[],
): number {
  let motivationWeight = 0;
  let workingStyleWeight = 0;
  let careerArcWeight = 0;

  for (const node of nodes) {
    if (safeConfidence(node.confidence) < 0.6) continue;
    const w = sourceWeight(node.source_type);
    if (node.node_type === 'Motivation') motivationWeight = Math.max(motivationWeight, w);
    else if (node.node_type === 'WorkingStyle') workingStyleWeight = Math.max(workingStyleWeight, w);
    else if (node.node_type === 'CareerArc') careerArcWeight = Math.max(careerArcWeight, w);
  }

  const weightedSum = motivationWeight + workingStyleWeight + careerArcWeight;

  if (motivationWeight > 0 && workingStyleWeight > 0 && careerArcWeight > 0) return Math.min(weightedSum, 1.0);
  if (motivationWeight > 0 && workingStyleWeight > 0) return Math.min(0.8 * (weightedSum / 2), 1.0);

  const typeCount =
    Number(motivationWeight > 0) + Number(workingStyleWeight > 0) + Number(careerArcWeight > 0);
  if (typeCount === 1) return 0.4 * weightedSum;

  return 0.0;
}

function computeContext(
  nodes: { extracted_properties_json: string | null; source_type: string | null }[],
): number {
  if (nodes.length === 0) return 0.0;

  let totalWeight = 0;
  for (const node of nodes) {
    totalWeight += sourceWeight(node.source_type);
  }

  if (totalWeight <= 1) return 0.5 * totalWeight;

  const subtypes = new Set<string>();
  for (const node of nodes) {
    const props = safeParseJson(node.extracted_properties_json);
    const subtype =
      typeof props?.subtype === 'string' ? props.subtype : null;
    if (subtype && CONTEXT_SUBTYPES.has(subtype)) {
      subtypes.add(subtype);
    }
  }

  return subtypes.size >= 2 ? 1.0 : 0.5;
}

export async function computeCandidateCoverage(
  db: D1Database,
  candidateId: string,
): Promise<CoverageResult> {
  let rows: {
    node_type: CandidateNodeType;
    confidence: number | null;
    extracted_properties_json: string | null;
    source_type: string | null;
  }[] = [];

  try {
    const result = await db
      .prepare(
        `SELECT node_type, confidence, extracted_properties_json, source_type
         FROM candidate_nodes
         WHERE candidate_id = ?1
           AND superseded_at IS NULL`,
      )
      .bind(candidateId)
      .all<{
        node_type: CandidateNodeType;
        confidence: number | null;
        extracted_properties_json: string | null;
        source_type: string | null;
      }>();

    rows = result.results ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[candidateCoverage] failed to query candidate_nodes for ${candidateId}:`,
      msg,
    );
    throw new Error(`[candidateCoverage] D1 query failed: ${msg}`);
  }

  const experienceNodes = rows.filter((r) =>
    EXPERIENCE_NODE_TYPES.includes(r.node_type),
  );
  const culturalNodes = rows.filter((r) => r.node_type === 'CulturalSignal');
  const technicalNodes = rows.filter((r) =>
    TECHNICAL_NODE_TYPES.includes(r.node_type),
  );
  const motivationNodes = rows.filter((r) =>
    MOTIVATION_NODE_TYPES.includes(r.node_type),
  );
  const contextNodes = rows.filter((r) => r.node_type === 'Context');

  const coverage: CoverageResult = {
    experience: computeExperience(experienceNodes),
    cultural: computeCultural(culturalNodes),
    technical: computeTechnical(technicalNodes),
    motivation: computeMotivation(motivationNodes),
    context: computeContext(contextNodes),
  };

  try {
    await db
      .prepare(
        `INSERT INTO candidate_coverage (
           candidate_id,
           experience_coverage,
           cultural_coverage,
           technical_coverage,
           motivation_coverage,
           context_coverage,
           updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())
         ON CONFLICT(candidate_id) DO UPDATE SET
           experience_coverage = excluded.experience_coverage,
           cultural_coverage = excluded.cultural_coverage,
           technical_coverage = excluded.technical_coverage,
           motivation_coverage = excluded.motivation_coverage,
           context_coverage = excluded.context_coverage,
           updated_at = excluded.updated_at`,
      )
      .bind(
        candidateId,
        coverage.experience,
        coverage.cultural,
        coverage.technical,
        coverage.motivation,
        coverage.context,
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[candidateCoverage] failed to persist coverage for ${candidateId}:`,
      msg,
    );
    throw new Error(`[candidateCoverage] D1 persist failed: ${msg}`);
  }

  return coverage;
}

export function identifyNextProbeTarget(
  coverage: CoverageResult,
  sessionExhaustedDimensions: CoverageAspect[],
): CoverageAspect | null {
  const exhausted = new Set(sessionExhaustedDimensions);
  let best: CoverageAspect | null = null;
  let bestScore = Infinity;

  for (const dim of TIE_BREAK_ORDER) {
    if (exhausted.has(dim)) continue;
    const score = coverage[dim];
    if (score < bestScore) {
      bestScore = score;
      best = dim;
    }
  }

  if (best === null) return null;
  if (bestScore >= 0.9) return null;
  return best;
}

export async function updateNextProbeTarget(
  db: D1Database,
  candidateId: string,
  nextProbeTarget: CoverageAspect | null,
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE candidate_coverage
         SET next_probe_target = ?1
         WHERE candidate_id = ?2`,
      )
      .bind(nextProbeTarget, candidateId)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[candidateCoverage] failed to update next_probe_target for ${candidateId}:`,
      msg,
    );
    throw new Error(`[candidateCoverage] D1 update failed: ${msg}`);
  }
}

export async function getCandidateCoverage(
  db: D1Database,
  candidateId: string,
): Promise<CandidateCoverage | null> {
  try {
    const row = await db
      .prepare(
        `SELECT
           candidate_id,
           experience_coverage,
           cultural_coverage,
           technical_coverage,
           motivation_coverage,
           context_coverage,
           last_probed_at,
           next_probe_target,
           updated_at
         FROM candidate_coverage
         WHERE candidate_id = ?1`,
      )
      .bind(candidateId)
      .first<CandidateCoverage>();

    return row ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[candidateCoverage] failed to get coverage for ${candidateId}:`,
      msg,
    );
    throw new Error(`[candidateCoverage] D1 query failed: ${msg}`);
  }
}
