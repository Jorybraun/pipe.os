import type { MatchExplanation, SourceRef, RoleSourceReference, StretchMatch } from './types';

export interface NarrativeSection {
  heading: string;
  items: string[];
}

export interface MatchNarrative {
  title: string;
  verdict: string;
  sections: NarrativeSection[];
  plainText: string;
}

function alignmentStrength(pairScore: number): string {
  if (pairScore >= 0.8) return 'strong';
  if (pairScore >= 0.5) return 'moderate';
  return 'partial';
}

function formatSourceLocator(ref: SourceRef): string {
  if (ref.locator) return ref.locator;
  if (ref.exactText) {
    const truncated = ref.exactText.length > 80
      ? `${ref.exactText.slice(0, 77)}...`
      : ref.exactText;
    return `"${truncated}"`;
  }
  return `[${ref.artifactId}:${ref.startOffset}-${ref.endOffset}]`;
}

function formatRoleLocator(ref: RoleSourceReference): string {
  if (ref.locator) return ref.locator;
  if (ref.exactText) {
    const truncated = ref.exactText.length > 80
      ? `${ref.exactText.slice(0, 77)}...`
      : ref.exactText;
    return `"${truncated}"`;
  }
  return `[${ref.entityId}]`;
}

function stretchLabel(stretch: StretchMatch): string {
  return `${stretch.atomConcept} → ${stretch.demandConcept} (${stretch.dimension})`;
}

/**
 * Format a MatchExplanation into a recruiter-facing human-readable narrative.
 *
 * Classifies each alignment as strong (>=80%), moderate (>=50%), or partial (<50%).
 * Links to source locators. Separates role-required evidence gaps from other gaps.
 */
export function formatMatchNarrative(explanation: MatchExplanation): MatchNarrative {
  const prLabel = explanation.selectedPr
    ? `PR #${explanation.selectedPr.prNumber}`
    : explanation.prNumber
      ? `PR #${explanation.prNumber}`
      : 'unknown PR';

  const scorePercent = Math.round(explanation.score * 100);
  const title = explanation.status === 'MATCHED'
    ? `Match: ${prLabel} (score ${scorePercent}%)`
    : explanation.status === 'NEEDS_MORE_EVIDENCE'
      ? `Insufficient Evidence (${prLabel})`
      : 'No Suitable Challenge Found';

  const directCount = explanation.evidence.filter((e) => !e.stretch).length;
  const stretchCount = explanation.stretchAreas.length;
  const gapCount = explanation.missingEvidence.filter((m) => m.scope === 'candidate').length;
  const unmatchedCount = explanation.unmatchedDemandIds.length;

  const parts: string[] = [];
  if (directCount > 0) parts.push(`${directCount} direct evidence alignment${directCount !== 1 ? 's' : ''}`);
  if (stretchCount > 0) parts.push(`${stretchCount} stretch area${stretchCount !== 1 ? 's' : ''}`);
  if (gapCount > 0 || unmatchedCount > 0) {
    const totalGaps = gapCount + unmatchedCount;
    parts.push(`${totalGaps} evidence gap${totalGaps !== 1 ? 's' : ''}`);
  }

  const verdict = explanation.status === 'MATCHED'
    ? `Candidate matched with ${parts.join(', ')}.`
    : explanation.status === 'NEEDS_MORE_EVIDENCE'
      ? `Candidate has insufficient evidence. ${parts.join(', ')}.`
      : `No role-safe challenge found. ${explanation.rejectionReasons.join('; ')}`;

  const sections: NarrativeSection[] = [];

  // Direct evidence
  const directEvidence = explanation.evidence.filter((e) => !e.stretch);
  if (directEvidence.length > 0) {
    const items = directEvidence.map((e) => {
      const strength = alignmentStrength(e.pairScore);
      const firstCandidate = e.candidateSourceRefs[0];
      const candidateSource = firstCandidate
        ? ` — candidate: ${formatSourceLocator(firstCandidate)}`
        : '';
      const firstChallenge = e.challengeSourceRefs[0];
      const challengeSource = firstChallenge
        ? ` — challenge: ${formatSourceLocator(firstChallenge)}`
        : '';
      return `[${strength}] atom ${e.atomId} ↔ demand ${e.demandId} (${Math.round(e.pairScore * 100)}%)${candidateSource}${challengeSource}`;
    });
    sections.push({ heading: 'Direct Evidence', items });
  }

  // Stretch areas
  if (explanation.stretchAreas.length > 0) {
    const items = explanation.stretchAreas.map((s) => {
      const firstCandidate = s.candidateSourceRefs[0];
      const candidateSource = firstCandidate
        ? ` — candidate: ${formatSourceLocator(firstCandidate)}`
        : '';
      const firstChallenge = s.challengeSourceRefs[0];
      const challengeSource = firstChallenge
        ? ` — challenge: ${formatSourceLocator(firstChallenge)}`
        : '';
      return `${stretchLabel(s)}${candidateSource}${challengeSource}`;
    });
    sections.push({ heading: 'Stretch Areas', items });
  }

  // Evidence gaps
  const roleGaps = explanation.missingEvidence.filter((m) => m.scope === 'role');
  const candidateGaps = explanation.missingEvidence.filter((m) => m.scope === 'candidate');
  const otherGaps = explanation.missingEvidence.filter(
    (m) => m.scope !== 'role' && m.scope !== 'candidate',
  );

  const gapItems: string[] = [];
  for (const g of roleGaps) {
    gapItems.push(`[role-required] ${g.reason}`);
  }
  for (const g of candidateGaps) {
    gapItems.push(`[candidate] ${g.reason}`);
  }
  for (const g of otherGaps) {
    gapItems.push(`[${g.scope}] ${g.reason}`);
  }
  if (explanation.unmatchedDemandIds.length > 0) {
    gapItems.push(
      `${explanation.unmatchedDemandIds.length} unmatched PR demand${explanation.unmatchedDemandIds.length !== 1 ? 's' : ''}: ${explanation.unmatchedDemandIds.join(', ')}`,
    );
  }
  if (gapItems.length > 0) {
    sections.push({ heading: 'Evidence Gaps', items: gapItems });
  }

  // Build plain text
  const plainParts: string[] = [title, '', verdict];
  for (const section of sections) {
    plainParts.push('', `## ${section.heading}`);
    for (const item of section.items) {
      plainParts.push(`  - ${item}`);
    }
  }
  const plainText = plainParts.join('\n');

  return { title, verdict, sections, plainText };
}
