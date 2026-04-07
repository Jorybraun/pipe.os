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

interface DeepgramAlternative {
  transcript: string;
  paragraphs?: { transcript: string };
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{ alternatives: DeepgramAlternative[] }>;
  };
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
  const response = await fetch(
    'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&paragraphs=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'audio/mpeg',
      },
      body: audioBuffer,
    },
  );

  if (!response.ok) {
    console.error('[transcribe] Deepgram error:', response.status, await response.text());
    return null;
  }

  const data = (await response.json()) as DeepgramResponse;
  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) return null;

  return alt.paragraphs?.transcript ?? (alt.transcript || null);
}
