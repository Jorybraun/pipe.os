/**
 * candidateConversationAdapter — ConversationAdapter implementation for the
 * candidate-facing AGENT_INTERVIEW challenge.
 *
 * Uses session token auth (Bearer {sessionToken}) against /rpc/ endpoints.
 * The adapter is a factory function that closes over challengeId and sessionToken
 * so no state leaks between different challenge sessions.
 *
 * Server endpoints:
 *   POST /rpc/agent-interview/{challengeId}/start    → QuestionTurnResult | SynthesisResult
 *   POST /rpc/agent-interview/{challengeId}/respond  → QuestionTurnResult | SynthesisResult
 *   POST /rpc/agent-interview/{challengeId}/complete → SynthesisResult
 */

import type { ConversationAdapter, QuestionTurnResult, SynthesisResult, TurnResult, RespondMedia } from '../../components/AIChat/types';
import type { DomainCoverage, RoleContextProgress } from '../../lib/api/types';

// ─── Internal types ───────────────────────────────────────────────────────────

/** Options accepted by the factory function. */
export interface CandidateConversationAdapterOptions {
  baseUrl?: string;
  sessionToken: string;
  challengeId: string;
}

/** Backend question-turn shape (returned by both /start and /respond). */
interface BackendQuestionTurn {
  type: 'question';
  acknowledgment: string;
  question: { id: string; text: string; input: { type: 'textarea'; placeholder: string } };
  progress: { asked: number; budget: number; domains: Record<string, string> };
}

/** Backend synthesis shape (returned when interview is complete). */
interface BackendSynthesisTurn {
  type: 'synthesis';
  synthesis: string;
  persona: null;
  jobDescription: null;
  progress: { asked: number; budget: number; domains: Record<string, string> };
  transcript?: Array<{ role: 'user' | 'model'; text: string }>;
}

type BackendTurnResult = BackendQuestionTurn | BackendSynthesisTurn;

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

function stringToDomainCoverage(depth: string): DomainCoverage {
  if (depth === 'deep') return 'deep';
  if (depth === 'covered') return 'covered';
  if (depth === 'sparse') return 'sparse';
  return 'none';
}

function backendProgressToRoleContextProgress(
  progress: BackendQuestionTurn['progress'] | BackendSynthesisTurn['progress'],
): RoleContextProgress {
  const domains: Record<string, DomainCoverage> = {};
  if (progress?.domains) {
    for (const [key, value] of Object.entries(progress.domains)) {
      domains[key] = stringToDomainCoverage(value);
    }
  }
  return {
    asked: progress?.asked ?? 0,
    budget: progress?.budget ?? 0,
    domains,
  };
}

function backendTurnToAdapterTurn(backend: BackendTurnResult): TurnResult {
  if (backend.type === 'synthesis') {
    const result: SynthesisResult = {
      type: 'synthesis',
      synthesis: backend.synthesis,
      persona: backend.persona,
      jobDescription: backend.jobDescription,
      progress: backendProgressToRoleContextProgress(backend.progress),
    };
    if (backend.transcript) {
      result.transcript = backend.transcript;
    }
    return result;
  }

  return {
    type: 'question',
    acknowledgment: backend.acknowledgment,
    question: {
      id: backend.question.id,
      text: backend.question.text,
      input: { type: 'textarea' },
    },
    progress: backendProgressToRoleContextProgress(backend.progress),
  };
}

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
    async initialize(_config): Promise<QuestionTurnResult> {
      const result = await post<BackendTurnResult>(
        `${baseEndpoint}/start`,
        sessionToken,
        {},
      );

      const turn = backendTurnToAdapterTurn(result);

      if (turn.type === 'synthesis') {
        // Interview already complete — return a synthetic question so the UI
        // doesn't crash, then immediately complete.
        return {
          type: 'question',
          acknowledgment: turn.synthesis,
          question: {
            id: 'complete',
            text: turn.synthesis,
            input: { type: 'textarea' },
          },
          progress: turn.progress,
        };
      }

      return turn;
    },

    async respond(answer: string, _questionId: string, media?: RespondMedia): Promise<TurnResult> {
      const body: Record<string, unknown> = { answer };
      if (media?.videoR2Key) {
        body.videoR2Key = media.videoR2Key;
      }
      const result = await post<BackendTurnResult>(
        `${baseEndpoint}/respond`,
        sessionToken,
        body,
      );

      return backendTurnToAdapterTurn(result);
    },

    async completeEarly(): Promise<SynthesisResult> {
      // Culture interview does not support early completion via a separate endpoint.
      // The backend controls termination. Return a mock synthesis to satisfy the interface.
      throw new Error('Early completion is not supported for this interview type.');
    },
  };
}
