import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPromptPatches,
  setPromptPatches,
  clearPromptPatches,
  addPromptPatch,
  selectPatches,
  buildNegativeExamplesBlock,
  injectPromptPatches,
} from '../promptPatch';
import type { PromptPatch } from '../types';

describe('promptPatch', () => {
  beforeEach(() => {
    clearPromptPatches();
  });

  describe('selectPatches', () => {
    it('returns empty array when no patches match', () => {
      const patches = selectPatches({ participantRole: 'TEAM_MEMBER' });
      expect(patches).toHaveLength(0);
    });

    it('filters by participantRole', () => {
      setPromptPatches([
        {
          id: 'p1',
          ruleId: 'r1',
          participantRoles: ['TEAM_MEMBER'],
          negativeExample: 'Bad Q1',
          correctedExample: 'Good Q1',
          reason: 'Role confusion',
          flagCount: 5,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'p2',
          ruleId: 'r2',
          participantRoles: ['HIRING_MANAGER'],
          negativeExample: 'Bad Q2',
          correctedExample: 'Good Q2',
          reason: 'Too vague',
          flagCount: 5,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
      const patches = selectPatches({ participantRole: 'TEAM_MEMBER' });
      expect(patches).toHaveLength(1);
      expect(patches[0]!.id).toBe('p1');
    });

    it('filters by minFlagCount', () => {
      setPromptPatches([
        {
          id: 'p1',
          ruleId: 'r1',
          negativeExample: 'Bad Q1',
          correctedExample: 'Good Q1',
          reason: 'Role confusion',
          flagCount: 5,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'p2',
          ruleId: 'r2',
          negativeExample: 'Bad Q2',
          correctedExample: 'Good Q2',
          reason: 'Minor issue',
          flagCount: 1,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
      const patches = selectPatches({ minFlagCount: 3 });
      expect(patches).toHaveLength(1);
      expect(patches[0]!.id).toBe('p1');
    });

    it('sorts by flagCount descending', () => {
      setPromptPatches([
        {
          id: 'p1',
          ruleId: 'r1',
          negativeExample: 'Bad Q1',
          correctedExample: 'Good Q1',
          reason: 'Role confusion',
          flagCount: 3,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'p2',
          ruleId: 'r2',
          negativeExample: 'Bad Q2',
          correctedExample: 'Good Q2',
          reason: 'Too vague',
          flagCount: 10,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
      const patches = selectPatches();
      expect(patches[0]!.id).toBe('p2');
      expect(patches[1]!.id).toBe('p1');
    });
  });

  describe('buildNegativeExamplesBlock', () => {
    it('returns empty string for empty patches', () => {
      expect(buildNegativeExamplesBlock([])).toBe('');
    });

    it('builds a markdown block', () => {
      const block = buildNegativeExamplesBlock([
        {
          id: 'p1',
          ruleId: 'r1',
          negativeExample: 'Bad Q',
          correctedExample: 'Good Q',
          reason: 'Role confusion',
          flagCount: 5,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
      expect(block).toContain('## Negative Examples');
      expect(block).toContain('Bad Q');
      expect(block).toContain('Good Q');
      expect(block).toContain('Role confusion');
      expect(block).toContain('flagged 5×');
    });
  });

  describe('injectPromptPatches', () => {
    it('returns prompt unchanged when no patches match', () => {
      const prompt = '## Some Prompt\nDo good things.';
      expect(injectPromptPatches(prompt)).toBe(prompt);
    });

    it('injects patches before ## Negative Examples', () => {
      setPromptPatches([
        {
          id: 'p1',
          ruleId: 'r1',
          negativeExample: 'Bad Q',
          correctedExample: 'Good Q',
          reason: 'Role confusion',
          flagCount: 5,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
      const prompt = '## Some Prompt\n## Negative Examples\nExisting examples.\n## Response Format';
      const result = injectPromptPatches(prompt);
      expect(result).toContain('## Negative Examples — Do NOT generate questions like these');
      expect(result.indexOf('Do NOT generate')).toBeLessThan(result.indexOf('Existing examples'));
    });

    it('appends to end when no marker found', () => {
      setPromptPatches([
        {
          id: 'p1',
          ruleId: 'r1',
          negativeExample: 'Bad Q',
          correctedExample: 'Good Q',
          reason: 'Role confusion',
          flagCount: 5,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
      const prompt = 'Simple prompt without sections.';
      const result = injectPromptPatches(prompt);
      expect(result).toContain('## Negative Examples');
      expect(result).toContain('Bad Q');
    });
  });

  describe('store mutations', () => {
    it('adds and retrieves patches', () => {
      const patch: PromptPatch = {
        id: 'test-1',
        ruleId: 'role_confusion',
        negativeExample: 'Bad',
        correctedExample: 'Good',
        reason: 'Test',
        flagCount: 3,
        createdAt: '2026-01-01T00:00:00Z',
      };
      addPromptPatch(patch);
      expect(getPromptPatches()).toHaveLength(1);
      expect(getPromptPatches()[0]!.id).toBe('test-1');
    });

    it('clears patches', () => {
      addPromptPatch({
        id: 'test-1',
        ruleId: 'role_confusion',
        negativeExample: 'Bad',
        correctedExample: 'Good',
        reason: 'Test',
        flagCount: 3,
        createdAt: '2026-01-01T00:00:00Z',
      });
      clearPromptPatches();
      expect(getPromptPatches()).toHaveLength(0);
    });
  });
});
