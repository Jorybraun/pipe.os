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
  // Process conditional blocks: {{#var}}...{{/var}} — keep block if var is truthy, remove if not
  let result = template;
  const conditionalKeys = ['bookingUrl', 'assessUrl', 'stageName', 'scheduledTime'] as const;
  for (const key of conditionalKeys) {
    const re = new RegExp(`\\{\\{#${key}\\}\\}([\\s\\S]*?)\\{\\{/${key}\\}\\}`, 'g');
    result = result.replace(re, vars[key] ? '$1' : '');
  }

  // Simple variable substitution
  return result
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
