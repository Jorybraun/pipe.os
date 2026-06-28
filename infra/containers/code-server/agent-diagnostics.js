const crypto = require('crypto');

const DEFAULT_MAX_CHARS = 1200;
const PROMPT_TYPES = new Set(['context_primer', 'chat_prompt']);

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

function diagnosticTextMetrics(value) {
  const text = redactDiagnosticText(value).trim();
  if (!text) {
    return {
      length: 0,
      fingerprint: null,
    };
  }
  return {
    length: text.length,
    fingerprint: `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`,
  };
}

function isAgentAuthFailureText(value) {
  const text = String(value || '').toLowerCase();
  if (!text.trim()) return false;
  return (
    (text.includes('auth') || text.includes('login') || text.includes('credential'))
    && (
      text.includes('required')
      || text.includes('failed')
      || text.includes('invalid')
      || text.includes('missing')
      || text.includes('not authenticated')
      || text.includes('please login')
      || text.includes('log in')
    )
  ) || text.includes('devin auth login');
}

function normalizedPromptType(value) {
  return PROMPT_TYPES.has(value) ? value : 'chat_prompt';
}

function safeEvidenceIdPart(value) {
  const normalized = String(value || 'none')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'none';
}

function agentStatusEventId({
  agent = 'devin',
  capturedAtMs = 0,
  bridgeMessageSource = 'bridge_diagnostic',
  status = null,
  diagnosticSource = null,
}) {
  const captured = Number.isFinite(capturedAtMs) ? Math.max(0, Math.round(capturedAtMs)) : 0;
  return [
    'agent-status',
    safeEvidenceIdPart(agent),
    String(captured),
    safeEvidenceIdPart(bridgeMessageSource),
    safeEvidenceIdPart(status),
    safeEvidenceIdPart(diagnosticSource),
  ].join(':');
}

function agentResponseFingerprint(value) {
  const text = String(value || '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `agent_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function agentChatResponseId({
  agent = 'devin',
  capturedAtMs = 0,
  responseFingerprint = 'agent_00000000',
}) {
  const captured = Number.isFinite(capturedAtMs) ? Math.max(0, Math.round(capturedAtMs)) : 0;
  return [
    'agent-chat',
    safeEvidenceIdPart(agent),
    String(captured),
    'CHAT_RESPONSE',
    safeEvidenceIdPart(responseFingerprint),
  ].join(':');
}

