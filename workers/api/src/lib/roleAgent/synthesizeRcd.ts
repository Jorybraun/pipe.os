/**
 * RCD synthesis caller (ADR-036 Phase 1 step 4).
 *
 * Ties together the three-layer synthesis pattern from the research brief:
 *   Layer 1 — schema-guided generation via buildRcdSynthesisSystemPrompt
 *   Layer 2 — parse-time validation (this module)
 *   Layer 3 — deterministic verifier (verifyRcd.ts)
 *
 * Per the Phase 1 kickoff decisions (see
 * knowledge/outputs/.plans/role-discovery-data-contract-implementation-handoff.md
 * §"Phase 1 implementation decisions"), synthesis runs on Gemma 4 via the
 * existing CloudflareAIProvider. Workers AI does not expose grammar-constrained
 * decoding, so "constrained decoding" here means: schema-in-prompt + strict
 * parse-time normalization + conditional single retry on failure.
 *
 * This module is pure orchestration — it does not write to D1. The caller
 * persists rcd_json + validation_metadata after inspecting the issue list.
 */

import type { LLMProvider } from '../llm/types';
import {
  RCD_SYNTHESIS_PROMPT_VERSION,
  buildRcdSynthesisSystemPrompt,
  buildRcdSynthesisUserMessage,
} from '../roleAgentPrompts';
import { cleanSkillArray, humanizeOpenCode } from './sanitize';
import { deriveConsumerSlice } from './consumerSlice';
import { verifyRcd, type VerifierIssue, type StakeholderTranscript } from './verifyRcd';
export { decomposeRcdIntoNodes, persistRoleNodes } from './decomposeRcd';
import type {
  BarsOverride,
  ConflictRecord,
  DealbreakerRecord,
  Domain,
  DomainCell,
  DomainMatrix,
  ProbeEnrichment,
  RedFlagRecord,
  RoleContextDocument,
  RoleExchange,
  StakeholderType,
  TeamCultureProfile,
  TechnicalContext,
  ValidationMetadata,
} from '../../types';

const SCHEMA_VERSION = 'rcd-v1';
const SIX_DOMAINS: Domain[] = ['why', 'work', 'team', 'bar', 'codebase', 'process'];
const FOUR_STAKEHOLDERS: StakeholderType[] = [
  'HIRING_MANAGER',
  'TEAM_MEMBER',
  'INTERNAL_RECRUITER',
  'EXTERNAL_RECRUITER',
];

// ─── Public API ─────────────────────────────────────────────────────────────

export interface SynthesizeRcdOptions {
  provider: LLMProvider;
  roleContextId: string;
  pipelineId: string;
  baseline: Record<string, unknown>;
  stakeholderTranscripts: Array<{
    stakeholder_type: StakeholderType;
    interviewee_label: string;
    exchanges: RoleExchange[];
    knowledge_state: Record<string, unknown>;
  }>;
  /** Optional override for the synthesis model name recorded in validation_metadata. */
  synthesisModel?: string;
  /** Optional override for the verification pass model name recorded in validation_metadata. */
  verificationPassModel?: string;
}

export interface SynthesizeRcdResult {
  rcd: RoleContextDocument;
  issues: VerifierIssue[];
  passed: boolean;
  /** Raw model output before normalization. Useful for debugging and audit trails. */
  rawText: string;
  /** True if the first call failed and a retry produced the returned RCD. */
  retried: boolean;
}

