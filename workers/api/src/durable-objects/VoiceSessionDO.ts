/**
 * VoiceSessionDO — generic Durable Object for real-time voice interview sessions.
 *
 * Each voice session gets its own DO instance (keyed by session ID).
 * Proxies audio bidirectionally between a browser WebSocket client and a
 * LiveSession (Vertex AI Gemini Live or compatible provider). Buffers
 * transcript segments in memory and POSTs the full transcript to a callback
 * URL when the WebSocket closes.
 *
 * Lifecycle:
 *   1. Caller POSTs /__init with a VoiceSessionConfig → opens LiveSession.
 *   2. Browser connects via WebSocket upgrade at /__ws.
 *   3. Browser sends { type: 'audio', data: <base64 PCM16> } frames.
 *   4. AI audio responses are forwarded back as { type: 'audio', data: <base64> }.
 *   5. Transcript segments are forwarded as { type: 'transcript', role, text }.
 *   6. On WS close the full transcript is POSTed to completionCallbackUrl.
 *
 * Uses the Hibernation API — session state (config, transcript) is kept in
 * memory while active. Config is persisted to DO storage so the DO can
 * rehydrate correctly after hibernation. The LiveSession itself is not
 * persisted (it holds a live WebSocket connection to the AI); if the DO is
 * evicted mid-session the browser client will receive a WebSocket close event
 * and should reconnect.
 */

import type { DurableObjectState } from '@cloudflare/workers-types';
import type { LiveSession } from '../lib/llm/live/types';
import { createLiveProvider } from '../lib/llm/live/createLiveProvider';
import { logAiUsage } from '../lib/aiUsage';
import type { Env } from '../types';

// ─── Local types ──────────────────────────────────────────────────────────────

interface VoiceSessionConfig {
  /** Stable session identifier forwarded to the callback. */
  sessionId: string;
  /** System prompt injected into the LiveSession on open. */
  systemPrompt: string;
  /** Internal Worker URL to POST the completed transcript to. */
  completionCallbackUrl: string;
  /** Arbitrary metadata forwarded verbatim to the callback. */
  metadata: Record<string, unknown>;
  /** Shared secret included in X-Internal-Secret for callback auth. */
  internalSecret: string;
}

interface AudioClientMessage {
  type: 'audio';
  /** Base64-encoded PCM16 audio chunk. */
  data: string;
}

interface CloseClientMessage {
  type: 'close';
}

type ClientMessage = AudioClientMessage | CloseClientMessage;

// ─── Helpers (inlined from vertexLiveProvider.ts to avoid cross-file coupling) ─

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const array = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i]!);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer;
}

// ─── Durable Object ───────────────────────────────────────────────────────────

export class VoiceSessionDO {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  // In-memory session state (not persisted — lost if DO is evicted mid-session)
  private liveSession: LiveSession | null = null;
  private transcript: Array<{ role: 'user' | 'model'; text: string }> = [];
  private config: VoiceSessionConfig | null = null;

  // Flipped true when the Live session fires onError so `close()` can mark the
  // usage event as failed. Also set when /__init fails before a session exists.
  private errored = false;
  private errorMessage: string | null = null;

  // Set at /__init so we can log usage even when the Live session failed to open.
  private modelKey: string | null = null;
  // Wall-clock start time (ms) so we can record approximate session duration.
  private startedAtMs: number | null = null;
  // Prevent double-logging when webSocketClose + explicit close() both fire.
  private usageLogged = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ── HTTP handler ─────────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    // Rehydrate config from storage after hibernation before handling any request.
    if (this.config === null) {
      this.config = (await this.state.storage.get<VoiceSessionConfig>('config')) ?? null;
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/__init') {
      return this.handleInit(request);
    }

    if (url.pathname === '/__ws') {
      return this.handleWebSocket(request);
    }

