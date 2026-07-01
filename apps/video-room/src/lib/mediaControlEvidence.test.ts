import { describe, expect, it } from 'vitest';
import { buildMediaControlEvidence } from './mediaControlEvidence';

describe('buildMediaControlEvidence', () => {
  it('captures microphone commands as source-backed media-control evidence', () => {
    expect(buildMediaControlEvidence({
      actor: 'guest',
      control: 'microphone',
      previousEnabled: true,
      enabled: false,
      surface: 'standard',
      roomPhase: 'connected',
      capturedAtMs: 1000,
    })).toMatchObject({
      text: 'Guest turned microphone off',
      properties: {
        source: 'video_room_media_controls',
        mediaControlEventSource: 'browser_video_control_button',
        actor: 'guest',
        mediaControlId: 'media:guest:microphone:1000:disabled',
        capturedAtMs: 1000,
        control: 'microphone',
        previousEnabled: true,
        enabled: false,
        action: 'disabled',
        surface: 'standard',
        roomPhase: 'connected',
        controlSurface: 'standard_video_call',
        controlAction: 'toggle',
        mediaSource: 'local_media_stream',
        rawMediaStreamPersisted: false,
      },
    });
  });

  it('captures camera commands from the standard call surface', () => {
    expect(buildMediaControlEvidence({
      actor: 'host',
      control: 'camera',
      previousEnabled: false,
      enabled: true,
      surface: 'standard',
      roomPhase: 'peer_connected',
      capturedAtMs: 2000,
    })).toMatchObject({
      text: 'Host turned camera on',
      properties: {
        source: 'video_room_media_controls',
        mediaControlEventSource: 'browser_video_control_button',
        actor: 'host',
        mediaControlId: 'media:host:camera:2000:enabled',
        capturedAtMs: 2000,
        control: 'camera',
        previousEnabled: false,
        enabled: true,
        action: 'enabled',
        surface: 'standard',
        roomPhase: 'peer_connected',
        controlSurface: 'standard_video_call',
        controlAction: 'toggle',
      },
    });
  });
});
