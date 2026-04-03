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
  pipelineName: string;
  stageName?: string;
  assessUrl?: string;
  bookingUrl?: string;
  scheduledTime?: string;
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

const DEFAULT_TEMPLATES: Record<EmailTrigger, { subject: string; body: string }> = {
  INVITATION: {
    subject: 'You\'re invited to interview for {{pipelineName}}',
    body: `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 24px; color: #ffffff;">Hi {{name}},</h1>
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    You've been invited to complete an assessment for <strong>{{pipelineName}}</strong>.
  </p>
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
</div>`,
  },
  SCHEDULED: {
    subject: 'Interview scheduled — {{pipelineName}}',
    body: `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 24px; color: #ffffff;">Interview Confirmed</h1>
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    Hi {{name}}, your interview for <strong>{{pipelineName}}</strong> is scheduled.
  </p>
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 32px;">
    <strong>Stage:</strong> {{stageName}}<br/>
    <strong>Time:</strong> {{scheduledTime}}
  </p>
  <a href="{{bookingUrl}}" style="display: inline-block; padding: 14px 32px; background: #ffffff; color: #0c0c0e; text-decoration: none; font-weight: 700; font-size: 14px; letter-spacing: 0.5px; border: none;">
    VIEW DETAILS →
  </a>
</div>`,
  },
  SUCCESS: {
    subject: 'Stage completed — {{pipelineName}}',
    body: `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
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
  return template
    .replace(/\{\{name\}\}/g, vars.name)
    .replace(/\{\{email\}\}/g, vars.email)
    .replace(/\{\{pipelineName\}\}/g, vars.pipelineName)
    .replace(/\{\{stageName\}\}/g, vars.stageName ?? '')
    .replace(/\{\{assessUrl\}\}/g, vars.assessUrl ?? '')
    .replace(/\{\{bookingUrl\}\}/g, vars.bookingUrl ?? '')
    .replace(/\{\{scheduledTime\}\}/g, vars.scheduledTime ?? '');
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

// ─── Send email ─────────────────────────────────────────────────────────────

async function sendEmail(
  resend: Resend,
  params: SendEmailParams,
): Promise<{ id: string } | null> {
  const from = params.from ?? 'Pipe <invites@pipe-os.com>';

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
}): Promise<{ id: string } | null> {
  const resend = new Resend(params.apiKey);
  const template = resolveTemplate(params.trigger, params.stageTemplatesJson ?? null);

  const subject = substituteVariables(template.subject, params.variables);
  const html = substituteVariables(template.body, params.variables);

  return sendEmail(resend, {
    to: params.to,
    subject,
    html,
    ...(params.from ? { from: params.from } : {}),
  });
}
