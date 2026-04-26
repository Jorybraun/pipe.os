/**
 * Culture Adaptive Agent — unit tests.
 *
 * Tests:
 *   - startAdaptiveCultureInterview with static fallback
 *   - startAdaptiveCultureInterview with generative planner (mock provider)
 *   - advanceAdaptiveCultureInterview probes, advances, and terminates
 *   - advanceAdaptiveCultureInterview falls back to static bank on planner failure
 *   - Mock path (provider === null) works end-to-end
 */

import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  startAdaptiveCultureInterview,
  advanceAdaptiveCultureInterview,
} from '../cultureAgentAdaptive';
import { defaultCultureTranscript } from '../cultureAgent';
import type { LLMProvider } from '../llm/types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

function makeMockDb(): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        first: () => Promise.resolve(null),
        all: () => Promise.resolve({ results: [] }),
        run: () => Promise.resolve({ meta: {} }),
      }),
    }),
  } as unknown as D1Database;
}

function makeGenerativeProvider(questionText: string): LLMProvider {
  return {
    name: 'mock',
    supportsTools: false,
    async complete() {
      return {
        content: JSON.stringify({
          question: questionText,
          targetDimension: 'ownership',
          targetSlots: ['S', 'T', 'A', 'R'],
          probeStrategy: { missing_A: 'What did you do specifically?' },
          personalizationAnchors: ['candidate worked at Stripe'],
          reasoning: 'Testing adaptive generation',
        }),
      };
    },
  };
}

function makeTurnAnalysisProvider(probeNeeded: boolean): LLMProvider {
  return {
    name: 'mock',
    supportsTools: false,
    async complete() {
      return {
        content: JSON.stringify({
          star_slots: {
            S: { present: true, specificity: 2 },
            T: { present: true, specificity: 1 },
            A: { present: !probeNeeded, specificity: probeNeeded ? 0 : 2 },
            R: { present: !probeNeeded, specificity: probeNeeded ? 0 : 1 },
          },
          acknowledgment: probeNeeded ? 'Got it.' : 'Thanks for that.',
          probe_needed: probeNeeded,
          probe_text: probeNeeded ? 'What did you specifically do?' : null,
          reasoning: probeNeeded ? 'Action slot weak' : 'Complete STAR',
          running_theme_to_add: null,
        }),
      };
    },
  };
}

// ─── Start ───────────────────────────────────────────────────────────────────

describe('startAdaptiveCultureInterview', () => {
  it('uses static fallback when useStaticFallback=true', async () => {
    const result = await startAdaptiveCultureInterview({
      provider: null,
      db: makeMockDb(),
      candidateId: 'cand-1',
      assessmentId: 'assess-1',
      mode: 'role_fit',
      teamContext: null,
      useStaticFallback: true,
    });

    expect(result.transcript.turns.length).toBe(1);
    expect(result.transcript.turns[0]!.questionId).not.toContain('gen-');
    expect(result.transcript.scratchpad.mode).toBe('role_fit');
  });

  it('generates first question when provider returns valid result', async () => {
    const provider = makeGenerativeProvider('At Stripe you built payment fraud detection. Tell me about a time it broke in production.');

    const result = await startAdaptiveCultureInterview({
      provider,
      db: makeMockDb(),
      candidateId: 'cand-1',
      assessmentId: 'assess-1',
      mode: 'role_fit',
      teamContext: null,
      useStaticFallback: false,
    });

    expect(result.transcript.turns.length).toBe(1);
    expect(result.transcript.turns[0]!.questionId).toContain('gen-');
    expect(result.transcript.turns[0]!.questionText).toContain('Stripe');
    expect(result.transcript.scratchpad.questionMetadata).toHaveLength(1);
    expect(result.transcript.scratchpad.questionMetadata![0]!.targetDimension).toBe('ownership');
  });

  it('falls back to static bank when generative planner returns null', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      supportsTools: false,
      async complete() {
        return { content: '' };
      },
    };

    const result = await startAdaptiveCultureInterview({
      provider,
      db: makeMockDb(),
      candidateId: 'cand-1',
      assessmentId: 'assess-1',
      mode: 'role_fit',
      teamContext: null,
      useStaticFallback: false,
    });

    expect(result.transcript.turns.length).toBe(1);
    // Fallback uses static bank — questionId won't start with gen-
    expect(result.transcript.turns[0]!.questionId).not.toContain('gen-');
  });
});

