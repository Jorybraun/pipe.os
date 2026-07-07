/**
 * Evidence staleness alerting — identifies when key evidence is too old
 * or when evidence gaps create matching risk, producing actionable alerts
 * for recruiters.
 *
 * Combines evidence freshness (decay multipliers), readiness dimensions,
 * and gap analysis to produce prioritized staleness alerts.
 */

import {
  computeDecayMultiplier,
  DEFAULT_DECAY_CONFIG,
  type TemporalDecayConfig,
} from '../challengeMatching/temporalDecay';
import type { D1Database } from '@cloudflare/workers-types';
import { resolveCandidateWorkspacePersonId } from './compatibility';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertCategory =
  | 'stale_evidence'
  | 'aging_dimension'
  | 'missing_dimension'
  | 'low_coverage'
  | 'single_source';

export interface StalenessAlert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  dimension: string | null;
  title: string;
  detail: string;
  ageDays: number | null;
  decayMultiplier: number | null;
  recommendation: string;
}

export interface StalenessAlertSummary {
  candidateId: string;
  workspacePersonId: string | null;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  overallHealth: 'healthy' | 'attention_needed' | 'at_risk' | 'critical';
  alerts: StalenessAlert[];
  computedAt: string;
}

export interface StalenessAlertOptions {
  staleDaysThreshold?: number;
  agingDaysThreshold?: number;
  minimumDimensionCount?: number;
  now?: Date;
}

const MS_PER_DAY = 86_400_000;

const DIMENSION_LABELS: Record<string, string> = {
  resume: 'Resume / CV',
  interview: 'Interviews',
  assessment: 'Assessments',
  code_review: 'Code Reviews',
  meeting: 'Meetings',
  phone_call: 'Phone Calls',
  culture: 'Culture Interviews',
  concepts: 'Learned Concepts',
};

interface DimensionRow {
  interaction_type: string;
  freshest_at: string | null;
  evidence_count: number;
  source_span_count: number;
  distinct_sources: number;
}

interface ConceptSummaryRow {
  distinct_concepts: number;
  freshest_at: string | null;
}

