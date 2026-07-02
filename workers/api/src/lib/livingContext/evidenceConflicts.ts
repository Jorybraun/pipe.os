/**
 * Evidence conflict detection — surfaces assertions about the same concept
 * from different interaction sources that carry opposing polarity or
 * dramatically different strength levels.
 *
 * Recruiters need this to understand when evidence is ambiguous or
 * contradictory before trusting a match decision.  Each conflict references
 * exact source spans so the recruiter can inspect both sides.
 *
 * Criteria advanced:
 *   #2  — preserve original meaning by surfacing disagreements
 *   #6  — explain every match by showing where evidence conflicts
 *   #8  — production quality: deterministic, source-backed
 */

import {
  computeDecayMultiplier,
  parseObservedAtMs,
  DEFAULT_DECAY_CONFIG,
  type TemporalDecayConfig,
} from '../challengeMatching/temporalDecay';
import { resolveCandidateWorkspacePersonId } from './compatibility';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ConflictType = 'polarity' | 'strength_divergence';
export type ConflictSeverity = 'high' | 'medium' | 'low';

export interface ConflictAssertion {
  assertionId: string;
  narrative: string;
  conceptKey: string;
  strength: number;
  confidence: number;
  polarity: number;
  effectiveStrength: number;
  observedAt: string | null;
  interactionType: string;
  exactText: string | null;
  sourceSpanId: string | null;
}

export interface EvidenceConflict {
  conflictId: string;
  conceptKey: string;
  conflictType: ConflictType;
  severity: ConflictSeverity;
  description: string;
  positiveAssertions: ConflictAssertion[];
  negativeAssertions: ConflictAssertion[];
  strengthDivergence: number;
  impactOnMatch: string;
}

export interface EvidenceConflictReport {
  candidateId: string;
  workspacePersonId: string | null;
  totalConflicts: number;
  highSeverity: number;
  mediumSeverity: number;
  lowSeverity: number;
  conflicts: EvidenceConflict[];
  analyzedAt: string;
}

export interface EvidenceConflictOptions {
  decay?: Partial<TemporalDecayConfig>;
  strengthDivergenceThreshold?: number;
  minAssertionsForConflict?: number;
}

/* ------------------------------------------------------------------ */
/*  Internal row types                                                 */
/* ------------------------------------------------------------------ */

