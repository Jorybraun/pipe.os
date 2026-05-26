import { describe, it, expect } from 'vitest';
import { buildDomainGenerationPrompt } from '../domainPrompts';
import type { InterviewState } from '../../interview/types';

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

describe('buildDomainGenerationPrompt', () => {
  it('includes the domain label in the prompt', () => {
    const state = makeState();
    const { user } = buildDomainGenerationPrompt('team', state, 6);
    expect(user).toContain('team culture and dynamics');
  });

  it('includes the count in the prompt', () => {
    const state = makeState();
    const { user } = buildDomainGenerationPrompt('codebase', state, 6);
    expect(user).toContain('Generate 6 questions');
  });

  it('includes role context from baseline', () => {
    const state = makeState({ baseline: { title: 'Staff Engineer', company: 'Acme' } });
    const { user } = buildDomainGenerationPrompt('bar', state, 6);
    expect(user).toContain('Staff Engineer');
  });

  it('includes existing domain knowledge when present', () => {
    const state = makeState({
      knowledgeState: { team: { size: 6, culture: 'async-first' } },
    });
    const { user } = buildDomainGenerationPrompt('team', state, 6);
    expect(user).toContain('async-first');
  });

  it('includes conversation history', () => {
    const state = makeState({
      exchanges: [
        { questionId: 'q-1', acknowledgment: 'Hi.', question: 'Tell me about the role.', input: { type: 'textarea' }, answer: 'We need a backend engineer.' },
      ],
    });
    const { user } = buildDomainGenerationPrompt('work', state, 6);
    expect(user).toContain('Tell me about the role');
  });

  it('includes soul style when requested', () => {
    const state = makeState();
    const { user } = buildDomainGenerationPrompt('team', state, 6, { style: 'soul' });
    expect(user).toContain('Soul Style');
    expect(user).toContain('behavior over values');
  });

  it('does not include soul style by default for technical domains', () => {
    const state = makeState();
    const { user } = buildDomainGenerationPrompt('codebase', state, 6);
    expect(user).not.toContain('Soul Style');
  });

  it('includes JSON schema instruction', () => {
    const state = makeState();
    const { user } = buildDomainGenerationPrompt('why', state, 6);
    expect(user).toContain('questions');
    expect(user).toContain('drillingHints');
    expect(user).toContain('ladderingTarget');
  });

  it('covers all six domains without throwing', () => {
    const domains = ['team', 'work', 'bar', 'codebase', 'process', 'why'] as const;
    const state = makeState();
    for (const domain of domains) {
      const { system, user } = buildDomainGenerationPrompt(domain, state, 6);
      expect(system.length).toBeGreaterThan(0);
      expect(user.length).toBeGreaterThan(0);
    }
  });
});
