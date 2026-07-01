import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);

function matchingReadinessStep(contents: string): string {
  const start = contents.indexOf('      - name: Matching evaluation readiness report');
  const end = contents.indexOf('      - name: Upload matching evaluation readiness report');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return contents.slice(start, end);
}

describe('CI matching evaluation readiness gate', () => {
  it('fails CI when the configured production matching readiness gate fails', () => {
    const step = matchingReadinessStep(workflow);

    expect(step).not.toContain('continue-on-error');
    expect(step).toContain('npm run matching-eval:readiness');
  });

  it('blocks push-to-main when the production matching readiness gate is not configured', () => {
    const step = matchingReadinessStep(workflow);

    expect(step).toContain('exit 0');
    expect(step).toContain('"status": "not_configured"');
    expect(step).toContain('"$GITHUB_EVENT_NAME" = "push"');
    expect(step).toContain('"$GITHUB_REF" = "refs/heads/main"');
    expect(step).toContain('Production matching evaluation readiness is required for pushes to main.');
    expect(step).toContain('exit 1');
  });
});
