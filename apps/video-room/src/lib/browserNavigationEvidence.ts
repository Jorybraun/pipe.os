import type { RoomPhase } from '../types';
import type { RoomSurface } from '../hooks/useRoomConnection';

export type BrowserNavigationActor = 'host' | 'guest';
export type BrowserNavigationTrigger =
  | 'address_bar'
  | 'go_button'
  | 'history_back'
  | 'history_forward'
  | 'open_window_initial_url'
  | 'shared_state_sync';

export interface BrowserNavigationEvidence {
  text: string;
  properties: Record<string, unknown>;
}

interface BrowserNavigationEvidenceInput {
  actor: BrowserNavigationActor;
  windowId: string;
  url: string;
  trigger: BrowserNavigationTrigger;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  capturedAtMs: number;
}

const EMBED_BLOCKED_HOSTS = [
  'accounts.google.com',
  'docs.google.com',
  'github.com',
  'google.com',
  'linkedin.com',
  'mail.google.com',
  'notion.so',
  'stackoverflow.com',
  'twitter.com',
  'x.com',
  'youtube.com',
];

export function normalizeBrowserNavigationUrl(target: string): string | null {
  let normalized = target.trim();
  if (!normalized) return null;
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return normalized;
  } catch {
    return null;
  }
}

export function isKnownEmbedBlockedUrl(target: string): boolean {
  try {
    const host = new URL(target).hostname.replace(/^www\./, '').toLowerCase();
    return EMBED_BLOCKED_HOSTS.some((blockedHost) => host === blockedHost || host.endsWith(`.${blockedHost}`));
  } catch {
    return false;
  }
}

function fingerprintText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `nav_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildBrowserNavigationEvidence(
  input: BrowserNavigationEvidenceInput,
): BrowserNavigationEvidence | null {
  const normalized = normalizeBrowserNavigationUrl(input.url);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const urlFingerprint = fingerprintText(normalized);
  return {
    text: normalized,
    properties: {
      source: 'room_browser_window',
      navigationSource: 'browser_window_client_submit',
      actor: input.actor,
      windowId: input.windowId,
      navigationTrigger: input.trigger,
      browserNavigationId: [
        'browser-navigation',
        input.actor,
        capturedAtMs,
        input.windowId,
        input.trigger,
        urlFingerprint,
      ].join(':'),
      capturedAtMs,
      urlFingerprint,
      url: normalized,
      urlHost: parsed.hostname,
      urlProtocol: parsed.protocol.replace(':', ''),
      urlPath: `${parsed.pathname}${parsed.search}`,
      knownEmbedBlocked: isKnownEmbedBlockedUrl(normalized),
      surface: input.surface,
      roomPhase: input.roomPhase,
      durableObjectReplayExpected: input.surface === 'win95',
    },
  };
}
