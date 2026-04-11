/**
 * BDD for ADR-036 Phase 3 — code-review consumers reading the Role Context
 * Document (RCD) end-to-end.
 *
 * Scenario (from ADR-036 §Phase 3 acceptance sketch + P3.5 handoff):
 *   Given a role context with a seeded RCD (technical_context.stack,
 *     constructs, seniority_band, codebase_expectations, dispositional_weights,
 *     and a derived consumer_slice),
 *   When the code-review consumers — challenge generator prompts, content
 *     reviewer prompts, shared RCD loader, and the implementer persona prompt
 *     builder — run against that RCD,
 *   Then the generator system prompt emphasizes the RCD stack + codebase
 *     expectations + dispositional traits instead of the flat consumer_slice,
 *     the content review prompt carries the same codebase context forward,
 *     the shared loader resolves the assessment → stages → role_contexts
 *     chain to the parsed RCD (and returns null on any miss without throwing),
 *     and the implementer persona gains a natural-language team-disposition
 *     addendum whose direction tracks the sign of the dispositional weights.
 *
 * This file mirrors the culturePhase2.test.ts pattern: exercise the real
 * resolver + prompt builders against an in-memory D1 stub, not miniflare.
 * Scorer-side weight application is already locked by
 * scorerDispositional.test.ts and is not re-tested here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

import { loadRcdForAssessment } from '../lib/rcd';
import {
  buildGeneratorSystemPrompt,
  buildGeneratorUserMessage,
  buildContentReviewPrompt,
} from '../lib/challengeGeneration/prompts';
import { buildImplementerSystemPrompt, buildDispositionalAddendum } from '../lib/prompts';
import type { CandidatePersona, RoleContextDocument } from '../types';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_PERSONA: CandidatePersona = {
  seniority: 'mid-level, 3-5 years',
  archetype: 'Backend Engineer',
  mustHaveSkills: ['Python', 'Django', 'PostgreSQL'],
  niceToHaveSkills: ['Kubernetes'],
  disposition: ['pragmatic'],
  careerSignal: 'has shipped a greenfield backend service',
  redFlags: [],
  dealbreakers: [],
};

function buildMockRcd(overrides: Partial<RoleContextDocument> = {}): RoleContextDocument {
  const base: RoleContextDocument = {
    rcd_version: 'rcd-v1',
    role_context_id: 'rc-test-phase3',
    pipeline_id: 'pipe-phase3',
    created_at: '2026-04-11T00:00:00Z',
    domain_matrix: {},
    conflicts: [],
    technical_context: {
      stack: ['TypeScript', 'Hono', 'Cloudflare Workers'],
      constructs: ['edge_runtime', 'd1_sqlite'],
      seniority_band: 'senior',
      codebase_expectations: [
        'monorepo with shared worker package',
        'thin route handlers, logic in /lib',
        'strict TypeScript, no any',
      ],
      dispositional_weights: {
        pragmatism: 1.4,
        rigor: 0.7,
        communication: 1.1,
      },
    },
    team_culture_profile: { per_stakeholder: {} },
    bars_overrides: [],
    probe_bank_enrichment: { static_base_version: 'v1', enriched_probes: [] },
    dealbreakers: [],
    red_flags: [],
    consumer_slice: {
      seniority: 'senior',
      archetype: 'Edge Platform Engineer',
      mustHaveSkills: ['TypeScript', 'Hono'],
      niceToHaveSkills: ['Cloudflare Workers'],
      disposition: ['pragmatic'],
      careerSignal: 'has shipped an edge runtime service',
      redFlags: [],
      dealbreakers: [],
    },
    validation_metadata: {
      schema_version: 'rcd-v1',
      synthesis_model: 'mock-gemma',
      synthesis_prompt_version: 'rcd-synthesis-v1',
      verification_pass_model: 'mock-gemma',
      face_validity_reviewed_at: null,
      face_validity_reviewer: null,
    },
  };
  return { ...base, ...overrides };
}

// ─── D1 stub ────────────────────────────────────────────────────────────────

interface StubRow {
  [key: string]: unknown;
}

/**
 * Minimal D1Database stub matching on SQL prefix — the loader under test
 * runs a single JOIN query; we only need to answer that one.
 */
