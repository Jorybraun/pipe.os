import { describe, it, expect, vi } from 'vitest';
import { calendlyNormalizer } from '../providers/calendly';
import crypto from 'crypto';

describe('Calendly Normalizer', () => {
  const secret = 'test-secret';
  const payload = JSON.stringify({ event: 'invitee.created', payload: { email: 'test@example.com' } });

  describe('identifyProvider', () => {
    it('should identify Calendly via signature header', () => {
      expect(calendlyNormalizer.identifyProvider({ 'calendly-webhook-signature': 'any' })).toBe(true);
    });

    it('should identify Calendly via user agent', () => {
      expect(calendlyNormalizer.identifyProvider({ 'user-agent': 'Calendly-Hookshot' })).toBe(true);
    });

    it('should not identify other providers', () => {
      expect(calendlyNormalizer.identifyProvider({ 'user-agent': 'Other' })).toBe(false);
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature with timestamp', () => {
      const timestamp = Date.now().toString();
      const data = `${timestamp}.${payload}`;
      const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
      const header = `t=${timestamp},v1=${signature}`;

      expect(calendlyNormalizer.verifySignature(payload, header, secret)).toBe(true);
    });

    it('should verify valid raw hex signature (fallback)', () => {
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(calendlyNormalizer.verifySignature(payload, signature, secret)).toBe(true);
    });

    it('should reject invalid signature', () => {
      expect(calendlyNormalizer.verifySignature(payload, 'invalid', secret)).toBe(false);
    });

    it('should reject if secret is missing', () => {
      expect(calendlyNormalizer.verifySignature(payload, 'any', '')).toBe(false);
    });
  });

  describe('normalize', () => {
    it('should normalize invitee.created event', () => {
      const mockPayload = {
        event: 'invitee.created',
        payload: {
          email: 'candidate@example.com',
          name: 'John Doe',
          uri: 'invitee-uri',
          scheduled_event: {
            uri: 'event-uri',
            start_time: '2026-03-03T10:00:00Z',
            location: { join_url: 'https://zoom.us/j/123' }
          }
        }
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);

      expect(normalized).toEqual({
        externalEventId: 'event-uri',
        status: 'SCHEDULED',
        scheduledAt: '2026-03-03T10:00:00Z',
        meetingUrl: 'https://zoom.us/j/123',
        candidateEmail: 'candidate@example.com',
        candidateName: 'John Doe',
        providerData: mockPayload,
      });
    });

    it('should normalize invitee.canceled event', () => {
      const mockPayload = {
        event: 'invitee.canceled',
        payload: {
          email: 'candidate@example.com',
          scheduled_event: { uri: 'event-uri' }
        }
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);
      expect(normalized.status).toBe('CANCELLED');
    });
  });
});
