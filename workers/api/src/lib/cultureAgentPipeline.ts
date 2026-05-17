/**
 * Culture Interview Termination Pipeline — dual-output post-screener enrichment.
 *
 * Fired when a culture interview terminates. Runs inside ctx.waitUntil().
 * Produces two parallel outputs:
 *   1. candidate_profile_json — rich synthesized profile for candidate review
 *   2. candidate_nodes — thin decomposition nodes for matching signal
 *
 * Then triggers post-screener enrichment:
 *   3. Compute enriched embedding from all candidate_nodes (mean pool + L2 norm)
 *   4. Upsert enriched vector to CANDIDATE_INDEX
 *   5. Mark candidate as 'enriched' in candidate_ingestion
 *   6. Trigger matching (runMatchAndAssign) using reloaded discovery result
 *
 * Never throws. All errors are caught and logged.
 *
 * See knowledge/plan/culture-agent-redesign/implementation/decomposition-pipeline.md
 */

import type { LLMProvider, LLMMessage } from './llm/types';
import type { Env, CandidateNodeType } from '../types';
import type { CultureTranscript } from './cultureAgent';
import { embedCandidateNode, getActiveCandidateNodesWithFallback } from './candidateDiscovery/candidateNodes';
import { computeCandidateCoverageWithFallback } from './neo4j/candidateGraphQueries';
import { meanPoolVectors, parseEmbeddingJson } from './embedding/cosine';
import { writeCandidateGraph } from './neo4j/writeCandidateGraph';
import { buildNeo4jConfig, getNeo4jDriver } from './neo4j/driver';

import { markCandidateEnriching, markCandidateEnriched } from './candidateDiscovery/persist';
import { runMatchAndAssign, loadDiscoveryResultFromDb } from './candidateDiscovery/orchestrate';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CareerTimelineEntry {
  company: string;
  role: string;
  startDate: string;
  endDate: string | null;
  durationMonths: number;
  teamSize: number | null;
  scope: string;
  keyAccomplishments: string[];
  technologies: string[];
}

export interface SkillInventoryEntry {
  skill: string;
  proficiency: 'exposure' | 'working' | 'expert';
  evidence: string;
  yearsExperience: number | null;
}

export interface ProjectPortfolioEntry {
  name: string;
  description: string;
  role: string;
  outcomes: string[];
  technologies: string[];
}

export interface WorkingStyleProfile {
  collaborationPreference: string;
  communicationStyle: string;
  decisionMaking: string;
  feedbackReceptiveness: string;
}

export interface MotivationProfile {
  primaryDrivers: string[];
  dealbreakers: string[];
  growthTrajectory: string;
}

export interface BehavioralEvidenceEntry {
  dimension: string;
  evidence: string;
  confidence: number;
}

/**
 * Rich synthesized candidate profile produced from the full interview transcript.
 * Persisted to candidate_ingestion.candidate_profile_json.
 */
export interface CandidateProfile {
  careerTimeline: CareerTimelineEntry[];
  skillsInventory: SkillInventoryEntry[];
  projectPortfolio: ProjectPortfolioEntry[];
  workingStyle: WorkingStyleProfile;
  motivation: MotivationProfile;
  behavioralEvidence: BehavioralEvidenceEntry[];
}

interface DecomposedNode {
  nodeType: CandidateNodeType;
  narrative: string;
  properties: Record<string, unknown>;
  confidence: number;
}

interface DecomposedTranscript {
  nodes: DecomposedNode[];
}

interface PipelineInput {
  env: Env;
  db: D1Database;
  candidateId: string;
  sessionId: string;
  transcript: CultureTranscript;
  mode: 'profile_builder' | 'role_fit';
  provider: LLMProvider | null;
  assessmentId: string;
}

const PIPELINE_VERSION = 'culture_pipeline_v1';

// ─── Transcript formatting ───────────────────────────────────────────────────

