import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { roleContexts } from '../routes/discovery/roleContexts';
import type { Env, Variables, RoleContextRow, RoleContextParticipantRow, RoleContextDocument } from '../types';
import type { D1Database } from '@cloudflare/workers-types';

vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'test-user');
    await next();
  },
}));

vi.mock('../lib/agents/calibration/gapFilling', () => ({
  callGapFillingAgent: vi.fn(),
}));

vi.mock('../lib/roleAgent/calibrateRcd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/roleAgent/calibrateRcd')>();
  return {
    ...actual,
    calibrateRcd: vi.fn(),
  };
});

vi.mock('../lib/roleAgent/deriveJobDescription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/roleAgent/deriveJobDescription')>();
  return {
    ...actual,
    deriveJobDescriptionFromRcd: vi.fn((_rcd: RoleContextDocument, fallbackTitle?: string) =>
      fallbackTitle || 'Engineering Role',
    ),
  };
});

vi.mock('../lib/llm/createProvider', () => ({
  createRoleAgentProvider: vi.fn(() => null),
}));

import { callGapFillingAgent } from '../lib/agents/calibration/gapFilling';
import { calibrateRcd } from '../lib/roleAgent/calibrateRcd';

// ─── D1 stub ─────────────────────────────────────────────────────────────────

interface StubConfig {
  roleContextRow: RoleContextRow | null;
  participantRow: RoleContextParticipantRow | null;
}

