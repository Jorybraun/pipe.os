/**
 * Culture Interview probe bank loader + merger (ADR-036 Phase 2 / RD-12).
 *
 * The static probe library lives on `CultureQuestion.probes` in
 * `cultureQuestionBank.ts`. The RCD-enriched layer lives in the
 * `role_probe_bank` D1 table (migration 0022), populated at role-setup time
 * from approved `LadderingChain`s on the RCD. Per-candidate dynamic probe
 * generation is forbidden under NYC Local Law 144 + EU AI Act Art 14 — every
 * probe must trace to a finite, recruiter-approved, versioned bank.
 *
 * Usage pattern: the culture route loads the probe bank once per session
 * (cheap — one indexed query on `role_context_id`) and passes it through to
 * the selector. The selector calls `mergeEnrichedProbes` on the picked
 * question to layer team-specific probes over the static ones. When the bank
 * is empty (no RCD enrichment yet), the static library is returned unchanged.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { CompetencyDimension, CultureQuestion, QuestionProbeLibrary } from './cultureQuestionBank';

export interface EnrichedProbe {
  id: string;
  dimension: CompetencyDimension;
  text: string;
  source: 'static_base' | 'rcd_enriched';
  sourceChainId: string | null;
  rcdVersion: string;
}

/**
 * Probe bank grouped by dimension for O(1) lookup during question selection.
 * Only `rcd_enriched` probes are kept — the `static_base` rows are a legacy
 * carry-forward surface in case we ever need the DB-driven static layer, but
 * the production static probe library is the in-memory const in
 * `cultureQuestionBank.ts`.
 */
export type RoleProbeBank = {
  [dimension in CompetencyDimension]?: EnrichedProbe[];
};

export const EMPTY_PROBE_BANK: RoleProbeBank = {};

interface RoleProbeRow {
  id: string;
  dimension: string;
  probe_text: string;
  source: string;
  source_chain_id: string | null;
  rcd_version: string;
}

const VALID_DIMENSIONS: readonly CompetencyDimension[] = [
  'ownership',
  'collaboration',
  'learning-orientation',
  'conflict-handling',
  'self-awareness',
];

function isCompetencyDimension(value: string): value is CompetencyDimension {
  return (VALID_DIMENSIONS as readonly string[]).includes(value);
}

/**
 * Load the enriched probe bank for a role context. Returns an empty bank on
 * any lookup failure — never throws — so the caller falls through to the
 * static library. Filters to the latest `rcd_version` for the role when
 * multiple versions coexist (migration window).
 */
export async function loadRoleProbeBank(
  db: D1Database,
  roleContextId: string | null,
): Promise<RoleProbeBank> {
  if (!roleContextId) return EMPTY_PROBE_BANK;

  try {
    const { results } = await db
      .prepare(
        `SELECT id, dimension, probe_text, source, source_chain_id, rcd_version
         FROM role_probe_bank
         WHERE role_context_id = ?1
           AND source = 'rcd_enriched'
           AND rcd_version = (
             SELECT rcd_version FROM role_probe_bank
             WHERE role_context_id = ?1 AND source = 'rcd_enriched'
             ORDER BY created_at DESC
             LIMIT 1
           )
         ORDER BY dimension, created_at ASC`,
      )
      .bind(roleContextId)
      .all<RoleProbeRow>();

    if (!results || results.length === 0) return EMPTY_PROBE_BANK;

    const bank: RoleProbeBank = {};
    for (const row of results) {
      if (!isCompetencyDimension(row.dimension)) continue;
      const source = row.source === 'rcd_enriched' ? 'rcd_enriched' : 'static_base';
      const probe: EnrichedProbe = {
        id: row.id,
        dimension: row.dimension,
        text: row.probe_text,
        source,
        sourceChainId: row.source_chain_id,
        rcdVersion: row.rcd_version,
      };
      (bank[row.dimension] ??= []).push(probe);
    }
    return bank;
  } catch (err) {
    console.error('[loadRoleProbeBank] lookup failed:', {
      roleContextId,
      error: err instanceof Error ? err.message : String(err),
    });
    return EMPTY_PROBE_BANK;
  }
}

/**
 * Return a shallow copy of `question` whose `probes` library has enriched
 * probes layered in as additional `missing_A`-style slots. The static probe
 * library is preserved — enriched probes are additive, never replacements.
 *
 * Enriched probes are stored as open-vocabulary hints under synthetic slot
 * keys (`enriched_1`, `enriched_2`, …). The agent's turn-FSM passes these to
 * the LLM alongside the static slots; the LLM picks whichever best fits the
 * candidate's last answer.
 */
export function mergeEnrichedProbes(
  question: CultureQuestion,
  bank: RoleProbeBank,
): CultureQuestion {
  const enrichedForQuestion: EnrichedProbe[] = [];
  for (const dimension of question.dimensions) {
    const bucket = bank[dimension];
    if (bucket) enrichedForQuestion.push(...bucket);
  }

  if (enrichedForQuestion.length === 0) return question;

  const merged: QuestionProbeLibrary & Record<string, string> = { ...question.probes };
  enrichedForQuestion.forEach((probe, index) => {
    merged[`enriched_${index + 1}`] = probe.text;
  });

  return { ...question, probes: merged };
}

/**
 * Flat count of enriched probes on the bank — used by the selector to apply a
 * small scoring bonus to questions whose dimensions have team-specific
 * enrichment available (RD-12: prefer probes grounded in the RCD when they
 * exist, without penalizing dimensions that don't have any yet).
 */
export function enrichedProbeCount(bank: RoleProbeBank, dimensions: readonly CompetencyDimension[]): number {
  let count = 0;
  for (const dimension of dimensions) {
    count += bank[dimension]?.length ?? 0;
  }
  return count;
}
