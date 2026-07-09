/**
 * Invite email composition tests.
 *
 * Copy contract: docs/plans/design-recruiter-invite-creation-mvp.md §7.
 * The same composition drives the send path and the recruiter preview,
 * so these tests are the single source of truth for candidate-facing copy.
 */

import { describe, it, expect } from 'vitest';
import {
  composeInviteEmail,
  resolveInviteEmailDelivery,
  formatInviteScheduledTimeLabel,
  type InviteEmailInput,
} from '../inviteEmail';

const LOGO_IMG = '<img src="https://example.com/logo.png" alt="PIPE" />';

function baseInput(overrides: Partial<InviteEmailInput> = {}): InviteEmailInput {
  return {
    interviewType: 'CODE_REVIEW',
    delivery: 'ASSESS',
    candidateName: 'Jane Doe',
    roleTitle: 'Senior Frontend Engineer',
    customMessage: null,
    recruiterName: null,
    scheduledTimeLabel: null,
    link: 'https://pipe.build/assess/tk_123',
    logoImg: LOGO_IMG,
    ...overrides,
  };
}

describe('resolveInviteEmailDelivery', () => {
  it.each([
    ['CODE_REVIEW', false, 'ASSESS'],
    ['CODE_REVIEW', true, 'ASSESS'],
    ['OPEN_SOURCE_BUG_FIX', false, 'WORKSPACE'],
    ['DEV_CONTAINER_CHALLENGE', false, 'WORKSPACE'],
    ['VIDEO', true, 'SCHEDULING'],
    ['VIDEO', false, 'ROOM'],
    ['SCREENING', false, 'ROOM'],
    ['SCREENING', true, 'SCHEDULING'],
  ] as const)('maps %s (schedulingUrl: %s) to %s', (interviewType, hasSchedulingUrl, expected) => {
    expect(resolveInviteEmailDelivery({ interviewType, hasSchedulingUrl })).toBe(expected);
  });

  it('falls back to ROOM for unknown or missing types', () => {
    expect(resolveInviteEmailDelivery({ interviewType: null, hasSchedulingUrl: false })).toBe('ROOM');
    expect(resolveInviteEmailDelivery({ interviewType: 'SOMETHING_ELSE', hasSchedulingUrl: false })).toBe('ROOM');
  });
});

describe('composeInviteEmail — subjects and CTAs', () => {
  it('CODE_REVIEW: type-specific subject with role, START CODE REVIEW CTA', () => {
    const email = composeInviteEmail(baseInput());
    expect(email.subject).toBe('Code review invitation — Senior Frontend Engineer');
    expect(email.ctaLabel).toBe('START CODE REVIEW');
    expect(email.html).toContain('START CODE REVIEW');
    expect(email.html).toContain('https://pipe.build/assess/tk_123');
  });

  it('CODE_REVIEW without a role drops the suffix instead of leaking a placeholder', () => {
    const email = composeInviteEmail(baseInput({ roleTitle: null }));
    expect(email.subject).toBe('Code review invitation');
    expect(email.subject).not.toContain('Interview');
    expect(email.html).not.toContain('Role:');
  });

  it('OPEN_SOURCE_BUG_FIX: coding exercise subject, OPEN YOUR WORKSPACE CTA', () => {
    const email = composeInviteEmail(baseInput({
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      delivery: 'WORKSPACE',
      link: 'https://rooms.pipe.build/r/abc',
    }));
    expect(email.subject).toBe('Coding exercise invitation — Senior Frontend Engineer');
    expect(email.ctaLabel).toBe('OPEN YOUR WORKSPACE');
    expect(email.html).toContain('open-source codebase');
    expect(email.html).toContain('Guided workspace — nothing to install');
  });

  it('DEV_CONTAINER_CHALLENGE: coding exercise subject, live workspace format', () => {
    const email = composeInviteEmail(baseInput({
      interviewType: 'DEV_CONTAINER_CHALLENGE',
      delivery: 'WORKSPACE',
    }));
    expect(email.subject).toBe('Coding exercise invitation — Senior Frontend Engineer');
    expect(email.ctaLabel).toBe('OPEN YOUR WORKSPACE');
    expect(email.html).toContain('Live workspace session');
  });

  it('VIDEO room, unscheduled: video interview invitation, JOIN VIDEO CALL CTA', () => {
    const email = composeInviteEmail(baseInput({
      interviewType: 'VIDEO',
      delivery: 'ROOM',
      link: 'https://rooms.pipe.build/r/abc',
    }));
    expect(email.subject).toBe('Video interview invitation — Senior Frontend Engineer');
    expect(email.ctaLabel).toBe('JOIN VIDEO CALL');
    expect(email.html).toContain('Live video call');
    expect(email.html).toContain('Camera, mic, and a quiet spot');
  });

  it('VIDEO room, scheduled: subject carries the confirmed time and body shows a When row', () => {
    const email = composeInviteEmail(baseInput({
      interviewType: 'VIDEO',
      delivery: 'ROOM',
      scheduledTimeLabel: 'Tuesday, July 7, 2026 at 3:00 PM PDT',
      link: 'https://rooms.pipe.build/r/abc',
    }));
    expect(email.subject).toBe('Video interview — Senior Frontend Engineer (Tuesday, July 7, 2026 at 3:00 PM PDT)');
    expect(email.html).toContain('When:');
    expect(email.html).toContain('Tuesday, July 7, 2026 at 3:00 PM PDT');
  });

  it('VIDEO via scheduling link: schedule-your-interview subject, PICK A TIME CTA', () => {
    const email = composeInviteEmail(baseInput({
      interviewType: 'VIDEO',
      delivery: 'SCHEDULING',
      link: 'https://calendly.com/acme/intro',
    }));
    expect(email.subject).toBe('Schedule your interview — Senior Frontend Engineer');
    expect(email.ctaLabel).toBe('PICK A TIME');
    expect(email.html).toContain('Pick any time that works for you');
  });

  it('assessment subjects do not append the scheduled time', () => {
    const email = composeInviteEmail(baseInput({
      scheduledTimeLabel: 'Tuesday, July 7, 2026 at 3:00 PM PDT',
    }));
    expect(email.subject).toBe('Code review invitation — Senior Frontend Engineer');
    expect(email.html).toContain('When:');
  });
});

