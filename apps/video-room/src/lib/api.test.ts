import { describe, expect, it, vi } from 'vitest';

import {
  finalizeRoomWorkspaceAssessment,
  getRoomAssessmentProgress,
  launchRoomWorkspace,
  submitRoomAssessmentCommit,
  uploadRecording,
} from './api';
import type { RecordingSpeakerMetadata } from '../types';

const speakerMetadata: RecordingSpeakerMetadata = {
  version: 1,
  transcriptionAudio: {
    channelLayout: 'host-local-guest-remote-v1',
    channelCount: 2,
    channels: [
      { channel: 0, role: 'host', source: 'local' },
      { channel: 1, role: 'guest', source: 'remote' },
    ],
  },
};

describe('uploadRecording', () => {
  it('rejects transcription audio without speaker metadata before upload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(uploadRecording(
      'room-token',
      new Blob([new Uint8Array([1])], { type: 'video/webm' }),
      new Blob([new Uint8Array([2])], { type: 'audio/webm' }),
    )).rejects.toThrow('Speaker metadata is required when uploading transcription audio.');

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('includes speaker metadata with multipart transcription audio uploads', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ accepted: true, transcriptStatus: 'PROCESSING' }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(uploadRecording(
      'room-token',
      new Blob([new Uint8Array([1])], { type: 'video/webm' }),
      new Blob([new Uint8Array([2])], { type: 'audio/webm' }),
      speakerMetadata,
    )).resolves.toEqual({ accepted: true, transcriptStatus: 'PROCESSING' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('speakerMetadata')).toBe(JSON.stringify(speakerMetadata));
    fetchSpy.mockRestore();
  });
});

describe('submitRoomAssessmentCommit', () => {
  it('posts commit evidence to the room-token assessment endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        submission: {
          accepted: true,
          repositoryUrl: 'https://github.com/pipe/source-backed-worker',
          branchName: 'pipe-assessment/retry-fix',
          commitSha: 'b'.repeat(40),
          commitUrl: null,
        },
        progress: {
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'FINAL_SUBMITTED',
          stage: 'READY_FOR_EVALUATION',
          nextAction: 'START_EVALUATION',
          nextActionLabel: 'Start source-backed evaluation.',
          hasChallengePacket: true,
          hasWorkEvidence: true,
          hasCommitSubmission: true,
          hasFinalSubmission: false,
          hasAiInteraction: false,
          hasTranscriptEvidence: false,
          hasTestEvidence: false,
          evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
          sourceRefCounts: [],
          latestEvent: { kind: 'commit_submission', sequence: 2, occurredAt: '2026-06-29T00:00:00.000Z' },
          commit: null,
          evaluation: null,
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ));
    const payload = {
      narrative: 'Submitted retry fix.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha: 'a'.repeat(40),
      commitSha: 'b'.repeat(40),
      changedFiles: [{ path: 'src/retry.ts', status: 'modified' as const }],
      sourceRefs: [
        {
          sourceRefType: 'git_commit',
          sourceRefId: 'b'.repeat(40),
          exactText: `commit ${'b'.repeat(40)}`,
          contentHash: 'sha256:commit',
        },
        {
          sourceRefType: 'code_diff',
          sourceRefId: `${'a'.repeat(40)}..${'b'.repeat(40)}`,
          exactText: 'diff --git a/src/retry.ts b/src/retry.ts',
          contentHash: 'sha256:diff',
        },
      ],
    };

    await expect(submitRoomAssessmentCommit('room-token', payload)).resolves.toMatchObject({
      submission: { accepted: true },
      progress: { stage: 'READY_FOR_EVALUATION' },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toContain('/api/v1/meeting-rooms/room-token/assessment/commit-submission');
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual(payload);
    fetchSpy.mockRestore();
  });
});

describe('finalizeRoomWorkspaceAssessment', () => {
  it('posts workspace finalization to the live bridge through the room proxy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        ok: true,
        submitted: true,
        commit: {
          repositoryUrl: 'https://github.com/pipe/source-backed-worker',
          branchName: 'pipe-assessment/retry-fix',
          baseCommitSha: 'a'.repeat(40),
          commitSha: 'b'.repeat(40),
          changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
          sourceRefTypes: ['git_commit', 'code_diff', 'test_run'],
        },
        submission: {
          accepted: true,
          repositoryUrl: 'https://github.com/pipe/source-backed-worker',
          branchName: 'pipe-assessment/retry-fix',
          commitSha: 'b'.repeat(40),
          commitUrl: null,
        },
        progress: {
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'FINAL_SUBMITTED',
          stage: 'READY_FOR_EVALUATION',
          nextAction: 'START_EVALUATION',
          nextActionLabel: 'Start source-backed evaluation.',
          hasChallengePacket: true,
          hasWorkEvidence: true,
          hasCommitSubmission: true,
          hasFinalSubmission: false,
          hasAiInteraction: false,
          hasTranscriptEvidence: false,
          hasTestEvidence: true,
          evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
          sourceRefCounts: [{ kind: 'test_run', count: 1 }],
          latestEvent: { kind: 'commit_submission', sequence: 2, occurredAt: '2026-06-29T00:00:00.000Z' },
          commit: null,
          evaluation: null,
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(finalizeRoomWorkspaceAssessment('room-token', 'workspace-session-1', {
      narrative: 'Submitted retry fix.',
      testCommand: 'npm test -- retry',
    })).resolves.toMatchObject({
      submitted: true,
      commit: { commitSha: 'b'.repeat(40) },
      progress: { stage: 'READY_FOR_EVALUATION' },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toContain(
      '/api/v1/meeting-rooms/room-token/workspace/proxy/workspace-session-1/assessment/finalize',
    );
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      narrative: 'Submitted retry fix.',
      testCommand: 'npm test -- retry',
    });
    fetchSpy.mockRestore();
  });
});