export async function synthesizeRcd(opts: SynthesizeRcdOptions): Promise<SynthesizeRcdResult> {
  const {
    provider,
    roleContextId,
    pipelineId,
    baseline,
    stakeholderTranscripts,
    synthesisModel = provider.name,
    verificationPassModel = provider.name,
  } = opts;

  const systemPrompt = buildRcdSynthesisSystemPrompt();
  const userMessage = buildRcdSynthesisUserMessage({
    roleContextId,
    pipelineId,
    baseline,
    stakeholderTranscripts,
    synthesisModel,
    verificationPassModel,
  });

  let rawText = '';
  let parsed: Record<string, unknown> | null = null;
  let retried = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await provider.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      { forceJson: true, maxTokens: 8192 },
    );

    rawText = result.content ?? '';
    if (!rawText) {
      if (attempt === 0) {
        retried = true;
        continue;
      }
      throw new Error('[synthesizeRcd] Provider returned empty content on both attempts.');
    }

    try {
      parsed = parseJsonStrict(rawText);
      break;
    } catch (err) {
      if (attempt === 0) {
        console.warn('[synthesizeRcd] First-attempt parse failed, retrying once.', err);
        retried = true;
        continue;
      }
      console.error('[synthesizeRcd] Second-attempt parse failed. Raw head:', rawText.slice(0, 300));
      throw err;
    }
  }

  if (!parsed) {
    throw new Error('[synthesizeRcd] Parse loop exited without a parsed object.');
  }

  const stakeholderTypes = stakeholderTranscripts.map((t) => t.stakeholder_type);
  const normalized = normalizeRcd(parsed, {
    roleContextId,
    pipelineId,
    stakeholderTypes,
    synthesisModel,
    verificationPassModel,
  });

  // Derive consumer_slice from the normalized domain_matrix so legacy readers
  // get a flat CandidatePersona shape without another LLM call. Overwrites
  // whatever the model produced — the derivation function is authoritative.
  normalized.consumer_slice = deriveConsumerSlice(normalized);

  const transcriptsForVerifier: StakeholderTranscript[] = stakeholderTranscripts.map((t) => ({
    stakeholder_type: t.stakeholder_type,
    exchanges: t.exchanges,
  }));

  const verified = verifyRcd({ rcd: normalized, transcripts: transcriptsForVerifier });

  return {
    rcd: verified.rcd,
    issues: verified.issues,
    passed: verified.passed,
    rawText,
    retried,
  };
}

// ─── Parsing ────────────────────────────────────────────────────────────────

function parseJsonStrict(text: string): Record<string, unknown> {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const parsed = JSON.parse(stripped);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('[synthesizeRcd] Parsed JSON is not an object.');
  }
  return parsed as Record<string, unknown>;
}

// ─── Normalization ──────────────────────────────────────────────────────────
//
// The model output is trusted structurally (schema-in-prompt + forceJson) but
// not completeness-wise — cells can be missing, arrays can be null, optional
// scalars can be undefined. Normalization fills in the minimum viable shell
// so downstream readers (verifier, consumer_slice, persistence) can navigate
// the RCD without null checks at every step. Missing cells get coverage
// 'not_probed' + empty arrays, which the verifier will flag as a warning — the
// recruiter sees the gap but the RCD persists.

interface NormalizeContext {
  roleContextId: string;
  pipelineId: string;
  stakeholderTypes: StakeholderType[];
  synthesisModel: string;
  verificationPassModel: string;
}

function normalizeRcd(raw: Record<string, unknown>, ctx: NormalizeContext): RoleContextDocument {
  const domain_matrix = normalizeDomainMatrix(
    (raw.domain_matrix as Record<string, unknown> | undefined) ?? {},
    ctx.stakeholderTypes,
  );

  const conflicts = asArray<ConflictRecord>(raw.conflicts);
  const dealbreakers = asArray<DealbreakerRecord>(raw.dealbreakers);
  const red_flags = asArray<RedFlagRecord>(raw.red_flags);
  const bars_overrides = asArray<BarsOverride>(raw.bars_overrides);

  const technical_context = normalizeTechnicalContext(
    raw.technical_context as Record<string, unknown> | undefined,
  );
  const team_culture_profile = normalizeTeamCultureProfile(
    raw.team_culture_profile as Record<string, unknown> | undefined,
  );
  const probe_bank_enrichment = normalizeProbeEnrichment(
    raw.probe_bank_enrichment as Record<string, unknown> | undefined,
  );
  const validation_metadata = normalizeValidationMetadata(
    raw.validation_metadata as Record<string, unknown> | undefined,
    ctx,
  );

  // consumer_slice is filled in by the caller via deriveConsumerSlice — we
  // place a stub here so the type satisfies RoleContextDocument before the
  // override. Runtime behavior is unaffected; the stub is always overwritten.
  const stubConsumerSlice = {
    seniority: 'Not specified',
    archetype: 'Not specified',
    mustHaveSkills: [],
    niceToHaveSkills: [],
    disposition: [],
    careerSignal: 'Not specified',
    redFlags: [],
    dealbreakers: [],
  } as RoleContextDocument['consumer_slice'];

  return {
    rcd_version: typeof raw.rcd_version === 'string' ? raw.rcd_version : SCHEMA_VERSION,
    role_context_id: typeof raw.role_context_id === 'string' ? raw.role_context_id : ctx.roleContextId,
    pipeline_id: typeof raw.pipeline_id === 'string' ? raw.pipeline_id : ctx.pipelineId,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    domain_matrix,
    conflicts,
    technical_context,
    team_culture_profile,
    bars_overrides,
    probe_bank_enrichment,
    dealbreakers,
    red_flags,
    consumer_slice: stubConsumerSlice,
    validation_metadata,
  };
}

