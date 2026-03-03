import { describe, it, expect } from 'vitest';
import { calcomNormalizer } from '../providers/calcom';
import crypto from 'crypto';

describe('Cal.com Normalizer', () => {
  const secret = 'test-secret';
  const payload = JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { id: 123 } });

  describe('identifyProvider', () => {
    it('should identify Cal.com via signature header', () => {
      expect(calcomNormalizer.identifyProvider({ 'x-cal-signature-256': 'any' })).toBe(true);
    });

    it('should not identify other providers', () => {
      expect(calcomNormalizer.identifyProvider({ 'user-agent': 'Other' })).toBe(false);
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature', () => {
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(calcomNormalizer.verifySignature(payload, signature, secret)).toBe(true);
    });

    it('should reject invalid signature', () => {
      expect(calcomNormalizer.verifySignature(payload, 'invalid', secret)).toBe(false);
    });
  });

  describe('normalize', () => {
    it('should normalize BOOKING_CREATED event', () => {
      const mockPayload = {
        triggerEvent: 'BOOKING_CREATED',
        payload: {
          id: 456,
          startTime: '2026-03-03T10:00:00Z',
          metadata: { videoCallUrl: 'https://cal.com/video/123' },
          attendees: [{ email: 'candidate@example.com', name: 'Jane Doe' }]
        }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);

      expect(normalized).toEqual({
        externalEventId: '456',
        status: 'SCHEDULED',
        scheduledAt: '2026-03-03T10:00:00Z',
        meetingUrl: 'https://cal.com/video/123',
        candidateEmail: 'candidate@example.com',
        candidateName: 'Jane Doe',
        providerData: mockPayload,
      });
    });

    it('should normalize BOOKING_CANCELLED event', () => {
      const mockPayload = {
        triggerEvent: 'BOOKING_CANCELLED',
        payload: { id: 456 }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);
      expect(normalized.status).toBe('CANCELLED');
    });

    it('should normalize MEETING_ENDED event', () => {
      const mockPayload = {
        triggerEvent: 'MEETING_ENDED',
        payload: { id: 456 }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);
      expect(normalized.status).toBe('COMPLETED');
    });
  });
});
