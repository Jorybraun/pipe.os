import { describe, it, expect } from 'vitest';
import { interviewReducer, createInitialState, mergeKnowledgeState } from '../reducer';
import type { InterviewState, CreateInterviewStateInput } from '../types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<InterviewState> = {}): InterviewState {
  const base: InterviewState = {
    baseline: { title: 'Engineer' },
    participantRole: 'HIRING_MANAGER',
    questionBudget: 60,
    exchanges: [],
    coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    phase: 'CONTEXT',
    questionsAsked: 0,
    synthesisReady: false,
    currentDomain: null,
    domainCompletion: { team: 'pending', work: 'pending', bar: 'pending', codebase: 'pending', process: 'pending', why: 'pending' },
    domainQuestions: {},
    domainQuestionsDelivered: { team: 0, work: 0, bar: 0, codebase: 0, process: 0, why: 0 },
    domainFollowUpsDelivered: 0,
  };
  return { ...base, ...overrides };
}

function makeInitialInput(overrides: Partial<CreateInterviewStateInput> = {}): CreateInterviewStateInput {
  return {
    baseline: { title: 'Engineer' },
    participantRole: 'HIRING_MANAGER',
    questionBudget: 60,
    ...overrides,
  };
}

// ─── createInitialState ──────────────────────────────────────────────────────

