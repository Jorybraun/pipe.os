/**
 * CandidateEnrichmentTab — dynamic profile renderer.
 *
 * Receives an ordered array of ProfileSection descriptors from the backend
 * and renders each via a component registry. Replaces the old hardcoded
 * 4-card layout with a data-driven approach.
 */

import type { ProfileSection } from '../../lib/api/types';
import {
  HeroSection,
  NarrativeSection,
  ExperienceTimelineSection,
  ProjectShowcaseSection,
  SkillLandscapeSection,
  CareerArcSection,
  EducationSection,
  SituationSignatureSection,
  CareerContextSection,
  MatchScoreSection,
  EnrichmentStatusSection,
  GithubActivitySection,
} from './profile-sections';

interface IngestionRetryResult {
  scanned: number;
  queued: number;
  skipped: number;
  failed: number;
}

const sectionRegistry: Record<string, React.FC<{ props: unknown }>> = {
  hero: HeroSection as React.FC<{ props: unknown }>,
  narrative: NarrativeSection as React.FC<{ props: unknown }>,
  'experience-timeline': ExperienceTimelineSection as React.FC<{ props: unknown }>,
  'project-showcase': ProjectShowcaseSection as React.FC<{ props: unknown }>,
  'skill-landscape': SkillLandscapeSection as React.FC<{ props: unknown }>,
  'career-arc': CareerArcSection as React.FC<{ props: unknown }>,
  education: EducationSection as React.FC<{ props: unknown }>,
  'situation-signature': SituationSignatureSection as React.FC<{ props: unknown }>,
  'career-context': CareerContextSection as React.FC<{ props: unknown }>,
  'match-score': MatchScoreSection as React.FC<{ props: unknown }>,
  'enrichment-status': EnrichmentStatusSection as React.FC<{ props: unknown }>,
  'github-activity': GithubActivitySection as React.FC<{ props: unknown }>,
};

interface CandidateEnrichmentTabProps {
  sections: ProfileSection[];
  onRetryFailedIngestion?: (() => Promise<void>) | undefined;
  isRetryingIngestion?: boolean | undefined;
  retryIngestionError?: string | null | undefined;
  retryIngestionResult?: IngestionRetryResult | null | undefined;
}

type EnrichmentStatusProps = Parameters<typeof EnrichmentStatusSection>[0]['props'];

export function CandidateEnrichmentTab({
  sections,
  onRetryFailedIngestion,
  isRetryingIngestion,
  retryIngestionError,
  retryIngestionResult,
}: CandidateEnrichmentTabProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {sections.map((section, i) => {
        if (section.type === 'enrichment-status') {
          return (
            <EnrichmentStatusSection
              key={`${section.type}-${i}`}
              props={section.props as EnrichmentStatusProps}
              onRetryFailedIngestion={onRetryFailedIngestion}
              isRetryingIngestion={isRetryingIngestion}
              retryIngestionError={retryIngestionError}
              retryIngestionResult={retryIngestionResult}
            />
          );
        }

        const Component = sectionRegistry[section.type];
        if (!Component) {
          console.warn(`Unknown profile section type: ${section.type}`);
          return null;
        }
        return <Component key={`${section.type}-${i}`} props={section.props} />;
      })}
    </div>
  );
}
