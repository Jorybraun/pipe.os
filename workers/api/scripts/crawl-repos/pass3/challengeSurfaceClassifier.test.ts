import { describe, it, expect } from 'vitest';
import { classifyChallengeSurfaces } from './challengeSurfaceClassifier';

const stackWith = (pkgs: string[]): string => JSON.stringify(pkgs);

describe('classifyChallengeSurfaces', () => {
  it('raw-SQL Python API scores sql_injection_potential >= 0.7', () => {
    const out = classifyChallengeSurfaces({
      detected_stack_json: stackWith(['fastapi', 'psycopg2']),
      primary_language: 'python',
      constructs: [],
      detected_domain: 'web-backend',
    });
    expect(out.sql_injection_potential).toBeGreaterThanOrEqual(0.7);
  });

  it('ORM-only project scores sql_injection_potential <= 0.1', () => {
    const out = classifyChallengeSurfaces({
      detected_stack_json: stackWith(['express', 'prisma']),
      primary_language: 'typescript',
      constructs: [],
      detected_domain: 'web-backend',
    });
    expect(out.sql_injection_potential).toBeLessThanOrEqual(0.1);
    expect(out.n_plus_one_potential).toBeGreaterThanOrEqual(0.5);
  });

  it('Rust project scores missing_null_check_potential <= 0.2', () => {
    const out = classifyChallengeSurfaces({
      detected_stack_json: stackWith(['axum', 'tokio']),
      primary_language: 'rust',
      constructs: [],
      detected_domain: 'web-backend',
    });
    expect(out.missing_null_check_potential).toBeLessThanOrEqual(0.2);
    expect(out.dangling_reference_potential).toBeLessThanOrEqual(0.3);
  });

  it('HTTP framework without validator → unvalidated_input_potential 0.7', () => {
    const out = classifyChallengeSurfaces({
      detected_stack_json: stackWith(['express']),
      primary_language: 'javascript',
      constructs: [],
      detected_domain: 'web-backend',
    });
    expect(out.unvalidated_input_potential).toBeCloseTo(0.7, 2);
    expect(out.cors_misconfig_potential).toBeCloseTo(0.6, 2);
  });

  it('always emits all 10 surface keys in [0, 1]', () => {
    const out = classifyChallengeSurfaces({
      detected_stack_json: null,
      primary_language: 'go',
      constructs: [],
      detected_domain: null,
    });
    const keys = [
      'off_by_one_potential',
      'toctou_race_potential',
      'stale_cache_potential',
      'unvalidated_input_potential',
      'type_confusion_potential',
      'dangling_reference_potential',
      'sql_injection_potential',
      'cors_misconfig_potential',
      'n_plus_one_potential',
      'missing_null_check_potential',
    ] as const;
    for (const k of keys) {
      expect(out[k]).toBeGreaterThanOrEqual(0);
      expect(out[k]).toBeLessThanOrEqual(1);
    }
  });
});
