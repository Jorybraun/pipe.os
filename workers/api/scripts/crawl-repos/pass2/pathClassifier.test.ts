import { describe, it, expect } from 'vitest';
import { classifyPath, aggregatePathStats } from './pathClassifier';

describe('classifyPath', () => {
  it('classifies service paths as domain_logic', () => {
    expect(classifyPath('src/services/order.ts')).toBe('domain_logic');
    expect(classifyPath('api/handlers/checkout.go')).toBe('domain_logic');
    expect(classifyPath('internal/auth/session.go')).toBe('domain_logic');
  });

  it('classifies UI paths as ui', () => {
    expect(classifyPath('src/components/Button.tsx')).toBe('ui');
    expect(classifyPath('app/dashboard/page.tsx')).toBe('ui');
  });

  it('classifies build/config files as build_config', () => {
    expect(classifyPath('Makefile')).toBe('build_config');
    expect(classifyPath('Dockerfile')).toBe('build_config');
    expect(classifyPath('package.json')).toBe('build_config');
    expect(classifyPath('.github/workflows/ci.yaml')).toBe('build_config');
  });

  it('classifies test files as test — even when under src/services', () => {
    expect(classifyPath('src/services/order.test.ts')).toBe('test');
    expect(classifyPath('__tests__/billing.ts')).toBe('test');
    expect(classifyPath('internal/payments/payment_test.go')).toBe('test');
  });

  it('classifies docs as docs', () => {
    expect(classifyPath('docs/architecture.md')).toBe('docs');
    expect(classifyPath('README.md')).toBe('docs');
    expect(classifyPath('NOTES.md')).toBe('docs');
  });

  it('defaults unknown source paths to domain_logic (conservative)', () => {
    expect(classifyPath('weird/path/no-convention.rs')).toBe('domain_logic');
  });
});

describe('aggregatePathStats', () => {
  it('returns null ratios for empty sample (avoid 0/0)', () => {
    const r = aggregatePathStats([], 'typescript');
    expect(r.business_logic_ratio).toBeNull();
    expect(r.cross_module_change_rate).toBeNull();
  });

  it('computes ratios from mixed sample', () => {
    const prs = [
      ['src/services/order.ts', 'tests/order.test.ts'],
      ['src/components/Button.tsx'],
      ['src/services/a.ts', 'api/b.ts'],
      ['CLAUDE.md'],
    ];
    const r = aggregatePathStats(prs, 'typescript');
    expect(r.business_logic_ratio).toBeCloseTo(0.5, 3);
    expect(r.cross_module_change_rate).toBeCloseTo(0.5, 3);
  });
});
