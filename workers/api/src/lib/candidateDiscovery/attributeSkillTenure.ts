/**
 * Skill Tenure Attribution — compute per-skill years from experience date ranges.
 *
 * Reads active Experience and Skill nodes for a candidate, matches skills to
 * experiences by name mention, sums date ranges, and writes `years_attributed`
 * back to each Skill node's extracted_properties_json.
 *
 * Pure D1 arithmetic — no LLM calls.
 */

import type { CandidateNode } from '../../types';

export interface SkillTenureResult {
  skillsUpdated: number;
  errors: string[];
}

interface ExperienceDates {
  nodeId: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  narrativeText: string;
  extractedProperties: Record<string, unknown>;
}

interface SkillRecord {
  nodeId: string;
  canonicalSlug: string;
  originalName: string;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function parseDate(input: string | undefined): Date | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();

  // YYYY-MM
  const ym = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (ym) {
    const year = parseInt(ym[1]!, 10);
    const month = parseInt(ym[2]!, 10) - 1;
    if (month >= 0 && month <= 11) return new Date(year, month, 1);
  }

  // YYYY
  const y = trimmed.match(/^(\d{4})$/);
  if (y) return new Date(parseInt(y[1]!, 10), 0, 1);

  // Month YYYY
  const my = trimmed.match(/^([a-z]+)\s+(\d{4})$/);
  if (my) {
    const monthIdx = MONTH_NAMES[my[1]!];
    if (monthIdx !== undefined) {
      return new Date(parseInt(my[2]!, 10), monthIdx, 1);
    }
  }

  // MM/YYYY
  const slash = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const month = parseInt(slash[1]!, 10) - 1;
    const year = parseInt(slash[2]!, 10);
    if (month >= 0 && month <= 11) return new Date(year, month, 1);
  }

  return null;
}

function monthsBetween(start: Date, end: Date): number {
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function roundToQuarter(value: number): number {
  return Math.round(value * 4) / 4;
}

function extractExperiences(nodes: CandidateNode[]): ExperienceDates[] {
  return nodes
    .filter((n) => n.node_type === 'Experience')
    .map((n) => {
      const props = safeParseJson(n.extracted_properties_json) ?? {};
      return {
        nodeId: n.id,
        startDate: typeof props.startDate === 'string' ? props.startDate : undefined,
        endDate: typeof props.endDate === 'string' ? props.endDate : undefined,
        isCurrent: props.isCurrent === true,
        narrativeText: n.narrative_text,
        extractedProperties: props,
      };
    });
}

function extractSkills(nodes: CandidateNode[]): SkillRecord[] {
  return nodes
    .filter((n) => n.node_type === 'Skill')
    .map((n) => {
      const props = safeParseJson(n.extracted_properties_json) ?? {};
      return {
        nodeId: n.id,
        canonicalSlug: typeof props.canonical_slug === 'string' ? props.canonical_slug : n.narrative_text.toLowerCase().trim(),
        originalName: typeof props.name === 'string' ? props.name : n.narrative_text,
      };
    });
}

function safeParseJson(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Check if a skill is mentioned in an experience.
 * Matches canonical slug against narrative text, role, company, and skills_demonstrated list.
 */
function skillMentionedInExperience(skill: SkillRecord, exp: ExperienceDates): boolean {
  const searchText = [
    exp.narrativeText,
    typeof exp.extractedProperties.role === 'string' ? exp.extractedProperties.role : '',
    typeof exp.extractedProperties.company === 'string' ? exp.extractedProperties.company : '',
  ].join(' ').toLowerCase();

  const slug = skill.canonicalSlug.toLowerCase();
  const original = skill.originalName.toLowerCase();

  // Direct mention in narrative/role/company
  if (searchText.includes(slug) || searchText.includes(original)) return true;

  // Check skills_demonstrated array if present
  const demonstrated = exp.extractedProperties.skills_demonstrated;
  if (Array.isArray(demonstrated)) {
    for (const s of demonstrated) {
      if (typeof s === 'string' && (s.toLowerCase() === slug || s.toLowerCase() === original)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Compute duration in years for a single experience.
 */
function computeExperienceYears(exp: ExperienceDates): number | null {
  const start = parseDate(exp.startDate);
  if (!start) return null;

  const end = exp.isCurrent || !exp.endDate
    ? new Date()
    : parseDate(exp.endDate);
  if (!end) return null;

  const months = monthsBetween(start, end);
  if (months < 0) return null;

  return months / 12;
}

/**
 * Attribute experience durations to skills and persist back to D1.
 */
export async function attributeSkillTenure(
  db: D1Database,
  candidateId: string,
): Promise<SkillTenureResult> {
  const result: SkillTenureResult = { skillsUpdated: 0, errors: [] };

  // Load active Experience + Skill nodes
  let nodes: CandidateNode[];
  try {
    const rows = await db
      .prepare(
        `SELECT * FROM candidate_nodes
         WHERE candidate_id = ?1 AND superseded_at IS NULL
           AND node_type IN ('Experience', 'Skill')
         ORDER BY captured_at DESC`,
      )
      .bind(candidateId)
      .all<CandidateNode>();
    nodes = rows.results ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Failed to load nodes: ${msg}`);
    return result;
  }

  if (nodes.length === 0) return result;

  const experiences = extractExperiences(nodes);
  const skills = extractSkills(nodes);

  if (experiences.length === 0 || skills.length === 0) return result;

  // Pre-compute experience durations
  const experienceYears = new Map<string, number>();
  for (const exp of experiences) {
    const years = computeExperienceYears(exp);
    if (years !== null) {
      experienceYears.set(exp.nodeId, years);
    }
  }

  // Attribute durations to skills
  const skillTenure = new Map<string, { years: number; experienceIds: string[] }>();
  for (const skill of skills) {
    let totalYears = 0;
    const matchedIds: string[] = [];

    for (const exp of experiences) {
      if (skillMentionedInExperience(skill, exp)) {
        const years = experienceYears.get(exp.nodeId);
        if (years !== undefined) {
          totalYears += years;
          matchedIds.push(exp.nodeId);
        }
      }
    }

    skillTenure.set(skill.nodeId, {
      years: roundToQuarter(totalYears),
      experienceIds: matchedIds,
    });
  }

  // Persist back to D1
  for (const skill of skills) {
    const tenure = skillTenure.get(skill.nodeId);
    if (!tenure) continue;

    const props = safeParseJson(
      nodes.find((n) => n.id === skill.nodeId)?.extracted_properties_json ?? null,
    ) ?? {};

    const updatedProps = {
      ...props,
      years_attributed: tenure.years,
      attributed_experience_ids: tenure.experienceIds,
    };

    try {
      await db
        .prepare(
          `UPDATE candidate_nodes
           SET extracted_properties_json = ?1,
               updated_at = unixepoch()
           WHERE id = ?2`,
        )
        .bind(JSON.stringify(updatedProps), skill.nodeId)
        .run();
      result.skillsUpdated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to update skill ${skill.nodeId}: ${msg}`);
    }
  }

  return result;
}
