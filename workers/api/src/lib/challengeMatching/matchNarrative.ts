/**
 * Human-readable match explanation narrative formatter.
 *
 * Takes a structured MatchExplanation and produces recruiter-facing text
 * that explains why a candidate was matched (or not) to a PR challenge,
 * linking evidence and gaps back to exact source provenance.
 *
 * Acceptance criterion #6: explain every match with aligned evidence,
 * source links, and explicit gap/stretch reporting.
 */

import type {
  MatchExplanation,
  SourceRef,
  StretchArea,
  UnmatchedDemand,
} from './types';

export interface NarrativeSection {
  heading: string;
  body: string;
  sourceRefs: SourceRef[];
}

export interface MatchNarrative {
  title: string;
  verdict: string;
  sections: NarrativeSection[];
  plainText: string;
}

function formatSourceLocator(ref: SourceRef): string {
  if (ref.locator) return ref.locator;
  const offsetRange = `[${ref.startOffset}:${ref.endOffset}]`;
  return `${ref.artifactVersion}${offsetRange}`;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}

function formatEvidenceNarrative(
  explanation: MatchExplanation,
): NarrativeSection[] {
  const sections: NarrativeSection[] = [];

  const directEvidence = explanation.evidence.filter((e) => !e.stretch);
  const stretchEvidence = explanation.evidence.filter((e) => e.stretch);

  if (directEvidence.length > 0) {
    const lines = directEvidence.map((evidence) => {
      const firstCandidateRef = evidence.candidateSourceRefs[0] as SourceRef | undefined;
      const firstChallengeRef = evidence.challengeSourceRefs[0] as SourceRef | undefined;
      const candidateLoc = firstCandidateRef
        ? ` (source: ${formatSourceLocator(firstCandidateRef)})`
        : '';
      const challengeLoc = firstChallengeRef
        ? ` → code: ${formatSourceLocator(firstChallengeRef)}`
        : '';
      const scoreLabel = evidence.pairScore >= 0.8
        ? 'strong'
        : evidence.pairScore >= 0.5
          ? 'moderate'
          : 'partial';
      return `• ${scoreLabel} alignment (${(evidence.pairScore * 100).toFixed(0)}%)${candidateLoc}${challengeLoc}`;
    });

    sections.push({
      heading: 'Direct Evidence Alignments',
      body: lines.join('\n'),
      sourceRefs: directEvidence.flatMap((e) => [...e.candidateSourceRefs, ...e.challengeSourceRefs]),
    });
  }

  if (stretchEvidence.length > 0) {
    const lines = stretchEvidence.map((evidence) => {
      const stretch = evidence.stretch;
      if (!stretch) return '';
      return `• ${stretch.atomConcept} → ${stretch.demandConcept} (${stretch.dimension} adjacency)`;
    }).filter(Boolean);

    sections.push({
      heading: 'Stretch Alignments (Adjacent Skills)',
      body: lines.join('\n'),
      sourceRefs: stretchEvidence.flatMap((e) => [...e.candidateSourceRefs, ...e.challengeSourceRefs]),
    });
  }

  return sections;
}

function formatGapsSection(demands: UnmatchedDemand[]): NarrativeSection | null {
  if (demands.length === 0) return null;

  const roleRequired = demands.filter((d) => d.roleRequirement);
  const other = demands.filter((d) => !d.roleRequirement);

  const lines: string[] = [];
  if (roleRequired.length > 0) {
    lines.push('Role-required gaps:');
    for (const demand of roleRequired) {
      const concepts = demand.concepts.length > 0
        ? ` [${demand.concepts.slice(0, 3).join(', ')}]`
        : '';
      lines.push(`  • ${truncateText(demand.narrative, 120)}${concepts}`);
    }
  }
  if (other.length > 0) {
    if (roleRequired.length > 0) lines.push('');
    lines.push('Additional gaps:');
    for (const demand of other) {
      const concepts = demand.concepts.length > 0
        ? ` [${demand.concepts.slice(0, 3).join(', ')}]`
        : '';
      lines.push(`  • ${truncateText(demand.narrative, 120)}${concepts}`);
    }
  }

  return {
    heading: 'Evidence Gaps',
    body: lines.join('\n'),
    sourceRefs: demands.flatMap((d) => d.challengeSourceRefs),
  };
}

function formatStretchSection(areas: StretchArea[]): NarrativeSection | null {
  if (areas.length === 0) return null;

  const lines = areas.map((area) => {
    const candidateQuote = area.candidateSourceRefs[0]?.exactText
      ? ` "${truncateText(area.candidateSourceRefs[0].exactText, 60)}"`
      : '';
    return `• ${area.atomConcept} (candidate${candidateQuote}) covers adjacent ${area.demandConcept} via ${area.dimension}`;
  });

  return {
    heading: 'Stretch Areas',
    body: lines.join('\n'),
    sourceRefs: areas.flatMap((a) => [...a.candidateSourceRefs, ...a.challengeSourceRefs]),
  };
}

export function formatMatchNarrative(explanation: MatchExplanation): MatchNarrative {
  const title = explanation.status === 'MATCHED'
    ? `Match: PR #${explanation.prNumber} (score ${(explanation.score * 100).toFixed(0)}%)`
    : `No Match: PR #${explanation.prNumber}`;

  const directCount = explanation.evidence.filter((e) => !e.stretch).length;
  const stretchCount = explanation.stretchAreas.length;
  const gapCount = explanation.unmatchedDemands.length;

  let verdict: string;
  if (explanation.status === 'MATCHED') {
    const parts: string[] = [`${directCount} direct evidence alignment${directCount !== 1 ? 's' : ''}`];
    if (stretchCount > 0) parts.push(`${stretchCount} stretch area${stretchCount !== 1 ? 's' : ''}`);
    if (gapCount > 0) parts.push(`${gapCount} evidence gap${gapCount !== 1 ? 's' : ''}`);
    verdict = `Candidate matched with ${parts.join(', ')}.`;
  } else {
    verdict = `Challenge rejected: ${explanation.rejectionReasons.join(', ') || 'insufficient evidence alignment'}.`;
  }

  const sections: NarrativeSection[] = [];

  sections.push(...formatEvidenceNarrative(explanation));

  const gapsSection = formatGapsSection(explanation.unmatchedDemands);
  if (gapsSection) sections.push(gapsSection);

  const stretchSection = formatStretchSection(explanation.stretchAreas);
  if (stretchSection) sections.push(stretchSection);

  const plainText = [
    title,
    verdict,
    '',
    ...sections.map((s) => `## ${s.heading}\n${s.body}`),
  ].join('\n');

  return { title, verdict, sections, plainText };
}
