const DEFAULT_MAX_CHARS = 1200;

function redactDiagnosticText(value) {
  return String(value || '')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, 'sk-[redacted]')
    .replace(/\b((?:DEVIN_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*)[^\s]+/gi, '$1[redacted]')
    .replace(/([?&](?:api_key|key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]');
}

function boundedDiagnosticText(value, maxChars = DEFAULT_MAX_CHARS) {
  const redacted = redactDiagnosticText(value).trim();
  const limit = Number.isFinite(maxChars) && maxChars > 0
    ? Math.floor(maxChars)
    : DEFAULT_MAX_CHARS;
  if (redacted.length <= limit) {
    return { text: redacted, truncated: false };
  }
  return {
    text: `${redacted.slice(0, limit)}\n[diagnostic truncated]`,
    truncated: true,
  };
}

function agentDiagnosticMessage({
  agent = 'devin',
  status = 'disconnected',
  message,
  diagnosticSource,
  observedAt = new Date().toISOString(),
  exitCode = null,
  signal = null,
  maxChars = DEFAULT_MAX_CHARS,
}) {
  const bounded = boundedDiagnosticText(message, maxChars);
  return {
    type: 'AGENT_DIAGNOSTIC',
    agent,
    status,
    message: bounded.text || 'Agent bridge diagnostic.',
    diagnosticSource,
    observedAt,
    exitCode,
    signal,
    truncated: bounded.truncated,
  };
}

module.exports = {
  agentDiagnosticMessage,
  boundedDiagnosticText,
  redactDiagnosticText,
};
