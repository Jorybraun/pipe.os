/**
 * VertexLiveProvider — Vertex AI Gemini Live WebSocket implementation.
 *
 * Connects to the Vertex AI BidiGenerateContent streaming API for real-time
 * bidirectional audio sessions. Uses PCM16 16kHz input and receives PCM16
 * 24kHz audio output alongside transcript segments.
 *
 * Endpoint: wss://{region}-aiplatform.googleapis.com/ws/
 *           google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent
 *
 * Auth: GCP service account (VERTEX_SA_KEY_JSON). Token is obtained via the
 * shared getAccessToken() helper from vertexAIProvider.ts (cached ~55 min).
 */

import type { LiveProvider, LiveSession, LiveSessionConfig } from './types';
import { getAccessToken } from '../vertexAIProvider';
import type { ServiceAccountKey } from '../vertexAIProvider';

// ─── Internal wire types ──────────────────────────────────────────────────────

interface VertexSetupMessage {
  setup: {
    model: string;
    systemInstruction: {
      parts: Array<{ text: string }>;
    };
    generationConfig: {
      responseModalities: string[];
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: string;
          };
        };
      };
    };
  };
}

interface VertexRealtimeInputMessage {
  realtimeInput: {
    mediaChunks: Array<{
      mimeType: string;
      data: string;
    }>;
  };
}

interface VertexTurnCompleteMessage {
  clientContent: {
    turnComplete: true;
  };
}

interface VertexInlineData {
  mimeType: string;
  data: string;
}

interface VertexPart {
  text?: string;
  inlineData?: VertexInlineData;
}

interface VertexServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: {
      parts?: VertexPart[];
    };
  };
  inputTranscription?: {
    text: string;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const array = new Uint8Array(buffer);
  let binary = '';
  for (const byte of array) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer;
}

// ─── Session implementation ───────────────────────────────────────────────────

