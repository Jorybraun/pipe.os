import { describe, it, expect, vi } from 'vitest';
import { evaluateQuestion, DEFAULT_EVAL_DIMENSIONS } from '../eval';
import type { InterviewState } from '../../interview/types';
import type { GeneratedQuestion } from '../generator';
import type { LLMProvider } from '../../../llm/types';

// ─── Mock provider ───────────────────────────────────────────────────────────

function makeMockProvider(responses: Record<string, string>): LLMProvider {
  return {
    name: 'mock',
    supportsTools: false,
    complete: vi.fn().mockImplementation((_messages) => {
      // Each dimension call gets the same mock — we vary by inspecting calls
      // For simplicity, return a generic pass response
      const content = JSON.stringify({ verdict: 'pass', score: 0.95, reason: 'Looks good' });
      return Promise.resolve({ content });
    }),
    completeStream: undefined,
  } as unknown as LLMProvider;
}

function makeState(overrides: Partial<InterviewState> = {}): InterviewState {
  const base: InterviewState = {
    baseline: { title: 'Engineer' },
    participantRole: 'HIRING_MANAGER',
    questionBudget: 8,
    exchanges: [
      {
        questionId: 'q-1',
        acknowledgment: 'Hi.',
        question: 'Tell me about the role.',
        input: { type: 'textarea' },
        answer: 'We need a backend engineer.',
      },
    ],
    knowledgeState: {},
    coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    phase: 'CONTEXT',
    questionsAsked: 1,
    synthesisReady: false,
  };
  return { ...base, ...overrides };
}

function makeQuestion(overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  const base: GeneratedQuestion = {
    reasoning: 'Opening turn.',
    acknowledgment: 'Thanks for that.',
    question: {
      id: 'q-2',
      text: 'What is the team size?',
      input: { type: 'text' },
    },
    knowledgeStateUpdate: {},
    domainCoverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
  };
  return { ...base, ...overrides };
}

// ─── evaluateQuestion ────────────────────────────────────────────────────────

describe('evaluateQuestion', () => {
  it('returns approved=true when provider is null', async () => {
    const result = await evaluateQuestion(makeState(), makeQuestion(), null);
    expect(result.approved).toBe(true);
    expect(result.dimensions).toHaveLength(0);
  });

  it('returns approved=true with all_pass when all dimensions pass', async () => {
    const provider = makeMockProvider({});
    (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({ verdict: 'pass', score: 1, reason: 'Perfect' }),
    });

    const result = await evaluateQuestion(makeState(), makeQuestion(), provider, {
      config: { dimensions: DEFAULT_EVAL_DIMENSIONS.slice(0, 2), approvalRule: 'all_pass' },
    });

    expect(result.approved).toBe(true);
    expect(result.dimensions).toHaveLength(2);
    expect(result.dimensions.every((d) => d.verdict === 'pass')).toBe(true);
  });

  it('returns approved=false with all_pass when any dimension fails', async () => {
    const provider = makeMockProvider({});
    let callCount = 0;
    (provider.complete as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const content =
        callCount === 1
          ? JSON.stringify({ verdict: 'pass', score: 1, reason: 'Good' })
          : JSON.stringify({ verdict: 'fail', score: 0.2, reason: 'Too long' });
      return Promise.resolve({ content });
    });

    const result = await evaluateQuestion(makeState(), makeQuestion(), provider, {
      config: { dimensions: DEFAULT_EVAL_DIMENSIONS.slice(0, 2), approvalRule: 'all_pass' },
    });

    expect(result.approved).toBe(false);
    expect(result.dimensions.some((d) => d.verdict === 'fail')).toBe(true);
  });

  it('returns approved=true with no_fail when only warnings exist', async () => {
    const provider = makeMockProvider({});
    (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({ verdict: 'warn', score: 0.7, reason: 'A bit long' }),
    });

    const result = await evaluateQuestion(makeState(), makeQuestion(), provider, {
      config: { dimensions: DEFAULT_EVAL_DIMENSIONS.slice(0, 2), approvalRule: 'no_fail' },
    });

    expect(result.approved).toBe(true);
  });

  it('returns approved=false with no_fail when any dimension fails', async () => {
    const provider = makeMockProvider({});
    let callCount = 0;
    (provider.complete as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      const content =
        callCount === 1
          ? JSON.stringify({ verdict: 'warn', score: 0.7, reason: 'OK' })
          : JSON.stringify({ verdict: 'fail', score: 0.1, reason: 'Bad' });
      return Promise.resolve({ content });
    });

    const result = await evaluateQuestion(makeState(), makeQuestion(), provider, {
      config: { dimensions: DEFAULT_EVAL_DIMENSIONS.slice(0, 2), approvalRule: 'no_fail' },
    });

    expect(result.approved).toBe(false);
  });

  it('handles invalid JSON from a dimension gracefully', async () => {
    const provider = makeMockProvider({});
    (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'not json',
    });

    const result = await evaluateQuestion(makeState(), makeQuestion(), provider, {
      config: { dimensions: [{ id: 'bad', promptTemplate: 'bad' }], approvalRule: 'all_pass' },
    });

    expect(result.approved).toBe(false);
    expect(result.dimensions[0].verdict).toBe('fail');
    expect(result.dimensions[0].reason).toContain('not valid JSON');
  });

  it('passes question data to the provider in the prompt', async () => {
    const provider = makeMockProvider({});
    (provider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({ verdict: 'pass', score: 1, reason: 'Good' }),
    });

    const state = makeState();
    const question = makeQuestion();
    await evaluateQuestion(state, question, provider, {
      config: { dimensions: [{ id: 'test', promptTemplate: 'Evaluate this.' }], approvalRule: 'all_pass' },
    });

    const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages = callArgs[0] as Array<{ role: string; content: string }>;
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userMessage).toContain('What is the team size?');
    expect(userMessage).toContain('CONTEXT');
    expect(userMessage).toContain('We need a backend engineer.');
  });
});
