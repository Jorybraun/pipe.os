import type { IceServerProvider, RecordingSpeakerMetadata } from '../types';
import type { RoomSurface } from '../hooks/useRoomConnection';

export type RecordingStateStatus = 'recording' | 'uploading' | 'saved' | 'failed';
export type RecordingFailureStage = 'stop_recorder' | 'prepare_upload' | 'upload_request';
export type RecordingFailureSource =
  | 'browser_media_recorder_exception'
  | 'browser_blob_builder_exception'
  | 'recording_upload_exception';

export interface RecordingLifecycleEvidenceInput {
  lifecycleKind: 'start' | 'stop';
  actor?: 'host';
  capturedAtMs?: number;
  surface?: RoomSurface;
  roomPhase?: string;
  recordingStatus?: RecordingStateStatus;
  recordingActive?: boolean;
  speakerMetadata?: RecordingSpeakerMetadata | null;
  iceProvider?: IceServerProvider;
  hasTranscriptionAudio?: boolean;
  recordingBytes?: number | null;
  recordingMimeType?: string | null;
  transcriptionBytes?: number | null;
  transcriptionMimeType?: string | null;
  uploadStatus?: 'attempting' | 'accepted' | 'failed';
  transcriptStatus?: string | null;
  recordingFailureStage?: RecordingFailureStage;
  recordingFailureSource?: RecordingFailureSource;
  recordingFailureMessage?: string | null;
}

const MAX_FAILURE_MESSAGE_LENGTH = 240;
const SECRET_LIKE_TOKEN_RE = /\b(?:cog|sk|pk|sess|token)_[A-Za-z0-9_-]{8,}\b/g;
const SECRET_QUERY_PARAM_RE = /([?&](?:token|key|secret|password)=)[^&\s]+/gi;

function finiteNonNegative(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function capturedTimestamp(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

function sanitizedFailureMessage(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = value.trim().replace(/\s+/g, ' ');
  if (!collapsed) return null;
  return collapsed
    .replace(SECRET_LIKE_TOKEN_RE, '[redacted]')
    .replace(SECRET_QUERY_PARAM_RE, '$1[redacted]')
    .slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

export function buildRecordingLifecycleEvidence(
  input: RecordingLifecycleEvidenceInput,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    source: 'video_room_recording',
    recordingEventSource: 'browser_media_recorder',
    recordingLifecycleKind: input.lifecycleKind,
  };
  if (input.iceProvider) properties.iceProvider = input.iceProvider;
  const capturedAtMs = capturedTimestamp(input.capturedAtMs);
  if (
    input.actor
    && capturedAtMs !== null
    && input.surface
    && input.roomPhase
    && input.recordingStatus
    && typeof input.recordingActive === 'boolean'
  ) {
    properties.recordingStateEventSource = 'browser_media_recorder_state_sync';
    properties.actor = input.actor;
    properties.recordingStateEventId = [
      'recording',
      input.actor,
      capturedAtMs,
      input.lifecycleKind,
      input.recordingStatus,
    ].join(':');
    properties.capturedAtMs = capturedAtMs;
    properties.surface = input.surface;
    properties.roomPhase = input.roomPhase;
    properties.recordingStatus = input.recordingStatus;
    properties.recordingActive = input.recordingActive;
    properties.durableObjectReplayExpected = true;
  }
  if (input.hasTranscriptionAudio !== undefined) {
    properties.hasTranscriptionAudio = input.hasTranscriptionAudio;
  }
  if (input.recordingMimeType !== undefined) {
    properties.recordingMimeType = input.recordingMimeType;
  }
  if (input.transcriptionMimeType !== undefined) {
    properties.transcriptionMimeType = input.transcriptionMimeType;
  }
  if (input.uploadStatus) properties.uploadStatus = input.uploadStatus;
  if (input.transcriptStatus !== undefined) properties.transcriptStatus = input.transcriptStatus;
  if (input.recordingFailureStage) properties.recordingFailureStage = input.recordingFailureStage;
  if (input.recordingFailureSource) properties.recordingFailureSource = input.recordingFailureSource;
  const failureMessage = sanitizedFailureMessage(input.recordingFailureMessage);
  if (failureMessage !== null) properties.recordingFailureMessage = failureMessage;

  const recordingBytes = finiteNonNegative(input.recordingBytes);
  if (recordingBytes !== null) properties.recordingBytes = recordingBytes;

  const transcriptionBytes = finiteNonNegative(input.transcriptionBytes);
  if (transcriptionBytes !== null) properties.transcriptionBytes = transcriptionBytes;

  const metadata = input.speakerMetadata;
  if (!metadata) return properties;

  properties.speakerMetadataVersion = metadata.version;
  properties.speakerChannelLayout = metadata.transcriptionAudio.channelLayout;
  properties.speakerChannelCount = metadata.transcriptionAudio.channelCount;
  properties.speakerChannels = metadata.transcriptionAudio.channels.map((channel) => ({
    channel: channel.channel,
    role: channel.role,
    source: channel.source,
  }));

  return properties;
}
