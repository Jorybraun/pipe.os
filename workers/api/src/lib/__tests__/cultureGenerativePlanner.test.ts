/**
 * Culture Generative Turn Planner — unit tests.
 *
 * Tests:
 *   - parseGenerativeTurnResult handles valid JSON
 *   - parseGenerativeTurnResult rejects invalid/missing fields
 *   - buildGenerativePlannerUserMessage includes candidate background and RCD context
 *   - buildGenerativePlannerUserMessage excludes already-asked questions
 */

import { describe, it, expect } from 'vitest';
import {
  buildGenerativePlannerSystemPrompt,
  buildGenerativePlannerUserMessage,
  runGenerativeTurnPlanner,
  type GenerativePlannerContext,
} from '../cultureGenerativePlanner';
import type { LLMProvider } from '../llm/types';
import { CULTURE_BANK_SIZE } from '../cultureQuestionBank';

describe('buildGenerativePlannerSystemPrompt', () => {
  it('contains the JSON output contract', () => {
    const prompt = buildGenerativePlannerSystemPrompt();
    expect(prompt).toContain('"question"');
    expect(prompt).toContain('"targetDimension"');
    expect(prompt).toContain('"personalizationAnchors"');
    expect(prompt).toContain('Return ONLY the JSON object');
  });

  it('forbids generic questions', () => {
    const prompt = buildGenerativePlannerSystemPrompt();
    expect(prompt).toContain('NEVER ask a generic question');
  });
});

describe('buildGenerativePlannerUserMessage', () => {
  const baseCtx: GenerativePlannerContext = {
    mode: 'role_fit',
    candidate: {
      experiences: [
        { company: 'Stripe', role: 'Senior Backend Engineer', durationMonths: 24, highlights: ['Built payment fraud detection pipeline'] },
      ],
      projects: [{ name: 'Fraud Shield', description: 'Real-time fraud scoring service', technologies: ['Scala', 'Kafka', 'Spark'] }],
      skills: ['scala', 'kafka', 'distributed-systems'],
      priorScreening: null,
    },
    role: {
      teamStories: [{ domain: 'reliability', narrative: 'Team had a major v2 launch incident that required HM override', archetype: 'crisis' }],
      conflicts: [],
      dealbreakers: [],
      cultureProfile: { clan: 3, adhocracy: 4, market: 3, hierarchy: 2, psychologicalSafety: 4 },
      barsOverrides: [],
    },
    coverage: { ownership: 0, collaboration: 0, 'learning-orientation': 0, 'conflict-handling': 0, 'self-awareness': 0 },
    turnsUsed: 0,
    priorQuestions: [],
    runningThemes: [],
    maxQuestions: CULTURE_BANK_SIZE,
    minQuestions: 5,
  };

  it('references candidate company name in the message', () => {
    const msg = buildGenerativePlannerUserMessage(baseCtx);
    expect(msg).toContain('Stripe');
  });

  it('references team story in the message', () => {
    const msg = buildGenerativePlannerUserMessage(baseCtx);
    expect(msg).toContain('v2 launch incident');
  });

  it('excludes prior questions from the context', () => {
    const ctx: GenerativePlannerContext = {
      ...baseCtx,
      priorQuestions: ['Tell me about a time you showed ownership.'],
    };
    const msg = buildGenerativePlannerUserMessage(ctx);
    expect(msg).toContain('Tell me about a time you showed ownership.');
    expect(msg).toContain('DO NOT REPEAT');
  });

  it('shows mode=profile_builder when set', () => {
    const ctx: GenerativePlannerContext = { ...baseCtx, mode: 'profile_builder' };
    const msg = buildGenerativePlannerUserMessage(ctx);
    expect(msg).toContain('Interview mode: profile_builder');
  });

  it('truncates large experience lists', () => {
    const ctx: GenerativePlannerContext = {
      ...baseCtx,
      candidate: {
        ...baseCtx.candidate,
        experiences: Array.from({ length: 10 }, (_, i) => ({
          company: `Company ${i}`,
          role: 'Engineer',
          durationMonths: 12,
          highlights: ['Did stuff'],
        })),
      },
    };
    const msg = buildGenerativePlannerUserMessage(ctx);
    // Should still compile and include at least some experiences
    expect(msg).toContain('Company 0');
  });
});

