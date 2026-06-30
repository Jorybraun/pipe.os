import { describe, expect, it } from 'vitest';

import { sharedWindowIdsMissingFromSnapshot } from './desktopSnapshot';

describe('sharedWindowIdsMissingFromSnapshot', () => {
  it('closes shared windows that are absent from the authoritative snapshot', () => {
    expect(sharedWindowIdsMissingFromSnapshot({
      windows: [
        { id: 'video' },
        { id: 'notepad' },
        { id: 'browser' },
      ],
      snapshot: [
        { id: 'browser' },
      ],
      sharedWindowIds: new Set(['notepad', 'browser']),
    })).toEqual(['notepad']);
  });

  it('preserves local bootstrap windows that were never accepted as shared desktop state', () => {
    expect(sharedWindowIdsMissingFromSnapshot({
      windows: [
        { id: 'video' },
        { id: 'chat' },
        { id: 'workspace' },
      ],
      snapshot: [],
      sharedWindowIds: new Set(),
    })).toEqual([]);
  });
});
