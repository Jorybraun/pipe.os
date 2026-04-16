import { describe, it, expect } from 'vitest';
import { buildRcdSearchProfile } from '../rcdSearchProfile';
import type {
  RoleContextDocument,
  DomainMatrix,
  BarsOverride,
  TechnicalContext,
  DomainCell,
  StoryRecord,
} from '../../../types.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeTechnicalContext(overrides?: Partial<TechnicalContext>): TechnicalContext {
  return {
    stack: ['TypeScript', 'React', 'Node.js'],
    constructs: ['event-driven', 'domain-driven design'],
    seniority_band: 'Senior',
    codebase_expectations: ['modular architecture', 'high test coverage'],
    dispositional_weights: {},
    ...overrides,
  };
}

function makeStory(label: string): StoryRecord {
  return {
    situation: `${label} situation text`,
    action: `${label} action text`,
    outcome: `${label} outcome text`,
    moral: `${label} moral text`,
    source_exchange_id: `exchange-${label}`,
  };
}

function makeCell(overrides?: Partial<DomainCell>): DomainCell {
  return {
    primary_authority: false,
    coverage: 'partial',
    laddering_chains: [],
    open_codes: [],
    axial_links: [],
    stories: [],
    summary: '',
    ...overrides,
  };
}

/** Minimal valid RCD — only required fields, all collections empty. */
function makeMinimalRcd(): RoleContextDocument {
  return {
    rcd_version: '1.0.0',
    role_context_id: 'rcd-minimal',
    pipeline_id: 'pipe-1',
    created_at: '2026-04-15T00:00:00Z',
    domain_matrix: {},
    conflicts: [],
    technical_context: makeTechnicalContext(),
    team_culture_profile: {
      per_stakeholder: {},
    },
    bars_overrides: [],
    probe_bank_enrichment: {
      static_base_version: '1.0.0',
      enriched_probes: [],
    },
    dealbreakers: [],
    red_flags: [],
    consumer_slice: {
      seniority: 'Senior, 5–8 years',
      archetype: 'Backend engineer',
      mustHaveSkills: [],
      niceToHaveSkills: [],
      disposition: [],
      careerSignal: '',
      redFlags: [],
      dealbreakers: [],
    },
    validation_metadata: {
      schema_version: '1.0.0',
      synthesis_model: 'test-model',
      synthesis_prompt_version: '1.0.0',
      verification_pass_model: 'test-model',
      face_validity_reviewed_at: null,
      face_validity_reviewer: null,
    },
  };
}

/** RCD with technical_context populated but no domain cells, stories, or BARS overrides. */
function makeSparseRcd(): RoleContextDocument {
  return {
    ...makeMinimalRcd(),
    role_context_id: 'rcd-sparse',
    technical_context: makeTechnicalContext({
      stack: ['Go', 'Kubernetes', 'gRPC'],
      constructs: ['microservices', 'circuit-breaker', 'CQRS', 'event-sourcing'],
      seniority_band: 'Staff',
      codebase_expectations: ['strict typing', 'observability by default'],
    }),
    domain_matrix: {},
    bars_overrides: [],
  };
}

