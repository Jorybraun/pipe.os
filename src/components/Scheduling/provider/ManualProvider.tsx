import type { FC } from 'react';
import type { SchedulingProviderConfig, SchedulingProviderDef } from './types';

/**
 * Fallback for scheduling URLs that don't match a known provider.
 * Opens the link in a new tab — no embed.
 */
const ManualWidget: FC<SchedulingProviderConfig> = ({ schedulingUrl, candidateName: _candidateName }) => (
  <div
    style={{
      padding: 32,
      textAlign: 'center',
      background: 'var(--pipe-surface)',
      border: '1px solid var(--pipe-border)',
      borderRadius: 8,
    }}
  >
    <p style={{ color: 'var(--pipe-text-muted)', fontSize: 14, marginBottom: 24, fontFamily: '"Space Mono", monospace' }}>
      Your recruiter has provided a scheduling link. Click below to choose a time.
    </p>
    <a
      href={schedulingUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-block',
        padding: '12px 28px',
        background: 'var(--pipe-surface-hover)',
        border: '1px solid var(--pipe-border)',
        color: 'var(--pipe-text, #fff)',
        fontSize: 11,
        letterSpacing: '0.15em',
        fontFamily: '"Space Mono", monospace',
        textDecoration: 'none',
        cursor: 'pointer',
      }}
    >
      OPEN SCHEDULING PAGE →
    </a>
    {/* TODO: After the candidate books via the external link there's no
        confirmation back to Pipe. To close this loop, add a Calendly/Cal.com
        webhook or polling mechanism that updates ScheduledInterview.status to
        SCHEDULED automatically. For MVP the recruiter updates status manually. */}
    <p style={{ marginTop: 20, fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
      Once you've selected a time, your recruiter will confirm the appointment.
    </p>
  </div>
);

export const ManualProvider: SchedulingProviderDef = {
  type:    'MANUAL',
  label:   'Manual',
  Widget:  ManualWidget,
  // Matches everything — used as fallback
  matches: (_url) => true,
};
