const DEFAULT_API_ORIGIN = 'https://api-dev.hire-pipe.com';

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
    },
  });
}

function isAuthorized(request, env) {
  const user = env.DEV_BASIC_AUTH_USER;
  const password = env.DEV_BASIC_AUTH_PASSWORD;
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

function proxyApi(request, env) {
  const secret = env.DEV_PROXY_SECRET;
  if (!secret) return new Response('Missing dev proxy secret', { status: 503 });

  const apiOrigin = env.API_ORIGIN || DEFAULT_API_ORIGIN;
  const url = new URL(request.url);
  const target = new URL(`${url.pathname}${url.search}`, apiOrigin);
  const headers = new Headers(request.headers);
  headers.delete('Authorization');
  headers.set('X-Pipe-Dev-Proxy-Secret', secret);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

  return fetch(new Request(target.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: request.redirect,
  }));
}

async function serveStatic(request, env) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404 || request.method !== 'GET') return response;

  const accept = request.headers.get('Accept') ?? '';
  if (!accept.includes('text/html')) return response;

  const url = new URL(request.url);
  url.pathname = '/index.html';
  return env.ASSETS.fetch(new Request(url.toString(), request));
}

export default {
  fetch(request, env) {
    if (!isAuthorized(request, env)) return unauthorized();

    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return proxyApi(request, env);

    return serveStatic(request, env);
  },
};
