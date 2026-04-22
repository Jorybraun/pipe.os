/**
 * Deterministic job-description derivation from an RCD.
 *
 * Converts the structured Role Context Document into a candidate-facing
 * Markdown job description. No LLM call — pure derivation from domain_matrix,
 * technical_context, and consumer_slice so the output is reproducible.
 */

import type { RoleContextDocument } from '../../types';

export function deriveJobDescriptionFromRcd(rcd: RoleContextDocument): string {
  const { consumer_slice, technical_context, domain_matrix } = rcd;

  // Title — from consumer_slice archetype or fall back to generic
  const title = consumer_slice.archetype !== 'Not specified'
    ? consumer_slice.archetype.split(' — ')[0] ?? 'Engineering Role'
    : 'Engineering Role';

  // Company summary — opportunistically lifted from work domain if available
  const workCell = domain_matrix.HIRING_MANAGER?.work ?? domain_matrix.TEAM_MEMBER?.work;
  const companySummary = workCell?.summary ?? 'We are building something ambitious and looking for great people to join us.';

  // Role overview — from work + bar
  const barCell = domain_matrix.HIRING_MANAGER?.bar;
  const roleOverview = [
    workCell?.summary,
    barCell?.summary,
  ].filter((s): s is string => typeof s === 'string' && s.length > 0).join(' ');

  // Responsibilities — from work stories + technical_context constructs
  const responsibilities: string[] = [];
  const workStories = workCell?.stories ?? [];
  for (const story of workStories.slice(0, 3)) {
    if (story.moral) responsibilities.push(story.moral);
  }
  if (responsibilities.length === 0) {
    responsibilities.push('Ship features end-to-end in collaboration with the product and design teams.');
    responsibilities.push('Own technical decisions within your domain of expertise.');
    responsibilities.push('Participate in code review and help raise the team\'s engineering standards.');
  }

  // Must-haves — consumer_slice.mustHaveSkills
  const mustHaves = consumer_slice.mustHaveSkills.length > 0
    ? consumer_slice.mustHaveSkills
    : technical_context.stack.length > 0
      ? technical_context.stack.map((s) => `Proficiency with ${s}`)
      : ['Relevant professional experience in a similar role.'];

  // Nice-to-haves — consumer_slice.niceToHaveSkills
  const niceToHaves = consumer_slice.niceToHaveSkills.length > 0
    ? consumer_slice.niceToHaveSkills
    : [];

  // Compensation — opportunistic; we don't invent numbers
  const compSection = '';

  // Culture / team — from team domain
  const teamCell = domain_matrix.TEAM_MEMBER?.team ?? domain_matrix.HIRING_MANAGER?.team;
  const teamSummary = teamCell?.summary ?? '';

  // Build Markdown
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(companySummary);
  lines.push('');

  if (roleOverview) {
    lines.push('## The Role');
    lines.push('');
    lines.push(roleOverview);
    lines.push('');
  }

  lines.push('## What You\'ll Do');
  lines.push('');
  for (const r of responsibilities) {
    lines.push(`- ${r}`);
  }
  lines.push('');

  lines.push('## What You Bring');
  lines.push('');
  for (const m of mustHaves) {
    lines.push(`- ${m}`);
  }
  lines.push('');

  if (niceToHaves.length > 0) {
    lines.push('## Bonus Points');
    lines.push('');
    for (const n of niceToHaves) {
      lines.push(`- ${n}`);
    }
    lines.push('');
  }

  if (teamSummary) {
    lines.push('## The Team');
    lines.push('');
    lines.push(teamSummary);
    lines.push('');
  }

  if (compSection) {
    lines.push('## Compensation & Benefits');
    lines.push('');
    lines.push(compSection);
    lines.push('');
  }

  lines.push('## How to Apply');
  lines.push('');
  lines.push('Hit apply — we\'ll be in touch within a few days. No cover letter needed.');

  return lines.join('\n');
}