describe('runGenerativeTurnPlanner', () => {
  it('returns null when provider is null', async () => {
    const ctx: GenerativePlannerContext = {
      mode: 'role_fit',
      candidate: { experiences: [], projects: [], skills: [], priorScreening: null },
      role: { teamStories: [], conflicts: [], dealbreakers: [], cultureProfile: {}, barsOverrides: [] },
      coverage: { ownership: 0, collaboration: 0, 'learning-orientation': 0, 'conflict-handling': 0, 'self-awareness': 0 },
      turnsUsed: 0,
      priorQuestions: [],
      runningThemes: [],
      maxQuestions: CULTURE_BANK_SIZE,
      minQuestions: 5,
    };

    const { result, reason } = await runGenerativeTurnPlanner(null, ctx);
    expect(result).toBeNull();
    expect(reason).toBe('no_provider');
  });

  it('parses a valid LLM response', async () => {
    const mockProvider: LLMProvider = {
      name: 'mock',
      supportsTools: false,
      async complete() {
        return {
          content: JSON.stringify({
            question: 'At Stripe you worked on payment fraud. Tell me about a time the system failed in a way that affected customers.',
            targetDimension: 'ownership',
            targetSlots: ['S', 'T', 'A', 'R'],
            probeStrategy: {
              missing_A: 'What did you personally do to fix it?',
            },
            personalizationAnchors: ['candidate worked at Stripe on payments', 'team values reliability'],
            reasoning: 'Targets ownership with a specific Stripe incident reference.',
          }),
        };
      },
    };

    const ctx: GenerativePlannerContext = {
      mode: 'role_fit',
      candidate: {
        experiences: [{ company: 'Stripe', role: 'Engineer', durationMonths: 24, highlights: ['payments'] }],
        projects: [],
        skills: [],
        priorScreening: null,
      },
      role: { teamStories: [], conflicts: [], dealbreakers: [], cultureProfile: {}, barsOverrides: [] },
      coverage: { ownership: 0, collaboration: 0, 'learning-orientation': 0, 'conflict-handling': 0, 'self-awareness': 0 },
      turnsUsed: 0,
      priorQuestions: [],
      runningThemes: [],
      maxQuestions: CULTURE_BANK_SIZE,
      minQuestions: 5,
    };

    const { result, reason } = await runGenerativeTurnPlanner(mockProvider, ctx);
    expect(result).not.toBeNull();
    expect(reason).toBe('success');
    expect(result!.question).toContain('Stripe');
    expect(result!.targetDimension).toBe('ownership');
    expect(result!.personalizationAnchors.length).toBeGreaterThan(0);
    expect(result!.probeStrategy.missing_A).toBeDefined();
  });

  it('returns null on malformed JSON', async () => {
    const mockProvider: LLMProvider = {
      name: 'mock',
      supportsTools: false,
      async complete() {
        return { content: 'not json' };
      },
    };

    const ctx: GenerativePlannerContext = {
      mode: 'role_fit',
      candidate: { experiences: [], projects: [], skills: [], priorScreening: null },
      role: { teamStories: [], conflicts: [], dealbreakers: [], cultureProfile: {}, barsOverrides: [] },
      coverage: { ownership: 0, collaboration: 0, 'learning-orientation': 0, 'conflict-handling': 0, 'self-awareness': 0 },
      turnsUsed: 0,
      priorQuestions: [],
      runningThemes: [],
      maxQuestions: CULTURE_BANK_SIZE,
      minQuestions: 5,
    };

    const { result, reason } = await runGenerativeTurnPlanner(mockProvider, ctx);
    expect(result).toBeNull();
    expect(reason).toBe('parse_error');
  });

  it('returns null when question field is empty', async () => {
    const mockProvider: LLMProvider = {
      name: 'mock',
      supportsTools: false,
      async complete() {
        return {
          content: JSON.stringify({
            question: '',
            targetDimension: 'ownership',
            targetSlots: ['S', 'T', 'A', 'R'],
            probeStrategy: {},
            personalizationAnchors: [],
            reasoning: '',
          }),
        };
      },
    };

    const ctx: GenerativePlannerContext = {
      mode: 'role_fit',
      candidate: { experiences: [], projects: [], skills: [], priorScreening: null },
      role: { teamStories: [], conflicts: [], dealbreakers: [], cultureProfile: {}, barsOverrides: [] },
      coverage: { ownership: 0, collaboration: 0, 'learning-orientation': 0, 'conflict-handling': 0, 'self-awareness': 0 },
      turnsUsed: 0,
      priorQuestions: [],
      runningThemes: [],
      maxQuestions: CULTURE_BANK_SIZE,
      minQuestions: 5,
    };

    const { result, reason } = await runGenerativeTurnPlanner(mockProvider, ctx);
    expect(result).toBeNull();
    expect(reason).toBe('parse_failed');
  });
});
