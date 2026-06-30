import {
  computeDecayMultiplier,
  type TemporalDecayConfig,
  DEFAULT_DECAY_CONFIG,
} from '../challengeMatching/temporalDecay';

/**
 * Dimensions across which evidence readiness is measured.
 * Each dimension corresponds to a category of evidence that
 * strengthens a candidate's profile for matching.
 */
export type ReadinessDimension =
  | 'resume'
  | 'interview'
  | 'assessment'
  | 'code_review'
  | 'meeting'
  | 'phone_call'
  | 'culture'
  | 'concepts';

export interface DimensionScore {
  dimension: ReadinessDimension;
  label: string;
  score: number;
  maxScore: number;
  level: 'none' | 'minimal' | 'partial' | 'strong' | 'comprehensive';
  evidenceCount: number;
  sourceSpanCount: number;
  freshestAt: string | null;
  decayMultiplier: number;
  recommendation: string | null;
}

export interface EvidenceReadinessReport {
  candidateId: string;
  workspacePersonId: string;
  overallScore: number;
  overallLevel: 'not_ready' | 'minimal' | 'ready' | 'strong' | 'comprehensive';
  dimensions: DimensionScore[];
  weakest: ReadinessDimension[];
  strongest: ReadinessDimension[];
  recommendations: string[];
  computedAt: string;
}

export interface EvidenceReadinessOptions {
  decayHalfLifeDays?: number;
  now?: Date;
}

interface InteractionRow {
  interaction_type: string;
  started_at: string | null;
  interaction_count: number;
  assertion_count: number;
  source_span_count: number;
  freshest_at: string | null;
}

interface ConceptRow {
  distinct_concepts: number;
  total_observations: number;
  freshest_observed: string | null;
}

interface D1Result<T> {
  results: T[];
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
}

const DIMENSION_LABELS: Record<ReadinessDimension, string> = {
  resume: 'Resume / CV',
  interview: 'Interviews',
  assessment: 'Assessments',
  code_review: 'Code Reviews',
  meeting: 'Meetings',
  phone_call: 'Phone Calls',
  culture: 'Culture Interviews',
  concepts: 'Learned Concepts',
};

const INTERACTION_TO_DIMENSION: Record<string, ReadinessDimension> = {
  resume_upload: 'resume',
  resume_ingestion: 'resume',
  interview: 'interview',
  assessment: 'assessment',
  code_review: 'code_review',
  standalone_code_review: 'code_review',
  meeting: 'meeting',
  meeting_transcript: 'meeting',
  phone_call: 'phone_call',
  phone_screen: 'phone_call',
  culture_interview: 'culture',
  culture_transcript: 'culture',
};

function dimensionForInteraction(interactionType: string): ReadinessDimension | null {
  const normalized = interactionType.toLowerCase().replace(/-/g, '_');
  return INTERACTION_TO_DIMENSION[normalized] ?? null;
}

function classifyLevel(score: number): DimensionScore['level'] {
  if (score <= 0) return 'none';
  if (score < 0.25) return 'minimal';
  if (score < 0.5) return 'partial';
  if (score < 0.75) return 'strong';
  return 'comprehensive';
}

function classifyOverallLevel(score: number): EvidenceReadinessReport['overallLevel'] {
  if (score < 0.15) return 'not_ready';
  if (score < 0.35) return 'minimal';
  if (score < 0.55) return 'ready';
  if (score < 0.75) return 'strong';
  return 'comprehensive';
}

function dimensionRecommendation(
  dim: ReadinessDimension,
  level: DimensionScore['level'],
): string | null {
  if (level === 'strong' || level === 'comprehensive') return null;

  const recs: Record<ReadinessDimension, string> = {
    resume: 'Upload a resume or CV to establish baseline qualifications.',
    interview: 'Conduct a structured interview to gather role-specific evidence.',
    assessment: 'Assign an assessment challenge to validate technical capabilities.',
    code_review: 'Set up a code review challenge to evaluate practical coding skills.',
    meeting: 'Schedule a meeting to capture additional context and evidence.',
    phone_call: 'A phone screen can quickly surface communication and domain depth.',
    culture: 'A culture interview reveals collaboration style and team fit signals.',
    concepts: 'More interactions will organically grow the learned concept graph.',
  };
  return recs[dim];
}

