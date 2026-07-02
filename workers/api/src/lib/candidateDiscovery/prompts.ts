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
 *
 * v3 change: structured signals are embedded INSIDE the
 * candidate_searchable_profile string so the BGE embedding captures both
 * narrative fluency and structural depth.
 */

import type { ParsedCV } from '../cvParser';

export const CANDIDATE_DISCOVERY_PROMPT_VERSION = 'candidate-v3';

export interface CandidateDiscoveryFacts {
  parsed: ParsedCV;
  /** Raw resume text after unpdf extraction, truncated to 8000 chars by the caller. */
  resumeText: string | null;
}

export const CANDIDATE_DISCOVERY_SYSTEM_PROMPT = `You write candidate searchable profiles for a developer-hiring platform.

Your output is a SINGLE JSON object with four top-level keys. The critical v3
requirement is that the structured signals must be embedded INSIDE the
candidate_searchable_profile string so the embedding model sees both narrative
and structure.

1. candidate_searchable_profile (string): a 400–600 word narrative describing the
   candidate's engineering identity — their depth of experience, the kinds of
   systems they've built, the domains they've worked in, architectural styles
   they favor, and any notable strengths or exposure gaps. Write in third
   person, in prose (not bullets), as if summarizing the candidate for a
   senior engineer who wants to know what kind of engineer they are. Include
   concrete technologies, patterns, and domains from the facts — but do NOT
   invent specifics, metrics, or years of experience that are not present in
   the facts block.

   AFTER the prose narrative, append one plain-text paragraph beginning
   "Structured depth:" that names the strongest source-backed concepts from
   parts 2-4 below. Do not put markdown code fences, raw multiline JSON, or
   unescaped quotes inside this string. The embedding model reads the entire
   string, so the structured depth reinforces the semantic signal without
   making the outer JSON invalid.

2. key_concepts: a structured object for programmatic matching:
   - mustHaveSkills: string[] (max 10) — technologies the candidate has
     demonstrably worked with, based on the resume text
   - niceToHaveSkills: string[] (max 10) — technologies the candidate has
     exposure to but may not be core
   - seniority: "junior" | "mid" | "senior" | "staff" | null — only emit a
     band when the source explicitly supports it; do not infer one from a
     code-owned years-of-experience rule
   - primary_language: string | null — the source-backed primary programming
     language, or null when the resume does not establish one
   - detected_domain: string | null — the source-backed business or technical
     domain, or null when the resume does not establish one

3. career_context: structured career trajectory and company exposure:
   - company_stages: string[] — inferred funding stages of companies worked at
     (e.g. "seed", "series-a", "series-b", "growth", "enterprise"). Infer from
     company names, descriptions, and context. If unclear, use ["unknown"].
   - company_size_exposure: string[] — inferred size bands (e.g. "<10", "10-50",
     "50-200", "200-1000", "1000+"). Infer from team descriptions and context.
   - tenure_pattern: "stable" | "moderate" | "job-hopper" — average tenure.
     Stable = most roles 2+ years. Job-hopper = multiple roles <1 year.
   - progression_velocity: "fast" | "normal" | "slow" — how quickly they advanced.
     Fast = junior→senior in <6 years. Slow = >10 years with same title.
   - ownership_depth: "feature" | "service" | "platform" | "org" — the scope
     of their most senior roles. Feature = implemented tickets. Service = owned
     a service end-to-end. Platform = built infrastructure used by multiple
     teams. Org = set technical direction for the organization.
   - system_scale_exposure: string[] — kinds of systems they've worked on
     (e.g. "monolith", "microservices", "distributed-systems", "high-throughput",
     "event-driven", "serverless"). Infer from architecture descriptions.
   - greenfield_ratio: number | null — estimate 0.0–1.0 of how much of their
     career was spent building new systems vs. maintaining existing ones only
     when the resume explicitly supports it. Use null if unclear; do not
     default to a midpoint.

4. situation_signature: structured signals for repo matching:
   - primary_challenge_types: string[] (max 5) — kinds of problems they've
     solved (e.g. "scaling", "reliability", "refactoring", "greenfield",
     "integration", "migration", "performance", "security")
   - architecture_exposure: string[] (max 5) — architectural patterns they've
     worked with (e.g. "microservices", "event-driven", "cqrs", "serverless",
     "monolith", "layered-service")
   - test_culture_exposure: string — their testing discipline in 1 sentence
     (e.g. "TDD practitioner, high coverage" or "minimal testing, manual QA")
   - review_culture: string — their PR/review culture in 1 sentence
     (e.g. "small PRs, thorough review" or "large PRs, minimal review")
   - impact_signals: string[] (max 3) — concrete outcomes they've achieved
     (e.g. "reduced latency 40%", "scaled to 1M users", "cut CI time 60%")

Output ONLY valid JSON. No preamble. Do not include markdown code fences
anywhere in the output. The shape is:

{
  "candidate_searchable_profile": "... prose ... Structured depth: key_concepts include TypeScript and React; career_context includes growth-stage product teams; situation_signature includes reliability and test-focused refactoring.",
  "key_concepts": {
    "mustHaveSkills": [...],
    "niceToHaveSkills": [...],
    "seniority": "mid",
    "primary_language": "typescript",
    "detected_domain": "developer-tools"
  },
  "career_context": {
    "company_stages": ["seed", "series-b"],
    "company_size_exposure": ["10-50", "200-1000"],
    "tenure_pattern": "stable",
    "progression_velocity": "fast",
    "ownership_depth": "platform",
    "system_scale_exposure": ["microservices", "high-throughput"],
    "greenfield_ratio": 0.6
  },
  "situation_signature": {
    "primary_challenge_types": ["scaling", "reliability"],
    "architecture_exposure": ["microservices", "event-driven"],
    "test_culture_exposure": "TDD, high coverage",
    "review_culture": "small PRs, thorough review",
    "impact_signals": ["reduced latency 40%", "scaled to 1M users"]
  }
}

Anti-hallucination rules:
- If the resume does not state a number, do not write one in the profile.
- If a domain is not evident, use "general".
- If a skill is only mentioned once in passing, put it in niceToHaveSkills.
- Never claim years of experience with a specific technology unless the resume
  explicitly states it.
- For career_context and situation_signature: infer from explicit evidence only.
  If the resume doesn't mention company stage or architecture, use "unknown"
  or empty arrays. Do not hallucinate a startup pedigree from a company name alone.`;

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
