import { describe, it, expect } from 'vitest';
import { loadRoleOverlay, ROLE_OVERLAYS } from '../lib/cultureRoleOverlay';

describe('cultureRoleOverlay', () => {
  it('senior-ic weights ownership and learning-orientation above 1.0', () => {
    const overlay = loadRoleOverlay('senior-ic');
    expect(overlay.weights.ownership).toBeGreaterThan(1.0);
    expect(overlay.weights['learning-orientation']).toBeGreaterThan(1.0);
    expect(overlay.preferredTags).toContain('mentorship-without-authority');
    expect(overlay.deprioritizedTags).toContain('direct-reports');
  });

  it('manager weights conflict-handling and self-awareness highest', () => {
    const overlay = loadRoleOverlay('manager');
    expect(overlay.weights['conflict-handling']).toBeGreaterThanOrEqual(1.4);
    expect(overlay.weights['self-awareness']).toBeGreaterThanOrEqual(1.3);
    expect(overlay.preferredTags).toContain('direct-reports');
  });

  it('universal overlay is the no-op fallback', () => {
    const overlay = loadRoleOverlay('universal');
    for (const dim of Object.values(overlay.weights)) {
      expect(dim).toBe(1.0);
    }
    expect(overlay.preferredTags).toEqual([]);
    expect(overlay.deprioritizedTags).toEqual([]);
  });

  it('null/undefined falls back to universal', () => {
    expect(loadRoleOverlay(null)).toBe(ROLE_OVERLAYS.universal);
    expect(loadRoleOverlay(undefined)).toBe(ROLE_OVERLAYS.universal);
  });
});
