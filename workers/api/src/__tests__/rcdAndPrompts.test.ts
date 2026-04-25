/**
 * Tests for still-existing modules previously covered by codeReviewPhase3.test.ts.
 * Extracted after challengeGeneration code was removed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

import { loadRcdForAssessment } from '../lib/rcd';
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

// ─── D1 stub ─────────────────────────────────────────────────────────────────

interface StubRow {
  [key: string]: unknown;
}

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

// ─── 1. loadRcdForAssessment ─────────────────────────────────────────────────

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

// ─── 2. Implementer system prompt — dispositional addendum ───────────────────

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
    expect(prompt).toContain('values pragmatism');
    expect(prompt).toContain('values delivery over exhaustive rigor');
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

// ─── 3. Dispositional addendum helper ─ direct unit coverage ─────────────────

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
