import { describe, it, expect } from 'vitest';
import { buildTurnPlan, buildPlanInstruction } from '../planner';
import type { InterviewState } from '../../interview/types';

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
    questionStack: [],
  };
  return { ...base, ...overrides };
}

describe('planner', () => {
  describe('buildTurnPlan', () => {
    it('plans CONTEXT phase for first turn', () => {
      const plan = buildTurnPlan(makeState({ questionsAsked: 0 }));
      expect(plan.phase).toBe('CONTEXT');
      expect(plan.strategy).toBe('pivot');
      expect(plan.questionType).toBe('introductory');
      expect(plan.energy).toBe('unknown');
    });

    it('plans CONTEXT phase for second turn', () => {
      const plan = buildTurnPlan(makeState({ questionsAsked: 1 }));
      expect(plan.phase).toBe('CONTEXT');
      expect(plan.questionType).toBe('grand_tour');
    });

    it('plans DISCOVERY with probe 1 after CONTEXT', () => {
      const plan = buildTurnPlan(makeState({
        phase: 'DISCOVERY',
        questionsAsked: 2,
        knowledgeState: { _probesDelivered: 0 },
      }));
      expect(plan.phase).toBe('DISCOVERY');
      expect(plan.probeId).toBe('probe_1_code_review');
      expect(plan.probeText).toContain('code review');
      expect(plan.targetDomain).toBe('team');
      expect(plan.strategy).toBe('probe');
    });

    it('progresses through probes', () => {
      for (let i = 0; i < 8; i++) {
        const plan = buildTurnPlan(makeState({
          phase: 'DISCOVERY',
          questionsAsked: 2 + i,
          knowledgeState: { _probesDelivered: i },
        }));
        expect(plan.probeId).toBeDefined();
        expect(plan.strategy).toBe('probe');
      }
    });

    it('stops assigning probes after all 8 delivered', () => {
      const plan = buildTurnPlan(makeState({
        phase: 'DISCOVERY',
        questionsAsked: 10,
        knowledgeState: { _probesDelivered: 8 },
      }));
      expect(plan.probeId).toBeUndefined();
      expect(plan.strategy).not.toBe('probe');
    });

    it('detects high energy from long answer', () => {
      const plan = buildTurnPlan(makeState({
        phase: 'DISCOVERY',
        questionsAsked: 3,
        knowledgeState: { _probesDelivered: 1 },
        exchanges: [{
          questionId: 'q-3',
          acknowledgment: 'Ok.',
          question: 'Tell me about a code review.',
          input: { type: 'textarea' },
          answer: 'We had this really interesting code review last week where we discovered a race condition in our payment processor. The reviewer caught it because they had seen a similar issue at their previous company. We ended up rewriting the whole concurrency model and it took three days but we learned a lot about how our system handles load.',
        }],
      }));
      expect(plan.energy).toBe('high');
    });

    it('detects low energy from short answer', () => {
      const plan = buildTurnPlan(makeState({
        phase: 'DISCOVERY',
        questionsAsked: 3,
        knowledgeState: { _probesDelivered: 1 },
        exchanges: [{
          questionId: 'q-3',
          acknowledgment: 'Ok.',
          question: 'Tell me about a code review.',
          input: { type: 'textarea' },
          answer: 'It was fine.',
        }],
      }));
      expect(plan.energy).toBe('low');
    });

    it('selects drilling strategy when energy is high and no probe assigned', () => {
      const plan = buildTurnPlan(makeState({
        phase: 'PRIORITIZE',
        questionsAsked: 9,
        knowledgeState: { _probesDelivered: 8 },
        exchanges: [{
          questionId: 'q-9',
          acknowledgment: 'Ok.',
          question: 'What matters most?',
          input: { type: 'textarea' },
          answer: 'React and Node and PostgreSQL and Redis and AWS and Docker and Kubernetes and CI/CD and testing and monitoring and logging and observability and security and compliance.',
        }],
      }));
      expect(plan.strategy).toBe('drill');
      expect(plan.questionType).toBe('contrast');
    });

    it('plans WRAP_UP phase', () => {
      const plan = buildTurnPlan(makeState({
        phase: 'WRAP_UP',
        questionsAsked: 11,
        knowledgeState: { _probesDelivered: 8, _mustHavesPrioritized: true, _frictionProbed: true, _dayInLifeProbed: true, _stories: [{}] },
      }));
      expect(plan.phase).toBe('WRAP_UP');
      expect(plan.strategy).toBe('wrap');
      expect(plan.questionType).toBe('direct');
      expect(plan.directive).toContain('summarize');
    });

    it('plans PRIORITIZE phase', () => {
      const plan = buildTurnPlan(makeState({
        phase: 'PRIORITIZE',
        questionsAsked: 9,
        knowledgeState: { _probesDelivered: 8 },
      }));
      expect(plan.phase).toBe('PRIORITIZE');
      expect(plan.directive).toContain('ranking');
      expect(plan.questionType).toBe('contrast');
    });

    it('plans EVP_FRICTION phase', () => {
      const plan = buildTurnPlan(makeState({
        phase: 'EVP_FRICTION',
        questionsAsked: 10,
        knowledgeState: { _probesDelivered: 8, _mustHavesPrioritized: true },
      }));
      expect(plan.phase).toBe('EVP_FRICTION');
      expect(plan.directive).toContain('friction');
      expect(plan.questionType).toBe('hypothesis');
    });

    it('targets shallowest domain when no probe', () => {
      const plan = buildTurnPlan(makeState({
        phase: 'PRIORITIZE',
        questionsAsked: 9,
        knowledgeState: { _probesDelivered: 8 },
        coverage: { why: 'deep', work: 'deep', team: 'covered', bar: 'partial', codebase: 'deep', process: 'deep' },
      }));
      expect(plan.targetDomain).toBe('bar');
    });
  });

  describe('buildPlanInstruction', () => {
    it('formats plan as instruction block', () => {
      const plan = buildTurnPlan(makeState({
        phase: 'DISCOVERY',
        questionsAsked: 2,
        knowledgeState: { _probesDelivered: 0 },
      }));
      const instruction = buildPlanInstruction(plan);
      expect(instruction).toContain('Turn Plan');
      expect(instruction).toContain('Phase: DISCOVERY');
      expect(instruction).toContain('Target domain:');
      expect(instruction).toContain('Directive:');
    });
  });
});
