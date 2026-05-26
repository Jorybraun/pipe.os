/**
 * Text-to-Speech proxy — Google Cloud TTS Neural2 voices.
 *
 * POST /api/v1/tts  { text: string, voice?: string }  →  { audioContent: string }  (base64 MP3)
 *
 * Uses the same GCP service account as Vertex AI (VERTEX_SA_KEY_JSON).
 * Requires the Cloud Text-to-Speech API to be enabled on the project and the
 * service account to have the roles/cloudtexttospeech.user role.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getAccessToken, type ServiceAccountKey } from '../lib/llm/vertexAuth';
import type { Env, Variables } from '../types';

export const ttsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

ttsRouter.use('*', authMiddleware);

const bodySchema = z.object({
  text: z.string().min(1).max(2000),
  /** Override the default voice name. */
  voice: z.string().optional(),
});

ttsRouter.post('/', async (c) => {
  const raw = c.env.VERTEX_SA_KEY_JSON;
  if (!raw) {
    return c.json({ error: { code: 'TTS_UNAVAILABLE', message: 'TTS not configured' } }, 503);
  }

  let sa: ServiceAccountKey;
  try {
    sa = JSON.parse(raw) as ServiceAccountKey;
  } catch {
    return c.json({ error: { code: 'TTS_UNAVAILABLE', message: 'TTS misconfigured' } }, 503);
  }

  const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'text is required (max 2000 chars)' } }, 422);
  }

  const { text, voice = 'en-US-Neural2-F' } = parsed.data;

  let token: string;
  try {
    token = await getAccessToken(sa);
  } catch (err) {
    console.error('[tts] Failed to get access token:', err);
    return c.json({ error: { code: 'TTS_AUTH_FAILED', message: 'TTS auth failed' } }, 502);
  }

  const resp = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'en-US', name: voice },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('[tts] Google Cloud TTS error:', resp.status, body);
    return c.json({ error: { code: 'TTS_UPSTREAM_ERROR', message: `TTS upstream error: ${resp.status}` } }, 502);
  }

  const data = await resp.json<{ audioContent: string }>();
  return c.json({ audioContent: data.audioContent });
});
