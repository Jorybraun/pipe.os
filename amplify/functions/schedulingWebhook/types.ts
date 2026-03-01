/**
 * Normalized interview event from any provider.
 * This is the internal representation after webhook payload normalization.
 */
export interface NormalizedSchedulingEvent {
  externalEventId: string;
  status: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED';
  scheduledAt: string;         // ISO 8601
  meetingUrl?: string;
  candidateEmail: string;
  candidateName?: string;
  providerData: Record<string, unknown>;
}

/**
 * Each scheduling provider implements this normalizer for webhook processing.
 */
export interface WebhookNormalizer {
  providerId: 'CALENDLY' | 'CAL_COM';

  /** Verify webhook signature — returns true if valid */
  verifySignature: (payload: string, signature: string, secret: string) => boolean;

  /** Returns true if this normalizer handles the given headers */
  identifyProvider: (headers: Record<string, string>) => boolean;

  /** Convert raw webhook payload to normalized event */
  normalize: (payload: unknown) => NormalizedSchedulingEvent;
}

// ─── Calendly types ──────────────────────────────────────────────────────

export interface CalendlyWebhookPayload {
  event: string;
  payload: {
    uri?: string;
    invitee?: { email: string; name?: string };
    scheduled_event?: {
      uri?: string;
      start_time?: string;
      location?: { join_url?: string };
      invitees?: Array<{ email: string; name?: string }>;
    };
  };
}

// ─── Cal.com types ───────────────────────────────────────────────────────

export interface CalComWebhookPayload {
  triggerEvent: string;
  payload: {
    id?: number;
    bookingId?: number;
    startTime?: string;
    metadata?: { videoCallUrl?: string };
    attendees?: Array<{ email: string; name?: string }>;
  };
}