describe('launchRoomWorkspace', () => {
  it('returns the launched workspace with refreshed assessment progress', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        workspace: {
          enabled: true,
          canLaunch: true,
          repoUrl: 'https://github.com/pipe/source-backed-worker',
          githubPrNumber: 144,
          matchedRepoId: null,
          challenge: {
            status: 'github_pr_assigned',
            kind: 'github_pr',
            source: 'scheduled_interview.github_pr_number',
            message: null,
            packet: null,
          },
          session: {
            sessionId: 'workspace-session-1',
            status: 'LAUNCHING',
            ttlSeconds: 3600,
            ttlSource: 'default',
            expiresAt: '2026-06-29T12:00:00.000Z',
            warnedAt: null,
            expiringSoon: false,
            proxyPath: null,
            errorMessage: null,
          },
        },
        progress: {
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'IN_PROGRESS',
          stage: 'WORK_IN_PROGRESS',
          nextAction: 'COLLECT_WORK_EVIDENCE',
          nextActionLabel: 'Capture source-backed work evidence.',
          hasChallengePacket: true,
          hasWorkEvidence: true,
          hasCommitSubmission: false,
          hasFinalSubmission: false,
          hasAiInteraction: false,
          hasTranscriptEvidence: false,
          hasTestEvidence: false,
          evidenceCounts: [{ kind: 'dev_container_event', count: 1 }],
          sourceRefCounts: [{ kind: 'dev_container_workspace_launch', count: 1 }],
          latestEvent: { kind: 'dev_container_event', sequence: 2, occurredAt: '2026-06-29T00:00:00.000Z' },
          commit: null,
          evaluation: null,
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(
      launchRoomWorkspace('room-token', 'https://github.com/pipe/source-backed-worker'),
    ).resolves.toMatchObject({
      workspace: { session: { sessionId: 'workspace-session-1' } },
      progress: { state: 'IN_PROGRESS', hasWorkEvidence: true },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toContain('/api/v1/meeting-rooms/room-token/workspace/launch');
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      repoUrl: 'https://github.com/pipe/source-backed-worker',
    });
    fetchSpy.mockRestore();
  });

  it('requests a real Devin bridge only when the host opts in', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        workspace: {
          enabled: true,
          canLaunch: true,
          repoUrl: 'https://github.com/pipe/source-backed-worker',
          githubPrNumber: null,
          matchedRepoId: null,
          challenge: {
            status: 'repo_task_assigned',
            kind: 'repo_only',
            source: 'scheduled_interview.challenge_packet',
            message: null,
            packet: null,
          },
          session: null,
        },
        progress: null,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ));

    await launchRoomWorkspace(
      'room-token',
      'https://github.com/pipe/source-backed-worker',
      'devin',
    );

    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      repoUrl: 'https://github.com/pipe/source-backed-worker',
      agentType: 'devin',
    });
    fetchSpy.mockRestore();
  });
});

describe('getRoomAssessmentProgress', () => {
  it('loads durable room assessment progress without using cached state', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        progress: {
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'FINAL_SUBMITTED',
          stage: 'READY_FOR_EVALUATION',
          nextAction: 'START_EVALUATION',
          nextActionLabel: 'Start source-backed evaluation.',
          hasChallengePacket: true,
          hasWorkEvidence: true,
          hasCommitSubmission: true,
          hasFinalSubmission: false,
          hasAiInteraction: true,
          hasTranscriptEvidence: false,
          hasTestEvidence: true,
          evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
          sourceRefCounts: [{ kind: 'test_run', count: 1 }],
          latestEvent: { kind: 'commit_submission', sequence: 2, occurredAt: '2026-06-29T00:00:00.000Z' },
          commit: {
            repositoryUrl: 'https://github.com/pipe/source-backed-worker',
            forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
            branchName: 'pipe-assessment/retry-fix',
            baseCommitSha: 'a'.repeat(40),
            commitSha: 'b'.repeat(40),
            commitUrl: null,
            changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
            occurredAt: '2026-06-29T00:00:00.000Z',
          },
          evaluation: null,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(getRoomAssessmentProgress('room-token')).resolves.toMatchObject({
      stage: 'READY_FOR_EVALUATION',
      commit: { commitSha: 'b'.repeat(40) },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toContain('/api/v1/meeting-rooms/room-token/assessment/progress');
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
    });
    fetchSpy.mockRestore();
  });

  it('returns null when no assessment session exists yet', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ progress: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(getRoomAssessmentProgress('room-token')).resolves.toBeNull();
    fetchSpy.mockRestore();
  });
});
