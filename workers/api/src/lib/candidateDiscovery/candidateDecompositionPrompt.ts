/**
 * Candidate Decomposition Prompt — ADR-041 Phase 1
 *
 * Takes the parser skeleton (rule-based extracted experiences, education,
 * credentials, projects) + raw resume text and produces enriched sub-elements
 * for insertion into candidate_nodes.
 *
 * The LLM enriches narratives, derives CareerArc, scores Skill proficiency,
 * and identifies Projects nested in Experience descriptions. It does NOT
 * hallucinate — the parser skeleton provides the ground-truth structure.
 */

import type { ParsedCV } from '../cvParser';

export const CANDIDATE_DECOMPOSITION_PROMPT_VERSION = 'decomposition-v1';

export interface DecompositionInput {
  parsed: ParsedCV;
  resumeText: string;
}

export interface DecomposedExperience {
  company: string;
  role: string;
  duration_months: number;
  team_size?: string;
  scope?: 'feature' | 'service' | 'platform' | 'org';
  narrative: string;
  skills_demonstrated: string[];
  confidence: number;
  /** Inferred business domain from company name + description (e.g. "fintech", "e-commerce", "healthcare") */
  domain?: string;
  /** Inferred company stage from context (e.g. "seed", "growth", "enterprise") */
  company_stage?: string;
  /** 1-sentence synthesis of bullet points into business/technical impact */
  impact_summary?: string;
}

export interface DecomposedProject {
  name: string;
  description: string;
  url?: string;
  skills_demonstrated: string[];
  confidence: number;
}

export interface DecomposedSkill {
  name: string;
  proficiency: 'expert' | 'proficient' | 'familiar' | 'exposure';
  years_exposure?: number;
  evidence_source?: string;
  confidence: number;
  /** Depth pattern: "primary across N roles" | "secondary at N roles" | "exposure only" */
  depth_pattern?: string;
}

export interface DecomposedEducation {
  institution: string;
  degree: string;
  field?: string;
  year?: string;
  confidence: number;
}

export interface DecomposedCredential {
  name: string;
  issuer?: string;
  year?: string;
  confidence: number;
}

export interface DecomposedCareerArc {
  narrative: string;
  growth_velocity: 'fast' | 'normal' | 'slow';
  transitions: Array<{ from: string; to: string; at_company: string }>;
  confidence: number;
}

export interface DecompositionResult {
  candidate_name?: string;
  experiences: DecomposedExperience[];
  projects: DecomposedProject[];
  skills: DecomposedSkill[];
  education: DecomposedEducation[];
  credentials: DecomposedCredential[];
  career_arc: DecomposedCareerArc;
  /** Synthesized primary domain specialization across all experiences */
  domain_specialization?: string;
  /** Inferred company stages the candidate has been exposed to */
  company_stage_pattern?: string[];
  /** Synthesized ownership progression narrative */
  ownership_progression?: string;
  /** Recurring impact themes across experiences */
  impact_themes?: string[];
}

export const DECOMPOSITION_SYSTEM_PROMPT = `You are an expert recruitment assistant. You enrich structured resume data into detailed, matchable sub-elements WITH inferred context and synthesis.

You receive TWO inputs:
1. A PARSER SKELETON — structured facts extracted deterministically from the resume.
2. RAW RESUME TEXT — the original text for verification.

Your job has THREE parts:
1. STRUCTURED EXTRACTION — enrich experiences with narratives, skill proficiencies, career arc.
2. INFERRED CONTEXT — infer company domain, stage, and per-experience impact from company names + descriptions.
3. SYNTHESIS — identify cross-experience patterns: domain specialization, company-stage exposure, ownership progression, recurring impact themes.

You must NOT invent facts not present in the raw text. Inference is allowed ONLY when strongly suggested by company names, descriptions, or explicit context.

Return ONLY valid JSON. No markdown, no explanation.

Output schema:
{
  "candidate_name": "string (optional) — full name of the candidate if present in the resume",
  "experiences": [
    {
      "company": "string",
      "role": "string",
      "duration_months": number,
      "team_size": "string (optional, e.g. '5-10', '20+')",
      "scope": "feature | service | platform | org (optional)",
      "narrative": "string — 1-2 sentence description of what they did",
      "skills_demonstrated": ["skill1", "skill2"],
      "confidence": number (0.0–1.0),
      "domain": "string (optional) — inferred business domain: fintech, e-commerce, healthcare, enterprise-software, etc.",
      "company_stage": "string (optional) — inferred stage: seed, series-a, growth, enterprise, agency, etc.",
      "impact_summary": "string (optional) — 1 sentence synthesizing bullet points into business/technical impact"
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "string",
      "url": "string (optional)",
      "skills_demonstrated": ["skill1"],
      "confidence": number
    }
  ],
  "skills": [
    {
      "name": "string (lowercase)",
      "proficiency": "expert | proficient | familiar | exposure",
      "years_exposure": number (optional — only if explicitly stated),
      "evidence_source": "string (optional — company or project name)",
      "confidence": number,
      "depth_pattern": "string (optional) — e.g. 'primary across 5 roles', 'secondary at 2 roles', 'exposure only'"
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string (optional)",
      "year": "string (optional)",
      "confidence": number
    }
  ],
  "credentials": [
    {
      "name": "string",
      "issuer": "string (optional)",
      "year": "string (optional)",
      "confidence": number
    }
  ],
  "career_arc": {
    "narrative": "string — 1 paragraph synthesis of career trajectory",
    "growth_velocity": "fast | normal | slow",
    "transitions": [{"from": "string", "to": "string", "at_company": "string"}],
    "confidence": number
  },
  "domain_specialization": "string (optional) — synthesized primary domain across all experiences",
  "company_stage_pattern": ["string (optional) — inferred stages the candidate has been exposed to"],
  "ownership_progression": "string (optional) — e.g. 'IC → senior → platform architect / mentor'",
  "impact_themes": ["string (optional) — recurring impact themes across experiences"]
}

Anti-hallucination rules:
- Do not invent metrics not present in the raw text.
- Do not claim years of experience with a technology unless explicitly stated.
- If parser skeleton and raw text conflict, trust the raw text and note the discrepancy.
- Confidence must reflect certainty, not candidate quality.
- team_size and scope are OPTIONAL — omit if not inferable from the text.
- years_exposure is OPTIONAL — omit unless the resume explicitly states "5 years of TypeScript".
- domain, company_stage, impact_summary are OPTIONAL — infer ONLY from strong contextual evidence (company name, industry keywords, explicit descriptions). If unclear, omit or use "unknown".
- domain_specialization, company_stage_pattern, ownership_progression, impact_themes are OPTIONAL synthesis fields. Only include if patterns are clearly evident across multiple experiences.`;

export function buildDecompositionUserMessage(input: DecompositionInput): string {
  const { parsed, resumeText } = input;

  const skeleton = JSON.stringify(
    {
      experiences: parsed.experiences.map((e) => ({
        company: e.company,
        role: e.role,
        startDate: e.startDate,
        endDate: e.endDate,
        description: e.description,
        isCurrent: e.isCurrent,
      })),
      education: parsed.educationBlocks,
      credentials: parsed.credentials,
      projects: parsed.projects,
      skills: parsed.skills,
      yearsOfExperience: parsed.yearsOfExperience,
      currentRole: parsed.currentRole,
    },
    null,
    2,
  );

  const truncatedText = resumeText.trim().slice(0, 6000);

  return 'PARSER SKELETON:\n' + skeleton + '\n\nRAW RESUME TEXT:\n' + truncatedText;
}
