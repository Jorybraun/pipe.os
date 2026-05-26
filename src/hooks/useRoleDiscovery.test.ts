/**
 * useRoleDiscovery Hook Tests
 *
 * Tests for the role discovery client hook (v2 — Cloudflare Workers API).
 * Mocks useApiClient to avoid real HTTP calls.
 *
 * Architecture:
 *   POST /role-contexts        → create context
 *   POST /:id/start            → returns calibration question
 *   POST /:id/state            → runs reducer (ANSWER, SKIP, FORCE_SYNTHESIZE)
 *   POST /:id/question         → generates next question (or pops from stack)
 *   POST /:id/question/prefetch → background stack refill
 *   POST /:id/synthesize       → produces persona + JD
 *
 * The adapter uses non-streaming respond(). useConversation falls back to
 * adapter.respond() because respondStream is not implemented.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRoleDiscovery } from './useRoleDiscovery';
import type { ApiClient } from '../lib/api/client';
import type {
  CreateRoleContextResponse,
  StartRoleContextResponse,
  PostStateResponse,
  PostQuestionResponse,
  PostSynthesizeResponse,
  InterviewQueuedQuestion,
  CandidatePersona,
  RoleContextProgress,
  RoleContextBaseline,
} from '../lib/api/types';

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
    postStream: mocks.mockPostStream,
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

function makeStateResponse(overrides?: Partial<PostStateResponse['state']>): PostStateResponse {
  return {
    state: {
      baseline: { title: 'Senior Backend Engineer' },
      participantRole: null,
      questionBudget: 10,
      exchanges: [
        {
          questionId: 'q-1',
          question: 'What does success look like in 90 days?',
          acknowledgment: 'Got it.',
          answer: 'Ship payment API v2.',
        },
      ],
      knowledgeState: {},
      coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
      phase: 'CONTEXT',
      questionsAsked: 1,
      synthesisReady: false,
      questionStack: [],
      ...overrides,
    },
  };
}

function makeQuestionResponse(): PostQuestionResponse {
  return {
    reasoning: 'Ask about the team structure.',
    acknowledgment: 'Got it.',
    question: {
      id: 'q-2',
      text: 'Tell me about the team.',
      input: { type: 'textarea' },
    },
    knowledgeStateUpdate: {},
    domainCoverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
  };
}

function makeQueuedQuestion(overrides?: Partial<InterviewQueuedQuestion>): InterviewQueuedQuestion {
  return {
    questionId: 'q-prefetched',
    text: 'Prefetched question from stack.',
    acknowledgment: 'Ack.',
    input: { type: 'textarea' },
    knowledgeStateUpdate: {},
    domainCoverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    ...overrides,
  };
}

function makeSynthesisResponse(): PostSynthesizeResponse {
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
    reasoning: 'Synthesis complete.',
    persona,
    jobDescription: '# Senior Backend Engineer\n\nLead our payment platform.',
    synthesis: 'Strong candidate for senior backend role.',
    knowledgeStateUpdate: {},
    domainCoverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
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
    // Adapter uses non-streaming respond(); respondStream is not implemented
    expect(result.current.adapter.respondStream).toBeUndefined();
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

  it('calls POST /state then /question and advances to next question', async () => {
    mocks.mockPost
      .mockResolvedValueOnce(makeCreateResponse())   // /role-contexts
      .mockResolvedValueOnce(makeStartResponse())    // /start
      .mockResolvedValueOnce(makeStateResponse())    // /state
      .mockResolvedValueOnce(makeQuestionResponse()); // /question

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

    expect(mocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/role-contexts/ctx-1/state',
      expect.objectContaining({
        state: expect.objectContaining({ phase: 'CONTEXT' }),
        action: expect.objectContaining({ type: 'ANSWER', answer: 'Ship payment API v2.' }),
      }),
    );
    expect(mocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/role-contexts/ctx-1/question',
      expect.objectContaining({ state: expect.objectContaining({ phase: 'CONTEXT' }), enableEval: false }),
    );
  });

  it('advances to next question via respond', async () => {
    mocks.mockPost
      .mockResolvedValueOnce(makeCreateResponse())   // /role-contexts
      .mockResolvedValueOnce(makeStartResponse())    // /start
      .mockResolvedValueOnce(makeStateResponse())    // /state
      .mockResolvedValueOnce(makeQuestionResponse()); // /question

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

    expect(mocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/role-contexts/ctx-1/question',
      expect.objectContaining({ state: expect.anything(), enableEval: false }),
    );
  });

  it('pops from local questionStack without hitting POST /question', async () => {
    const prefetched = makeQueuedQuestion({
      questionId: 'q-local',
      text: 'Local stack question.',
      acknowledgment: 'Nice.',
    });

    mocks.mockPost
      .mockResolvedValueOnce(makeCreateResponse())   // /role-contexts
      .mockResolvedValueOnce(makeStartResponse())    // /start
      .mockResolvedValueOnce(
        makeStateResponse({ questionStack: [prefetched] }),
      );                                             // /state
    // NO /question mock — respond should skip the network call

    const { result } = renderHook(() => useRoleDiscovery());

    await act(async () => {
      await result.current.createAndStart(mockBaseline);
    });

    await waitFor(() => expect(result.current.currentQuestion?.id).toBe('q-1'));

    await act(async () => {
      await result.current.respond('Ship payment API v2.', 'q-1');
    });

    await waitFor(() => {
      expect(result.current.currentQuestion?.text).toBe('Local stack question.');
    });

    // Should call /state but NOT /question
    expect(mocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/role-contexts/ctx-1/state',
      expect.anything(),
    );
    const questionCalls = mocks.mockPost.mock.calls.filter(
      (call) => (call[0] as string).includes('/question') && !(call[0] as string).includes('/prefetch'),
    );
    expect(questionCalls).toHaveLength(0);
  });

  it('transitions to COMPLETE and sets persona when synthesis is returned', async () => {
    mocks.mockPost
      .mockResolvedValueOnce(makeCreateResponse())   // /role-contexts
      .mockResolvedValueOnce(makeStartResponse())    // /start
      .mockResolvedValueOnce(
        makeStateResponse({ synthesisReady: true, phase: 'WRAP_UP' }),
      )                                              // /state
      .mockResolvedValueOnce(makeSynthesisResponse()); // /synthesize

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
