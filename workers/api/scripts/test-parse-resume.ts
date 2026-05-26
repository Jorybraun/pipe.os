/**
 * Standalone test script for the consolidated resume parsing pipeline.
 *
 * Usage:
 *   export CANDIDATE_AGENT_PROVIDER=vertex-ai
 *   npx tsx scripts/test-parse-resume.ts /path/to/resume.pdf
 */

import { readFileSync } from 'fs';
import { extractText } from 'unpdf';
import {
  extractExperiences,
  extractEducationBlocks,
  extractCredentials,
  extractProjects,
} from '../src/lib/cvParser';
import { buildDecompositionUserMessage } from '../src/lib/candidateDiscovery/candidateDecompositionPrompt';
import { createCandidateAgentProvider } from '../src/lib/llm/createProvider';

function printSection(title: string) {
  const line = '─'.repeat(70);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}\n`);
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx scripts/test-parse-resume.ts <path-to-pdf>');
    process.exit(1);
  }

  console.log('Reading PDF:', filePath);
  const buffer = readFileSync(filePath);

  console.log('Extracting text...');
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  const resumeText = typeof text === 'string' ? text : text.join('\n');
  console.log(`Extracted ${resumeText.length} characters\n`);

  printSection('RULE-BASED EXTRACTION');
  const experiences = extractExperiences(resumeText);
  const educationBlocks = extractEducationBlocks(resumeText);
  const credentials = extractCredentials(resumeText);
  const projects = extractProjects(resumeText);

  console.log(`Experiences: ${experiences.length}`);
  for (const e of experiences) {
    console.log(`  • ${e.role} @ ${e.company} (${e.startDate ?? '?'}–${e.endDate ?? 'present'})`);
  }
  console.log(`Education:   ${educationBlocks.length}`);
  console.log(`Credentials: ${credentials.length}`);
  console.log(`Projects:    ${projects.length}`);

  const parsedCV = {
    skills: [] as string[],
    experiences,
    educationBlocks,
    credentials,
    projects,
  };

  const env = process.env as unknown as import('../src/lib/llm/createProvider').ProviderEnv;
  const provider = createCandidateAgentProvider(env);

  if (!provider) {
    console.error('No AI provider available. Set CANDIDATE_AGENT_PROVIDER=vertex-ai and ensure VERTEX_SA_KEY_JSON is set.');
    process.exit(1);
  }

  console.log(`\nCalling LLM provider: ${provider.name}...`);
  const userMessage = buildDecompositionUserMessage({ parsed: parsedCV, resumeText });

  const result = await provider.complete(
    [
      {
        role: 'system',
        content: `You are an expert recruitment assistant. You enrich structured resume data into detailed, matchable sub-elements.

You receive TWO inputs:
1. A PARSER SKELETON — structured facts extracted deterministically from the resume.
2. RAW RESUME TEXT — the original text for verification.

Your job is to enrich the skeleton with narratives, skill proficiencies, and a CareerArc synthesis. You must NOT invent facts not present in the raw text.

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
      "confidence": number (0.0–1.0)
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
      "confidence": number
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
  }
}

