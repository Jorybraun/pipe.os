import { describe, it, expect, vi } from 'vitest';
import { generateQuestion, type GeneratedQuestion } from '../generator';
import type { InterviewState } from '../../interview/types';
import type { LLMProvider } from '../../../llm/types';

// ─── Mock provider ───────────────────────────────────────────────────────────

function makeMockProvider(response: string | Record<string, unknown>): LLMProvider {
  const content = typeof response === 'string' ? response : JSON.stringify(response);
  return {
    name: 'mock',
    supportsTools: false,
    complete: vi.fn().mockResolvedValue({ content }),
    completeStream: undefined,
  } as unknown as LLMProvider;
}

function makeState(overrides: Partial<InterviewState> = {}): InterviewState {
  const base: InterviewState = {
    baseline: { title: 'Backend Engineer' },
    participantRole: 'HIRING_MANAGER',
    questionBudget: 8,
    exchanges: [],
    knowledgeState: {},
    coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    phase: 'CONTEXT',
    questionsAsked: 0,
    synthesisReady: false,
  };
  return { ...base, ...overrides };
}

// ─── generateQuestion ────────────────────────────────────────────────────────

describe('generateQuestion', () => {
  it('throws when provider is null', async () => {
    await expect(generateQuestion(makeState(), null)).rejects.toThrow('No AI provider is configured');
  });

  it('parses a valid question response', async () => {
    const provider = makeMockProvider({
      reasoning: 'Opening turn, establish context.',
      acknowledgment: 'I will help you build a detailed role profile.',
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
    });

    const result = await generateQuestion(makeState(), provider);

    expect(result.question.text).toBe('What is the team size?');
    expect(result.question.id).toBe('q-1');
    expect(result.acknowledgment).toBe('I will help you build a detailed role profile.');
    expect(result.knowledgeStateUpdate.team).toEqual({ size: 6 });
    expect(result.domainCoverage.team).toBe('sparse');
  });

  it('defaults input type to textarea when missing', async () => {
    const provider = makeMockProvider({
      reasoning: 'Test',
      acknowledgment: 'Ok.',
      question: {
        id: 'q-1',
        text: 'What is the role?',
        input: {},
      },
      domainCoverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    });

    const result = await generateQuestion(makeState(), provider);
    expect(result.question.input.type).toBe('textarea');
  });

  it('throws on invalid JSON', async () => {
    const provider = makeMockProvider('not json at all');
    await expect(generateQuestion(makeState(), provider)).rejects.toThrow('invalid JSON');
  });

  it('throws on synthesis response leakage', async () => {
    const provider = makeMockProvider({
      reasoning: 'Final synthesis',
      persona: { seniority: 'Senior' },
      jobDescription: '# Job Description',
    });

    await expect(generateQuestion(makeState(), provider)).rejects.toThrow(
      'Use synthesize() for budget-exhausted turns',
    );
  });

  it('strips markdown fences from JSON', async () => {
    const provider = makeMockProvider(
      '```json\n{"reasoning":"x","acknowledgment":"y","question":{"id":"q-1","text":"What?","input":{"type":"text"}},"domainCoverage":{"why":"none","work":"none","team":"none","bar":"none","codebase":"none","process":"none"}}\n```',
    );

    const result = await generateQuestion(makeState(), provider);
    expect(result.question.text).toBe('What?');
  });

  it('uses expected question id when model omits id', async () => {
    const provider = makeMockProvider({
      reasoning: 'x',
      acknowledgment: 'y',
      question: {
        text: 'What stack?',
        input: { type: 'text' },
      },
      domainCoverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    });

    const state = makeState({ questionsAsked: 3 });
    const result = await generateQuestion(state, provider);
    expect(result.question.id).toBe('q-4');
  });

  it('includes exchanges in the prompt', async () => {
    const provider = makeMockProvider({
      reasoning: 'x',
      acknowledgment: 'y',
      question: { id: 'q-2', text: 'Follow-up?', input: { type: 'textarea' } },
      domainCoverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    });

    const state = makeState({
      questionsAsked: 1,
      exchanges: [
        {
          questionId: 'q-1',
          acknowledgment: 'Hi.',
          question: 'Tell me about the role.',
          input: { type: 'textarea' },
          answer: 'We need a backend engineer.',
        },
      ],
    });

    await generateQuestion(state, provider);
    const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages = callArgs[0] as Array<{ role: string; content: string }>;
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userMessage).toContain('We need a backend engineer.');
    expect(userMessage).toContain('PHASE: CONTEXT');
    expect(userMessage).toContain('BUDGET: 1 of 8 used');
  });
});