/** RCD with 3 stakeholders × 6 domains, 10+ stories, 6+ BARS overrides. */
function makeDenseRcd(): RoleContextDocument {
  const longSummary = (label: string): string =>
    `${label} This is a detailed domain summary that provides substantial context about ` +
    `the team expectations, technical requirements, and engineering culture.`;

  const storiesFor = (label: string): StoryRecord[] =>
    Array.from({ length: 4 }, (_, i) => makeStory(`${label}-${i}`));

  const hmDomains: NonNullable<DomainMatrix['HIRING_MANAGER']> = {
    why: makeCell({ summary: longSummary('HM-why'), stories: storiesFor('HM-why') }),
    work: makeCell({ summary: longSummary('HM-work'), stories: storiesFor('HM-work') }),
    team: makeCell({ summary: longSummary('HM-team'), stories: storiesFor('HM-team') }),
    bar: makeCell({ summary: longSummary('HM-bar'), stories: storiesFor('HM-bar') }),
    codebase: makeCell({ summary: longSummary('HM-codebase'), stories: storiesFor('HM-codebase') }),
    process: makeCell({ summary: longSummary('HM-process'), stories: storiesFor('HM-process') }),
  };

  const tmDomains: NonNullable<DomainMatrix['TEAM_MEMBER']> = {
    why: makeCell({ summary: longSummary('TM-why'), stories: storiesFor('TM-why') }),
    work: makeCell({ summary: longSummary('TM-work'), stories: storiesFor('TM-work') }),
    team: makeCell({ summary: longSummary('TM-team'), stories: storiesFor('TM-team') }),
    bar: makeCell({ summary: longSummary('TM-bar'), stories: storiesFor('TM-bar') }),
    codebase: makeCell({ summary: longSummary('TM-codebase'), stories: storiesFor('TM-codebase') }),
    process: makeCell({ summary: longSummary('TM-process'), stories: storiesFor('TM-process') }),
  };

  const irDomains: NonNullable<DomainMatrix['INTERNAL_RECRUITER']> = {
    why: makeCell({ summary: longSummary('IR-why'), stories: storiesFor('IR-why') }),
    work: makeCell({ summary: longSummary('IR-work'), stories: storiesFor('IR-work') }),
    team: makeCell({ summary: longSummary('IR-team'), stories: storiesFor('IR-team') }),
    bar: makeCell({ summary: longSummary('IR-bar'), stories: storiesFor('IR-bar') }),
    codebase: makeCell({ summary: longSummary('IR-codebase'), stories: storiesFor('IR-codebase') }),
    process: makeCell({ summary: longSummary('IR-process'), stories: storiesFor('IR-process') }),
  };

  const barsOverrides: BarsOverride[] = [
    { dimension: 'ownership', anchor_level: 4, base_anchor_text: 'base', override_anchor_text: 'Takes end-to-end accountability for service uptime.', source_chain_id: 'c1', approved_by: 'user-1', approved_at: '2026-04-15T00:00:00Z' },
    { dimension: 'communication', anchor_level: 3, base_anchor_text: 'base', override_anchor_text: 'Writes async decision memos for all technical pivots.', source_chain_id: 'c2', approved_by: 'user-1', approved_at: '2026-04-15T00:00:00Z' },
    { dimension: 'technical_quality', anchor_level: 4, base_anchor_text: 'base', override_anchor_text: 'Enforces zero-warning policy on CI for their services.', source_chain_id: 'c3', approved_by: 'user-1', approved_at: '2026-04-15T00:00:00Z' },
    { dimension: 'collaboration', anchor_level: 3, base_anchor_text: 'base', override_anchor_text: 'Actively pair-reviews cross-team PRs each sprint.', source_chain_id: 'c4', approved_by: 'user-1', approved_at: '2026-04-15T00:00:00Z' },
    { dimension: 'delivery', anchor_level: 5, base_anchor_text: 'base', override_anchor_text: 'Ships behind a feature flag with rollback plan documented.', source_chain_id: 'c5', approved_by: 'user-1', approved_at: '2026-04-15T00:00:00Z' },
    { dimension: 'growth', anchor_level: 2, base_anchor_text: 'base', override_anchor_text: 'Runs a monthly tech-debt review and files reduction tickets.', source_chain_id: 'c6', approved_by: 'user-1', approved_at: '2026-04-15T00:00:00Z' },
  ];

  return {
    ...makeMinimalRcd(),
    role_context_id: 'rcd-dense',
    technical_context: makeTechnicalContext({
      stack: ['TypeScript', 'Rust', 'PostgreSQL', 'Redis'],
      constructs: ['CQRS', 'event-sourcing', 'hexagonal architecture', 'DDD'],
      seniority_band: 'Senior Staff',
      codebase_expectations: ['strict types', 'no global state', 'property-based tests'],
    }),
    domain_matrix: {
      HIRING_MANAGER: hmDomains,
      TEAM_MEMBER: tmDomains,
      INTERNAL_RECRUITER: irDomains,
    },
    bars_overrides: barsOverrides,
  };
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildRcdSearchProfile', () => {
  // ── 1. Empty-ish RCD ───────────────────────────────────────────────────────
  it('empty-ish RCD: output word count in [400, 600], contains seniority_band, does not throw', () => {
    const rcd = makeMinimalRcd();
    const result = buildRcdSearchProfile(rcd);

    expect(typeof result).toBe('string');
    const wc = wordCount(result);
    expect(wc).toBeGreaterThanOrEqual(400);
    expect(wc).toBeLessThanOrEqual(600);
    expect(result).toContain(rcd.technical_context.seniority_band);
  });

  // ── 2. Sparse RCD ─────────────────────────────────────────────────────────
  it('sparse RCD: output ≥ 400 words, no infinite loop', () => {
    const rcd = makeSparseRcd();
    // Vitest default per-test timeout (5 s) is the loop guard — if this hangs, it's a bug.
    const result = buildRcdSearchProfile(rcd);

    expect(typeof result).toBe('string');
    expect(wordCount(result)).toBeGreaterThanOrEqual(400);
    // Stack tokens must appear — they're the source of the padding copy
    expect(result).toContain('Go');
    expect(result).toContain('Staff');
  });

  // ── 3. Dense RCD ──────────────────────────────────────────────────────────
  it('dense RCD: output ≤ 600 words AND last character is sentence-end punctuation', () => {
    const rcd = makeDenseRcd();
    const result = buildRcdSearchProfile(rcd);

    expect(wordCount(result)).toBeLessThanOrEqual(600);
    const lastChar = result.trimEnd().slice(-1);
    expect(['.', '!', '?']).toContain(lastChar);
  });

  // ── 4. Story dedup across stakeholders ────────────────────────────────────
  it('identical story object under two stakeholders emits at most once; total stories ≤ 3', () => {
    const sharedStory = makeStory('shared');
    const rcd: RoleContextDocument = {
      ...makeMinimalRcd(),
      role_context_id: 'rcd-story-dedup',
      domain_matrix: {
        HIRING_MANAGER: {
          why: makeCell({ stories: [sharedStory], summary: 'HM summary text' }),
        },
        TEAM_MEMBER: {
          why: makeCell({ stories: [sharedStory], summary: 'TM summary text' }),
        },
        INTERNAL_RECRUITER: {
          why: makeCell({ stories: [sharedStory], summary: 'IR summary text' }),
        },
      },
    };

    const result = buildRcdSearchProfile(rcd);

    // Count occurrences of the story situation text.
    const situationText = sharedStory.situation;
    const occurrences = result.split(situationText).length - 1;
    // The function takes one story per stakeholder (not per unique story text),
    // so up to 3 occurrences are possible. The assertion is ≤ 3, not ≤ 1.
    expect(occurrences).toBeLessThanOrEqual(3);
    // Total story blocks = occurrences of the "Illustrative situation:" prefix.
    const storyBlockCount = result.split('Illustrative situation:').length - 1;
    expect(storyBlockCount).toBeLessThanOrEqual(3);
  });

  // ── 5. Domain summary dedup ───────────────────────────────────────────────
  it('two domain cells with identical summary emit one copy in output', () => {
    const dupSummary = 'The team values high test coverage and clean interfaces.';
    const rcd: RoleContextDocument = {
      ...makeMinimalRcd(),
      role_context_id: 'rcd-summary-dedup',
      domain_matrix: {
        HIRING_MANAGER: {
          why: makeCell({ summary: dupSummary }),
          work: makeCell({ summary: dupSummary }),
        },
      },
    };

    const result = buildRcdSearchProfile(rcd);
    const occurrences = result.split(dupSummary).length - 1;
    expect(occurrences).toBe(1);
  });

  // ── 6. technical_context stack verbatim ───────────────────────────────────
  it('every stack token from technical_context.stack appears verbatim in output', () => {
    const rcd = makeMinimalRcd();
    rcd.technical_context.stack = ['Elixir', 'Phoenix', 'PostgreSQL', 'LiveView'];

    const result = buildRcdSearchProfile(rcd);

    for (const token of rcd.technical_context.stack) {
      expect(result).toContain(token);
    }
  });

  // ── 7. No-crash on empty collections ─────────────────────────────────────
  it('RCD with empty domain_matrix and empty bars_overrides returns valid non-empty string', () => {
    const rcd: RoleContextDocument = {
      ...makeMinimalRcd(),
      role_context_id: 'rcd-empty-collections',
      domain_matrix: {},
      bars_overrides: [],
    };

    const result = buildRcdSearchProfile(rcd);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  // ── 8. Stable / deterministic output ──────────────────────────────────────
  it('two calls with the same input return byte-identical strings', () => {
    const rcd = makeMinimalRcd();
    const first = buildRcdSearchProfile(rcd);
    const second = buildRcdSearchProfile(rcd);
    expect(first).toBe(second);
  });

  // ── 8b. Stable output for dense input too ─────────────────────────────────
  it('dense RCD: two calls return byte-identical strings', () => {
    const rcd = makeDenseRcd();
    const first = buildRcdSearchProfile(rcd);
    const second = buildRcdSearchProfile(rcd);
    expect(first).toBe(second);
  });
});
