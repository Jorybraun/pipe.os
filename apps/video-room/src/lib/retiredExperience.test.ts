import { describe, expect, it } from 'vitest';

import indexHtml from '../../index.html?raw';

const roomSourceModules = import.meta.glob('../**/*.{ts,tsx,css}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const retiredExperienceTerms = [
  ['95', ' Until ', 'Infinity'].join(''),
  ['95', ' Til ', 'Infinity'].join(''),
  ['95', ' To ', 'Infinity'].join(''),
  ['Windows', ' ', '95'].join(''),
  ['Win', '95'].join(''),
  ['Clip', 'py'].join(''),
  ['paper', 'clip'].join(''),
  ['retro', ' desktop'].join(''),
  ['desktop', ' simulation'].join(''),
  ['MS', ' Paint'].join(''),
  ['ms', 'paint'].join(''),
  ['Microsoft', ' Edge'].join(''),
  ['start', ' menu'].join(''),
  ['task', 'bar'].join(''),
];

describe('retired assessment-room experience', () => {
  it('does not ship retired novelty-room branding or affordances', () => {
    const scannedFiles = {
      'index.html': indexHtml,
      ...Object.fromEntries(
        Object.entries(roomSourceModules).filter(([filePath]) => (
          !filePath.endsWith('retiredExperience.test.ts')
        )),
      ),
    };

    const violations = Object.entries(scannedFiles).flatMap(([filePath, source]) => (
      retiredExperienceTerms
        .filter((term) => source.toLowerCase().includes(term.toLowerCase()))
        .map((term) => `${filePath}: ${term}`)
    ));

    expect(violations).toEqual([]);
  });
});
