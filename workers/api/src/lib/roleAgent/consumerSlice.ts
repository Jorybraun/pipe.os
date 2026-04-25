/**
 * consumer_slice derivation (ADR-036 Phase 1 step 6).
 *
 * The Role Context Document (RCD) is the canonical synthesis artifact post
 * ADR-036, but legacy downstream readers still expect the flat CandidatePersona
 * shape (cultureRoleResolution, challengeGeneration/prompts, repoDiscovery).
 * This module derives a CandidatePersona from an RCD at write time so those
 * readers keep working through the migration — they get cached into
 * role_contexts.persona_json while Phase 2+ rewires consumers to read the
 * full RCD directly.
 *
 * Derivation rules (traceable back to ADR-036 §1.1 consumer_slice spec):
 *   seniority       ← technical_context.seniority_band
 *   archetype       ← short summary derived from HM work/bar cells + seniority
 *   mustHaveSkills  ← technical_context.stack + codebase_expectations
 *   niceToHaveSkills← work domain open_codes not already in mustHaveSkills
 *   disposition     ← team + process cell summaries + technical_context dispositional_weights keys
 *   careerSignal    ← highest-energy laddering chain in the 'work' or 'bar' domain
 *   redFlags        ← RedFlagRecord.label[]
 *   dealbreakers    ← DealbreakerRecord.label[]
 *
 * This function is pure. No I/O, no LLM calls. Deterministic by design so the
 * consumer_slice can be recomputed at any time from an RCD without drift.
 */

import type {
  CandidatePersona,
  DomainCell,
  DomainMatrix,
  LadderingChain,
  RoleContextDocument,
  StakeholderType,
} from '../../types';

const STAKEHOLDER_PRIORITY: StakeholderType[] = [
  'HIRING_MANAGER',
  'TEAM_MEMBER',
  'INTERNAL_RECRUITER',
  'EXTERNAL_RECRUITER',
];

/** Return the first populated cell across stakeholders in priority order. */
function firstCell(matrix: DomainMatrix, domain: keyof NonNullable<DomainMatrix['HIRING_MANAGER']>): DomainCell | null {
  for (const stakeholder of STAKEHOLDER_PRIORITY) {
    const cell = matrix[stakeholder]?.[domain];
    if (cell && cell.coverage !== 'not_probed') return cell;
  }
  return null;
}

/** Collect cells across all stakeholders for a single domain. */
function allCells(matrix: DomainMatrix, domain: keyof NonNullable<DomainMatrix['HIRING_MANAGER']>): DomainCell[] {
  const cells: DomainCell[] = [];
  for (const stakeholder of STAKEHOLDER_PRIORITY) {
    const cell = matrix[stakeholder]?.[domain];
    if (cell && cell.coverage !== 'not_probed') cells.push(cell);
  }
  return cells;
}

/** Highest-energy chain across all populated cells in the given domains. */
function highestEnergyChain(matrix: DomainMatrix, domains: ReadonlyArray<keyof NonNullable<DomainMatrix['HIRING_MANAGER']>>): LadderingChain | null {
  const rank: Record<LadderingChain['energy_signal'], number> = {
    high: 3,
    medium: 2,
    low: 1,
    unknown: 0,
  };
  let best: LadderingChain | null = null;
  for (const domain of domains) {
    for (const cell of allCells(matrix, domain)) {
      for (const chain of cell.laddering_chains) {
        if (!best || rank[chain.energy_signal] > rank[best.energy_signal]) {
          best = chain;
        }
      }
    }
  }
  return best;
}

/** Dedupe preserving first-seen order. */
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function deriveConsumerSlice(rcd: RoleContextDocument): CandidatePersona {
  const { domain_matrix: matrix, technical_context: tech, dealbreakers, red_flags } = rcd;

  const seniority = tech.seniority_band || 'Not specified';

  // Archetype: HM's work domain summary + seniority band, fall back to first available.
  const workCell = firstCell(matrix, 'work');
  const barCell = firstCell(matrix, 'bar');
  const archetype = [workCell?.summary, seniority]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join(' — ') || 'Not specified';

  // mustHaveSkills: stack + codebase expectations. Stack wins in case of overlap.
  const mustHaveSkills = dedupe([
    ...tech.stack,
    ...tech.codebase_expectations,
  ]);

  // niceToHaveSkills: open codes from work/codebase cells not already covered.
  const workOpenCodes = allCells(matrix, 'work').flatMap((c) => c.open_codes);
  const codebaseOpenCodes = allCells(matrix, 'codebase').flatMap((c) => c.open_codes);
  const mustSet = new Set(mustHaveSkills.map((s) => s.toLowerCase()));
  const niceToHaveSkills = dedupe(
    [...workOpenCodes, ...codebaseOpenCodes].filter((code) => !mustSet.has(code.trim().toLowerCase())),
  );

  // disposition: team + process summaries + dispositional weights keys. Summaries
  // are diplomatic per the synthesis tone rule; dispositional weight keys name
  // the dimensions the scorer will adjust.
  const teamSummaries = allCells(matrix, 'team').map((c) => c.summary).filter((s) => s.length > 0);
  const processSummaries = allCells(matrix, 'process').map((c) => c.summary).filter((s) => s.length > 0);
  const dispositionKeys = Object.keys(tech.dispositional_weights ?? {});
  const disposition = dedupe([...teamSummaries, ...processSummaries, ...dispositionKeys]);

  // careerSignal: highest-energy chain in work or bar domains — the clearest
  // signal of what this role is calibrated toward.
  const signalChain = highestEnergyChain(matrix, ['work', 'bar']);
  const careerSignal = signalChain
    ? `${signalChain.value} (via: ${signalChain.attribute_quote})`
    : barCell?.summary ?? 'Not specified';

  return {
    seniority,
    archetype,
    mustHaveSkills,
    niceToHaveSkills,
    disposition,
    careerSignal,
    redFlags: dedupe(red_flags.map((r) => r.label)),
    dealbreakers: dedupe(dealbreakers.map((d) => d.label)),
  };
}
