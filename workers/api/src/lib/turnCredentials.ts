import type { Env } from '../types';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceServerResult {
  iceServers: IceServer[];
  provider: 'cloudflare' | 'metered' | 'fallback';
}

export const FALLBACK_ICE_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function hasTurn(iceServers: IceServer[]): boolean {
  return iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:'));
  });
}

function parseTtl(env: Env): number {
  const raw = env.CLOUDFLARE_TURN_TTL_SECONDS;
  if (!raw) return 86400;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 86400;
  return parsed;
}

async function fetchCloudflareTurn(env: Env, logPrefix: string): Promise<IceServer[] | null> {
  const keyId = env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  if (!keyId || !apiToken) return null;

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: parseTtl(env) }),
    },
  );

  if (!response.ok) {
    console.error(`${logPrefix} Cloudflare TURN fetch failed:`, response.status);
    return null;
  }

  const body = await response.json() as { iceServers?: IceServer[] };
  if (!Array.isArray(body.iceServers) || !hasTurn(body.iceServers)) {
    console.error(`${logPrefix} Cloudflare TURN response did not include TURN servers`);
    return null;
  }
  return body.iceServers;
}

async function fetchMeteredTurn(env: Env, logPrefix: string): Promise<IceServer[] | null> {
  if (!env.METERED_API_KEY) return null;

  const response = await fetch(
    `https://pipe-os.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.METERED_API_KEY)}`,
  );

  if (!response.ok) {
    console.error(`${logPrefix} Metered TURN fetch failed:`, response.status);
    return null;
  }

  const body = await response.json() as IceServer[] | { iceServers?: IceServer[] };
  const iceServers = Array.isArray(body) ? body : body.iceServers;
  if (!Array.isArray(iceServers) || !hasTurn(iceServers)) {
    console.error(`${logPrefix} Metered TURN response did not include TURN servers`);
    return null;
  }
  return iceServers;
}

export async function getTurnIceServers(env: Env, logPrefix = '[turn]'): Promise<IceServerResult> {
  const cfKeyId = env.CLOUDFLARE_TURN_KEY_ID;
  const cfApiToken = env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  const meteredKey = env.METERED_API_KEY;
  console.log(`${logPrefix} ICE config check`, {
    hasCloudflareKeyId: Boolean(cfKeyId),
    hasCloudflareApiToken: Boolean(cfApiToken),
    hasMeteredApiKey: Boolean(meteredKey),
  });

  try {
    const cloudflare = await fetchCloudflareTurn(env, logPrefix);
    if (cloudflare) {
      console.log(`${logPrefix} Using Cloudflare TURN`, {
        serverCount: cloudflare.length,
        hasTurn: hasTurn(cloudflare),
      });
      return { iceServers: cloudflare, provider: 'cloudflare' };
    }
    console.warn(`${logPrefix} Cloudflare TURN returned null — falling through to Metered`);
  } catch (error) {
    console.error(`${logPrefix} Cloudflare TURN credentials error:`, error instanceof Error ? error.message : String(error));
  }

  try {
    const metered = await fetchMeteredTurn(env, logPrefix);
    if (metered) {
      console.log(`${logPrefix} Using Metered TURN`, {
        serverCount: metered.length,
        hasTurn: hasTurn(metered),
      });
      return { iceServers: metered, provider: 'metered' };
    }
    console.warn(`${logPrefix} Metered TURN returned null — falling through to STUN-only fallback`);
  } catch (error) {
    console.error(`${logPrefix} Metered TURN credentials error:`, error instanceof Error ? error.message : String(error));
  }

  console.warn(`${logPrefix} All TURN providers failed — using STUN-only fallback. NAT traversal may fail.`);
  return { iceServers: FALLBACK_ICE_SERVERS, provider: 'fallback' };
}
