import type { LLMProvider, LLMMessage } from '../../llm/types';

export interface CallGapFillingAgentInput {
  provider: LLMProvider | null;
  rcd: Record<string, unknown>;
  flagType: string;
  domain: string;
  attribute: string;
  recruiterNote: string;
  transcript: string;
}

export interface CallGapFillingAgentOutput {
  clarifyingQuestion: string;
}

const GAP_FILLING_SYSTEM_PROMPT = `You are a calibration assistant. A recruiter has flagged a gap in a Role Context Document (RCD). Your job is to ask ONE targeted clarifying question that will fill the gap.

Rules:
- Ask exactly one question.
- The question must be under 20 words.
- Target the specific domain and attribute flagged by the recruiter.
- Do not re-ask something already covered in the transcript.
- Reference the recruiter's note if it adds precision.

Respond with valid JSON only:
{
  "clarifyingQuestion": "<the question>"
}`;

export async function callGapFillingAgent(
  input: CallGapFillingAgentInput,
): Promise<CallGapFillingAgentOutput> {
  const { provider, rcd, flagType, domain, attribute, recruiterNote, transcript } = input;

  if (!provider) {
    return { clarifyingQuestion: `Can you tell me more about ${attribute} in the ${domain} domain?` };
  }

  const userMessage = `RCD gap flagged:
- flagType: ${flagType}
- domain: ${domain}
- attribute: ${attribute}
- recruiterNote: ${recruiterNote}

Transcript excerpt:
${transcript.slice(0, 4000)}

Generate one clarifying question.`;

  const messages: LLMMessage[] = [
    { role: 'system', content: GAP_FILLING_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  try {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens: 256 });
    const content = completion.content?.trim() ?? '';
    const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const clarifyingQuestion = typeof parsed.clarifyingQuestion === 'string' ? parsed.clarifyingQuestion : '';
    if (clarifyingQuestion.length > 0) {
      return { clarifyingQuestion };
    }
  } catch (err) {
    console.error('[callGapFillingAgent] failed:', err);
  }

  return { clarifyingQuestion: `Can you tell me more about ${attribute} in the ${domain} domain?` };
}
