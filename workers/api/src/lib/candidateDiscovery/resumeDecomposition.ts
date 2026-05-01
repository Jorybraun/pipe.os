/**
 * Resume Decomposition — ADR-041 Phase 1
 *
 * Turns a resume into typed candidate_nodes (Experience, Project, Skill, Education,
 * Credential, CareerArc). Receives a pre-computed DecompositionResult from the
 * caller (cvParser.ts) and materialises it into nodes, embeddings, coverage, and
 * profile state.
 *
 * Flow:
 *   1. Receive ParsedCV + DecompositionResult + raw resume text
 *   2. If DecompositionResult is present:
 *      - Canonicalise skills against skill_aliases
 *      - Build nodes from decomposition
 *   3. If DecompositionResult is absent:
 *      - Fall back to parser-only nodes with lower confidence
 *   4. For each node:
 *      - Call insertCandidateNode() with source_type='resume'
 *      - Call embedCandidateNode()
 *      - Update embedding_json on the node
 *   5. Call attributeSkillTenure(candidateId) — computes years_attributed from dates
 *   6. Call computeCandidateCoverage(candidateId)
 *   7. Update candidate_profile_state to overall_status='seed'
 *
 * Error handling:
 *   - Parser failure: fall back to current flat-narrative path (backward compatible)
 *   - Missing decomposition: write parser-only nodes with lower confidence (confidence=0.5)
 *   - Partial failure (some node types fail): write what succeeded, log failures
 */

import type { Env } from '../../types';
import type { ParsedCV } from '../cvParser';
import {
  insertCandidateNode,
  embedCandidateNode,
} from './candidateNodes';
import { computeCandidateCoverage } from './candidateCoverage';
import { slugifySkills } from '../skills/slugifySkills';
import { attributeSkillTenure } from './attributeSkillTenure';
import {
  type DecompositionResult,
  type DecomposedExperience,
  type DecomposedProject,
  type DecomposedSkill,
  type DecomposedEducation,
  type DecomposedCredential,
  type DecomposedCareerArc,
} from './candidateDecompositionPrompt';

export interface ResumeDecompositionInput {
  db: import('@cloudflare/workers-types').D1Database;
  candidateId: string;
  resumeText: string;
  parsedCV: ParsedCV;
  /** Pre-computed decomposition from cvParser.ts. If null/undefined, falls back to parser-only nodes. */
  decompositionResult?: DecompositionResult | null;
  env: Env;
}

export interface ResumeDecompositionResult {
  nodesInserted: number;
  nodesEmbedded: number;
  decompositionVersion: string;
  errors: string[];
}

const DECOMPOSITION_VERSION = 'adr041-v1';
const DEFAULT_CONFIDENCE = 0.5;

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function experienceToNode(
  candidateId: string,
  exp: DecomposedExperience,
  index: number,
): Parameters<typeof insertCandidateNode>[1] {
  return {
    candidate_id: candidateId,
    node_type: 'Experience',
    narrative_text: `${exp.role} at ${exp.company}: ${exp.narrative}`,
    extracted_properties_json: JSON.stringify({
      company: exp.company,
      role: exp.role,
      duration_months: exp.duration_months,
      team_size: exp.team_size,
      scope: exp.scope,
      skills_demonstrated: exp.skills_demonstrated,
      domain: exp.domain,
      company_stage: exp.company_stage,
      impact_summary: exp.impact_summary,
      index,
    }),
    embedding_json: null,
    source_type: 'resume',
    source_reference: null,
    captured_at: nowEpoch(),
    confidence: exp.confidence,
    supersedes: null,
    superseded_at: null,
    decomposition_version: DECOMPOSITION_VERSION,
  };
}

function projectToNode(
  candidateId: string,
  proj: DecomposedProject,
  index: number,
): Parameters<typeof insertCandidateNode>[1] {
  return {
    candidate_id: candidateId,
    node_type: 'Project',
    narrative_text: `${proj.name}: ${proj.description}`,
    extracted_properties_json: JSON.stringify({
      name: proj.name,
      description: proj.description,
      url: proj.url,
      skills_demonstrated: proj.skills_demonstrated,
      index,
    }),
    embedding_json: null,
    source_type: 'resume',
    source_reference: null,
    captured_at: nowEpoch(),
    confidence: proj.confidence,
    supersedes: null,
    superseded_at: null,
    decomposition_version: DECOMPOSITION_VERSION,
  };
}

