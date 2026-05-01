import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { roleContexts } from '../roleContexts';
import type { Env, Variables, RoleContextRow, RoleContextParticipantRow } from '../../../types';
import type { D1Database } from '@cloudflare/workers-types';
import type { GeneratedQuestion } from '../../../lib/agents/question/generator';

vi.mock('../../../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'test-user');
    await next();
  },
}));

vi.mock('../../../lib/agents/question/generator', () => ({
  generateQuestion: vi.fn(),
  generateQuestionBatch: vi.fn(),
  generateQuestionStream: vi.fn(),
}));

vi.mock('../../../lib/agents/question/eval', () => ({
  evaluateQuestion: vi.fn(),
}));

vi.mock('../../../lib/llm/createProvider', () => ({
  createRoleAgentProvider: vi.fn(() => ({ name: 'mock' })),
}));

import { generateQuestionStream, generateQuestion, generateQuestionBatch } from '../../../lib/agents/question/generator';
import { evaluateQuestion } from '../../../lib/agents/question/eval';

// ─── D1 stub ─────────────────────────────────────────────────────────────────

interface StubConfig {
  roleContextRow: RoleContextRow | null;
  participantRows: RoleContextParticipantRow[];
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
            return (config.participantRows[0] as T | null) ?? null;
          }
          return null;
        },
        all: async <T>(): Promise<{ results: T[] }> => {
          if (sql.includes('role_context_participants')) {
            return { results: config.participantRows as T[] };
          }
          return { results: [] as T[] };
        },
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
    status: 'INTERVIEWING',
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
    status: 'INTERVIEWING',
    exchanges: '[]',
    invite_token: null,
    created_at: '2026-04-10T00:00:00Z',
    updated_at: '2026-04-10T00:00:00Z',
    ...overrides,
  } as RoleContextParticipantRow;
}

function makeGeneratedQuestion(): GeneratedQuestion {
  return {
    reasoning: 'Test reasoning',
    acknowledgment: 'Test acknowledgment',
    question: {
      id: 'q-1',
      text: 'What is the team size?',
      goal: 'Establish team context',
      expectedCoverage: { domain: 'team', from: 'none', to: 'sparse' },
      probeAlignment: 'none',
      questionType: 'introductory',
      input: { type: 'text', placeholder: 'e.g. 5 engineers' },
      suggestedAnswers: ['3', '8', '15'],
    },
    knowledgeStateUpdate: { team: { size: 6 } },
    domainCoverage: { why: 'none', work: 'none', team: 'sparse', bar: 'none', codebase: 'none', process: 'none' },
  };
}

/** Parse SSE stream into array of { event, data } objects */
async function parseSSE(response: Response): Promise<Array<{ event: string; data: string }>> {
  const body = await response.text();
  const events: Array<{ event: string; data: string }> = [];
  const blocks = body.trim().split('\n\n');
  for (const block of blocks) {
    const lines = block.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice(5).trim();
      }
    }
    events.push({ event, data });
  }
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── POST /:id/question ──────────────────────────────────────────────────────

describe('POST /api/v1/role-contexts/:id/question', () => {
  it('streams SSE when Accept: text/event-stream is sent', async () => {
    const question = makeGeneratedQuestion();

    // Mock generateQuestionStream as an async iterator
    vi.mocked(generateQuestionStream).mockReturnValue({
      async next() {
        // First call yields a chunk, second call returns done with the result
        const mockFn = vi.mocked(generateQuestionStream).mock;
        const callCount = mockFn.calls.length;
        // We need stateful tracking — simpler to use a closure counter
        return { done: true, value: question } as IteratorResult<GeneratedQuestion, string>;
      },
    } as unknown as AsyncGenerator<string, GeneratedQuestion, unknown>);

    // Use a real async generator for the mock
    let yielded = false;
    vi.mocked(generateQuestionStream).mockImplementation(() => {
      return (async function* () {
        if (!yielded) {
          yielded = true;
          yield '{"partial": true';
          yield ',"more": true}';
        }
        return question;
      })() as unknown as AsyncGenerator<string, GeneratedQuestion, unknown>;
    });

    vi.mocked(evaluateQuestion).mockResolvedValue({ approved: true, dimensions: [] });

    const db = buildStubDb({
      roleContextRow: buildRoleContextRow(),
      participantRows: [buildParticipantRow()],
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/question',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: 'Bearer fake-token',
        },
        body: JSON.stringify({
          state: {
            baseline: { title: 'Senior Engineer' },
            participantRole: 'HIRING_MANAGER',
            questionBudget: 8,
            exchanges: [],
            knowledgeState: {},
            coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
            phase: 'CONTEXT',
            questionsAsked: 0,
            synthesisReady: false,
          },
          enableEval: true,
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');

    const events = await parseSSE(res);
    const chunkEvents = events.filter((e) => e.event === 'chunk');
    const doneEvents = events.filter((e) => e.event === 'done');

    expect(chunkEvents.length).toBeGreaterThanOrEqual(1);
    expect(doneEvents.length).toBe(1);

    const doneData = JSON.parse(doneEvents[0].data);
    expect(doneData.question.text).toBe('What is the team size?');
  });

  it('returns JSON when Accept header is missing', async () => {
    const question = makeGeneratedQuestion();
    vi.mocked(generateQuestionBatch).mockResolvedValue([question]);
    vi.mocked(evaluateQuestion).mockResolvedValue({ approved: true, dimensions: [] });

    const db = buildStubDb({
      roleContextRow: buildRoleContextRow(),
      participantRows: [buildParticipantRow()],
    });

    const app = buildApp();

    const res = await app.request(
      '/api/v1/role-contexts/rc-1/question',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer fake-token',
        },
        body: JSON.stringify({
          state: {
            baseline: { title: 'Senior Engineer' },
            participantRole: 'HIRING_MANAGER',
            questionBudget: 8,
            exchanges: [],
            knowledgeState: {},
            coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
            phase: 'CONTEXT',
            questionsAsked: 0,
            synthesisReady: false,
          },
          enableEval: true,
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = (await res.json()) as GeneratedQuestion;
    expect(body.question.text).toBe('What is the team size?');
  });
});