class VertexLiveSession implements LiveSession {
  private readonly ws: WebSocket;
  private audioHandlers: Array<(chunk: ArrayBuffer) => void> = [];
  private transcriptHandlers: Array<(text: string, role: 'user' | 'model') => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];

  // Buffer audio chunks sent before the WS open event fires.
  // Cloudflare Workers throw if ws.send() is called while readyState === CONNECTING.
  private pendingAudio: ArrayBuffer[] = [];
  private wsOpen: boolean;

  // alreadyOpen=true when constructed from fetch()+Upgrade+accept() — the socket
  // is already in OPEN state and the open event may not fire.
  constructor(ws: WebSocket, alreadyOpen = false) {
    this.ws = ws;
    this.wsOpen = alreadyOpen;

    this.ws.addEventListener('open', () => {
      if (!this.wsOpen) {
        this.wsOpen = true;
        // Flush any audio that arrived before the connection was ready
        for (const chunk of this.pendingAudio) {
          this.sendAudioNow(chunk);
        }
        this.pendingAudio = [];
      }
    });

    this.ws.addEventListener('message', (event: MessageEvent) => {
      const data = event.data;
      if (data instanceof Blob) {
        data.text().then((text) => this.handleMessage(text)).catch(() => {
          const err = new Error('[VertexLiveSession] Failed to read Blob message');
          this.errorHandlers.forEach((h) => h(err));
        });
      } else if (data instanceof ArrayBuffer) {
        this.handleMessage(new TextDecoder().decode(data));
      } else {
        this.handleMessage(data as string);
      }
    });
    this.ws.addEventListener('error', () => {
      const err = new Error('[VertexLiveSession] WebSocket error');
      this.errorHandlers.forEach((h) => h(err));
    });
    this.ws.addEventListener('close', (event: CloseEvent) => {
      const code = event.code;
      const reason = event.reason || '(none)';
      console.error('[VertexLiveSession] WebSocket closed — code:', code, 'reason:', reason);
      if (code !== 1000) {
        const err = new Error(`[VertexLiveSession] closed code=${code} reason=${reason}`);
        this.errorHandlers.forEach((h) => h(err));
      }
    });
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (!this.wsOpen) {
      this.pendingAudio.push(chunk);
      return;
    }
    this.sendAudioNow(chunk);
  }

  private sendAudioNow(chunk: ArrayBuffer): void {
    const data = arrayBufferToBase64(chunk);
    const msg: VertexRealtimeInputMessage = {
      realtimeInput: {
        mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data }],
      },
    };
    this.ws.send(JSON.stringify(msg));
  }

  onAudio(handler: (chunk: ArrayBuffer) => void): void {
    this.audioHandlers.push(handler);
  }

  onTranscript(handler: (text: string, role: 'user' | 'model') => void): void {
    this.transcriptHandlers.push(handler);
  }

  onError(handler: (err: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  close(): void {
    const msg: VertexTurnCompleteMessage = {
      clientContent: { turnComplete: true },
    };
    if (this.wsOpen) {
      this.ws.send(JSON.stringify(msg));
    }
    this.ws.close();
  }

  private handleMessage(raw: string): void {
    let parsed: VertexServerMessage;
    try {
      parsed = JSON.parse(raw) as VertexServerMessage;
    } catch {
      const err = new Error(`[VertexLiveSession] Failed to parse message: ${raw}`);
      this.errorHandlers.forEach((h) => h(err));
      return;
    }

    if ('setupComplete' in parsed && parsed.setupComplete !== undefined) {
      console.log('[VertexLiveSession] Setup confirmed by server');
      return;
    }

    if (parsed.error !== undefined) {
      const { code, message, status } = parsed.error;
      const err = new Error(
        `[VertexLiveSession] API error ${code ?? ''} ${status ?? ''}: ${message ?? 'unknown'}`,
      );
      this.errorHandlers.forEach((h) => h(err));
      return;
    }

    const parts = parsed.serverContent?.modelTurn?.parts;
    if (parts !== undefined) {
      for (const part of parts) {
        if (part.inlineData !== undefined && typeof part.inlineData.data === 'string') {
          const buffer = base64ToArrayBuffer(part.inlineData.data);
          this.audioHandlers.forEach((h) => h(buffer));
        }
        if (typeof part.text === 'string') {
          this.transcriptHandlers.forEach((h) => h(part.text as string, 'model'));
        }
      }
    }

    if (parsed.inputTranscription?.text !== undefined) {
      const text = parsed.inputTranscription.text;
      this.transcriptHandlers.forEach((h) => h(text, 'user'));
    }
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

// Vertex AI Live API — GA model (2025-2026). Override via LiveSessionConfig.model if needed.
// Requires Vertex AI Live API to be enabled for the project in GCP Console.
const DEFAULT_MODEL = 'gemini-live-2.5-flash-native-audio';
const DEFAULT_VOICE = 'Puck';

export class VertexLiveProvider implements LiveProvider {
  readonly name = 'vertex-live';

  constructor(
    private readonly serviceAccount: ServiceAccountKey,
    private readonly projectId: string,
    private readonly region = 'us-central1',
    private readonly defaultModel = DEFAULT_MODEL,
  ) {}

  async openSession(config: LiveSessionConfig): Promise<LiveSession> {
    // Fetch token first (cached after first call — ~0 ms on warm isolate).
    const token = await getAccessToken(this.serviceAccount);
    const model = config.model ?? this.defaultModel;
    const voice = config.voice ?? DEFAULT_VOICE;

    const modelPath = `projects/${this.projectId}/locations/${this.region}/publishers/google/models/${model}`;
    // fetch() + Upgrade requires https:// not wss:// — Cloudflare Workers translate
    // the Upgrade header to a WebSocket handshake internally.
    const wsUrl =
      `https://${this.region}-aiplatform.googleapis.com/ws/` +
      `google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;

    // Use fetch() + Upgrade pattern — the only stable way to set Authorization
    // headers on an outbound WebSocket in Cloudflare Workers.
    const resp = await fetch(wsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Upgrade: 'websocket',
      },
    });

    const ws = resp.webSocket;
    if (!ws) {
      const body = await resp.text().catch(() => '(unreadable)');
      throw new Error(
        `[VertexLiveProvider] Vertex AI did not return a WebSocket (status ${resp.status}): ${body}`,
      );
    }

    // Required before any send() or addEventListener() with the fetch() pattern.
    ws.accept();

    // alreadyOpen=true: fetch()+accept() leaves the socket in OPEN state;
    // the open event may not fire, so we mark it open immediately.
    const session = new VertexLiveSession(ws, true);

    const setup: VertexSetupMessage = {
      setup: {
        model: modelPath,
        systemInstruction: {
          parts: [{ text: config.systemPrompt }],
        },
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      },
    };
    ws.send(JSON.stringify(setup));

    // Opening turn — sent after setup; server processes them in order.
    setTimeout(() => {
      const openingTurn = {
        clientContent: {
          turns: [
            {
              role: 'user',
              parts: [{ text: 'Hello. Please introduce yourself briefly and begin the interview with your first question.' }],
            },
          ],
          turnComplete: true,
        },
      };
      ws.send(JSON.stringify(openingTurn));
    }, 100);

    return session;
  }
}
