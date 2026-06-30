import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAssessment } from './useAssessment';

describe('useAssessment', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('/rpc/get-stage-config'),
      expect.anything(),
    );
  });
});
