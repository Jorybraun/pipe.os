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
      surface: 'win95',
      roomPhase: 'connected',
    });

    expect(evidence).toMatchObject({
      text: 'https://example.com/review?step=1',
      properties: {
        source: 'room_browser_window',
        navigationSource: 'browser_window_client_submit',
        actor: 'guest',
        windowId: 'browser',
        navigationTrigger: 'go_button',
        url: 'https://example.com/review?step=1',
        urlHost: 'example.com',
        urlProtocol: 'https',
        urlPath: '/review?step=1',
        knownEmbedBlocked: false,
        surface: 'win95',
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
});
