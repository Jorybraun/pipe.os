import { describe, expect, it } from 'vitest';
import { summarizeAssessmentAiUse } from './aiUseSummary';
import type { RoomAssessmentProgressSnapshot } from '../types';

function progressWithSourceRefs(
  sourceRefCounts: Array<{ kind: string; count: number }>,
  hasAiInteraction = true,
): RoomAssessmentProgressSnapshot {
  return {
    mode: 'OPEN_SOURCE_BUG_FIX',
    state: 'FINAL_SUBMITTED',
    stage: 'READY_FOR_EVALUATION',
    nextAction: 'START_EVALUATION',
    nextActionLabel: 'Start source-backed AI or human evaluation.',
    hasChallengePacket: true,
    hasWorkEvidence: true,
    hasMessageEvidence: true,
    hasDevContainerEvidence: true,
    hasToolUsageEvidence: true,
    hasCommitSubmission: true,
    hasFinalSubmission: true,
    hasAiInteraction,
    hasTranscriptEvidence: false,
    hasTestEvidence: true,
    evidenceCounts: [],
    sourceRefCounts,
    latestEvent: null,
    commit: null,
    evaluation: null,
  };
}

describe('summarizeAssessmentAiUse', () => {
  it('counts current real agent responses as captured AI assistance', () => {
    const summary = summarizeAssessmentAiUse(progressWithSourceRefs([
      { kind: 'ai_user_prompt', count: 2 },
      { kind: 'ai_agent_response', count: 1 },
    ]));

    expect(summary).toMatchObject({
      label: 'AI response captured',
      coverageLabel: 'AI response',
      detail: '2 prompts and 1 agent response captured from the real agent bridge.',
      tone: 'captured',
    });
  });

  it('keeps legacy agent response refs visible in the room summary', () => {
    const summary = summarizeAssessmentAiUse(progressWithSourceRefs([
      { kind: 'agent_response', count: 1 },
    ]));

    expect(summary.label).toBe('AI response captured');
    expect(summary.detail).toBe('1 agent response captured from the real agent bridge.');
  });

  it('surfaces bridge diagnostics without counting them as agent help', () => {
    const summary = summarizeAssessmentAiUse(progressWithSourceRefs([
      { kind: 'ai_agent_diagnostic', count: 1 },
      { kind: 'agent_diagnostic', count: 1 },
    ], false));

    expect(summary).toMatchObject({
      label: 'AI bridge diagnostic',
      coverageLabel: 'AI bridge diagnostic',
      detail: '2 bridge diagnostics captured; no agent response is counted as assistance.',
      tone: 'blocked',
    });
  });

  it('surfaces bridge statuses without counting them as agent help', () => {
    const summary = summarizeAssessmentAiUse(progressWithSourceRefs([
      { kind: 'agent_status', count: 2 },
    ]));

    expect(summary).toMatchObject({
      label: 'AI bridge status',
      coverageLabel: 'AI bridge status',
      detail: '2 bridge statuses captured; no agent response is counted as assistance.',
      tone: 'waiting',
    });
  });
});
