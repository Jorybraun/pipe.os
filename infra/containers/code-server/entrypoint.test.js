import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('code-server container entrypoint', () => {
  it('marks /workspace as a safe git directory before exact commit checks', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'infra/containers/code-server/entrypoint.sh'),
      'utf8',
    );

    const safeDirectoryIndex = script.indexOf('git config --global --add safe.directory /workspace');
    const commitCheckIndex = script.indexOf('git cat-file -e "${CHALLENGE_BASE_COMMIT_SHA}^{commit}"');
    const checkoutIndex = script.indexOf('git checkout -B "${ASSESSMENT_BRANCH:-pipe-assessment}"');

    expect(safeDirectoryIndex).toBeGreaterThan(-1);
    expect(commitCheckIndex).toBeGreaterThan(-1);
    expect(checkoutIndex).toBeGreaterThan(-1);
    expect(safeDirectoryIndex).toBeLessThan(commitCheckIndex);
    expect(safeDirectoryIndex).toBeLessThan(checkoutIndex);
  });

  it('prints repo and base commit when exact commit validation fails', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'infra/containers/code-server/entrypoint.sh'),
      'utf8',
    );

    expect(script).toContain(
      'base commit not found for repo ${REPO_GIT_URL:-unknown}: ${CHALLENGE_BASE_COMMIT_SHA}',
    );
  });

  it('starts the workspace bridge whenever the image contains agent-bridge.js', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'infra/containers/code-server/entrypoint.sh'),
      'utf8',
    );

    expect(script).toContain('if [[ -f /usr/local/bin/agent-bridge.js ]]; then');
    expect(script).toContain('Starting workspace bridge/router on 0.0.0.0:${AGENT_BRIDGE_PORT}');
    expect(script).not.toContain('[[ -n "${AGENT_TYPE:-}" && "${AGENT_TYPE}" != "none"');
  });
});
