/**
 * Build a searchable profile from the role's job description + persona.
 * Used by both the role context routes and the backfill script.
 */
export function buildRoleSearchableProfile(
  jobDescription: string,
  persona: unknown,
): string {
  if (jobDescription && jobDescription.trim().length >= 200) {
    // Strip markdown headings for density, keep the rest
    return jobDescription.replace(/^#{1,6}\s+/gm, '').trim();
  }
  // Fallback: synthesise from persona
  const parts: string[] = [];
  const p = persona as Record<string, unknown> | null;
  if (p) {
    const seniority = typeof p.seniority === 'string' ? p.seniority : '';
    const archetype = typeof p.archetype === 'string' ? p.archetype : '';
    const mustHave = Array.isArray(p.mustHaveSkills) ? p.mustHaveSkills.join(', ') : '';
    const niceToHave = Array.isArray(p.niceToHaveSkills) ? p.niceToHaveSkills.join(', ') : '';
    if (seniority) parts.push(`This role is for a ${seniority} engineer.`);
    if (archetype) parts.push(`Archetype: ${archetype}.`);
    if (mustHave) parts.push(`Must-have skills: ${mustHave}.`);
    if (niceToHave) parts.push(`Nice-to-have skills: ${niceToHave}.`);
  }
  return parts.join(' ');
}