function formatTranscriptForPrompt(transcript: CultureTranscript): string {
  const lines: string[] = [];
  for (const turn of transcript.turns) {
    if (turn.candidateResponse && turn.candidateResponse.trim().length > 0) {
      lines.push(`Interviewer: ${turn.questionText}`);
      lines.push(`Candidate: ${turn.candidateResponse.trim()}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ─── Synthesis prompts ───────────────────────────────────────────────────────

function buildSynthesisSystemPrompt(): string {
  return `You are a structured candidate profile synthesis system. Read the complete interview transcript and produce a rich, structured candidate profile.

# Output contract
Respond with ONE JSON object. No prose. No markdown fences. Exactly this shape:

{
  "careerTimeline": [
    {
      "company": "string",
      "role": "string",
      "startDate": "YYYY-MM or YYYY-MM-DD or approximate like '2020'",
      "endDate": "YYYY-MM or YYYY-MM-DD or null if current",
      "durationMonths": number,
      "teamSize": number or null,
      "scope": "one-sentence description of responsibilities",
      "keyAccomplishments": ["string"],
      "technologies": ["string"]
    }
  ],
  "skillsInventory": [
    {
      "skill": "string",
      "proficiency": "exposure | working | expert",
      "evidence": "verbatim quote or close paraphrase from transcript",
      "yearsExperience": number or null
    }
  ],
  "projectPortfolio": [
    {
      "name": "string or 'Unnamed'",
      "description": "one-sentence description",
      "role": "string",
      "outcomes": ["string"],
      "technologies": ["string"]
    }
  ],
  "workingStyle": {
    "collaborationPreference": "string — how they prefer to work with others",
    "communicationStyle": "string — how they communicate (e.g., direct, diplomatic, detailed)",
    "decisionMaking": "string — how they make decisions (e.g., data-driven, consensus, instinct)",
    "feedbackReceptiveness": "string — how they receive feedback"
  },
  "motivation": {
    "primaryDrivers": ["string — what motivates them (e.g., impact, growth, autonomy)"],
    "dealbreakers": ["string — things they actively avoid"],
    "growthTrajectory": "string — where they want to go next"
  },
  "behavioralEvidence": [
    {
      "dimension": "ownership | collaboration | learning-orientation | conflict-handling | self-awareness",
      "evidence": "verbatim quote from transcript",
      "confidence": 0.0-1.0
    }
  ]
}

Rules:
- Only include information explicitly stated or strongly implied by the transcript.
- Use empty arrays [] or null when information is missing — never hallucinate.
- For careerTimeline: extract chronological work history with dates when mentioned. Skip if no career history is discussed.
- For skillsInventory: include only skills with transcript evidence. Skip generic claims without specifics.
- For behavioralEvidence: one entry per dimension evidenced. Include up to 3 strongest pieces of evidence per dimension.
- confidence reflects your certainty that the evidence is real (not the candidate's quality).`;
}

function buildSynthesisUserMessage(transcript: CultureTranscript): string {
  return `# Interview Transcript

${formatTranscriptForPrompt(transcript)}

# Your task
Synthesize a rich structured candidate profile from this transcript. Produce the JSON object.`;
}

// ─── Decomposition prompts ───────────────────────────────────────────────────

function buildDecompositionSystemPrompt(): string {
  return `You are a structured information extraction system. Read the complete interview transcript and extract typed sub-elements (nodes) for a candidate knowledge graph.

# Output contract
Respond with ONE JSON object. No prose. No markdown fences. Exactly this shape:

{
  "nodes": [
    {
      "nodeType": "Experience | Project | Skill | CulturalSignal | WorkingStyle | Motivation",
      "narrative": "one-sentence summary suitable for embedding",
      "properties": { /* type-specific fields */ },
      "confidence": 0.0-1.0
    }
  ]
}

Type-specific properties:

Experience:
  { "company": "string or null", "role": "string or null", "startDate": "string or null", "endDate": "string or null", "teamSize": number or null, "scope": "string", "keyAccomplishments": ["string"], "technologies": ["string"] }

Project:
  { "name": "string or null", "description": "string", "role": "string", "outcomes": ["string"], "technologies": ["string"] }

Skill:
  { "skill": "string", "proficiency": "exposure | working | expert", "evidence": "string", "yearsExperience": number or null }

CulturalSignal:
  { "dimension": "ownership | collaboration | learning-orientation | conflict-handling | self-awareness", "evidence": "string", "scoreEstimate": 1-5 }

WorkingStyle:
  { "collaborationPreference": "string", "communicationStyle": "string", "decisionMaking": "string", "feedbackReceptiveness": "string" }

Motivation:
  { "primaryDrivers": ["string"], "dealbreakers": ["string"], "growthTrajectory": "string" }

Rules:
- Only extract information explicitly stated or strongly implied by the transcript.
- Use null or empty arrays when information is missing — never hallucinate.
- narrative must be a standalone, embeddable sentence summarizing the node content.
- confidence reflects your certainty that the information is real (not candidate quality).
- Limit to the 12 most salient nodes. Prioritize: Experience > Skill > Project > CulturalSignal > WorkingStyle > Motivation.
- Do NOT duplicate nodes. If the same experience is mentioned multiple times, create it once.`;
}

function buildDecompositionUserMessage(transcript: CultureTranscript): string {
  return `# Interview Transcript

${formatTranscriptForPrompt(transcript)}

# Your task
Extract structured sub-elements from this transcript. Produce the JSON object with typed nodes.`;
}

// ─── LLM callers ─────────────────────────────────────────────────────────────

export async function synthesizeCandidateProfile(
  provider: LLMProvider | null,
  transcript: CultureTranscript,
): Promise<CandidateProfile | null> {
  if (!provider) {
    console.log('[culturePipeline] No provider — skipping profile synthesis.');
    return null;
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: buildSynthesisSystemPrompt() },
    { role: 'user', content: buildSynthesisUserMessage(transcript) },
  ];

  let content: string;
  try {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens: 2048 });
    content = (completion.content ?? '').trim();
  } catch (err) {
    console.error('[culturePipeline] Profile synthesis LLM call failed:', err);
    return null;
  }

  if (!content) {
    console.warn('[culturePipeline] Profile synthesis returned empty content.');
    return null;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return parseCandidateProfile(parsed);
  } catch (err) {
    console.error('[culturePipeline] Failed to parse profile synthesis JSON:', content.slice(0, 300), err);
    return null;
  }
}

export async function decomposeTranscript(
  provider: LLMProvider | null,
  transcript: CultureTranscript,
): Promise<DecomposedTranscript | null> {
  if (!provider) {
    console.log('[culturePipeline] No provider — skipping transcript decomposition.');
    return null;
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: buildDecompositionSystemPrompt() },
    { role: 'user', content: buildDecompositionUserMessage(transcript) },
  ];

  let content: string;
  try {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens: 2048 });
    content = (completion.content ?? '').trim();
  } catch (err) {
    console.error('[culturePipeline] Decomposition LLM call failed:', err);
    return null;
  }

  if (!content) {
    console.warn('[culturePipeline] Decomposition returned empty content.');
    return null;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return parseDecomposedTranscript(parsed);
  } catch (err) {
    console.error('[culturePipeline] Failed to parse decomposition JSON:', content.slice(0, 300), err);
    return null;
  }
}

