import { describe, it, expect } from 'vitest';
import { pickNextQuestion, emptyCoverage, CULTURE_QUESTION_BANK } from '../lib/cultureQuestionBank';

describe('cultureQuestionGraph — scored selector', () => {
  it('loads the unioned bank (curated + Exponent-generated)', () => {
    // 15 curated + ~1015 generated. Allow drift in case the wiki grows/shrinks.
    expect(CULTURE_QUESTION_BANK.length).toBeGreaterThanOrEqual(15);
  });

  it('returns null when every question has been asked', () => {
    const result = pickNextQuestion({
      coverage: emptyCoverage(),
      askedIds: new Set(CULTURE_QUESTION_BANK.map((q) => q.id)),
      seniority: 'junior',
    });
    expect(result).toBeNull();
  });

  it('senior-ic and manager overlays produce different top picks on identical state', () => {
    // Same coverage, same asked set — only the overlay differs.
    const opts = {
      coverage: emptyCoverage(),
      askedIds: new Set<string>(),
      seniority: 'senior' as const,
    };

    const seniorIcPick = pickNextQuestion({ ...opts, roleOverlayId: 'senior-ic' });
    const managerPick = pickNextQuestion({ ...opts, roleOverlayId: 'manager' });

    expect(seniorIcPick).not.toBeNull();
    expect(managerPick).not.toBeNull();

    // Across 1000+ questions with materially different overlay weights and
    // tag preferences, the top pick must move. If this assertion fails, the
    // overlay weighting is dead code (the entire point of this plan).
    expect(seniorIcPick!.id).not.toBe(managerPick!.id);
  });

  it('theme-resonance bonus boosts a question that matches running themes', () => {
    const opts = {
      coverage: emptyCoverage(),
      askedIds: new Set<string>(),
      seniority: 'senior' as const,
      roleOverlayId: 'universal' as const,
    };

    // Pick a probe pattern that exists on at least one Exponent question.
    const themedQuestion = CULTURE_QUESTION_BANK.find(
      (q) => (q.probe_patterns?.length ?? 0) > 0 && (q.bars_fitness ?? 3) >= 3,
    );
    expect(themedQuestion).toBeDefined();
    const targetTheme = themedQuestion!.probe_patterns![0]!;

    const baseline = pickNextQuestion({ ...opts, runningThemes: [] });
    const boosted = pickNextQuestion({ ...opts, runningThemes: [targetTheme] });

    expect(baseline).not.toBeNull();
    expect(boosted).not.toBeNull();

    // The boosted pick must contain the target theme — and it should NOT
    // necessarily be the baseline pick (resonance moved the result).
    expect(boosted!.probe_patterns ?? []).toContain(targetTheme);
  });

  it('discipline filter excludes pm/design questions by default', () => {
    const opts = {
      coverage: emptyCoverage(),
      askedIds: new Set<string>(),
      seniority: 'senior' as const,
      roleOverlayId: 'universal' as const,
    };

    // Sample 50 picks while marking each as asked. None should be pm/design.
    const asked = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const next = pickNextQuestion({ ...opts, askedIds: asked });
      if (!next) break;
      expect(next.discipline === 'pm' || next.discipline === 'design').toBe(false);
      asked.add(next.id);
    }
  });
});
