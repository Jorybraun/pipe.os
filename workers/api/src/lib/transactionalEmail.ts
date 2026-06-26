import type { Env } from '../types';

const DEFAULT_FROM_EMAIL = 'no-reply@hire-pipe.com';
const DEFAULT_FROM_NAME = 'PIPE';

export interface TransactionalEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

export interface TransactionalEmailResult {
  provider: 'cloudflare' | 'resend';
  id: string | null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveFromEmail(env: Env, override?: string): string {
  return (override ?? env.OUTBOUND_EMAIL_FROM ?? DEFAULT_FROM_EMAIL).trim();
}

export async function sendTransactionalEmail(
  env: Env,
  input: TransactionalEmailInput,
): Promise<TransactionalEmailResult | null> {
  const fromEmail = resolveFromEmail(env, input.from);
  const text = input.text ?? (input.html ? stripHtml(input.html) : undefined);
  const failures: string[] = [];

  if (env.EMAIL) {
    try {
      const response = await env.EMAIL.send({
        to: input.to,
        from: { email: fromEmail, name: DEFAULT_FROM_NAME },
        subject: input.subject,
        ...(input.html ? { html: input.html } : {}),
        ...(text ? { text } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      }) as { messageId?: string } | undefined;
      return { provider: 'cloudflare', id: response?.messageId ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`cloudflare: ${message}`);
      console.error('[email] Cloudflare send failed:', err);
    }
  }

  if (env.RESEND_API_KEY) {
    const { Resend } = await import('resend');
    const resend = new Resend(env.RESEND_API_KEY);
    try {
      const basePayload = {
        from: `${DEFAULT_FROM_NAME} <${fromEmail}>`,
        to: input.to,
        subject: input.subject,
      };
      const response = await resend.emails.send(input.html
        ? { ...basePayload, html: input.html, ...(text ? { text } : {}) }
        : { ...basePayload, text: text ?? '' });
      if (response.error) {
        failures.push(`resend: ${response.error.message}`);
      } else {
        return { provider: 'resend', id: response.data?.id ?? null };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`resend: ${message}`);
      console.error('[email] Resend send failed:', err);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Email send failed (${failures.join('; ')})`);
  }

  return null;
}
