import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calibrateRcd } from '../lib/roleAgent/calibrateRcd';
import { callGapFillingAgent } from '../lib/roleAgent';
import type { LLMProvider, LLMMessage, LLMCompletion } from '../lib/llm/types';
import type { RoleContextDocument, DomainCell } from '../types';

vi.mock('../lib/roleAgent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/roleAgent')>();
  return {
    ...actual,
    callGapFillingAgent: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function buildMockRcd(overrides: Partial<RoleContextDocument> = {}): RoleContextDocument {
  const base: RoleContextDocument = {
    rcd_version: 'rcd-v1',
    role_context_id: 'rc-test',
    pipeline_id: 'pipe-test',
    created_at: '2026-04-10T00:00:00Z',
    domain_matrix: {
      HIRING_MANAGER: {
        bar: {
          primary_authority: true,
          coverage: 'partial',
          laddering_chains: [
            {
              attribute_quote: 'Code review is mandatory',
              source_exchange_id: 'q-1',
              consequence: 'Quality is maintained',
              value: 'Shared ownership',
              energy_signal: 'high',
              confidence: 'high',
            },
          ],
          open_codes: ['code_review'],
          axial_links: [],
          stories: [],
          summary: 'Code review is mandatory.',
        },
      },
    },
    conflicts: [],
    technical_context: {
      stack: ['TypeScript'],
      constructs: [],
      seniority_band: 'senior',
      codebase_expectations: [],
      dispositional_weights: {},
    },
    team_culture_profile: { per_stakeholder: {} },
    bars_overrides: [],
    probe_bank_enrichment: { static_base_version: 'v1', enriched_probes: [] },
    dealbreakers: [],
    red_flags: [],
    consumer_slice: {
      seniority: 'senior',
      archetype: 'Engineer',
      mustHaveSkills: ['TypeScript'],
      niceToHaveSkills: [],
      disposition: [],
      careerSignal: '',
      redFlags: [],
      dealbreakers: [],
    },
    validation_metadata: {
      schema_version: 'rcd-v1',
      synthesis_model: 'mock',
      synthesis_prompt_version: 'v1',
      verification_pass_model: 'mock',
      face_validity_reviewed_at: null,
      face_validity_reviewer: null,
    },
  };
  return { ...base, ...overrides };
}

function createMockProvider(responseText: string): LLMProvider {
  return {
    name: 'mock',
    supportsTools: false,
    async complete(_messages: LLMMessage[]): Promise<LLMCompletion> {
      return { content: responseText };
    },
  };
}

describe('calibrateRcd', () => {
  it('returns clarifying question when no answer is provided', async () => {
    vi.mocked(callGapFillingAgent).mockResolvedValue({
      clarifyingQuestion: 'What specific bar do you mean?',
    });

    const rcd = buildMockRcd();
    const result = await calibrateRcd({
      provider: null,
      rcd,
      flagType: 'missing_detail',
      domain: 'bar',
      attribute: 'code_review_rigor',
      recruiterNote: 'Need more detail',
      transcript: 'Q: What is the bar?\nA: High',
    });

    expect(result.clarifyingQuestion).toBe('What specific bar do you mean?');
    expect(result.updatedCell).toBeUndefined();
    expect(callGapFillingAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: null,
        flagType: 'missing_detail',
        domain: 'bar',
        attribute: 'code_review_rigor',
        recruiterNote: 'Need more detail',
        transcript: 'Q: What is the bar?\nA: High',
      }),
    );
  });

  it('re-synthesizes cell when answer and provider are provided', async () => {
    const updatedCellJson: DomainCell = {
      primary_authority: true,
      coverage: 'deep',
      laddering_chains: [
        {
          attribute_quote: 'We do 3 rounds of review',
          source_exchange_id: 'calibrate-1',
          consequence: 'Very thorough process',
          value: 'Quality above speed',
          energy_signal: 'medium',
          confidence: 'medium',
        },
      ],
      open_codes: ['three_rounds'],
      axial_links: [],
      stories: [],
      summary: 'Three rounds of code review.',
    };

    const provider = createMockProvider(JSON.stringify(updatedCellJson));
    const rcd = buildMockRcd();

    const result = await calibrateRcd({
      provider,
      rcd,
      flagType: 'missing_detail',
      domain: 'bar',
      attribute: 'code_review_rigor',
      recruiterNote: 'Need more detail',
      transcript: 'Q: What is the bar?\nA: High',
      answer: 'We do 3 rounds of review for every PR',
    });

    expect(result.updatedCell).toBeDefined();
    expect(result.updatedCell!.summary).toBe('Three rounds of code review.');
    expect(result.updatedCell!.laddering_chains).toHaveLength(1);
    expect(result.rcd.domain_matrix.HIRING_MANAGER?.bar?.summary).toBe('Three rounds of code review.');
  });

  it('falls back to manual append when provider is null', async () => {
    const rcd = buildMockRcd();
    const result = await calibrateRcd({
      provider: null,
      rcd,
      flagType: 'missing_detail',
      domain: 'bar',
      attribute: 'code_review_rigor',
      recruiterNote: 'Need more detail',
      transcript: 'Q: What is the bar?\nA: High',
      answer: 'We require 3 reviewers',
    });

    expect(result.updatedCell).toBeDefined();
    expect(result.updatedCell!.laddering_chains).toHaveLength(2);
    expect(result.updatedCell!.laddering_chains[1]!.attribute_quote).toContain('We require 3 reviewers');
    expect(result.updatedCell!.summary).toContain('We require 3 reviewers');
  });

  it('falls back to manual append when LLM call throws', async () => {
    const provider: LLMProvider = {
      name: 'mock-throw',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        throw new Error('LLM timeout');
      },
    };

    const rcd = buildMockRcd();
    const result = await calibrateRcd({
      provider,
      rcd,
      flagType: 'missing_detail',
      domain: 'bar',
      attribute: 'code_review_rigor',
      recruiterNote: 'Need more detail',
      transcript: 'Q: What is the bar?\nA: High',
      answer: 'We require 3 reviewers',
    });

    expect(result.updatedCell).toBeDefined();
    expect(result.updatedCell!.laddering_chains).toHaveLength(2);
  });

  it('normalizeCell handles empty object from LLM', async () => {
    const provider = createMockProvider('{}');
    const rcd = buildMockRcd();

    const result = await calibrateRcd({
      provider,
      rcd,
      flagType: 'missing_detail',
      domain: 'bar',
      attribute: 'code_review_rigor',
      recruiterNote: '',
      transcript: '',
      answer: 'Something',
    });

    expect(result.updatedCell).toBeDefined();
    expect(result.updatedCell!.coverage).toBe('partial');
    expect(result.updatedCell!.laddering_chains).toEqual([]);
    expect(result.updatedCell!.open_codes).toEqual([]);
    expect(result.updatedCell!.axial_links).toEqual([]);
    expect(result.updatedCell!.stories).toEqual([]);
    expect(result.updatedCell!.summary).toBe('');
    expect(result.updatedCell!.primary_authority).toBe(false);
  });

  it('normalizeCell handles partial object missing laddering_chains and stories', async () => {
    const partial = {
      summary: 'Partial summary',
      coverage: 'sparse',
      open_codes: ['code'],
    };

    const provider = createMockProvider(JSON.stringify(partial));
    const rcd = buildMockRcd();

    const result = await calibrateRcd({
      provider,
      rcd,
      flagType: 'missing_detail',
      domain: 'bar',
      attribute: 'code_review_rigor',
      recruiterNote: '',
      transcript: '',
      answer: 'Something',
    });

    expect(result.updatedCell).toBeDefined();
    expect(result.updatedCell!.summary).toBe('Partial summary');
    expect(result.updatedCell!.coverage).toBe('sparse');
    expect(result.updatedCell!.open_codes).toEqual(['code']);
    expect(result.updatedCell!.laddering_chains).toEqual([]);
    expect(result.updatedCell!.stories).toEqual([]);
    expect(result.updatedCell!.axial_links).toEqual([]);
  });

  it('uses existing cell as context for the LLM prompt', async () => {
    const provider = createMockProvider('{}');
    const completeSpy = vi.spyOn(provider, 'complete');
    const rcd = buildMockRcd();

    await calibrateRcd({
      provider,
      rcd,
      flagType: 'missing_detail',
      domain: 'bar',
      attribute: 'code_review_rigor',
      recruiterNote: '',
      transcript: '',
      answer: 'New info',
      stakeholder: 'HIRING_MANAGER',
    });

    expect(completeSpy).toHaveBeenCalledTimes(1);
    const messages = completeSpy.mock.calls[0]![0];
    const userMessage = messages.find((m) => m.role === 'user');
    expect(userMessage?.content).toContain('Code review is mandatory');
  });

  it('creates default cell when domain cell does not exist for the stakeholder', async () => {
    const provider = createMockProvider('{}');
    const rcd = buildMockRcd();
    delete (rcd.domain_matrix as Record<string, unknown>).TEAM_MEMBER;

    const result = await calibrateRcd({
      provider,
      rcd,
      flagType: 'missing_detail',
      domain: 'team',
      attribute: 'collaboration',
      recruiterNote: '',
      transcript: '',
      answer: 'They pair daily',
      stakeholder: 'TEAM_MEMBER',
    });

    expect(result.updatedCell).toBeDefined();
    expect(result.updatedCell!.coverage).toBe('partial');
    expect(result.rcd.domain_matrix.TEAM_MEMBER?.team).toBeDefined();
  });
});
