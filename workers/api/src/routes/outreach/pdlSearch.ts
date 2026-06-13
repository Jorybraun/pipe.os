/**
 * PDL Search routes — candidate sourcing via People Data Labs.
 *
 * POST /api/v1/outreach/search     — search PDL person database
 * POST /api/v1/outreach/save       — save a PDL result as a Contact + living context
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { searchPeople, enrichPerson } from '../../lib/pdl';
import { ensureContactLivingContext } from '../../lib/livingContext';
import type { Env, Variables } from '../../types';

// ─── Validation ─────────────────────────────────────────────────────────────

const searchSchema = z.object({
  jobTitleRole: z.string().optional(),
  jobTitleLevel: z.string().optional(),
  jobCompanyName: z.string().optional(),
  locationCountry: z.string().optional(),
  locationRegion: z.string().optional(),
  skills: z.array(z.string()).optional(),
  hasPhone: z.boolean().optional(),
  hasEmail: z.boolean().optional(),
  size: z.number().int().min(1).max(100).optional().default(10),
});

const saveSchema = z.object({
  pdlRecord: z.record(z.unknown()),
  type: z.enum(['lead', 'candidate', 'customer', 'hiring_manager', 'recruiter', 'other']).default('lead'),
});

// ─── Router ───────────────────────────────────────────────────────────────────

const pdlSearch = new Hono<{ Bindings: Env; Variables: Variables }>();
pdlSearch.use('*', authMiddleware);

// POST /api/v1/outreach/search
pdlSearch.post('/search', async (c) => {
  const apiKey = c.env.PDL_API_KEY;
  if (!apiKey) {
    return apiError(c, 'SERVICE_UNAVAILABLE', 'PDL integration not configured.');
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  try {
    const result = await searchPeople(apiKey, parsed.data);
    return c.json({
      results: result.data,
      total: result.total,
      scrollToken: result.scroll_token,
    });
  } catch (err) {
    console.error('[pdlSearch] search failed:', err);
    const message = err instanceof Error ? err.message : 'Search failed';
    return apiError(c, 'SERVICE_UNAVAILABLE', message);
  }
});

// POST /api/v1/outreach/save
pdlSearch.post('/save', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json().catch(() => ({}));
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  const record = parsed.data.pdlRecord as Record<string, unknown>;

  // Extract fields from PDL record
  const fullName = typeof record.full_name === 'string' ? record.full_name : null;
  const firstName = typeof record.first_name === 'string' ? record.first_name : null;
  const lastName = typeof record.last_name === 'string' ? record.last_name : null;
  const displayName = fullName ?? (firstName && lastName ? `${firstName} ${lastName}` : firstName ?? lastName);

  const emails = Array.isArray(record.emails) ? record.emails as Array<{ address?: string }> : [];
  const primaryEmail = emails[0]?.address ?? null;

  const phoneNumbers = Array.isArray(record.phone_numbers)
    ? record.phone_numbers as Array<{ number?: string }>
    : [];
  const primaryPhone = phoneNumbers[0]?.number ?? null;

  const company = typeof record.job_company_name === 'string' ? record.job_company_name : null;
  const role = typeof record.job_title === 'string' ? record.job_title : null;
  const linkedin = typeof record.linkedin_url === 'string' ? record.linkedin_url : null;

  if (!primaryEmail) {
    return apiError(c, 'VALIDATION_ERROR', 'PDL record has no email address.');
  }

  // Check for duplicate email per owner
  const existing = await db
    .prepare('SELECT id FROM contacts WHERE owner_id = ? AND email = ?')
    .bind(userId, primaryEmail)
    .first<{ id: string }>();
  if (existing) {
    return apiError(c, 'CONFLICT', 'A contact with this email already exists.');
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO contacts (id, owner_id, email, name, company, role, phone, linkedin, notes, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, userId,
      primaryEmail,
      displayName ?? null,
      company ?? null,
      role ?? null,
      primaryPhone ?? null,
      linkedin ?? null,
      JSON.stringify({ source: 'pdl', raw: record }),
      parsed.data.type,
      now, now,
    )
    .run();

  // Mirror into living context graph
  await ensureContactLivingContext(db, id);

  const contact = await db
    .prepare('SELECT * FROM contacts WHERE id = ?')
    .bind(id)
    .first<{
      id: string;
      email: string;
      name: string | null;
      company: string | null;
      role: string | null;
      phone: string | null;
      linkedin: string | null;
      notes: string | null;
      type: string;
      created_at: string;
      updated_at: string;
    }>();

  return c.json({ contact }, 201);
});

// POST /api/v1/outreach/enrich
pdlSearch.post('/enrich', async (c) => {
  const apiKey = c.env.PDL_API_KEY;
  if (!apiKey) {
    return apiError(c, 'SERVICE_UNAVAILABLE', 'PDL integration not configured.');
  }

  const body = await c.req.json().catch(() => ({}));
  const schema = z.object({
    email: z.string().email().optional(),
    name: z.string().optional(),
    company: z.string().optional(),
    domain: z.string().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  try {
    const result = await enrichPerson(apiKey, parsed.data);
    if (!result) {
      return apiError(c, 'NOT_FOUND', 'No enrichment data found for this person.');
    }
    return c.json({ result });
  } catch (err) {
    console.error('[pdlSearch] enrich failed:', err);
    const message = err instanceof Error ? err.message : 'Enrichment failed';
    return apiError(c, 'SERVICE_UNAVAILABLE', message);
  }
});

export { pdlSearch };