function buildStubDb(config: StubConfig): D1Database {
  const prepare = (sql: string): unknown => {
    const statement = {
      bind: (..._args: unknown[]) => ({
        first: async <T>(): Promise<T | null> => {
          if (sql.includes('role_contexts') && !sql.includes('participants')) {
            return (config.roleContextRow as T | null) ?? null;
          }
          if (sql.includes('role_context_participants')) {
            return (config.participantRow as T | null) ?? null;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/api/v1/role-contexts', roleContexts);
  return app;
}

function buildRoleContextRow(overrides: Partial<RoleContextRow> = {}): RoleContextRow {
  return {
    id: 'rc-1',
    owner_id: 'test-user',
    pipeline_id: null,
    baseline: JSON.stringify({ title: 'Senior Engineer' }),
    question_budget: 8,
    questions_asked: 0,
    status: 'COMPLETE',
    knowledge_state: '{}',
    exchanges: '[]',
    persona_json: null,
    job_description_md: null,
    rcd_version: null,
    rcd_json: null,
    validation_metadata: null,
    bars_overrides: null,
    recruitment_brief_json: null,
    created_at: '2026-04-10T00:00:00Z',
    updated_at: '2026-04-10T00:00:00Z',
    ...overrides,
  } as RoleContextRow;
}

function buildParticipantRow(overrides: Partial<RoleContextParticipantRow> = {}): RoleContextParticipantRow {
  return {
    id: 'p-1',
    role_context_id: 'rc-1',
    is_creator: 1,
    name: null,
    email: null,
    participant_role: 'HIRING_MANAGER',
    question_budget: 8,
    questions_asked: 0,
    status: 'COMPLETE',
    exchanges: '[]',
    invite_token: null,
    created_at: '2026-04-10T00:00:00Z',
    updated_at: '2026-04-10T00:00:00Z',
    ...overrides,
  } as RoleContextParticipantRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── POST /:id/calibrate ─────────────────────────────────────────────────────

describe('POST /api/v1/role-contexts/:id/calibrate', () => {
  it('validates body against calibrateSchema and returns clarifying question', async () => {
    vi.mocked(callGapFillingAgent).mockResolvedValue({
      clarifyingQuestion: 'What specific technical skills are required?',
    });

    const db = buildStubDb({
      roleContextRow: buildRoleContextRow(),
      participantRow: buildParticipantRow(),
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          flagType: 'missing_detail',
          gapType: 'attribute',
          domain: 'bar',
          attribute: 'technical_depth',
          note: 'Need more info',
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { clarifyingQuestion: string; domain: string; attribute: string };
    expect(body.clarifyingQuestion).toBe('What specific technical skills are required?');
    expect(body.domain).toBe('bar');
    expect(body.attribute).toBe('technical_depth');
  });

  it('returns 422 when body fails calibrateSchema validation', async () => {
    const db = buildStubDb({
      roleContextRow: buildRoleContextRow(),
      participantRow: buildParticipantRow(),
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          // missing flagType, gapType, domain, attribute
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when role context not found', async () => {
    const db = buildStubDb({
      roleContextRow: null,
      participantRow: buildParticipantRow(),
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          flagType: 'missing_detail',
          gapType: 'attribute',
          domain: 'bar',
          attribute: 'technical_depth',
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(404);
  });

  it('returns 404 when participant not found', async () => {
    const db = buildStubDb({
      roleContextRow: buildRoleContextRow(),
      participantRow: null,
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          flagType: 'missing_detail',
          gapType: 'attribute',
          domain: 'bar',
          attribute: 'technical_depth',
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(404);
  });

  it('returns 403 when user does not own the role context', async () => {
    const db = buildStubDb({
      roleContextRow: buildRoleContextRow({ owner_id: 'other-user' }),
      participantRow: buildParticipantRow(),
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          flagType: 'missing_detail',
          gapType: 'attribute',
          domain: 'bar',
          attribute: 'technical_depth',
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(403);
  });
});

// ─── POST /:id/calibrate/respond ─────────────────────────────────────────────

describe('POST /api/v1/role-contexts/:id/calibrate/respond', () => {
  it('receives answer, re-synthesizes cell, and persists updated RCD to D1', async () => {
    const mockUpdatedCell = {
      primary_authority: true,
      coverage: 'deep' as const,
      laddering_chains: [
        {
          attribute_quote: 'q',
          source_exchange_id: 'id',
          consequence: 'c',
          value: 'v',
          energy_signal: 'high' as const,
          confidence: 'high' as const,
        },
      ],
      open_codes: ['oc'],
      axial_links: [],
      stories: [],
      summary: 'Updated cell summary',
    };

    const mockRcd: RoleContextDocument = {
      rcd_version: 'rcd-v1',
      role_context_id: 'rc-1',
      pipeline_id: 'pipe-1',
      created_at: '2026-04-10T00:00:00Z',
      domain_matrix: { HIRING_MANAGER: { bar: mockUpdatedCell } },
      conflicts: [],
      technical_context: { stack: [], constructs: [], seniority_band: 'senior', codebase_expectations: [], dispositional_weights: {} },
      team_culture_profile: { per_stakeholder: {} },
      bars_overrides: [],
      probe_bank_enrichment: { static_base_version: 'v1', enriched_probes: [] },
      dealbreakers: [],
      red_flags: [],
      consumer_slice: {
        seniority: 'senior',
        archetype: 'Engineer',
        mustHaveSkills: [],
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

    vi.mocked(calibrateRcd).mockResolvedValue({
      rcd: mockRcd,
      updatedCell: mockUpdatedCell,
    });

    const db = buildStubDb({
      roleContextRow: buildRoleContextRow({
        rcd_json: JSON.stringify(mockRcd),
      }),
      participantRow: buildParticipantRow(),
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate/respond',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          answer: 'We need deep React expertise',
          domain: 'bar',
          attribute: 'technical_depth',
          flagType: 'missing_detail',
          note: 'Clarifying note',
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { updatedCell: typeof mockUpdatedCell; rcd: unknown };
    expect(body.updatedCell.summary).toBe('Updated cell summary');
    expect(body.rcd).toBeDefined();
  });

  it('returns 422 when required fields are missing', async () => {
    const db = buildStubDb({
      roleContextRow: buildRoleContextRow(),
      participantRow: buildParticipantRow(),
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate/respond',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          // missing answer, domain, attribute
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 when no RCD exists for the role context', async () => {
    const db = buildStubDb({
      roleContextRow: buildRoleContextRow({ rcd_json: null }),
      participantRow: buildParticipantRow(),
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate/respond',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          answer: 'We need deep React expertise',
          domain: 'bar',
          attribute: 'technical_depth',
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('No RCD exists');
  });

  it('returns 404 when role context not found', async () => {
    const db = buildStubDb({
      roleContextRow: null,
      participantRow: buildParticipantRow(),
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate/respond',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          answer: 'We need deep React expertise',
          domain: 'bar',
          attribute: 'technical_depth',
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(404);
  });

  it('returns 404 when participant not found', async () => {
    const db = buildStubDb({
      roleContextRow: buildRoleContextRow({
        rcd_json: JSON.stringify({
          rcd_version: 'rcd-v1',
          role_context_id: 'rc-1',
          pipeline_id: 'pipe-1',
          created_at: '2026-04-10T00:00:00Z',
          domain_matrix: {},
          conflicts: [],
          technical_context: { stack: [], constructs: [], seniority_band: 'senior', codebase_expectations: [], dispositional_weights: {} },
          team_culture_profile: { per_stakeholder: {} },
          bars_overrides: [],
          probe_bank_enrichment: { static_base_version: 'v1', enriched_probes: [] },
          dealbreakers: [],
          red_flags: [],
          consumer_slice: { seniority: 'senior', archetype: 'Engineer', mustHaveSkills: [], niceToHaveSkills: [], disposition: [], careerSignal: '', redFlags: [], dealbreakers: [] },
          validation_metadata: { schema_version: 'rcd-v1', synthesis_model: 'mock', synthesis_prompt_version: 'v1', verification_pass_model: 'mock', face_validity_reviewed_at: null, face_validity_reviewer: null },
        }),
      }),
      participantRow: null,
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate/respond',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          answer: 'We need deep React expertise',
          domain: 'bar',
          attribute: 'technical_depth',
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(404);
  });

  it('returns 403 when user does not own the role context', async () => {
    const db = buildStubDb({
      roleContextRow: buildRoleContextRow({ owner_id: 'other-user' }),
      participantRow: buildParticipantRow(),
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/calibrate/respond',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
        body: JSON.stringify({
          participantId: 'p-1',
          answer: 'We need deep React expertise',
          domain: 'bar',
          attribute: 'technical_depth',
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(403);
  });
});
