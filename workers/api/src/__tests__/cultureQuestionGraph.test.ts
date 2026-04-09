import { describe, it, expect } from 'vitest';
import { pickNextQuestion, emptyCoverage, CULTURE_QUESTION_BANK } from '../lib/cultureQuestionBank';

describe('cultureQuestionGraph — scored selector', () => {
  it('loads the 15 hand-authored questions', () => {
    expect(CULTURE_QUESTION_BANK.length).toBe(15);
  });

  it('returns null when every question has been asked', () => {
    const result = pickNextQuestion({
      coverage: emptyCoverage(),
      askedIds: new Set(CULTURE_QUESTION_BANK.map((q) => q.id)),
      seniority: 'senior',
    });
    expect(result).toBeNull();
  });

  it('iterates the full curated bank without repeating when asked set grows', () => {
    // Sanity: the selector exhausts all eligible questions before returning null.
    const opts = {
      coverage: emptyCoverage(),
      roleOverlayId: 'universal' as const,
      seniority: 'senior' as const,
    };
    const asked = new Set<string>();
    const picked: string[] = [];
    while (true) {
      const next = pickNextQuestion({ ...opts, askedIds: asked });
      if (!next) break;
      expect(asked.has(next.id)).toBe(false);
      asked.add(next.id);
      picked.push(next.id);
    }
    expect(picked.length).toBeGreaterThan(0);
  });

  it('discipline filter does not crash on curated questions (none tag pm/design)', () => {
    const opts = {
      coverage: emptyCoverage(),
      askedIds: new Set<string>(),
      seniority: 'senior' as const,
      roleOverlayId: 'universal' as const,
    };
    const asked = new Set<string>();
    for (let i = 0; i < CULTURE_QUESTION_BANK.length; i++) {
      const next = pickNextQuestion({ ...opts, askedIds: asked });
      if (!next) break;
      expect(next.discipline === 'pm' || next.discipline === 'design').toBe(false);
      asked.add(next.id);
    }
  });
});
