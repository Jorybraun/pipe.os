/**
 * LiveProvider — real-time bidirectional audio AI abstraction.
 *
 * Mirrors the LLMProvider interface pattern for text models but targets
 * streaming audio sessions (Vertex AI Gemini Live, OpenAI Realtime, etc.).
 * The factory function createLiveProvider(env) selects the implementation
 * via the LIVE_PROVIDER env var.
 */

// ─── Session configuration ────────────────────────────────────────────────────

export interface LiveSessionConfig {
  systemPrompt: string;
  /** default: 'gemini-2.0-flash-live-001' */
  model?: string;
  /** Prebuilt voice name. default: 'Puck' */
  voice?: string;
}

// ─── Session interface ────────────────────────────────────────────────────────

export interface LiveSession {
  /** Send a raw PCM16 audio chunk to the AI. */
  sendAudio(chunk: ArrayBuffer): void;
  /** Register a handler to receive PCM16 audio from the AI. */
  onAudio(handler: (chunk: ArrayBuffer) => void): void;
  /** Register a handler to receive transcript segments. */
  onTranscript(handler: (text: string, role: 'user' | 'model') => void): void;
  /** Register an error handler. */
  onError(handler: (err: Error) => void): void;
  /** Close the session and release resources. */
  close(): void;
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface LiveProvider {
  readonly name: string;
  openSession(config: LiveSessionConfig): LiveSession;
}
