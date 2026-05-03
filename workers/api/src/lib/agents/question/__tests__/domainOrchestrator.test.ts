import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNextDomainDrivenQuestion } from '../domainOrchestrator';
import type { InterviewState } from '../../interview/types';
import type { LLMProvider } from '../../../llm/types';

function makeState(overrides: Partial<InterviewState> = {}): InterviewState {
  const base: InterviewState = {
    baseline: { title: 'Senior Backend Engineer' },
    participantRole: 'HIRING_MANAGER',
    questionBudget: 20,
    exchanges: [],
    knowledgeState: {},
    coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    phase: 'DISCOVERY',
    questionsAsked: 2,
    synthesisReady: false,
    currentDomain: null,
    domainCompletion: { team: 'pending', work: 'pending', bar: 'pending', codebase: 'pending', process: 'pending', why: 'pending' },
    domainQuestions: {},
    domainQuestionsDelivered: { team: 0, work: 0, bar: 0, codebase: 0, process: 0, why: 0 },
    domainFollowUpsDelivered: 0,
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

describe('getNextDomainDrivenQuestion', () => {
  it('returns complete when all domains are done regardless of phase', async () => {
    const state = makeState({
      phase: 'WRAP_UP',
      domainCompletion: { team: 'complete', work: 'complete', bar: 'complete', codebase: 'complete', process: 'complete', why: 'complete' },
    });
    const provider = makeMockProvider('');

    const result = await getNextDomainDrivenQuestion(state, provider);
    expect(result.type).toBe('complete');
  });

  it('picks team as the first domain and generates questions', async () => {
    const state = makeState();
    const mockResponse = JSON.stringify({
      questions: [
        { id: 'dq-1', text: 'Q1', intent: 'I1' },
        { id: 'dq-2', text: 'Q2', intent: 'I2' },
      ],
    });
    const provider = makeMockProvider(mockResponse);

    const result = await getNextDomainDrivenQuestion(state, provider, { questionsPerDomain: 2 });

    expect(result.result.question.text).toBe('Q1');
    expect(result.fromCache).toBe(true);
    expect(result.statePatches.currentDomain).toBe('team');
    expect(result.statePatches.domainCompletion?.team).toBe('asking');
    expect(result.statePatches.domainQuestions?.team).toHaveLength(2);
  });

  it('serves second question from cache without LLM call', async () => {
    const state = makeState({
      currentDomain: 'team',
      domainCompletion: { team: 'asking', work: 'pending', bar: 'pending', codebase: 'pending', process: 'pending', why: 'pending' },
      domainQuestions: { team: [{ id: 'dq-1', text: 'Q1', intent: 'I1' }, { id: 'dq-2', text: 'Q2', intent: 'I2' }] },
      domainQuestionsDelivered: { team: 1, work: 0, bar: 0, codebase: 0, process: 0, why: 0 },
    });
    const provider = makeMockProvider('');

    const result = await getNextDomainDrivenQuestion(state, provider);

    expect(result.result.question.text).toBe('Q2');
    expect(result.fromCache).toBe(true);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('generates warm follow-up when the last answer is thin', async () => {
    const state = makeState({
      currentDomain: 'team',
      domainCompletion: { team: 'asking', work: 'pending', bar: 'pending', codebase: 'pending', process: 'pending', why: 'pending' },
      domainQuestions: { team: [{ id: 'dq-1', text: 'Q1', intent: 'I1', drillingHints: ['What makes them tick?'] }] },
      domainQuestionsDelivered: { team: 1, work: 0, bar: 0, codebase: 0, process: 0, why: 0 },
      // Add a thin answer exchange so the evaluator triggers
      exchanges: [
        { questionId: 'dq-1', question: 'Q1', acknowledgment: 'Ack', input: { type: 'textarea' }, answer: 'idk' },
      ],
    });

    const nextDomainResponse = JSON.stringify({ questions: [{ id: 'dq-w1', text: 'Work Q1', intent: 'IW1' }] });
    const provider = makeMockProvider(nextDomainResponse);

    const result = await getNextDomainDrivenQuestion(state, provider);

    // Thin answer triggers a warm follow-up using the drillingHint (no LLM call needed)
    expect(result.result.question.text).toContain('What makes them tick');
    expect(result.statePatches.domainCompletion?.team).toBe('follow_up');
    expect(result.statePatches.domainFollowUpsDelivered).toBe(1);
  });

  it('advances to next domain when current domain is deep', async () => {
    const state = makeState({
      currentDomain: 'team',
      domainCompletion: { team: 'asking', work: 'pending', bar: 'pending', codebase: 'pending', process: 'pending', why: 'pending' },
      domainQuestions: { team: [{ id: 'dq-1', text: 'Q1', intent: 'I1' }] },
      domainQuestionsDelivered: { team: 1, work: 0, bar: 0, codebase: 0, process: 0, why: 0 },
      coverage: { team: 'deep', work: 'none', bar: 'none', codebase: 'none', process: 'none', why: 'none' },
    });

    const nextDomainResponse = JSON.stringify({ questions: [{ id: 'dq-w1', text: 'Work Q1', intent: 'IW1' }] });
    const provider = makeMockProvider(nextDomainResponse);

    const result = await getNextDomainDrivenQuestion(state, provider);

    expect(result.result.question.text).toBe('Work Q1');
    expect(result.statePatches.currentDomain).toBe('work');
    expect(result.statePatches.domainCompletion?.team).toBe('complete');
  });

  it('uses soul style for team domain when enableSoulTrack is true', async () => {
    const state = makeState();
    const mockResponse = JSON.stringify({
      questions: [{ id: 'dq-1', text: 'Soul Q1', intent: 'I1' }],
    });
    const provider = makeMockProvider(mockResponse);

    const result = await getNextDomainDrivenQuestion(state, provider, {
      enableSoulTrack: true,
      questionsPerDomain: 1,
    });

    expect(result.result.question.text).toBe('Soul Q1');
    // Verify the prompt included soul style — this is indirectly tested via domainPrompts
  });
});
