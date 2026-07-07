import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAssessment } from './useAssessment';

describe('useAssessment', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('resolves claimed-looking invite URLs through the Worker using the raw token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'candidate-1',
          pipelineId: null,
          status: 'INVITED',
          name: 'Ada Candidate',
          sessionToken: 'session-token',
        }),
      } as Response);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useAssessment('CLAIMED::invite-token'));

    await waitFor(() => expect(result.current.candidate?.id).toBe('candidate-1'));

    expect(result.current.error).toBeNull();
    expect(sessionStorage.getItem('pipe_session_invite_token')).toBe('invite-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/rpc/resolve-token'),
      expect.objectContaining({
        body: JSON.stringify({ inviteToken: 'invite-token' }),
      }),
    );
  });

  it('ends the candidate-facing flow when CV intake is accepted for background ingestion', async () => {
    sessionStorage.setItem('pipe_session_token', 'session-token');
    sessionStorage.setItem('pipe_session_invite_token', 'invite-token');
    sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
      id: 'candidate-1',
      pipelineId: null,
      status: 'IN_PROGRESS',
      name: 'Ada Candidate',
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isComplete: false,
          stageId: 'talent-pool-intake',
          candidateId: 'candidate-1',
          stageTitle: 'Upload Your CV',
          mode: 'INTAKE',
          challenges: [{ type: 'INTAKE', order: 0, title: 'Profile & Resume' }],
          currentIndex: 0,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'intake',
          type: 'INTAKE',
          title: 'Profile & Resume',
          instructions: 'Upload your CV.',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          complete: true,
          queued: true,
          message: 'INTAKE queued for background processing',
        }),
      } as Response);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useAssessment('invite-token'));

    await waitFor(() => expect(result.current.candidate?.id).toBe('candidate-1'));

    await act(async () => {
      await result.current.onStart();
    });

    expect(result.current.challengeContent?.type).toBe('INTAKE');

    await act(async () => {
      await result.current.submitChallenge({ resumeText: 'Senior React engineer with source-backed platform experience.' });
    });

    await waitFor(() => expect(result.current.isSubmitted).toBe(true));
    expect(result.current.challengeContent?.type).toBe('PROFILE_RECEIVED');
    expect(result.current.challengeContent?.instructions).toContain('email you when your code review is ready');
    expect(result.current.challengeContent?.instructions).not.toContain('INTAKE queued');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('/rpc/get-stage-config'),
      expect.anything(),
    );
  });

  it('surfaces queued standalone code review completion as profile received', async () => {
    sessionStorage.setItem('pipe_session_token', 'session-token');
    sessionStorage.setItem('pipe_session_invite_token', 'invite-token');
    sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
      id: 'candidate-1',
      pipelineId: null,
      status: 'IN_PROGRESS',
      name: 'Ada Candidate',
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isComplete: true,
          stageId: 'candidate-intake-queued',
          stageTitle: 'Profile received',
          mode: 'INTAKE',
          challenges: [],
          currentIndex: 0,
          message: 'Your profile has been received. PIPE will email you when your code review is ready.',
        }),
      } as Response);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useAssessment('invite-token'));

    await waitFor(() => expect(result.current.candidate?.id).toBe('candidate-1'));

    await act(async () => {
      await result.current.onStart();
    });

    await waitFor(() => expect(result.current.isSubmitted).toBe(true));
    expect(result.current.challengeContent?.type).toBe('PROFILE_RECEIVED');
    expect(result.current.challengeContent?.title).toBe('Profile received');
    expect(result.current.challengeContent?.instructions).toContain('email you when your code review is ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/rpc/get-challenge'),
      expect.anything(),
    );
  });

  it('treats profile-received stage conflicts as queued handoffs, not claimed links', async () => {
    sessionStorage.setItem('pipe_session_token', 'session-token');
    sessionStorage.setItem('pipe_session_invite_token', 'invite-token');
    sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
      id: 'candidate-1',
      pipelineId: null,
      status: 'IN_PROGRESS',
      name: 'Ada Candidate',
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: 'PROFILE_RECEIVED',
            message: 'Your profile has been received. PIPE will email you when your code review is ready.',
          },
          challenge: {
            id: 'profile-received',
            type: 'PROFILE_RECEIVED',
            instructions: 'Your profile has been received. PIPE will email you when your code review is ready.',
          },
        }),
      } as Response);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useAssessment('invite-token'));

    await waitFor(() => expect(result.current.candidate?.id).toBe('candidate-1'));

    await act(async () => {
      await result.current.onStart();
    });

    await waitFor(() => expect(result.current.isSubmitted).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.stageConfig?.stageId).toBe('candidate-intake-queued');
    expect(result.current.challengeContent?.type).toBe('PROFILE_RECEIVED');
    expect(result.current.challengeContent?.instructions).toContain('email you when your code review is ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats profile-received submit conflicts as queued handoffs, not claimed links', async () => {
    sessionStorage.setItem('pipe_session_token', 'session-token');
    sessionStorage.setItem('pipe_session_invite_token', 'invite-token');
    sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
      id: 'candidate-1',
      pipelineId: null,
      status: 'IN_PROGRESS',
      name: 'Ada Candidate',
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isComplete: false,
          stageId: 'standalone-code-review',
          candidateId: 'candidate-1',
          stageTitle: 'Code Review',
          mode: 'ASYNC',
          challenges: [{ type: 'CODE_REVIEW', order: 0, title: 'Code Review' }],
          currentIndex: 0,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'challenge-1',
          type: 'CODE_REVIEW',
          title: 'Code Review',
          instructions: 'Review the source-backed pull request.',
          cachedDiffJson: { files: [] },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: 'PROFILE_RECEIVED',
            message: 'Your profile has been received. PIPE will email you when your code review is ready.',
          },
          challenge: {
            id: 'profile-received',
            type: 'PROFILE_RECEIVED',
            instructions: 'Your profile has been received. PIPE will email you when your code review is ready.',
          },
        }),
      } as Response);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useAssessment('invite-token'));

    await waitFor(() => expect(result.current.candidate?.id).toBe('candidate-1'));

    await act(async () => {
      await result.current.onStart();
    });

    await waitFor(() => expect(result.current.challengeContent?.type).toBe('CODE_REVIEW'));

    await act(async () => {
      await result.current.submitChallenge({ annotations: {} });
    });

    await waitFor(() => expect(result.current.isSubmitted).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.stageConfig?.stageId).toBe('candidate-intake-queued');
    expect(result.current.challengeContent?.type).toBe('PROFILE_RECEIVED');
    expect(result.current.challengeContent?.instructions).toContain('email you when your code review is ready');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats profile-received start conflicts as queued handoffs, not start failures', async () => {
    sessionStorage.setItem('pipe_session_token', 'session-token');
    sessionStorage.setItem('pipe_session_invite_token', 'invite-token');
    sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
      id: 'candidate-1',
      pipelineId: null,
      status: 'INVITED',
      name: 'Ada Candidate',
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: 'PROFILE_RECEIVED',
            message: 'Your profile has been received. PIPE will email you when your code review is ready.',
          },
          challenge: {
            id: 'profile-received',
            type: 'PROFILE_RECEIVED',
            instructions: 'Your profile has been received. PIPE will email you when your code review is ready.',
          },
        }),
      } as Response);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useAssessment('invite-token'));

    await waitFor(() => expect(result.current.candidate?.id).toBe('candidate-1'));

    await act(async () => {
      await expect(result.current.claimAssessmentStart()).resolves.toBeUndefined();
    });

    await waitFor(() => expect(result.current.isSubmitted).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.stageConfig?.stageId).toBe('candidate-intake-queued');
    expect(result.current.challengeContent?.type).toBe('PROFILE_RECEIVED');
    expect(result.current.challengeContent?.instructions).toContain('email you when your code review is ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens the real code review challenge instead of trapping ready assessments on welcome', async () => {
    sessionStorage.setItem('pipe_session_token', 'session-token');
    sessionStorage.setItem('pipe_session_invite_token', 'invite-token');
    sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
      id: 'candidate-1',
      pipelineId: null,
      status: 'IN_PROGRESS',
      name: 'Ada Candidate',
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isComplete: false,
          stageId: 'standalone-code-review',
          candidateId: 'candidate-1',
          stageTitle: 'Code Review',
          mode: 'ASYNC',
          challenges: [
            { type: 'WELCOME', order: 0, title: 'Welcome' },
            { type: 'CODE_REVIEW', order: 1, title: 'Code Review' },
          ],
          currentIndex: 0,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'challenge-1',
          type: 'CODE_REVIEW',
          title: 'Code Review',
          instructions: 'Review the source-backed pull request.',
          cachedDiffJson: { files: [] },
        }),
      } as Response);
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useAssessment('invite-token'));

    await waitFor(() => expect(result.current.candidate?.id).toBe('candidate-1'));

    await act(async () => {
      await result.current.onStart();
    });

    await waitFor(() => expect(result.current.challengeContent?.type).toBe('CODE_REVIEW'));
    expect(result.current.currentOrder).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ order: 1 });
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/rpc/submit-challenge-response'),
      expect.anything(),
    );
  });
});