const INTERACTION_TO_DIMENSION: Record<string, string> = {
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

function dimensionForInteraction(interactionType: string): string | null {
  const normalized = interactionType.toLowerCase().replace(/-/g, '_');
  return INTERACTION_TO_DIMENSION[normalized] ?? null;
}

function alertId(category: AlertCategory, dimension: string | null): string {
  return `staleness:${category}:${dimension ?? 'overall'}`;
}

function classifyOverallHealth(
  criticalCount: number,
  warningCount: number,
): StalenessAlertSummary['overallHealth'] {
  if (criticalCount > 0) return 'critical';
  if (warningCount >= 3) return 'at_risk';
  if (warningCount > 0) return 'attention_needed';
  return 'healthy';
}

export function computeStalenessAlerts(
  dimensions: Array<{
    dimension: string;
    freshestAt: string | null;
    evidenceCount: number;
    sourceSpanCount: number;
    distinctSources: number;
  }>,
  conceptSummary: { distinctConcepts: number; freshestAt: string | null },
  options?: StalenessAlertOptions,
): StalenessAlert[] {
  const now = options?.now ?? new Date();
  const staleThreshold = options?.staleDaysThreshold ?? 180;
  const agingThreshold = options?.agingDaysThreshold ?? 90;
  const nowMs = now.getTime();
  const alerts: StalenessAlert[] = [];

  const coreDimensions = ['resume', 'interview', 'assessment', 'code_review'];
  const presentDimensions = new Set(
    dimensions
      .filter((d) => d.evidenceCount > 0)
      .map((d) => d.dimension),
  );

  for (const dim of dimensions) {
    if (dim.evidenceCount === 0) continue;

    if (dim.freshestAt) {
      const freshestMs = Date.parse(dim.freshestAt);
      if (Number.isFinite(freshestMs)) {
        const ageDays = Math.max(0, (nowMs - freshestMs) / MS_PER_DAY);

        if (ageDays >= staleThreshold) {
          alerts.push({
            id: alertId('stale_evidence', dim.dimension),
            severity: 'critical',
            category: 'stale_evidence',
            dimension: dim.dimension,
            title: `${DIMENSION_LABELS[dim.dimension] ?? dim.dimension} evidence is stale`,
            detail: `Most recent evidence is ${Math.round(ageDays)} days old (threshold: ${staleThreshold} days). Decay multiplier significantly reduces this evidence's weight in matching.`,
            ageDays: Math.round(ageDays),
            decayMultiplier: Math.round(
              computeDecayMultiplier(freshestMs, {
                ...DEFAULT_DECAY_CONFIG,
                referenceTimeMs: nowMs,
              }) * 100,
            ) / 100,
            recommendation: `Schedule a new ${dim.dimension.replace(/_/g, ' ')} to refresh this evidence dimension.`,
          });
        } else if (ageDays >= agingThreshold) {
          alerts.push({
            id: alertId('aging_dimension', dim.dimension),
            severity: 'warning',
            category: 'aging_dimension',
            dimension: dim.dimension,
            title: `${DIMENSION_LABELS[dim.dimension] ?? dim.dimension} evidence is aging`,
            detail: `Most recent evidence is ${Math.round(ageDays)} days old. Evidence weight is being reduced by temporal decay.`,
            ageDays: Math.round(ageDays),
            decayMultiplier: Math.round(
              computeDecayMultiplier(freshestMs, {
                ...DEFAULT_DECAY_CONFIG,
                referenceTimeMs: nowMs,
              }) * 100,
            ) / 100,
            recommendation: `Consider refreshing ${dim.dimension.replace(/_/g, ' ')} evidence before the next match run.`,
          });
        }
      }
    }

    if (dim.distinctSources <= 1 && dim.evidenceCount > 0) {
      alerts.push({
        id: alertId('single_source', dim.dimension),
        severity: 'info',
        category: 'single_source',
        dimension: dim.dimension,
        title: `${DIMENSION_LABELS[dim.dimension] ?? dim.dimension} relies on a single source`,
        detail: `All ${dim.evidenceCount} evidence entries come from ${dim.distinctSources} source. Cross-referencing with additional sources strengthens confidence.`,
        ageDays: null,
        decayMultiplier: null,
        recommendation: `Add a second independent ${dim.dimension.replace(/_/g, ' ')} source to corroborate existing evidence.`,
      });
    }
  }

  for (const dim of coreDimensions) {
    if (!presentDimensions.has(dim)) {
      alerts.push({
        id: alertId('missing_dimension', dim),
        severity: 'warning',
        category: 'missing_dimension',
        dimension: dim,
        title: `No ${DIMENSION_LABELS[dim] ?? dim} evidence`,
        detail: `This core evidence dimension has no entries. Matching quality is reduced without it.`,
        ageDays: null,
        decayMultiplier: null,
        recommendation: dimensionRecommendation(dim),
      });
    }
  }

  if (conceptSummary.distinctConcepts < 5) {
    alerts.push({
      id: alertId('low_coverage', 'concepts'),
      severity: conceptSummary.distinctConcepts === 0 ? 'warning' : 'info',
      category: 'low_coverage',
      dimension: 'concepts',
      title: 'Low concept coverage',
      detail: `Only ${conceptSummary.distinctConcepts} distinct concepts learned. Richer concept coverage improves matching precision.`,
      ageDays: null,
      decayMultiplier: null,
      recommendation: 'More interactions will organically grow the concept graph.',
    });
  }

  if (conceptSummary.freshestAt) {
    const freshestMs = Date.parse(conceptSummary.freshestAt);
    if (Number.isFinite(freshestMs)) {
      const ageDays = Math.max(0, (nowMs - freshestMs) / MS_PER_DAY);
      if (ageDays >= staleThreshold && conceptSummary.distinctConcepts > 0) {
        alerts.push({
          id: alertId('stale_evidence', 'concepts'),
          severity: 'warning',
          category: 'stale_evidence',
          dimension: 'concepts',
          title: 'Concept evidence is stale',
          detail: `Most recent concept observation is ${Math.round(ageDays)} days old.`,
          ageDays: Math.round(ageDays),
          decayMultiplier: Math.round(
            computeDecayMultiplier(freshestMs, {
              ...DEFAULT_DECAY_CONFIG,
              referenceTimeMs: nowMs,
            }) * 100,
          ) / 100,
          recommendation: 'Schedule an interaction to refresh the concept graph with current evidence.',
        });
      }
    }
  }

  alerts.sort((a, b) => {
    const severityOrder: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  return alerts;
}

function dimensionRecommendation(dim: string): string {
  const recs: Record<string, string> = {
    resume: 'Upload a resume or CV to establish baseline qualifications.',
    interview: 'Conduct a structured interview to gather role-specific evidence.',
    assessment: 'Assign an assessment challenge to validate technical capabilities.',
    code_review: 'Set up a code review challenge to evaluate practical coding skills.',
    meeting: 'Schedule a meeting to capture additional context.',
    phone_call: 'A phone screen can quickly surface communication and domain depth.',
    culture: 'A culture interview reveals collaboration style and team fit signals.',
  };
  return recs[dim] ?? `Add ${dim.replace(/_/g, ' ')} evidence to strengthen the profile.`;
}

export async function loadCandidateStalenessAlerts(
  db: D1Database,
  candidateId: string,
  options?: StalenessAlertOptions,
): Promise<StalenessAlertSummary | null> {
  const wpId = await resolveCandidateWorkspacePersonId(db, candidateId);
  if (!wpId) return null;

  const [dimensionResult, conceptResult] = await Promise.all([
    db
      .prepare(
        `SELECT
           i.interaction_type,
           MAX(COALESCE(i.started_at, i.created_at)) AS freshest_at,
           COUNT(DISTINCT i.id) AS evidence_count,
           COUNT(DISTINCT ss.id) AS source_span_count,
           COUNT(DISTINCT i.external_reference) AS distinct_sources
         FROM interactions i
         LEFT JOIN artifacts a ON a.interaction_id = i.id
         LEFT JOIN artifact_versions av ON av.artifact_id = a.id
         LEFT JOIN source_spans ss ON ss.artifact_version_id = av.id
         WHERE i.workspace_person_id = ?1
         GROUP BY i.interaction_type`,
      )
      .bind(wpId)
      .all<DimensionRow>(),
    db
      .prepare(
        `SELECT
           COUNT(DISTINCT ac.concept_id) AS distinct_concepts,
           MAX(sa.observed_at) AS freshest_at
         FROM assertion_concepts ac
         JOIN semantic_assertions sa ON sa.id = ac.assertion_id
         WHERE sa.workspace_person_id = ?1`,
      )
      .bind(wpId)
      .first<ConceptSummaryRow>(),
  ]);

  const dimensionAgg = new Map<
    string,
    {
      dimension: string;
      freshestAt: string | null;
      evidenceCount: number;
      sourceSpanCount: number;
      distinctSources: number;
    }
  >();

  for (const row of dimensionResult.results ?? []) {
    const dim = dimensionForInteraction(row.interaction_type);
    if (!dim) continue;

    const existing = dimensionAgg.get(dim);
    if (existing) {
      existing.evidenceCount += Number(row.evidence_count);
      existing.sourceSpanCount += Number(row.source_span_count);
      existing.distinctSources += Number(row.distinct_sources);
      if (row.freshest_at && (!existing.freshestAt || row.freshest_at > existing.freshestAt)) {
        existing.freshestAt = row.freshest_at;
      }
    } else {
      dimensionAgg.set(dim, {
        dimension: dim,
        freshestAt: row.freshest_at,
        evidenceCount: Number(row.evidence_count),
        sourceSpanCount: Number(row.source_span_count),
        distinctSources: Number(row.distinct_sources),
      });
    }
  }

  const dimensions = [...dimensionAgg.values()];
  const conceptSummary = {
    distinctConcepts: Number(conceptResult?.distinct_concepts ?? 0),
    freshestAt: conceptResult?.freshest_at ?? null,
  };

  const alerts = computeStalenessAlerts(dimensions, conceptSummary, options);

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;
  const infoCount = alerts.filter((a) => a.severity === 'info').length;

  return {
    candidateId,
    workspacePersonId: wpId,
    criticalCount,
    warningCount,
    infoCount,
    overallHealth: classifyOverallHealth(criticalCount, warningCount),
    alerts,
    computedAt: (options?.now ?? new Date()).toISOString(),
  };
}
