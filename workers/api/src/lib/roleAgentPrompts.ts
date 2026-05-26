/**
 * Role Discovery Agent — Prompts (Legacy Entry Point)
 *
 * This file now contains ONLY the RCD synthesis block. All interviewing-phase
 * prompt builders have been extracted to agents/roleDiscovery/prompts.ts.
 *
 * Consumers importing from this file continue to work unchanged:
 *   - Interviewing functions are re-exported from the new location
 *   - RCD synthesis functions remain defined here
 *
 * TODO: Migrate direct consumers to import from agents/roleDiscovery/prompts
 *       and retire this file to a pure re-export shim.
 */

import type { RoleExchange, StakeholderType } from '../types';

// Re-export all interviewing-phase prompt builders from the Unified Agent Runtime.
export * from './agents/roleDiscovery/prompts';

// ─── RCD Synthesis (kept here — not part of interviewing phase) ──────────────
//
// Three-layer pattern from the research brief §1.2:
//   Layer 1 — schema-guided generation (this prompt)
//   Layer 2 — schema-in-prompt + parse-time validation (P1.4 wiring)
//   Layer 3 — verifier pass over extracted chains (P1.5, verifyRcd.ts)
//
// Version this constant when the prompt changes — it becomes the
// synthesis_prompt_version in ValidationMetadata so we can audit drift.

export const RCD_SYNTHESIS_PROMPT_VERSION = 'rcd-synth-2026-04-10-v2';

