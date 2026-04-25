import { describe, it, expect } from 'vitest';
import { classifyTestStyle } from './testStyleClassifier';

const stackWith = (pkgs: string[]): string => JSON.stringify({ packages: pkgs });

describe('classifyTestStyle', () => {
  it('returns e2e_present when playwright is in stack', () => {
    expect(
      classifyTestStyle({
        test_touch_rate: 0.1,
        detected_stack_json: stackWith(['react', 'playwright']),
      }),
    ).toBe('e2e_present');
  });

  it('returns e2e_present for cypress, selenium, puppeteer, webdriverio', () => {
    for (const lib of ['cypress', 'selenium', 'puppeteer', 'webdriverio']) {
      expect(
        classifyTestStyle({
          test_touch_rate: 0.0,
          detected_stack_json: stackWith([lib]),
        }),
      ).toBe('e2e_present');
    }
  });

  it('returns integration_heavy when touch_rate ≥ 0.5 AND integration lib present', () => {
    expect(
      classifyTestStyle({
        test_touch_rate: 0.6,
        detected_stack_json: stackWith(['express', 'supertest']),
      }),
    ).toBe('integration_heavy');
  });

  it('returns unit_only when touch_rate ≥ 0.3 without integration libs', () => {
    expect(
      classifyTestStyle({
        test_touch_rate: 0.35,
        detected_stack_json: stackWith(['express', 'jest']),
      }),
    ).toBe('unit_only');
  });

  it('returns minimal when touch_rate in [0.05, 0.3)', () => {
    expect(
      classifyTestStyle({
        test_touch_rate: 0.1,
        detected_stack_json: stackWith(['express']),
      }),
    ).toBe('minimal');
  });

  it('returns unknown when touch_rate < 0.05 or null', () => {
    expect(
      classifyTestStyle({
        test_touch_rate: 0.01,
        detected_stack_json: stackWith(['express']),
      }),
    ).toBe('unknown');
    expect(
      classifyTestStyle({
        test_touch_rate: null,
        detected_stack_json: stackWith(['express']),
      }),
    ).toBe('unknown');
  });
});