function computeDimensionScore(
  evidenceCount: number,
  sourceSpanCount: number,
  decayMultiplier: number,
): number {
  if (evidenceCount === 0) return 0;

  const countScore = Math.min(evidenceCount / 5, 1.0);
  const depthScore = Math.min(sourceSpanCount / 10, 1.0);
  const raw = countScore * 0.6 + depthScore * 0.4;
  return Math.min(raw * decayMultiplier, 1.0);
}

function computeConceptScore(
  distinctConcepts: number,
  totalObservations: number,
  decayMultiplier: number,
): number {
  if (distinctConcepts === 0) return 0;

  const breadthScore = Math.min(distinctConcepts / 20, 1.0);
  const depthScore = Math.min(totalObservations / 50, 1.0);
  const raw = breadthScore * 0.5 + depthScore * 0.5;
  return Math.min(raw * decayMultiplier, 1.0);
}

export async function computeEvidenceReadiness(
  db: D1Database,
  candidateId: string,
  options?: EvidenceReadinessOptions,
): Promise<EvidenceReadinessReport | null> {
  const now = options?.now ?? new Date();
  const halfLifeDays = options?.decayHalfLifeDays ?? 90;
  const decayConfig: TemporalDecayConfig = {
    ...DEFAULT_DECAY_CONFIG,
    referenceTimeMs: now.getTime(),
    halfLifeDays,
  };

  const wpRow = await db
    .prepare(
      `SELECT wp.id AS workspace_person_id
       FROM workspace_people wp
       JOIN applications a ON a.workspace_person_id = wp.id
       WHERE a.legacy_candidate_id = ?1
       LIMIT 1`,
    )
    .bind(candidateId)
    .first<{ workspace_person_id: string }>();

  if (!wpRow) return null;
  const wpId = wpRow.workspace_person_id;

  const [interactionResult, conceptResult] = await Promise.all([
    db
      .prepare(
        `SELECT
           i.interaction_type,
           MAX(i.started_at) AS started_at,
           COUNT(DISTINCT i.id) AS interaction_count,
           0 AS assertion_count,
           COUNT(DISTINCT ss.id) AS source_span_count,
           MAX(COALESCE(i.started_at, i.created_at)) AS freshest_at
         FROM interactions i
         LEFT JOIN artifacts a ON a.interaction_id = i.id
         LEFT JOIN artifact_versions av ON av.artifact_id = a.id
         LEFT JOIN source_spans ss ON ss.artifact_version_id = av.id
         WHERE i.workspace_person_id = ?1
         GROUP BY i.interaction_type`,
      )
      .bind(wpId)
      .all<InteractionRow>(),
    db
      .prepare(
        `SELECT
           COUNT(DISTINCT ac.concept_id) AS distinct_concepts,
           COUNT(*) AS total_observations,
           MAX(sa.observed_at) AS freshest_observed
         FROM assertion_concepts ac
         JOIN semantic_assertions sa ON sa.id = ac.assertion_id
         WHERE sa.workspace_person_id = ?1`,
      )
      .bind(wpId)
      .all<ConceptRow>(),
  ]);

  const interactionRows = interactionResult.results;
  const conceptRow = conceptResult.results[0] ?? {
    distinct_concepts: 0,
    total_observations: 0,
    freshest_observed: null,
  };

  const dimensionAgg = new Map<
    ReadinessDimension,
    {
      evidenceCount: number;
      sourceSpanCount: number;
      freshestAt: string | null;
    }
  >();

  for (const row of interactionRows) {
    const dim = dimensionForInteraction(row.interaction_type);
    if (!dim) continue;

    const existing = dimensionAgg.get(dim);
    if (existing) {
      existing.evidenceCount += Number(row.interaction_count);
      existing.sourceSpanCount += Number(row.source_span_count);
      if (row.freshest_at && (!existing.freshestAt || row.freshest_at > existing.freshestAt)) {
        existing.freshestAt = row.freshest_at;
      }
    } else {
      dimensionAgg.set(dim, {
        evidenceCount: Number(row.interaction_count),
        sourceSpanCount: Number(row.source_span_count),
        freshestAt: row.freshest_at,
      });
    }
  }

  const allDimensions: ReadinessDimension[] = [
    'resume',
    'interview',
    'assessment',
    'code_review',
    'meeting',
    'phone_call',
    'culture',
    'concepts',
  ];

  const dimensions: DimensionScore[] = allDimensions.map((dim) => {
    if (dim === 'concepts') {
      const freshestAt = conceptRow.freshest_observed;
      const decayMultiplier = freshestAt
        ? computeDecayMultiplier(new Date(freshestAt).getTime(), decayConfig)
        : 1;
      const score = computeConceptScore(
        Number(conceptRow.distinct_concepts),
        Number(conceptRow.total_observations),
        decayMultiplier,
      );
      const level = classifyLevel(score);
      return {
        dimension: dim,
        label: DIMENSION_LABELS[dim],
        score: Math.round(score * 100) / 100,
        maxScore: 1,
        level,
        evidenceCount: Number(conceptRow.distinct_concepts),
        sourceSpanCount: Number(conceptRow.total_observations),
        freshestAt,
        decayMultiplier: Math.round(decayMultiplier * 100) / 100,
        recommendation: dimensionRecommendation(dim, level),
      };
    }

    const agg = dimensionAgg.get(dim);
    if (!agg) {
      return {
        dimension: dim,
        label: DIMENSION_LABELS[dim],
        score: 0,
        maxScore: 1,
        level: 'none' as const,
        evidenceCount: 0,
        sourceSpanCount: 0,
        freshestAt: null,
        decayMultiplier: 1,
        recommendation: dimensionRecommendation(dim, 'none'),
      };
    }

    const decayMultiplier = agg.freshestAt
      ? computeDecayMultiplier(new Date(agg.freshestAt).getTime(), decayConfig)
      : 1;
    const score = computeDimensionScore(agg.evidenceCount, agg.sourceSpanCount, decayMultiplier);
    const level = classifyLevel(score);

    return {
      dimension: dim,
      label: DIMENSION_LABELS[dim],
      score: Math.round(score * 100) / 100,
      maxScore: 1,
      level,
      evidenceCount: agg.evidenceCount,
      sourceSpanCount: agg.sourceSpanCount,
      freshestAt: agg.freshestAt,
      decayMultiplier: Math.round(decayMultiplier * 100) / 100,
      recommendation: dimensionRecommendation(dim, level),
    };
  });

  const scored = dimensions.filter((d) => d.score > 0);
  const totalDimensions = dimensions.length;
  const overallScore =
    totalDimensions > 0
      ? Math.round(
          (dimensions.reduce((sum, d) => sum + d.score, 0) / totalDimensions) * 100,
        ) / 100
      : 0;

  const sorted = [...dimensions].sort((a, b) => a.score - b.score);
  const weakest = sorted
    .filter((d) => d.level === 'none' || d.level === 'minimal')
    .slice(0, 3)
    .map((d) => d.dimension);
  const strongest = [...sorted]
    .reverse()
    .filter((d) => d.level === 'strong' || d.level === 'comprehensive')
    .slice(0, 3)
    .map((d) => d.dimension);

  const recommendations = dimensions
    .filter((d) => d.recommendation !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((d) => d.recommendation as string);

  return {
    candidateId,
    workspacePersonId: wpId,
    overallScore,
    overallLevel: classifyOverallLevel(overallScore),
    dimensions,
    weakest,
    strongest,
    recommendations,
    computedAt: now.toISOString(),
  };
}
