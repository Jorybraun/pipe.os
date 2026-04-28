/**
 * Dealbreaker Gate Enforcement — pre-Neo4j shim.
 *
 * Reads dealbreakers from the role's RCD and checks them against the
 * candidate's searchable profile using simple pattern matching.
 * Future upgrade: replace with Vectorize ANN over candidate sub-element
 * embeddings once `candidate-decomposition-prompt.md` lands.
 */

import type { DealbreakerRecord } from '../../types';

export interface DealbreakerFailure {
  dealbreakerId: string;
  label: string;
  strength: 'strong' | 'moderate' | 'weak';
  reason: string;
}

export interface DealbreakerWarning {
  dealbreakerId: string;
  label: string;
  strength: 'strong' | 'moderate' | 'weak';
  reason: string;
}

export interface DealbreakerResult {
  autoFail: boolean;
  failures: DealbreakerFailure[];
  warnings: DealbreakerWarning[];
}

/**
 * Run dealbreaker gates for a (role, candidate) pair.
 *
 * @param db          D1 database
 * @param roleContextId Role context id
 * @param candidateId   Candidate id
 * @returns             Gate result
 */
export async function runDealbreakerGates(
  db: D1Database,
  roleContextId: string,
  candidateId: string,
): Promise<DealbreakerResult> {
  // Fetch role dealbreakers from RCD JSON
  const roleRow = await db
    .prepare(`SELECT rcd_json FROM role_contexts WHERE id = ?1`)
    .bind(roleContextId)
    .first<{ rcd_json: string | null }>();

  let dealbreakers: DealbreakerRecord[] = [];
  if (roleRow?.rcd_json) {
    try {
      const rcd = JSON.parse(roleRow.rcd_json) as {
        dealbreakers?: DealbreakerRecord[];
      };
      dealbreakers = rcd.dealbreakers ?? [];
    } catch {
      dealbreakers = [];
    }
  }

  // Fetch candidate searchable profile
  const candidateRow = await db
    .prepare(
      `SELECT candidate_searchable_profile FROM candidate_ingestion WHERE candidate_id = ?1`,
    )
    .bind(candidateId)
    .first<{ candidate_searchable_profile: string | null }>();

  const profileText = (candidateRow?.candidate_searchable_profile ?? '').toLowerCase();

  const failures: DealbreakerFailure[] = [];
  const warnings: DealbreakerWarning[] = [];

  for (const dbreak of dealbreakers) {
    const strength = dbreak.job_relatedness_strength;
    const pattern = dbreak.pattern?.toLowerCase() ?? '';

    // Simple substring match against profile text
    const hasEvidence = pattern.length > 0 && profileText.includes(pattern);

    if (!hasEvidence) {
      const item = {
        dealbreakerId: dbreak.id,
        label: dbreak.label,
        strength,
        reason: `No evidence found for: ${dbreak.pattern}`,
      };

      if (strength === 'strong') {
        failures.push(item);
      } else if (strength === 'moderate') {
        warnings.push(item);
      }
      // 'weak' is advisory only — no gate action
    }
  }

  return {
    autoFail: failures.length > 0,
    failures,
    warnings,
  };
}
