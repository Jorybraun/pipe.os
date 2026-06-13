import type { Sha256 } from './model';

function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Cannot hash a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  throw new TypeError(`Cannot hash value of type ${typeof value}`);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function sha256(value: string | Uint8Array): Promise<Sha256> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestInput.buffer);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

export async function hashObject(value: unknown): Promise<Sha256> {
  return sha256(stableJson(value));
}

export async function stableId(prefix: string, value: unknown): Promise<string> {
  const digest = await hashObject(value);
  return `${prefix}_${digest.slice('sha256:'.length, 'sha256:'.length + 24)}`;
}
