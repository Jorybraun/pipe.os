import type { RoomAssessmentProgressSnapshot } from '../types';

export interface AssessmentAiUseSummary {
  label: string;
  coverageLabel: string | null;
  detail: string;
  tone: 'captured' | 'blocked' | 'waiting';
}

function sourceRefCount(progress: RoomAssessmentProgressSnapshot, kind: string): number {
  return progress.sourceRefCounts?.find((row) => row.kind === kind)?.count ?? 0;
}

function unitLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function summarizeAssessmentAiUse(progress: RoomAssessmentProgressSnapshot): AssessmentAiUseSummary {
  const agentResponses = sourceRefCount(progress, 'ai_agent_response')
    + sourceRefCount(progress, 'agent_response');
  const sentPrompts = sourceRefCount(progress, 'ai_user_prompt');
  const blockedPrompts = sourceRefCount(progress, 'ai_user_prompt_blocked');
  const bridgeDiagnostics = sourceRefCount(progress, 'ai_agent_diagnostic')
    + sourceRefCount(progress, 'agent_diagnostic');
  const usageEvents = sourceRefCount(progress, 'ai_usage_event');

  if (agentResponses > 0) {
    const promptPart = sentPrompts > 0 ? `${unitLabel(sentPrompts, 'prompt')} and ` : '';
    return {
      label: 'AI response captured',
      coverageLabel: 'AI response',
      detail: `${promptPart}${unitLabel(agentResponses, 'agent response')} captured from the real agent bridge.`,
      tone: 'captured',
    };
  }

  if (blockedPrompts > 0) {
    return {
      label: 'AI prompt blocked',
      coverageLabel: 'AI prompt blocked',
      detail: `${unitLabel(blockedPrompts, 'blocked prompt')} captured. A prompt was blocked or the bridge was unavailable; no agent response is counted as assistance.`,
      tone: 'blocked',
    };
  }

  if (sentPrompts > 0) {
    return {
      label: 'AI prompt captured',
      coverageLabel: 'AI prompt',
      detail: `${unitLabel(sentPrompts, 'prompt')} sent to the real agent bridge; no agent response is captured yet.`,
      tone: 'captured',
    };
  }

  if (bridgeDiagnostics > 0) {
    return {
      label: 'AI bridge diagnostic',
      coverageLabel: 'AI bridge diagnostic',
      detail: `${unitLabel(bridgeDiagnostics, 'bridge diagnostic')} captured; no agent response is counted as assistance.`,
      tone: 'blocked',
    };
  }

  if (usageEvents > 0 || progress.hasAiInteraction) {
    return {
      label: 'AI bridge trace captured',
      coverageLabel: 'AI trace',
      detail: 'AI prompts, responses, or bridge traces are part of the source-backed evidence trail.',
      tone: 'captured',
    };
  }

  return {
    label: 'No AI use captured',
    coverageLabel: null,
    detail: 'No candidate AI-assistance evidence is attached; treat AI use as unobserved, not absent.',
    tone: 'waiting',
  };
}
