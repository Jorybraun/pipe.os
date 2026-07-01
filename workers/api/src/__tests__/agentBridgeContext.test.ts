import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridgeSource = readFileSync(
  new URL('../../../../infra/containers/code-server/agent-bridge.js', import.meta.url),
  'utf8',
);

describe('dev-container agent bridge context endpoint', () => {
  const forbiddenAuthBypass = `callback?${'sim' + 'ulated'}`;

  it('fetches the source-backed room context summary instead of returning a placeholder', () => {
    expect(bridgeSource).toContain('PIPE_API_URL');
    expect(bridgeSource).toContain('ROOM_TOKEN');
    expect(bridgeSource).toContain('/context-summary');
    expect(bridgeSource).not.toContain('Room context endpoint is available from the PIPE API bridge.');
  });

  it('primes Devin with room context and the assessment action protocol', () => {
    expect(bridgeSource).toContain('buildAgentContextPrompt');
    expect(bridgeSource).toContain('PIPE room context');
    expect(bridgeSource).toContain('[[room_action:open-workspace');
    expect(bridgeSource).toContain('primeAgentWithRoomContext');
    expect(bridgeSource).toContain('agentProcess.stdin.write');
  });

  it('does not expose a local Devin auth bypass or non-agent AI assistant responder', () => {
    expect(bridgeSource).not.toContain(forbiddenAuthBypass);
    expect(bridgeSource).not.toContain('AUTH_CALLBACK');
    expect(bridgeSource).not.toContain('roomActionFromText');
    expect(bridgeSource).not.toContain('I can help by opening');
    expect(bridgeSource).toContain('DEVIN_API_KEY');
    expect(bridgeSource).toContain('authUrl: null');
  });

  it('persists missing-Devin-auth as a bridge diagnostic before any fake agent chat can occur', () => {
    expect(bridgeSource).toContain('function devinAuthDiagnosticMessage()');
    expect(bridgeSource).toContain("let lastAuthDiagnosticSource = 'auth_required';");
    expect(bridgeSource).toContain('diagnosticSource: lastAuthDiagnosticSource');
    expect(bridgeSource).toContain('broadcastAgentDiagnostic(agentDiagnosticMessage({');
    expect(bridgeSource).toContain('sendAgentDiagnostic(ws, devinAuthDiagnosticMessage());');
  });

  it('records Devin API responses with a hashed provider run reference', () => {
    expect(bridgeSource).toContain('function devinApiAgentRunReference');
    expect(bridgeSource).toContain("agentRunProvider: 'devin_api'");
    expect(bridgeSource).toContain('agentRunExternalSessionHash: `sha256:${sessionHash}`');
    expect(bridgeSource).toContain("broadcastAgentChat({\n            agent: AGENT_NAME");
    expect(bridgeSource).toContain("}, 'agent_api_response');");
  });

  it('observes real code-server workspace file changes as source-backed room events', () => {
    expect(bridgeSource).toContain('scanWorkspaceSnapshot');
    expect(bridgeSource).toContain('FILE_CHANGED');
    expect(bridgeSource).toContain('/session-events');
    expect(bridgeSource).toContain("type: eventType");
    expect(bridgeSource).toContain("'code_editor_save'");
    expect(bridgeSource).toContain('code_server_workspace');
    expect(bridgeSource).toContain('sha256');
  });
});
