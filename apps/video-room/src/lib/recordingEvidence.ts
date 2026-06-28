import type { IceServerProvider, RecordingSpeakerMetadata } from '../types';

export interface RecordingLifecycleEvidenceInput {
  lifecycleKind: 'start' | 'stop';
  speakerMetadata?: RecordingSpeakerMetadata | null;
  iceProvider?: IceServerProvider;
  hasTranscriptionAudio?: boolean;
  recordingBytes?: number | null;
  recordingMimeType?: string | null;
  transcriptionBytes?: number | null;
  transcriptionMimeType?: string | null;
  uploadStatus?: 'attempting' | 'accepted';
  transcriptStatus?: string | null;
}

function finiteNonNegative(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
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
