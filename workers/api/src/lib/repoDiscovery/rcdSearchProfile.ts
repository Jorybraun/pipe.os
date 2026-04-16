import type { RoleContextDocument } from '../../types.js';

/**
 * Build a 400–600 word narrative describing a role, suitable for embedding
 * into Vectorize REPO_INDEX. Pairs with `repo_searchable_profile` written at
 * Pass 3 — the two are compared via cosine similarity in `discover`'s hybrid
 * recall path (STRATEGY Decision Log 2026-04-14).
 *
 * Allow-list of RCD fields is explicit:
 *   - technical_context (stack, constructs, seniority_band, codebase_expectations)
 *   - domain_matrix[*].summary (dedup'd, one line per stakeholder × domain)
 *   - Top 3 stories (one per stakeholder, first by source order)
 *   - bars_overrides[*].override_anchor_text
 *
 * Explicitly excluded:
 *   - laddering_chains (stakeholder-specific; high noise when vectorised)
 *   - probe_bank_enrichment (not discriminative)
 *   - dealbreakers / red_flags (applied as filters downstream, not recall)
 */
export function buildRcdSearchProfile(rcd: RoleContextDocument): string {
  const sections: string[] = [];

  // Opening: who this role is for.
  const tc = rcd.technical_context;
  const stackText = tc.stack.length ? tc.stack.join(', ') : 'an unspecified stack';
  const constructsText = tc.constructs.length
    ? tc.constructs.slice(0, 8).join(', ')
    : 'no specific engineering constructs';
  sections.push(
    `This role is for a ${tc.seniority_band} engineer. ` +
      `The team works with ${stackText}. ` +
      `The work pattern is characterised by engineering constructs such as ${constructsText}.`,
  );

  // Codebase expectations (free text — keep up to 5).
  if (tc.codebase_expectations.length > 0) {
    sections.push(
      `Expectations of the codebase: ${tc.codebase_expectations.slice(0, 5).join('; ')}.`,
    );
  }

  // Domain matrix summaries (dedup'd by text).
  const summaries = new Set<string>();
  for (const stakeholderKey of Object.keys(rcd.domain_matrix)) {
    const cells = (rcd.domain_matrix as Record<string, Record<string, { summary?: string }>>)[stakeholderKey];
    if (!cells) continue;
    for (const cell of Object.values(cells)) {
      if (cell?.summary && cell.summary.trim().length > 0) {
        summaries.add(cell.summary.trim());
      }
    }
  }
  if (summaries.size > 0) {
    sections.push(
      `Domain context: ${[...summaries].slice(0, 8).join(' ')}`,
    );
  }

  // Top 3 stories — one per stakeholder.
  const stories: string[] = [];
  const seenStakeholders = new Set<string>();
  for (const stakeholderKey of Object.keys(rcd.domain_matrix)) {
    if (stories.length >= 3 || seenStakeholders.has(stakeholderKey)) continue;
    const cells = (rcd.domain_matrix as Record<string, Record<string, {
      stories?: Array<{ situation: string; action: string; outcome: string; moral: string }>;
    }>>)[stakeholderKey];
    if (!cells) continue;
    for (const cell of Object.values(cells)) {
      if (cell?.stories && cell.stories.length > 0) {
        const s = cell.stories[0]!;
        stories.push(
          `Illustrative situation: ${s.situation} The team's response: ${s.action} Outcome: ${s.outcome} What it reveals: ${s.moral}`,
        );
        seenStakeholders.add(stakeholderKey);
        break;
      }
    }
  }
  if (stories.length > 0) {
    sections.push(stories.join(' '));
  }

  // BARS overrides — one line per dimension (override text is already phrased as prose).
  if (rcd.bars_overrides.length > 0) {
    const anchors = rcd.bars_overrides
      .slice(0, 6)
      .map((b) => `${b.dimension}: ${b.override_anchor_text.trim()}`)
      .join(' ');
    sections.push(`Team-specific performance anchors. ${anchors}`);
  }

  // Coerce into 400–600 words. Pad with a stack-centric closer if too short;
  // truncate at sentence boundary if too long. Keeps the embedding stable
  // even when RCD is sparse (short interview) or very dense.
  const combined = sections.join('\n\n');
  const words = combined.trim().split(/\s+/);

  if (words.length >= 400 && words.length <= 600) return combined;

  if (words.length < 400) {
    const closer =
      `In summary, the ideal contributor is comfortable navigating ${stackText}, ` +
      `operates at the ${tc.seniority_band} band, and brings experience with ${constructsText}. ` +
      `They are expected to handle work consistent with the codebase expectations above and ` +
      `the team-specific anchors listed, while engaging with the domain context described earlier. ` +
      `Strong candidates exhibit pragmatism about trade-offs, clarity in review discussions, ` +
      `and ownership of outcomes beyond narrowly-scoped tickets. ` +
      `They translate between product intent and technical reality without losing either side of the conversation.`;
    const padded = `${combined}\n\n${closer}`;
    const paddedWords = padded.trim().split(/\s+/);
    if (paddedWords.length >= 400) {
      return paddedWords.slice(0, 600).join(' ');
    }
    // Still short after padding — repeat stack-centric sentence variants until we hit 400.
    let result = padded;
    while (result.split(/\s+/).length < 400) {
      result += ` The team relies on ${stackText} daily. Engineering culture centers on ${constructsText}.`;
    }
    return result.split(/\s+/).slice(0, 600).join(' ');
  }

  // Too long — truncate at the last full sentence under the 600-word cap.
  const truncated = words.slice(0, 600).join(' ');
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?'),
  );
  return lastSentenceEnd > 0 ? truncated.slice(0, lastSentenceEnd + 1) : truncated;
}
