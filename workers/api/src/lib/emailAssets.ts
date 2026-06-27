export const PIPE_EMAIL_LOGO_PATH = '/assets/email/pipe-logo.png';
export const DEFAULT_PIPE_EMAIL_LOGO_URL = 'https://api-dev.hire-pipe.com/assets/email/pipe-logo.png';

const PIPE_EMAIL_LOGO_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAACXBIWXMAAAsTAAALEwEAmpwYAAADP0lEQVR4nO2dO2tUQRiGnyReomiprVFQREnaiYLiBYsgXnpBwcJKgqZREUHEwj9hvCCkVhAjoiCsoKhoiASMjYrEGwpaRLyODEyxhpPFxJnzjTPfAy+BLWb3vA97yLns+UBRFKVI5gBbgNPABeA68ASYAEaBYeA8cArYCHRIf+AcaAN2AZeAj4CdQd4Dg0CfX0eZIVuBBzMs3U6Te8Am6Q36X1jpdyc2Qq4Ay6Q3MGW2zWJXY2exa9JvQwUHgG+Ry7c+X4H90hucEsdqKt5OSb/0hqfAbuCnkIAfwHYKZg3wSah86+Pefy0FMhd4Kly+9XkEtFMYBxMo3jZlLwWxCHidQOm2Ka+ABRTCiQQKtxUZoBDGEyjbVmSEAuhOoGjbIsvJnFR3P9bnEJlzN4GSbYvcIHNin2yz/5jnZMx84FfAsm4BZ4BG4BN12V7A6QpY1NmmdV1hQwHXXkKmrAtYUm/FFbRQa/eQKZsDltQ9ZW0TcG23VpaoAGFUgDAqQBgVIIwKEEYFCKMChFEBwqgAYVSAMCpAGBUgjAoQRgUIowKEUQHCqABhVIAAncBDn5C3JI75Nd0dEbEENJo+e4y4bqKzMGAxtiKTEQVMRv7srhsVgApQATFRAagAqwJUgFUBqAAVQP0Cmg/EYqRRw4HYWMC1x+s+EKsLE0FAjN+1udMxWWJUgCxGBchiVIAsRgXIYlSALEYFyGJUgCxGBchiVIAsRgXIYlSALEYFyGJUgCxGBchiVIAsRgXIYlSALEYFyNITsCQ3LKiuB01lw9KAJQ01PTeuzU9nCrV2tiNU2gNP4Gj4BwLeDrime2DhPDLmZcCyYuQtmXMzgZJb5Q6ZcziBklvlKJnTlUDJrbKaAhhJoOiqPKMQBhIouyrHKYRO4EUChU/972cxBbEvgdKb46YEFkU78DiB4q2/td3NQi6OVQnMKvhc8Yv+4qazfhcq341n3CldQAr0Cwk4Ir3hKbEH+FJT8e4bp+VXsB54E7n8D36QhDIN7lz85UjlXwVWTPfGyp/0BjzPf7/iCpryF7grXX3AIPBuFruai8COnCcu1UkHsAE4CZwDrgGjwIT/O+xfP+Uvqhd5YKUoCqXzG8WSNQQZXBr+AAAAAElFTkSuQmCC';

export function resolvePipeEmailLogoUrl(
  requestUrl?: string | null,
  overrideUrl?: string | null,
): string {
  const override = overrideUrl?.trim();
  if (override) return override;
  if (!requestUrl) return DEFAULT_PIPE_EMAIL_LOGO_URL;
  return new URL(PIPE_EMAIL_LOGO_PATH, requestUrl).toString();
}

export function buildPipeEmailLogoImg(logoUrl: string): string {
  return `<img src="${logoUrl}" alt="PIPE" width="48" height="48" style="display: block; margin-bottom: 24px;" />`;
}

export function pipeEmailLogoResponse(): Response {
  const binary = atob(PIPE_EMAIL_LOGO_BASE64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800, immutable',
      'Content-Length': String(bytes.byteLength),
    },
  });
}
