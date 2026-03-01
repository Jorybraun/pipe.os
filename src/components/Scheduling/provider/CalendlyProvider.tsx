import { useEffect, type FC } from 'react';
import type { SchedulingProviderConfig, SchedulingProviderDef } from './types';

// TODO: Calendly does not offer a first-party npm package for the inline widget.
// We load their script lazily here. Before production, verify the script URL
// is still current at https://developer.calendly.com/api-docs/embed-widget
const CALENDLY_SCRIPT_SRC = 'https://asset.calendly.com/assets/external/widget.js';
const CALENDLY_CSS_HREF   = 'https://asset.calendly.com/assets/external/widget.css';

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

export const CalendlyProvider: SchedulingProviderDef = {
  type:    'CALENDLY',
  label:   'Calendly',
  Widget:  CalendlyWidget,
  matches: (url) => url.includes('calendly.com'),
};
