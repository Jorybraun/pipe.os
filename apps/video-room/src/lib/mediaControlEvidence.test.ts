import { describe, expect, it } from 'vitest';
import { buildMediaControlEvidence } from './mediaControlEvidence';

describe('buildMediaControlEvidence', () => {
  it('captures microphone commands as source-backed media-control evidence', () => {
    expect(buildMediaControlEvidence({
      actor: 'guest',
      control: 'microphone',
      enabled: false,
      surface: 'win95',
      roomPhase: 'connected',
    })).toMatchObject({
      text: 'Guest turned microphone off',
      properties: {
        source: 'video_room_media_controls',
        control: 'microphone',
        enabled: false,
        action: 'disabled',
        surface: 'win95',
        roomPhase: 'connected',
        controlSurface: 'win95_video_window',
        mediaSource: 'local_media_stream',
        rawMediaStreamPersisted: false,
      },
    });
  });

  it('captures camera commands from the standard call surface', () => {
    expect(buildMediaControlEvidence({
      actor: 'host',
      control: 'camera',
      enabled: true,
      surface: 'standard',
      roomPhase: 'peer_connected',
    })).toMatchObject({
      text: 'Host turned camera on',
      properties: {
        source: 'video_room_media_controls',
        control: 'camera',
        enabled: true,
        action: 'enabled',
        surface: 'standard',
        roomPhase: 'peer_connected',
        controlSurface: 'standard_video_call',
      },
    });
  });
});