describe('createInitialState', () => {
  it('creates a state with zero questions asked', () => {
    const state = createInitialState(makeInitialInput());
    expect(state.questionsAsked).toBe(0);
    expect(state.phase).toBe('CONTEXT');
    expect(state.synthesisReady).toBe(false);
    expect(state.currentDomain).toBeNull();
  });

  it('initializes all domain completions to pending', () => {
    const state = createInitialState(makeInitialInput());
    expect(state.domainCompletion).toEqual({
      team: 'pending',
      work: 'pending',
      bar: 'pending',
      codebase: 'pending',
      process: 'pending',
      why: 'pending',
    });
  });

  it('accepts a seed knowledge state', () => {
    const state = createInitialState(
      makeInitialInput({
        seedKnowledgeState: { team: { size: 6 } },
      }),
    );
    expect(state.knowledgeState.team).toEqual({ size: 6 });
  });

  it('derives coverage from seed knowledge state _coverage', () => {
    const state = createInitialState(
      makeInitialInput({
        seedKnowledgeState: {
          _coverage: { why: 'sparse', work: 'partial', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
        },
      }),
    );
    expect(state.coverage.why).toBe('sparse');
    expect(state.coverage.work).toBe('partial');
  });

  it('defaults all domains to none when no _coverage present', () => {
    const state = createInitialState(makeInitialInput());
    expect(state.coverage).toEqual({
      why: 'none',
      work: 'none',
      team: 'none',
      bar: 'none',
      codebase: 'none',
      process: 'none',
    });
  });
});

// ─── interviewReducer — ANSWER ───────────────────────────────────────────────

describe('interviewReducer — ANSWER', () => {
  it('appends answer to the last exchange', () => {
    const state = makeState({
      exchanges: [
        {
          questionId: 'q-1',
          acknowledgment: 'Great.',
          question: 'Tell me about the role.',
          input: { type: 'textarea' },
        },
      ],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'We need a senior backend engineer.' });

    expect(next.exchanges).toHaveLength(1);
    expect(next.exchanges[0].answer).toBe('We need a senior backend engineer.');
  });

  it('increments questionsAsked', () => {
    const state = makeState({ exchanges: [{ questionId: 'q-1', acknowledgment: '', question: '', input: { type: 'textarea' } }] });
    const next = interviewReducer(state, { type: 'ANSWER', answer: 'yes' });
    expect(next.questionsAsked).toBe(1);
  });

  it('merges domain coverage overrides', () => {
    const state = makeState({
      exchanges: [{ questionId: 'q-1', acknowledgment: '', question: '', input: { type: 'textarea' } }],
    });
    const next = interviewReducer(state, {
      type: 'ANSWER',
      answer: 'yes',
      domainCoverage: { team: 'partial' },
    });
    expect(next.coverage.team).toBe('partial');
  });

  it('tracks domainQuestionsDelivered for current domain', () => {
    const state = makeState({
      currentDomain: 'team',
      exchanges: [{ questionId: 'q-1', acknowledgment: '', question: '', input: { type: 'textarea' } }],
      domainCompletion: { ...makeState().domainCompletion, team: 'asking' },
    });
    const next = interviewReducer(state, { type: 'ANSWER', answer: 'yes' });
    expect(next.domainQuestionsDelivered.team).toBe(1);
  });

  it('increments domainFollowUpsDelivered when in follow_up', () => {
    const state = makeState({
      currentDomain: 'team',
      exchanges: [{ questionId: 'q-1', acknowledgment: '', question: '', input: { type: 'textarea' } }],
      domainCompletion: { ...makeState().domainCompletion, team: 'follow_up' },
      domainFollowUpsDelivered: 2,
    });
    const next = interviewReducer(state, { type: 'ANSWER', answer: 'yes' });
    expect(next.domainFollowUpsDelivered).toBe(3);
  });

  it('does not set synthesisReady on normal answer', () => {
    const state = makeState({
      exchanges: [{ questionId: 'q-1', acknowledgment: '', question: '', input: { type: 'textarea' } }],
    });
    const next = interviewReducer(state, { type: 'ANSWER', answer: 'yes' });
    expect(next.synthesisReady).toBe(false);
  });
});

// ─── interviewReducer — SKIP ─────────────────────────────────────────────────

describe('interviewReducer — SKIP', () => {
  it('marks last exchange as skipped with empty answer', () => {
    const state = makeState({
      exchanges: [
        { questionId: 'q-1', acknowledgment: '', question: 'Q?', input: { type: 'textarea' } },
      ],
    });
    const next = interviewReducer(state, { type: 'SKIP' });
    expect(next.exchanges[0].answer).toBe('');
  });

  it('increments questionsAsked on skip', () => {
    const state = makeState({
      exchanges: [{ questionId: 'q-1', acknowledgment: '', question: '', input: { type: 'textarea' } }],
    });
    const next = interviewReducer(state, { type: 'SKIP' });
    expect(next.questionsAsked).toBe(1);
  });
});

// ─── interviewReducer — CACHE_DOMAIN_QUESTIONS ───────────────────────────────

describe('interviewReducer — CACHE_DOMAIN_QUESTIONS', () => {
  it('caches questions and sets domain to asking', () => {
    const state = makeState();
    const next = interviewReducer(state, {
      type: 'CACHE_DOMAIN_QUESTIONS',
      domain: 'team',
      questions: [{ id: 'dq-1', text: 'Q1', intent: 'I1' }],
    });
    expect(next.currentDomain).toBe('team');
    expect(next.domainCompletion.team).toBe('asking');
    expect(next.domainQuestions.team).toHaveLength(1);
  });
});

// ─── interviewReducer — FORCE_SYNTHESIZE ─────────────────────────────────────

describe('interviewReducer — FORCE_SYNTHESIZE', () => {
  it('sets synthesisReady and phase to WRAP_UP', () => {
    const state = makeState();
    const next = interviewReducer(state, { type: 'FORCE_SYNTHESIZE' });
    expect(next.synthesisReady).toBe(true);
    expect(next.phase).toBe('WRAP_UP');
  });
});

// ─── mergeKnowledgeState ─────────────────────────────────────────────────────

describe('mergeKnowledgeState', () => {
  it('merges nested objects', () => {
    const existing = { team: { size: 5 }, work: { remote: true } };
    const update = { team: { culture: 'fast' } };
    const result = mergeKnowledgeState(existing, update);
    expect(result.team).toEqual({ size: 5, culture: 'fast' });
    expect(result.work).toEqual({ remote: true });
  });

  it('creates new domains', () => {
    const existing = {};
    const update = { bar: { seniority: 'staff' } };
    const result = mergeKnowledgeState(existing, update);
    expect(result.bar).toEqual({ seniority: 'staff' });
  });
});
