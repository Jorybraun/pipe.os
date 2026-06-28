export const AGENT_DIAGNOSTIC_REDACTED_SECRET = '[REDACTED_SECRET]';

const AGENT_BARE_SECRET_RE = /\b(?:cog|ghp|gho|ghu|ghs|ghr|devin)_[A-Za-z0-9_-]{20,}\b/g;
const AGENT_GITHUB_PAT_RE = /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g;
const AGENT_OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const AGENT_BEARER_TOKEN_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const AGENT_ENV_SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_]*(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD))=([^\s"'`]+)/gi;
const AGENT_SECRET_QUERY_RE = /([?&](?:api_key|key|token|secret|password)=)[^&\s]+/gi;
const AGENT_ROOM_TOKEN_PATH_RE = /(\/api\/v1\/meeting-rooms\/)[^/\s?]+/g;

export function redactAgentDiagnosticText(value: unknown, maxLength = 8000): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const redacted = value
    .replace(AGENT_BARE_SECRET_RE, AGENT_DIAGNOSTIC_REDACTED_SECRET)
    .replace(AGENT_GITHUB_PAT_RE, AGENT_DIAGNOSTIC_REDACTED_SECRET)
    .replace(AGENT_OPENAI_KEY_RE, AGENT_DIAGNOSTIC_REDACTED_SECRET)
    .replace(AGENT_BEARER_TOKEN_RE, `$1${AGENT_DIAGNOSTIC_REDACTED_SECRET}`)
    .replace(AGENT_ENV_SECRET_ASSIGNMENT_RE, `$1=${AGENT_DIAGNOSTIC_REDACTED_SECRET}`)
    .replace(AGENT_SECRET_QUERY_RE, `$1${AGENT_DIAGNOSTIC_REDACTED_SECRET}`)
    .replace(AGENT_ROOM_TOKEN_PATH_RE, `$1${AGENT_DIAGNOSTIC_REDACTED_SECRET}`);
  return redacted.length > maxLength ? redacted.slice(0, maxLength) : redacted;
}
