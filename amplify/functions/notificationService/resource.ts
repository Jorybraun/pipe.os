import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Notification Agent Lambda Function
 *
 * An adaptable communication engine that sends automated emails (SES)
 * and generates third-party scheduling links (Calendly/Cal.com)
 * based on candidate stage transitions.
 */
export const notificationService = defineFunction({
  name: 'notificationService',
  entry: './handler.ts',
  resourceGroupName: 'data',

  timeoutSeconds: 30,
  memoryMB: 512,

  environment: {
    WEBHOOK_ENABLED: 'true',
    SES_SENDER_EMAIL: secret('SES_SENDER_EMAIL'),
    APP_URL: secret('APP_URL'),
  },

  runtime: 22,
});
