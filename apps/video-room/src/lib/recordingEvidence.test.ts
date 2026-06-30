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
      lifecycleKind: 'stop',
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
      recordingEventSource: 'browser_media_recorder',
      recordingLifecycleKind: 'stop',
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
      lifecycleKind: 'stop',
      recordingBytes: Number.NaN,
      transcriptionBytes: -1,
      transcriptStatus: null,
    })).toEqual({
      source: 'video_room_recording',
      recordingEventSource: 'browser_media_recorder',
      recordingLifecycleKind: 'stop',
      transcriptStatus: null,
    });
  });

  it('captures failed upload source facts without leaking token-like secrets', () => {
    expect(buildRecordingLifecycleEvidence({
      lifecycleKind: 'stop',
      actor: 'host',
      capturedAtMs: 1700000000999,
      surface: 'win95',
      roomPhase: 'connected',
      recordingStatus: 'failed',
      recordingActive: false,
      speakerMetadata,
      iceProvider: 'cloudflare',
      hasTranscriptionAudio: true,
      recordingBytes: 12345,
      recordingMimeType: 'video/webm',
      transcriptionBytes: 2345,
      transcriptionMimeType: 'audio/webm',
      uploadStatus: 'failed',
      recordingFailureStage: 'upload_request',
      recordingFailureSource: 'recording_upload_exception',
      recordingFailureMessage: 'Upload failed for token=cog_testsecret123456789 and ?key=abc123',
    })).toMatchObject({
      source: 'video_room_recording',
      recordingStateEventSource: 'browser_media_recorder_state_sync',
      recordingLifecycleKind: 'stop',
      recordingStateEventId: 'recording:host:1700000000999:stop:failed',
      recordingStatus: 'failed',
      recordingActive: false,
      uploadStatus: 'failed',
      recordingFailureStage: 'upload_request',
      recordingFailureSource: 'recording_upload_exception',
      recordingFailureMessage: 'Upload failed for token=[redacted] and ?key=[redacted]',
      recordingBytes: 12345,
      transcriptionBytes: 2345,
      speakerMetadataVersion: 1,
    });
  });

  it('adds source-backed room sync metadata when recording state is shared', () => {
    expect(buildRecordingLifecycleEvidence({
      lifecycleKind: 'start',
      actor: 'host',
      capturedAtMs: 1700000000123.4,
      surface: 'win95',
      roomPhase: 'connected',
      recordingStatus: 'recording',
      recordingActive: true,
      speakerMetadata,
      iceProvider: 'cloudflare',
      hasTranscriptionAudio: true,
    })).toMatchObject({
      source: 'video_room_recording',
      recordingEventSource: 'browser_media_recorder',
      recordingStateEventSource: 'browser_media_recorder_state_sync',
      actor: 'host',
      recordingLifecycleKind: 'start',
      recordingStateEventId: 'recording:host:1700000000123:start:recording',
      capturedAtMs: 1700000000123,
      surface: 'win95',
      roomPhase: 'connected',
      recordingStatus: 'recording',
      recordingActive: true,
      durableObjectReplayExpected: true,
      speakerMetadataVersion: 1,
    });
  });
});
