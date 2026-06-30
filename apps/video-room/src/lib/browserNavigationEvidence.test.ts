import { describe, expect, it } from 'vitest';
import {
  buildBrowserNavigationEvidence,
  isKnownEmbedBlockedUrl,
  normalizeBrowserNavigationUrl,
} from './browserNavigationEvidence';

describe('browser navigation evidence', () => {
  it('normalizes user-entered URLs without inventing unsupported protocols', () => {
    expect(normalizeBrowserNavigationUrl('example.com')).toBe('https://example.com');
    expect(normalizeBrowserNavigationUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    expect(normalizeBrowserNavigationUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBrowserNavigationUrl('')).toBeNull();
  });

  it('builds source-backed navigation evidence with URL components and trigger', () => {
    const evidence = buildBrowserNavigationEvidence({
      actor: 'guest',
      windowId: 'browser',
      url: 'example.com/review?step=1',
      trigger: 'go_button',
      surface: 'assessment',
      roomPhase: 'connected',
      capturedAtMs: 1000,
    });

    expect(evidence).toMatchObject({
      text: 'https://example.com/review?step=1',
      properties: {
        source: 'room_browser_window',
        navigationSource: 'browser_window_client_submit',
        actor: 'guest',
        windowId: 'browser',
        navigationTrigger: 'go_button',
        browserNavigationId: 'browser-navigation:guest:1000:browser:go_button:nav_54d2c495',
        capturedAtMs: 1000,
        urlFingerprint: 'nav_54d2c495',
        url: 'https://example.com/review?step=1',
        urlHost: 'example.com',
        urlProtocol: 'https',
        urlPath: '/review?step=1',
        knownEmbedBlocked: false,
        surface: 'assessment',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    });
  });

  it('marks known blocked embed hosts without claiming browser failure from unknown sites', () => {
    expect(isKnownEmbedBlockedUrl('https://github.com/openai/codex')).toBe(true);
    expect(isKnownEmbedBlockedUrl('https://subdomain.youtube.com/watch?v=1')).toBe(true);
    expect(isKnownEmbedBlockedUrl('https://example.com')).toBe(false);
  });

  it('builds distinct source ids for reload and external-open interactions', () => {
    const reload = buildBrowserNavigationEvidence({
      actor: 'host',
      windowId: 'browser',
      url: 'https://example.com/review',
      trigger: 'reload_button',
      surface: 'assessment',
      roomPhase: 'connected',
      capturedAtMs: 2000,
    });
    const externalOpen = buildBrowserNavigationEvidence({
      actor: 'host',
      windowId: 'browser',
      url: 'https://example.com/review',
      trigger: 'external_open',
      surface: 'assessment',
      roomPhase: 'connected',
      capturedAtMs: 2000,
    });

    expect(reload?.properties).toMatchObject({
      navigationTrigger: 'reload_button',
      browserNavigationId: 'browser-navigation:host:2000:browser:reload_button:nav_c42d69e8',
    });
    expect(externalOpen?.properties).toMatchObject({
      navigationTrigger: 'external_open',
      browserNavigationId: 'browser-navigation:host:2000:browser:external_open:nav_c42d69e8',
    });
  });

  it('builds source-specific ids for links opened from the legacy desktop file manager', () => {
    const evidence = buildBrowserNavigationEvidence({
      actor: 'guest',
      windowId: 'browser',
      url: 'https://example.com/from-file',
      trigger: 'file_system_link_open',
      surface: 'assessment',
      roomPhase: 'connected',
      capturedAtMs: 3000,
    });

    expect(evidence?.properties).toMatchObject({
      navigationTrigger: 'file_system_link_open',
      browserNavigationId: expect.stringMatching(
        /^browser-navigation:guest:3000:browser:file_system_link_open:nav_[a-f0-9]{8}$/,
      ),
      durableObjectReplayExpected: true,
    });
  });
});
