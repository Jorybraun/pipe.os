const DEFAULT_API_ORIGIN = 'https://api-dev.hire-pipe.com';
const DEV_AUTH_COOKIE = 'pipe_room_dev_auth';
const DEV_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;
const AUTH_MODE_PUBLIC = 'public';
const DEV_HTML_CACHE_RESET = '"cache"';

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function unauthorized() {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="PIPE dev room", charset="UTF-8"',
      'Cache-Control': 'no-store',
      'Set-Cookie': `${DEV_AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function roomAuthUser(env) {
  return env.VIDEO_ROOM_DEV_AUTH_USER || env.DEV_BASIC_AUTH_USER;
}

function roomAuthPassword(env) {
  return env.VIDEO_ROOM_DEV_AUTH_PASSWORD || env.DEV_BASIC_AUTH_PASSWORD;
}

async function devAuthCookieValue(env) {
  const user = roomAuthUser(env);
  const password = roomAuthPassword(env);
  const secret = env.DEV_PROXY_SECRET;
  if (!user || !password || !secret) return null;

  const input = new TextEncoder().encode(`${user}:${password}:${secret}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return bytesToHex(digest);
}

function cookieValue(request, name) {
  const cookie = request.headers.get('Cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return rawValue.join('=');
  }
  return null;
}

function hasValidBasicAuth(request, env) {
  const user = roomAuthUser(env);
  const password = roomAuthPassword(env);
  if (!user || !password) return false;

  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Basic ')) return false;

  let decoded = '';
  try {
    decoded = atob(header.slice('Basic '.length));
  } catch {
    return false;
  }

  const separator = decoded.indexOf(':');
  if (separator === -1) return false;

  return (
    timingSafeEqual(decoded.slice(0, separator), user) &&
    timingSafeEqual(decoded.slice(separator + 1), password)
  );
}

async function authorizationState(request, env) {
  if (env.ROOM_AUTH_MODE === AUTH_MODE_PUBLIC) return AUTH_MODE_PUBLIC;

  const expectedCookie = await devAuthCookieValue(env);
  const suppliedCookie = cookieValue(request, DEV_AUTH_COOKIE);
  if (
    expectedCookie &&
    suppliedCookie &&
    timingSafeEqual(suppliedCookie, expectedCookie)
  ) {
    return 'cookie';
  }

  if (hasValidBasicAuth(request, env)) return 'basic';
  return 'none';
}

async function withDevAuthCookie(response, authState, env) {
  if (authState !== 'basic') return response;

  const cookie = await devAuthCookieValue(env);
  if (!cookie) return response;

  const next = new Response(response.body, response);
  next.headers.append(
    'Set-Cookie',
    `${DEV_AUTH_COOKIE}=${cookie}; Path=/; Max-Age=${DEV_AUTH_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  );
  return next;
}

function isHtmlNavigation(request) {
  if (request.method !== 'GET') return false;
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function devAuthEntryPage(request, env) {
  const cookie = await devAuthCookieValue(env);
  if (!cookie) return null;

  const url = new URL(request.url);
  url.username = '';
  url.password = '';
  const cleanUrl = url.toString();

  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Opening PIPE Room</title><script>location.replace(${JSON.stringify(cleanUrl)});</script></head><body><a href="${escapeHtml(cleanUrl)}">Open PIPE Room</a></body></html>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'no-store',
        'Clear-Site-Data': DEV_HTML_CACHE_RESET,
        'Pragma': 'no-cache',
        'Expires': '0',
        'Set-Cookie': `${DEV_AUTH_COOKIE}=${cookie}; Path=/; Max-Age=${DEV_AUTH_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
      },
    },
  );
}

function proxyApi(request, env) {
  const secret = env.DEV_PROXY_SECRET;
  if (!secret && env.ROOM_AUTH_MODE !== AUTH_MODE_PUBLIC) {
    console.error('[room-proxy] Missing dev proxy secret');
    return new Response('Missing dev proxy secret', { status: 503 });
  }

  const apiOrigin = env.API_ORIGIN || DEFAULT_API_ORIGIN;
  const url = new URL(request.url);
  const target = new URL(`${url.pathname}${url.search}`, apiOrigin);
  const headers = new Headers(request.headers);
  const contentLength = headers.get('Content-Length');
  headers.delete('Authorization');
  if (secret) headers.set('X-Pipe-Dev-Proxy-Secret', secret);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

  const isRecording = url.pathname.endsWith('/recording');
  if (isRecording) {
    console.log('[room-proxy] Recording upload request', {
      path: url.pathname,
      method: request.method,
      contentType: headers.get('Content-Type'),
      contentLength: contentLength ?? 'unknown',
      target: target.toString(),
    });
  }

  const proxyRequest = new Request(target.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: request.redirect,
  });

  return fetch(proxyRequest).then((response) => {
    if (isRecording) {
      console.log('[room-proxy] Recording upload response', {
        path: url.pathname,
        status: response.status,
        statusText: response.statusText,
      });
    }
    if (!response.ok && isRecording) {
      console.error('[room-proxy] Recording upload failed', {
        status: response.status,
        statusText: response.statusText,
      });
    }
    return response;
  }).catch((error) => {
    console.error('[room-proxy] Proxy fetch error', {
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });
}

async function serveStatic(request, env) {
  const response = await env.ASSETS.fetch(request);
  if (isStaleAssetFallback(request, response)) return staleAssetResponse(request);
  if (response.status !== 404 || request.method !== 'GET') return withCleanBase(response, request);

  const accept = request.headers.get('Accept') ?? '';
  if (!accept.includes('text/html')) return response;

  const url = new URL(request.url);
  url.pathname = '/index.html';
  return withCleanBase(await env.ASSETS.fetch(new Request(url.toString(), request)), request);
}

function isStaleAssetFallback(request, response) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/assets/')) return false;
  if (response.status === 404) return true;

  const contentType = response.headers.get('Content-Type') ?? '';
  return contentType.includes('text/html');
}

function staleAssetResponse(request) {
  const body = request.method === 'HEAD'
    ? null
    : 'Asset not found. Refresh the room to load the current dev bundle.';
  return new Response(body, {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function withCleanBase(response, request) {
  if (response.status !== 200) return response;
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/html')) return response;

  const url = new URL(request.url);
  url.username = '';
  url.password = '';
  const baseHref = `${url.protocol}//${url.host}/`;
  const html = await response.text();
  const withBase = html.includes('<base ')
    ? html
    : html.replace(/<head>/i, `<head><base href="${escapeHtml(baseHref)}">`);
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete('Clear-Site-Data');
  headers.delete('Pragma');
  headers.delete('Expires');
  headers.set('Cache-Control', 'no-store');
  return new Response(withBase, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const authState = await authorizationState(request, env);
    if (authState === 'none') return unauthorized();

    const { pathname } = new URL(request.url);
    if (authState === 'basic' && isHtmlNavigation(request) && !pathname.startsWith('/api/')) {
      const entryPage = await devAuthEntryPage(request, env);
      if (entryPage) return entryPage;
    }

    if (pathname.startsWith('/api/')) {
      return withDevAuthCookie(await proxyApi(request, env), authState, env);
    }

    return withDevAuthCookie(await serveStatic(request, env), authState, env);
  },
};
