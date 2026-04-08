/**
 * Resolve a culture session's persona-derived role context: which seniority
 * tag the candidate should be evaluated at, and which role overlay drives the
 * selector's dimension weights.
 *
 * Chain: assessment_id → assessments.stage_id → stages.pipeline_id →
 *        role_contexts.persona_json (latest by created_at).
 *
 * If anything is missing (no role context, no persona, parse error) we fall
 * back to mid-seniority + universal overlay so the interview never blocks on
 * a bookkeeping gap. The cost of a missing overlay is "selector picks
 * decent generalist questions" — never an exception.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { normalizeSeniority } from './cultureSeniorityNormalize';
import type { SeniorityTag } from './cultureQuestionBank';
import type { RoleOverlayId } from './cultureRoleOverlay';

export interface CultureRoleResolution {
  seniority: SeniorityTag;
  roleOverlayId: RoleOverlayId;
}

const FALLBACK: CultureRoleResolution = {
  seniority: 'mid',
  roleOverlayId: 'universal',
};

/**
 * Pick a role overlay from a free-text persona archetype string. Manager-ish
 * keywords → 'manager'; everything else (IC roles) → 'senior-ic'. Used only
 * when the persona has no explicit overlay hint.
 */
function deriveOverlayFromArchetype(archetype: string | null | undefined): RoleOverlayId {
  if (!archetype) return 'senior-ic';
  if (/manag|director|head\s+of|vp\b|lead\s+of\s+people/i.test(archetype)) return 'manager';
  return 'senior-ic';
}

/**
 * Resolve seniority + role overlay for a culture session.
 *
 * Returns FALLBACK on any lookup miss — never throws. Caller can pass the
 * result straight into `startCultureInterview` / `advanceCultureInterview`.
 */
export async function resolveCultureRoleContext(
  db: D1Database,
  assessmentId: string,
): Promise<CultureRoleResolution> {
  try {
    const row = await db
      .prepare(
        `SELECT rc.persona_json
         FROM assessments a
         JOIN stages s         ON s.id = a.stage_id
         JOIN role_contexts rc ON rc.pipeline_id = s.pipeline_id
         WHERE a.id = ?1 AND rc.persona_json IS NOT NULL
         ORDER BY rc.created_at DESC
         LIMIT 1`,
      )
      .bind(assessmentId)
      .first<{ persona_json: string | null }>();

    if (!row?.persona_json) return FALLBACK;

    const persona = JSON.parse(row.persona_json) as {
      seniority?: string;
      archetype?: string;
    };

    return {
      seniority: normalizeSeniority(persona.seniority),
      roleOverlayId: deriveOverlayFromArchetype(persona.archetype),
    };
  } catch (err) {
    console.error('[resolveCultureRoleContext] lookup failed:', {
      assessmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return FALLBACK;
  }
}
