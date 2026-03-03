import { useEffect, type FC } from 'react';
import type { SchedulingProviderConfig, SchedulingProviderDef } from './types';
import type { SchedulingPlugin, SchedulingWidgetProps } from '../../../lib/scheduling/pluginRegistry';

/**
 * Cal.com OAuth client ID — injected via environment variable.
 * Only needed on the client side for generating the authorization URL.
 * The client secret stays server-side in the Lambda.
 */
const CALCOM_CLIENT_ID = import.meta.env['VITE_CALCOM_CLIENT_ID'] as string | undefined;

/**
 * Cal.com inline embed via their iframe approach.
 *
 * TODO: Cal.com also offers a JS embed library (@calcom/embed-react).
 * For MVP we use a plain iframe; swap to the npm package before production
 * for better UX (no page chrome, theme matching).
 * https://cal.com/docs/embedding/embed-snippet-libraries/react
 */
const CalComWidget: FC<SchedulingProviderConfig> = ({
  schedulingUrl,
  candidateName,
  candidateEmail,
}) => {
  const params = new URLSearchParams();
  if (candidateName)  params.set('name',  candidateName);
  if (candidateEmail) params.set('email', candidateEmail);
  const embedUrl = `${schedulingUrl}?${params.toString()}`;

  return (
    <iframe
      src={embedUrl}
      style={{ width: '100%', height: 700, border: 'none' }}
      title="Schedule interview"
    />
  );
};

/**
 * Enhanced Cal.com widget that supports the onBookingComplete callback.
 * Listens for Cal.com's postMessage event when a booking is completed.
 */
const CalComPluginWidget: FC<SchedulingWidgetProps> = ({
  schedulingUrl,
  candidateName,
  candidateEmail,
  onBookingComplete,
}) => {
  useEffect(() => {
    if (!onBookingComplete) return;

    // Cal.com sends a postMessage when a booking is confirmed
    const handleMessage = (event: MessageEvent): void => {
      if (
        event.origin === 'https://app.cal.com' &&
        event.data?.type === 'booking_created'
      ) {
        const payload = event.data?.data;
        const externalEventId = String(payload?.id ?? '');
        const scheduledAt = payload?.startTime ?? new Date().toISOString();
        onBookingComplete(externalEventId, scheduledAt);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onBookingComplete]);

  // Delegate to the base widget for rendering
  return (
    <CalComWidget
      schedulingUrl={schedulingUrl}
      candidateName={candidateName}
      candidateEmail={candidateEmail}
    />
  );
};

/** Legacy SchedulingProviderDef — used by existing code paths */
export const CalComProvider: SchedulingProviderDef = {
  type:    'CAL_COM',
  label:   'Cal.com',
  Widget:  CalComWidget,
  matches: (url) => url.includes('cal.com'),
};

/** IoC plugin — extends SchedulingProviderDef with OAuth and booking callback */
export const CalComPlugin: SchedulingPlugin = {
  type:    'CAL_COM',
  label:   'Cal.com',
  Widget:  CalComPluginWidget,
  matches: (url) => url.includes('cal.com'),

  getAuthUrl(redirectUri: string, state: string): string {
    const clientId = CALCOM_CLIENT_ID ?? '';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `https://app.cal.com/auth/oauth2/authorize?${params.toString()}`;
  },
};