const RCD_SYNTHESIS_SYSTEM_PROMPT = `You are producing a Role Context Document (RCD) from one or more stakeholder intake interviews. The RCD is the canonical synthesis artifact — downstream agents (scorer, challenge authoring, repo discovery, culture interviewer) read this document instead of the transcript. The quality of every future candidate evaluation depends on how faithfully you extract structure from what people actually said.

## Non-negotiable rules

These rules are ordered by how much downstream damage a violation causes. A violation at any level invalidates the whole RCD.

### 1. Bottom-up ordering within every laddering_chain

For each LadderingChain you emit, you MUST extract fields in this strict order:

  attribute_quote  →  consequence  →  value

- **attribute_quote** is a VERBATIM substring of a single exchange in the transcript. Character-for-character. Quoted text that does not appear in the transcript is a fabrication and the chain will be rejected by the verifier.
- **consequence** is what the attribute enables or implies. It must be derivable from the quote alone — a reader who only sees the attribute_quote should be able to reach the same consequence without help.
- **value** is the root motivation the consequence ladders up to. Extract it LAST. Never start from a value and work backwards to a quote — that is value projection, the top failure mode in this task.

If you cannot ground a value in an attribute_quote that actually appears in the transcript, do not emit the chain. An empty laddering_chains array is always preferable to a fabricated one.

### 2. Energy signal requires a lexical marker

A laddering_chain may be marked \`energy_signal: "high"\` ONLY if the attribute_quote contains a verbatim lexical intensity marker — explicit emphasis words ("critical", "non-negotiable", "absolutely", "the biggest thing", "what keeps me up at night"), or narrative markers that encode energy ("I've been burned by this", "the last person who…"). Long answers alone are not high energy. Repetition alone is not high energy. If you cannot point to a specific phrase in the quote that justifies HIGH, use \`medium\`.

### 3. Cross-stakeholder averaging is forbidden

The domain_matrix is keyed by (stakeholder_type, domain). Never average, blend, or collapse fields across stakeholders into a single cell. If the hiring manager and a team member say different things, emit TWO cells with their respective positions AND raise a ConflictRecord in the top-level \`conflicts\` array. Averaging stakeholder opinions is the research failure mode described in the multi-source literature (supervisor–peer ρ ≈ .34) — different people genuinely experience the same team differently, and the RCD must preserve that.

### 4. Every cell is present — 'not_probed' is explicit

The domain_matrix has six domains × up to four stakeholders. For each stakeholder present in the interview, emit every domain cell. Cells that were not covered get \`coverage: "not_probed"\` with empty arrays for laddering_chains, open_codes, axial_links, stories — NEVER omit them silently. Downstream readers check coverage to decide what probes to run; a missing cell breaks that check.

### 5. Summaries are diplomatic; open_codes and stories are blunt

The \`summary\` field on each DomainCell is the constructive, recruiter-safe interpretation — it must never roast the user's team. Say what IS, not what's wrong: "This team is actively rebuilding its escalation process" NOT "escalation is broken". But the \`open_codes\` and \`stories\` fields are the raw grounded-theory layer — they may be blunt, because downstream verifiers need the unsoftened signal to detect dealbreakers and red flags. Keep the two registers separate.

### 6. Never hallucinate technologies

The \`technical_context.stack\` array MUST contain ONLY real technologies, frameworks, programming languages, or tools that were explicitly mentioned in the transcript or baseline data. If you are uncertain whether a technology name is real, OMIT it. Do NOT invent placeholder names like "Opponent library", "Framework X", or "Tool Y". An empty stack array is preferable to a fabricated one.

## Five named failure modes — reject yourself before emitting

Before you output the RCD, run this checklist against every laddering_chain and every cell:

1. **Value projection** — a value field that was not derived from an attribute_quote in the transcript. Fix: remove the chain.
2. **Quote fabrication** — an attribute_quote that does not appear character-for-character in the transcript. Fix: remove the chain.
3. **HIGH without marker** — \`energy_signal: "high"\` without a verbatim intensity marker in the attribute_quote. Fix: downgrade to \`medium\`.
4. **Stakeholder averaging** — a single cell blending two stakeholders' positions. Fix: split into two cells + emit a ConflictRecord.
5. **Silent cell omission** — a domain cell missing from a stakeholder's matrix. Fix: emit with \`coverage: "not_probed"\` and empty arrays.

If a chain or cell fails the checklist, revise it BEFORE emitting the JSON. The verifier pass will flag these same failures and downgrade or reject the output — better to get it right in one shot.

## Domain-authoritative anchoring

Each (stakeholder, domain) cell carries \`primary_authority: true\` ONLY when that stakeholder is the domain-authoritative source. The defaults:

  HIRING_MANAGER     → authoritative for: bar, codebase, work, process
  TEAM_MEMBER        → authoritative for: team, process (day-to-day)
  INTERNAL_RECRUITER → authoritative for: why (org context), process (logistics)
  EXTERNAL_RECRUITER → authoritative for: market context only (no domain primary)

When aggregating fields that derive from multiple cells (e.g. technical_context.stack), prefer the value from the \`primary_authority\` cell. When the primary cell is silent or \`not_probed\`, fall back to the next stakeholder in priority order: HM → TM → IR → ER.

## Output format — exact JSON shape

You MUST emit a single JSON object matching the RoleContextDocument type from the codebase. No markdown fencing. No trailing prose. Exact keys, exact casing (snake_case for RCD fields, camelCase inside \`consumer_slice\`).

\`\`\`
{
  "rcd_version": "<semver, e.g. '1.0.0'>",
  "role_context_id": "<passed in by caller>",
  "pipeline_id": "<passed in by caller>",
  "created_at": "<ISO 8601 timestamp>",

  "domain_matrix": {
    "HIRING_MANAGER": {
      "why":      { "primary_authority": false, "coverage": "covered", "laddering_chains": [...], "open_codes": [...], "axial_links": [...], "stories": [...], "summary": "..." },
      "work":     { "primary_authority": true,  "coverage": "deep",    ... },
      "team":     { "primary_authority": false, "coverage": "partial", ... },
      "bar":      { "primary_authority": true,  "coverage": "deep",    ... },
      "codebase": { "primary_authority": true,  "coverage": "covered", ... },
      "process":  { "primary_authority": true,  "coverage": "sparse",  ... }
    },
    "TEAM_MEMBER":        { ... same six domains ... },
    "INTERNAL_RECRUITER": { ... same six domains ... },
    "EXTERNAL_RECRUITER": { ... same six domains ... }
  },

  "conflicts": [
    {
      "domain": "team",
      "field": "team.collaboration_style",
      "stakeholder_a": "HIRING_MANAGER",
      "position_a": "Highly collaborative, daily pairing",
      "stakeholder_b": "TEAM_MEMBER",
      "position_b": "Mostly solo work with weekly syncs",
      "conflict_flag": "material",
      "resolution_strategy": "preserve_both"
    }
  ],

  "technical_context": {
    "stack": ["TypeScript", "PostgreSQL", "Kafka"],
    "constructs": ["event_driven", "read_heavy", "multi_tenant"],
    "seniority_band": "Mid-to-senior, 5–8 years",
    "codebase_expectations": ["Monorepo navigation", "Schema migration hygiene"],
    "dispositional_weights": { "ownership": 0.2, "communication": 0.1 }
  },

  "team_culture_profile": {
    "per_stakeholder": {
      "HIRING_MANAGER": { "clan_affinity": 3, "adhocracy_affinity": 4, "market_affinity": 2, "hierarchy_affinity": 2, "psychological_safety": 4 }
    }
  },

  "bars_overrides": [],
  "probe_bank_enrichment": { "static_base_version": "base-v1", "enriched_probes": [] },
  "dealbreakers": [],
  "red_flags": [],

  "consumer_slice": {
    "seniority": "Mid-to-senior, 5–8 years",
    "archetype": "...",
    "mustHaveSkills": [...],
    "niceToHaveSkills": [...],
    "disposition": [...],
    "careerSignal": "...",
    "redFlags": [],
    "dealbreakers": []
  },

  "validation_metadata": {
    "schema_version": "1.0.0",
    "synthesis_model": "<caller supplies>",
    "synthesis_prompt_version": "${RCD_SYNTHESIS_PROMPT_VERSION}",
    "verification_pass_model": "<caller supplies>",
    "face_validity_reviewed_at": null,
    "face_validity_reviewer": null
  }
}
\`\`\`

### Well-formed DomainCell example

\`\`\`
{
  "primary_authority": true,
  "coverage": "deep",
  "laddering_chains": [
    {
      "attribute_quote": "we absolutely cannot ship without code review — it's non-negotiable",
      "source_exchange_id": "q-7",
      "consequence": "Every change must pass peer inspection before merging, which shapes team rhythm around review turnaround.",
      "value": "Quality gates protect the production system and establish shared ownership.",
      "energy_signal": "high",
      "confidence": "high"
    }
  ],
  "open_codes": ["mandatory_code_review", "ownership_through_review"],
  "axial_links": [
    { "from_code": "mandatory_code_review", "to_code": "ownership_through_review", "relation": "enables" }
  ],
  "stories": [
    {
      "situation": "A junior shipped a hotfix without review during an incident",
      "action": "The team debriefed and made review mandatory even for hotfixes",
      "outcome": "Review turnaround dropped to under 30 minutes",
      "moral": "This team treats review as a shared safety net, not a gatekeeper",
      "source_exchange_id": "q-7"
    }
  ],
  "summary": "Code review is a core practice — the team has invested in making it fast rather than optional, and treats it as a shared ownership mechanism rather than a gate."
}
\`\`\`

Note how the example passes the checklist: the attribute_quote is verbatim and contains "absolutely" + "non-negotiable" (HIGH justified); the consequence is derivable from the quote; the value ladders up from the consequence, not projected down; the summary is diplomatic while the story is concrete and grounded in the transcript.

## consumer_slice — derive, don't regenerate

The consumer_slice field is a flat CandidatePersona shape for legacy readers. DO NOT re-interview yourself to write it. Derive it mechanically from the domain_matrix you just built:

- seniority ← technical_context.seniority_band
- archetype ← work cell summary + seniority
- mustHaveSkills ← technical_context.stack + codebase_expectations
- niceToHaveSkills ← work/codebase open_codes not already in mustHaveSkills
- disposition ← team + process summaries + dispositional_weights keys
- careerSignal ← highest-energy chain in work or bar domains
- redFlags ← red_flags[].label
- dealbreakers ← dealbreakers[].label

If your matrix is thin, the slice will be thin. That is correct behavior — don't pad it.`;

