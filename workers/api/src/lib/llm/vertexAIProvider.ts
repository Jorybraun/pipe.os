/**
 * Vertex AI provider — wraps aiplatform.googleapis.com with self-refreshing JWT auth.
 *
 * Auth: reads a GCP service account JSON from the VERTEX_SA_KEY_JSON env var, signs
 * a JWT using the Web Crypto API (no npm deps), exchanges it for an OAuth2 access
 * token, and caches the token in module-level state for ~55 minutes.
 *
 * Model: defaults to gemma-4-26b-a4b-it (confirmed Vertex AI MaaS). The 31B dense
 * model is not yet available as MaaS — if you need 31B, deploy a dedicated endpoint
 * via Vertex Model Garden and set VERTEX_AI_MODEL to your endpoint ID.
 *
 * DO NOT use googleAIProvider (generativelanguage.googleapis.com) from Workers —
 * Cloudflare's edge IPs are geo-blocked by that endpoint. Vertex AI is unaffected.
 *
 * Env vars (set in .dev.vars and wrangler.jsonc secrets):
 *   VERTEX_SA_KEY_JSON   — full GCP service account JSON string (required)
 *   VERTEX_AI_PROJECT_ID — GCP project ID (required, or read from SA JSON)
 *   VERTEX_AI_REGION     — GCP region (default: us-central1)
 *   VERTEX_AI_MODEL      — model ID (default: gemma-4-26b-a4b-it)
 */

import type { LLMProvider, LLMMessage, LLMCompletion, CompleteOptions } from './types';

// ─── Service account shape ───────────────────────────────────────────────────

export interface ServiceAccountKey {
  private_key: string;
  client_email: string;
  project_id: string;
}

// ─── Module-level token cache ─────────────────────────────────────────────────
// Workers isolates may reuse module-level state between requests on the same
// isolate. Cache hits cost 0ms; cache misses cost ~50ms for the token exchange.
// Worst case (cold isolate) is one extra round-trip per hour. Acceptable.

let _tokenCache: { token: string; expiresAt: number } | null = null;
let _cryptoKey: CryptoKey | null = null;

// ─── JWT helpers (pure Web Crypto — no npm) ───────────────────────────────────

function b64urlEncode(data: Uint8Array): string {
  let bin = '';
  for (const byte of data) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJson(obj: unknown): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function importKey(pemPrivateKey: string): Promise<CryptoKey> {
  const b64 = pemPrivateKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\n/g, '')
    .trim();
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-V1_5', hash: { name: 'SHA-256' } },
    false,
    ['sign'],
  );
}

async function signJwt(key: CryptoKey, payload: Record<string, unknown>): Promise<string> {
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const body = encodeJson(payload);
  const sigInput = `${header}.${body}`;
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-V1_5' },
    key,
    new TextEncoder().encode(sigInput),
  );
  return `${sigInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

// ─── Access token (with cache) ────────────────────────────────────────────────

export async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now) return _tokenCache.token;

  if (!_cryptoKey) {
    _cryptoKey = await importKey(sa.private_key);
  }

  const iat = Math.floor(now / 1000);
  const jwt = await signJwt(_cryptoKey, {
    iss: sa.client_email,
    sub: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new Error(`Vertex AI token exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Cache for expires_in minus a 5-minute buffer
  _tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in - 300) * 1000 };
  return _tokenCache.token;
}

// ─── Vertex AI content types ──────────────────────────────────────────────────

interface VertexAIPart {
  text?: string;
}

interface VertexAIContent {
  role: 'user' | 'model';
  parts: VertexAIPart[];
}

interface VertexAIResponse {
  candidates?: Array<{
    content?: { parts?: VertexAIPart[] };
    finishReason?: string;
  }>;
  error?: { code: number; message: string };
}

// ─── Message conversion ───────────────────────────────────────────────────────

function toVertexAIContents(messages: LLMMessage[]): VertexAIContent[] {
  const contents: VertexAIContent[] = [];
  let systemText = '';

  for (const m of messages) {
    if (m.role === 'system') {
      systemText = m.content ?? '';
      continue;
    }

    const role = m.role === 'assistant' ? 'model' : 'user';
    let text = m.content ?? '';

    if (role === 'user' && systemText) {
      text = `${systemText}\n\n---\n\n${text}`;
      systemText = '';
    }

    if (m.role === 'tool') {
      text = `Tool result (${m.toolName ?? 'unknown'}):\n${m.content ?? ''}`;
    }

    contents.push({ role, parts: [{ text }] });
  }

  return contents;
}

function extractText(response: VertexAIResponse): string | null {
  if (response.error) {
    throw new Error(`Vertex AI error ${response.error.code}: ${response.error.message}`);
  }
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  return text || null;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class VertexAIProvider implements LLMProvider {
  readonly name = 'vertex-ai';
  readonly supportsTools = false;

  constructor(
    private readonly serviceAccount: ServiceAccountKey,
    private readonly projectId: string,
    private readonly region = 'us-central1',
    private readonly model = 'gemma-4-26b-a4b-it',
  ) {}

  private buildUrl(method: 'generateContent' | 'streamGenerateContent'): string {
    // MaaS models (suffix -maas) are only available via the global endpoint host.
    // Custom/regional deployments use the regional host for lower latency.
    const host = this.model.endsWith('-maas')
      ? 'aiplatform.googleapis.com'
      : `${this.region}-aiplatform.googleapis.com`;
    const base = `https://${host}/v1`;
    const resource = `projects/${this.projectId}/locations/${this.region}/publishers/google/models/${this.model}`;
    const suffix = method === 'streamGenerateContent' ? `${method}?alt=sse` : method;
    return `${base}/${resource}:${suffix}`;
  }

  async complete(messages: LLMMessage[], options: CompleteOptions = {}): Promise<LLMCompletion> {
    const token = await getAccessToken(this.serviceAccount);
    const contents = toVertexAIContents(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 1024,
        ...(options.forceJson ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const res = await fetch(this.buildUrl('generateContent'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Vertex AI ${res.status}: ${err}`);
    }

    const data = (await res.json()) as VertexAIResponse;
    const content = extractText(data);
    if (!content) throw new Error('Vertex AI returned empty response');
    return { content };
  }

  async *completeStream(messages: LLMMessage[], options: CompleteOptions = {}): AsyncGenerator<string> {
    const token = await getAccessToken(this.serviceAccount);
    const contents = toVertexAIContents(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 1024,
        ...(options.forceJson ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const res = await fetch(this.buildUrl('streamGenerateContent'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Vertex AI ${res.status}: ${err}`);
    }

    if (!res.body) throw new Error('Vertex AI returned no body for stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') return;

        try {
          const chunk = JSON.parse(payload) as VertexAIResponse;
          if (chunk.error) throw new Error(`Vertex AI stream error ${chunk.error.code}: ${chunk.error.message}`);
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (part.text) yield part.text;
          }
        } catch (err) {
          if (err instanceof Error && err.message.startsWith('Vertex AI stream error')) throw err;
          // Ignore malformed chunks
        }
      }
    }
  }
}
