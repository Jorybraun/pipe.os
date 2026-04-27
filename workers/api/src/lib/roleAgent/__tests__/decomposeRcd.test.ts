import { describe, it, expect } from 'vitest';
import { decomposeRcdIntoNodes, type RoleNodeRow } from '../decomposeRcd';
import type { RoleContextDocument } from '../../../types';

function buildFixtureRcd(overrides?: Partial<RoleContextDocument>): RoleContextDocument {
  return {
    rcd_version: 'rcd-v1',
    role_context_id: 'rc-test-1',
    pipeline_id: 'pipe-test-1',
    created_at: new Date().toISOString(),
    domain_matrix: {
      HIRING_MANAGER: {
        work: {
          primary_authority: true,
          coverage: 'deep',
          laddering_chains: [
            {
              attribute_quote: 'Strong React experience',
              source_exchange_id: 'q-1',
              consequence: 'Can own the frontend architecture',
              value: 'Delivers reliable user experiences',
              energy_signal: 'high',
              confidence: 'high',
            },
          ],
          open_codes: ['frontend-ownership', 'react-ecosystem'],
          axial_links: [],
          stories: [
            {
              situation: 'Legacy frontend was unmaintainable',
              action: 'Led migration to Next.js',
              outcome: '50% faster page loads',
              moral: 'Technical initiative drives product outcomes',
              source_exchange_id: 'q-2',
            },
          ],
          summary: '',
        },
        team: {
          primary_authority: false,
          coverage: 'partial',
          laddering_chains: [],
          open_codes: ['small-team', 'flat-hierarchy'],
          axial_links: [],
          stories: [],
          summary: '',
        },
        process: {
          primary_authority: false,
          coverage: 'covered',
          laddering_chains: [],
          open_codes: ['weekly-deploys', 'pr-review-required'],
          axial_links: [],
          stories: [],
          summary: '',
        },
        why: {
          primary_authority: false,
          coverage: 'not_probed',
          laddering_chains: [],
          open_codes: [],
          axial_links: [],
          stories: [],
          summary: '',
        },
        bar: {
          primary_authority: false,
          coverage: 'deep',
          laddering_chains: [
            {
              attribute_quote: 'Must have shipped production GraphQL APIs',
              source_exchange_id: 'q-3',
              consequence: 'Can integrate with our data layer',
              value: 'Reduces backend dependency for frontend teams',
              energy_signal: 'high',
              confidence: 'high',
            },
          ],
          open_codes: [],
          axial_links: [],
          stories: [],
          summary: '',
        },
        codebase: {
          primary_authority: false,
          coverage: 'partial',
          laddering_chains: [
            {
              attribute_quote: 'Nice to have TypeScript monorepo experience',
              source_exchange_id: 'q-4',
              consequence: 'Can navigate shared packages',
              value: 'Improves cross-team code reuse',
              energy_signal: 'medium',
              confidence: 'medium',
            },
          ],
          open_codes: [],
          axial_links: [],
          stories: [],
          summary: '',
        },
      },
    },
    conflicts: [
      {
        domain: 'bar',
        field: 'sql_depth',
        stakeholder_a: 'HIRING_MANAGER',
        position_a: 'SQL nice to have',
        stakeholder_b: 'TEAM_MEMBER',
        position_b: 'SQL critical',
        conflict_flag: 'material',
        resolution_strategy: 'preserve_both',
      },
    ],
    technical_context: {
      stack: ['React', 'Next.js', 'GraphQL', 'PostgreSQL'],
      constructs: ['server-side-rendering', 'api-design'],
      seniority_band: 'senior',
      codebase_expectations: ['80% test coverage', 'typed APIs'],
      dispositional_weights: { ownership: 1.2 },
    },
    team_culture_profile: {
      per_stakeholder: {
        HIRING_MANAGER: {
          clan_affinity: 3,
          adhocracy_affinity: 4,
          market_affinity: 2,
          hierarchy_affinity: 2,
          psychological_safety: 4,
        },
      },
    },
    bars_overrides: [
      {
        dimension: 'ownership',
        anchor_level: 3,
        base_anchor_text: 'Takes responsibility for outcomes',
        override_anchor_text: 'Owns ambiguous product areas end-to-end',
        source_chain_id: 'chain-1',
        approved_by: 'rec-1',
        approved_at: new Date().toISOString(),
      },
    ],
    probe_bank_enrichment: {
      static_base_version: 'v1',
      enriched_probes: [],
    },
    dealbreakers: [
      {
        id: 'db-1',
        label: 'No remote work experience',
        pattern: 'remote_work < 1 year',
        source_stakeholder: 'HIRING_MANAGER',
        source_chain_id: 'chain-2',
        job_relatedness_note: 'Team is fully distributed; remote fluency is essential.',
        job_relatedness_strength: 'strong',
        evidence_quote: 'We tried hiring onsite-only before and it failed.',
      },
    ],
    red_flags: [
      {
        id: 'rf-1',
        label: 'Job hopper pattern',
        source_stakeholder: 'INTERNAL_RECRUITER',
        source_chain_id: 'chain-3',
        evidence_quote: 'Three roles in two years is a yellow flag.',
      },
    ],
    consumer_slice: {
      seniority: 'senior',
      archetype: 'product-engineer',
      mustHaveSkills: ['React', 'GraphQL'],
      niceToHaveSkills: ['TypeScript', 'PostgreSQL'],
      disposition: ['balanced'],
      careerSignal: 'growth',
      redFlags: [],
      dealbreakers: [],
    },
    validation_metadata: {
      schema_version: 'rcd-v1',
      synthesis_model: 'gemma-4-26b',
      synthesis_prompt_version: 'v2',
      verification_pass_model: 'gemma-4-26b',
      face_validity_reviewed_at: null,
      face_validity_reviewer: null,
    },
    ...overrides,
  };
}

