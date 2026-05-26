import { describe, it, expect } from 'vitest';
import {
  getProbe,
  getProbeCount,
  getProbeById,
  getProbeIds,
  buildProbePlan,
  buildProbeInstruction,
  buildRemainingProbeSummary,
} from '../probeLibrarian';
import type { ParticipantRole } from '../../../../types';

describe('probeLibrarian', () => {
  describe('getProbe', () => {
    it('returns probe 1 (code review)', () => {
      const probe = getProbe(1);
      expect(probe).toBeDefined();
      expect(probe!.id).toBe('probe_1_code_review');
      expect(probe!.targetDomains).toContain('team');
      expect(probe!.targetDomains).toContain('codebase');
    });

    it('returns probe 7 (personality: thrives/struggles)', () => {
      const probe = getProbe(7);
      expect(probe).toBeDefined();
      expect(probe!.id).toBe('probe_7_thrives_struggles');
      expect(probe!.isPersonalityProbe).toBe(true);
    });

    it('returns probe 8 (personality: new joiner)', () => {
      const probe = getProbe(8);
      expect(probe).toBeDefined();
      expect(probe!.id).toBe('probe_8_new_joiner_observation');
      expect(probe!.isPersonalityProbe).toBe(true);
    });

    it('returns undefined for probe 9 (past end)', () => {
      expect(getProbe(9)).toBeUndefined();
    });

    it('returns undefined for probe 0', () => {
      expect(getProbe(0)).toBeUndefined();
    });
  });

  describe('getProbeCount', () => {
    it('returns 8', () => {
      expect(getProbeCount()).toBe(8);
    });
  });

  describe('getProbeById', () => {
    it('finds probe by id', () => {
      expect(getProbeById('probe_1_code_review')?.id).toBe('probe_1_code_review');
      expect(getProbeById('probe_6_last_shipment')?.id).toBe('probe_6_last_shipment');
    });

    it('returns undefined for unknown id', () => {
      expect(getProbeById('probe_99_fake')).toBeUndefined();
    });
  });

  describe('getProbeIds', () => {
    it('returns all 8 ids in order', () => {
      const ids = getProbeIds();
      expect(ids).toHaveLength(8);
      expect(ids[0]).toBe('probe_1_code_review');
      expect(ids[7]).toBe('probe_8_new_joiner_observation');
    });
  });

  describe('buildProbePlan', () => {
    it('returns adapted text for HIRING_MANAGER', () => {
      const plan = buildProbePlan(0, 'HIRING_MANAGER');
      expect(plan).toBeDefined();
      expect(plan!.probe.id).toBe('probe_1_code_review');
      expect(plan!.adaptedText).toContain('your team');
      expect(plan!.primaryDomain).toBe('team');
    });

    it('returns adapted text for TEAM_MEMBER', () => {
      const plan = buildProbePlan(0, 'TEAM_MEMBER');
      expect(plan).toBeDefined();
      expect(plan!.adaptedText).toContain('you were in');
    });

    it('returns base text when role has no variant', () => {
      const plan = buildProbePlan(0, null);
      expect(plan).toBeDefined();
      expect(plan!.adaptedText).toBe(plan!.probe.text);
    });

    it('returns undefined when all probes delivered', () => {
      expect(buildProbePlan(8, 'HIRING_MANAGER')).toBeUndefined();
    });

    it('tracks probe progression', () => {
      for (let i = 0; i < 8; i++) {
        const plan = buildProbePlan(i, 'HIRING_MANAGER');
        expect(plan).toBeDefined();
        expect(plan!.probe.id).toBe(getProbe(i + 1)!.id);
      }
    });
  });

  describe('buildProbeInstruction', () => {
    it('builds instruction for probe 1', () => {
      const instruction = buildProbeInstruction(0, 'HIRING_MANAGER');
      expect(instruction).toContain('Next Probe (1 of 8)');
      expect(instruction).toContain('code review');
      expect(instruction).toContain('Target: team');
      expect(instruction).toContain('Ladder target:');
    });

    it('returns empty string when all probes delivered', () => {
      expect(buildProbeInstruction(8, 'HIRING_MANAGER')).toBe('');
    });

    it('includes drilling hints', () => {
      const instruction = buildProbeInstruction(0, 'HIRING_MANAGER');
      expect(instruction).toContain('follow up with ONE of');
    });
  });

  describe('buildRemainingProbeSummary', () => {
    it('lists remaining probes', () => {
      const summary = buildRemainingProbeSummary(5);
      expect(summary).toContain('probe_6_last_shipment');
      expect(summary).toContain('probe_7_thrives_struggles');
      expect(summary).toContain('probe_8_new_joiner_observation');
    });

    it('returns "All probes delivered" when complete', () => {
      expect(buildRemainingProbeSummary(8)).toBe('All signal probes delivered.');
    });
  });
});
