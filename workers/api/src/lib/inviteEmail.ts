/**
 * Invite email composition — single source of truth for scheduled-interview
 * invite emails. Used by both the send path (POST /interviews/:id/invite)
 * and the recruiter preview endpoint, so the preview can never drift from
 * what the candidate actually receives.
 *
 * Copy contract: docs/plans/design-recruiter-invite-creation-mvp.md §7.
 */

export type InviteEmailInterviewType =
  | 'VIDEO'
  | 'SCREENING'
  | 'CODE_REVIEW'
  | 'DEV_CONTAINER_CHALLENGE'
  | 'OPEN_SOURCE_BUG_FIX';

/**
 * How the candidate reaches the interview:
 * - ASSESS      — async /assess/:token link (CODE_REVIEW)
 * - WORKSPACE   — controlled workspace room (OPEN_SOURCE_BUG_FIX, DEV_CONTAINER_CHALLENGE)
 * - SCHEDULING  — provider scheduling link (Calendly/Cal.com)
 * - ROOM        — direct video room link
 */
export type InviteEmailDelivery = 'ASSESS' | 'WORKSPACE' | 'ROOM' | 'SCHEDULING';

export interface InviteEmailInput {
  interviewType: InviteEmailInterviewType;
  delivery: InviteEmailDelivery;
  candidateName: string;
  roleTitle?: string | null;
  customMessage?: string | null;
  recruiterName?: string | null;
  /** Pre-formatted, human-readable scheduled time (see formatInviteScheduledTimeLabel). */
  scheduledTimeLabel?: string | null;
  /** Absolute candidate link. Pass null to render the preview placeholder. */
  link: string | null;
  /** Pre-rendered logo <img> markup (already trusted), or ''. */
  logoImg: string;
  /** When true the footer invites replying to the email (reply-to is set). */
  replyToAvailable?: boolean;
}

export interface InviteEmailContent {
  subject: string;
  html: string;
  ctaLabel: string;
}

const INVITE_EMAIL_TYPES: ReadonlySet<string> = new Set([
  'VIDEO',
  'SCREENING',
  'CODE_REVIEW',
  'DEV_CONTAINER_CHALLENGE',
  'OPEN_SOURCE_BUG_FIX',
]);

export function isInviteEmailInterviewType(value: string | null | undefined): value is InviteEmailInterviewType {
  return typeof value === 'string' && INVITE_EMAIL_TYPES.has(value);
}

export function resolveInviteEmailDelivery(input: {
  interviewType: string | null | undefined;
  hasSchedulingUrl: boolean;
}): InviteEmailDelivery {
  if (input.interviewType === 'CODE_REVIEW') return 'ASSESS';
  if (input.interviewType === 'OPEN_SOURCE_BUG_FIX' || input.interviewType === 'DEV_CONTAINER_CHALLENGE') {
    return 'WORKSPACE';
  }
  return input.hasSchedulingUrl ? 'SCHEDULING' : 'ROOM';
}