// ─── JSON parsers ────────────────────────────────────────────────────────────

function parseCandidateProfile(raw: unknown): CandidateProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  return {
    careerTimeline: parseCareerTimeline(r.careerTimeline),
    skillsInventory: parseSkillsInventory(r.skillsInventory),
    projectPortfolio: parseProjectPortfolio(r.projectPortfolio),
    workingStyle: parseWorkingStyle(r.workingStyle),
    motivation: parseMotivation(r.motivation),
    behavioralEvidence: parseBehavioralEvidence(r.behavioralEvidence),
  };
}

function parseCareerTimeline(raw: unknown): CareerTimelineEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CareerTimelineEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Record<string, unknown>;
    out.push({
      company: typeof i.company === 'string' ? i.company : '',
      role: typeof i.role === 'string' ? i.role : '',
      startDate: typeof i.startDate === 'string' ? i.startDate : '',
      endDate: typeof i.endDate === 'string' ? i.endDate : null,
      durationMonths: typeof i.durationMonths === 'number' ? Math.round(i.durationMonths) : 0,
      teamSize: typeof i.teamSize === 'number' ? i.teamSize : null,
      scope: typeof i.scope === 'string' ? i.scope : '',
      keyAccomplishments: parseStringArray(i.keyAccomplishments),
      technologies: parseStringArray(i.technologies),
    });
  }
  return out;
}

function parseSkillsInventory(raw: unknown): SkillInventoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillInventoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Record<string, unknown>;
    const prof = i.proficiency;
    out.push({
      skill: typeof i.skill === 'string' ? i.skill : '',
      proficiency:
        prof === 'exposure' || prof === 'working' || prof === 'expert'
          ? prof
          : 'working',
      evidence: typeof i.evidence === 'string' ? i.evidence : '',
      yearsExperience: typeof i.yearsExperience === 'number' ? i.yearsExperience : null,
    });
  }
  return out;
}

function parseProjectPortfolio(raw: unknown): ProjectPortfolioEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectPortfolioEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Record<string, unknown>;
    out.push({
      name: typeof i.name === 'string' ? i.name : 'Unnamed',
      description: typeof i.description === 'string' ? i.description : '',
      role: typeof i.role === 'string' ? i.role : '',
      outcomes: parseStringArray(i.outcomes),
      technologies: parseStringArray(i.technologies),
    });
  }
  return out;
}

