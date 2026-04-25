import { describe, it, expect } from 'vitest';
import { computeEffectiveTtl, MIN_TTL_SECONDS } from '../lib/devContainerTtl';

describe('computeEffectiveTtl', () => {
  const globalDefault = 3600;
  const hardCap = 7200;

  it('returns GLOBAL when neither challenge nor override is set', () => {
    const result = computeEffectiveTtl({
      globalDefault,
      challengeTtl: null,
      override: null,
      hardCap,
    });
    expect(result).toEqual({ ttlSeconds: 3600, source: 'GLOBAL' });
  });

  it('prefers per-CHALLENGE value over global default', () => {
    const result = computeEffectiveTtl({
      globalDefault,
      challengeTtl: 1800,
      override: null,
      hardCap,
    });
    expect(result).toEqual({ ttlSeconds: 1800, source: 'CHALLENGE' });
  });

  it('prefers per-launch OVERRIDE over both challenge and global', () => {
    const result = computeEffectiveTtl({
      globalDefault,
      challengeTtl: 1800,
      override: 900,
      hardCap,
    });
    expect(result).toEqual({ ttlSeconds: 900, source: 'OVERRIDE' });
  });

  it('clamps a challenge value above the hard cap down to the cap', () => {
    const result = computeEffectiveTtl({
      globalDefault,
      challengeTtl: 99999,
      override: null,
      hardCap,
    });
    expect(result).toEqual({ ttlSeconds: 7200, source: 'CHALLENGE' });
  });

  it('clamps an override value above the hard cap down to the cap', () => {
    const result = computeEffectiveTtl({
      globalDefault,
      challengeTtl: null,
      override: 99999,
      hardCap,
    });
    expect(result).toEqual({ ttlSeconds: 7200, source: 'OVERRIDE' });
  });

  it('throws when override is below the minimum TTL floor', () => {
    expect(() =>
      computeEffectiveTtl({
        globalDefault,
        challengeTtl: null,
        override: 5,
        hardCap,
      }),
    ).toThrow(/>= 30s/);
  });

  it('ignores a zero / negative challenge value and falls back to global', () => {
    const result = computeEffectiveTtl({
      globalDefault,
      challengeTtl: 0,
      override: null,
      hardCap,
    });
    expect(result).toEqual({ ttlSeconds: 3600, source: 'GLOBAL' });
  });

  it('throws when global default is not positive', () => {
    expect(() =>
      computeEffectiveTtl({
        globalDefault: 0,
        challengeTtl: null,
        override: null,
        hardCap,
      }),
    ).toThrow(/positive number/);
  });

  it('throws when hard cap is below the minimum', () => {
    expect(() =>
      computeEffectiveTtl({
        globalDefault,
        challengeTtl: null,
        override: null,
        hardCap: 10,
      }),
    ).toThrow(/hardCap must be >=/);
  });

  it('exports MIN_TTL_SECONDS as 30', () => {
    expect(MIN_TTL_SECONDS).toBe(30);
  });
});