function skillToNode(
  candidateId: string,
  skill: DecomposedSkill,
  index: number,
): Parameters<typeof insertCandidateNode>[1] {
  return {
    candidate_id: candidateId,
    node_type: 'Skill',
    narrative_text: `${skill.name} (${skill.proficiency}${skill.years_exposure ? `, ${skill.years_exposure} years` : ''})`,
    extracted_properties_json: JSON.stringify({
      name: skill.name,
      proficiency: skill.proficiency,
      years_exposure: skill.years_exposure,
      evidence_source: skill.evidence_source,
      depth_pattern: skill.depth_pattern,
      index,
    }),
    embedding_json: null,
    source_type: 'resume',
    source_reference: null,
    captured_at: nowEpoch(),
    confidence: skill.confidence,
    supersedes: null,
    superseded_at: null,
    decomposition_version: DECOMPOSITION_VERSION,
  };
}

function educationToNode(
  candidateId: string,
  edu: DecomposedEducation,
  index: number,
): Parameters<typeof insertCandidateNode>[1] {
  return {
    candidate_id: candidateId,
    node_type: 'Education',
    narrative_text: `${edu.degree}${edu.field ? ` in ${edu.field}` : ''} from ${edu.institution}${edu.year ? ` (${edu.year})` : ''}`,
    extracted_properties_json: JSON.stringify({
      institution: edu.institution,
      degree: edu.degree,
      field: edu.field,
      year: edu.year,
      index,
    }),
    embedding_json: null,
    source_type: 'resume',
    source_reference: null,
    captured_at: nowEpoch(),
    confidence: edu.confidence,
    supersedes: null,
    superseded_at: null,
    decomposition_version: DECOMPOSITION_VERSION,
  };
}

function credentialToNode(
  candidateId: string,
  cred: DecomposedCredential,
  index: number,
): Parameters<typeof insertCandidateNode>[1] {
  return {
    candidate_id: candidateId,
    node_type: 'Credential',
    narrative_text: `${cred.name}${cred.issuer ? ` — ${cred.issuer}` : ''}${cred.year ? ` (${cred.year})` : ''}`,
    extracted_properties_json: JSON.stringify({
      name: cred.name,
      issuer: cred.issuer,
      year: cred.year,
      index,
    }),
    embedding_json: null,
    source_type: 'resume',
    source_reference: null,
    captured_at: nowEpoch(),
    confidence: cred.confidence,
    supersedes: null,
    superseded_at: null,
    decomposition_version: DECOMPOSITION_VERSION,
  };
}

function careerArcToNode(
  candidateId: string,
  arc: DecomposedCareerArc,
  decomposition: DecompositionResult,
): Parameters<typeof insertCandidateNode>[1] {
  return {
    candidate_id: candidateId,
    node_type: 'CareerArc',
    narrative_text: arc.narrative,
    extracted_properties_json: JSON.stringify({
      growth_velocity: arc.growth_velocity,
      transitions: arc.transitions,
      domain_specialization: decomposition.domain_specialization,
      company_stage_pattern: decomposition.company_stage_pattern,
      ownership_progression: decomposition.ownership_progression,
      impact_themes: decomposition.impact_themes,
    }),
    embedding_json: null,
    source_type: 'resume',
    source_reference: null,
    captured_at: nowEpoch(),
    confidence: arc.confidence,
    supersedes: null,
    superseded_at: null,
    decomposition_version: DECOMPOSITION_VERSION,
  };
}

