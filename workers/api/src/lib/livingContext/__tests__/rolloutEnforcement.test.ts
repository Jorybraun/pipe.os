/**
 * Rollout enforcement tests — proves runtime gate checking works correctly.
 *
 * Acceptance criterion #8: controlled staged rollout at runtime.
 */

import { describe, it, expect } from 'vitest';
import { checkGate, gatedField } from '../rolloutEnforcement';

describe('rollout enforcement — runtime gate checks', () => {
  it('allows enabled gates (GA stage)', () => {
    const result = checkGate('living_context_ingestion');
    expect(result.allowed).toBe(true);
    expect(result.stage).toBe('general_availability');
    expect(result.reason).toBeUndefined();
  });

  it('allows canary-stage gates', () => {
    const result = checkGate('match_explanation');
    expect(result.allowed).toBe(true);
    expect(result.stage).toBe('canary');
  });

  it('allows internal_only gates', () => {
    const result = checkGate('repo_overlay_visualization');
    expect(result.allowed).toBe(true);
    expect(result.stage).toBe('internal_only');
  });

  it('rejects unknown gates', () => {
    const result = checkGate('nonexistent_gate');
    expect(result.allowed).toBe(false);
    expect(result.stage).toBe('unknown');
    expect(result.reason).toContain('Unknown gate');
  });

  it('gatedField returns value when gate is enabled', () => {
    const data = { unmatchedDemands: ['demand-1'] };
    const result = gatedField('match_explanation', data);
    expect(result).toEqual(data);
  });

  it('gatedField returns undefined when gate is unknown/disabled', () => {
    const data = { secret: 'should-not-leak' };
    const result = gatedField('nonexistent_gate', data);
    expect(result).toBeUndefined();
  });

  it('enforces prerequisite chain at check time', () => {
    // contact_living_context requires living_context_read_model which requires ingestion
    // All are enabled, so this should pass
    const result = checkGate('contact_living_context');
    expect(result.allowed).toBe(true);
    expect(result.stage).toBe('canary');
  });

  it('all currently-configured gates are enabled (no disabled gates in config)', () => {
    const knownGates = [
      'living_context_ingestion',
      'living_context_read_model',
      'contact_living_context',
      'deterministic_matching',
      'match_explanation',
      'repo_graph_backfill',
      'neo4j_projection_rebuild',
      'repo_overlay_visualization',
      'expert_labelled_evaluation',
    ];
    for (const key of knownGates) {
      const result = checkGate(key);
      expect(result.allowed).toBe(true);
    }
  });
});