function normalizeDomainMatrix(
  raw: Record<string, unknown>,
  stakeholders: StakeholderType[],
): DomainMatrix {
  const matrix: DomainMatrix = {};
  // Ensure every stakeholder present in the interview set has a row, even if
  // the model omitted them. Stakeholders we did NOT interview are left absent
  // so downstream code can distinguish "not probed" from "not present".
  const targetStakeholders = new Set<StakeholderType>([...stakeholders]);
  // Also honor stakeholders the model populated that weren't in the input —
  // shouldn't happen under forceJson, but we preserve signal if it does.
  for (const key of Object.keys(raw)) {
    if (FOUR_STAKEHOLDERS.includes(key as StakeholderType)) {
      targetStakeholders.add(key as StakeholderType);
    }
  }

  for (const stakeholder of targetStakeholders) {
    const rawCells = (raw[stakeholder] as Record<string, unknown> | undefined) ?? {};
    const cells: { [domain in Domain]?: DomainCell } = {};
    for (const domain of SIX_DOMAINS) {
      cells[domain] = normalizeDomainCell(rawCells[domain] as Record<string, unknown> | undefined);
    }
    matrix[stakeholder] = cells;
  }

  return matrix;
}

function normalizeDomainCell(raw: Record<string, unknown> | undefined): DomainCell {
  if (!raw || typeof raw !== 'object') {
    return {
      primary_authority: false,
      coverage: 'not_probed',
      laddering_chains: [],
      open_codes: [],
      axial_links: [],
      stories: [],
      summary: '',
    };
  }

  return {
    primary_authority: raw.primary_authority === true,
    coverage: isCoverageLevel(raw.coverage) ? raw.coverage : 'not_probed',
    laddering_chains: asArray<Record<string, unknown>>(raw.laddering_chains).map(
      normalizeLadderingChain,
    ),
    open_codes: cleanSkillArray(asStringArray(raw.open_codes)),
    axial_links: asArray<DomainCell['axial_links'][number]>(raw.axial_links).filter(
      (link) =>
        typeof link.from_code === 'string' &&
        typeof link.to_code === 'string' &&
        typeof link.relation === 'string',
    ),
    stories: asArray<DomainCell['stories'][number]>(raw.stories).map((s) => ({
      situation: typeof s.situation === 'string' ? s.situation : '',
      action: typeof s.action === 'string' ? s.action : '',
      outcome: typeof s.outcome === 'string' ? s.outcome : '',
      moral: typeof s.moral === 'string' ? s.moral : '',
      source_exchange_id: typeof s.source_exchange_id === 'string' ? s.source_exchange_id : '',
    })),
    summary: typeof raw.summary === 'string' ? raw.summary : '',
  };
}

function normalizeLadderingChain(raw: Record<string, unknown>): DomainCell['laddering_chains'][number] {
  return {
    attribute_quote: typeof raw.attribute_quote === 'string' ? raw.attribute_quote : '',
    source_exchange_id: typeof raw.source_exchange_id === 'string' ? raw.source_exchange_id : '',
    consequence: typeof raw.consequence === 'string' ? raw.consequence : '',
    value: typeof raw.value === 'string' ? raw.value : '',
    energy_signal: isEnergySignal(raw.energy_signal) ? raw.energy_signal : 'unknown',
    confidence: isConfidenceLevel(raw.confidence) ? raw.confidence : 'medium',
  };
}

function normalizeTechnicalContext(raw: Record<string, unknown> | undefined): TechnicalContext {
  return {
    stack: cleanSkillArray(asStringArray(raw?.stack)),
    constructs: asStringArray(raw?.constructs),
    seniority_band: typeof raw?.seniority_band === 'string' ? raw.seniority_band : '',
    codebase_expectations: cleanSkillArray(asStringArray(raw?.codebase_expectations)),
    dispositional_weights: asNumberRecord(raw?.dispositional_weights),
  };
}

