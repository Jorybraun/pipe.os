/**
 * Email service — Resend integration for candidate notifications.
 *
 * Sends transactional emails: invitations, scheduling confirmations,
 * stage results. Uses notification_templates from D1 with variable
 * substitution, falling back to built-in defaults.
 */

import { Resend } from 'resend';

// ─── Types ──────────────────────────────────────────────────────────────────

export type EmailTrigger = 'INVITATION' | 'SCHEDULED' | 'SUCCESS' | 'FAILURE';

export interface EmailVariables {
  name: string;
  email: string;
  pipelineName?: string;
  stageName?: string;
  assessUrl?: string;
  bookingUrl?: string;
  scheduledTime?: string;
  /** Custom message from recruiter (standalone invites) */
  customMessage?: string;
  /** Logo URL for email header */
  logoUrl?: string;
}

interface NotificationTemplate {
  trigger: EmailTrigger;
  subject: string;
  body: string;
}

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

// ─── Default templates ──────────────────────────────────────────────────────

const LOGO_IMG = `<img src="data:image/png;base64,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" alt="PIPE" width="48" height="48" style="display: block; margin-bottom: 24px;" />`;

const DEFAULT_TEMPLATES: Record<EmailTrigger, { subject: string; body: string }> = {
  INVITATION: {
    subject: '{{#pipelineName}}You\'re invited to interview for {{pipelineName}}{{/pipelineName}}{{^pipelineName}}You\'re invited to an interview{{/pipelineName}}',
    body: `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
  ${LOGO_IMG}
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 24px; color: #ffffff;">Hi {{name}},</h1>
  {{#pipelineName}}
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    You've been invited to complete an assessment for <strong>{{pipelineName}}</strong>.
  </p>
  {{/pipelineName}}
  {{^pipelineName}}
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    You've been invited to an interview.
  </p>
  {{/pipelineName}}
  {{#customMessage}}
  <div style="padding: 16px; background: rgba(255,255,255,0.05); border-left: 3px solid rgba(255,255,255,0.2); margin-bottom: 24px;">
    <p style="font-size: 14px; line-height: 1.6; margin: 0; color: #ccc;">{{customMessage}}</p>
  </div>
  {{/customMessage}}
  {{#bookingUrl}}
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 32px;">
    Please schedule your interview by clicking below.
  </p>
  <a href="{{bookingUrl}}" style="display: inline-block; padding: 14px 32px; background: #ffffff; color: #0c0c0e; text-decoration: none; font-weight: 700; font-size: 14px; letter-spacing: 0.5px; border: none;">
    SCHEDULE INTERVIEW →
  </a>
  <p style="font-size: 12px; color: #666; margin-top: 40px;">
    If the button doesn't work, copy this link:<br/>
    <a href="{{bookingUrl}}" style="color: #888;">{{bookingUrl}}</a>
  </p>
  {{/bookingUrl}}
  {{#assessUrl}}
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 32px;">
    Click the button below to begin. No account or sign-in required.
  </p>
  <a href="{{assessUrl}}" style="display: inline-block; padding: 14px 32px; background: #ffffff; color: #0c0c0e; text-decoration: none; font-weight: 700; font-size: 14px; letter-spacing: 0.5px; border: none;">
    START ASSESSMENT →
  </a>
  <p style="font-size: 12px; color: #666; margin-top: 40px;">
    If the button doesn't work, copy this link:<br/>
    <a href="{{assessUrl}}" style="color: #888;">{{assessUrl}}</a>
  </p>
  {{/assessUrl}}
</div>`,
  },
  SCHEDULED: {
    subject: 'Interview scheduled — {{pipelineName}}',
    body: `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
  ${LOGO_IMG}
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 24px; color: #ffffff;">Interview Confirmed</h1>
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    Hi {{name}}, your interview for <strong>{{pipelineName}}</strong> is confirmed.
  </p>
  <div style="padding: 20px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 32px;">
    {{#stageName}}<p style="font-size: 14px; margin: 0 0 8px 0;"><strong style="color: #888;">Stage:</strong> {{stageName}}</p>{{/stageName}}
    {{#scheduledTime}}<p style="font-size: 14px; margin: 0 0 8px 0;"><strong style="color: #888;">Time:</strong> {{scheduledTime}}</p>{{/scheduledTime}}
    {{#bookingUrl}}<p style="font-size: 14px; margin: 0;"><strong style="color: #888;">Link:</strong> <a href="{{bookingUrl}}" style="color: #60a5fa;">Join Meeting</a></p>{{/bookingUrl}}
  </div>
  {{#bookingUrl}}
  <a href="{{bookingUrl}}" style="display: inline-block; padding: 14px 32px; background: #ffffff; color: #0c0c0e; text-decoration: none; font-weight: 700; font-size: 14px; letter-spacing: 0.5px; border: none;">
    JOIN INTERVIEW →
  </a>
  {{/bookingUrl}}
</div>`,
  },
  SUCCESS: {
    subject: 'Stage completed — {{pipelineName}}',
    body: `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
  ${LOGO_IMG}
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 24px; color: #ffffff;">Nice work, {{name}}!</h1>
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    You've completed the <strong>{{stageName}}</strong> stage for <strong>{{pipelineName}}</strong>.
  </p>
  <p style="font-size: 16px; line-height: 1.6;">
    The team will review your submission and follow up with next steps.
  </p>
</div>`,
  },
  FAILURE: {
    subject: 'Update on your application — {{pipelineName}}',
    body: `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
  ${LOGO_IMG}
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 24px; color: #ffffff;">Hi {{name}},</h1>
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    Thank you for completing the <strong>{{stageName}}</strong> stage for <strong>{{pipelineName}}</strong>.
  </p>
  <p style="font-size: 16px; line-height: 1.6;">
    After careful review, the team has decided not to move forward at this time.
    We appreciate the time and effort you put into the process.
  </p>
</div>`,
  },
};

