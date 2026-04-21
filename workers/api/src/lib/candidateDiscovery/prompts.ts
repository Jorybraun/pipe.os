/**
 * Candidate Discovery agent prompts.
 *
 * Mirror of the repo searchable-profile generation pattern in pass3 (Gemma
 * writes a 400–600 word engineering narrative + structured key concepts from
 * a FACTS-only block). Here the FACTS come from the parsed CV + raw resume
 * text, and the output is a candidate-side profile that embeds symmetrically
 * into the same BGE-large-en-v1.5 vector space as repo_searchable_profile.
 *
 * Output discipline: the narrative is a NARRATIVE, not a bullet list — it
 * reads like a paragraph a senior engineer might write describing another
 * engineer. The `key_concepts_json` block is the structured handle the
 * downstream match engine (matchReposForCandidate) consumes. No numeric
 * estimation unless the resume explicitly states a number (same anti-
 * hallucination rule as repo_searchable_profile).
 */

import type { ParsedCV } from '../cvParser';

export const CANDIDATE_DISCOVERY_PROMPT_VERSION = 'candidate-v1';

export interface CandidateDiscoveryFacts {
  parsed: ParsedCV;
  /** Raw resume text after unpdf extraction, truncated to 8000 chars by the caller. */
  resumeText: string | null;
}

export const CANDIDATE_DISCOVERY_SYSTEM_PROMPT = `You write candidate searchable profiles for a developer-hiring platform.

Your output has two parts, both wrapped in a SINGLE JSON object:

1. candidate_searchable_profile (string): a 400–600 word narrative describing the
   candidate's engineering identity — their depth of experience, the kinds of
   systems they've built, the domains they've worked in, architectural styles
   they favor, and any notable strengths or exposure gaps. Write in third
   person, in prose (not bullets), as if summarizing the candidate for a
   senior engineer who wants to know what kind of engineer they are. Include
   concrete technologies, patterns, and domains from the facts — but do NOT
   invent specifics, metrics, or years of experience that are not present in
   the facts block.

2. key_concepts: a structured object for programmatic matching:
   - mustHaveSkills: string[] (max 10) — technologies the candidate has
     demonstrably worked with, based on the resume text
   - niceToHaveSkills: string[] (max 10) — technologies the candidate has
     exposure to but may not be core
   - seniority: "junior" | "mid" | "senior" | "staff" — map from years of
     experience and role titles: junior (0–2 years), mid (3–5), senior (6–9),
     staff (10+ or explicit staff/principal/lead titles)
   - primary_language: string — the programming language the candidate uses
     most or most recently (lowercase, e.g. "typescript", "go")
   - detected_domain: string — the business/technical domain most evident
     from the resume (e.g. "fintech", "developer-tools", "healthcare", "ecommerce",
     "infrastructure", "ml-platform", "general" if unclear)

Output ONLY valid JSON. No preamble. No markdown fences. The shape is:

{
  "candidate_searchable_profile": "...",
  "key_concepts": {
    "mustHaveSkills": [...],
    "niceToHaveSkills": [...],
    "seniority": "mid",
    "primary_language": "typescript",
    "detected_domain": "developer-tools"
  }
}

Anti-hallucination rules:
- If the resume does not state a number, do not write one in the profile.
- If a domain is not evident, use "general".
- If a skill is only mentioned once in passing, put it in niceToHaveSkills.
- Never claim years of experience with a specific technology unless the resume
  explicitly states it.`;

export function buildCandidateDiscoveryUserMessage(facts: CandidateDiscoveryFacts): string {
  const { parsed, resumeText } = facts;
  const blocks: string[] = [];

  blocks.push('PARSED CV FACTS:');
  blocks.push(`Name: ${parsed.name ?? '(unknown)'}`);
  blocks.push(`Years of experience: ${parsed.yearsOfExperience ?? '(not stated)'}`);
  blocks.push(`Current role: ${parsed.currentRole ?? '(not stated)'}`);
  blocks.push(`Skills (parser-extracted): ${parsed.skills?.join(', ') || '(none)'}`);
  blocks.push(`Education: ${parsed.education?.join(' | ') || '(none)'}`);

  if (resumeText && resumeText.trim().length > 0) {
    blocks.push('');
    blocks.push('RAW RESUME TEXT (truncated):');
    blocks.push(resumeText.slice(0, 8000));
  }

  return blocks.join('\n');
}
