import { Hono, type Context } from 'hono';
import { apiError } from '../middleware/errors';
import { sendTransactionalEmail } from '../lib/transactionalEmail';
import type { Env, Variables } from '../types';

const waitlist = new Hono<{ Bindings: Env; Variables: Variables }>();

type WaitlistContext = Context<{ Bindings: Env; Variables: Variables }>;

interface WaitlistLead {
  email: string;
  name: string | null;
  company: string | null;
  role: string | null;
  teamSize: string | null;
  painPoint: string | null;
  message: string | null;
}

/** Run lead emails without blocking the response; fall back to inline await outside Workers. */
function queueLeadEmails(c: WaitlistContext, task: () => Promise<void>): Promise<void> | void {
  const safeTask = (): Promise<void> =>
    task().catch((err) => {
      console.error('[waitlist] lead email dispatch failed:', err instanceof Error ? err.message : String(err));
    });

  let executionCtx: ExecutionContext | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    executionCtx = undefined;
  }
  if (executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(safeTask());
    return;
  }
  return safeTask();
}

function leadLine(label: string, value: string | null): string {
  return value ? `${label}: ${value}\n` : '';
}

async function sendFounderAlert(env: Env, lead: WaitlistLead): Promise<void> {
  const notifyEmail = env.WAITLIST_NOTIFY_EMAIL?.trim();
  if (!notifyEmail) return;

  const text =
    `New waitlist lead from hire-pipe.com\n\n` +
    `Email: ${lead.email}\n` +
    leadLine('Name', lead.name) +
    leadLine('Company', lead.company) +
    leadLine('Role', lead.role) +
    leadLine('Team size', lead.teamSize) +
    leadLine('Pain point', lead.painPoint) +
    leadLine('Message', lead.message) +
    `\nReply to this email to answer them directly.`;

  await sendTransactionalEmail(env, {
    to: notifyEmail,
    subject: `[PIPE] New pilot lead: ${lead.email}`,
    text,
    replyTo: lead.email,
  });
}

async function sendLeadAutoReply(env: Env, lead: WaitlistLead): Promise<void> {
  const bookingUrl = env.PILOT_BOOKING_URL?.trim();
  const greeting = lead.name ? `Hi ${lead.name},` : 'Hi,';
  const bookingParagraph = bookingUrl
    ? `The fastest next step is a 20-minute pilot call — pick a time here:\n${bookingUrl}\n\n`
    : '';

  const text =
    `${greeting}\n\n` +
    `Thanks for reaching out to PIPE. We received your request and a real person will follow up shortly.\n\n` +
    bookingParagraph +
    `In the meantime, feel free to reply to this email with the role you're hiring for.\n\n` +
    `— PIPE`;

  await sendTransactionalEmail(env, {
    to: lead.email,
    subject: 'PIPE — next step for your hiring pilot',
    text,
  });
}

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

  const lead: WaitlistLead = { email, name, company, role, teamSize, painPoint, message };
  queueLeadEmails(c, async () => {
    await Promise.all([sendFounderAlert(c.env, lead), sendLeadAutoReply(c.env, lead)]);
  });

  return c.json({ ok: true, email }, 201);
});

export { waitlist };
