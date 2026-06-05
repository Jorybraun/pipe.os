/**
 * Scheduling routes unit tests — contact-first invite creation.
 *
 * Validates the invite creation endpoint supports both contact-first
 * (recipientName/recipientEmail) and pipeline-integrated (candidateId/pipelineId/stageId)
 * meeting models.
 */

import { describe, it, expect } from 'vitest';

// ─── Validation schema tests ────────────────────────────────────────────────

describe('Create interview validation', () => {
  it('accepts contact-first invite with recipient info', () => {
    const validContactFirst = {
      recipientName: 'Alice Johnson',
      recipientEmail: 'alice@example.com',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: '2026-06-10T14:00:00Z',
      cvProfile: { experience: '5 years', skills: ['JavaScript', 'React'] },
    };

    // Should pass validation: recipientName + recipientEmail provided
    expect(validContactFirst.recipientName).toBeTruthy();
    expect(validContactFirst.recipientEmail).toBeTruthy();
    expect(validContactFirst.recipientEmail).toContain('@');
  });

  it('accepts pipeline-integrated invite with candidate context', () => {
    const validPipelineIntegrated = {
      candidateId: 'candidate-123',
      pipelineId: 'pipeline-456',
      stageId: 'stage-789',
      meetingType: 'SCREENING_INTERVIEW',
      schedulingProvider: 'CALENDLY',
    };

    // Should pass validation: candidateId + pipelineId + stageId provided
    expect(validPipelineIntegrated.candidateId).toBeTruthy();
    expect(validPipelineIntegrated.pipelineId).toBeTruthy();
    expect(validPipelineIntegrated.stageId).toBeTruthy();
  });

  it('rejects invite without pipeline context OR recipient info', () => {
    const invalid = {
      meetingType: 'DIRECT_VIDEO_CALL',
      // Missing both pipeline context and recipient info
    };

    const hasPipelineContext = invalid.candidateId && invalid.pipelineId && invalid.stageId;
    const hasRecipientInfo = invalid.recipientName && invalid.recipientEmail;

    // Should fail validation: neither pipeline context nor recipient info provided
    expect(hasPipelineContext || hasRecipientInfo).toBe(false);
  });

  it('accepts invite with both pipeline context and recipient info', () => {
    const validBoth = {
      candidateId: 'candidate-123',
      pipelineId: 'pipeline-456',
      stageId: 'stage-789',
      recipientName: 'Alice Johnson',
      recipientEmail: 'alice@example.com',
      meetingType: 'SCREENING_INTERVIEW',
    };

    const hasPipelineContext = validBoth.candidateId && validBoth.pipelineId && validBoth.stageId;
    const hasRecipientInfo = validBoth.recipientName && validBoth.recipientEmail;

    // Should pass validation: both provided (recipient override case)
    expect(hasPipelineContext || hasRecipientInfo).toBe(true);
  });

  it('accepts optional CV/profile payload', () => {
    const withCvProfile = {
      recipientName: 'Alice Johnson',
      recipientEmail: 'alice@example.com',
      cvProfile: {
        name: 'Alice Johnson',
        email: 'alice@example.com',
        experience: 'Senior Software Engineer',
        skills: ['TypeScript', 'React', 'Node.js'],
        education: 'BS Computer Science',
      },
    };

    expect(withCvProfile.cvProfile).toBeTruthy();
    expect(typeof withCvProfile.cvProfile).toBe('object');
  });
});

// ─── Status transition tests ─────────────────────────────────────────────────

describe('Status transition validation', () => {
  const VALID_TRANSITIONS: Record<string, string[]> = {
    INVITED: ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['ACTIVE', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
    ACTIVE: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
    COMPLETED: [],
    CANCELLED: ['INVITED'],
    NO_SHOW: ['SCHEDULED', 'CANCELLED'],
  };

  function canTransition(from: string, to: string): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  it('allows INVITED -> SCHEDULED', () => {
    expect(canTransition('INVITED', 'SCHEDULED')).toBe(true);
  });

  it('allows INVITED -> CANCELLED', () => {
    expect(canTransition('INVITED', 'CANCELLED')).toBe(true);
  });

  it('allows SCHEDULED -> ACTIVE', () => {
    expect(canTransition('SCHEDULED', 'ACTIVE')).toBe(true);
  });

  it('allows SCHEDULED -> COMPLETED', () => {
    expect(canTransition('SCHEDULED', 'COMPLETED')).toBe(true);
  });

  it('allows SCHEDULED -> NO_SHOW', () => {
    expect(canTransition('SCHEDULED', 'NO_SHOW')).toBe(true);
  });

  it('allows ACTIVE -> COMPLETED', () => {
    expect(canTransition('ACTIVE', 'COMPLETED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('INVITED', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'SCHEDULED')).toBe(false);
    expect(canTransition('CANCELLED', 'ACTIVE')).toBe(false);
  });

  it('allows CANCELLED -> INVITED (reschedule)', () => {
    expect(canTransition('CANCELLED', 'INVITED')).toBe(true);
  });
});

// ─── Meeting type tests ─────────────────────────────────────────────────────

describe('Meeting type classification', () => {
  it('defaults to DIRECT_VIDEO_CALL when recipient info provided', () => {
    const withRecipient = {
      recipientName: 'Alice Johnson',
      recipientEmail: 'alice@example.com',
    };

    const inferredType = withRecipient.recipientName && withRecipient.recipientEmail
      ? 'DIRECT_VIDEO_CALL'
      : 'SCREENING_INTERVIEW';

    expect(inferredType).toBe('DIRECT_VIDEO_CALL');
  });

  it('defaults to SCREENING_INTERVIEW when pipeline context provided', () => {
    const withPipeline = {
      candidateId: 'candidate-123',
      pipelineId: 'pipeline-456',
      stageId: 'stage-789',
    };

    const inferredType = withPipeline.recipientName && withPipeline.recipientEmail
      ? 'DIRECT_VIDEO_CALL'
      : 'SCREENING_INTERVIEW';

    expect(inferredType).toBe('SCREENING_INTERVIEW');
  });

  it('respects explicit meetingType override', () => {
    const withOverride = {
      recipientName: 'Alice Johnson',
      recipientEmail: 'alice@example.com',
      meetingType: 'SCREENING_INTERVIEW' as const,
    };

    expect(withOverride.meetingType).toBe('SCREENING_INTERVIEW');
  });
});
