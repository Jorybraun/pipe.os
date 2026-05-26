/**
 * GithubActivitySection — contribution grid + total + sparkline.
 */

import { Github } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../../';
import { ContributionCalendar } from '../ContributionCalendar';
import type { ContributionCalendar as ContributionCalendarType } from '../../../lib/api/types';

interface GithubActivitySectionProps {
  props: {
    calendar: ContributionCalendarType;
  };
}

export function GithubActivitySection({ props }: GithubActivitySectionProps): JSX.Element {
  const { calendar } = props;

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Github size={14} color="var(--pipe-text-dim)" />
          <SubTitle>GITHUB ACTIVITY</SubTitle>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: '#10b981',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          {calendar.totalContributions.toLocaleString()} contributions
        </span>
      </div>
      <ContributionCalendar calendar={calendar} />
    </LiquidMetalCard>
  );
}