// ─── Variable substitution ──────────────────────────────────────────────────

function substituteVariables(template: string, vars: EmailVariables): string {
  // Process conditional blocks: {{#var}}...{{/var}} — keep block if var is truthy, remove if not
  // Also handle inverted blocks: {{^var}}...{{/var}} — keep block if var is falsy
  let result = template;
  const conditionalKeys = ['bookingUrl', 'assessUrl', 'stageName', 'scheduledTime', 'pipelineName', 'customMessage'] as const;
  for (const key of conditionalKeys) {
    // Positive conditional: {{#key}}...{{/key}}
    const posRe = new RegExp(`\\{\\{#${key}\\}\\}([\\s\\S]*?)\\{\\{/${key}\\}\\}`, 'g');
    result = result.replace(posRe, vars[key as keyof EmailVariables] ? '$1' : '');
    // Inverted conditional: {{^key}}...{{/key}}
    const negRe = new RegExp(`\\{\\{\\^${key}\\}\\}([\\s\\S]*?)\\{\\{/${key}\\}\\}`, 'g');
    result = result.replace(negRe, vars[key as keyof EmailVariables] ? '' : '$1');
  }

  // Simple variable substitution
  return result
    .replace(/\{\{name\}\}/g, vars.name)
    .replace(/\{\{email\}\}/g, vars.email)
    .replace(/\{\{pipelineName\}\}/g, vars.pipelineName ?? '')
    .replace(/\{\{stageName\}\}/g, vars.stageName ?? '')
    .replace(/\{\{assessUrl\}\}/g, vars.assessUrl ?? '')
    .replace(/\{\{bookingUrl\}\}/g, vars.bookingUrl ?? '')
    .replace(/\{\{scheduledTime\}\}/g, vars.scheduledTime ?? '')
    .replace(/\{\{customMessage\}\}/g, vars.customMessage ?? '')
    .replace(/\{\{logoUrl\}\}/g, vars.logoUrl ?? 'https://app.hire-pipe.com/mario-pipe.png');
}

// ─── Template resolution ────────────────────────────────────────────────────

/**
 * Resolve the email template for a given trigger.
 * Checks stage notification_templates JSON first, falls back to defaults.
 */
