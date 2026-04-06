import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callRoleAgent, mergeKnowledgeState } from '../lib/roleAgent';
import { buildRoleAgentSystemPrompt, buildRoleAgentUserMessage } from '../lib/roleAgentPrompts';

// ─── Mock fetch ─────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mistralResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── mergeKnowledgeState ───────────────────────────────────────────────────

describe('mergeKnowledgeState', () => {
  it('merges new domains into empty state', () => {
    const result = mergeKnowledgeState({}, {
      why: { origin: 'backfill', urgency: 'high' },
    });
    expect(result.why).toEqual({ origin: 'backfill', urgency: 'high' });
  });

  it('merges new keys into existing domain', () => {
    const existing = { why: { origin: 'backfill' } };
    const update = { why: { urgency: 'high' } };
    const result = mergeKnowledgeState(existing, update);
    expect(result.why).toEqual({ origin: 'backfill', urgency: 'high' });
  });

  it('overwrites existing keys with newer values', () => {
    const existing = { why: { origin: 'new' } };
    const update = { why: { origin: 'backfill' } };
    const result = mergeKnowledgeState(existing, update);
    expect(result.why).toEqual({ origin: 'backfill' });
  });

  it('preserves unrelated domains', () => {
    const existing = { work: { product: 'SaaS' } };
    const update = { team: { size: 6 } };
    const result = mergeKnowledgeState(existing, update);
    expect(result.work).toEqual({ product: 'SaaS' });
    expect(result.team).toEqual({ size: 6 });
  });

  it('handles empty update gracefully', () => {
    const existing = { why: { origin: 'new' } };
    const result = mergeKnowledgeState(existing, {});
    expect(result).toEqual(existing);
  });
});

// ─── buildRoleAgentSystemPrompt — participant role variants ────────────────

describe('buildRoleAgentSystemPrompt', () => {
  it('returns core prompt without participant role', () => {
    const prompt = buildRoleAgentSystemPrompt();
    expect(prompt).toContain('senior technical recruiting partner');
    expect(prompt).not.toContain('Your Interviewee');
  });

  it('includes hiring manager section', () => {
    const prompt = buildRoleAgentSystemPrompt('HIRING_MANAGER');
    expect(prompt).toContain('Your Interviewee: Hiring Manager');
    expect(prompt).toContain('Value-level laddering');
  });

  it('includes internal recruiter section', () => {
    const prompt = buildRoleAgentSystemPrompt('INTERNAL_RECRUITER');
    expect(prompt).toContain('Your Interviewee: Internal Recruiter');
    expect(prompt).toContain('What the HM emphasized');
  });

  it('includes external recruiter section', () => {
    const prompt = buildRoleAgentSystemPrompt('EXTERNAL_RECRUITER');
    expect(prompt).toContain('Your Interviewee: External Recruiter');
    expect(prompt).toContain('client brief');
  });

  it('includes team member section', () => {
    const prompt = buildRoleAgentSystemPrompt('TEAM_MEMBER');
    expect(prompt).toContain('Your Interviewee: Team Member');
    expect(prompt).toContain('ground truth for culture');
  });

  it('ignores unknown participant roles', () => {
    const prompt = buildRoleAgentSystemPrompt('UNKNOWN_ROLE');
    expect(prompt).not.toContain('Your Interviewee');
  });
});

// ─── buildRoleAgentUserMessage — knowledge state context ───────────────────