describe('decomposeRcdIntoNodes', () => {
  it('returns empty array for a minimal RCD', () => {
    const rcd: RoleContextDocument = buildFixtureRcd({
      domain_matrix: {},
      dealbreakers: [],
      red_flags: [],
      conflicts: [],
      bars_overrides: [],
      technical_context: { stack: [], constructs: [], seniority_band: 'mid', codebase_expectations: [], dispositional_weights: {} },
      team_culture_profile: { per_stakeholder: {} },
    });
    const nodes = decomposeRcdIntoNodes(rcd, 'rc-test-1');
    expect(nodes).toEqual([]);
  });

  it('extracts all 11 node types from a fully-populated RCD', () => {
    const rcd = buildFixtureRcd();
    const nodes = decomposeRcdIntoNodes(rcd, 'rc-test-1');

    const types = new Set(nodes.map((n) => n.node_type));
    expect(types.has('Requirement')).toBe(true);
    expect(types.has('Responsibility')).toBe(true);
    expect(types.has('CulturalSignal')).toBe(true);
    expect(types.has('TeamContext')).toBe(true);
    expect(types.has('Dealbreaker')).toBe(true);
    expect(types.has('RedFlag')).toBe(true);
    expect(types.has('TechnicalContext')).toBe(true);
    expect(types.has('CodebaseExpectation')).toBe(true);
    expect(types.has('ProcessExpectation')).toBe(true);
    expect(types.has('Conflict')).toBe(true);
    expect(types.has('BarsOverride')).toBe(true);
  });

  it('produces no BarsOverride nodes when bars_overrides is empty', () => {
    const rcd = buildFixtureRcd({ bars_overrides: [] });
    const nodes = decomposeRcdIntoNodes(rcd, 'rc-test-1');
    expect(nodes.filter((n) => n.node_type === 'BarsOverride')).toHaveLength(0);
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('prefixes narrative_text with node type', () => {
    const rcd = buildFixtureRcd();
    const nodes = decomposeRcdIntoNodes(rcd, 'rc-test-1');
    for (const node of nodes) {
      expect(node.narrative_text.startsWith(`${node.node_type}: `)).toBe(true);
    }
  });

  it('assigns correct weights for must-have vs nice-to-have requirements', () => {
    const rcd = buildFixtureRcd();
    const nodes = decomposeRcdIntoNodes(rcd, 'rc-test-1');
    const reqs = nodes.filter((n) => n.node_type === 'Requirement');

    const mustHave = reqs.find((r) => r.narrative_text.includes('Must have shipped production GraphQL APIs'));
    const niceToHave = reqs.find((r) => r.narrative_text.includes('Nice to have TypeScript monorepo experience'));

    expect(mustHave?.weight).toBe(1.0);
    expect(niceToHave?.weight).toBe(0.5);
  });

  it('populates source_section with meaningful path strings', () => {
    const rcd = buildFixtureRcd();
    const nodes = decomposeRcdIntoNodes(rcd, 'rc-test-1');
    for (const node of nodes) {
      expect(node.source_section.length).toBeGreaterThan(0);
    }
  });

  it('extracts the correct number of TechnicalContext nodes for stack + constructs', () => {
    const rcd = buildFixtureRcd();
    const nodes = decomposeRcdIntoNodes(rcd, 'rc-test-1');
    const techNodes = nodes.filter((n) => n.node_type === 'TechnicalContext');
    expect(techNodes).toHaveLength(6); // 4 stack items + 2 constructs
  });
});
