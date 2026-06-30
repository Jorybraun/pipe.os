export const DEV_PROXY_RECRUITER_USER_ID = 'dev-user';

export function isDevProxyRecruiterAuthBypassEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  const hostname = window.location.hostname.toLowerCase();
  if (hostname === 'app-dev.hire-pipe.com') return true;

  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!isLocalhost) return false;

  return new URLSearchParams(window.location.search).get('devProxyAuth') === '1';
}
