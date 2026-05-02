/**
 * Culture Interview — Context Assembler.
 *
 * Builds the `GenerativePlannerContext` consumed by the generative turn planner.
 * Queries:
 *   - `candidate_ingestion` for structured candidate background (experiences,
 *     projects, skills, career context, situation signatures)
 *   - `culture_interview_sessions` for prior Mode-1 screening transcripts
 *   - `role_contexts` for RCD-derived team stories, conflicts, dealbreakers,
 *     culture profile, and BARS overrides
 *
 * When `candidate_nodes` exists (future migration), this module will prefer
 * graph nodes over the ingestion JSON blobs. Until then, ingestion JSON is
 * the richest structured source.
 *
 * All lookups are defensive — any miss yields a safe empty value so the
 * interview never blocks on a data gap.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type {
  GenerativePlannerContext,
  PriorScreeningSummary,
} from './cultureGenerativePlanner';
import type { CompetencyDimension } from './cultureQuestionBank';
import { COMPETENCY_DIMENSIONS, CULTURE_BANK_SIZE } from './cultureQuestionBank';
import type { CultureTranscript } from './cultureAgent';
import { defaultCultureTranscript } from './cultureAgent';
import type { CultureTeamContext } from './cultureRoleResolution';

// ─── Public API ──────────────────────────────────────────────────────────────

export interface BuildContextInput {
  db: D1Database;
  candidateId: string;
  assessmentId: string;
  mode: 'profile_builder' | 'role_fit';
  transcript: CultureTranscript;
  teamContext: CultureTeamContext | null;
}

export async function buildCultureInterviewContext(
  input: BuildContextInput,
): Promise<GenerativePlannerContext> {
  const [candidateBackground, priorScreening] = await Promise.all([
    loadCandidateBackground(input.db, input.candidateId),
    input.mode === 'role_fit'
      ? loadPriorScreening(input.db, input.candidateId, input.assessmentId)
      : Promise.resolve(null),
  ]);

  const roleContext = buildRoleContext(input.teamContext);

  return {
    mode: input.mode,
    candidate: candidateBackground,
    role: roleContext,
    coverage: { ...input.transcript.scratchpad.dimensionCoverage },
    turnsUsed: distinctQuestionsAsked(input.transcript),
    priorQuestions: input.transcript.turns
      .filter((t) => t.probeOf === null)
      .map((t) => t.questionText),
    runningThemes: [...input.transcript.scratchpad.runningThemes],
    maxQuestions: CULTURE_BANK_SIZE,
    minQuestions: 5,
  };
}

// ─── Candidate background loader ─────────────────────────────────────────────

interface CandidateBackground {
  experiences: Array<{ company: string; role: string; durationMonths: number; highlights: string[] }>;
  projects: Array<{ name: string; description: string; technologies: string[] }>;
  skills: string[];
  priorScreening: PriorScreeningSummary | null;
}

interface CandidateIngestionRow {
  candidate_searchable_profile: string | null;
  career_context_json: string | null;
  situation_signature_json: string | null;
  key_concepts_json: string | null;
}

interface CandidateRow {
  skills: string | null;
  years_of_experience: number | null;
  current_role: string | null;
}

async function loadCandidateBackground(
  db: D1Database,
  candidateId: string,
): Promise<CandidateBackground> {
  const experiences: CandidateBackground['experiences'] = [];
  const projects: CandidateBackground['projects'] = [];
  const skills: string[] = [];

  try {
    // 1. Load ingestion JSON (richest structured source)
    const ingestion = await db
      .prepare(
        `SELECT candidate_searchable_profile, career_context_json,
                situation_signature_json, key_concepts_json
         FROM candidate_ingestion
         WHERE candidate_id = ?1`,
      )
      .bind(candidateId)
      .first<CandidateIngestionRow>();

    if (ingestion?.candidate_searchable_profile) {
      // The searchable profile is a free-text narrative — scan for company
      // mentions and project names as highlights.
      const profileText = ingestion.candidate_searchable_profile;
      const firstPara = profileText.split('\n')[0] ?? profileText;
      if (firstPara.length > 0) {
        experiences.push({
          company: 'Previous role',
          role: 'Engineer',
          durationMonths: 0,
          highlights: [firstPara.slice(0, 200)],
        });
      }
    }

    if (ingestion?.career_context_json) {
      try {
        const career = JSON.parse(ingestion.career_context_json) as {
          company_stages?: string[];
          company_size_exposure?: string[];
          ownership_depth?: string;
          system_scale_exposure?: string[];
        };
        if (career.company_stages?.length || career.company_size_exposure?.length) {
          experiences.push({
            company: career.company_stages?.join(', ') ?? 'Various',
            role: career.ownership_depth ?? 'Engineer',
            durationMonths: 0,
            highlights: [
              `Exposure to: ${career.company_size_exposure?.join(', ') ?? 'varied environments'}`,
            ],
          });
        }
      } catch {
        // ignore parse errors
      }
    }

    if (ingestion?.situation_signature_json) {
      try {
        const sig = JSON.parse(ingestion.situation_signature_json) as {
          primary_challenge_types?: string[];
          architecture_exposure?: string[];
          impact_signals?: string[];
        };
        if (sig.primary_challenge_types?.length || sig.impact_signals?.length) {
          projects.push({
            name: 'Key work areas',
            description: `Challenges: ${sig.primary_challenge_types?.join(', ') ?? 'various'}. ` +
              `Impact: ${sig.impact_signals?.join(', ') ?? 'varied'}`,
            technologies: sig.architecture_exposure ?? [],
          });
        }
      } catch {
        // ignore parse errors
      }
    }

    if (ingestion?.key_concepts_json) {
      try {
        const concepts = JSON.parse(ingestion.key_concepts_json) as {
          mustHaveSkills?: string[];
          niceToHaveSkills?: string[];
        };
        skills.push(...(concepts.mustHaveSkills ?? []));
        skills.push(...(concepts.niceToHaveSkills ?? []));
      } catch {
        // ignore parse errors
      }
    }

    // 2. Fallback to flat candidates row for skills + current role
    const candidateRow = await db
      .prepare('SELECT skills, years_of_experience, current_role FROM candidates WHERE id = ?1')
      .bind(candidateId)
      .first<CandidateRow>();

    if (candidateRow?.skills) {
      const flatSkills = candidateRow.skills.split(',').map((s) => s.trim()).filter(Boolean);
      for (const s of flatSkills) {
        if (!skills.includes(s)) skills.push(s);
      }
    }

    if (candidateRow?.current_role && experiences.length === 0) {
      experiences.push({
        company: 'Current employer',
        role: candidateRow.current_role,
        durationMonths: (candidateRow.years_of_experience ?? 0) * 12,
        highlights: ['Current role from candidate profile'],
      });
    }
  } catch (err) {
    console.error('[buildCultureInterviewContext] candidate background load failed:', {
      candidateId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Deduplicate skills
  const uniqueSkills = [...new Set(skills.map((s) => s.toLowerCase()))];

  return {
    experiences: experiences.slice(0, 5),
    projects: projects.slice(0, 5),
    skills: uniqueSkills.slice(0, 20),
    priorScreening: null,
  };
}

// ─── Prior screening loader ──────────────────────────────────────────────────

async function loadPriorScreening(
  db: D1Database,
  candidateId: string,
  currentAssessmentId: string,
): Promise<PriorScreeningSummary | null> {
  try {
    // Find the most recent completed Mode-1 screening for this candidate
    // that is NOT the current assessment.
    const row = await db
      .prepare(
        `SELECT transcript
         FROM culture_interview_sessions
         WHERE candidate_id = ?1
           AND assessment_id != ?2
           AND state = 'complete'
         ORDER BY completed_at DESC
         LIMIT 1`,
      )
      .bind(candidateId, currentAssessmentId)
      .first<{ transcript: string }>();

    if (!row?.transcript) return null;

    const transcript: CultureTranscript = JSON.parse(row.transcript) as CultureTranscript;
    const coverage = transcript.scratchpad.dimensionCoverage;

    const coveredDimensions: CompetencyDimension[] = [];
    const thinDimensions: CompetencyDimension[] = [];
    for (const dim of COMPETENCY_DIMENSIONS) {
      const count = coverage[dim] ?? 0;
      if (count >= 1) coveredDimensions.push(dim);
      else thinDimensions.push(dim);
    }

    // Extract a few key quotes from the most substantive answers
    const keyQuotes: string[] = [];
    for (const turn of transcript.turns) {
      if (turn.candidateResponse && turn.candidateResponse.length > 100) {
        const quote = turn.candidateResponse.slice(0, 200).replace(/\n/g, ' ');
        keyQuotes.push(quote);
        if (keyQuotes.length >= 3) break;
      }
    }

    return { coveredDimensions, thinDimensions, keyQuotes };
  } catch (err) {
    console.error('[buildCultureInterviewContext] prior screening load failed:', {
      candidateId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Role context builder ────────────────────────────────────────────────────

function buildRoleContext(teamContext: CultureTeamContext | null): GenerativePlannerContext['role'] {
  if (!teamContext) {
    return {
      teamStories: [],
      conflicts: [],
      dealbreakers: [],
      cultureProfile: {},
      barsOverrides: [],
    };
  }

  const teamStories = extractTeamStories(teamContext);
  const conflicts = extractConflicts(teamContext);
  const dealbreakers = teamContext.dealbreakers.map((d) => ({
    pattern: d.pattern,
    jobRelatednessNote: d.job_relatedness_note,
  }));

  // Derive a simple 5-dimension culture profile from the RCD's CVF-style data
  const cultureProfile: Record<string, number> = {};
  if (teamContext.teamCultureProfile.aggregated) {
    const agg = teamContext.teamCultureProfile.aggregated;
    cultureProfile.clan = agg.clan_affinity ?? 3;
    cultureProfile.adhocracy = agg.adhocracy_affinity ?? 3;
    cultureProfile.market = agg.market_affinity ?? 3;
    cultureProfile.hierarchy = agg.hierarchy_affinity ?? 3;
    cultureProfile.psychologicalSafety = agg.psychological_safety ?? 3;
  }

  const barsOverrides = teamContext.barsOverrides.map((o) => ({
    dimension: o.dimension,
    anchorLevel: o.anchor_level,
    overrideAnchorText: o.override_anchor_text,
  }));

  return { teamStories, conflicts, dealbreakers, cultureProfile, barsOverrides };
}

function extractTeamStories(teamContext: CultureTeamContext): Array<{ domain: string; narrative: string; archetype: string }> {
  const stories: Array<{ domain: string; narrative: string; archetype: string }> = [];
  const hm = teamContext.teamDomainCells.hiringManager;
  const tm = teamContext.teamDomainCells.teamMember;

  for (const cell of [hm, tm]) {
    if (!cell?.stories) continue;
    for (const story of cell.stories) {
      const narrative = [story.situation, story.action, story.outcome].filter(Boolean).join(' ');
      if (narrative) {
        stories.push({
          domain: 'team',
          narrative: narrative.slice(0, 300),
          archetype: story.moral ? story.moral.slice(0, 100) : 'general',
        });
      }
    }
  }

  return stories.slice(0, 5);
}

function extractConflicts(teamContext: CultureTeamContext): Array<{ topic: string; resolution: string }> {
  // Conflicts are not directly on CultureTeamContext today — they live on the
  // RCD but are not exposed through the resolution module. When they are,
  // wire them here. For now, return empty.
  return [];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function distinctQuestionsAsked(t: CultureTranscript): number {
  const ids = new Set<string>();
  for (const turn of t.turns) {
    if (turn.probeOf === null) ids.add(turn.questionId);
  }
  return ids.size;
}
