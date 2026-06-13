import { describe, expect, it } from 'vitest';
import { resolveSkillSlug, resolveSkills } from './skillResolver';

describe('open crawler concept normalization', () => {
  it('preserves previously unseen package concepts', () => {
    expect(resolveSkillSlug('@novel/runtime-kit')).toBe('novel-runtime-kit');
  });

  it('does not encode semantic aliases in code', () => {
    expect(resolveSkillSlug('node.js')).toBe('node.js');
    expect(resolveSkillSlug('express')).toBe('express');
  });

  it('deduplicates only syntactically equivalent surfaces', () => {
    expect(resolveSkills([' Kafka ', 'kafka', 'Kafka Streams'])).toEqual([
      'kafka',
      'kafka-streams',
    ]);
  });
});
