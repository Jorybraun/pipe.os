import crypto from 'crypto';
import type {
  WebhookNormalizer,
  NormalizedSchedulingEvent,
  CalComWebhookPayload,
} from '../types';

/**
 * Cal.com webhook normalizer.
 *
 * Handles BOOKING_CREATED, BOOKING_CANCELLED, and MEETING_ENDED triggers
 * from Cal.com's webhook API. Uses HMAC SHA-256 for signature verification.
 *
 * @see https://cal.com/docs/api-reference/v1/webhooks
 */
export const calcomNormalizer: WebhookNormalizer = {
  providerId: 'CAL_COM',

  identifyProvider(headers: Record<string, string>): boolean {
    return 'x-cal-signature-256' in headers;
  },

  verifySignature(payload: string, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      // Length mismatch means invalid
      return false;
    }
  },

  normalize(payload: unknown): NormalizedSchedulingEvent {
    const p = payload as CalComWebhookPayload;
    const attendee = p.payload?.attendees?.[0];

    return {
      externalEventId: String(p.payload?.bookingId ?? p.payload?.id ?? ''),
      status: mapCalComTrigger(p.triggerEvent),
      scheduledAt: p.payload?.startTime ?? '',
      meetingUrl: p.payload?.metadata?.videoCallUrl ?? undefined,
      candidateEmail: attendee?.email ?? '',
      candidateName: attendee?.name ?? undefined,
      providerData: p as unknown as Record<string, unknown>,
    };
  },
};

function mapCalComTrigger(
  trigger: string,
): 'SCHEDULED' | 'CANCELLED' | 'COMPLETED' {
  switch (trigger) {
    case 'BOOKING_CREATED':
      return 'SCHEDULED';
    case 'BOOKING_CANCELLED':
      return 'CANCELLED';
    case 'MEETING_ENDED':
      return 'COMPLETED';
    default:
      return 'SCHEDULED';
  }
}