function buildStubDb(config: {
  rcdJoinRow: StubRow | null;
  shouldThrow?: boolean;
}): D1Database {
  const prepare = (sql: string): unknown => {
    const statement = {
      bind: (..._args: unknown[]) => ({
        first: async <T>(): Promise<T | null> => {
          if (config.shouldThrow) {
            throw new Error('simulated D1 failure');
          }
          if (sql.includes('role_contexts') && sql.includes('assessments')) {
            return (config.rcdJoinRow as T | null) ?? null;
          }
          return null;
        },
        all: async <T>(): Promise<{ results: T[] }> => ({ results: [] }),
        run: async () => ({ success: true }),
      }),
    };
    return statement;
  };
  return { prepare } as unknown as D1Database;
}

// ─── 1. loadRcdForAssessment ────────────────────────────────────────────────

describe('loadRcdForAssessment', () => {
  it('resolves the assessments → stages → role_contexts chain and parses rcd_json', async () => {
    const rcd = buildMockRcd();
    const db = buildStubDb({
      rcdJoinRow: { rcd_json: JSON.stringify(rcd) },
    });

    const result = await loadRcdForAssessment(db, 'assessment-happy');

    expect(result).not.toBeNull();
    expect(result!.rcd_version).toBe('rcd-v1');
    expect(result!.role_context_id).toBe('rc-test-phase3');
    expect(result!.technical_context.stack).toEqual(['TypeScript', 'Hono', 'Cloudflare Workers']);
    expect(result!.technical_context.dispositional_weights).toEqual({
      pragmatism: 1.4,
      rigor: 0.7,
      communication: 1.1,
    });
  });

  it('returns null when the JOIN yields no row (migration window — no RCD yet)', async () => {
    const db = buildStubDb({ rcdJoinRow: null });
    const result = await loadRcdForAssessment(db, 'assessment-legacy');
    expect(result).toBeNull();
  });

  it('returns null when rcd_json is present but null on the row', async () => {
    const db = buildStubDb({ rcdJoinRow: { rcd_json: null } });
    const result = await loadRcdForAssessment(db, 'assessment-null-json');
    expect(result).toBeNull();
  });

  it('never throws on D1 failure — consumers must not break the assessment path', async () => {
    const db = buildStubDb({ rcdJoinRow: null, shouldThrow: true });
    const result = await loadRcdForAssessment(db, 'assessment-d1-down');
    expect(result).toBeNull();
  });
});

// ─── 2. Generator system prompt — RCD path ──────────────────────────────────

describe('buildGeneratorSystemPrompt (RCD path)', () => {
  const config = {
    types: ['CODE_IMPLEMENTATION'] as const,
    count: 3,
    seniority: 'SENIOR' as const,
  };

  it('uses RCD technical_context fields instead of the flat persona when an RCD is present', () => {
    const rcd = buildMockRcd();
    const prompt = buildGeneratorSystemPrompt(MOCK_PERSONA, { ...config, types: [...config.types] }, rcd);

    // Stack is sourced from the RCD, not persona.mustHaveSkills
    expect(prompt).toContain('TypeScript');
    expect(prompt).toContain('Hono');
    expect(prompt).toContain('Cloudflare Workers');
    expect(prompt).not.toContain('Django');
    expect(prompt).not.toContain('PostgreSQL');

    // Seniority band from RCD, not the persona's free-text seniority
    expect(prompt).toContain('Seniority: senior');

    // Constructs surface under the nice-to-have slot when present
    expect(prompt).toContain('edge_runtime');
    expect(prompt).toContain('d1_sqlite');
  });

  it('surfaces codebase_expectations as an explicit codebase-context block', () => {
    const rcd = buildMockRcd();
    const prompt = buildGeneratorSystemPrompt(MOCK_PERSONA, { ...config, types: [...config.types] }, rcd);

    expect(prompt).toContain('Codebase expectations');
    expect(prompt).toContain('monorepo with shared worker package');
    expect(prompt).toContain('thin route handlers, logic in /lib');
    expect(prompt).toContain('strict TypeScript, no any');
  });

  it('surfaces the top-weighted dispositional traits with emphasize/de-emphasize direction', () => {
    const rcd = buildMockRcd();
    const prompt = buildGeneratorSystemPrompt(MOCK_PERSONA, { ...config, types: [...config.types] }, rcd);

    expect(prompt).toContain('Dispositional emphasis');
    // pragmatism has the largest |weight| (1.4 > 1.1 > 0.7) — positive sign → emphasize
    expect(prompt).toMatch(/pragmatism \(emphasize\)/);
    // rigor has a magnitude (0.7) but is positive — "emphasize" since weight > 0
    // The helper tests sign of the raw weight, not distance from 1.0.
    // Weights are multipliers here, all > 0 → all "emphasize"
    expect(prompt).toMatch(/rigor \(emphasize\)/);
    expect(prompt).toMatch(/communication \(emphasize\)/);
  });

  it('falls back to persona fields when the RCD is absent (null)', () => {
    const prompt = buildGeneratorSystemPrompt(MOCK_PERSONA, { ...config, types: [...config.types] }, null);

    expect(prompt).toContain('Python');
    expect(prompt).toContain('Django');
    expect(prompt).toContain('PostgreSQL');
    expect(prompt).toContain('Seniority: mid-level, 3-5 years');
    expect(prompt).not.toContain('Codebase expectations');
    expect(prompt).not.toContain('Dispositional emphasis');
  });

  it('falls back to persona fields when the RCD has empty technical_context arrays', () => {
    const rcd = buildMockRcd({
      technical_context: {
        stack: [],
        constructs: [],
        seniority_band: '',
        codebase_expectations: [],
        dispositional_weights: {},
      },
    });
    const prompt = buildGeneratorSystemPrompt(MOCK_PERSONA, { ...config, types: [...config.types] }, rcd);

    // Stack falls back to persona.mustHaveSkills
    expect(prompt).toContain('Python');
    expect(prompt).toContain('Django');
    // Seniority falls back to persona.seniority
    expect(prompt).toContain('mid-level, 3-5 years');
    // No codebase / dispositional blocks emitted
    expect(prompt).not.toContain('Codebase expectations');
    expect(prompt).not.toContain('Dispositional emphasis');
  });
});

