import type { RecordingSpeakerMetadata } from '../types';

interface CompositeRecording {
  stream: MediaStream;
  transcriptionStream: MediaStream;
  speakerMetadata: RecordingSpeakerMetadata;
  dispose: () => Promise<void>;
}

const HOST_GUEST_SPEAKER_METADATA: RecordingSpeakerMetadata = {
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

function attachVideo(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  void video.play();
  return video;
}

export async function createCompositeRecording(
  localStream: MediaStream,
  remoteStream: MediaStream,
): Promise<CompositeRecording> {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas recording is unavailable.');

  const localVideo = attachVideo(localStream);
  const remoteVideo = attachVideo(remoteStream);
  let frameId = 0;
  const draw = (): void => {
    context.fillStyle = '#090a0c';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (remoteVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      context.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);
    }
    if (localVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const width = 300;
      const height = 169;
      context.drawImage(localVideo, canvas.width - width - 28, 28, width, height);
    }
    frameId = requestAnimationFrame(draw);
  };
  draw();

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  const channelMerger = audioContext.createChannelMerger(2);
  const audioNodes: AudioNode[] = [channelMerger];
  for (const [channel, sourceStream] of [localStream, remoteStream].entries()) {
    if (sourceStream.getAudioTracks().length === 0) continue;
    const source = audioContext.createMediaStreamSource(sourceStream);
    const splitter = audioContext.createChannelSplitter(2);
    source.connect(splitter);
    splitter.connect(channelMerger, 0, channel);
    audioNodes.push(source, splitter);
  }
  channelMerger.connect(destination);

  const transcriptionStream = destination.stream;
  const stream = canvas.captureStream(30);
  for (const track of transcriptionStream.getAudioTracks()) stream.addTrack(track);

  return {
    stream,
    transcriptionStream,
    speakerMetadata: HOST_GUEST_SPEAKER_METADATA,
    dispose: async () => {
      cancelAnimationFrame(frameId);
      stream.getTracks().forEach((track) => track.stop());
      transcriptionStream.getTracks().forEach((track) => track.stop());
      audioNodes.forEach((node) => node.disconnect());
      localVideo.srcObject = null;
      remoteVideo.srcObject = null;
      await audioContext.close();
    },
  };
}

export function preferredAudioRecordingMimeType(): string {
  const options = [
    'audio/webm;codecs=opus',
    'audio/webm',
  ];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export function preferredAudioRecordingOptions(): MediaRecorderOptions | undefined {
  const mimeType = preferredAudioRecordingMimeType();
  return {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 96_000,
  };
}

export function preferredRecordingMimeType(): string {
  const options = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export function preferredRecordingOptions(): MediaRecorderOptions | undefined {
  const mimeType = preferredRecordingMimeType();
  return {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 96_000,
    videoBitsPerSecond: 650_000,
  };
}
