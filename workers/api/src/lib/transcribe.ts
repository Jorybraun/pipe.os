/**
 * Audio transcription — Cloudflare Workers AI Whisper (primary) + Deepgram (fallback).
 *
 * Workers AI Whisper is free with your Workers plan and runs at the edge.
 * Deepgram Nova-2 is available as a paid fallback with speaker diarization.
 */

// ─── Workers AI Whisper (free, primary) ─────────────────────────────────────

/**
 * Transcribes audio using Cloudflare Workers AI Whisper.
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
    const result = await ai.run(
      '@cf/openai/whisper' as Parameters<typeof ai.run>[0],
      { audio: [...new Uint8Array(audioBuffer)] },
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
