import crypto from 'crypto';
import type {
  WebhookNormalizer,
  NormalizedSchedulingEvent,
  CalendlyWebhookPayload,
} from '../types';

/**
 * Calendly webhook normalizer.
 *
 * Handles `invitee.created` and `invitee.canceled` events from Calendly's
 * webhook API. Uses HMAC SHA-256 for signature verification.
 *
 * @see https://developer.calendly.com/api-docs/webhook-subscriptions
 */
export const calendlyNormalizer: WebhookNormalizer = {
  providerId: 'CALENDLY',

  identifyProvider(headers: Record<string, string>): boolean {
    return (
      'calendly-webhook-signature' in headers ||
      (headers['user-agent'] ?? '').includes('Calendly')
    );
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
    const p = payload as CalendlyWebhookPayload;
    const invitee =
      p.payload?.invitee ?? p.payload?.scheduled_event?.invitees?.[0];

    return {
      externalEventId:
        p.payload?.uri ?? p.payload?.scheduled_event?.uri ?? '',
      status: mapCalendlyEvent(p.event),
      scheduledAt: p.payload?.scheduled_event?.start_time ?? '',
      meetingUrl: p.payload?.scheduled_event?.location?.join_url ?? undefined,
      candidateEmail: invitee?.email ?? '',
      candidateName: invitee?.name ?? undefined,
      providerData: p as unknown as Record<string, unknown>,
    };
  },
};

function mapCalendlyEvent(
  event: string,
): 'SCHEDULED' | 'CANCELLED' | 'COMPLETED' {
  switch (event) {
    case 'invitee.created':
      return 'SCHEDULED';
    case 'invitee.canceled':
      return 'CANCELLED';
    default:
      return 'SCHEDULED';
  }
}