describe('composeInviteEmail — body content', () => {
  it('greets the candidate and states the code-review expectations', () => {
    const email = composeInviteEmail(baseInput());
    expect(email.html).toContain('Hi Jane Doe,');
    expect(email.html).toContain('code-review exercise');
    expect(email.html).toContain('real pull request');
    expect(email.html).toContain('Async — start when you&#39;re ready');
    expect(email.html).toContain('About 45–60 minutes');
    expect(email.html).toContain('No account or sign-up');
    expect(email.html).toContain('Senior Frontend Engineer');
  });

  it('renders the personal message with recruiter attribution', () => {
    const email = composeInviteEmail(baseInput({
      customMessage: 'Loved your design-system talk — no prep needed.',
      recruiterName: 'Hans',
    }));
    expect(email.html).toContain('Loved your design-system talk — no prep needed.');
    expect(email.html).toContain('— Hans');
  });

  it('omits the personal message block when no message is provided', () => {
    const email = composeInviteEmail(baseInput());
    expect(email.html).not.toContain('invite-email-personal-message');
  });

  it('escapes HTML in all recruiter- and candidate-provided values', () => {
    const email = composeInviteEmail(baseInput({
      candidateName: '<script>alert(1)</script>',
      roleTitle: 'Engineer <img src=x>',
      customMessage: '<b>bold</b>',
      recruiterName: '<i>Hans</i>',
    }));
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).not.toContain('<img src=x>');
    expect(email.html).not.toContain('<b>bold</b>');
    expect(email.html).not.toContain('<i>Hans</i>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('always warns that the link is unique to the candidate', () => {
    const email = composeInviteEmail(baseInput());
    expect(email.html).toContain('unique to you');
  });

  it('invites a reply only when a reply-to is wired up', () => {
    const withReply = composeInviteEmail(baseInput({ replyToAvailable: true }));
    const withoutReply = composeInviteEmail(baseInput());
    expect(withReply.html).toContain('Just reply to this email');
    expect(withoutReply.html).not.toContain('Just reply to this email');
  });

  it('renders a placeholder instead of a link in preview mode (link: null)', () => {
    const email = composeInviteEmail(baseInput({ link: null }));
    expect(email.html).toContain('generated when the invite is sent');
    expect(email.html).not.toContain('href="null"');
    expect(email.html).not.toContain('undefined');
  });

  it('includes the logo image markup', () => {
    const email = composeInviteEmail(baseInput());
    expect(email.html).toContain(LOGO_IMG);
  });
});

describe('formatInviteScheduledTimeLabel', () => {
  it('formats an ISO timestamp into a long human-readable label', () => {
    const label = formatInviteScheduledTimeLabel('2026-07-07T22:00:00.000Z');
    expect(label).toContain('2026');
    expect(label).toContain('July');
  });

  it('returns null for missing or invalid input', () => {
    expect(formatInviteScheduledTimeLabel(null)).toBeNull();
    expect(formatInviteScheduledTimeLabel('not-a-date')).toBeNull();
  });
});
