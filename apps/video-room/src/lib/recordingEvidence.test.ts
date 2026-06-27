import { describe, expect, it } from 'vitest';
import { buildRecordingLifecycleEvidence } from './recordingEvidence';
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

describe('buildRecordingLifecycleEvidence', () => {
  it('captures recording source facts and speaker-channel provenance', () => {
    expect(buildRecordingLifecycleEvidence({
      speakerMetadata,
      iceProvider: 'cloudflare',
      hasTranscriptionAudio: true,
      recordingBytes: 12345,
      recordingMimeType: 'video/webm;codecs=vp9,opus',
      transcriptionBytes: 2345,
      transcriptionMimeType: 'audio/webm;codecs=opus',
      uploadStatus: 'attempting',
    })).toEqual({
      source: 'video_room_recording',
      iceProvider: 'cloudflare',
      hasTranscriptionAudio: true,
      recordingMimeType: 'video/webm;codecs=vp9,opus',
      transcriptionMimeType: 'audio/webm;codecs=opus',
      uploadStatus: 'attempting',
      recordingBytes: 12345,
      transcriptionBytes: 2345,
      speakerMetadataVersion: 1,
      speakerChannelLayout: 'host-local-guest-remote-v1',
      speakerChannelCount: 2,
      speakerChannels: [
        { channel: 0, role: 'host', source: 'local' },
        { channel: 1, role: 'guest', source: 'remote' },
      ],
    });
  });

  it('omits invalid numeric fields instead of fabricating measurements', () => {
    expect(buildRecordingLifecycleEvidence({
      recordingBytes: Number.NaN,
      transcriptionBytes: -1,
      transcriptStatus: null,
    })).toEqual({
      source: 'video_room_recording',
      transcriptStatus: null,
    });
  });
});
