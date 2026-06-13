/**
 * Audio transcription — Cloudflare Workers AI Whisper (primary) + Deepgram (fallback).
 *
 * Uses whisper-large-v3-turbo on Workers AI ($0.00051 per audio minute, same
 * price as the small whisper model but materially better accuracy). Deepgram
 * Nova-2 is available as a paid fallback with speaker diarization.
 */

// ─── Workers AI Whisper large-v3-turbo (primary) ────────────────────────────

/**
 * Base64-encodes an ArrayBuffer without hitting the 2^16 argument limit on
 * String.fromCharCode for large buffers. Workers runtime does not expose
 * Node's Buffer by default, so we chunk-encode manually.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Transcribes audio using Cloudflare Workers AI Whisper large-v3-turbo.
 *
 * @param ai - Workers AI binding (c.env.AI)
 * @param audioBuffer - Raw audio bytes (MP3, WebM, WAV, etc.)
 * @returns Transcript string, or null on failure
 */
export async function transcribeAudioWhisper(
  ai: Ai,
  audioBuffer: ArrayBuffer,
): Promise<string | null> {
  try {
    const audioBase64 = arrayBufferToBase64(audioBuffer);
    const result = await ai.run(
      '@cf/openai/whisper-large-v3-turbo' as Parameters<typeof ai.run>[0],
      { audio: audioBase64 } as unknown as Parameters<typeof ai.run>[1],
    ) as { text?: string };

    const text = result.text?.trim() || null;
    if (text) {
      console.log('[transcribe] Whisper result:', text.slice(0, 100));
    }
    return text;
  } catch (err) {
    console.error('[transcribe] Whisper failed:', err);
    return null;
  }
}

// ─── Deepgram Nova-2 (paid fallback with diarization) ───────────────────────

interface DeepgramWord {
  word?: unknown;
  punctuated_word?: unknown;
  start?: unknown;
  end?: unknown;
  confidence?: unknown;
  speaker?: unknown;
}

interface DeepgramAlternative {
  transcript: string;
  paragraphs?: { transcript: string };
  confidence?: unknown;
  words?: DeepgramWord[];
}

interface DeepgramResponse {
  metadata?: {
    channels?: unknown;
  };
  results?: {
    channels?: Array<{ alternatives: DeepgramAlternative[] }>;
    utterances?: Array<{
      id?: unknown;
      transcript?: unknown;
      start?: unknown;
      end?: unknown;
      confidence?: unknown;
      channel?: unknown;
      speaker?: unknown;
    }>;
  };
}

export interface StructuredTranscriptionSegment {
  stableSegmentId: string;
  text: string;
  channel: number | null;
  speakerLabel: string | null;
  timestampStartMs: number | null;
  timestampEndMs: number | null;
  confidence: number | null;
  providerSegmentId: string | null;
}

export interface StructuredTranscription {
  provider: string;
  model: string;
  channelCount: number | null;
  segments: StructuredTranscriptionSegment[];
  transcript: string;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric >= 0 ? Math.floor(numeric) : null;
}

function confidenceScore(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric >= 0 && numeric <= 1 ? numeric : null;
}

function timestampPair(
  startSeconds: unknown,
  endSeconds: unknown,
): [number | null, number | null] {
  const start = finiteNumber(startSeconds);
  const end = finiteNumber(endSeconds);
  if (start === null || end === null || start < 0 || end < start) return [null, null];
  return [Math.round(start * 1000), Math.round(end * 1000)];
}

export function parseDeepgramStructuredTranscription(
  value: unknown,
): StructuredTranscription | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as DeepgramResponse;
  const utterances = Array.isArray(data.results?.utterances)
    ? data.results.utterances
    : [];
  const parsed: Array<Omit<StructuredTranscriptionSegment, 'stableSegmentId'>> = [];

  for (const utterance of utterances) {
    const text = typeof utterance.transcript === 'string'
      ? utterance.transcript.trim()
      : '';
    if (!text) continue;
    const channel = nonNegativeInteger(utterance.channel);
    const speaker = nonNegativeInteger(utterance.speaker);
    const [timestampStartMs, timestampEndMs] = timestampPair(
      utterance.start,
      utterance.end,
    );
    parsed.push({
      text,
      channel,
      speakerLabel: speaker === null ? null : `speaker-${speaker}`,
      timestampStartMs,
      timestampEndMs,
      confidence: confidenceScore(utterance.confidence),
      providerSegmentId: typeof utterance.id === 'string' ? utterance.id : null,
    });
  }

  if (parsed.length === 0) {
    for (const [channelIndex, channel] of (data.results?.channels ?? []).entries()) {
      const alternative = channel.alternatives?.[0];
      const text = alternative?.transcript?.trim();
      if (!alternative || !text) continue;
      const words = Array.isArray(alternative.words) ? alternative.words : [];
      const firstWord = words[0];
      const lastWord = words[words.length - 1];
      const [timestampStartMs, timestampEndMs] = timestampPair(
        firstWord?.start,
        lastWord?.end,
      );
      const speakers = new Set(
        words
          .map((word) => nonNegativeInteger(word.speaker))
          .filter((speaker): speaker is number => speaker !== null),
      );
      parsed.push({
        text,
        channel: channelIndex,
        speakerLabel: speakers.size === 1 ? `speaker-${[...speakers][0]}` : null,
        timestampStartMs,
        timestampEndMs,
        confidence: confidenceScore(alternative.confidence),
        providerSegmentId: null,
      });
    }
  }

  parsed.sort((left, right) => {
    const leftStart = left.timestampStartMs ?? Number.MAX_SAFE_INTEGER;
    const rightStart = right.timestampStartMs ?? Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) return leftStart - rightStart;
    return (left.channel ?? Number.MAX_SAFE_INTEGER) - (right.channel ?? Number.MAX_SAFE_INTEGER);
  });
  if (parsed.length === 0) return null;
  const segments = parsed.map((segment, index) => ({
    ...segment,
    stableSegmentId: `utterance-${String(index + 1).padStart(4, '0')}`,
  }));
  const inferredChannelCount = new Set(
    segments
      .map((segment) => segment.channel)
      .filter((channel): channel is number => channel !== null),
  ).size;
  return {
    provider: 'deepgram',
    model: 'nova-3',
    channelCount: nonNegativeInteger(data.metadata?.channels)
      ?? (inferredChannelCount > 0 ? inferredChannelCount : null),
    segments,
    transcript: segments.map((segment) => segment.text).join('\n\n'),
  };
}

export async function transcribeAudioDeepgramStructured(
  audioBuffer: ArrayBuffer,
  apiKey: string,
  contentType = 'audio/webm',
): Promise<StructuredTranscription | null> {
  const response = await fetch(
    'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&utterances=true&multichannel=true&diarize=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': contentType,
      },
      body: audioBuffer,
    },
  );

  if (!response.ok) {
    console.error('[transcribe] Deepgram error:', response.status, await response.text());
    return null;
  }
  return parseDeepgramStructuredTranscription(await response.json());
}

/**
 * Transcribes audio using Deepgram Nova-2 with speaker diarization.
 * Use when you need speaker labels (e.g. phone calls with two parties).
 *
 * @param audioBuffer - Raw audio bytes (MP3 or WAV)
 * @param apiKey - Deepgram API key
 * @returns Formatted transcript with speaker labels, or null on failure
 */
export async function transcribeAudioDeepgram(
  audioBuffer: ArrayBuffer,
  apiKey: string,
): Promise<string | null> {
  return (await transcribeAudioDeepgramStructured(
    audioBuffer,
    apiKey,
    'audio/mpeg',
  ))?.transcript ?? null;
}