    return new Response('Not found', { status: 404 });
  }

  // ── /__init handler ───────────────────────────────────────────────────────────

  /**
   * Initialises the session: persists config, opens a LiveSession, and wires
   * the session-level event handlers. Must be called before /__ws.
   */
  private async handleInit(request: Request): Promise<Response> {
    let config: VoiceSessionConfig;
    try {
      config = await request.json() as VoiceSessionConfig;
    } catch {
      return new Response('Invalid JSON body', { status: 400 });
    }

    // Persist so we survive hibernation
    await this.state.storage.put('config', config);
    this.config = config;

    // Open a LiveSession via the configured provider
    const provider = createLiveProvider(this.env);
    if (!provider) {
      return new Response('Live provider unavailable', { status: 503 });
    }

    this.startedAtMs = Date.now();

    let session: LiveSession;
    try {
      session = await provider.openSession({ systemPrompt: config.systemPrompt });
    } catch (err) {
      // Log a failure event so the dashboard reflects "interview attempted, session failed to open"
      // — this is the main reason we track both successful and failed calls.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[VoiceSessionDO] openSession failed:', msg);
      await logAiUsage(this.env.DB, {
        feature: 'voice_interview',
        refId: config.sessionId,
        provider: 'vertex-live',
        // Model key unknown until the session constructs — use a placeholder
        // that exists in MODEL_PRICING so cost stays at $0 instead of throwing.
        model: 'vertex/gemini-live-2.5-flash-native-audio',
        usage: {},
        success: false,
        errorMessage: msg,
      });
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : 'openSession failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
    this.liveSession = session;
    this.modelKey = session.getModelKey();

    // Transcript accumulation — also forwarded to the WS client once connected.
    // onAudio is wired per-connection in handleWebSocket so the handler always
    // targets the current server-side WebSocket.
    session.onTranscript((text, role) => {
      this.transcript.push({ role, text });
      // Forward to any active WS client via the hibernation-safe accessor
      const clients = this.state.getWebSockets('client');
      const payload = JSON.stringify({ type: 'transcript', role, text });
      for (const ws of clients) {
        try {
          ws.send(payload);
        } catch {
          // Client may have already closed
        }
      }
    });

    session.onError((err) => {
      console.error('[VoiceSessionDO] LiveSession error:', err.message);
      this.errored = true;
      this.errorMessage = err.message;
      // Null out so handleWebSocket returns 409 if browser connects after this fires
      this.liveSession = null;
      const clients = this.state.getWebSockets('client');
      const payload = JSON.stringify({ type: 'error', message: err.message });
      for (const ws of clients) {
        try {
          ws.send(payload);
          ws.close(1011, err.message.slice(0, 123));
        } catch {
          // Client may have already closed
        }
      }
    });

    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── /__ws handler ─────────────────────────────────────────────────────────────

  /**
   * Upgrades the HTTP request to a WebSocket. Registers an onAudio handler
   * on the LiveSession that targets this specific server-side socket so audio
   * chunks always reach the currently connected client.
   */
  private handleWebSocket(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 400 });
    }

    if (!this.liveSession) {
      return new Response('Session not initialised — POST /__init first', { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Accept with tag 'client' so we can retrieve it via getWebSockets('client')
    // after hibernation without relying on in-memory references.
    this.state.acceptWebSocket(server, ['client']);

    // Wire audio forwarding from the AI to this specific socket.
    // Re-registering replaces any previous handler set during a prior connection
    // to the same DO instance (e.g. a reconnect without re-init).
    this.liveSession.onAudio((chunk) => {
      const payload = JSON.stringify({
        type: 'audio',
        data: arrayBufferToBase64(chunk),
      });
      try {
        server.send(payload);
      } catch {
        // Client disconnected — ignore; webSocketClose will handle cleanup
      }
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // ── Hibernation API handlers ──────────────────────────────────────────────────

  /**
   * Receives messages from the browser client.
   * Expects JSON with shape { type: 'audio', data: string } or { type: 'close' }.
   */
  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const messageStr =
      typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage);

    let message: ClientMessage;
    try {
      message = JSON.parse(messageStr) as ClientMessage;
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    if (message.type === 'audio') {
      const buffer = base64ToArrayBuffer(message.data);
      this.liveSession?.sendAudio(buffer);
      return;
    }

    if (message.type === 'close') {
      await this.close(ws);
      return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string): Promise<void> {
    await this.close(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.webSocketClose(ws, 1011, 'error');
  }

  // ── Internal teardown ────────────────────────────────────────────────────────

  /**
   * Tears down the LiveSession and fires the completion callback with the
   * buffered transcript. Safe to call multiple times — idempotent via
   * liveSession null-check.
   */
  private async close(ws: WebSocket): Promise<void> {
    // Capture cumulative usage BEFORE closing — once we call close() the
    // underlying WebSocket may release and getUsageTotals would return zeros.
    const finalUsage = this.liveSession?.getUsageTotals() ?? null;
    const finalModelKey = this.liveSession?.getModelKey() ?? this.modelKey;

    // Close the AI session once, regardless of how many times close() is called
    if (this.liveSession) {
      this.liveSession.close();
      this.liveSession = null;
    }

    // Log usage exactly once per session. Both successful and failed sessions
    // are logged so the dashboard totals reflect real spend including aborts.
    if (!this.usageLogged && this.config && finalModelKey) {
      this.usageLogged = true;
      const durationSeconds = this.startedAtMs ? (Date.now() - this.startedAtMs) / 1000 : null;
      await logAiUsage(this.env.DB, {
        feature: 'voice_interview',
        refId: this.config.sessionId,
        provider: 'vertex-live',
        model: finalModelKey,
        usage: {
          inputTokens: finalUsage?.inputTextTokens ?? 0,
          outputTokens: finalUsage?.outputTextTokens ?? 0,
          inputAudioTokens: finalUsage?.inputAudioTokens ?? 0,
          outputAudioTokens: finalUsage?.outputAudioTokens ?? 0,
          ...(durationSeconds !== null ? { audioSeconds: durationSeconds } : {}),
        },
        success: !this.errored,
        ...(this.errorMessage ? { errorMessage: this.errorMessage } : {}),
      });
    }

    // Attempt to close the WebSocket cleanly (may already be closed)
    try {
      ws.close(1000, 'Session ended');
    } catch {
      // Already closed
    }

    // Fire-and-forget transcript callback
    if (this.config?.completionCallbackUrl && this.transcript.length > 0) {
      const { completionCallbackUrl, metadata, sessionId, internalSecret } = this.config;
      fetch(completionCallbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': internalSecret,
        },
        body: JSON.stringify({ transcript: this.transcript, metadata, sessionId }),
      }).catch((err: unknown) => {
        console.error(
          '[VoiceSessionDO] transcript callback failed:',
          err instanceof Error ? err.message : err,
        );
      });
    }
  }
}
