import { Hono } from 'hono';
import { apiError } from '../middleware/errors';
import type { Env, Variables } from '../types';

const waitlist = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /api/v1/waitlist
 *
 * Public endpoint (no auth) — accepts email signups from the marketing site.
 * Stores to D1 `waitlist` table. Upserts on email to avoid duplicates.
 */
waitlist.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Invalid JSON body.');
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return apiError(c, 'VALIDATION_ERROR', 'A valid email address is required.');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : null;
  const company = typeof body.company === 'string' ? body.company.trim() : null;
  const role = typeof body.role === 'string' ? body.role.trim() : null;
  const teamSize = typeof body.teamSize === 'string' ? body.teamSize.trim() : null;
  const painPoint = typeof body.painPoint === 'string' ? body.painPoint.trim() : null;
  const message = typeof body.message === 'string' ? body.message.trim() : null;

  try {
    await c.env.DB.prepare(
      `INSERT INTO waitlist (email, name, company, role, team_size, pain_point, message)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(email) DO UPDATE SET
         name       = COALESCE(excluded.name, waitlist.name),
         company    = COALESCE(excluded.company, waitlist.company),
         role       = COALESCE(excluded.role, waitlist.role),
         team_size  = COALESCE(excluded.team_size, waitlist.team_size),
         pain_point = COALESCE(excluded.pain_point, waitlist.pain_point),
         message    = COALESCE(excluded.message, waitlist.message)`,
    )
      .bind(email, name, company, role, teamSize, painPoint, message)
      .run();
  } catch (err) {
    console.error('[waitlist] D1 insert error:', err);
    return apiError(c, 'INTERNAL_ERROR', 'Failed to save signup. Please try again.');
  }

  return c.json({ ok: true, email }, 201);
});

export { waitlist };