Anti-hallucination rules:
- Do not invent metrics not present in the raw text.
- Do not claim years of experience with a technology unless explicitly stated.
- If parser skeleton and raw text conflict, trust the raw text and note the discrepancy.
- Confidence must reflect certainty, not candidate quality.
- team_size and scope are OPTIONAL — omit if not inferable from the text.
- years_exposure is OPTIONAL — omit unless the resume explicitly states "5 years of TypeScript".`,
      },
      { role: 'user', content: userMessage },
    ],
    { forceJson: true, maxTokens: 2000 },
  );

  const cleaned = (result.content ?? '')
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();

  const decomposition = JSON.parse(cleaned);

  // ─── Print full structured data as candidate_nodes ───
  printSection('CANDIDATE NODES (what gets inserted into candidate_nodes)');

  let nodeIndex = 0;

  // Experience nodes
  for (const exp of decomposition.experiences ?? []) {
    printSection(`Node #${++nodeIndex} — Experience`);
    console.log(`Company:     ${exp.company}`);
    console.log(`Role:        ${exp.role}`);
    console.log(`Duration:    ${exp.duration_months} months`);
    console.log(`Scope:       ${exp.scope ?? '(not stated)'}`);
    console.log(`Confidence:  ${exp.confidence}`);
    console.log(`Narrative:   ${exp.narrative}`);
    console.log(`Skills:      ${(exp.skills_demonstrated ?? []).join(', ')}`);
  }

  // Project nodes
  for (const proj of decomposition.projects ?? []) {
    printSection(`Node #${++nodeIndex} — Project`);
    console.log(`Name:        ${proj.name}`);
    console.log(`URL:         ${proj.url ?? '(none)'}`);
    console.log(`Confidence:  ${proj.confidence}`);
    console.log(`Description: ${proj.description}`);
    console.log(`Skills:      ${(proj.skills_demonstrated ?? []).join(', ')}`);
  }

  // Skill nodes
  for (const skill of decomposition.skills ?? []) {
    printSection(`Node #${++nodeIndex} — Skill`);
    console.log(`Name:        ${skill.name}`);
    console.log(`Proficiency: ${skill.proficiency}`);
    console.log(`Years:       ${skill.years_exposure ?? '(not stated)'}`);
    console.log(`Evidence:    ${skill.evidence_source ?? '(not stated)'}`);
    console.log(`Confidence:  ${skill.confidence}`);
  }

  // Education nodes
  for (const edu of decomposition.education ?? []) {
    printSection(`Node #${++nodeIndex} — Education`);
    console.log(`Institution: ${edu.institution}`);
    console.log(`Degree:      ${edu.degree}`);
    console.log(`Field:       ${edu.field ?? '(not stated)'}`);
    console.log(`Year:        ${edu.year ?? '(not stated)'}`);
    console.log(`Confidence:  ${edu.confidence}`);
  }

  // Credential nodes
  for (const cred of decomposition.credentials ?? []) {
    printSection(`Node #${++nodeIndex} — Credential`);
    console.log(`Name:        ${cred.name}`);
    console.log(`Issuer:      ${cred.issuer ?? '(not stated)'}`);
    console.log(`Year:        ${cred.year ?? '(not stated)'}`);
    console.log(`Confidence:  ${cred.confidence}`);
  }

  // CareerArc node
  if (decomposition.career_arc) {
    printSection(`Node #${++nodeIndex} — CareerArc`);
    console.log(`Growth:      ${decomposition.career_arc.growth_velocity}`);
    console.log(`Confidence:  ${decomposition.career_arc.confidence}`);
    console.log(`Narrative:   ${decomposition.career_arc.narrative}`);
    if (decomposition.career_arc.transitions?.length) {
      console.log('Transitions:');
      for (const t of decomposition.career_arc.transitions) {
        console.log(`  • ${t.from} → ${t.to} @ ${t.at_company}`);
      }
    }
  }

  printSection('SUMMARY');
  console.log(`Total nodes that would be inserted: ${nodeIndex}`);
  console.log(`  Experiences: ${(decomposition.experiences ?? []).length}`);
  console.log(`  Projects:    ${(decomposition.projects ?? []).length}`);
  console.log(`  Skills:      ${(decomposition.skills ?? []).length}`);
  console.log(`  Education:   ${(decomposition.education ?? []).length}`);
  console.log(`  Credentials: ${(decomposition.credentials ?? []).length}`);
  console.log(`  CareerArc:   ${decomposition.career_arc ? 1 : 0}`);

  // Derived ParsedCV
  const totalMonths = (decomposition.experiences ?? []).reduce(
    (sum: number, e: { duration_months?: number }) => sum + (e.duration_months ?? 0),
    0,
  );
  printSection('DERIVED ParsedCV (flat fields for candidates table)');
  console.log(`Name:              ${decomposition.candidate_name ?? '(unknown)'}`);
  console.log(`Current role:      ${decomposition.experiences?.[0]?.role ?? '(unknown)'}`);
  console.log(`Years experience:  ${totalMonths > 0 ? Math.round(totalMonths / 12) : '(unknown)'}`);
  console.log(`Skills:            ${(decomposition.skills ?? []).map((s: { name: string }) => s.name).join(', ')}`);
  console.log(`Education:         ${(decomposition.education ?? []).map(
    (edu: { degree: string; field?: string; institution: string; year?: string }) => {
      const parts: string[] = [edu.degree];
      if (edu.field) parts.push(`in ${edu.field}`);
      parts.push(edu.institution);
      if (edu.year) parts.push(`(${edu.year})`);
      return parts.join(' ');
    },
  ).join(' | ') || '(none)'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
