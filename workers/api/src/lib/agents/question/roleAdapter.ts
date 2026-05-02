/**
 * Role Context Adapter — Derive interviewee brief from baseline form data.
 *
 * No hardcoded role variants. The participant's context comes from the
 * initial form (baseline) and their declared role. This keeps role guidance
 * dynamic and accurate — if the user said "5-person React team", the brief
 * reflects that; it does not assume generic "tech company" context.
 *
 * Runs in <1ms. Deterministic. No LLM.
 */

import type { ParticipantRole } from '../../../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RoleBrief {
  /** 1-2 sentence description of who we're talking to. */
  description: string;
  /** What this person likely knows deeply. */
  strengths: string[];
  /** What to avoid asking this person. */
  avoid: string[];
  /** What to prioritize with this person. */
  prioritize: string[];
  /** Tone hint for the question writer. */
  tone: string;
}

// ─── Baseline extractors ─────────────────────────────────────────────────────

function extractTechStack(baseline: Record<string, unknown>): string[] {
  const ts = baseline.techStack;
  if (Array.isArray(ts)) return ts.filter((s): s is string => typeof s === 'string');
  if (typeof ts === 'string') return ts.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function extractCompany(baseline: Record<string, unknown>): string | undefined {
  if (typeof baseline.companyName === 'string' && baseline.companyName.trim()) {
    return baseline.companyName.trim();
  }
  if (typeof baseline.company === 'string' && baseline.company.trim()) {
    return baseline.company.trim();
  }
  return undefined;
}

function extractTeamSize(baseline: Record<string, unknown>): string | undefined {
  if (typeof baseline.teamSize === 'string') return baseline.teamSize;
  if (typeof baseline.teamSize === 'number') return String(baseline.teamSize);
  return undefined;
}

function extractRoleTitle(baseline: Record<string, unknown>): string | undefined {
  if (typeof baseline.title === 'string' && baseline.title.trim()) {
    return baseline.title.trim();
  }
  if (typeof baseline.roleTitle === 'string' && baseline.roleTitle.trim()) {
    return baseline.roleTitle.trim();
  }
  return undefined;
}

function extractSeniority(baseline: Record<string, unknown>): string | undefined {
  if (typeof baseline.seniority === 'string' && baseline.seniority.trim()) {
    return baseline.seniority.trim();
  }
  const title = extractRoleTitle(baseline);
  if (title) {
    const lower = title.toLowerCase();
    if (lower.includes('senior') || lower.includes('sr.')) return 'senior';
    if (lower.includes('staff') || lower.includes('principal')) return 'staff+';
    if (lower.includes('junior') || lower.includes('jr.')) return 'junior';
    if (lower.includes('mid')) return 'mid-level';
  }
  return undefined;
}

// ─── Role-specific templates ─────────────────────────────────────────────────

const ROLE_TEMPLATES: Record<
  ParticipantRole,
  {
    label: string;
    defaultStrengths: string[];
    defaultAvoid: string[];
    defaultPrioritize: string[];
    defaultTone: string;
  }
> = {
  HIRING_MANAGER: {
    label: 'Hiring Manager',
    defaultStrengths: ['Technical depth', 'Team context', 'Business priorities', 'Architecture decisions'],
    defaultAvoid: ['Recruiting process details', 'Compensation range', 'Generic market questions'],
    defaultPrioritize: ['Codebase & architecture', 'Day-to-day reality', 'Success/failure patterns', 'Hidden requirements (on-call, compliance)'],
    defaultTone: 'Direct and technical. They know the details — skip the preamble.',
  },
  INTERNAL_RECRUITER: {
    label: 'Internal Recruiter',
    defaultStrengths: ['Process knowledge', 'HM priorities', 'Past hire patterns', 'Candidate experience'],
    defaultAvoid: ['Deep technical architecture', 'Jargon without context', 'Code-level questions'],
    defaultPrioritize: ['What the HM emphasized', 'Process & constraints', 'Team dynamics from the outside', 'Past hires that worked out'],
    defaultTone: 'Professional and efficient. They coordinate — respect their time.',
  },
  EXTERNAL_RECRUITER: {
    label: 'External Recruiter',
    defaultStrengths: ['Market context', 'Client brief', 'Competitive landscape', 'Candidate pool'],
    defaultAvoid: ['Internal dynamics', 'Codebase details', 'Pushing back on vague answers'],
    defaultPrioritize: ['Client brief', 'Market context', 'Red flags from past submissions', 'Sell points'],
    defaultTone: 'Brief and focused. They are external — keep it to what matters for candidates.',
  },
  TEAM_MEMBER: {
    label: 'Team Member',
    defaultStrengths: ['Lived culture', 'Day-to-day reality', 'Collaboration patterns', 'What actually works'],
    defaultAvoid: ['Hiring process', 'Compensation', 'Org strategy', 'Abstract "team needs"'],
    defaultPrioritize: ['Their lived experience', 'Culture & collaboration', 'What surprised them', 'Who thrives / who struggles'],
    defaultTone: 'Warm and peer-to-peer. Ask about THEIR experience, not the role abstractly.',
  },
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a RoleBrief from baseline data + participant role.
 *
 * The baseline is the source of truth for facts (company, team size, tech).
 * The participant role determines what to prioritize and avoid.
 */
export function buildRoleBrief(
  baseline: Record<string, unknown>,
  participantRole: ParticipantRole | null,
): RoleBrief {
  const template = participantRole ? ROLE_TEMPLATES[participantRole] : undefined;
  const company = extractCompany(baseline);
  const title = extractRoleTitle(baseline);
  const seniority = extractSeniority(baseline);
  const techStack = extractTechStack(baseline);
  const teamSize = extractTeamSize(baseline);

  // Build the description sentence from baseline facts
  const descriptionParts: string[] = [];
  if (template) {
    descriptionParts.push(`You're talking to a ${template.label}`);
  } else {
    descriptionParts.push("You're talking to a participant");
  }

  const contextParts: string[] = [];
  if (company) contextParts.push(`at ${company}`);
  if (title) contextParts.push(`about a ${seniority ? seniority + ' ' : ''}${title} role`);
  if (teamSize) contextParts.push(`on a ${teamSize}-person team`);
  if (techStack.length > 0) contextParts.push(`using ${techStack.join(', ')}`);

  if (contextParts.length > 0) {
    descriptionParts.push(contextParts.join(', ') + '.');
  } else {
    descriptionParts.push('.');
  }

  // Add a second sentence about what they know
  if (template) {
    if (participantRole === 'HIRING_MANAGER') {
      descriptionParts.push('They know the codebase, architecture, and what "done" looks like.');
    } else if (participantRole === 'TEAM_MEMBER') {
      descriptionParts.push('They have ground-truth on culture, collaboration, and day-to-day reality.');
    } else if (participantRole === 'INTERNAL_RECRUITER') {
      descriptionParts.push('They know the hiring process, HM priorities, and what has worked before.');
    } else if (participantRole === 'EXTERNAL_RECRUITER') {
      descriptionParts.push('They know the client brief and market context.');
    }
  }

  return {
    description: descriptionParts.join(' '),
    strengths: template?.defaultStrengths ?? ['General perspective'],
    avoid: template?.defaultAvoid ?? [],
    prioritize: template?.defaultPrioritize ?? ['General context'],
    tone: template?.defaultTone ?? 'Warm and conversational.',
  };
}

/**
 * Build a concise role instruction block for injection into the user prompt.
 */
export function buildRoleInstruction(
  baseline: Record<string, unknown>,
  participantRole: ParticipantRole | null,
): string {
  const brief = buildRoleBrief(baseline, participantRole);
  const lines: string[] = [];

  lines.push('## Interviewee Context');
  lines.push(brief.description);
  lines.push('');
  lines.push(`Tone: ${brief.tone}`);
  lines.push(`Prioritize: ${brief.prioritize.join('; ')}`);
  if (brief.avoid.length > 0) {
    lines.push(`Avoid: ${brief.avoid.join('; ')}`);
  }

  return lines.join('\n');
}