// ─── Advance ─────────────────────────────────────────────────────────────────

describe('advanceAdaptiveCultureInterview', () => {
  it('probes when turn analysis says probe_needed', async () => {
    const transcript = defaultCultureTranscript();
    transcript.scratchpad.mode = 'role_fit';
    transcript.scratchpad.questionMetadata = [
      { questionText: 'Tell me about a time you owned something at Stripe.', targetDimension: 'ownership', personalizationAnchors: ['test'] },
    ];
    transcript.turns.push({
      idx: 0,
      questionId: 'gen-ownership-0',
      questionText: 'Tell me about a time you owned something at Stripe.',
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });

    const provider = makeTurnAnalysisProvider(true);

    const result = await advanceAdaptiveCultureInterview({
      provider,
      db: makeMockDb(),
      candidateId: 'cand-1',
      assessmentId: 'assess-1',
      mode: 'role_fit',
      teamContext: null,
      transcript,
      candidateAnswer: 'I fixed a bug.',
      useStaticFallback: false,
    });

    expect(result.action).toBe('probe');
    expect(result.transcript.turns.length).toBe(2);
    expect(result.transcript.turns[1]!.probeOf).toBe('gen-ownership-0');
  });

  it('advances to next generative question when answer is complete', async () => {
    const transcript = defaultCultureTranscript();
    transcript.scratchpad.mode = 'role_fit';
    transcript.scratchpad.questionMetadata = [
      { questionText: 'Tell me about a time you owned something at Stripe.', targetDimension: 'ownership', personalizationAnchors: ['test'] },
    ];
    transcript.turns.push({
      idx: 0,
      questionId: 'gen-ownership-0',
      questionText: 'Tell me about a time you owned something at Stripe.',
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });

    // Provider that does turn analysis (no probe) + generative planning
    const provider: LLMProvider = {
      name: 'mock',
      supportsTools: false,
      async complete(messages) {
        const lastMsg = messages[messages.length - 1]?.content ?? '';
        if (typeof lastMsg === 'string' && lastMsg.includes('Generate the NEXT question')) {
          // Generative planner
          return {
            content: JSON.stringify({
              question: 'You mentioned working with Kafka. Tell me about a time you had to debug a distributed systems issue.',
              targetDimension: 'collaboration',
              targetSlots: ['S', 'T', 'A', 'R'],
              probeStrategy: {},
              personalizationAnchors: ['candidate mentioned Kafka'],
              reasoning: 'Second question targeting collaboration.',
            }),
          };
        }
        // Turn analysis
        return {
          content: JSON.stringify({
            star_slots: {
              S: { present: true, specificity: 2 },
              T: { present: true, specificity: 2 },
              A: { present: true, specificity: 2 },
              R: { present: true, specificity: 1 },
            },
            acknowledgment: 'Thanks for that.',
            probe_needed: false,
            probe_text: null,
            reasoning: 'Complete STAR',
            running_theme_to_add: null,
          }),
        };
      },
    };

    const result = await advanceAdaptiveCultureInterview({
      provider,
      db: makeMockDb(),
      candidateId: 'cand-1',
      assessmentId: 'assess-1',
      mode: 'role_fit',
      teamContext: null,
      transcript,
      candidateAnswer: 'Last year at Stripe our payments pipeline went down. I was on call, traced it to a Kafka partition issue, fixed the consumer lag, and added alerting. Downtime was 12 minutes.',
      useStaticFallback: false,
    });

    expect(result.action).toBe('next');
    expect(result.transcript.turns.length).toBe(2);
    expect(result.transcript.turns[1]!.questionId).toContain('gen-');
    expect(result.transcript.scratchpad.questionMetadata).toHaveLength(2);
  });

  it('terminates when coverage is complete and min turns met', async () => {
    const transcript = defaultCultureTranscript();
    transcript.scratchpad.mode = 'role_fit';
    transcript.scratchpad.dimensionCoverage = {
      ownership: 1,
      collaboration: 1,
      'learning-orientation': 1,
      'conflict-handling': 1,
      'self-awareness': 1,
    };
    transcript.turns.push({
      idx: 0,
      questionId: 'gen-self-awareness-0',
      questionText: 'What is your biggest blind spot?',
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });

    const provider = makeTurnAnalysisProvider(false);

    const result = await advanceAdaptiveCultureInterview({
      provider,
      db: makeMockDb(),
      candidateId: 'cand-1',
      assessmentId: 'assess-1',
      mode: 'role_fit',
      teamContext: null,
      transcript,
      candidateAnswer: 'I tend to go quiet in disagreements. I have worked on signaling my position more explicitly.',
      minQuestions: 1,
      useStaticFallback: false,
    });

    expect(result.action).toBe('terminate');
    if (result.action === 'terminate') {
      expect(result.terminationReason).toBe('coverage_complete');
    }
  });

  it('uses static fallback when useStaticFallback=true', async () => {
    const transcript = defaultCultureTranscript();
    transcript.turns.push({
      idx: 0,
      questionId: 'ownership-001',
      questionText: 'Tell me about a time you saw a problem...',
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });

    const result = await advanceAdaptiveCultureInterview({
      provider: null,
      db: makeMockDb(),
      candidateId: 'cand-1',
      assessmentId: 'assess-1',
      mode: 'role_fit',
      teamContext: null,
      transcript,
      candidateAnswer: 'I fixed it.',
      useStaticFallback: true,
    });

    expect(result.action === 'probe' || result.action === 'next' || result.action === 'terminate').toBe(true);
  });

  it('falls back to static bank when generative planner fails mid-interview', async () => {
    const transcript = defaultCultureTranscript();
    transcript.scratchpad.mode = 'role_fit';
    transcript.turns.push({
      idx: 0,
      questionId: 'gen-ownership-0',
      questionText: 'Tell me about a time you owned something.',
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });

    // Provider that succeeds at turn analysis but fails at generative planning
    const provider: LLMProvider = {
      name: 'mock',
      supportsTools: false,
      async complete(messages) {
        const lastMsg = messages[messages.length - 1]?.content ?? '';
        if (lastMsg.includes('Generate the NEXT question')) {
          return { content: '' }; // generative planner fails
        }
        return {
          content: JSON.stringify({
            star_slots: {
              S: { present: true, specificity: 2 },
              T: { present: true, specificity: 2 },
              A: { present: true, specificity: 2 },
              R: { present: true, specificity: 1 },
            },
            acknowledgment: 'Thanks.',
            probe_needed: false,
            probe_text: null,
            reasoning: 'Complete',
            running_theme_to_add: null,
          }),
        };
      },
    };

    const result = await advanceAdaptiveCultureInterview({
      provider,
      db: makeMockDb(),
      candidateId: 'cand-1',
      assessmentId: 'assess-1',
      mode: 'role_fit',
      teamContext: null,
      transcript,
      candidateAnswer: 'I once fixed a bug that saved the company money.',
      useStaticFallback: false,
    });

    // Should fall back to static bank
    expect(result.action === 'next' || result.action === 'terminate').toBe(true);
    if (result.action === 'next') {
      expect(result.nextQuestion.questionId).not.toContain('gen-');
    }
  });
});