// ─── 3. Generator user message — codebase hint ──────────────────────────────

describe('buildGeneratorUserMessage (RCD path)', () => {
  it('injects a codebase hint from codebase_expectations when the RCD is present', () => {
    const rcd = buildMockRcd();
    const msg = buildGeneratorUserMessage(MOCK_PERSONA, rcd);

    expect(msg).toContain('The codebase is characterized by');
    expect(msg).toContain('monorepo with shared worker package');
    // Skills list from RCD stack, not persona
    expect(msg).toContain('TypeScript');
    expect(msg).not.toContain('Django');
  });

  it('omits the codebase hint when the RCD is absent', () => {
    const msg = buildGeneratorUserMessage(MOCK_PERSONA, null);
    expect(msg).not.toContain('The codebase is characterized by');
    expect(msg).toContain('Python');
  });

  it('caps the codebase hint at the first three expectations', () => {
    const rcd = buildMockRcd({
      technical_context: {
        stack: ['TypeScript'],
        constructs: [],
        seniority_band: 'senior',
        codebase_expectations: ['exp-1', 'exp-2', 'exp-3', 'exp-4', 'exp-5'],
        dispositional_weights: {},
      },
    });
    const msg = buildGeneratorUserMessage(MOCK_PERSONA, rcd);
    expect(msg).toContain('exp-1');
    expect(msg).toContain('exp-2');
    expect(msg).toContain('exp-3');
    expect(msg).not.toContain('exp-4');
    expect(msg).not.toContain('exp-5');
  });
});

// ─── 4. Content review prompt — RCD path ────────────────────────────────────

describe('buildContentReviewPrompt (RCD path)', () => {
  const emptyChallenges = [
    {
      type: 'CODE_IMPLEMENTATION' as const,
      title: 'Test',
      instructions: 'Implement x',
      difficulty: 'SENIOR' as const,
      primarySkill: 'TypeScript',
      secondarySkills: [],
      bloomLevel: 'apply' as const,
      estimatedMinutes: 30,
      config: {},
      reasoning: 'mock',
    },
  ];

  it('carries the codebase context block into the reviewer prompt', () => {
    const rcd = buildMockRcd();
    const prompt = buildContentReviewPrompt(emptyChallenges, MOCK_PERSONA, rcd);

    expect(prompt).toContain('Codebase expectations');
    expect(prompt).toContain('monorepo with shared worker package');
    // Reviewer sees the RCD stack, not persona skills
    expect(prompt).toContain('TypeScript');
    expect(prompt).not.toContain('Django');
  });

  it('falls back to persona fields when RCD is absent', () => {
    const prompt = buildContentReviewPrompt(emptyChallenges, MOCK_PERSONA, null);
    expect(prompt).toContain('Python');
    expect(prompt).toContain('Django');
    expect(prompt).not.toContain('Codebase expectations');
  });
});

