import { describe, expect, it, vi } from 'vitest';

import { submitRoomAssessmentCommit, uploadRecording } from './api';
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
          evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
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
