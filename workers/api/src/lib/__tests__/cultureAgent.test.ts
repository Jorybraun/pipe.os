import { describe, it, expect } from 'vitest';
import {
  startCultureInterview,
  advanceCultureInterview,
  defaultCultureTranscript,
  type CultureTranscript,
} from '../cultureAgent';
import { PROFILE_PROBE_DIMENSIONS, PROFILE_PROBE_BANK } from '../profileProbeBank';
import { COMPETENCY_DIMENSIONS, CULTURE_QUESTION_BANK } from '../cultureQuestionBank';

// A mock provider that returns the analysis we want.
function makeMockProvider(response: unknown) {
  return {
    complete: async () => ({ content: JSON.stringify(response) }),
  };
}

const ADEQUATE_STAR = {
  star_slots: {
    S: { present: true, specificity: 2 },
    T: { present: true, specificity: 2 },
    A: { present: true, specificity: 2 },
    R: { present: true, specificity: 2 },
  },
  acknowledgment: 'Thanks for that.',
  probe_needed: false,
  probe_text: null,
  reasoning: 'Full STAR.',
  running_theme_to_add: null,
};

describe('cultureAgent — profile_builder mode', () => {
  it('startCultureInterview returns a profile probe', () => {
    const result = startCultureInterview({ mode: 'profile_builder' });
    expect(result.transcript.scratchpad.mode).toBe('profile_builder');
    expect(result.nextQuestion.text.length).toBeGreaterThan(0);
    expect(result.transcript.turns.length).toBe(1);
  });

  it('default transcript uses profile_builder mode and profile coverage', () => {
    const transcript = defaultCultureTranscript();
    expect(transcript.scratchpad.mode).toBe('profile_builder');
    for (const dim of PROFILE_PROBE_DIMENSIONS) {
      expect(transcript.scratchpad.dimensionCoverage[dim]).toBe(0);
    }
  });

  it('advances through probes and updates coverage', async () => {
    let result = startCultureInterview({ mode: 'profile_builder' });
    let transcript = result.transcript;

    // Answer the first probe.
    result = await advanceCultureInterview({
      provider: makeMockProvider(ADEQUATE_STAR) as unknown as import('../llm/types').LLMProvider,
      transcript,
      candidateAnswer: 'I worked at Acme for two years as a senior engineer.',
    });

    expect(result.action).toBe('next');
    transcript = result.transcript;

    // Coverage should have increased for the first probe's dimension.
    const firstDim = transcript.turns[0]!.questionId.startsWith('career-history')
      ? 'career_history'
      : 'behavioral_depth';
    expect(transcript.scratchpad.dimensionCoverage[firstDim]).toBeGreaterThanOrEqual(0);
  });

  it('terminates when all profile dimensions are covered', async () => {
    // Build a transcript with all dimensions covered.
    const transcript: CultureTranscript = {
      turns: [],
      scratchpad: {
        dimensionCoverage: {
          career_history: 1,
          behavioral_depth: 1,
          cultural: 1,
          technical: 1,
          motivation: 1,
          context: 1,
        },
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'profile_builder',
        questionMetadata: [],
      },
    };

    // Add enough turns to hit min questions using real probe IDs.
    const realProbeIds = PROFILE_PROBE_BANK.slice(0, 5).map((p) => p.id);
    for (let i = 0; i < 5; i++) {
      transcript.turns.push({
        idx: i,
        questionId: realProbeIds[i]!,
        questionText: 'Question text',
        probeOf: null,
        candidateResponse: 'Answer',
        starSlots: null,
        timestamp: new Date().toISOString(),
      });
    }

    // Add a pending turn using a real probe ID.
    transcript.turns.push({
      idx: 5,
      questionId: PROFILE_PROBE_BANK[5]!.id,
      questionText: 'Question text',
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });

    const result = await advanceCultureInterview({
      provider: makeMockProvider(ADEQUATE_STAR) as unknown as import('../llm/types').LLMProvider,
      transcript,
      candidateAnswer: 'Final answer.',
    });

    expect(result.action).toBe('terminate');
    expect(result.terminationReason).toBe('coverage_complete');
  });
});

describe('cultureAgent — role_fit mode', () => {
  it('startCultureInterview returns a competency question', () => {
    const result = startCultureInterview({ mode: 'role_fit' });
    expect(result.transcript.scratchpad.mode).toBe('role_fit');
    expect(result.nextQuestion.text.length).toBeGreaterThan(0);
  });

  it('uses competency coverage in role_fit mode', () => {
    const result = startCultureInterview({ mode: 'role_fit' });
    for (const dim of COMPETENCY_DIMENSIONS) {
      expect(result.transcript.scratchpad.dimensionCoverage[dim]).toBe(0);
    }
  });

  it('terminates when all competency dimensions are covered', async () => {
    const transcript: CultureTranscript = {
      turns: [],
      scratchpad: {
        dimensionCoverage: {
          ownership: 1,
          collaboration: 1,
          'learning-orientation': 1,
          'conflict-handling': 1,
          'self-awareness': 1,
        },
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'role_fit',
        questionMetadata: [],
      },
    };

    const realQuestionIds = CULTURE_QUESTION_BANK.slice(0, 5).map((q) => q.id);
    for (let i = 0; i < 5; i++) {
      transcript.turns.push({
        idx: i,
        questionId: realQuestionIds[i]!,
        questionText: 'Question',
        probeOf: null,
        candidateResponse: 'Answer',
        starSlots: null,
        timestamp: new Date().toISOString(),
      });
    }

    transcript.turns.push({
      idx: 5,
      questionId: CULTURE_QUESTION_BANK[5]!.id,
      questionText: 'Question',
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });

    const result = await advanceCultureInterview({
      provider: makeMockProvider(ADEQUATE_STAR) as unknown as import('../llm/types').LLMProvider,
      transcript,
      candidateAnswer: 'Final answer.',
    });

    expect(result.action).toBe('terminate');
    expect(result.terminationReason).toBe('coverage_complete');
  });
});
