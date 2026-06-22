import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { requireGate, isFeatureEnabled } from '../rolloutGate';

describe('rolloutGate middleware', () => {
  it('allows request when gate is enabled', async () => {
    const app = new Hono();
    app.get('/test', requireGate('living_context_ingestion'), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 404 when gate is disabled', async () => {
    const app = new Hono();
    // 'nonexistent_gate' doesn't exist → isGateEnabled returns false
    app.get('/test', requireGate('nonexistent_gate'), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string; message: string };
    expect(body.error).toBe('NOT_FOUND');
    expect(body.message).toContain('not currently available');
  });

  it('allows canary gates (canary is enabled)', async () => {
    const app = new Hono();
    // contact_living_context is set to 'canary' stage → enabled
    app.get('/test', requireGate('contact_living_context'), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('allows internal_only gates (internal_only is enabled)', async () => {
    const app = new Hono();
    // repo_overlay_visualization is 'internal_only' → enabled
    app.get('/test', requireGate('repo_overlay_visualization'), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('chains with other middleware', async () => {
    const app = new Hono();
    const order: string[] = [];

    const firstMiddleware = async (_c: unknown, next: () => Promise<void>): Promise<void> => {
      order.push('first');
      await next();
    };

    app.get('/test', firstMiddleware, requireGate('deterministic_matching'), (c) => {
      order.push('handler');
      return c.json({ ok: true });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(order).toEqual(['first', 'handler']);
  });
});

describe('isFeatureEnabled', () => {
  it('returns true for GA gates', () => {
    expect(isFeatureEnabled('living_context_ingestion')).toBe(true);
    expect(isFeatureEnabled('deterministic_matching')).toBe(true);
    expect(isFeatureEnabled('repo_graph_backfill')).toBe(true);
  });

  it('returns true for canary gates', () => {
    expect(isFeatureEnabled('contact_living_context')).toBe(true);
    expect(isFeatureEnabled('match_explanation')).toBe(true);
  });

  it('returns true for internal_only gates', () => {
    expect(isFeatureEnabled('repo_overlay_visualization')).toBe(true);
    expect(isFeatureEnabled('expert_labelled_evaluation')).toBe(true);
  });

  it('returns false for unknown gates', () => {
    expect(isFeatureEnabled('does_not_exist')).toBe(false);
  });
});