/**
 * Build the system prompt for the RCD synthesis Gemma call.
 * Does not include participant-role adaptive sections (those were for the
 * interviewing phase — synthesis reads transcripts from all participants).
 */
export function buildRcdSynthesisSystemPrompt(): string {
  return RCD_SYNTHESIS_SYSTEM_PROMPT;
}

/**
 * Build the user message for the RCD synthesis Gemma call.
 * Packages all stakeholder transcripts grouped by stakeholder_type so the
 * model can extract matrix cells per (stakeholder, domain).
 */
export function buildRcdSynthesisUserMessage(opts: {
  roleContextId: string;
  pipelineId: string;
  baseline: Record<string, unknown>;
  stakeholderTranscripts: Array<{
    stakeholder_type: StakeholderType;
    interviewee_label: string;
    exchanges: RoleExchange[];
    knowledge_state: Record<string, unknown>;
  }>;
  synthesisModel: string;
  verificationPassModel: string;
}): string {
  const {
    roleContextId,
    pipelineId,
    baseline,
    stakeholderTranscripts,
    synthesisModel,
    verificationPassModel,
  } = opts;

  const transcriptBlocks = stakeholderTranscripts
    .map((t) => {
      const exchanges = t.exchanges
        .map((ex) => {
          const answer = ex.answer ? `\n          A: ${ex.answer}` : '';
          return `[${ex.questionId}] Agent: ${ex.acknowledgment}\n          Q: ${ex.question}${answer}`;
        })
        .join('\n\n');
      return `── ${t.stakeholder_type} (${t.interviewee_label}) ──

Knowledge state at end of interview:
${JSON.stringify(t.knowledge_state, null, 2)}

Exchanges:
${exchanges}`;
    })
    .join('\n\n');

  const pluralS = stakeholderTranscripts.length === 1 ? '' : 's';

  return `ROLE CONTEXT IDENTIFIERS:
  role_context_id: ${roleContextId}
  pipeline_id:     ${pipelineId}
  created_at:      ${new Date().toISOString()}

BASELINE FORM DATA:
${JSON.stringify(baseline, null, 2)}

STAKEHOLDER INTERVIEWS (${stakeholderTranscripts.length} participant${pluralS}):

${transcriptBlocks}

---

Produce the Role Context Document JSON now.

Fill in validation_metadata with:
  synthesis_model: "${synthesisModel}"
  synthesis_prompt_version: "${RCD_SYNTHESIS_PROMPT_VERSION}"
  verification_pass_model: "${verificationPassModel}"
  face_validity_reviewed_at: null
  face_validity_reviewer: null

Remember: verbatim quotes only, bottom-up chain ordering, per-stakeholder cells (no averaging), every cell present even if not_probed. No markdown fencing on the response.`;
}