interface AssertionRow {
  assertion_id: string;
  narrative: string;
  concept_key: string | null;
  strength: number | null;
  confidence: number | null;
  polarity: number | null;
  observed_at: string | null;
  interaction_type: string | null;
  exact_text: string | null;
  source_span_id: string | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_STRENGTH_DIVERGENCE_THRESHOLD = 0.5;
const DEFAULT_MIN_ASSERTIONS = 2;

/* ------------------------------------------------------------------ */
/*  Core logic                                                         */
/* ------------------------------------------------------------------ */

function classifySeverity(
  conflictType: ConflictType,
  strengthDivergence: number,
  positiveCount: number,
  negativeCount: number,
): ConflictSeverity {
  if (conflictType === 'polarity') {
    if (negativeCount >= 2 || (positiveCount >= 2 && negativeCount >= 1)) {
      return 'high';
    }
    return 'medium';
  }
  if (strengthDivergence >= 0.7) return 'high';
  if (strengthDivergence >= 0.5) return 'medium';
  return 'low';
}

function describeConflict(
  conceptKey: string,
  conflictType: ConflictType,
  positiveCount: number,
  negativeCount: number,
  strengthDivergence: number,
): string {
  if (conflictType === 'polarity') {
    return `${positiveCount} source(s) affirm "${conceptKey}" while ${negativeCount} source(s) contradict it.`;
  }
  return `Sources disagree on "${conceptKey}" strength — divergence of ${(strengthDivergence * 100).toFixed(0)}% across ${positiveCount + negativeCount} assertion(s).`;
}

function describeMatchImpact(
  severity: ConflictSeverity,
  conceptKey: string,
): string {
  switch (severity) {
    case 'high':
      return `Match score for "${conceptKey}" is unreliable — recruiter review recommended before trusting this signal.`;
    case 'medium':
      return `"${conceptKey}" evidence is mixed — match may over- or under-weight this concept.`;
    case 'low':
      return `Minor strength variation for "${conceptKey}" — unlikely to affect match outcome.`;
  }
}

function deterministicConflictId(
  candidateId: string,
  conceptKey: string,
  conflictType: ConflictType,
): string {
  const input = `conflict:${candidateId}:${conceptKey}:${conflictType}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return `conflict-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Detects evidence conflicts for a candidate by querying their assertions
 * from the living context graph and grouping by concept.
 */
export async function detectEvidenceConflicts(
  db: D1Database,
  candidateId: string,
  options: EvidenceConflictOptions = {},
): Promise<EvidenceConflictReport> {
  const now = Date.now();
  const decayConfig: TemporalDecayConfig = {
    ...DEFAULT_DECAY_CONFIG,
    referenceTimeMs: now,
    ...options.decay,
  };
  const divergenceThreshold =
    options.strengthDivergenceThreshold ?? DEFAULT_STRENGTH_DIVERGENCE_THRESHOLD;
  const minAssertions =
    options.minAssertionsForConflict ?? DEFAULT_MIN_ASSERTIONS;

  const workspacePersonId = await resolveCandidateWorkspacePersonId(db, candidateId);
  if (!workspacePersonId) {
    return {
      candidateId,
      workspacePersonId: null,
      totalConflicts: 0,
      highSeverity: 0,
      mediumSeverity: 0,
      lowSeverity: 0,
      conflicts: [],
      analyzedAt: new Date(now).toISOString(),
    };
  }

  // Load assertions with concept links and source spans
  const { results: rows } = await db
    .prepare(
      `SELECT
         sa.id AS assertion_id,
         sa.narrative,
         c.canonical_key AS concept_key,
         se.strength,
         sa.confidence,
         sa.polarity,
         sa.observed_at,
         i.interaction_type,
         ss.exact_text,
         ss.id AS source_span_id
       FROM semantic_assertions sa
       LEFT JOIN signal_evidence se ON se.assertion_id = sa.id
       LEFT JOIN concepts c ON c.id = se.concept_id
       LEFT JOIN episodes ep ON ep.id = sa.episode_id
       LEFT JOIN interactions i ON i.id = COALESCE(ep.interaction_id, sa.episode_id)
       LEFT JOIN source_spans ss ON ss.artifact_version_id = (
         SELECT av.id FROM artifact_versions av
         JOIN artifacts art ON art.id = av.artifact_id
         WHERE art.interaction_id = i.id
         LIMIT 1
       )
       WHERE sa.workspace_person_id = ?
         AND se.concept_id IS NOT NULL
       ORDER BY c.canonical_key, sa.observed_at DESC`,
    )
    .bind(workspacePersonId)
    .all<AssertionRow>();

  // Group by concept
  const byConcept = new Map<string, AssertionRow[]>();
  for (const row of rows) {
    if (!row.concept_key) continue;
    const existing = byConcept.get(row.concept_key);
    if (existing) {
      existing.push(row);
    } else {
      byConcept.set(row.concept_key, [row]);
    }
  }

  const conflicts: EvidenceConflict[] = [];

  for (const [conceptKey, assertions] of byConcept) {
    if (assertions.length < minAssertions) continue;

    // Check for polarity conflicts
    const positive = assertions.filter(
      (a) => (a.polarity ?? 1) >= 0,
    );
    const negative = assertions.filter(
      (a) => (a.polarity ?? 1) < 0,
    );

    if (positive.length > 0 && negative.length > 0) {
      const toConflictAssertion = (a: AssertionRow): ConflictAssertion => {
        const observedMs = parseObservedAtMs(a.observed_at);
        const decay =
          observedMs != null
            ? computeDecayMultiplier(observedMs, decayConfig)
            : 0.5;
        return {
          assertionId: a.assertion_id,
          narrative: a.narrative,
          conceptKey: a.concept_key ?? conceptKey,
          strength: a.strength ?? 0,
          confidence: a.confidence ?? 0,
          polarity: a.polarity ?? 1,
          effectiveStrength: (a.strength ?? 0) * decay,
          observedAt: a.observed_at,
          interactionType: a.interaction_type ?? 'unknown',
          exactText: a.exact_text ?? null,
          sourceSpanId: a.source_span_id ?? null,
        };
      };

      const positiveAssertions = positive.map(toConflictAssertion);
      const negativeAssertions = negative.map(toConflictAssertion);

      const maxPositive = Math.max(
        ...positiveAssertions.map((a) => a.effectiveStrength),
      );
      const maxNegative = Math.max(
        ...negativeAssertions.map((a) => a.effectiveStrength),
      );
      const divergence = Math.abs(maxPositive - maxNegative);

      const severity = classifySeverity(
        'polarity',
        divergence,
        positive.length,
        negative.length,
      );

      conflicts.push({
        conflictId: deterministicConflictId(
          candidateId,
          conceptKey,
          'polarity',
        ),
        conceptKey,
        conflictType: 'polarity',
        severity,
        description: describeConflict(
          conceptKey,
          'polarity',
          positive.length,
          negative.length,
          divergence,
        ),
        positiveAssertions,
        negativeAssertions,
        strengthDivergence: divergence,
        impactOnMatch: describeMatchImpact(severity, conceptKey),
      });
    }

    // Check for strength divergence (all same polarity but wide range)
    const samePolarity =
      positive.length > 0 && negative.length === 0
        ? positive
        : negative.length > 0 && positive.length === 0
          ? negative
          : null;

    if (samePolarity && samePolarity.length >= minAssertions) {
      const strengths = samePolarity.map((a) => {
        const observedMs = parseObservedAtMs(a.observed_at);
        const decay =
          observedMs != null
            ? computeDecayMultiplier(observedMs, decayConfig)
            : 0.5;
        return (a.strength ?? 0) * decay;
      });
      const maxStrength = Math.max(...strengths);
      const minStrength = Math.min(...strengths);
      const divergence = maxStrength - minStrength;

      if (divergence >= divergenceThreshold) {
        const toConflictAssertion = (a: AssertionRow): ConflictAssertion => {
          const observedMs = parseObservedAtMs(a.observed_at);
          const decay =
            observedMs != null
              ? computeDecayMultiplier(observedMs, decayConfig)
              : 0.5;
          return {
            assertionId: a.assertion_id,
            narrative: a.narrative,
            conceptKey: a.concept_key ?? conceptKey,
            strength: a.strength ?? 0,
            confidence: a.confidence ?? 0,
            polarity: a.polarity ?? 1,
            effectiveStrength: (a.strength ?? 0) * decay,
            observedAt: a.observed_at,
            interactionType: a.interaction_type ?? 'unknown',
            exactText: a.exact_text ?? null,
            sourceSpanId: a.source_span_id ?? null,
          };
        };

        const allAssertions = samePolarity.map(toConflictAssertion);
        const median = strengths.sort((a, b) => a - b)[
          Math.floor(strengths.length / 2)
        ] ?? 0;

        const stronger = allAssertions.filter(
          (a) => a.effectiveStrength >= median,
        );
        const weaker = allAssertions.filter(
          (a) => a.effectiveStrength < median,
        );

        const severity = classifySeverity(
          'strength_divergence',
          divergence,
          stronger.length,
          weaker.length,
        );

        conflicts.push({
          conflictId: deterministicConflictId(
            candidateId,
            conceptKey,
            'strength_divergence',
          ),
          conceptKey,
          conflictType: 'strength_divergence',
          severity,
          description: describeConflict(
            conceptKey,
            'strength_divergence',
            stronger.length,
            weaker.length,
            divergence,
          ),
          positiveAssertions: stronger,
          negativeAssertions: weaker,
          strengthDivergence: divergence,
          impactOnMatch: describeMatchImpact(severity, conceptKey),
        });
      }
    }
  }

  // Sort: high severity first, then by concept key for deterministic order
  const severityOrder: Record<ConflictSeverity, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  conflicts.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.conceptKey.localeCompare(b.conceptKey),
  );

  return {
    candidateId,
    workspacePersonId,
    totalConflicts: conflicts.length,
    highSeverity: conflicts.filter((c) => c.severity === 'high').length,
    mediumSeverity: conflicts.filter((c) => c.severity === 'medium').length,
    lowSeverity: conflicts.filter((c) => c.severity === 'low').length,
    conflicts,
    analyzedAt: new Date(now).toISOString(),
  };
}
