/**
 * Twilio request signature validation using Web Crypto API.
 *
 * Implements the Twilio signature verification spec:
 * https://www.twilio.com/docs/usage/security#validating-requests
 *
 * Uses HMAC-SHA1 (Twilio's required algorithm) via the Workers Web Crypto API.
 */

/**
 * Validates a Twilio webhook request signature.
 *
 * @param authToken - Twilio Auth Token (used as HMAC key)
 * @param signature - Value of the X-Twilio-Signature header
 * @param url - Full request URL (including https://)
 * @param params - POST body parameters as key-value pairs
 * @returns true if the signature is valid
 */
export async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  // 1. Start with the full URL
  let data = url;

  // 2. Sort POST params alphabetically by key and append key+value
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  // 3. HMAC-SHA1 the data string using the auth token
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));

  // 4. Base64-encode and compare
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // Constant-time comparison
  if (computed.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Generates a Twilio Access Token JWT for browser-based Voice SDK.
 *
 * The token grants outgoing voice calls through a TwiML App.
 * Manually constructed to avoid the heavy twilio npm package in Workers.
 */
export async function generateTwilioAccessToken(opts: {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  identity: string;
  ttlSeconds?: number;
}): Promise<string> {
  const ttl = opts.ttlSeconds ?? 3600;
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' };
  const payload = {
    jti: `${opts.apiKeySid}-${now}`,
    iss: opts.apiKeySid,
    sub: opts.accountSid,
    iat: now,
    exp: now + ttl,
    grants: {
      identity: opts.identity,
      voice: {
        outgoing: { application_sid: opts.twimlAppSid },
      },
    },
  };

  const enc = new TextEncoder();
  const b64url = (data: Uint8Array): string => {
    const str = btoa(String.fromCharCode(...data));
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const b64urlStr = (s: string): string => b64url(enc.encode(s));

  const headerB64 = b64urlStr(JSON.stringify(header));
  const payloadB64 = b64urlStr(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(opts.apiKeySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  const sigB64 = b64url(new Uint8Array(sig));

  return `${signingInput}.${sigB64}`;
}
