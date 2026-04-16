/**
 * VertexLiveProvider — Vertex AI Gemini Live WebSocket implementation.
 *
 * Connects to the Vertex AI BidiGenerateContent streaming API for real-time
 * bidirectional audio sessions. Uses PCM16 16kHz input and receives PCM16
 * 24kHz audio output alongside transcript segments.
 *
 * Endpoint: wss://us-central1-aiplatform.googleapis.com/ws/
 *           google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent
 */

import type { LiveProvider, LiveSession, LiveSessionConfig } from './types';

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

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(event.data as string);
    });
    this.ws.addEventListener('error', () => {
      const err = new Error('[VertexLiveSession] WebSocket error');
      this.errorHandlers.forEach((h) => h(err));
    });
  }

  sendAudio(chunk: ArrayBuffer): void {
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
    this.ws.send(JSON.stringify(msg));
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

    // Setup acknowledgement — nothing to forward to callers
    if ('setupComplete' in parsed && parsed.setupComplete !== undefined) {
      console.log('[VertexLiveSession] Setup confirmed by server');
      return;
    }

    // API-level error
    if (parsed.error !== undefined) {
      const { code, message, status } = parsed.error;
      const err = new Error(
        `[VertexLiveSession] API error ${code ?? ''} ${status ?? ''}: ${message ?? 'unknown'}`,
      );
      this.errorHandlers.forEach((h) => h(err));
      return;
    }

    // Model audio / transcript parts
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

    // User speech transcription (STT result echoed back by the server)
    if (parsed.inputTranscription?.text !== undefined) {
      const text = parsed.inputTranscription.text;
      this.transcriptHandlers.forEach((h) => h(text, 'user'));
    }
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'gemini-live-2.5-flash-native-audio';
const DEFAULT_VOICE = 'Puck';
const WS_BASE =
  'wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent';

export class VertexLiveProvider implements LiveProvider {
  readonly name = 'vertex-live';

  constructor(private readonly apiKey: string) {}

  openSession(config: LiveSessionConfig): LiveSession {
    const model = config.model ?? DEFAULT_MODEL;
    const voice = config.voice ?? DEFAULT_VOICE;

    const url = `${WS_BASE}?key=${this.apiKey}`;
    const ws = new WebSocket(url);

    const session = new VertexLiveSession(ws);

    ws.addEventListener('open', () => {
      const setup: VertexSetupMessage = {
        setup: {
          model: `models/${model}`,
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

      // Gemini Live is reactive — send an opening prompt so the agent speaks first.
      // Without this, the agent waits silently for user audio.
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
      }, 100); // Small delay to ensure setup is processed first
    });

    return session;
  }
}
