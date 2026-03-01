import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Scheduling OAuth Lambda Function
 *
 * Handles OAuth code exchange, token refresh, and event type discovery
 * for scheduling providers (Calendly, Cal.com).
 *
 * Actions:
 * - exchange: OAuth code → access_token + refresh_token → create SchedulingConnection → register webhook
 * - refresh: Check token expiry → refresh via provider API → update SchedulingConnection
 * - fetchEventTypes: Call provider API → return event type list
 * - disconnect: Revoke tokens → delete webhook subscription → update SchedulingConnection status
 *
 * Environment Variables:
 * - CALENDLY_CLIENT_ID / CALENDLY_CLIENT_SECRET: Calendly OAuth credentials (Secrets Manager)
 * - CALCOM_CLIENT_ID / CALCOM_CLIENT_SECRET: Cal.com OAuth credentials (Secrets Manager)
 */
export const schedulingOAuth = defineFunction({
  name: 'schedulingOAuth',
  entry: './handler.ts',

  timeoutSeconds: 30,
  memoryMB: 256,

  environment: {
    CALENDLY_CLIENT_ID: secret('CALENDLY_CLIENT_ID'),
    CALENDLY_CLIENT_SECRET: secret('CALENDLY_CLIENT_SECRET'),
    CALCOM_CLIENT_ID: secret('CALCOM_CLIENT_ID'),
    CALCOM_CLIENT_SECRET: secret('CALCOM_CLIENT_SECRET'),
  },

  runtime: 22,
});