describe('buildRoleAgentUserMessage', () => {
  it('includes baseline data', () => {
    const msg = buildRoleAgentUserMessage({
      baseline: { title: 'Marketing Director' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 0,
      questionBudget: 10,
    });
    expect(msg).toContain('Marketing Director');
    expect(msg).toContain('BASELINE FORM DATA');
  });

  it('includes shared knowledge state when present', () => {
    const msg = buildRoleAgentUserMessage({
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: { team: { size: 6, culture_hm: 'async-first' } },
      questionsAsked: 0,
      questionBudget: 10,
    });
    expect(msg).toContain('Previously Established Facts');
    expect(msg).toContain('async-first');
  });

  it('omits knowledge state section when empty', () => {
    const msg = buildRoleAgentUserMessage({
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 0,
      questionBudget: 10,
    });
    expect(msg).not.toContain('Previously Established Facts');
  });

  it('includes budget exhaustion warning', () => {
    const msg = buildRoleAgentUserMessage({
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 9,
      questionBudget: 10,
    });
    expect(msg).toContain('Budget nearly exhausted');
  });

  it('signals synthesis when budget is zero', () => {
    const msg = buildRoleAgentUserMessage({
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 10,
      questionBudget: 10,
    });
    expect(msg).toContain('BUDGET EXHAUSTED');
  });
});

// ─── callRoleAgent — participant role passthrough ──────────────────────────

describe('callRoleAgent', () => {
  it('returns mock question when no API key', async () => {
    const result = await callRoleAgent({
      apiKey: '',
      baseline: { title: 'Designer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 0,
      questionBudget: 10,
    });
    expect(result.type).toBe('question');
    if (result.type === 'question') {
      expect(result.question.id).toBe('q-1');
    }
  });

  it('returns mock synthesis when budget exhausted and no API key', async () => {
    const result = await callRoleAgent({
      apiKey: '',
      baseline: { title: 'Designer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 10,
      questionBudget: 10,
    });
    expect(result.type).toBe('synthesis');
  });

  it('passes participantRole to system prompt', async () => {
    const agentJson = JSON.stringify({
      reasoning: 'test',
      acknowledgment: 'Got it.',
      question: { id: 'q-1', text: 'What does your team build?', input: { type: 'textarea' } },
      knowledgeStateUpdate: {},
      domainCoverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    });

    mockFetch.mockResolvedValueOnce(mistralResponse(agentJson));

    await callRoleAgent({
      apiKey: 'test-key',
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 0,
      questionBudget: 10,
      participantRole: 'HIRING_MANAGER',
    });

    // Verify the system prompt sent to Mistral includes the HM section
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const systemMsg = callBody.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).toContain('Your Interviewee: Hiring Manager');
  });

  it('parses a valid question response from Mistral', async () => {
    const agentJson = JSON.stringify({
      reasoning: 'Covering WHY domain first.',
      acknowledgment: 'Thanks for the context.',
      question: { id: 'q-2', text: 'Is this a new role or backfill?', input: { type: 'radio', options: ['New', 'Backfill'] } },
      knowledgeStateUpdate: { work: { product: 'messaging platform' } },
      domainCoverage: { why: 'sparse', work: 'partial', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    });

    mockFetch.mockResolvedValueOnce(mistralResponse(agentJson));

    const result = await callRoleAgent({
      apiKey: 'test-key',
      baseline: { title: 'Backend Engineer' },
      exchanges: [{ questionId: 'q-1', acknowledgment: 'Hi', question: 'What does your team build?', input: { type: 'textarea' }, answer: 'A messaging platform' }],
      knowledgeState: {},
      questionsAsked: 1,
      questionBudget: 10,
    });

    expect(result.type).toBe('question');
    if (result.type === 'question') {
      expect(result.question.id).toBe('q-2');
      expect(result.question.input.type).toBe('radio');
      expect(result.question.input.options).toEqual(['New', 'Backfill']);
      expect(result.knowledgeStateUpdate.work).toEqual({ product: 'messaging platform' });
    }
  });

  it('falls back to mock on Mistral API error', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

    const result = await callRoleAgent({
      apiKey: 'test-key',
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 0,
      questionBudget: 10,
    });

    // Should gracefully fall back to mock, not throw
    expect(result.type).toBe('question');
  });

  it('falls back to mock on malformed JSON response', async () => {
    mockFetch.mockResolvedValueOnce(mistralResponse('not valid json {{{'));

    const result = await callRoleAgent({
      apiKey: 'test-key',
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 0,
      questionBudget: 10,
    });

    expect(result.type).toBe('question');
  });
});
