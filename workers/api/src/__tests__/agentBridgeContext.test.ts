import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridgeSource = readFileSync(
  new URL('../../../../infra/containers/code-server/agent-bridge.js', import.meta.url),
  'utf8',
);

describe('dev-container agent bridge context endpoint', () => {
  it('fetches the source-backed room context summary instead of returning a placeholder', () => {
    expect(bridgeSource).toContain('PIPE_API_URL');
    expect(bridgeSource).toContain('ROOM_TOKEN');
    expect(bridgeSource).toContain('/context-summary');
    expect(bridgeSource).not.toContain('Room context endpoint is available from the PIPE API bridge.');
  });
});
