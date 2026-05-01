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

function safeConfidence(value: number | null): number {
  return value ?? 0;
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
  nodes: { confidence: number | null }[],
): number {
  const count = nodes.length;
  if (count === 0) return 0.0;

  const avgConfidence =
    nodes.reduce((sum, n) => sum + safeConfidence(n.confidence), 0) / count;

  if (count >= 3 && avgConfidence >= 0.7) return 1.0;

  // Linear interpolation between 1 node (0.3) and 3 nodes (1.0)
  const linear = count >= 3 ? 1.0 : 0.3 + (count - 1) * 0.35;
  return clamp(linear * (avgConfidence / 0.7), 0, 1);
}

function computeCultural(
  nodes: {
    confidence: number | null;
    extracted_properties_json: string | null;
  }[],
): number {
  const covered = new Set<string>();

  for (const node of nodes) {
    if (safeConfidence(node.confidence) < 0.6) continue;
    const props = safeParseJson(node.extracted_properties_json);
    const dimension =
      typeof props?.dimension === 'string' ? props.dimension : null;
    if (dimension && CULTURAL_DIMENSIONS.has(dimension)) {
      covered.add(dimension);
    }
  }

  return Math.min(covered.size * 0.2, 1.0);
}

function computeTechnical(
  nodes: { confidence: number | null; extracted_properties_json: string | null }[],
): number {
  const count = nodes.length;
  if (count === 0) return 0.0;

  const avgConfidence =
    nodes.reduce((sum, n) => sum + safeConfidence(n.confidence), 0) / count;

  // Tenure bonus: skills with >=1 year attributed contribute more
  let skillsWithTenure = 0;
  for (const node of nodes) {
    if (node.extracted_properties_json) {
      const props = safeParseJson(node.extracted_properties_json);
      const years = typeof props?.years_attributed === 'number' ? props.years_attributed : null;
      if (years !== null && years >= 1) {
        skillsWithTenure++;
      }
    }
  }

  const baseScore = Math.min(count / 5, 1.0) * (avgConfidence / 0.65);
  const tenureBonus = Math.min(skillsWithTenure / 5, 0.3); // max 0.3 bonus

  return clamp(baseScore + tenureBonus, 0, 1);
}

function computeMotivation(
  nodes: { node_type: CandidateNodeType; confidence: number | null }[],
): number {
  let hasMotivation = false;
  let hasWorkingStyle = false;
  let hasCareerArc = false;

  for (const node of nodes) {
    if (safeConfidence(node.confidence) < 0.6) continue;
    if (node.node_type === 'Motivation') hasMotivation = true;
    else if (node.node_type === 'WorkingStyle') hasWorkingStyle = true;
    else if (node.node_type === 'CareerArc') hasCareerArc = true;
  }

  if (hasMotivation && hasWorkingStyle && hasCareerArc) return 1.0;
  if (hasMotivation && hasWorkingStyle) return 0.8;

  const typeCount =
    Number(hasMotivation) + Number(hasWorkingStyle) + Number(hasCareerArc);
  if (typeCount === 1) return 0.4;

  return 0.0;
}

function computeContext(
  nodes: { extracted_properties_json: string | null }[],
): number {
  const count = nodes.length;
  if (count === 0) return 0.0;
  if (count === 1) return 0.5;

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
  }[] = [];

  try {
    const result = await db
      .prepare(
        `SELECT node_type, confidence, extracted_properties_json
         FROM candidate_nodes
         WHERE candidate_id = ?1
           AND superseded_at IS NULL`,
      )
      .bind(candidateId)
      .all<{
        node_type: CandidateNodeType;
        confidence: number | null;
        extracted_properties_json: string | null;
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
