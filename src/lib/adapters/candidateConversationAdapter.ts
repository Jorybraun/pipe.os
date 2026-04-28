/**
 * candidateConversationAdapter — ConversationAdapter implementation for the
 * candidate-facing AGENT_INTERVIEW challenge.
 *
 * Uses session token auth (Bearer {sessionToken}) against /rpc/ endpoints.
 * The adapter is a factory function that closes over challengeId and sessionToken
 * so no state leaks between different challenge sessions.
 *
 * Server endpoints (not yet implemented server-side):
 *   POST /rpc/agent-interview/{challengeId}/start    → QuestionTurnResult
 *   POST /rpc/agent-interview/{challengeId}/respond  → TurnResult
 *   POST /rpc/agent-interview/{challengeId}/complete → SynthesisResult
 */

import type { ConversationAdapter, QuestionTurnResult, SynthesisResult, TurnResult } from '../../components/AIChat/types';

// ─── Internal types ───────────────────────────────────────────────────────────

/** Options accepted by the factory function. */
export interface CandidateConversationAdapterOptions {
  baseUrl?: string;
  sessionToken: string;
  challengeId: string;
}

/**
 * Error body shape returned by the Worker on non-2xx responses.
 * Mirrors ApiErrorBody in src/lib/api/types.ts.
 */
interface WorkerErrorBody {
  error: {
    message: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine whether an unknown value conforms to WorkerErrorBody so we can
 * extract a human-readable message without casting through `any`.
 */
function isWorkerErrorBody(value: unknown): value is WorkerErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as Record<string, unknown>).error === 'object' &&
    (value as Record<string, unknown>).error !== null &&
    'message' in ((value as Record<string, unknown>).error as object) &&
    typeof ((value as Record<string, unknown>).error as Record<string, unknown>).message === 'string'
  );
}

/**
 * Perform a POST fetch against the Worker and deserialise the JSON body.
 * Throws an Error on non-2xx responses — message is extracted from the
 * structured error body when available, falling back to the HTTP status text.
 */
async function post<T>(
  url: string,
  sessionToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message: string = response.statusText;
    try {
      const raw: unknown = await response.json();
      if (isWorkerErrorBody(raw)) {
        message = raw.error.message;
      }
    } catch {
      // JSON parse failed — fall back to statusText already set above.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a ConversationAdapter for a candidate completing an AGENT_INTERVIEW
 * challenge. All HTTP calls are authenticated with the candidate's session
 * token and scoped to the given challengeId.
 *
 * `submitFeedback` is intentionally omitted — candidates do not flag questions.
 *
 * @example
 * ```ts
 * const adapter = createCandidateConversationAdapter({
 *   sessionToken: candidateSession.token,
 *   challengeId: challenge.id,
 * });
 * ```
 */
export function createCandidateConversationAdapter(
  opts: CandidateConversationAdapterOptions,
): ConversationAdapter {
  const {
    challengeId,
    sessionToken,
    baseUrl = import.meta.env?.VITE_API_URL || 'http://localhost:8787',
  } = opts;

  const baseEndpoint = `${baseUrl}/rpc/agent-interview/${challengeId}`;

  return {
    /**
     * Fires the opening question for the interview.
     * Called once before the candidate sees any content.
     * The AdapterConfig is accepted for interface conformance but the
     * server derives all context from the challengeId + session token.
     */
    async initialize(_config): Promise<QuestionTurnResult> {
      const result = await post<QuestionTurnResult>(
        `${baseEndpoint}/start`,
        sessionToken,
        {},
      );
      return result;
    },

    /**
     * Submits the candidate's answer to the current question and returns
     * either the next question or a final synthesis once the budget is
     * exhausted.
     */
    async respond(answer: string, questionId: string): Promise<TurnResult> {
      const result = await post<TurnResult>(
        `${baseEndpoint}/respond`,
        sessionToken,
        { answer, questionId },
      );
      return result;
    },

    /**
     * Requests an early synthesis before the question budget is exhausted.
     * Used when the candidate clicks "Finish early" or the UI detects
     * sufficient signal has been collected.
     */
    async completeEarly(): Promise<SynthesisResult> {
      const result = await post<SynthesisResult>(
        `${baseEndpoint}/complete`,
        sessionToken,
        {},
      );
      return result;
    },

    // submitFeedback intentionally omitted — candidates do not flag questions.
  };
}
