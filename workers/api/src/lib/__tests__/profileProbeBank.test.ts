import { describe, it, expect } from 'vitest';
import {
  PROFILE_PROBE_BANK,
  PROFILE_PROBE_DIMENSIONS,
  PROFILE_PROBE_BANK_SIZE,
  emptyProfileCoverage,
  pickNextProfileProbe,
  getProfileProbeById,
} from '../profileProbeBank';

describe('profileProbeBank', () => {
  describe('seed bank', () => {
    it('has 18 probes (3 per dimension)', () => {
      expect(PROFILE_PROBE_BANK.length).toBe(18);
      expect(PROFILE_PROBE_BANK_SIZE).toBe(18);
    });

    it('has exactly 3 probes per dimension', () => {
      for (const dim of PROFILE_PROBE_DIMENSIONS) {
        const count = PROFILE_PROBE_BANK.filter((p) => p.dimension === dim).length;
        expect(count).toBe(3);
      }
    });

    it('has unique IDs', () => {
      const ids = PROFILE_PROBE_BANK.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every probe has text and at least one probe template', () => {
      for (const p of PROFILE_PROBE_BANK) {
        expect(p.text.length).toBeGreaterThan(0);
        expect(Object.keys(p.probes).length).toBeGreaterThan(0);
      }
    });
  });

  describe('getProfileProbeById', () => {
    it('returns the probe for a known id', () => {
      const probe = getProfileProbeById('career-history-001');
      expect(probe).not.toBeNull();
      expect(probe!.dimension).toBe('career_history');
    });

    it('returns null for an unknown id', () => {
      expect(getProfileProbeById('nope')).toBeNull();
    });
  });

  describe('emptyProfileCoverage', () => {
    it('starts all dimensions at 0', () => {
      const coverage = emptyProfileCoverage();
      for (const dim of PROFILE_PROBE_DIMENSIONS) {
        expect(coverage[dim]).toBe(0);
      }
    });
  });

  describe('pickNextProfileProbe', () => {
    it('returns the first probe when coverage is empty', () => {
      const next = pickNextProfileProbe({
        coverage: emptyProfileCoverage(),
        askedIds: new Set(),
      });
      expect(next).not.toBeNull();
    });

    it('picks an uncovered dimension first', () => {
      const coverage = { ...emptyProfileCoverage(), career_history: 2 };
      const next = pickNextProfileProbe({
        coverage,
        askedIds: new Set(),
      });
      expect(next).not.toBeNull();
      expect(next!.dimension).not.toBe('career_history');
    });

    it('returns null when all probes have been asked', () => {
      const askedIds = new Set(PROFILE_PROBE_BANK.map((p) => p.id));
      const next = pickNextProfileProbe({
        coverage: emptyProfileCoverage(),
        askedIds,
      });
      expect(next).toBeNull();
    });

    it('excludes already-asked probes', () => {
      const askedIds = new Set(['career-history-001']);
      const next = pickNextProfileProbe({
        coverage: emptyProfileCoverage(),
        askedIds,
      });
      expect(next).not.toBeNull();
      expect(next!.id).not.toBe('career-history-001');
    });
  });
});
