import { defineFunction } from '@aws-amplify/backend';

/**
 * Scheduling Webhook Lambda Function
 *
 * Public-facing webhook receiver for Calendly and Cal.com callbacks.
 * Identifies the provider, verifies HMAC signature, normalizes the
 * payload, and updates the corresponding ScheduledInterview record.
 *
 * Flow:
 * 1. Identify provider from headers
 * 2. Look up SchedulingConnection for webhook secret
 * 3. Verify HMAC signature (crypto.timingSafeEqual)
 * 4. Normalize payload to NormalizedSchedulingEvent
 * 5. Find matching ScheduledInterview
 * 6. Validate transition via canTransition()
 * 7. Update record with syncSource: 'WEBHOOK'
 *
 * Environment Variables:
 * - WEBHOOK_ENABLED: Set to 'false' to disable processing (rollback switch)
 */
export const schedulingWebhook = defineFunction({
  name: 'schedulingWebhook',
  entry: './handler.ts',
  resourceGroupName: 'data',

  timeoutSeconds: 15,
  memoryMB: 256,

  environment: {
    WEBHOOK_ENABLED: 'true',
  },

  runtime: 22,
});