// ─── 5. Implementer system prompt — dispositional addendum ──────────────────

describe('buildImplementerSystemPrompt (dispositional addendum)', () => {
  const PR_BRIEF = 'Add a /health endpoint returning 200 OK';
  const PR_DIFF = '+ app.get("/health", (c) => c.json({ ok: true }));';

  it('prepends a team-disposition addendum when weights are present', () => {
    const prompt = buildImplementerSystemPrompt('senior', PR_BRIEF, PR_DIFF, {
      pragmatism: 1.4,
      rigor: 0.7,
      communication: 1.1,
    });

    expect(prompt).toContain('TEAM DISPOSITION');
    // pragmatism > 1 → "high" bucket ("values pragmatism")
    expect(prompt).toContain('values pragmatism');
    // rigor < 1 → "low" bucket
    expect(prompt).toContain('values delivery over exhaustive rigor');
    // communication > 1 → "high" bucket
    expect(prompt).toContain('values communication');
  });

  it('omits the addendum entirely when no weights are supplied', () => {
    const prompt = buildImplementerSystemPrompt('senior', PR_BRIEF, PR_DIFF);
    expect(prompt).not.toContain('TEAM DISPOSITION');
  });

  it('omits the addendum when every weight equals the baseline 1.0', () => {
    const prompt = buildImplementerSystemPrompt('senior', PR_BRIEF, PR_DIFF, {
      pragmatism: 1.0,
      rigor: 1.0,
      communication: 1.0,
    });
    expect(prompt).not.toContain('TEAM DISPOSITION');
  });

  it('never surfaces raw numeric multipliers to the model', () => {
    const prompt = buildImplementerSystemPrompt('senior', PR_BRIEF, PR_DIFF, {
      pragmatism: 1.4,
      rigor: 0.7,
    });
    // The addendum must bucket into qualitative labels, not leak numbers
    expect(prompt).not.toContain('1.4');
    expect(prompt).not.toContain('0.7');
  });

  it('still includes the chosen persona text alongside the addendum', () => {
    const juniorPrompt = buildImplementerSystemPrompt('junior', PR_BRIEF, PR_DIFF, { pragmatism: 1.4 });
    const seniorPrompt = buildImplementerSystemPrompt('senior', PR_BRIEF, PR_DIFF, { pragmatism: 1.4 });

    expect(juniorPrompt).toContain('Jamie Torres');
    expect(juniorPrompt).toContain('junior developer');
    expect(seniorPrompt).toContain('Maya Chen');
    expect(seniorPrompt).toContain('senior developer');
  });

  it('ignores unknown trait keys without crashing', () => {
    const prompt = buildImplementerSystemPrompt('senior', PR_BRIEF, PR_DIFF, {
      pragmatism: 1.4,
      mystery_trait: 2.0,
    });
    expect(prompt).toContain('values pragmatism');
    expect(prompt).not.toContain('mystery_trait');
  });
});

// ─── 6. Dispositional addendum helper — direct unit coverage ────────────────

describe('buildDispositionalAddendum', () => {
  it('returns empty string for undefined, empty object, or all-baseline weights', () => {
    expect(buildDispositionalAddendum(undefined)).toBe('');
    expect(buildDispositionalAddendum({})).toBe('');
    expect(buildDispositionalAddendum({ pragmatism: 1, rigor: 1, communication: 1 })).toBe('');
  });

  it('skips non-finite weights (NaN, Infinity) without crashing', () => {
    const addendum = buildDispositionalAddendum({
      pragmatism: Number.NaN,
      rigor: Number.POSITIVE_INFINITY,
      communication: 1.2,
    });
    // Only the communication trait emits — the other two are silently skipped
    expect(addendum).toContain('values communication');
    expect(addendum).not.toContain('values pragmatism');
    expect(addendum).not.toContain('values delivery');
  });

  it('emits one bullet per non-baseline trait', () => {
    const addendum = buildDispositionalAddendum({ pragmatism: 1.3, rigor: 0.8 });
    const bulletCount = (addendum.match(/- The team/g) ?? []).length;
    expect(bulletCount).toBe(2);
  });
});
