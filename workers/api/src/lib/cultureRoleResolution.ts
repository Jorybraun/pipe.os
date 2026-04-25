/**
 * Resolve a culture session's Team Context from the Role Context Document (RCD).
 *
 * Chain: assessment_id → assessments.stage_id → stages.pipeline_id →
 *        role_contexts.rcd_json (latest by created_at).
 *
 * ADR-036 Phase 2: this module used to return a narrow `{ seniority,
 * roleOverlayId }` pair derived from a 4-keyword regex over
 * `persona_json.archetype`. The regex collapsed the full Knowledge State into
 * a single manager/IC bit. The RCD rewrite returns the full Team Context —
 * per-stakeholder culture profile, dispositional weights, BARS overrides,
 * dealbreakers, and the HM/TM team-domain cells — so the culture selector,
 * scorer, and HITL dealbreaker gate can all read from one source.
 *
 * During the migration window the module reads `rcd_json` when present and
 * falls back to `persona_json` when only the legacy synthesis has run on the
 * role context. Neither path throws — any lookup miss yields a safe baseline
 * resolution so the interview never blocks on a bookkeeping gap.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { normalizeSeniority } from './cultureSeniorityNormalize';
import type { SeniorityTag, CompetencyDimension } from './cultureQuestionBank';
import type { RoleOverlayId } from './cultureRoleOverlay';
import type {
  RoleContextDocument,
  TeamCultureProfile,
  BarsOverride,
  DealbreakerRecord,
  DomainCell,
  StakeholderType,
} from '../types';

/**
 * Everything the culture interview + scorer need from the RCD for a session,
 * hoisted once per session and once per advance. Populated when the role
 * context has an `rcd_json`; null during the migration window for legacy
 * `persona_json`-only rows.
 */
export interface CultureTeamContext {
  rcdVersion: string;
  roleContextId: string;
  teamCultureProfile: TeamCultureProfile;
  /** Per-dimension deltas read by the scorer (ADR-032). */
  dispositionalWeights: Record<string, number>;
  /** Team-domain cells from the two authoritative stakeholders for the team view. */
  teamDomainCells: {
    hiringManager: DomainCell | null;
    teamMember: DomainCell | null;
  };
  /** Anchor overrides the scorer applies per dimension × level. */
  barsOverrides: BarsOverride[];
  /** HITL-gated dealbreakers the scorer surfaces as flags. */
  dealbreakers: DealbreakerRecord[];
}

export interface CultureRoleResolution {
  seniority: SeniorityTag;
  roleOverlayId: RoleOverlayId;
  /** Full Team Context when an RCD is available; null during migration window. */
  teamContext: CultureTeamContext | null;
}

const FALLBACK: CultureRoleResolution = {
  seniority: 'mid',
  roleOverlayId: 'universal',
  teamContext: null,
};

interface RoleContextLookupRow {
  id: string;
  rcd_version: string | null;
  rcd_json: string | null;
  persona_json: string | null;
  bars_overrides: string | null;
}

/**
 * Manager-ish keywords → 'manager'; everything else (IC roles) → 'senior-ic'.
 * Used as a last-resort overlay picker when neither the RCD technical context
 * nor the legacy persona archetype gives a stronger signal.
 */
function deriveOverlayFromArchetype(archetype: string | null | undefined): RoleOverlayId {
  if (!archetype) return 'senior-ic';
  if (/manag|director|head\s+of|vp\b|lead\s+of\s+people/i.test(archetype)) return 'manager';
  return 'senior-ic';
}

function deriveOverlayFromRcd(rcd: RoleContextDocument): RoleOverlayId {
  const band = rcd.technical_context?.seniority_band;
  if (band && /\bmanager\b|\bdirector\b|\bvp\b|\bhead\s+of\b/i.test(band)) return 'manager';
  const archetype = rcd.consumer_slice?.archetype ?? null;
  return deriveOverlayFromArchetype(archetype);
}

