import type { FC } from 'react';
import type { SchedulingProviderConfig, SchedulingProviderDef } from './types';

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

export const CalComProvider: SchedulingProviderDef = {
  type:    'CAL_COM',
  label:   'Cal.com',
  Widget:  CalComWidget,
  matches: (url) => url.includes('cal.com'),
};
