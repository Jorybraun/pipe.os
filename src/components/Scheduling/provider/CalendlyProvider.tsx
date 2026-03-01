import { useEffect, type FC } from 'react';
import type { SchedulingProviderConfig, SchedulingProviderDef } from './types';
import type { SchedulingPlugin, SchedulingWidgetProps } from '../../../lib/scheduling/pluginRegistry';

// TODO: Calendly does not offer a first-party npm package for the inline widget.
// We load their script lazily here. Before production, verify the script URL
// is still current at https://developer.calendly.com/api-docs/embed-widget
const CALENDLY_SCRIPT_SRC = 'https://asset.calendly.com/assets/external/widget.js';
const CALENDLY_CSS_HREF   = 'https://asset.calendly.com/assets/external/widget.css';

/**
 * Calendly OAuth client ID — injected via environment variable.
 * Only needed on the client side for generating the authorization URL.
 * The client secret stays server-side in the Lambda.
 */
const CALENDLY_CLIENT_ID = import.meta.env['VITE_CALENDLY_CLIENT_ID'] as string | undefined;

/**
 * Injects the Calendly embed script + stylesheet exactly once per page load,
 * then renders the inline widget div that Calendly targets.
 *
 * TODO: Content-Security-Policy — the production CSP must allow:
 *   script-src https://asset.calendly.com
 *   frame-src  https://calendly.com
 * Add these to amplify/hosting/customHeaders.json before go-live.
 */
const CalendlyWidget: FC<SchedulingProviderConfig> = ({
  schedulingUrl,
  candidateName,
  candidateEmail,
}) => {
  useEffect(() => {
    // Inject CSS once
    if (!document.querySelector(`link[href="${CALENDLY_CSS_HREF}"]`)) {
      const link = document.createElement('link');
      link.rel  = 'stylesheet';
      link.href = CALENDLY_CSS_HREF;
      document.head.appendChild(link);
    }

    // Inject script once
    if (!document.querySelector(`script[src="${CALENDLY_SCRIPT_SRC}"]`)) {
      const script = document.createElement('script');
      script.src   = CALENDLY_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  // Build prefill query params
  const params = new URLSearchParams();
  if (candidateName)  params.set('name',  candidateName);
  if (candidateEmail) params.set('email', candidateEmail);
  const embedUrl = `${schedulingUrl}?${params.toString()}`;

  return (
    <div
      className="calendly-inline-widget"
      data-url={embedUrl}
      style={{ minWidth: 320, height: 700 }}
    />
  );
};

/**
 * Enhanced Calendly widget that supports the onBookingComplete callback.
 * Listens for Calendly's postMessage event when a booking is completed.
 */
const CalendlyPluginWidget: FC<SchedulingWidgetProps> = ({
  schedulingUrl,
  candidateName,
  candidateEmail,
  onBookingComplete,
}) => {
  useEffect(() => {
    if (!onBookingComplete) return;

    // Calendly sends a postMessage when a booking is completed
    const handleMessage = (event: MessageEvent): void => {
      if (
        event.origin === 'https://calendly.com' &&
        event.data?.event === 'calendly.event_scheduled'
      ) {
        const payload = event.data?.payload;
        const externalEventId = payload?.event?.uri ?? '';
        const scheduledAt = payload?.event?.start_time ?? new Date().toISOString();
        onBookingComplete(externalEventId, scheduledAt);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onBookingComplete]);

  // Delegate to the base widget for rendering
  return (
    <CalendlyWidget
      schedulingUrl={schedulingUrl}
      candidateName={candidateName}
      candidateEmail={candidateEmail}
    />
  );
};

/** Legacy SchedulingProviderDef — used by existing code paths */
export const CalendlyProvider: SchedulingProviderDef = {
  type:    'CALENDLY',
  label:   'Calendly',
  Widget:  CalendlyWidget,
  matches: (url) => url.includes('calendly.com'),
};

/** IoC plugin — extends SchedulingProviderDef with OAuth and booking callback */
export const CalendlyPlugin: SchedulingPlugin = {
  type:    'CALENDLY',
  label:   'Calendly',
  Widget:  CalendlyPluginWidget,
  matches: (url) => url.includes('calendly.com'),

  getAuthUrl(redirectUri: string, state: string): string {
    const clientId = CALENDLY_CLIENT_ID ?? '';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `https://auth.calendly.com/oauth/authorize?${params.toString()}`;
  },
};
