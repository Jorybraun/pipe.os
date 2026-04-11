/**
 * BDD for ADR-036 Phase 1 step 7 — seeded 4-stakeholder synthesis → full RCD.
 *
 * Scenario (from ADR-036 §Phase 1 acceptance):
 *   Given a seeded interview with all four stakeholders each contributing one
 *   exchange with a verbatim HIGH-energy quote,
 *   When the synthesis caller feeds those transcripts through a mocked Gemma
 *   provider that returns a schema-valid RoleContextDocument,
 *   Then the resulting RCD has all 6 domains × 4 stakeholders present, the
 *   consumer_slice is populated for legacy readers, validation_metadata names
 *   the synthesis prompt version, and the verifier passes with zero quote
 *   fabrications.
 *
 * The mocked provider stands in for Gemma 4 26B on Workers AI. The synthesis
 * call site doesn't care which provider it's given as long as it satisfies
 * LLMProvider — that's the point of the abstraction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { synthesizeRcd } from '../lib/roleAgent/synthesizeRcd';
import { RCD_SYNTHESIS_PROMPT_VERSION } from '../lib/roleAgentPrompts';
import type { LLMCompletion, LLMMessage, LLMProvider } from '../lib/llm/types';
import type { RoleExchange, StakeholderType } from '../types';

// ─── Fixture: four stakeholders, one exchange each ─────────────────────────
//
// Quotes are crafted so that:
//   - every attribute_quote is a verbatim substring of its exchange answer;
//   - every HIGH-energy chain contains a lexical marker from HIGH_ENERGY_MARKERS;
//   - the four exchanges cover four distinct domains (bar, team, why, market
//     — though we'll file the market cell under 'process' since Domain doesn't
//     have a 'market' enum).

const HM_EXCHANGE: RoleExchange = {
  questionId: 'q-hm-1',
  acknowledgment: 'Thanks for that context.',
  question: 'What is the one thing you absolutely cannot ship without?',
  input: { type: 'textarea' },
  answer:
    "We absolutely cannot ship without code review — it's non-negotiable. The last person who tried to cowboy a PR to main caused a week-long outage.",
};

const TM_EXCHANGE: RoleExchange = {
  questionId: 'q-tm-1',
  acknowledgment: 'Got it.',
  question: 'What keeps you up at night on this team?',
  input: { type: 'textarea' },
  answer:
    'What keeps me up at night is whether the new hire will actually pair with us or hide behind async threads. Pairing is critical for us.',
};

const IR_EXCHANGE: RoleExchange = {
  questionId: 'q-ir-1',
  acknowledgment: 'Understood.',
  question: 'Why is this role open right now?',
  input: { type: 'textarea' },
  answer:
    'The reason this role is open is that the last person who held it burned out trying to carry the oncall rotation solo. That was a nightmare for everyone.',
};

const ER_EXCHANGE: RoleExchange = {
  questionId: 'q-er-1',
  acknowledgment: 'Makes sense.',
  question: 'What does the market look like for this role?',
  input: { type: 'textarea' },
  answer:
    'The market for this role is essential to understand — comp is the biggest factor we see candidates walk away from.',
};

const STAKEHOLDER_TRANSCRIPTS = [
  {
    stakeholder_type: 'HIRING_MANAGER' as StakeholderType,
    interviewee_label: 'Alex (HM)',
    exchanges: [HM_EXCHANGE],
    knowledge_state: { bar: { code_review: 'non-negotiable' } },
  },
  {
    stakeholder_type: 'TEAM_MEMBER' as StakeholderType,
    interviewee_label: 'Sam (TM)',
    exchanges: [TM_EXCHANGE],
    knowledge_state: { team: { pairing: 'critical' } },
  },
  {
    stakeholder_type: 'INTERNAL_RECRUITER' as StakeholderType,
    interviewee_label: 'Jordan (IR)',
    exchanges: [IR_EXCHANGE],
    knowledge_state: { why: { origin: 'backfill_burnout' } },
  },
  {
    stakeholder_type: 'EXTERNAL_RECRUITER' as StakeholderType,
    interviewee_label: 'Casey (ER)',
    exchanges: [ER_EXCHANGE],
    knowledge_state: { process: { comp_blocker: true } },
  },
];

// ─── Canned model output ────────────────────────────────────────────────────
//
// The mock provider returns this JSON string as if it were Gemma's completion.
// It populates one cell per stakeholder with a valid laddering chain whose
// attribute_quote is a verbatim substring of that stakeholder's exchange.
// The remaining cells are omitted; synthesizeRcd's normalizer will fill them
// as 'not_probed' empty shells and the verifier will flag those as warnings.

function buildMockRcdJson(): string {
  return JSON.stringify({
    rcd_version: 'rcd-v1',
    role_context_id: 'rc-test',
    pipeline_id: 'pipe-test',
    created_at: '2026-04-10T00:00:00.000Z',
    domain_matrix: {
      HIRING_MANAGER: {
        bar: {
          primary_authority: true,
          coverage: 'deep',
          laddering_chains: [
            {
              attribute_quote: "we absolutely cannot ship without code review — it's non-negotiable",
              source_exchange_id: 'q-hm-1',
              consequence: 'Every change gets a second set of eyes before merge',
              value: 'Shared ownership of quality',
              energy_signal: 'high',
              confidence: 'high',
            },
          ],
          open_codes: ['code_review_mandatory', 'merge_gate'],
          axial_links: [
            { from_code: 'code_review_mandatory', to_code: 'merge_gate', relation: 'enables' },
          ],
          stories: [],
          summary: 'The team treats code review as a mandatory merge gate.',
        },
      },
      TEAM_MEMBER: {
        team: {
          primary_authority: true,
          coverage: 'covered',
          laddering_chains: [
            {
              attribute_quote: 'What keeps me up at night is whether the new hire will actually pair with us',
              source_exchange_id: 'q-tm-1',
              consequence: 'Pairing is a daily collaboration expectation',
              value: 'Collective code ownership',
              energy_signal: 'high',
              confidence: 'high',
            },
          ],
          open_codes: ['pairing_daily', 'async_risk'],
          axial_links: [],
          stories: [],
          summary: 'Pairing is treated as daily practice, not a nice-to-have.',
        },
      },
      INTERNAL_RECRUITER: {
        why: {
          primary_authority: true,
          coverage: 'covered',
          laddering_chains: [
            {
              attribute_quote: 'the last person who held it burned out trying to carry the oncall rotation solo',
              source_exchange_id: 'q-ir-1',
              consequence: 'Oncall load must be distributed, not concentrated',
              value: 'Sustainability of the rotation',
              energy_signal: 'high',
              confidence: 'high',
            },
          ],
          open_codes: ['oncall_burnout', 'backfill_reason'],
          axial_links: [],
          stories: [],
          summary: 'The role exists because the previous holder burned out on oncall.',
        },
      },
      EXTERNAL_RECRUITER: {
        process: {
          primary_authority: false,
          coverage: 'partial',
          laddering_chains: [
            {
              attribute_quote: 'comp is the biggest factor we see candidates walk away from',
              source_exchange_id: 'q-er-1',
              consequence: 'Comp package must be benchmarked before outreach',
              value: 'Offer competitiveness',
              energy_signal: 'high',
              confidence: 'medium',
            },
          ],
          open_codes: ['comp_walk_away'],
          axial_links: [],
          stories: [],
          summary: 'Comp is the leading candidate-walkaway reason in the current market.',
        },
      },
    },
    conflicts: [],
    technical_context: {
      stack: ['TypeScript', 'Cloudflare Workers'],
      constructs: ['edge_compute', 'ci_cd'],
      seniority_band: 'senior',
      codebase_expectations: ['monorepo', 'review_required'],
      dispositional_weights: { ownership: 1.2, pragmatism: 1.1 },
    },
    team_culture_profile: {
      per_stakeholder: {
        HIRING_MANAGER: {
          clan_affinity: 4,
          adhocracy_affinity: 3,
          market_affinity: 2,
          hierarchy_affinity: 3,
          psychological_safety: 4,
        },
      },
    },
    bars_overrides: [],
    probe_bank_enrichment: { static_base_version: 'v1', enriched_probes: [] },
    dealbreakers: [
      {
        id: 'db-1',
        label: 'Unwilling to code review',
        pattern: 'Candidate avoids or dismisses code review',
        source_stakeholder: 'HIRING_MANAGER',
        source_chain_id: 'hm-bar-1',
        job_relatedness_note: 'Code review is a documented merge gate on the team.',
        job_relatedness_strength: 'strong',
        evidence_quote: "we absolutely cannot ship without code review — it's non-negotiable",
      },
    ],
    red_flags: [],
    validation_metadata: {
      schema_version: 'rcd-v1',
      synthesis_model: 'mock-gemma',
      synthesis_prompt_version: RCD_SYNTHESIS_PROMPT_VERSION,
      verification_pass_model: 'mock-gemma',
      face_validity_reviewed_at: null,
      face_validity_reviewer: null,
    },
  });
}

// ─── Mock provider ──────────────────────────────────────────────────────────

function createMockProvider(responseText: string): LLMProvider & { calls: LLMMessage[][] } {
  const calls: LLMMessage[][] = [];
  return {
    name: 'mock-gemma',
    supportsTools: false,
    calls,
    async complete(messages: LLMMessage[]): Promise<LLMCompletion> {
      calls.push(messages);
      return { content: responseText };
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('synthesizeRcd — Phase 1 seeded four-stakeholder synthesis', () => {
  it('produces a full RCD with all 6 domains × 4 stakeholders present', async () => {
    const provider = createMockProvider(buildMockRcdJson());

    const { rcd } = await synthesizeRcd({
      provider,
      roleContextId: 'rc-test',
      pipelineId: 'pipe-test',
      baseline: { title: 'Senior Platform Engineer' },
      stakeholderTranscripts: STAKEHOLDER_TRANSCRIPTS,
    });

    const expectedDomains = ['why', 'work', 'team', 'bar', 'codebase', 'process'] as const;
    const expectedStakeholders: StakeholderType[] = [
      'HIRING_MANAGER',
      'TEAM_MEMBER',
      'INTERNAL_RECRUITER',
      'EXTERNAL_RECRUITER',
    ];

    for (const stakeholder of expectedStakeholders) {
      const row = rcd.domain_matrix[stakeholder];
      expect(row, `missing row for ${stakeholder}`).toBeDefined();
      for (const domain of expectedDomains) {
        expect(row?.[domain], `missing cell ${stakeholder}/${domain}`).toBeDefined();
      }
    }
  });

  it('downgrades missing cells to coverage not_probed without dropping them', async () => {
    const provider = createMockProvider(buildMockRcdJson());
    const { rcd } = await synthesizeRcd({
      provider,
      roleContextId: 'rc-test',
      pipelineId: 'pipe-test',
      baseline: {},
      stakeholderTranscripts: STAKEHOLDER_TRANSCRIPTS,
    });

    // HM only populated 'bar' — the other five domains should be not_probed shells.
    const hmRow = rcd.domain_matrix.HIRING_MANAGER!;
    expect(hmRow.bar?.coverage).toBe('deep');
    expect(hmRow.why?.coverage).toBe('not_probed');
    expect(hmRow.work?.coverage).toBe('not_probed');
    expect(hmRow.team?.coverage).toBe('not_probed');
    expect(hmRow.codebase?.coverage).toBe('not_probed');
    expect(hmRow.process?.coverage).toBe('not_probed');
    expect(hmRow.why?.laddering_chains).toEqual([]);
  });

  it('populates consumer_slice from the RCD for legacy readers', async () => {
    const provider = createMockProvider(buildMockRcdJson());
    const { rcd } = await synthesizeRcd({
      provider,
      roleContextId: 'rc-test',
      pipelineId: 'pipe-test',
      baseline: {},
      stakeholderTranscripts: STAKEHOLDER_TRANSCRIPTS,
    });

    expect(rcd.consumer_slice.seniority).toBe('senior');
    expect(rcd.consumer_slice.mustHaveSkills).toContain('TypeScript');
    expect(rcd.consumer_slice.mustHaveSkills).toContain('monorepo');
    expect(rcd.consumer_slice.dealbreakers).toContain('Unwilling to code review');
    // The career signal should reference a high-energy chain from work or bar.
    expect(rcd.consumer_slice.careerSignal).toContain('code review');
  });

  it('records validation_metadata with synthesis prompt version and model names', async () => {
    const provider = createMockProvider(buildMockRcdJson());
    const { rcd } = await synthesizeRcd({
      provider,
      roleContextId: 'rc-test',
      pipelineId: 'pipe-test',
      baseline: {},
      stakeholderTranscripts: STAKEHOLDER_TRANSCRIPTS,
      synthesisModel: 'gemma-4-26b',
      verificationPassModel: 'gemma-4-26b',
    });

    expect(rcd.validation_metadata.synthesis_prompt_version).toBe(RCD_SYNTHESIS_PROMPT_VERSION);
    // The canned response names 'mock-gemma', which the normalizer preserves
    // verbatim if present. The ctx override only applies when the field is
    // absent from the parsed object — that's the intended contract.
    expect(rcd.validation_metadata.synthesis_model).toBe('mock-gemma');
    expect(rcd.validation_metadata.face_validity_reviewed_at).toBeNull();
  });

  it('verifier passes with zero quote fabrication errors on verbatim chains', async () => {
    const provider = createMockProvider(buildMockRcdJson());
    const { issues } = await synthesizeRcd({
      provider,
      roleContextId: 'rc-test',
      pipelineId: 'pipe-test',
      baseline: {},
      stakeholderTranscripts: STAKEHOLDER_TRANSCRIPTS,
    });

    const fabrications = issues.filter((i) => i.failure_mode === 'quote_fabrication');
    expect(fabrications).toEqual([]);

    // Cell omission is caught one layer earlier — the normalizer fills missing
    // cells as 'not_probed' shells before verifyRcd runs, so the verifier
    // never sees a genuinely-missing cell. That is the intended contract:
    // synthesizeRcd guarantees schema completeness; the verifier validates
    // semantic faithfulness of whatever was populated.
    const omissions = issues.filter((i) => i.failure_mode === 'cell_omission');
    expect(omissions).toEqual([]);
  });

  it('flags quote fabrication when attribute_quote is not in the transcript', async () => {
    // Swap one attribute_quote for a string that does NOT appear in the HM
    // exchange. The verifier should catch it and downgrade confidence.
    const raw = JSON.parse(buildMockRcdJson());
    raw.domain_matrix.HIRING_MANAGER.bar.laddering_chains[0].attribute_quote =
      'this string does not appear anywhere in the HM transcript';
    const provider = createMockProvider(JSON.stringify(raw));

    const { rcd, issues, passed } = await synthesizeRcd({
      provider,
      roleContextId: 'rc-test',
      pipelineId: 'pipe-test',
      baseline: {},
      stakeholderTranscripts: STAKEHOLDER_TRANSCRIPTS,
    });

    const fabrications = issues.filter((i) => i.failure_mode === 'quote_fabrication');
    expect(fabrications.length).toBe(1);
    expect(fabrications[0]?.severity).toBe('error');
    expect(passed).toBe(false);
    expect(rcd.domain_matrix.HIRING_MANAGER?.bar?.laddering_chains[0]?.confidence).toBe('low');
  });

  it('forwards forceJson and maxTokens to provider.complete', async () => {
    const provider = createMockProvider(buildMockRcdJson());
    const completeSpy = vi.spyOn(provider, 'complete');
    await synthesizeRcd({
      provider,
      roleContextId: 'rc-test',
      pipelineId: 'pipe-test',
      baseline: {},
      stakeholderTranscripts: STAKEHOLDER_TRANSCRIPTS,
    });

    expect(completeSpy).toHaveBeenCalledTimes(1);
    const options = completeSpy.mock.calls[0]?.[1];
    expect(options?.forceJson).toBe(true);
    expect(options?.maxTokens).toBeGreaterThanOrEqual(4096);
  });

  it('retries once on first-attempt parse failure then succeeds', async () => {
    const calls: LLMMessage[][] = [];
    const provider: LLMProvider = {
      name: 'mock-gemma',
      supportsTools: false,
      async complete(messages: LLMMessage[]): Promise<LLMCompletion> {
        calls.push(messages);
        if (calls.length === 1) {
          return { content: 'this is not json' };
        }
        return { content: buildMockRcdJson() };
      },
    };

    const result = await synthesizeRcd({
      provider,
      roleContextId: 'rc-test',
      pipelineId: 'pipe-test',
      baseline: {},
      stakeholderTranscripts: STAKEHOLDER_TRANSCRIPTS,
    });

    expect(result.retried).toBe(true);
    expect(calls.length).toBe(2);
    expect(result.rcd.domain_matrix.HIRING_MANAGER?.bar?.coverage).toBe('deep');
  });
});