function normalizeTeamCultureProfile(raw: Record<string, unknown> | undefined): TeamCultureProfile {
  const perStakeholderRaw = (raw?.per_stakeholder as Record<string, unknown> | undefined) ?? {};
  const per_stakeholder: TeamCultureProfile['per_stakeholder'] = {};

  for (const stakeholder of FOUR_STAKEHOLDERS) {
    const entry = perStakeholderRaw[stakeholder] as Record<string, unknown> | undefined;
    if (!entry) continue;
    per_stakeholder[stakeholder] = {
      clan_affinity: asNumberInRange(entry.clan_affinity, 1, 5),
      adhocracy_affinity: asNumberInRange(entry.adhocracy_affinity, 1, 5),
      market_affinity: asNumberInRange(entry.market_affinity, 1, 5),
      hierarchy_affinity: asNumberInRange(entry.hierarchy_affinity, 1, 5),
      psychological_safety: asNumberInRange(entry.psychological_safety, 1, 5),
    };
  }

  const profile: TeamCultureProfile = { per_stakeholder };
  const aggRaw = raw?.aggregated as Record<string, unknown> | undefined;
  if (aggRaw && typeof aggRaw.formula === 'string') {
    profile.aggregated = {
      formula: aggRaw.formula,
      clan_affinity: asNumberInRange(aggRaw.clan_affinity, 1, 5),
      adhocracy_affinity: asNumberInRange(aggRaw.adhocracy_affinity, 1, 5),
      market_affinity: asNumberInRange(aggRaw.market_affinity, 1, 5),
      hierarchy_affinity: asNumberInRange(aggRaw.hierarchy_affinity, 1, 5),
      psychological_safety: asNumberInRange(aggRaw.psychological_safety, 1, 5),
    };
  }
  return profile;
}

function normalizeProbeEnrichment(raw: Record<string, unknown> | undefined): ProbeEnrichment {
  return {
    static_base_version: typeof raw?.static_base_version === 'string' ? raw.static_base_version : '',
    enriched_probes: asArray<ProbeEnrichment['enriched_probes'][number]>(raw?.enriched_probes).map((p) => ({
      dimension: typeof p.dimension === 'string' ? p.dimension : '',
      probe_text: typeof p.probe_text === 'string' ? p.probe_text : '',
      source_chain_id: typeof p.source_chain_id === 'string' ? p.source_chain_id : '',
      approved_by: typeof p.approved_by === 'string' ? p.approved_by : '',
      approved_at: typeof p.approved_at === 'string' ? p.approved_at : '',
    })),
  };
}

function normalizeValidationMetadata(
  raw: Record<string, unknown> | undefined,
  ctx: NormalizeContext,
): ValidationMetadata {
  return {
    schema_version: typeof raw?.schema_version === 'string' ? raw.schema_version : SCHEMA_VERSION,
    synthesis_model: typeof raw?.synthesis_model === 'string' ? raw.synthesis_model : ctx.synthesisModel,
    synthesis_prompt_version:
      typeof raw?.synthesis_prompt_version === 'string'
        ? raw.synthesis_prompt_version
        : RCD_SYNTHESIS_PROMPT_VERSION,
    verification_pass_model:
      typeof raw?.verification_pass_model === 'string'
        ? raw.verification_pass_model
        : ctx.verificationPassModel,
    face_validity_reviewed_at:
      typeof raw?.face_validity_reviewed_at === 'string' ? raw.face_validity_reviewed_at : null,
    face_validity_reviewer:
      typeof raw?.face_validity_reviewer === 'string' ? raw.face_validity_reviewer : null,
  };
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function asNumberInRange(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function isCoverageLevel(value: unknown): value is DomainCell['coverage'] {
  return (
    value === 'not_probed' ||
    value === 'sparse' ||
    value === 'partial' ||
    value === 'covered' ||
    value === 'deep'
  );
}

function isEnergySignal(value: unknown): value is DomainCell['laddering_chains'][number]['energy_signal'] {
  return value === 'high' || value === 'medium' || value === 'low' || value === 'unknown';
}

function isConfidenceLevel(value: unknown): value is DomainCell['laddering_chains'][number]['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low';
}
