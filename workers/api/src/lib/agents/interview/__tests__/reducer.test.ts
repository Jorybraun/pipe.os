import { describe, it, expect } from 'vitest';
import {
  interviewReducer,
  createInitialState,
  mergeKnowledgeState,
  selectPhase,
} from '../reducer';
import type { InterviewState, CreateInterviewStateInput } from '../types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<InterviewState> = {}): InterviewState {
  const base: InterviewState = {
    baseline: { title: 'Engineer' },
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

function makeInitialInput(overrides: Partial<CreateInterviewStateInput> = {}): CreateInterviewStateInput {
  return {
    baseline: { title: 'Engineer' },
    participantRole: 'HIRING_MANAGER',
    questionBudget: 8,
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
    const state = makeState({
      questionsAsked: 2,
      exchanges: [{ questionId: 'q-3', acknowledgment: 'Ok.', question: 'What stack?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'TypeScript and PostgreSQL.' });

    expect(next.questionsAsked).toBe(3);
  });

  it('merges knowledgeStateUpdate into knowledgeState', () => {
    const state = makeState({
      knowledgeState: { why: { origin: 'growth' } },
      exchanges: [{ questionId: 'q-1', acknowledgment: 'Hi.', question: 'Why?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, {
      type: 'ANSWER',
      answer: 'We are growing fast.',
      knowledgeStateUpdate: { why: { urgency: 'high' }, team: { size: 6 } },
    });

    expect(next.knowledgeState.why).toEqual({ origin: 'growth', urgency: 'high' });
    expect(next.knowledgeState.team).toEqual({ size: 6 });
  });

  it('applies domainCoverage override and persists to _coverage', () => {
    const state = makeState({
      exchanges: [{ questionId: 'q-1', acknowledgment: 'Hi.', question: 'Why?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, {
      type: 'ANSWER',
      answer: 'Growth.',
      domainCoverage: { why: 'partial', work: 'sparse' },
    });

    expect(next.coverage.why).toBe('partial');
    expect(next.coverage.work).toBe('sparse');
    expect(next.knowledgeState._coverage).toEqual({
      why: 'partial',
      work: 'sparse',
      team: 'none',
      bar: 'none',
      codebase: 'none',
      process: 'none',
    });
  });

  it('returns unchanged state when there is no last exchange', () => {
    const state = makeState({ exchanges: [] });
    const next = interviewReducer(state, { type: 'ANSWER', answer: 'hello' });
    expect(next.exchanges).toHaveLength(0);
    expect(next.questionsAsked).toBe(state.questionsAsked);
  });
});

// ─── Phase progression ───────────────────────────────────────────────────────

describe('interviewReducer — phase progression', () => {
  it('stays in CONTEXT for the first answer (questionsAsked becomes 1)', () => {
    const state = makeState({
      questionsAsked: 0,
      exchanges: [{ questionId: 'q-1', acknowledgment: 'Hi.', question: 'Tell me about the role.', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'We need a backend engineer.' });

    expect(next.questionsAsked).toBe(1);
    expect(next.phase).toBe('CONTEXT');
  });

  it('moves to DISCOVERY after 2 questions when probes are incomplete', () => {
    const state = makeState({
      questionsAsked: 1,
      phase: 'CONTEXT',
      exchanges: [{ questionId: 'q-2', acknowledgment: 'Ok.', question: 'What stack?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'TypeScript.' });

    expect(next.questionsAsked).toBe(2);
    expect(next.phase).toBe('DISCOVERY');
  });

  it('stays in DISCOVERY until all 8 probes are delivered', () => {
    const state = makeState({
      questionsAsked: 3,
      phase: 'DISCOVERY',
      knowledgeState: {
        _probesDelivered: 5,
        _coverage: { why: 'sparse', work: 'partial', team: 'sparse', bar: 'none', codebase: 'none', process: 'none' },
      },
      coverage: { why: 'sparse', work: 'partial', team: 'sparse', bar: 'none', codebase: 'none', process: 'none' },
      exchanges: [{ questionId: 'q-4', acknowledgment: 'Ok.', question: 'Probe 6?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'Yes.' });

    expect(next.questionsAsked).toBe(4);
    expect(next.phase).toBe('DISCOVERY');
  });

  it('moves to PRIORITIZE when all probes delivered but must-haves not ranked', () => {
    const state = makeState({
      questionsAsked: 8,
      phase: 'DISCOVERY',
      knowledgeState: {
        _probesDelivered: 8,
        _mustHavesPrioritized: false,
        _stories: [{ protagonist: 'Alice', situation: 'X', stakes: 'Y', resolution: 'Z', moral: 'M', sourceTurn: 3, retellabilityScore: 'HIGH' }],
        _coverage: { why: 'covered', work: 'covered', team: 'covered', bar: 'covered', codebase: 'covered', process: 'covered' },
      },
      coverage: { why: 'covered', work: 'covered', team: 'covered', bar: 'covered', codebase: 'covered', process: 'covered' },
      exchanges: [{ questionId: 'q-9', acknowledgment: 'Ok.', question: 'What matters most?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'React and Node.' });

    expect(next.phase).toBe('PRIORITIZE');
  });

  it('moves to EVP_FRICTION when must-haves ranked but EVP uncovered', () => {
    const state = makeState({
      questionsAsked: 10,
      phase: 'PRIORITIZE',
      knowledgeState: {
        _probesDelivered: 8,
        _mustHavesPrioritized: true,
        _frictionProbed: false,
        _stories: [{ protagonist: 'Alice', situation: 'X', stakes: 'Y', resolution: 'Z', moral: 'M', sourceTurn: 3, retellabilityScore: 'HIGH' }],
        _coverage: { why: 'deep', work: 'deep', team: 'deep', bar: 'deep', codebase: 'deep', process: 'deep' },
        _evpCoverage: { Rewards: 'none', Opportunity: 'none', Work: 'covered', People: 'covered', Organisation: 'none' },
      },
      coverage: { why: 'deep', work: 'deep', team: 'deep', bar: 'deep', codebase: 'deep', process: 'deep' },
      exchanges: [{ questionId: 'q-11', acknowledgment: 'Ok.', question: 'Why would someone join?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'Great team.' });

    expect(next.phase).toBe('EVP_FRICTION');
  });

  it('moves to WRAP_UP when all gates pass', () => {
    const state = makeState({
      questionsAsked: 11,
      phase: 'EVP_FRICTION',
      knowledgeState: {
        _probesDelivered: 8,
        _mustHavesPrioritized: true,
        _frictionProbed: true,
        _dayInLifeProbed: true,
        _stories: [{ protagonist: 'Alice', situation: 'X', stakes: 'Y', resolution: 'Z', moral: 'M', sourceTurn: 3, retellabilityScore: 'HIGH' }],
        _coverage: { why: 'deep', work: 'deep', team: 'deep', bar: 'deep', codebase: 'deep', process: 'deep' },
        _evpCoverage: { Rewards: 'covered', Opportunity: 'covered', Work: 'covered', People: 'covered', Organisation: 'covered' },
      },
      coverage: { why: 'deep', work: 'deep', team: 'deep', bar: 'deep', codebase: 'deep', process: 'deep' },
      exchanges: [{ questionId: 'q-12', acknowledgment: 'Ok.', question: 'Anything else?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'Nope.' });

    expect(next.phase).toBe('WRAP_UP');
    expect(next.synthesisReady).toBe(true);
  });
});

// ─── synthesisReady ──────────────────────────────────────────────────────────

describe('interviewReducer — synthesisReady', () => {
  it('becomes true when budget is exhausted regardless of gates', () => {
    const state = makeState({
      questionsAsked: 7,
      questionBudget: 8,
      phase: 'DISCOVERY',
      knowledgeState: {
        _probesDelivered: 3, // far from all gates
      },
      exchanges: [{ questionId: 'q-8', acknowledgment: 'Ok.', question: 'Last question?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'Yes.' });

    expect(next.questionsAsked).toBe(8);
    expect(next.synthesisReady).toBe(true);
  });

  it('stays false when budget remains and gates are incomplete', () => {
    const state = makeState({
      questionsAsked: 2,
      questionBudget: 8,
      phase: 'DISCOVERY',
      knowledgeState: { _probesDelivered: 2 },
      exchanges: [{ questionId: 'q-3', acknowledgment: 'Ok.', question: 'Next?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'Sure.' });

    expect(next.questionsAsked).toBe(3);
    expect(next.synthesisReady).toBe(false);
  });

  it('becomes true when all gates pass before budget exhaustion', () => {
    const state = makeState({
      questionsAsked: 7,
      questionBudget: 10,
      phase: 'WRAP_UP',
      knowledgeState: {
        _probesDelivered: 8,
        _mustHavesPrioritized: true,
        _frictionProbed: true,
        _dayInLifeProbed: true,
        _stories: [{ protagonist: 'Alice', situation: 'X', stakes: 'Y', resolution: 'Z', moral: 'M', sourceTurn: 3, retellabilityScore: 'HIGH' }],
        _coverage: { why: 'deep', work: 'deep', team: 'deep', bar: 'deep', codebase: 'deep', process: 'deep' },
        _evpCoverage: { Rewards: 'covered', Opportunity: 'covered', Work: 'covered', People: 'covered', Organisation: 'covered' },
      },
      coverage: { why: 'deep', work: 'deep', team: 'deep', bar: 'deep', codebase: 'deep', process: 'deep' },
      exchanges: [{ questionId: 'q-8', acknowledgment: 'Ok.', question: 'Confirm?', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'ANSWER', answer: 'Correct.' });

    expect(next.questionsAsked).toBe(8);
    expect(next.synthesisReady).toBe(true);
  });
});

// ─── SKIP action ─────────────────────────────────────────────────────────────

describe('interviewReducer — SKIP', () => {
  it('marks the last exchange as skipped (empty answer) and increments counter', () => {
    const state = makeState({
      exchanges: [{ questionId: 'q-1', acknowledgment: 'Hi.', question: 'Tell me.', input: { type: 'textarea' } }],
    });

    const next = interviewReducer(state, { type: 'SKIP' });

    expect(next.exchanges[0].answer).toBe('');
    expect(next.questionsAsked).toBe(1);
  });
});

// ─── FORCE_SYNTHESIZE action ─────────────────────────────────────────────────

describe('interviewReducer — FORCE_SYNTHESIZE', () => {
  it('sets synthesisReady to true and forces WRAP_UP phase', () => {
    const state = makeState({
      phase: 'DISCOVERY',
      questionsAsked: 3,
      synthesisReady: false,
    });

    const next = interviewReducer(state, { type: 'FORCE_SYNTHESIZE' });

    expect(next.synthesisReady).toBe(true);
    expect(next.phase).toBe('WRAP_UP');
  });
});

// ─── selectPhase — isolated tests ────────────────────────────────────────────

describe('selectPhase', () => {
  it('selects CONTEXT for questionsAsked < 2', () => {
    const result = selectPhase({
      questionsAsked: 0,
      questionBudget: 8,
      domainCoverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
      evpCoverage: { Rewards: 'none', Opportunity: 'none', Work: 'none', People: 'none', Organisation: 'none' },
      storiesExtracted: [],
      mustHavesPrioritized: false,
      frictionProbed: false,
      dayInLifeProbed: false,
      probesDelivered: 0,
    });

    expect(result.phase).toBe('CONTEXT');
    expect(result.synthesisAllowed).toBe(false);
  });

  it('selects DISCOVERY when probes are incomplete', () => {
    const result = selectPhase({
      questionsAsked: 2,
      questionBudget: 8,
      domainCoverage: { why: 'sparse', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
      evpCoverage: { Rewards: 'none', Opportunity: 'none', Work: 'none', People: 'none', Organisation: 'none' },
      storiesExtracted: [],
      mustHavesPrioritized: false,
      frictionProbed: false,
      dayInLifeProbed: false,
      probesDelivered: 3,
    });

    expect(result.phase).toBe('DISCOVERY');
    expect(result.urgentGaps).toContain('Probe 4 not yet delivered');
  });

  it('selects PRIORITIZE when probes done but must-haves not ranked', () => {
    const result = selectPhase({
      questionsAsked: 8,
      questionBudget: 10,
      domainCoverage: { why: 'covered', work: 'covered', team: 'covered', bar: 'covered', codebase: 'covered', process: 'covered' },
      evpCoverage: { Rewards: 'none', Opportunity: 'none', Work: 'none', People: 'none', Organisation: 'none' },
      storiesExtracted: [{ protagonist: 'A', situation: 'S', stakes: 'K', resolution: 'R', moral: 'M', sourceTurn: 1, retellabilityScore: 'HIGH' }],
      mustHavesPrioritized: false,
      frictionProbed: false,
      dayInLifeProbed: true,
      probesDelivered: 8,
    });

    expect(result.phase).toBe('PRIORITIZE');
  });

  it('selects EVP_FRICTION when must-haves ranked but EVP uncovered', () => {
    const result = selectPhase({
      questionsAsked: 10,
      questionBudget: 12,
      domainCoverage: { why: 'deep', work: 'deep', team: 'deep', bar: 'deep', codebase: 'deep', process: 'deep' },
      evpCoverage: { Rewards: 'none', Opportunity: 'covered', Work: 'covered', People: 'covered', Organisation: 'covered' },
      storiesExtracted: [{ protagonist: 'A', situation: 'S', stakes: 'K', resolution: 'R', moral: 'M', sourceTurn: 1, retellabilityScore: 'HIGH' }],
      mustHavesPrioritized: true,
      frictionProbed: false,
      dayInLifeProbed: true,
      probesDelivered: 8,
    });

    expect(result.phase).toBe('EVP_FRICTION');
    expect(result.urgentGaps).toContain('Uncovered EVP categories: Rewards');
  });

  it('selects WRAP_UP when all gates pass', () => {
    const result = selectPhase({
      questionsAsked: 11,
      questionBudget: 12,
      domainCoverage: { why: 'deep', work: 'deep', team: 'deep', bar: 'deep', codebase: 'deep', process: 'deep' },
      evpCoverage: { Rewards: 'covered', Opportunity: 'covered', Work: 'covered', People: 'covered', Organisation: 'covered' },
      storiesExtracted: [{ protagonist: 'A', situation: 'S', stakes: 'K', resolution: 'R', moral: 'M', sourceTurn: 1, retellabilityScore: 'HIGH' }],
      mustHavesPrioritized: true,
      frictionProbed: true,
      dayInLifeProbed: true,
      probesDelivered: 8,
    });

    expect(result.phase).toBe('WRAP_UP');
    expect(result.synthesisAllowed).toBe(true);
  });

  it('allows synthesis when budget is exhausted even if gates incomplete', () => {
    const result = selectPhase({
      questionsAsked: 8,
      questionBudget: 8,
      domainCoverage: { why: 'sparse', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
      evpCoverage: { Rewards: 'none', Opportunity: 'none', Work: 'none', People: 'none', Organisation: 'none' },
      storiesExtracted: [],
      mustHavesPrioritized: false,
      frictionProbed: false,
      dayInLifeProbed: false,
      probesDelivered: 2,
    });

    expect(result.phase).toBe('DISCOVERY');
    expect(result.synthesisAllowed).toBe(true);
  });
});

// ─── mergeKnowledgeState ─────────────────────────────────────────────────────

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
});
