/**
 * Staged rollout configuration tests — acceptance criterion #8
 *
 * Proves:
 * - All rollout gates have valid prerequisite chains (no orphans)
 * - No disabled prerequisite blocks an enabled gate
 * - GA gates have no disabled prerequisites
 * - Gate lookup and stage filtering work correctly
 * - Rollout configuration is internally consistent
 */
import { describe, expect, it } from 'vitest';
import {
  getAllGates,
  getGatesByStage,
  getRolloutGate,
  isGateEnabled,
  isGateGA,
  validateGatePrerequisites,
} from '../rollout';

describe('staged rollout gates — criterion #8', () => {
  it('has no prerequisite validation errors', () => {
    const errors = validateGatePrerequisites();
    expect(errors).toEqual([]);
  });

  it('all gates have unique keys', () => {
    const gates = getAllGates();
    const keys = gates.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('prerequisite gates reference existing gates', () => {
    const gates = getAllGates();
    const allKeys = new Set(gates.map((g) => g.key));
    for (const gate of gates) {
      for (const prereq of gate.prerequisiteGates) {
        expect(allKeys.has(prereq)).toBe(true);
      }
    }
  });

  it('GA gates have all prerequisites enabled', () => {
    const gates = getAllGates();
    const gaGates = gates.filter((g) => g.stage === 'general_availability');
    for (const gate of gaGates) {
      for (const prereq of gate.prerequisiteGates) {
        expect(isGateEnabled(prereq)).toBe(true);
      }
    }
  });

  it('core ingestion and matching are GA', () => {
    expect(isGateGA('living_context_ingestion')).toBe(true);
    expect(isGateGA('deterministic_matching')).toBe(true);
    expect(isGateGA('repo_graph_backfill')).toBe(true);
  });

  it('newer features are canary or internal_only', () => {
    expect(isGateGA('match_explanation')).toBe(false);
    expect(isGateEnabled('match_explanation')).toBe(true);
    expect(isGateGA('repo_overlay_visualization')).toBe(false);
    expect(isGateEnabled('repo_overlay_visualization')).toBe(true);
  });

  it('getRolloutGate returns correct gate', () => {
    const gate = getRolloutGate('deterministic_matching');
    expect(gate).toBeDefined();
    expect(gate!.key).toBe('deterministic_matching');
    expect(gate!.stage).toBe('general_availability');
  });

  it('getRolloutGate returns undefined for unknown key', () => {
    expect(getRolloutGate('nonexistent')).toBeUndefined();
  });

  it('getGatesByStage filters correctly', () => {
    const gaGates = getGatesByStage('general_availability');
    expect(gaGates.length).toBeGreaterThan(0);
    for (const gate of gaGates) {
      expect(gate.stage).toBe('general_availability');
    }

    const disabledGates = getGatesByStage('disabled');
    expect(disabledGates.length).toBe(0);
  });

  it('no circular dependencies in prerequisite chains', () => {
    const gates = getAllGates();
    const gateMap = new Map(gates.map((g) => [g.key, g]));

    function hasCycle(key: string, visited: Set<string>): boolean {
      if (visited.has(key)) return true;
      visited.add(key);
      const gate = gateMap.get(key);
      if (!gate) return false;
      for (const prereq of gate.prerequisiteGates) {
        if (hasCycle(prereq, new Set(visited))) return true;
      }
      return false;
    }

    for (const gate of gates) {
      expect(hasCycle(gate.key, new Set())).toBe(false);
    }
  });
});
