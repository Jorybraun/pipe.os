const crypto = require('crypto');

const DEFAULT_MAX_CHARS = 1200;
const PROMPT_TYPES = new Set(['context_primer', 'chat_prompt']);
const REDACTED_SECRET = '[REDACTED_SECRET]';

function redactDiagnosticText(value) {
  return String(value || '')
    .replace(/\b(?:cog|ghp|gho|ghu|ghs|ghr|devin)_[A-Za-z0-9_-]{20,}\b/g, REDACTED_SECRET)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED_SECRET)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED_SECRET)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED_SECRET}`)
    .replace(/\b([A-Za-z0-9_]*(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD)\s*=\s*)[^\s"'`]+/gi, `$1${REDACTED_SECRET}`)
    .replace(/([?&](?:api_key|key|token|secret|password)=)[^&\s]+/gi, `$1${REDACTED_SECRET}`)
    .replace(/(\/api\/v1\/meeting-rooms\/)[^/\s?]+/g, `$1${REDACTED_SECRET}`);
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
    text.includes('login canceled')
    || text.includes('login cancelled')
    || (
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
    )
  ) || text.includes('devin auth login');
}

function normalizedPromptType(value) {
  return PROMPT_TYPES.has(value) ? value : 'chat_prompt';
}

function safePromptReferenceString(value, maxChars = 240) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return boundedDiagnosticText(value, maxChars).text || null;
}

