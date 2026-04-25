/**
 * Shared RCD lookup — load the latest Role Context Document for an assessment.
 *
 * Chain: assessment_id → assessments.stage_id → stages.pipeline_id →
 *        role_contexts.rcd_json (latest by created_at).
 *
 * Used by Phase 3 code-review consumers (implementer agent, scorer agent) to
 * resolve team disposition and technical context from a candidate-facing
 * assessment ID. Culture consumers use the heavier `resolveCultureRoleContext`
 * helper which builds a culture-specific team context on top of the same query.
 *
 * Returns null on any lookup miss — never throws. Consumers default to
 * baseline rubrics / static prompts when the RCD is absent, so the migration
 * window (legacy persona_json rows) is handled implicitly.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { RoleContextDocument } from '../types';

interface RcdLookupRow {
  rcd_json: string | null;
}

export async function loadRcdForAssessment(
  db: D1Database,
  assessmentId: string,
): Promise<RoleContextDocument | null> {
  try {
    const row = await db
      .prepare(
        `SELECT rc.rcd_json
         FROM assessments a
         JOIN stages s         ON s.id = a.stage_id
         JOIN role_contexts rc ON rc.pipeline_id = s.pipeline_id
         WHERE a.id = ?1
           AND rc.rcd_json IS NOT NULL
         ORDER BY rc.created_at DESC
         LIMIT 1`,
      )
      .bind(assessmentId)
      .first<RcdLookupRow>();

    if (!row?.rcd_json) return null;
    return JSON.parse(row.rcd_json) as RoleContextDocument;
  } catch (err) {
    console.error('[loadRcdForAssessment] lookup failed:', {
      assessmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