function parseWorkingStyle(raw: unknown): WorkingStyleProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    collaborationPreference: typeof r.collaborationPreference === 'string' ? r.collaborationPreference : '',
    communicationStyle: typeof r.communicationStyle === 'string' ? r.communicationStyle : '',
    decisionMaking: typeof r.decisionMaking === 'string' ? r.decisionMaking : '',
    feedbackReceptiveness: typeof r.feedbackReceptiveness === 'string' ? r.feedbackReceptiveness : '',
  };
}

function parseMotivation(raw: unknown): MotivationProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    primaryDrivers: parseStringArray(r.primaryDrivers),
    dealbreakers: parseStringArray(r.dealbreakers),
    growthTrajectory: typeof r.growthTrajectory === 'string' ? r.growthTrajectory : '',
  };
}

function parseBehavioralEvidence(raw: unknown): BehavioralEvidenceEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BehavioralEvidenceEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Record<string, unknown>;
    out.push({
      dimension: typeof i.dimension === 'string' ? i.dimension : '',
      evidence: typeof i.evidence === 'string' ? i.evidence : '',
      confidence: typeof i.confidence === 'number' ? clamp01(i.confidence) : 0,
    });
  }
  return out;
}

function parseDecomposedTranscript(raw: unknown): DecomposedTranscript | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    nodes: parseDecomposedNodes(r.nodes),
  };
}

function parseDecomposedNodes(raw: unknown): DecomposedNode[] {
  if (!Array.isArray(raw)) return [];
  const out: DecomposedNode[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Record<string, unknown>;
    const nodeType = parseNodeType(i.nodeType);
    if (!nodeType) continue;
    out.push({
      nodeType,
      narrative: typeof i.narrative === 'string' ? i.narrative : '',
      properties: i.properties && typeof i.properties === 'object' ? (i.properties as Record<string, unknown>) : {},
      confidence: typeof i.confidence === 'number' ? clamp01(i.confidence) : 0,
    });
  }
  return out;
}

const VALID_NODE_TYPES: Set<CandidateNodeType> = new Set([
  'Experience', 'Project', 'Skill', 'CulturalSignal', 'WorkingStyle', 'Motivation',
]);