async function writeParserOnlyNodes(
  db: import('@cloudflare/workers-types').D1Database,
  candidateId: string,
  parsedCV: ParsedCV,
  env: Env,
): Promise<{ inserted: number; embedded: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;
  let embedded = 0;

  const nodesToInsert: Parameters<typeof insertCandidateNode>[1][] = [];

  // Canonicalize parser-extracted skills and create Skill nodes
  const canonicalSkills = parsedCV.skills.length > 0
    ? await slugifySkills(db, parsedCV.skills)
    : [];
  for (let i = 0; i < canonicalSkills.length; i++) {
    const skill = canonicalSkills[i]!;
    nodesToInsert.push({
      candidate_id: candidateId,
      node_type: 'Skill',
      narrative_text: skill,
      extracted_properties_json: JSON.stringify({
        name: skill,
        canonical_slug: skill,
        source: 'cv_parser_fallback',
        years_exposure: null,
        index: i,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: null,
      captured_at: nowEpoch(),
      confidence: DEFAULT_CONFIDENCE,
      supersedes: null,
      superseded_at: null,
      decomposition_version: DECOMPOSITION_VERSION,
    });
  }

  for (let i = 0; i < parsedCV.experiences.length; i++) {
    const exp = parsedCV.experiences[i]!;
    nodesToInsert.push({
      candidate_id: candidateId,
      node_type: 'Experience',
      narrative_text: `${exp.role} at ${exp.company}${exp.startDate ? ` (${exp.startDate}–${exp.endDate ?? 'present'})` : ''}: ${exp.description}`,
      extracted_properties_json: JSON.stringify({
        company: exp.company,
        role: exp.role,
        startDate: exp.startDate,
        endDate: exp.endDate,
        isCurrent: exp.isCurrent,
        index: i,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: null,
      captured_at: nowEpoch(),
      confidence: DEFAULT_CONFIDENCE,
      supersedes: null,
      superseded_at: null,
      decomposition_version: DECOMPOSITION_VERSION,
    });
  }

  for (let i = 0; i < parsedCV.educationBlocks.length; i++) {
    const edu = parsedCV.educationBlocks[i]!;
    nodesToInsert.push({
      candidate_id: candidateId,
      node_type: 'Education',
      narrative_text: `${edu.degree}${edu.field ? ` in ${edu.field}` : ''} from ${edu.institution}${edu.year ? ` (${edu.year})` : ''}`,
      extracted_properties_json: JSON.stringify({
        institution: edu.institution,
        degree: edu.degree,
        field: edu.field,
        year: edu.year,
        index: i,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: null,
      captured_at: nowEpoch(),
      confidence: DEFAULT_CONFIDENCE,
      supersedes: null,
      superseded_at: null,
      decomposition_version: DECOMPOSITION_VERSION,
    });
  }

  for (let i = 0; i < parsedCV.credentials.length; i++) {
    const cred = parsedCV.credentials[i]!;
    nodesToInsert.push({
      candidate_id: candidateId,
      node_type: 'Credential',
      narrative_text: `${cred.name}${cred.issuer ? ` — ${cred.issuer}` : ''}${cred.year ? ` (${cred.year})` : ''}`,
      extracted_properties_json: JSON.stringify({
        name: cred.name,
        issuer: cred.issuer,
        year: cred.year,
        index: i,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: null,
      captured_at: nowEpoch(),
      confidence: DEFAULT_CONFIDENCE,
      supersedes: null,
      superseded_at: null,
      decomposition_version: DECOMPOSITION_VERSION,
    });
  }

  for (let i = 0; i < parsedCV.projects.length; i++) {
    const proj = parsedCV.projects[i]!;
    nodesToInsert.push({
      candidate_id: candidateId,
      node_type: 'Project',
      narrative_text: `${proj.name}: ${proj.description}`,
      extracted_properties_json: JSON.stringify({
        name: proj.name,
        description: proj.description,
        url: proj.url,
        index: i,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: null,
      captured_at: nowEpoch(),
      confidence: DEFAULT_CONFIDENCE,
      supersedes: null,
      superseded_at: null,
      decomposition_version: DECOMPOSITION_VERSION,
    });
  }

  // Insert and embed
  for (const node of nodesToInsert) {
    try {
      const insertedNode = await insertCandidateNode(db, node);
      inserted++;

      try {
        const embedding = await embedCandidateNode(insertedNode.narrative_text, env as unknown as Parameters<typeof embedCandidateNode>[1]);
        await db
          .prepare(
            `UPDATE candidate_nodes SET embedding_json = ?1 WHERE id = ?2`,
          )
          .bind(JSON.stringify(embedding), insertedNode.id)
          .run();
        embedded++;
      } catch (embedErr) {
        const msg = embedErr instanceof Error ? embedErr.message : String(embedErr);
        errors.push(`Embed failed for ${node.node_type}: ${msg}`);
      }
    } catch (insertErr) {
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
      errors.push(`Insert failed for ${node.node_type}: ${msg}`);
    }
  }

  return { inserted, embedded, errors };
}

async function upsertCandidateProfileState(
  db: import('@cloudflare/workers-types').D1Database,
  candidateId: string,
  status: 'seed' | 'enriching' | 'screening' | 'active' | 'dormant' | 'archived',
): Promise<void> {
  const now = nowEpoch();
  await db
    .prepare(
      `INSERT INTO candidate_profile_state (
         candidate_id, overall_status, last_intake_at, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?3, ?3)
       ON CONFLICT(candidate_id) DO UPDATE SET
         overall_status = excluded.overall_status,
         last_intake_at = COALESCE(excluded.last_intake_at, last_intake_at),
         updated_at = excluded.updated_at`,
    )
    .bind(candidateId, status, now)
    .run();
}

async function updateDecompositionVersion(
  db: import('@cloudflare/workers-types').D1Database,
  candidateId: string,
  version: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE candidate_ingestion SET decomposition_version = ?1 WHERE candidate_id = ?2`,
    )
    .bind(version, candidateId)
    .run();
}

/**
 * Decompose a resume into candidate_nodes.
 *
 * Never throws — failures are logged and partial results are preserved.
 */
export async function decomposeResumeToGraph(
  input: ResumeDecompositionInput,
): Promise<ResumeDecompositionResult> {
  const { db, candidateId, resumeText, parsedCV, decompositionResult, env } = input;

  const result: ResumeDecompositionResult = {
    nodesInserted: 0,
    nodesEmbedded: 0,
    decompositionVersion: DECOMPOSITION_VERSION,
    errors: [],
  };

  // Step 1: Use provided decomposition or fall back to parser-only nodes
  let decomposition: DecompositionResult | null = decompositionResult ?? null;

  // Step 2: Build node list
  const nodesToInsert: Parameters<typeof insertCandidateNode>[1][] = [];

  if (decomposition) {
    // Canonicalize all skills from LLM decomposition against skill_aliases
    const allSkillNames = new Set<string>();
    for (const skill of decomposition.skills) {
      allSkillNames.add(skill.name);
    }
    for (const exp of decomposition.experiences) {
      for (const skillName of exp.skills_demonstrated) {
        allSkillNames.add(skillName);
      }
    }
    const skillList = Array.from(allSkillNames);
    let canonicalMap: Map<string, string> = new Map();
    if (skillList.length > 0) {
      try {
        const canonical = await slugifySkills(db, skillList);
        canonicalMap = new Map(skillList.map((name, i) => [name, canonical[i]!]));
      } catch (slugErr) {
        const msg = slugErr instanceof Error ? slugErr.message : String(slugErr);
        console.warn('[resumeDecomposition] skill canonicalization failed:', msg);
        result.errors.push(`Skill canonicalization failed: ${msg}`);
      }
    }
    // Apply canonical slugs to decomposition result
    for (const skill of decomposition.skills) {
      const canonical = canonicalMap.get(skill.name);
      if (canonical) skill.name = canonical;
    }
    for (const exp of decomposition.experiences) {
      exp.skills_demonstrated = exp.skills_demonstrated.map((name) => canonicalMap.get(name) ?? name);
    }

    for (let i = 0; i < decomposition.experiences.length; i++) {
      const exp = decomposition.experiences[i]!;
      nodesToInsert.push(experienceToNode(candidateId, exp, i));
    }
    for (let i = 0; i < decomposition.projects.length; i++) {
      const proj = decomposition.projects[i]!;
      nodesToInsert.push(projectToNode(candidateId, proj, i));
    }
    for (let i = 0; i < decomposition.skills.length; i++) {
      const skill = decomposition.skills[i]!;
      nodesToInsert.push(skillToNode(candidateId, skill, i));
    }
    for (let i = 0; i < decomposition.education.length; i++) {
      const edu = decomposition.education[i]!;
      nodesToInsert.push(educationToNode(candidateId, edu, i));
    }
    for (let i = 0; i < decomposition.credentials.length; i++) {
      const cred = decomposition.credentials[i]!;
      nodesToInsert.push(credentialToNode(candidateId, cred, i));
    }
    nodesToInsert.push(careerArcToNode(candidateId, decomposition.career_arc, decomposition));
  } else {
    // No decomposition — fall back to parser-only nodes with lower confidence
    console.log('[resumeDecomposition] No decomposition result provided; falling back to parser-only nodes');
    const fallback = await writeParserOnlyNodes(db, candidateId, parsedCV, env);
    result.nodesInserted = fallback.inserted;
    result.nodesEmbedded = fallback.embedded;
    result.errors.push(...fallback.errors);

    // Still update state and coverage
    try {
      await upsertCandidateProfileState(db, candidateId, 'seed');
    } catch (stateErr) {
      const msg = stateErr instanceof Error ? stateErr.message : String(stateErr);
      result.errors.push(`Profile state update failed: ${msg}`);
    }

    try {
      await computeCandidateCoverage(db, candidateId);
    } catch (coverageErr) {
      const msg = coverageErr instanceof Error ? coverageErr.message : String(coverageErr);
      result.errors.push(`Coverage computation failed: ${msg}`);
    }

    try {
      await updateDecompositionVersion(db, candidateId, DECOMPOSITION_VERSION);
    } catch (verErr) {
      const msg = verErr instanceof Error ? verErr.message : String(verErr);
      result.errors.push(`Decomposition version update failed: ${msg}`);
    }

    // Attribute skill tenure from fallback Experience nodes
    try {
      const tenureResult = await attributeSkillTenure(db, candidateId);
      if (tenureResult.skillsUpdated > 0) {
        console.log('[resumeDecomposition] Fallback skill tenure attributed:', tenureResult.skillsUpdated);
      }
      result.errors.push(...tenureResult.errors);
    } catch (tenureErr) {
      const msg = tenureErr instanceof Error ? tenureErr.message : String(tenureErr);
      console.warn('[resumeDecomposition] Fallback skill tenure attribution failed:', msg);
      result.errors.push(`Skill tenure attribution failed: ${msg}`);
    }

    return result;
  }

  // Step 3: Insert and embed nodes
  for (const node of nodesToInsert) {
    try {
      const insertedNode = await insertCandidateNode(db, node);
      result.nodesInserted++;

      try {
        const embedding = await embedCandidateNode(insertedNode.narrative_text, env as unknown as Parameters<typeof embedCandidateNode>[1]);
        await db
          .prepare(
            `UPDATE candidate_nodes SET embedding_json = ?1 WHERE id = ?2`,
          )
          .bind(JSON.stringify(embedding), insertedNode.id)
          .run();
        result.nodesEmbedded++;
      } catch (embedErr) {
        const msg = embedErr instanceof Error ? embedErr.message : String(embedErr);
        console.warn('[resumeDecomposition] Embed failed for', node.node_type, ':', msg);
        result.errors.push(`Embed failed for ${node.node_type}: ${msg}`);
      }
    } catch (insertErr) {
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
      console.warn('[resumeDecomposition] Insert failed for', node.node_type, ':', msg);
      result.errors.push(`Insert failed for ${node.node_type}: ${msg}`);
    }
  }

  // Step 4: Attribute skill tenure from Experience dates
  try {
    const tenureResult = await attributeSkillTenure(db, candidateId);
    if (tenureResult.skillsUpdated > 0) {
      console.log('[resumeDecomposition] Skill tenure attributed:', tenureResult.skillsUpdated);
    }
    result.errors.push(...tenureResult.errors);
  } catch (tenureErr) {
    const msg = tenureErr instanceof Error ? tenureErr.message : String(tenureErr);
    console.warn('[resumeDecomposition] Skill tenure attribution failed:', msg);
    result.errors.push(`Skill tenure attribution failed: ${msg}`);
  }

  // Step 5: Update coverage
  try {
    await computeCandidateCoverage(db, candidateId);
  } catch (coverageErr) {
    const msg = coverageErr instanceof Error ? coverageErr.message : String(coverageErr);
    console.warn('[resumeDecomposition] Coverage computation failed:', msg);
    result.errors.push(`Coverage computation failed: ${msg}`);
  }

  // Step 5: Update candidate_profile_state
  try {
    await upsertCandidateProfileState(db, candidateId, 'seed');
  } catch (stateErr) {
    const msg = stateErr instanceof Error ? stateErr.message : String(stateErr);
    console.warn('[resumeDecomposition] Profile state update failed:', msg);
    result.errors.push(`Profile state update failed: ${msg}`);
  }

  // Step 6: Track decomposition version
  try {
    await updateDecompositionVersion(db, candidateId, DECOMPOSITION_VERSION);
  } catch (verErr) {
    const msg = verErr instanceof Error ? verErr.message : String(verErr);
    result.errors.push(`Decomposition version update failed: ${msg}`);
  }

  console.log(
    '[resumeDecomposition] Completed for',
    candidateId,
    '— inserted:',
    result.nodesInserted,
    'embedded:',
    result.nodesEmbedded,
    'errors:',
    result.errors.length,
  );

  return result;
}
