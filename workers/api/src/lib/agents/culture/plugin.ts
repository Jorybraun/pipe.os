/**
 * Culture Interview Agent Plugin
 *
 * Registers the culture interview agent with the Unified Agent Runtime.
 * Stub for Phase 4 build.
 */

import type { AgentPlugin, AgentTurn } from '../../unifiedAgentRuntime/types';

export const cultureInterviewPlugin: AgentPlugin = {
  type: 'culture_interview',

  fsmConfig: {
    canAdvance: () => true,
    canTerminate: (session) => {
      const coverage = session.transcript.scratchpad.dimensionCoverage as Record<string, number>;
      const dims = ['ownership', 'collaboration', 'learning-orientation', 'conflict-handling', 'self-awareness'];
      return dims.every((d) => (coverage[d] ?? 0) >= 1);
    },
    minTurns: 5,
    maxTurns: 20,
  },

  async generateTurn(session): Promise<AgentTurn> {
    // TODO(Phase 4): Wire to advanceAdaptiveCultureInterview via UAR orchestrator.
    // For now this is a stub — the production path is in routes/screening/culture.ts.
    const idx = session.transcript.turns.length;
    return {
      idx,
      questionText: `Mock culture interview turn #${idx + 1}`,
      timestamp: new Date().toISOString(),
      questionId: undefined,
      candidateResponse: undefined,
      metadata: { dimension: 'ownership' },
    };
  },

  evalConfig: {
    dimensions: [
      {
        id: 'star_completeness',
        promptTemplate: `Check that the candidate's response contains STAR elements. Return JSON: { "verdict": "pass"|"fail"|"warn", "score": 0-1, "reason": "..." }`,
        model: undefined,
        weight: 0.5,
      },
      {
        id: 'probe_appropriateness',
        promptTemplate: `Check that the probe is appropriate for the dimension. Return JSON: { "verdict": "pass"|"fail"|"warn", "score": 0-1, "reason": "..." }`,
        model: undefined,
        weight: 0.3,
      },
      {
        id: 'evasion_detection',
        promptTemplate: `Check for evasion or deflection in the candidate response. Return JSON: { "verdict": "pass"|"fail"|"warn", "score": 0-1, "reason": "..." }`,
        model: undefined,
        weight: 0.2,
      },
    ],
    approvalRule: 'weighted',
    minScore: 0.6,
    maxRetries: undefined,
  },

  scoringConfig: {
    dimensions: [
      // 5 competency dimensions (BARS rubric scoring)
      { id: 'ownership', weight: 0.1, promptTemplate: 'Score ownership 1-5 using BARS anchors', model: undefined },
      { id: 'collaboration', weight: 0.1, promptTemplate: 'Score collaboration 1-5 using BARS anchors', model: undefined },
      { id: 'learning-orientation', weight: 0.1, promptTemplate: 'Score learning-orientation 1-5 using BARS anchors', model: undefined },
      { id: 'conflict-handling', weight: 0.1, promptTemplate: 'Score conflict-handling 1-5 using BARS anchors', model: undefined },
      { id: 'self-awareness', weight: 0.1, promptTemplate: 'Score self-awareness 1-5 using BARS anchors', model: undefined },
      // 5 culture-profile axes (position on a 1-5 spectrum)
      { id: 'autonomy', weight: 0.1, promptTemplate: 'Score autonomy 1-5 using profile anchors', model: undefined },
      { id: 'risk-tolerance', weight: 0.1, promptTemplate: 'Score risk-tolerance 1-5 using profile anchors', model: undefined },
      { id: 'work-pace', weight: 0.1, promptTemplate: 'Score work-pace 1-5 using profile anchors', model: undefined },
      { id: 'collaboration-style', weight: 0.1, promptTemplate: 'Score collaboration-style 1-5 using profile anchors', model: undefined },
      { id: 'feedback-orientation', weight: 0.1, promptTemplate: 'Score feedback-orientation 1-5 using profile anchors', model: undefined },
    ],
    groundingRequirement: true,
    synthesisTemplate: `Synthesize a culture fit assessment. Return JSON: { "narrative": "...", "recommendation": "hire"|"flag"|"pass" }`,
  },
};