function parseNodeType(v: unknown): CandidateNodeType | null {
  if (typeof v !== 'string') return null;
  const t = v.trim() as CandidateNodeType;
  return VALID_NODE_TYPES.has(t) ? t : null;
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string');
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ─── Node persistence ────────────────────────────────────────────────────────

async function persistDecomposedNodes(
  db: D1Database,
  env: Env,
  candidateId: string,
  sessionId: string,
  mode: 'profile_builder' | 'role_fit',
  decomposition: DecomposedTranscript,
): Promise<void> {
  const sourceType = mode === 'profile_builder' ? 'automated_screener' : 'culture_interview';
  const capturedAt = Math.floor(Date.now() / 1000);
  const candidateNodes: import('../types').CandidateNode[] = [];

  for (const node of decomposition.nodes) {
    if (!node.narrative || node.narrative.trim().length === 0) continue;

    try {
      const embedding = await embedCandidateNode(
        node.narrative,
        env as { AI: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } },
      );

      candidateNodes.push({
        id: crypto.randomUUID(),
        candidate_id: candidateId,
        node_type: node.nodeType,
        narrative_text: node.narrative,
        extracted_properties_json: JSON.stringify(node.properties),
        embedding_json: JSON.stringify(embedding),
        source_type: sourceType,
        source_reference: sessionId,
        captured_at: capturedAt,
        confidence: node.confidence,
        supersedes: null,
        superseded_at: null,
        decomposition_version: PIPELINE_VERSION,
        created_at: capturedAt,
        updated_at: capturedAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[culturePipeline] Failed to embed node ${node.nodeType} for candidate ${candidateId}:`,
        msg,
      );
      // Continue to next node — partial persistence is acceptable
    }
  }

  // Write to Neo4j
  if (candidateNodes.length > 0) {
    try {
      await writeCandidateGraph({ candidateId, nodes: candidateNodes, env });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[culturePipeline] Neo4j write failed for ${candidateId}:`, msg);
    }
  }

  // Update coverage
  const neo4jConfig = buildNeo4jConfig(env);
  const driver = neo4jConfig ? getNeo4jDriver(neo4jConfig) : null;
  try {
    await computeCandidateCoverageWithFallback(db, candidateId, driver);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[culturePipeline] computeCandidateCoverage failed for ${candidateId}:`, msg);
  }
}

// ─── Enrichment ──────────────────────────────────────────────────────────────

async function computeEnrichedEmbedding(
  db: D1Database,
  env: Env,
  candidateId: string,
): Promise<number[] | null> {
  const neo4jConfig = buildNeo4jConfig(env);
  const driver = neo4jConfig ? getNeo4jDriver(neo4jConfig) : null;
  const nodes = await getActiveCandidateNodesWithFallback(db, candidateId, driver);
  const vectors: number[][] = [];

  for (const node of nodes) {
    if (!node.embedding_json) continue;
    const vec = parseEmbeddingJson(node.embedding_json);
    if (vec) {
      vectors.push(vec);
    }
  }

  if (vectors.length === 0) {
    console.log(`[culturePipeline] No embeddings found for ${candidateId}; skipping enriched embedding.`);
    return null;
  }

  const pooled = meanPoolVectors(vectors);
  console.log(
    `[culturePipeline] Computed enriched embedding for ${candidateId} from ${vectors.length} nodes`,
  );
  return pooled;
}

async function upsertEnrichedVector(
  env: Env,
  candidateId: string,
  vector: number[],
): Promise<void> {
  try {
    console.log(`[culturePipeline] Skipped Vectorize upsert (read-only archive) for ${candidateId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[culturePipeline] Failed to upsert enriched vector for ${candidateId}:`, msg);
    throw err; // Re-throw so the caller can decide whether to continue
  }
}

// ─── Public: enrichment runner ───────────────────────────────────────────────

export async function runPostScreenerEnrichment(
  env: Env,
  db: D1Database,
  candidateId: string,
  candidateProfileJson: string | null,
): Promise<void> {
  // 1. Mark enriching
  try {
    await markCandidateEnriching(db, candidateId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[culturePipeline] Failed to mark enriching for ${candidateId}:`, msg);
    // Continue — worst case the gate stays closed until next retry
  }

  // 2. Compute enriched embedding from all active nodes
  let enrichedEmbeddingJson: string | null = null;
  try {
    const embedding = await computeEnrichedEmbedding(db, env, candidateId);
    if (embedding) {
      enrichedEmbeddingJson = JSON.stringify(embedding);
      await upsertEnrichedVector(env, candidateId, embedding);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[culturePipeline] Enrichment embedding failed for ${candidateId}:`, msg);
    // Continue — we can still mark enriched without a new embedding
  }

  // 3. Mark enriched
  try {
    await markCandidateEnriched(db, {
      candidateId,
      enrichedEmbeddingJson: enrichedEmbeddingJson ?? undefined,
      candidateProfileJson: candidateProfileJson ?? undefined,
    });
    console.log(`[culturePipeline] Candidate ${candidateId} marked as enriched.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[culturePipeline] Failed to mark enriched for ${candidateId}:`, msg);
  }
}

// ─── Public: full termination pipeline ───────────────────────────────────────

/**
 * Run the full interview termination pipeline.
 *
 * This is designed to run inside ctx.waitUntil(). It never throws.
 */
export async function runInterviewTerminationPipeline(input: PipelineInput): Promise<void> {
  const { env, db, candidateId, sessionId, transcript, mode, provider, assessmentId } = input;

  console.log(`[culturePipeline] Starting termination pipeline for session ${sessionId}, candidate ${candidateId}`);

  // ── Parallel synthesis + decomposition ─────────────────────────────────────
  const [profile, decomposition] = await Promise.all([
    synthesizeCandidateProfile(provider, transcript),
    decomposeTranscript(provider, transcript),
  ]);

  const candidateProfileJson = profile ? JSON.stringify(profile) : null;

  // ── Persist decomposition nodes (sequential — needs DB + env) ──────────────
  if (decomposition) {
    try {
      await persistDecomposedNodes(db, env, candidateId, sessionId, mode, decomposition);
      console.log(
        `[culturePipeline] Persisted ${decomposition.nodes.length} decomposed nodes for ${candidateId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[culturePipeline] Node persistence failed for ${candidateId}:`, msg);
    }
  }

  // ── Post-screener enrichment ───────────────────────────────────────────────
  try {
    await runPostScreenerEnrichment(env, db, candidateId, candidateProfileJson);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[culturePipeline] Post-screener enrichment failed for ${candidateId}:`, msg);
  }

  // ── Trigger matching (if discovery result exists) ──────────────────────────
  try {
    const discoveryResult = await loadDiscoveryResultFromDb(db, candidateId);
    if (discoveryResult) {
      await runMatchAndAssign({ env, db, candidateId, discoveryResult });
      console.log(`[culturePipeline] Matching completed for ${candidateId}`);
    } else {
      console.warn(`[culturePipeline] No discovery result found for ${candidateId}; skipping match.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[culturePipeline] Matching failed for ${candidateId}:`, msg);
  }

  console.log(`[culturePipeline] Termination pipeline complete for ${candidateId}`);
}
