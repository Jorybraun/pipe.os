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
    expect(step).toContain('MATCHING_EVALUATION_D1_DATABASE_ID');
    expect(step).toContain('MATCHING_EVALUATION_REQUIRED');
    expect(step).toContain('EVAL_STAGE="${MATCHING_EVALUATION_STAGE:-production}"');
    expect(step).toContain('export CLOUDFLARE_D1_DATABASE_ID="$MATCHING_EVALUATION_D1_DATABASE_ID"');
    expect(step).toContain('--stage "$EVAL_STAGE"');
  });

  it('requires production readiness configuration for main pushes by default', () => {
    const step = matchingReadinessStep(workflow);

    expect(step).toContain('GITHUB_EVENT_NAME:-}" = "push"');
    expect(step).toContain('GITHUB_REF:-}" = "refs/heads/main"');
    expect(step).toContain('REQUIRE_MATCHING_EVALUATION=1');
    expect(step).toContain('Production matching evaluation readiness is required for pushes to main.');
    expect(step).toContain('exit 1');
  });

  it('emits a non-blocking artifact when the production matching readiness gate is not enforced', () => {
    const step = matchingReadinessStep(workflow);

    expect(step).toContain('exit 0');
    expect(step).toContain('"status": "not_configured"');
    expect(step).toContain(
      'Production matching evaluation readiness is not configured; uploaded non-blocking readiness report.',
    );
    expect(step).toContain(
      'CLOUDFLARE_D1_DATABASE_ID or MATCHING_EVALUATION_D1_DATABASE_ID',
    );
  });
});
