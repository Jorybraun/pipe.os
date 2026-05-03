import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDomainQuestions, generateDomainQuestionsStream } from '../domainGenerator';
import type { InterviewState, GeneratedQuestion } from '../../interview/types';
import type { LLMProvider } from '../../../llm/types';

function makeState(overrides: Partial<InterviewState> = {}): InterviewState {
  const base: InterviewState = {
    baseline: { title: 'Senior Backend Engineer' },
    participantRole: 'HIRING_MANAGER',
    questionBudget: 12,
    exchanges: [],
    knowledgeState: {},
    coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    phase: 'CONTEXT',
    questionsAsked: 0,
    synthesisReady: false,
  };
  return { ...base, ...overrides };
}

function makeMockProvider(response: string): LLMProvider {
  return {
    name: 'mock',
    complete: vi.fn().mockResolvedValue({ content: response }),
    completeStream: undefined,
  } as unknown as LLMProvider;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('generateDomainQuestions', () => {
  it('generates questions for a domain', async () => {
    const mockResponse = JSON.stringify({
      questions: [
        { id: 'dq-1', text: 'Tell me about a recent code review.', intent: 'Surface review culture', drillingHints: ['What was the disagreement?'], ladderingTarget: 'Why does feedback matter here?' },
        { id: 'dq-2', text: 'How do you handle conflicts?', intent: 'Surface conflict style', drillingHints: ['Give me an example.'] },
      ],
    });

    const provider = makeMockProvider(mockResponse);
    const state = makeState();
    const questions = await generateDomainQuestions('team', state, provider, { count: 2 });

    expect(questions).toHaveLength(2);
    expect(questions[0].id).toBe('dq-1');
    expect(questions[0].text).toBe('Tell me about a recent code review.');
    expect(questions[0].intent).toBe('Surface review culture');
    expect(questions[0].drillingHints).toEqual(['What was the disagreement?']);
    expect(questions[0].ladderingTarget).toBe('Why does feedback matter here?');
  });

  it('throws when provider is null', async () => {
    const state = makeState();
    await expect(generateDomainQuestions('team', state, null)).rejects.toThrow('No AI provider is configured');
  });

  it('throws when response is empty', async () => {
    const provider = makeMockProvider('');
    const state = makeState();
    await expect(generateDomainQuestions('team', state, provider)).rejects.toThrow('empty content');
  });

  it('throws when response is invalid JSON', async () => {
    const provider = makeMockProvider('not json');
    const state = makeState();
    await expect(generateDomainQuestions('team', state, provider)).rejects.toThrow('invalid JSON');
  });

  it('throws when questions array is missing', async () => {
    const provider = makeMockProvider(JSON.stringify({ foo: 'bar' }));
    const state = makeState();
    await expect(generateDomainQuestions('team', state, provider)).rejects.toThrow('missing "questions" array');
  });

  it('throws when zero valid questions are returned', async () => {
    const provider = makeMockProvider(JSON.stringify({ questions: [null, 'string'] }));
    const state = makeState();
    await expect(generateDomainQuestions('team', state, provider)).rejects.toThrow('zero valid questions');
  });

  it('assigns default ids when missing', async () => {
    const mockResponse = JSON.stringify({
      questions: [
        { text: 'Q1', intent: 'I1' },
        { text: 'Q2', intent: 'I2' },
      ],
    });

    const provider = makeMockProvider(mockResponse);
    const state = makeState();
    const questions = await generateDomainQuestions('work', state, provider);

    expect(questions[0].id).toBe('dq-1');
    expect(questions[1].id).toBe('dq-2');
  });

  it('passes style option through to prompt', async () => {
    const mockResponse = JSON.stringify({
      questions: [{ id: 'dq-1', text: 'Q1', intent: 'I1' }],
    });

    const provider = makeMockProvider(mockResponse);
    const state = makeState();
    const questions = await generateDomainQuestions('team', state, provider, { style: 'soul', count: 1 });

    expect(questions).toHaveLength(1);
    // The prompt content is verified in domainPrompts tests; here we just verify the call succeeds.
  });

  it('extracts questions from truncated JSON via fallback', async () => {
    // Simulate a truncated response where JSON.parse would fail
    const truncated = `{"questions":[{"id":"dq-1","text":"Tell me about the team.","intent":"Surface team dynamics","drillingHints":["What makes them tick?"],"ladderingTarget":"Team values"},{"id":"dq-2","text":"How do you handle disagreements?","intent":"Surface conflict style","drillingHints":["Give me an example.","How mod`;

    const provider = makeMockProvider(truncated);
    const state = makeState();
    const questions = await generateDomainQuestions('team', state, provider, { count: 2 });

    expect(questions.length).toBeGreaterThanOrEqual(1);
    expect(questions[0].id).toBe('dq-1');
    expect(questions[0].text).toBe('Tell me about the team.');
    expect(questions[0].drillingHints).toEqual(['What makes them tick?']);
    expect(questions[0].ladderingTarget).toBe('Team values');
  });
});

describe('generateDomainQuestionsStream', () => {
  it('yields chunks and returns parsed questions', async () => {
    const mockResponse = JSON.stringify({
      questions: [
        { id: 'dq-1', text: 'Streamed Q1', intent: 'I1' },
        { id: 'dq-2', text: 'Streamed Q2', intent: 'I2' },
      ],
    });

    const provider = {
      name: 'mock-stream',
      completeStream: async function* () {
        yield mockResponse.slice(0, 20);
        yield mockResponse.slice(20);
      },
    } as unknown as LLMProvider;

    const state = makeState();
    const chunks: string[] = [];
    const result = await (async () => {
      const gen = generateDomainQuestionsStream('bar', state, provider, { count: 2 });
      let done = false;
      let value: GeneratedQuestion[] | undefined;
      while (!done) {
        const next = await gen.next();
        if (next.done) {
          value = next.value;
          done = true;
        } else {
          chunks.push(next.value as string);
        }
      }
      return value;
    })();

    expect(chunks.length).toBeGreaterThan(0);
    expect(result).toHaveLength(2);
    expect(result![0].text).toBe('Streamed Q1');
  });
});
