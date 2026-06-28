import { describe, expect, it, vi } from 'vitest';

import { uploadRecording } from './api';
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