/** Formats an ISO timestamp into the long label used in subjects and When rows. */
export function formatInviteScheduledTimeLabel(scheduledAt: string | null | undefined): string | null {
  if (!scheduledAt) return null;
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface InviteEmailCopy {
  subjectPrefix: string;
  intro: string;
  format: string;
  time: string;
  needs: string | null;
  ctaLabel: string;
}

function copyFor(input: InviteEmailInput): InviteEmailCopy {
  switch (input.delivery) {
    case 'ASSESS':
      return {
        subjectPrefix: 'Code review invitation',
        intro: 'You&#39;ve been invited to a short code-review exercise. You&#39;ll read a real pull request and leave review comments — the same work you&#39;d do on the job.',
        format: 'Async — start when you&#39;re ready',
        time: 'About 45–60 minutes',
        needs: 'A laptop and a browser. No account or sign-up.',
        ctaLabel: 'START CODE REVIEW',
      };
    case 'WORKSPACE':
      return {
        subjectPrefix: 'Coding exercise invitation',
        intro: input.interviewType === 'OPEN_SOURCE_BUG_FIX'
          ? 'You&#39;ve been invited to a hands-on exercise: fixing a real bug in an open-source codebase, in a ready-to-code workspace in your browser.'
          : 'You&#39;ve been invited to a live coding exercise in a prepared development workspace — nothing to install.',
        format: input.interviewType === 'OPEN_SOURCE_BUG_FIX'
          ? 'Guided workspace — nothing to install'
          : 'Live workspace session',
        time: 'About 60–90 minutes',
        needs: 'A laptop and a browser',
        ctaLabel: 'OPEN YOUR WORKSPACE',
      };
    case 'SCHEDULING':
      return {
        subjectPrefix: 'Schedule your interview',
        intro: 'You&#39;ve been invited to a video interview. Pick any time that works for you.',
        format: 'Live video call',
        time: 'About 45 minutes',
        needs: null,
        ctaLabel: 'PICK A TIME',
      };
    case 'ROOM':
      return {
        subjectPrefix: input.scheduledTimeLabel ? 'Video interview' : 'Video interview invitation',
        intro: 'You&#39;ve been invited to a video interview.',
        format: 'Live video call',
        time: 'About 45 minutes',
        needs: 'Camera, mic, and a quiet spot',
        ctaLabel: 'JOIN VIDEO CALL',
      };
  }
}

function buildSubject(input: InviteEmailInput, copy: InviteEmailCopy): string {
  const roleSuffix = input.roleTitle ? ` — ${input.roleTitle}` : '';
  if (input.delivery === 'ROOM' && input.scheduledTimeLabel) {
    return `${copy.subjectPrefix}${roleSuffix} (${input.scheduledTimeLabel})`;
  }
  return `${copy.subjectPrefix}${roleSuffix}`;
}

function detailRow(label: string, value: string): string {
  return `<p style="font-size: 14px; margin: 0 0 8px 0;"><strong style="color: #888;">${label}:</strong> ${value}</p>`;
}

const CTA_STYLE = 'display: inline-block; padding: 14px 32px; background: #ffffff; color: #0c0c0e; text-decoration: none; font-weight: 700; font-size: 14px; letter-spacing: 0.5px; border: none;';

export function composeInviteEmail(input: InviteEmailInput): InviteEmailContent {
  const copy = copyFor(input);
  const subject = buildSubject(input, copy);
  const candidateName = escapeHtml(input.candidateName);
  const safeLink = input.link ? escapeHtml(input.link) : null;

  const personalMessageBlock = input.customMessage
    ? `<div data-block="invite-email-personal-message" style="padding: 16px; background: rgba(255,255,255,0.05); border-left: 3px solid rgba(96,165,250,0.4); border-radius: 4px; margin-bottom: 24px;">
    <p style="font-size: 15px; line-height: 1.6; margin: 0; color: #ccc;">&ldquo;${escapeHtml(input.customMessage)}&rdquo;${input.recruiterName ? ` <span style="color: #888;">— ${escapeHtml(input.recruiterName)}</span>` : ''}</p>
  </div>`
    : '';

  const detailRows = [
    input.roleTitle ? detailRow('Role', escapeHtml(input.roleTitle)) : null,
    detailRow('Format', copy.format),
    detailRow('Time', copy.time),
    input.scheduledTimeLabel ? detailRow('When', escapeHtml(input.scheduledTimeLabel)) : null,
    copy.needs ? detailRow('Needs', copy.needs) : null,
  ].filter((row): row is string => row !== null).join('\n    ');

  const ctaBlock = safeLink
    ? `<a href="${safeLink}" style="${CTA_STYLE}">${copy.ctaLabel} →</a>
  <p style="font-size: 12px; color: #666; margin-top: 40px;">
    If the button doesn&#39;t work, copy this link:<br/>
    <a href="${safeLink}" style="color: #888;">${safeLink}</a>
  </p>`
    : `<span style="${CTA_STYLE} opacity: 0.85;">${copy.ctaLabel} →</span>
  <p style="font-size: 12px; color: #666; margin-top: 40px;">
    Your unique link is generated when the invite is sent.
  </p>`;

  const replyLine = input.replyToAvailable
    ? '<br/>Questions? Just reply to this email.'
    : '';

  const html = `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
  ${input.logoImg}
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 24px; color: #ffffff;">Hi ${candidateName},</h1>
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    ${copy.intro}
  </p>
  ${personalMessageBlock}
  <div style="padding: 20px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 32px;">
    ${detailRows}
  </div>
  ${ctaBlock}
  <p style="font-size: 12px; color: #666; margin-top: 24px;">
    This link is unique to you — please don&#39;t forward it.${replyLine}
  </p>
</div>`;

  return { subject, html, ctaLabel: copy.ctaLabel };
}
