import { describe, it, expect } from 'vitest';
import { calendlyNormalizer } from './calendly';
import crypto from 'crypto';

describe('Calendly Normalizer', () => {
  const secret = 'test-secret';
  const payload = JSON.stringify({ event: 'invitee.created', payload: { email: 'test@example.com' } });

  describe('1.1 identifyProvider(headers)', () => {
    it('1 | Identifies via `calendly-webhook-signature` header', () => {
      expect(calendlyNormalizer.identifyProvider({ 'calendly-webhook-signature': 'any' })).toBe(true);
    });

    it('2 | Identifies via Calendly user-agent', () => {
      expect(calendlyNormalizer.identifyProvider({ 'user-agent': 'Calendly-Hookshot/1.0' })).toBe(true);
    });

    it('3 | Rejects non-Calendly headers', () => {
      expect(calendlyNormalizer.identifyProvider({ 'user-agent': 'curl/7.68' })).toBe(false);
    });

    it('4 | Rejects empty headers', () => {
      expect(calendlyNormalizer.identifyProvider({})).toBe(false);
    });

    it('5 | Case sensitivity — header keys are always lowercase from Lambda Function URL', () => {
      // Lambda keys are lowercase, so uppercase should not match if using 'in' on raw object
      expect(calendlyNormalizer.identifyProvider({ 'CALENDLY-WEBHOOK-SIGNATURE': 'x' })).toBe(false);
    });
  });

  describe('1.2 verifySignature(payload, signature, secret)', () => {
    it('1 | Valid t=<ts>,v1=<hex> format — correct HMAC', () => {
      const timestamp = Date.now().toString();
      const data = `${timestamp}.${payload}`;
      const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
      const header = `t=${timestamp},v1=${signature}`;
      expect(calendlyNormalizer.verifySignature(payload, header, secret)).toBe(true);
    });

    it('2 | Valid t=<ts>,v1=<hex> format — wrong HMAC', () => {
      const timestamp = Date.now().toString();
      const header = `t=${timestamp},v1=wrong`;
      expect(calendlyNormalizer.verifySignature(payload, header, secret)).toBe(false);
    });

    it('3 | Raw hex fallback — correct HMAC (no t=/v1= parts)', () => {
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(calendlyNormalizer.verifySignature(payload, signature, secret)).toBe(true);
    });

    it('4 | Raw hex fallback — wrong HMAC', () => {
      const signature = 'wrong';
      expect(calendlyNormalizer.verifySignature(payload, signature, secret)).toBe(false);
    });

    it('5 | Empty signature string', () => {
      expect(calendlyNormalizer.verifySignature(payload, '', secret)).toBe(false);
    });

    it('6 | Empty secret string', () => {
      expect(calendlyNormalizer.verifySignature(payload, 'any', '')).toBe(false);
    });

    it('7 | Both empty', () => {
      expect(calendlyNormalizer.verifySignature(payload, '', '')).toBe(false);
    });

    it('8 | Tampered payload after signing', () => {
      const timestamp = Date.now().toString();
      const data = `${timestamp}.${payload}`;
      const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
      const header = `t=${timestamp},v1=${signature}`;
      const tamperedPayload = JSON.stringify({ event: 'invitee.created', payload: { email: 'hacker@example.com' } });
      expect(calendlyNormalizer.verifySignature(tamperedPayload, header, secret)).toBe(false);
    });

    it('9 | Signature with extra whitespace: t= 123,v1= abc — test parsing resilience', () => {
      const timestamp = Date.now().toString();
      const data = `${timestamp}.${payload}`;
      const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
      const header = `t= ${timestamp},v1= ${signature}`;
      expect(calendlyNormalizer.verifySignature(payload, header, secret)).toBe(false);
    });

    it('10 | Malformed: v1=abc only (no t= part)', () => {
      expect(calendlyNormalizer.verifySignature(payload, 'v1=abc', secret)).toBe(false);
    });

    it('11 | Signature with additional unknown parts: t=123,v1=abc,v2=def', () => {
      const timestamp = Date.now().toString();
      const data = `${timestamp}.${payload}`;
      const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
      const header = `t=${timestamp},v1=${signature},v2=def`;
      expect(calendlyNormalizer.verifySignature(payload, header, secret)).toBe(true);
    });
  });

  describe('1.3 normalize(payload)', () => {
    it('1 | Standard `invitee.created` with email/name on `payload` root', () => {
      const mockPayload = {
        event: 'invitee.created',
        payload: {
          email: 'candidate@example.com',
          name: 'John Doe',
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

    it('2 | `invitee.canceled` event', () => {
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

    it('3 | Email on `payload.invitee.email` (legacy shape)', () => {
      const mockPayload = {
        event: 'invitee.created',
        payload: {
          invitee: { email: 'legacy@example.com' },
          scheduled_event: { uri: 'event-uri' }
        }
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);
      expect(normalized.candidateEmail).toBe('legacy@example.com');
    });

    it('4 | Email on `payload.scheduled_event.invitees[0].email` (deepest fallback)', () => {
      const mockPayload = {
        event: 'invitee.created',
        payload: {
          scheduled_event: {
            uri: 'event-uri',
            invitees: [{ email: 'deep@example.com' }]
          }
        }
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);
      expect(normalized.candidateEmail).toBe('deep@example.com');
    });

    it('5 | No email anywhere', () => {
      const mockPayload = {
        event: 'invitee.created',
        payload: {
          scheduled_event: { uri: 'event-uri' }
        }
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);
      expect(normalized.candidateEmail).toBe('');
    });

    it('6 | `externalEventId` from `scheduled_event.uri` (preferred)', () => {
      const mockPayload = {
        event: 'invitee.created',
        payload: {
          uri: 'invitee-uri',
          scheduled_event: { uri: 'event-uri' }
        }
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);
      expect(normalized.externalEventId).toBe('event-uri');
    });

    it('7 | `externalEventId` fallback to `payload.uri` (invitee URI)', () => {
      const mockPayload = {
        event: 'invitee.created',
        payload: {
          uri: 'invitee-uri'
        }
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);
      expect(normalized.externalEventId).toBe('invitee-uri');
    });

    it('8 | `meetingUrl` from `scheduled_event.location.join_url`', () => {
      const mockPayload = {
        event: 'invitee.created',
        payload: {
          scheduled_event: {
            location: { join_url: 'https://zoom.us/j/123' }
          }
        }
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);
      expect(normalized.meetingUrl).toBe('https://zoom.us/j/123');
    });

    it('9 | Missing `scheduled_event.location`', () => {
      const mockPayload = {
        event: 'invitee.created',
        payload: {
          scheduled_event: {}
        }
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);
      expect(normalized.meetingUrl).toBe(undefined);
    });

    it('10 | Unknown event type (e.g., `invitee.updated`)', () => {
      const mockPayload = {
        event: 'invitee.updated',
        payload: {}
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);
      expect(normalized.status).toBe('SCHEDULED');
    });

    it('11 | Completely empty payload `{ event: "", payload: {} }`', () => {
      const mockPayload = {
        event: '',
        payload: {}
      };

      const normalized = calendlyNormalizer.normalize(mockPayload);
      expect(normalized).toEqual({
        candidateEmail: '',
        candidateName: undefined,
        externalEventId: '',
        meetingUrl: undefined,
        status: 'SCHEDULED',
        scheduledAt: '',
        providerData: mockPayload
      });
    });
  });
});
