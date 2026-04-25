import { describe, it, expect } from 'vitest';
import { normalizeSeniority } from '../lib/cultureSeniorityNormalize';

describe('normalizeSeniority', () => {
  it.each([
    ['Junior frontend engineer', 'junior'],
    ['New grad software engineer', 'junior'],
    ['SWE I', 'junior'],
    ['Mid-level backend engineer, 3 years', 'mid'],
    ['SWE II, intermediate Go developer', 'mid'],
    ['Senior software engineer, 5–8 years', 'senior'],
    ['Sr. SWE focused on infra', 'senior'],
    ['Tech lead for the platform team', 'lead'],
    ['Staff engineer, distributed systems', 'staff'],
    ['Staff+ engineer with 10 years', 'staff'],
    ['Principal engineer, ML platforms', 'staff'],
    ['Engineering Manager, first-line', 'manager'],
    ['Director of Engineering', 'manager'],
    ['Head of Platform', 'manager'],
    ['VP of Engineering', 'manager'],
  ])('"%s" → %s', (input, expected) => {
    expect(normalizeSeniority(input)).toBe(expected);
  });

  it('defaults to mid on empty/null input', () => {
    expect(normalizeSeniority('')).toBe('mid');
    expect(normalizeSeniority(null)).toBe('mid');
    expect(normalizeSeniority(undefined)).toBe('mid');
  });

  it('defaults to mid when no pattern matches', () => {
    expect(normalizeSeniority('AI whisperer')).toBe('mid');
  });

  it('manager pattern beats senior when both present', () => {
    // "Senior Engineering Manager" should bucket as manager, not senior.
    expect(normalizeSeniority('Senior Engineering Manager')).toBe('manager');
  });
});
