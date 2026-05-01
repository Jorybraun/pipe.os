/**
 * useRoleDiscovery Hook Tests
 *
 * Tests for the role discovery client hook (v2 — Cloudflare Workers API).
 * Mocks useApiClient to avoid real HTTP calls.
 *
 * The new architecture orchestrates three endpoints:
 *   POST /state     → runs the reducer
 *   POST /question  → generates the next question
 *   POST /synthesize → produces persona + JD
 *
 * Streaming is not yet implemented for the new endpoints, so useConversation
 * falls back to the non-streaming respond() branch.
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
    mocks.mockPostStream.mockImplementation(async function* () {
      yield { event: 'done', data: makeQuestionResponse() };
    });
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
    expect(typeof result.current.adapter.respondStream).toBe('function');
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
      .mockResolvedValueOnce(makeStateResponse());   // /state

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
    expect(mocks.mockPostStream).toHaveBeenCalledWith(
      '/api/v1/role-contexts/ctx-1/question',
      expect.objectContaining({ state: expect.objectContaining({ phase: 'CONTEXT' }), enableEval: true }),
    );
  });

  it('streams question chunks via respondStream', async () => {
    mocks.mockPost
      .mockResolvedValueOnce(makeCreateResponse())   // /role-contexts
      .mockResolvedValueOnce(makeStartResponse())    // /start
      .mockResolvedValueOnce(makeStateResponse());   // /state

    mocks.mockPostStream.mockImplementation(async function* () {
      yield { event: 'chunk', text: 'Ack' };
      yield { event: 'chunk', text: 'nowledgment' };
      yield { event: 'done', data: makeQuestionResponse() };
    });

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
      '/api/v1/role-contexts/ctx-1/question',
      expect.objectContaining({ state: expect.anything(), enableEval: true }),
    );
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