function pickDomainCell(
  rcd: RoleContextDocument,
  stakeholder: StakeholderType,
  domain: 'team',
): DomainCell | null {
  const cell = rcd.domain_matrix?.[stakeholder]?.[domain];
  return cell ?? null;
}

function parseBarsOverrides(raw: string | null): BarsOverride[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as BarsOverride[]) : [];
  } catch {
    return [];
  }
}

function buildTeamContext(
  rcd: RoleContextDocument,
  barsOverridesColumn: BarsOverride[],
): CultureTeamContext {
  // Column overrides (recruiter-approved, role-setup-time) win over any
  // scratch values left in rcd.bars_overrides from synthesis-time drafts.
  const barsOverrides = barsOverridesColumn.length > 0 ? barsOverridesColumn : (rcd.bars_overrides ?? []);
  return {
    rcdVersion: rcd.rcd_version,
    roleContextId: rcd.role_context_id,
    teamCultureProfile: rcd.team_culture_profile,
    dispositionalWeights: rcd.technical_context?.dispositional_weights ?? {},
    teamDomainCells: {
      hiringManager: pickDomainCell(rcd, 'HIRING_MANAGER', 'team'),
      teamMember: pickDomainCell(rcd, 'TEAM_MEMBER', 'team'),
    },
    barsOverrides,
    dealbreakers: rcd.dealbreakers ?? [],
  };
}

/**
 * Resolve seniority + role overlay + Team Context for a culture session.
 *
 * Returns FALLBACK on any lookup miss — never throws. `teamContext` is
 * populated when the row has an `rcd_json`; null when only `persona_json`
 * exists (migration window coexistence).
 */
export async function resolveCultureRoleContext(
  db: D1Database,
  assessmentId: string,
): Promise<CultureRoleResolution> {
  try {
    const row = await db
      .prepare(
        `SELECT rc.id, rc.rcd_version, rc.rcd_json, rc.persona_json, rc.bars_overrides
         FROM assessments a
         JOIN stages s         ON s.id = a.stage_id
         JOIN role_contexts rc ON rc.pipeline_id = s.pipeline_id
         WHERE a.id = ?1
           AND (rc.rcd_json IS NOT NULL OR rc.persona_json IS NOT NULL)
         ORDER BY rc.created_at DESC
         LIMIT 1`,
      )
      .bind(assessmentId)
      .first<RoleContextLookupRow>();

    if (!row) return FALLBACK;

    // Prefer RCD when present.
    if (row.rcd_json) {
      const rcd = JSON.parse(row.rcd_json) as RoleContextDocument;
      const barsColumn = parseBarsOverrides(row.bars_overrides);
      const teamContext = buildTeamContext(rcd, barsColumn);
      return {
        seniority: normalizeSeniority(rcd.technical_context?.seniority_band ?? rcd.consumer_slice?.seniority),
        roleOverlayId: deriveOverlayFromRcd(rcd),
        teamContext,
      };
    }

    // Migration window: fall back to legacy persona_json.
    if (row.persona_json) {
      const persona = JSON.parse(row.persona_json) as {
        seniority?: string;
        archetype?: string;
      };
      return {
        seniority: normalizeSeniority(persona.seniority),
        roleOverlayId: deriveOverlayFromArchetype(persona.archetype),
        teamContext: null,
      };
    }

    return FALLBACK;
  } catch (err) {
    console.error('[resolveCultureRoleContext] lookup failed:', {
      assessmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return FALLBACK;
  }
}

/**
 * Type guard — narrow a resolution to one whose Team Context is populated.
 * Consumers that branch on RCD presence use this instead of a null check so
 * TypeScript narrows the field shape.
 */
export function hasTeamContext(
  resolution: CultureRoleResolution,
): resolution is CultureRoleResolution & { teamContext: CultureTeamContext } {
  return resolution.teamContext !== null;
}

// Re-export for consumers that want the dimension weight shape co-located.
export type { CompetencyDimension };