export function resolveTemplate(
  trigger: EmailTrigger,
  stageTemplatesJson: string | null,
): { subject: string; body: string } {
  if (stageTemplatesJson) {
    try {
      const templates = JSON.parse(stageTemplatesJson) as NotificationTemplate[];
      const match = templates.find((t) => t.trigger === trigger);
      if (match) {
        return { subject: match.subject, body: match.body };
      }
    } catch {
      // Invalid JSON — fall through to defaults
    }
  }
  return DEFAULT_TEMPLATES[trigger];
}

// ─── OAuth email connection ─────────────────────────────────────────────────

export type EmailProvider = 'GMAIL' | 'MICROSOFT';

export interface EmailConnection {
  provider: EmailProvider;
  accessToken: string;
  accountEmail: string;
}

// ─── Gmail send (via Gmail API) ─────────────────────────────────────────────

async function sendViaGmail(
  accessToken: string,
  fromEmail: string,
  params: SendEmailParams,
): Promise<{ id: string } | null> {
  // Build RFC 2822 message
  const messageParts = [
    `From: ${fromEmail}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(params.subject)))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    params.html,
  ];
  const rawMessage = messageParts.join('\r\n');

  // Base64url encode for Gmail API
  const encoded = btoa(unescape(encodeURIComponent(rawMessage)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const resp = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: encoded }),
      },
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error('[email] Gmail API error:', { status: resp.status, body: errBody.slice(0, 300) });
      return null;
    }

    const data = (await resp.json()) as { id: string };
    return { id: data.id };
  } catch (err) {
    console.error('[email] Gmail send failed:', err);
    return null;
  }
}

// ─── Microsoft send (via Graph API) ─────────────────────────────────────────

async function sendViaMicrosoft(
  accessToken: string,
  params: SendEmailParams,
): Promise<{ id: string } | null> {
  try {
    const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: params.subject,
          body: { contentType: 'HTML', content: params.html },
          toRecipients: [{ emailAddress: { address: params.to } }],
        },
      }),
    });

    // Microsoft sendMail returns 202 with no body on success
    if (resp.status === 202 || resp.ok) {
      return { id: crypto.randomUUID() };
    }

    const errBody = await resp.text();
    console.error('[email] Microsoft Graph error:', { status: resp.status, body: errBody.slice(0, 300) });
    return null;
  } catch (err) {
    console.error('[email] Microsoft send failed:', err);
    return null;
  }
}

// ─── Send email (Resend fallback) ───────────────────────────────────────────

async function sendEmail(
  resend: Resend,
  params: SendEmailParams,
): Promise<{ id: string } | null> {
  const from = params.from ?? 'Pipe <onboarding@resend.dev>';

  try {
    const result = await resend.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (result.error) {
      console.error('[email] Resend error:', result.error);
      return null;
    }

    return result.data;
  } catch (err) {
    console.error('[email] Failed to send:', err);
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Send a notification email for a given trigger.
 *
 * Resolves the template (custom or default), substitutes variables,
 * and sends via Resend. Non-blocking — logs errors but doesn't throw.
 */
export async function sendNotificationEmail(params: {
  apiKey: string;
  trigger: EmailTrigger;
  to: string;
  variables: EmailVariables;
  stageTemplatesJson?: string | null;
  from?: string;
  /** OAuth email connection — if provided, sends via Gmail/Microsoft instead of Resend. */
  emailConnection?: EmailConnection | null;
}): Promise<{ id: string } | null> {
  const template = resolveTemplate(params.trigger, params.stageTemplatesJson ?? null);

  const subject = substituteVariables(template.subject, params.variables);
  const html = substituteVariables(template.body, params.variables);

  // Try OAuth provider first (recruiter's own email)
  if (params.emailConnection) {
    const { provider, accessToken, accountEmail } = params.emailConnection;
    if (provider === 'GMAIL') {
      return sendViaGmail(accessToken, accountEmail, { to: params.to, subject, html });
    }
    if (provider === 'MICROSOFT') {
      return sendViaMicrosoft(accessToken, { to: params.to, subject, html });
    }
  }

  // Fallback to Resend
  const resend = new Resend(params.apiKey);
  return sendEmail(resend, {
    to: params.to,
    subject,
    html,
    ...(params.from ? { from: params.from } : {}),
  });
}
