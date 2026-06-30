// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAssessmentProgressPolling } from './useAssessmentProgressPolling';
import type { RoomAssessmentProgressSnapshot } from '../types';

function progress(stage: string, nextAction: string): RoomAssessmentProgressSnapshot {
  return {
    mode: 'OPEN_SOURCE_BUG_FIX',
    state: stage === 'READY_FOR_EVALUATION' ? 'FINAL_SUBMITTED' : 'IN_PROGRESS',
    stage,
    nextAction,
    nextActionLabel: nextAction === 'START_EVALUATION'
      ? 'Start source-backed AI or human evaluation.'
      : 'Submit a source-backed assessment commit.',
    hasChallengePacket: true,
    hasWorkEvidence: true,
    hasMessageEvidence: false,
    hasDevContainerEvidence: true,
    hasToolUsageEvidence: false,
    hasCommitSubmission: nextAction === 'START_EVALUATION',
    hasFinalSubmission: false,
    hasAiInteraction: false,
    hasTranscriptEvidence: false,
    hasTestEvidence: nextAction === 'START_EVALUATION',
    hasVerificationGap: false,
    evidenceCounts: [],
    sourceRefCounts: [],
    latestEvent: null,
    commit: null,
    evaluation: null,
  };
}

describe('useAssessmentProgressPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads progress immediately and then refreshes while enabled', async () => {
    const fetchProgress = vi.fn()
      .mockResolvedValueOnce(progress('WORK_IN_PROGRESS', 'SUBMIT_COMMIT'))
      .mockResolvedValueOnce(progress('READY_FOR_EVALUATION', 'START_EVALUATION'));
    const onProgressChange = vi.fn();

    renderHook(() => useAssessmentProgressPolling({
      token: 'room-token',
      enabled: true,
      intervalMs: 1000,
      fetchProgress,
      onProgressChange,
    }));

    await act(async () => {});

    expect(fetchProgress).toHaveBeenCalledTimes(1);
    expect(fetchProgress).toHaveBeenNthCalledWith(1, 'room-token');
    expect(onProgressChange).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'WORK_IN_PROGRESS',
      nextAction: 'SUBMIT_COMMIT',
    }));

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(fetchProgress).toHaveBeenCalledTimes(2);
    expect(onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: 'READY_FOR_EVALUATION',
      nextAction: 'START_EVALUATION',
    }));
  });

  it('stays quiet while disabled', async () => {
    const fetchProgress = vi.fn().mockResolvedValue(progress('WORK_IN_PROGRESS', 'SUBMIT_COMMIT'));
    const onProgressChange = vi.fn();

    renderHook(() => useAssessmentProgressPolling({
      token: 'room-token',
      enabled: false,
      intervalMs: 1000,
      fetchProgress,
      onProgressChange,
    }));

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(fetchProgress).not.toHaveBeenCalled();
    expect(onProgressChange).not.toHaveBeenCalled();
  });

  it('does not let a stale token response overwrite the active room progress', async () => {
    let resolveFirst: ((value: RoomAssessmentProgressSnapshot | null) => void) | null = null;
    const fetchProgress = vi.fn((token: string) => {
      if (token === 'old-room-token') {
        return new Promise<RoomAssessmentProgressSnapshot | null>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(progress('READY_FOR_EVALUATION', 'START_EVALUATION'));
    });
    const onProgressChange = vi.fn();

    const { rerender } = renderHook(
      ({ token }) => useAssessmentProgressPolling({
        token,
        enabled: true,
        intervalMs: 1000,
        fetchProgress,
        onProgressChange,
      }),
      { initialProps: { token: 'old-room-token' } },
    );

    rerender({ token: 'new-room-token' });

    await act(async () => {});

    expect(onProgressChange).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'READY_FOR_EVALUATION',
      nextAction: 'START_EVALUATION',
    }));

    await act(async () => {
      resolveFirst?.(progress('WORK_IN_PROGRESS', 'SUBMIT_COMMIT'));
    });

    expect(onProgressChange).toHaveBeenCalledTimes(1);
  });

  it('surfaces polling errors without clearing the last known progress', async () => {
    const error = new Error('progress endpoint failed');
    const fetchProgress = vi.fn().mockRejectedValue(error);
    const onProgressChange = vi.fn();
    const onError = vi.fn();

    renderHook(() => useAssessmentProgressPolling({
      token: 'room-token',
      enabled: true,
      intervalMs: 1000,
      fetchProgress,
      onProgressChange,
      onError,
    }));

    await act(async () => {});

    expect(onError).toHaveBeenCalledWith(error);
    expect(onProgressChange).not.toHaveBeenCalled();
  });
});