function safePromptReferenceNumber(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function safeEvidenceIdPart(value) {
  const normalized = String(value || 'none')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'none';
}

function safeAgentName(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function agentStatusEventId({
  agent = null,
  capturedAtMs = 0,
  bridgeMessageSource = 'bridge_diagnostic',
  status = null,
  diagnosticSource = null,
}) {
  const safeAgent = safeAgentName(agent);
  if (!safeAgent) return null;
  const captured = Number.isFinite(capturedAtMs) ? Math.max(0, Math.round(capturedAtMs)) : 0;
  return [
    'agent-status',
    safeEvidenceIdPart(safeAgent),
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
  agent = null,
  capturedAtMs = 0,
  responseFingerprint = 'agent_00000000',
}) {
  const safeAgent = safeAgentName(agent);
  if (!safeAgent) return null;
  const captured = Number.isFinite(capturedAtMs) ? Math.max(0, Math.round(capturedAtMs)) : 0;
  return [
    'agent-chat',
    safeEvidenceIdPart(safeAgent),
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
  agent = null,
  status = 'disconnected',
  message,
  diagnosticSource,
  observedAt = new Date().toISOString(),
  exitCode = null,
  signal = null,
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  const safeAgent = safeAgentName(agent);
  if (!safeAgent) return null;
  const bounded = boundedDiagnosticText(message, maxChars);
  return {
    type: 'AGENT_DIAGNOSTIC',
    agent: safeAgent,
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
  agent = null,
  status = 'thinking',
  promptType = 'chat_prompt',
  deliveredToAgent = false,
  roomContextStatus = null,
  roomContextText = '',
  promptText = '',
  userMessage = '',
  browserPromptId = null,
  browserPromptFingerprint = null,
  browserPromptTimestamp = null,
  browserPromptLength = null,
  observedAt = new Date().toISOString(),
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  const safeAgent = safeAgentName(agent);
  if (!safeAgent) return null;
  const safePromptType = normalizedPromptType(promptType);
  const promptLabel = safePromptType === 'context_primer' ? 'context primer' : 'chat prompt';
  const delivered = deliveredToAgent === true;
  const promptMetrics = diagnosticTextMetrics(promptText);
  const roomContextMetrics = diagnosticTextMetrics(roomContextText);
  const userMessageMetrics = diagnosticTextMetrics(userMessage);
  const browserPromptReferences = {
    browserPromptId: safePromptReferenceString(browserPromptId),
    browserPromptFingerprint: safePromptReferenceString(browserPromptFingerprint, 80),
    browserPromptTimestamp: safePromptReferenceNumber(browserPromptTimestamp),
    browserPromptLength: safePromptReferenceNumber(browserPromptLength),
  };
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
    ...(browserPromptReferences.browserPromptId ? { browserPromptId: browserPromptReferences.browserPromptId } : {}),
    ...(browserPromptReferences.browserPromptFingerprint
      ? { browserPromptFingerprint: browserPromptReferences.browserPromptFingerprint }
      : {}),
    ...(browserPromptReferences.browserPromptTimestamp !== null
      ? { browserPromptTimestamp: browserPromptReferences.browserPromptTimestamp }
      : {}),
    ...(browserPromptReferences.browserPromptLength !== null
      ? { browserPromptLength: browserPromptReferences.browserPromptLength }
      : {}),
  };
}

function agentDiagnosticSessionEvent(message) {
  const eventMessage = message && typeof message === 'object' ? message : {};
  const agent = safeAgentName(eventMessage.agent);
  if (!agent) return null;
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
      ...(typeof eventMessage.browserPromptId === 'string' ? { browserPromptId: eventMessage.browserPromptId } : {}),
      ...(typeof eventMessage.browserPromptFingerprint === 'string'
        ? { browserPromptFingerprint: eventMessage.browserPromptFingerprint }
        : {}),
      ...(Number.isFinite(eventMessage.browserPromptTimestamp)
        ? { browserPromptTimestamp: Math.max(0, Math.floor(eventMessage.browserPromptTimestamp)) }
        : {}),
      ...(Number.isFinite(eventMessage.browserPromptLength)
        ? { browserPromptLength: Math.max(0, Math.floor(eventMessage.browserPromptLength)) }
        : {}),
      bridgePersisted: true,
    },
  };
}

function agentChatSessionEvent({
  agent = null,
  text,
  observedAt = new Date().toISOString(),
  actionCount = 0,
  browserPromptId = null,
  browserPromptFingerprint = null,
  browserPromptTimestamp = null,
  browserPromptLength = null,
} = {}) {
  const responseText = redactDiagnosticText(text);
  const safeAgent = safeAgentName(agent);
  if (!safeAgent) return null;
  const parsedObservedAt = typeof observedAt === 'string' ? Date.parse(observedAt) : Number.NaN;
  const capturedAtMs = Number.isFinite(parsedObservedAt) ? parsedObservedAt : Date.now();
  const responseFingerprint = agentResponseFingerprint(responseText);
  const browserPromptReferences = {
    browserPromptId: safePromptReferenceString(browserPromptId),
    browserPromptFingerprint: safePromptReferenceString(browserPromptFingerprint, 80),
    browserPromptTimestamp: safePromptReferenceNumber(browserPromptTimestamp),
    browserPromptLength: safePromptReferenceNumber(browserPromptLength),
  };
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
      ...(browserPromptReferences.browserPromptId ? { browserPromptId: browserPromptReferences.browserPromptId } : {}),
      ...(browserPromptReferences.browserPromptFingerprint
        ? { browserPromptFingerprint: browserPromptReferences.browserPromptFingerprint }
        : {}),
      ...(browserPromptReferences.browserPromptTimestamp !== null
        ? { browserPromptTimestamp: browserPromptReferences.browserPromptTimestamp }
        : {}),
      ...(browserPromptReferences.browserPromptLength !== null
        ? { browserPromptLength: browserPromptReferences.browserPromptLength }
        : {}),
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
  agent = null,
  action,
  observedAt = new Date().toISOString(),
} = {}) {
  const safeAgent = safeAgentName(agent);
  if (!safeAgent) return null;
  const rawAction = action && typeof action === 'object' ? action : {};
  const actionId = safeActionString(rawAction.action ?? rawAction.id ?? rawAction.name, null, 120);
  const actionSource = safeActionString(rawAction.source, null, 120);
  const actionProtocol = safeActionString(rawAction.protocol, null, 120);
  if (!actionId || actionSource !== 'agent_stdout' || actionProtocol !== 'clippy_room_action_tag') {
    return null;
  }
  const browserPromptReferences = {
    browserPromptId: safePromptReferenceString(rawAction.browserPromptId),
    browserPromptFingerprint: safePromptReferenceString(rawAction.browserPromptFingerprint, 80),
    browserPromptTimestamp: safePromptReferenceNumber(rawAction.browserPromptTimestamp),
    browserPromptLength: safePromptReferenceNumber(rawAction.browserPromptLength),
  };
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
      actionSource,
      actionProtocol,
      bridgeEventType: 'ROOM_ACTION',
      agent: safeAgent,
      agentActionLabel: safeActionString(rawAction.label, null, 500),
      agentActionText: safeActionString(rawAction.text, null, 1000),
      autoExecute: typeof rawAction.autoExecute === 'boolean' ? rawAction.autoExecute : null,
      url: safeActionString(rawAction.url ?? rawAction.href, null, 2048),
      ...(browserPromptReferences.browserPromptId ? { browserPromptId: browserPromptReferences.browserPromptId } : {}),
      ...(browserPromptReferences.browserPromptFingerprint
        ? { browserPromptFingerprint: browserPromptReferences.browserPromptFingerprint }
        : {}),
      ...(browserPromptReferences.browserPromptTimestamp !== null
        ? { browserPromptTimestamp: browserPromptReferences.browserPromptTimestamp }
        : {}),
      ...(browserPromptReferences.browserPromptLength !== null
        ? { browserPromptLength: browserPromptReferences.browserPromptLength }
        : {}),
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
