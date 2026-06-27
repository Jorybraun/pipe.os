import { describe, expect, it } from 'vitest';
import diagnostics from './agent-diagnostics.js';

const {
  agentDiagnosticMessage,
  boundedDiagnosticText,
  redactDiagnosticText,
} = diagnostics;

describe('agent diagnostics', () => {
  it('redacts likely secrets from bridge diagnostics', () => {
    const text = redactDiagnosticText(
      'DEVIN_API_KEY=sk-live-secret Bearer abc.def TOKEN=raw-token https://x.test/?token=abc123',
    );

    expect(text).toContain('DEVIN_API_KEY=[redacted]');
    expect(text).toContain('Bearer [redacted]');
    expect(text).toContain('TOKEN=[redacted]');
    expect(text).toContain('token=[redacted]');
    expect(text).not.toContain('sk-live-secret');
    expect(text).not.toContain('raw-token');
  });

  it('bounds diagnostic text without fabricating missing context', () => {
    expect(boundedDiagnosticText('abcdef', 3)).toEqual({
      text: 'abc\n[diagnostic truncated]',
      truncated: true,
    });
    expect(boundedDiagnosticText('ok', 10)).toEqual({
      text: 'ok',
      truncated: false,
    });
  });

  it('builds source-marked agent diagnostic messages', () => {
    expect(agentDiagnosticMessage({
      agent: 'devin',
      status: 'disconnected',
      message: 'process exited',
      diagnosticSource: 'agent_exit',
      observedAt: '2026-06-27T19:00:00.000Z',
      exitCode: 1,
      signal: null,
    })).toEqual({
      type: 'AGENT_DIAGNOSTIC',
      agent: 'devin',
      status: 'disconnected',
      message: 'process exited',
      diagnosticSource: 'agent_exit',
      observedAt: '2026-06-27T19:00:00.000Z',
      exitCode: 1,
      signal: null,
      truncated: false,
    });
  });
});
