/**
 * useRoleDiscovery Hook Tests
 *
 * Tests for the role discovery client hook (v2 — Cloudflare Workers API).
 * Mocks useApiClient to avoid real HTTP calls.
 *
 * The adapter's respond() path goes through respondStream (adapter.respondStream
 * is defined, so useConversation always takes the streaming branch). The mock for
 * postStream must therefore return a real async generator. We queue up stream
 * payloads alongside the non-streaming post mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRoleDiscovery } from './useRoleDiscovery';
import type { ApiClient, StreamEvent } from '../lib/api/client';
import type {
  CreateRoleContextResponse,
  StartRoleContextResponse,
  RespondSynthesisResponse,
  CandidatePersona,
  RoleContextProgress,
  RoleContextBaseline,
} from '../lib/api/types';

// ─── Async generator helper ───────────────────────────────────────────────────

/**
 * Wraps a single value as an async generator that yields one `done` event.
 * This matches the shape postStream emits: { event: 'done', data: T }.
 */
async function* singleDoneStream<T>(data: T): AsyncGenerator<StreamEvent<T>> {
  yield { event: 'done', data };
}

// ─── Mock useApiClient ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockGet: vi.fn(),
  mockPostStream: vi.fn(),
}));

vi.mock('./useApiClient', () => ({
  useApiClient: (): ApiClient => ({
    get: mocks.mockGet,
    post: mocks.mockPost,
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    postStream: mocks.mockPostStream as ApiClient['postStream'],
  }),
}));

// Guard against Clerk's useAuth being called transitively.
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('test-token') }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockBaseline: RoleContextBaseline = {
  title: 'Senior Backend Engineer',
  department: 'Engineering',
};

function makeProgress(): RoleContextProgress {
  return {
    asked: 0,
    budget: 10,
    domains: {},
  };
}

function makeCreateResponse(): CreateRoleContextResponse {
  return {
    id: 'ctx-1',
    participantId: 'part-1',
    status: 'BASELINE',
    baseline: mockBaseline,
    questionBudget: 10,
    questionsAsked: 0,
  };
}

function makeStartResponse(): StartRoleContextResponse {
  return {
    participantId: 'part-1',
    acknowledgment: 'Got it.',
    question: {
      id: 'q-1',
      text: 'What does success look like in 90 days?',
      input: { type: 'textarea' },
    },
    progress: makeProgress(),
    status: 'CALIBRATING',
  };
}

function makeSynthesisResponse(): RespondSynthesisResponse {
  const persona: CandidatePersona = {
    seniority: 'senior',
    archetype: 'Backend Engineer',
    mustHaveSkills: ['Node.js', 'PostgreSQL'],
    niceToHaveSkills: [],
    disposition: [],
    careerSignal: '',
    redFlags: [],
    dealbreakers: [],
  };
  return {
    participantId: 'part-1',
    synthesis: 'Strong candidate for senior backend role.',
    persona,
    jobDescription: '# Senior Backend Engineer\n\nLead our payment platform.',
    knowledgeState: {},
    progress: { asked: 10, budget: 10, domains: {} },
    status: 'COMPLETE',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useRoleDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with IDLE phase and no loading state', () => {
    const { result } = renderHook(() => useRoleDiscovery());

    expect(result.current.phase).toBe('IDLE');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.contextId).toBeNull();
    expect(result.current.baseline).toBeNull();
    expect(result.current.currentQuestion).toBeNull();
  });

  it('exposes adapter, createAndStart, respond, completeEarly, submitFeedback', () => {
    const { result } = renderHook(() => useRoleDiscovery());

    expect(typeof result.current.adapter).toBe('object');
    expect(typeof result.current.createAndStart).toBe('function');
    expect(typeof result.current.respond).toBe('function');
    expect(typeof result.current.completeEarly).toBe('function');
    expect(typeof result.current.submitFeedback).toBe('function');
  });

  it('calls POST /role-contexts and /start, then transitions to CALIBRATING', async () => {
    mocks.mockPost
      .mockResolvedValueOnce(makeCreateResponse())
      .mockResolvedValueOnce(makeStartResponse());

    const { result } = renderHook(() => useRoleDiscovery());

    await act(async () => {
      await result.current.createAndStart(mockBaseline);
    });

    await waitFor(() => {
      expect(result.current.phase).toBe('CALIBRATING');
    });

    expect(result.current.currentQuestion?.id).toBe('q-1');

    expect(mocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/role-contexts',
      expect.objectContaining({ baseline: mockBaseline }),
    );
    expect(mocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/role-contexts/ctx-1/start',
      expect.objectContaining({ participantId: 'part-1' }),
    );
  });

  it('calls POST /respond and advances to next question', async () => {
    mocks.mockPost
      .mockResolvedValueOnce(makeCreateResponse())
      .mockResolvedValueOnce(makeStartResponse());
    // The respond path goes through respondStream → api.postStream (streaming branch).
    // Stream done payload matches the backend shape: `question` is the full object
    // (id + text + input), not a bare string. The adapter forwards it verbatim
    // into the question turn result so `currentQuestion.text` must be available.
    mocks.mockPostStream.mockReturnValueOnce(
      singleDoneStream({
        participantId: 'part-1',
        acknowledgment: 'Got it.',
        question: {
          id: 'q-2',
          text: 'Tell me about the team.',
          input: { type: 'textarea' },
        },
        progress: { asked: 1, budget: 10, domains: {} },
      }),
    );

    const { result } = renderHook(() => useRoleDiscovery());

    await act(async () => {
      await result.current.createAndStart(mockBaseline);
    });

    await waitFor(() => expect(result.current.currentQuestion?.id).toBe('q-1'));

    await act(async () => {
      await result.current.respond('Ship payment API v2.', 'q-1');
    });

    await waitFor(() => {
      expect(result.current.currentQuestion?.text).toBe('Tell me about the team.');
    });

    expect(mocks.mockPostStream).toHaveBeenCalledWith(
      '/api/v1/role-contexts/ctx-1/respond',
      expect.objectContaining({ answer: 'Ship payment API v2.', questionId: 'q-1' }),
    );
  });

  it('transitions to COMPLETE and sets persona when synthesis is returned', async () => {
    mocks.mockPost
      .mockResolvedValueOnce(makeCreateResponse())
      .mockResolvedValueOnce(makeStartResponse());
    // Synthesis comes through the streaming path.
    const synthData = makeSynthesisResponse();
    mocks.mockPostStream.mockReturnValueOnce(
      singleDoneStream({
        participantId: synthData.participantId,
        synthesis: synthData.synthesis,
        persona: synthData.persona,
        jobDescription: synthData.jobDescription,
        knowledgeState: synthData.knowledgeState,
        progress: synthData.progress,
      }),
    );

    const { result } = renderHook(() => useRoleDiscovery());

    await act(async () => {
      await result.current.createAndStart(mockBaseline);
    });

    await waitFor(() => expect(result.current.currentQuestion?.id).toBe('q-1'));

    await act(async () => {
      await result.current.respond('Detailed answer covering all domains.', 'q-1');
    });

    await waitFor(() => {
      expect(result.current.phase).toBe('COMPLETE');
    });

    expect(result.current.persona?.archetype).toBe('Backend Engineer');
    expect(result.current.synthesis).toBe('Strong candidate for senior backend role.');
  });

  it('sets error state when createAndStart API call fails', async () => {
    mocks.mockPost.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useRoleDiscovery());

    await act(async () => {
      // initialize rethrows after setting error — catch to prevent unhandled rejection
      try {
        await result.current.createAndStart(mockBaseline);
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });
});
