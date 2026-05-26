/**
 * buildProfileSections — deterministic assembler for dynamic candidate profiles.
 *
 * Builds an ordered array of section descriptors from all available enrichment
 * data. No LLM call — fast, testable, predictable.
 */

import type { DecompositionResult } from './candidateDecompositionPrompt';
import type { CandidateDiscoveryResult } from './agent';
import type { ContributionCalendar } from '../enrichment/githubClient';

export interface ProfileSection {
  type: string;
  props: Record<string, unknown>;
}

export interface MatchData {
  score: number | null;
  dimensions?: {
    skillCoverage: number;
    semanticSimilarity: number;
    situationFit: number;
    roleAlignment: number;
  };
  reasoning?: {
    matches: string[];
    mismatches: string[];
  };
  philosophy?: string;
  repoName?: string;
  repoUrl?: string;
}

function deriveYears(experiences: Array<{ duration_months?: number }> | undefined): number | undefined {
  if (!experiences || experiences.length === 0) return undefined;
  const totalMonths = experiences.reduce((sum, e) => sum + (e.duration_months ?? 0), 0);
  return Math.max(0, Math.round((totalMonths / 12) * 10) / 10);
}

export function buildProfileSections(
  decomposition: DecompositionResult | null,
  discovery: CandidateDiscoveryResult | null,
  matchData: MatchData | null,
  githubCalendar: ContributionCalendar | null,
): ProfileSection[] {
  const sections: ProfileSection[] = [];

  // 1. Every candidate gets a hero
  sections.push({
    type: 'hero',
    props: {
      name: decomposition?.candidate_name,
      seniority: discovery?.keyConcepts.seniority,
      primaryLanguage: discovery?.keyConcepts.primary_language,
      yearsExperience: deriveYears(decomposition?.experiences),
      domain: discovery?.keyConcepts.detected_domain,
    },
  });

  // 2. Narrative if we have one
  if (discovery?.candidateSearchableProfile) {
    sections.push({
      type: 'narrative',
      props: {
        text: discovery.candidateSearchableProfile,
        keyConcepts: discovery.keyConcepts,
      },
    });
  }

  // 3. GitHub activity if enriched
  if (githubCalendar && githubCalendar.totalContributions > 0) {
    sections.push({
      type: 'github-activity',
      props: { calendar: githubCalendar },
    });
  }

  // 4. Experience timeline (only if 2+ experiences)
  if (decomposition?.experiences && decomposition.experiences.length >= 2) {
    sections.push({
      type: 'experience-timeline',
      props: { experiences: decomposition.experiences },
    });
  }

  // 5. Project showcase (only if projects exist)
  if (decomposition?.projects && decomposition.projects.length > 0) {
    sections.push({
      type: 'project-showcase',
      props: { projects: decomposition.projects },
    });
  }

  // 6. Skill landscape (only if skills exist)
  if (decomposition?.skills && decomposition.skills.length > 0) {
    sections.push({
      type: 'skill-landscape',
      props: { skills: decomposition.skills },
    });
  }

  // 7. Career arc (if available)
  if (decomposition?.career_arc) {
    sections.push({
      type: 'career-arc',
      props: decomposition.career_arc as unknown as Record<string, unknown>,
    });
  }

  // 8. Education (if available)
  if (decomposition?.education && decomposition.education.length > 0) {
    sections.push({
      type: 'education',
      props: { education: decomposition.education },
    });
  }

  // 9. Situation signature
  if (discovery?.situationSignature) {
    sections.push({
      type: 'situation-signature',
      props: discovery.situationSignature as unknown as Record<string, unknown>,
    });
  }

  // 10. Career context
  if (discovery?.careerContext) {
    sections.push({
      type: 'career-context',
      props: discovery.careerContext as unknown as Record<string, unknown>,
    });
  }

  // 11. Match score (only if matched)
  if (matchData?.score !== null && matchData?.score !== undefined) {
    sections.push({
      type: 'match-score',
      props: {
        score: matchData.score,
        dimensions: matchData.dimensions,
        reasoning: matchData.reasoning,
        philosophy: matchData.philosophy,
        repoName: matchData.repoName,
        repoUrl: matchData.repoUrl,
      },
    });
  }

  // 12. Enrichment status (metadata, always last)
  sections.push({
    type: 'enrichment-status',
    props: {
      status: discovery ? 'matched' : 'pending',
      modelUsed: discovery?.modelUsed,
      lastEnrichedAt: null,
      profileGeneratedAt: null,
      profileEmbeddedAt: null,
      matchedAt: null,
      errorText: null,
      enrichmentJobStatus: null,
      githubUrl: null,
    },
  });

  return sections;
}
