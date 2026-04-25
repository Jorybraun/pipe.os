/**
 * Code Review Agent Plugin
 *
 * Registers the code review agent with the Unified Agent Runtime.
 * Stub for Phase 3 migration.
 */

import type { AgentPlugin, AgentTurn } from '../../unifiedAgentRuntime/types';

export const codeReviewPlugin: AgentPlugin = {
  type: 'code_review',

  fsmConfig: {
    canAdvance: () => true,
    canTerminate: (session) => {
      const verdictReached = session.transcript.scratchpad.verdictReached === true;
      return verdictReached || session.transcript.turns.length >= 20;
    },
    minTurns: 3,
    maxTurns: 20,
  },

  async generateTurn(session): Promise<AgentTurn> {
    const idx = session.transcript.turns.length;
    return {
      idx,
      questionText: `Mock code review turn #${idx + 1}`,
      timestamp: new Date().toISOString(),
      questionId: undefined,
      candidateResponse: undefined,
      metadata: { round: idx },
    };
  },

  evalConfig: {
    dimensions: [
      {
        id: 'bug_disclosure',
        promptTemplate: `Check that the response does not accidentally disclose planted bugs. Return JSON: { "verdict": "pass"|"fail"|"warn", "score": 0-1, "reason": "..." }`,
        model: undefined,
        weight: undefined,
      },
      {
        id: 'tone_drift',
        promptTemplate: `Check for tone drift from the assigned persona. Return JSON: { "verdict": "pass"|"fail"|"warn", "score": 0-1, "reason": "..." }`,
        model: undefined,
        weight: undefined,
      },
    ],
    approvalRule: 'no_fail',
    minScore: undefined,
    maxRetries: 2,
  },

  scoringConfig: {
    dimensions: [
      { id: 'issue_identification', weight: 0.2, promptTemplate: 'Score issue identification depth 1-5', model: undefined },
      { id: 'reasoning_quality', weight: 0.2, promptTemplate: 'Score reasoning quality 1-5', model: undefined },
      { id: 'prioritization', weight: 0.15, promptTemplate: 'Score prioritization accuracy 1-5', model: undefined },
      { id: 'question_formation', weight: 0.15, promptTemplate: 'Score question formation 1-5', model: undefined },
      { id: 'revision_evaluation', weight: 0.2, promptTemplate: 'Score revision evaluation 1-5', model: undefined },
      { id: 'ai_direction', weight: 0.1, promptTemplate: 'Score AI direction 1-5', model: undefined },
    ],
    groundingRequirement: true,
    synthesisTemplate: `Synthesize a hiring narrative from dimension scores. Return JSON: { "narrative": "...", "recommendation": "hire"|"flag"|"pass" }`,
  },
};
