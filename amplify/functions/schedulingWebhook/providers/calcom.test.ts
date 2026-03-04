import { describe, it, expect } from 'vitest';
import { calcomNormalizer } from './calcom';
import crypto from 'crypto';

describe('Cal.com Normalizer (TODO: Integration pending)', () => {
  const secret = 'test-secret';
  const payload = JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { id: 123 } });

  describe('2.1 identifyProvider(headers)', () => {
    it('1 | Has x-cal-signature-256 header', () => {
      expect(calcomNormalizer.identifyProvider({ 'x-cal-signature-256': 'any' })).toBe(true);
    });

    it('2 | No Cal.com headers', () => {
      expect(calcomNormalizer.identifyProvider({ 'user-agent': 'Other' })).toBe(false);
    });

    it('3 | Empty headers', () => {
      expect(calcomNormalizer.identifyProvider({})).toBe(false);
    });
  });

  describe('2.2 verifySignature(payload, signature, secret)', () => {
    it('1 | Valid HMAC SHA-256', () => {
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(calcomNormalizer.verifySignature(payload, signature, secret)).toBe(true);
    });

    it('2 | Invalid signature', () => {
      expect(calcomNormalizer.verifySignature(payload, 'invalid', secret)).toBe(false);
    });

    it('3 | Empty signature', () => {
      expect(calcomNormalizer.verifySignature(payload, '', secret)).toBe(false);
    });

    it('4 | Empty secret', () => {
      expect(calcomNormalizer.verifySignature(payload, 'any', '')).toBe(false);
    });

    it('5 | Mismatched length (triggers `timingSafeEqual` catch)', () => {
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 10);
      expect(calcomNormalizer.verifySignature(payload, signature, secret)).toBe(false);
    });
  });

  describe('2.3 normalize(payload)', () => {
    it('1 | `BOOKING_CREATED` → `SCHEDULED`', () => {
      const mockPayload = {
        triggerEvent: 'BOOKING_CREATED',
        payload: {
          id: 456,
          bookingId: 789,
          startTime: '2026-03-03T10:00:00Z',
          metadata: { videoCallUrl: 'https://cal.com/video/123' },
          attendees: [{ email: 'candidate@example.com', name: 'Jane Doe' }]
        }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);

      expect(normalized).toEqual({
        externalEventId: '789',
        status: 'SCHEDULED',
        scheduledAt: '2026-03-03T10:00:00Z',
        meetingUrl: 'https://cal.com/video/123',
        candidateEmail: 'candidate@example.com',
        candidateName: 'Jane Doe',
        providerData: mockPayload,
      });
    });

    it('2 | `BOOKING_CANCELLED` → `CANCELLED`', () => {
      const mockPayload = {
        triggerEvent: 'BOOKING_CANCELLED',
        payload: { id: 456, bookingId: 789 }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);
      expect(normalized.status).toBe('CANCELLED');
    });

    it('3 | `MEETING_ENDED` → `COMPLETED`', () => {
      const mockPayload = {
        triggerEvent: 'MEETING_ENDED',
        payload: { id: 456, bookingId: 789 }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);
      expect(normalized.status).toBe('COMPLETED');
    });

    it('4 | Unknown trigger event', () => {
      const mockPayload = {
        triggerEvent: 'UNKNOWN',
        payload: { id: 456, bookingId: 789 }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);
      expect(normalized.status).toBe('SCHEDULED');
    });

    it('5 | `externalEventId` from `bookingId` (preferred over `id`)', () => {
      const mockPayload = {
        triggerEvent: 'BOOKING_CREATED',
        payload: {
          id: 456,
          bookingId: 789
        }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);
      expect(normalized.externalEventId).toBe('789');
    });

    it('6 | `externalEventId` falls back to `id` when no `bookingId`', () => {
      const mockPayload = {
        triggerEvent: 'BOOKING_CREATED',
        payload: {
          id: 456
        }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);
      expect(normalized.externalEventId).toBe('456');
    });

    it('7 | No attendees', () => {
      const mockPayload = {
        triggerEvent: 'BOOKING_CREATED',
        payload: {
          id: 456,
        }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);
      expect(normalized.candidateEmail).toBe('');
      expect(normalized.candidateName).toBe(undefined);
    });

    it('8 | `meetingUrl` from `metadata.videoCallUrl`', () => {
      const mockPayload = {
        triggerEvent: 'BOOKING_CREATED',
        payload: {
          id: 456,
          metadata: { videoCallUrl: 'https://cal.com/video/123' }
        }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);
      expect(normalized.meetingUrl).toBe('https://cal.com/video/123');
    });

    it('9 | No metadata', () => {
      const mockPayload = {
        triggerEvent: 'BOOKING_CREATED',
        payload: {
          id: 456,
        }
      };

      const normalized = calcomNormalizer.normalize(mockPayload);
      expect(normalized.meetingUrl).toBe(undefined);
    });
  });
});
