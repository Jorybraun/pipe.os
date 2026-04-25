/**
 * Twilio phone provider — registers the Twilio plugin.
 *
 * For MVP: platform-level credentials (Worker secrets).
 * Future: per-recruiter Twilio sub-accounts or Twilio Connect.
 */

import type { PhonePlugin } from '../../../lib/phone/pluginRegistry';

export const TwilioPlugin: PhonePlugin = {
  type: 'TWILIO',
  label: 'Twilio',
  requiresOAuth: false,
};
