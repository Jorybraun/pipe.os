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

    // Calendly sends: t=<timestamp>,v1=<hex_signature>
    // HMAC is computed over: <timestamp>.<body>
    const parts = signature.split(',');
    const tPart = parts.find((p) => p.startsWith('t='));
    const v1Part = parts.find((p) => p.startsWith('v1='));

    if (!tPart || !v1Part) {
      // Fallback: treat entire signature as raw hex (for testing)
      const expected = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      } catch {
        return false;
      }
    }

    const timestamp = tPart.slice(2);
    const receivedSig = v1Part.slice(3);
    const data = `${timestamp}.${payload}`;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(receivedSig), Buffer.from(expected));
    } catch {
      return false;
    }
  },

  normalize(payload: unknown): NormalizedSchedulingEvent {
    const p = payload as CalendlyWebhookPayload;

    // Calendly invitee.created / invitee.canceled: the invitee IS the payload
    // — email/name are directly on p.payload, not nested under p.payload.invitee
    const candidateEmail =
      p.payload?.email ??
      p.payload?.invitee?.email ??
      p.payload?.scheduled_event?.invitees?.[0]?.email ??
      '';
    const candidateName =
      p.payload?.name ??
      p.payload?.invitee?.name ??
      p.payload?.scheduled_event?.invitees?.[0]?.name ??
      undefined;

    // Use the scheduled_event URI as the canonical externalEventId
    // (the invitee URI is per-invitee, not per-event)
    const externalEventId =
      p.payload?.scheduled_event?.uri ?? p.payload?.uri ?? '';

    console.log('[calendlyNormalizer] Extracted fields', {
      candidateEmail,
      candidateName,
      externalEventId,
      event: p.event,
      payloadKeys: Object.keys(p.payload ?? {}),
    });

    return {
      externalEventId,
      status: mapCalendlyEvent(p.event),
      scheduledAt: p.payload?.scheduled_event?.start_time ?? '',
      meetingUrl: p.payload?.scheduled_event?.location?.join_url ?? undefined,
      candidateEmail,
      candidateName,
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