function clippyActionEventId({
  actor = 'agent',
  capturedAtMs = 0,
  source = 'clippy_agent_bridge',
  origin = 'agent',
  executionStatus = 'suggested',
  actionId = 'unknown-action',
}) {
  const captured = Number.isFinite(capturedAtMs) ? Math.max(0, Math.round(capturedAtMs)) : 0;
  return [
    'clippy-action',
    safeEvidenceIdPart(actor),
    String(captured),
    safeEvidenceIdPart(source),
    safeEvidenceIdPart(origin),
    safeEvidenceIdPart(executionStatus),
    safeEvidenceIdPart(actionId),
  ].join(':');
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

function agentPromptHandoffDiagnosticMessage({
  agent = 'devin',
  status = 'thinking',
  promptType = 'chat_prompt',
  deliveredToAgent = false,
  roomContextStatus = null,
  roomContextText = '',
  promptText = '',
  userMessage = '',
  observedAt = new Date().toISOString(),
  maxChars = DEFAULT_MAX_CHARS,
}) {
  const safeAgent = String(agent || 'devin').trim() || 'devin';
  const safePromptType = normalizedPromptType(promptType);
  const promptLabel = safePromptType === 'context_primer' ? 'context primer' : 'chat prompt';
  const delivered = deliveredToAgent === true;
  const promptMetrics = diagnosticTextMetrics(promptText);
  const roomContextMetrics = diagnosticTextMetrics(roomContextText);
  const userMessageMetrics = diagnosticTextMetrics(userMessage);
  const baseMessage = agentDiagnosticMessage({
    agent: safeAgent,
    status,
    message: `${safeAgent} ${promptLabel} ${delivered ? 'delivered' : 'was not delivered'} to process stdin.`,
    diagnosticSource: safePromptType === 'context_primer'
      ? 'agent_context_primer_sent'
      : 'agent_prompt_sent',
    observedAt,
    maxChars,
  });

  return {
    ...baseMessage,
    promptType: safePromptType,
    deliveredToAgent: delivered,
    promptLength: promptMetrics.length,
    promptFingerprint: promptMetrics.fingerprint,
    roomContextStatus: Number.isFinite(roomContextStatus) ? Math.floor(roomContextStatus) : null,
    roomContextLength: roomContextMetrics.length,
    roomContextFingerprint: roomContextMetrics.fingerprint,
    userMessageLength: userMessageMetrics.length,
    userMessageFingerprint: userMessageMetrics.fingerprint,
    contextTruncated: String(roomContextText || '').includes('[PIPE room context truncated]'),
  };
}

function agentDiagnosticSessionEvent(message) {
  const eventMessage = message && typeof message === 'object' ? message : {};
  const agent = String(eventMessage.agent || 'devin');
  const observedAt = eventMessage.observedAt ?? null;
  const parsedObservedAt = typeof observedAt === 'string' ? Date.parse(observedAt) : Number.NaN;
  const capturedAtMs = Number.isFinite(parsedObservedAt) ? parsedObservedAt : Date.now();
  const status = eventMessage.status ?? null;
  const diagnosticSource = eventMessage.diagnosticSource ?? null;
  return {
    type: 'ai_agent_status',
    text: String(eventMessage.message || 'Agent bridge diagnostic.'),
    actor: 'agent',
    properties: {
      source: 'clippy_agent_bridge',
      agent,
      status,
      diagnosticSource,
      bridgeMessageSource: 'bridge_diagnostic',
      observedAt,
      capturedAtMs,
      agentStatusEventId: agentStatusEventId({
        agent,
        capturedAtMs,
        bridgeMessageSource: 'bridge_diagnostic',
        status,
        diagnosticSource,
      }),
      exitCode: eventMessage.exitCode ?? null,
      signal: eventMessage.signal ?? null,
      truncated: eventMessage.truncated ?? null,
      promptType: eventMessage.promptType ?? null,
      deliveredToAgent: eventMessage.deliveredToAgent ?? null,
      promptLength: eventMessage.promptLength ?? null,
      promptFingerprint: eventMessage.promptFingerprint ?? null,
      roomContextStatus: eventMessage.roomContextStatus ?? null,
      roomContextLength: eventMessage.roomContextLength ?? null,
      roomContextFingerprint: eventMessage.roomContextFingerprint ?? null,
      userMessageLength: eventMessage.userMessageLength ?? null,
      userMessageFingerprint: eventMessage.userMessageFingerprint ?? null,
      contextTruncated: eventMessage.contextTruncated ?? null,
      bridgePersisted: true,
    },
  };
}

function agentChatSessionEvent({
  agent = 'devin',
  text,
  observedAt = new Date().toISOString(),
  actionCount = 0,
}) {
  const responseText = String(text || '');
  const safeAgent = String(agent || 'devin');
  const parsedObservedAt = typeof observedAt === 'string' ? Date.parse(observedAt) : Number.NaN;
  const capturedAtMs = Number.isFinite(parsedObservedAt) ? parsedObservedAt : Date.now();
  const responseFingerprint = agentResponseFingerprint(responseText);
  return {
    type: 'ai_chat_agent',
    text: responseText,
    actor: 'agent',
    properties: {
      source: 'clippy_agent_bridge',
      agent: safeAgent,
      bridgeEventType: 'CHAT_RESPONSE',
      bridgeMessageSource: 'agent_stdout',
      observedAt,
      capturedAtMs,
      agentChatResponseId: agentChatResponseId({
        agent: safeAgent,
        capturedAtMs,
        responseFingerprint,
      }),
      responseFingerprint,
      responseLength: responseText.length,
      actionCount: Number.isFinite(actionCount) ? Math.max(0, Math.floor(actionCount)) : 0,
      bridgePersisted: true,
    },
  };
}

function safeActionString(value, fallback = null, maxChars = DEFAULT_MAX_CHARS) {
  const raw = typeof value === 'string' && value.trim().length > 0 ? value : fallback;
  if (raw === null || raw === undefined) return null;
  return boundedDiagnosticText(raw, maxChars).text || null;
}

function agentRoomActionSessionEvent({
  agent = 'devin',
  action,
  observedAt = new Date().toISOString(),
}) {
  const safeAgent = String(agent || 'devin');
  const rawAction = action && typeof action === 'object' ? action : {};
  const actionId = safeActionString(rawAction.action ?? rawAction.id ?? rawAction.name, 'unknown-action', 120)
    ?? 'unknown-action';
  const parsedObservedAt = typeof observedAt === 'string' ? Date.parse(observedAt) : Number.NaN;
  const capturedAtMs = Number.isFinite(parsedObservedAt) ? parsedObservedAt : Date.now();
  return {
    type: 'clippy_action',
    text: `${safeAgent} suggested room action: ${actionId}`,
    actor: 'agent',
    properties: {
      source: 'clippy_agent_bridge',
      origin: 'agent',
      executionStatus: 'suggested',
      actionId,
      actionSource: safeActionString(rawAction.source, 'agent_stdout', 120),
      actionProtocol: safeActionString(rawAction.protocol, 'clippy_room_action_tag', 120),
      bridgeEventType: 'ROOM_ACTION',
      agent: safeAgent,
      agentActionLabel: safeActionString(rawAction.label, null, 500),
      agentActionText: safeActionString(rawAction.text, null, 1000),
      autoExecute: typeof rawAction.autoExecute === 'boolean' ? rawAction.autoExecute : null,
      url: safeActionString(rawAction.url ?? rawAction.href, null, 2048),
      observedAt,
      capturedAtMs,
      clippyActionEventId: clippyActionEventId({
        actor: 'agent',
        capturedAtMs,
        source: 'clippy_agent_bridge',
        origin: 'agent',
        executionStatus: 'suggested',
        actionId,
      }),
      bridgePersisted: true,
    },
  };
}

module.exports = {
  agentChatSessionEvent,
  agentDiagnosticMessage,
  agentDiagnosticSessionEvent,
  agentRoomActionSessionEvent,
  agentPromptHandoffDiagnosticMessage,
  boundedDiagnosticText,
  diagnosticTextMetrics,
  isAgentAuthFailureText,
  redactDiagnosticText,
};
