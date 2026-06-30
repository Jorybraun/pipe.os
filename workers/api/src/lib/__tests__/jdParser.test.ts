import { describe, expect, it } from 'vitest';

import { parseJobDescription } from '../jdParser';

describe('parseJobDescription', () => {
  it('uses source-text-only parsing when MOCK_AI is enabled instead of returning a synthetic role', async () => {
    const text = [
      '# Frontend Accessibility Engineer',
      'Location: Hybrid - Vancouver',
      'Department: Product Design',
      'Team size: 3 engineers',
      'Reports to: Head of Product',
      '',
      'We need WCAG remediation experience and design-system maintenance.',
    ].join('\n');

    const parsed = await parseJobDescription({
      text,
      env: { MOCK_AI: 'true' },
    });

    expect(parsed).toEqual({
      title: 'Frontend Accessibility Engineer',
      department: 'Product Design',
      workModel: 'Hybrid',
      location: 'Hybrid - Vancouver',
      teamSize: '3 engineers',
      reportsTo: 'Head of Product',
    });

    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('Senior Backend Engineer');
    expect(serialized).not.toContain('TypeScript');
    expect(serialized).not.toContain('Kafka');
    expect(parsed?.stack).toBeUndefined();
  });

  it('falls back to source text when the real provider is unavailable or fails', async () => {
    const ai = {
      run: async () => {
        throw new Error('5028: This model was deprecated on 2026-05-30. Please use an alternative model.');
      },
    } as unknown as Ai;

    const parsed = await parseJobDescription({
      text: [
        '# Staff Platform Engineer',
        'Location: Remote',
        '',
        'The role owns reliability work for the build pipeline.',
      ].join('\n'),
      env: { AI: ai },
    });

    expect(parsed).toEqual({
      title: 'Staff Platform Engineer',
      level: 'Staff',
      workModel: 'Remote',
      location: 'Remote',
    });
    expect(parsed?.stack).toBeUndefined();
  });

  it('rejects insufficient source text instead of inventing a baseline', async () => {
    await expect(parseJobDescription({ text: 'short', env: { MOCK_AI: 'true' } })).resolves.toBeNull();
  });
});
