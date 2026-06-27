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

import type { Env, CandidateNode } from '../../types';
import type { ParsedCV } from '../cvParser';
import {
  embedCandidateNode,
  insertCandidateNode,
} from './candidateNodes';
import { computeCandidateCoverageWithFallback } from '../neo4j/candidateGraphQueries';
import { writeCandidateGraph } from '../neo4j/writeCandidateGraph';
import { buildNeo4jConfig, getNeo4jDriver } from '../neo4j/driver';
import { slugifySkills } from '../skills/slugifySkills';
import { attributeSkillTenure } from './attributeSkillTenure';
import {
  extractOpenIdentifierTerms,
  normalizeOpenTermSurface,
  openSemanticTermRecord,
  type OpenSemanticTermRecord,
} from '../livingContext/openTerms';
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
  /** @deprecated Vectorize upserts removed in Neo4j migration Phase 2. Kept for API compatibility. */
  vectorize?: VectorizeIndex;
}

export interface ResumeDecompositionResult {
  nodesInserted: number;
  nodesEmbedded: number;
  decompositionVersion: string;
  errors: string[];
  /** Raw embedding vectors for each inserted node, in insertion order. */
  embeddings: number[][];
}

const DECOMPOSITION_VERSION = 'adr041-v1';
const DEFAULT_CONFIDENCE = 0.5;
const RAW_REVIEW_EVIDENCE_CONFIDENCE = 0.85;
const RAW_REVIEW_EVIDENCE_NODE_LIMIT = 64;
const RAW_REVIEW_EVIDENCE_QUOTE_LIMIT = 8;
const RAW_REVIEW_EVIDENCE_MIN_CHARS = 24;

const RAW_EVIDENCE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'built',
  'by',
  'created',
  'designed',
  'engineer',
  'for',
  'from',
  'have',
  'i',
  'implemented',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'senior',
  'shipped',
  'so',
  'staff',
  'team',
  'the',
  'their',
  'this',
  'to',
  'years',
  'with',
]);

const RAW_EVIDENCE_LANGUAGE_SEGMENTS = new Set([
  'javascript',
  'java',
  'script',
  'typescript',
  'type',
]);

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function mergeSemanticTerms(
  explicit: OpenSemanticTermRecord[] | undefined,
  sourceSurfaces: readonly string[],
  evidenceLevel: string,
): OpenSemanticTermRecord[] {
  const terms = new Map<string, OpenSemanticTermRecord>();
  for (const term of explicit ?? []) {
    const normalized = openSemanticTermRecord(term.surface, term.evidence_level);
    if (normalized) terms.set(normalized.canonical_key, normalized);
  }
  for (const surface of sourceSurfaces) {
    const term = openSemanticTermRecord(surface, evidenceLevel);
    if (term && !terms.has(term.canonical_key)) {
      terms.set(term.canonical_key, term);
    }
  }
  return [...terms.values()];
}

function sourceQuoteProperties(resumeText: string, sourceQuote?: string): {
  source_quote?: string;
  source_quote_validated?: boolean;
  source_quote_char_start?: number;
  source_quote_char_end?: number;
} {
  const quote = sourceQuote?.trim();
  if (!quote) return {};
  const index = resumeText.indexOf(quote);
  if (index < 0) return {};
  return {
    source_quote: quote,
    source_quote_validated: true,
    source_quote_char_start: index,
    source_quote_char_end: index + quote.length,
  };
}

function rawReviewEvidenceLevel(quote: string): string {
  const normalized = normalizeOpenTermSurface(quote);
  if (/\b(validated|verified|tested|regression|test|runner)\b/.test(normalized)) {
    return 'validated';
  }
  if (/\b(implemented|built|designed|shipped|created|authored|led)\b/.test(normalized)) {
    return 'implemented';
  }
  if (/\b(review|assess|explain|defend|reason|trade off|tradeoff)\b/.test(normalized)) {
    return 'explained';
  }
  return 'used';
}

function rawReviewEvidenceQuotes(resumeText: string): string[] {
  const trimmed = resumeText.trim();
  if (trimmed.length < RAW_REVIEW_EVIDENCE_MIN_CHARS) return [];

  const quotes = new Map<string, string>();
  for (const match of resumeText.match(/[^.!?\n]+[.!?]?/g) ?? []) {
    const quote = match.trim();
    if (quote.length < RAW_REVIEW_EVIDENCE_MIN_CHARS) continue;
    quotes.set(quote, quote);
    if (quotes.size >= RAW_REVIEW_EVIDENCE_QUOTE_LIMIT) break;
  }

  if (quotes.size === 0) {
    const quote = trimmed.slice(0, 4000);
    quotes.set(quote, quote);
  }
  return [...quotes.values()];
}

function meaningfulRawEvidenceTokens(quote: string): string[] {
  return normalizeOpenTermSurface(quote)
    .split(' ')
    .map((token) => token.replace(/^[^a-z0-9+#]+|[^a-z0-9+#]+$/g, ''))
    .filter((token) =>
      token.length >= 2
      && !RAW_EVIDENCE_STOPWORDS.has(token)
      && !/^\d+$/.test(token)
    );
}

function originalPhraseTokens(quote: string): string[] {
  return (quote.match(/[A-Za-z][A-Za-z0-9+#.]*/g) ?? [])
    .map((token) => token.replace(/^[^A-Za-z0-9+#]+|[^A-Za-z0-9+#]+$/g, ''))
    .filter((token) =>
      token.length >= 2
      && !RAW_EVIDENCE_STOPWORDS.has(token.toLowerCase())
      && !/^\d+$/.test(token)
    );
}

function compactLanguageNames(surface: string): string {
  return surface
    .replace(/\bJavaScript\b/g, 'javascript')
    .replace(/\bTypeScript\b/g, 'typescript');
}

function rawReviewEvidenceTerms(quote: string, evidenceLevel: string): OpenSemanticTermRecord[] {
  const surfaces: string[] = [];
  const tokens = meaningfulRawEvidenceTokens(quote);
  const originalTokens = originalPhraseTokens(quote);

  for (const token of quote.match(/[A-Za-z][A-Za-z0-9+#.]*/g) ?? []) {
    const cleaned = token.replace(/^[^A-Za-z0-9+#]+|[^A-Za-z0-9+#]+$/g, '');
    if (/[a-z][A-Z]/.test(cleaned) || /[A-Za-z]+[0-9]/.test(cleaned)) {
      surfaces.push(cleaned);
    }
  }

  for (let size = 4; size >= 2; size--) {
    for (let index = 0; index <= originalTokens.length - size; index++) {
      const ngram = originalTokens.slice(index, index + size);
      if (!ngram.some((token) => token.length >= 4)) continue;
      const surface = ngram.join(' ');
      surfaces.push(surface, compactLanguageNames(surface));
    }
  }

  for (let size = 4; size >= 2; size--) {
    for (let index = 0; index <= tokens.length - size; index++) {
      const ngram = tokens.slice(index, index + size);
      if (!ngram.some((token) => token.length >= 4)) continue;
      surfaces.push(ngram.join(' '));
    }
  }

  surfaces.push(...extractOpenIdentifierTerms([quote], 32).map((term) => term.surface));

  const terms = new Map<string, OpenSemanticTermRecord>();
  for (const surface of surfaces) {
    const term = openSemanticTermRecord(surface, evidenceLevel);
    if (term && !terms.has(term.canonical_key)) {
      terms.set(term.canonical_key, term);
    }
  }
  const meaningfulTerms = [...terms.values()].filter((term) =>
    rawReviewEvidenceDistinctiveSegments(term).length > 0
    || rawReviewEvidenceHasTechnicalShape(term)
  );
  const sorted = meaningfulTerms.sort((left, right) =>
    rawReviewEvidenceTermPriority(right) - rawReviewEvidenceTermPriority(left)
    || left.canonical_key.localeCompare(right.canonical_key)
  );
  return diversifyRawReviewEvidenceTerms(sorted);
}

function rawReviewEvidenceDistinctiveSegments(term: OpenSemanticTermRecord): string[] {
  return term.canonical_key
    .replace(/^term:/, '')
    .split('-')
    .map((segment) => segment.trim())
    .filter((segment) =>
      segment.length >= 3
      && !RAW_EVIDENCE_STOPWORDS.has(segment)
      && !RAW_EVIDENCE_LANGUAGE_SEGMENTS.has(segment)
    );
}

function rawReviewEvidencePrimarySegment(term: OpenSemanticTermRecord): string {
  return rawReviewEvidenceDistinctiveSegments(term)[0]
    ?? term.canonical_key.replace(/^term:/, '');
}

function diversifyRawReviewEvidenceTerms(
  terms: OpenSemanticTermRecord[],
): OpenSemanticTermRecord[] {
  const primaryCounts = new Map<string, number>();
  const firstPass: OpenSemanticTermRecord[] = [];
  const deferred: OpenSemanticTermRecord[] = [];

  for (const term of terms) {
    const primary = rawReviewEvidencePrimarySegment(term);
    const count = primaryCounts.get(primary) ?? 0;
    if (count === 0) {
      firstPass.push(term);
      primaryCounts.set(primary, 1);
    } else {
      deferred.push(term);
      primaryCounts.set(primary, count + 1);
    }
  }

  return [...firstPass, ...deferred];
}

function rawReviewEvidenceHasTechnicalShape(term: OpenSemanticTermRecord): boolean {
  const canonical = term.canonical_key.replace(/^term:/, '');
  return /[a-z][A-Z]/.test(term.surface)
    || /\b[A-Z]{2,}\b/.test(term.surface)
    || /[A-Za-z0-9]+-[A-Za-z0-9]+/.test(term.surface)
    || /[./#]/.test(term.surface)
    || /(^|-)javascript(-|$)|(^|-)typescript(-|$)|(^|-)type-script(-|$)/.test(canonical);
}

function rawReviewEvidenceTermPriority(term: OpenSemanticTermRecord): number {
  const canonical = term.canonical_key.replace(/^term:/, '');
  const segmentCount = canonical.split('-').filter(Boolean).length;
  const compactPhrase = segmentCount >= 2 && segmentCount <= 3 ? 30 : 0;
  const longMechanism = segmentCount === 4 ? 12 : 0;
  const languageLike = /(^|-)javascript(-|$)|(^|-)typescript(-|$)|(^|-)type-script(-|$)/.test(canonical) ? 8 : 0;
  const technicalShape = rawReviewEvidenceHasTechnicalShape(term) ? 80 : 0;
  const mechanismSurface = canonical.replace(/-/g, ' ');
  const softwareMechanism = /\b(api|apis|cli|configuration|cron|deploy|deployments|queue|queues|regression|routing|runtime|schedule|schedules|sdk|stack|stacks|test|tests|trace|traces|workflow|workflows)\b/.test(mechanismSurface) ? 24 : 0;
  const distinctiveSegmentBonus = Math.min(24, rawReviewEvidenceDistinctiveSegments(term).length * 6);
  const tooLongPenalty = Math.max(0, segmentCount - 4) * 4;
  return Math.max(technicalShape, languageLike) + softwareMechanism + compactPhrase + longMechanism + distinctiveSegmentBonus - tooLongPenalty;
}

function rawReviewEvidenceNodes(
  candidateId: string,
  resumeText: string,
): Array<Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'>> {
  const nodes: Array<Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'>> = [];
  const capturedAt = nowEpoch();
  const seenTerms = new Set<string>();
  const quotes = rawReviewEvidenceQuotes(resumeText);

  const quoteTerms = quotes.map((quote) => {
    const evidenceLevel = rawReviewEvidenceLevel(quote);
    return {
      quote,
      evidenceLevel,
      terms: rawReviewEvidenceTerms(quote, evidenceLevel),
      nextIndex: 0,
    };
  });

  while (nodes.length < RAW_REVIEW_EVIDENCE_NODE_LIMIT) {
    let addedInRound = false;
    for (const entry of quoteTerms) {
      while (entry.nextIndex < entry.terms.length) {
        const term = entry.terms[entry.nextIndex]!;
        entry.nextIndex++;
        if (seenTerms.has(term.canonical_key)) continue;
        seenTerms.add(term.canonical_key);
        nodes.push({
          candidate_id: candidateId,
          node_type: 'ReviewEvidence',
          narrative_text: `Candidate supplied review evidence for ${term.surface}: ${entry.quote.slice(0, 500)}`,
          extracted_properties_json: JSON.stringify({
            source: 'resume_text_intake',
            term_surface: term.surface,
            term_canonical_key: term.canonical_key,
            semantic_terms: [term],
            ...sourceQuoteProperties(resumeText, entry.quote),
            index: nodes.length,
          }),
          embedding_json: null,
          source_type: 'resume',
          source_reference: `resume:review-evidence:${nodes.length}`,
          captured_at: capturedAt,
          confidence: RAW_REVIEW_EVIDENCE_CONFIDENCE,
          supersedes: null,
          superseded_at: null,
          decomposition_version: DECOMPOSITION_VERSION,
        });
        addedInRound = true;
        if (nodes.length >= RAW_REVIEW_EVIDENCE_NODE_LIMIT) return nodes;
        break;
      }
    }
    if (!addedInRound) break;
  }

  return nodes;
}

function experienceToNode(
  candidateId: string,
  exp: DecomposedExperience,
  index: number,
  resumeText: string,
): Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> {
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
      semantic_terms: mergeSemanticTerms(
        exp.semantic_terms,
        exp.skills_demonstrated,
        'demonstrated',
      ),
      ...sourceQuoteProperties(resumeText, exp.source_quote),
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
  resumeText: string,
): Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> {
  return {
    candidate_id: candidateId,
    node_type: 'Project',
    narrative_text: `${proj.name}: ${proj.description}`,
    extracted_properties_json: JSON.stringify({
      name: proj.name,
      description: proj.description,
      url: proj.url,
      skills_demonstrated: proj.skills_demonstrated,
      semantic_terms: mergeSemanticTerms(
        proj.semantic_terms,
        proj.skills_demonstrated,
        'demonstrated',
      ),
      ...sourceQuoteProperties(resumeText, proj.source_quote),
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
  resumeText: string,
): Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> {
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
      semantic_terms: mergeSemanticTerms(
        skill.semantic_terms,
        [skill.name],
        'mentioned',
      ),
      ...sourceQuoteProperties(resumeText, skill.source_quote),
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
  resumeText: string,
): Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> {
  return {
    candidate_id: candidateId,
    node_type: 'Education',
    narrative_text: `${edu.degree}${edu.field ? ` in ${edu.field}` : ''} from ${edu.institution}${edu.year ? ` (${edu.year})` : ''}`,
    extracted_properties_json: JSON.stringify({
      institution: edu.institution,
      degree: edu.degree,
      field: edu.field,
      year: edu.year,
      semantic_terms: mergeSemanticTerms(edu.semantic_terms, [], 'mentioned'),
      ...sourceQuoteProperties(resumeText, edu.source_quote),
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
  resumeText: string,
): Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> {
  return {
    candidate_id: candidateId,
    node_type: 'Credential',
    narrative_text: `${cred.name}${cred.issuer ? ` — ${cred.issuer}` : ''}${cred.year ? ` (${cred.year})` : ''}`,
    extracted_properties_json: JSON.stringify({
      name: cred.name,
      issuer: cred.issuer,
      year: cred.year,
      semantic_terms: mergeSemanticTerms(cred.semantic_terms, [], 'mentioned'),
      ...sourceQuoteProperties(resumeText, cred.source_quote),
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
  resumeText: string,
): Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> {
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
      semantic_terms: mergeSemanticTerms(arc.semantic_terms, [], 'mentioned'),
      ...sourceQuoteProperties(resumeText, arc.source_quote),
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
  _db: import('@cloudflare/workers-types').D1Database,
  candidateId: string,
  parsedCV: ParsedCV,
  resumeText: string,
  env: Env,
): Promise<{ inserted: number; embedded: number; errors: string[]; embeddings: number[][] }> {
  const errors: string[] = [];
  let inserted = 0;
  let embedded = 0;
  const embeddings: number[][] = [];
  const candidateNodes: CandidateNode[] = [];
  const now = nowEpoch();

  const nodesToInsert: Array<Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'>> = [
    ...rawReviewEvidenceNodes(candidateId, resumeText),
  ];

  // Canonicalize parser-extracted skills and create Skill nodes
  const canonicalSkills = parsedCV.skills.length > 0
    ? await slugifySkills(_db, parsedCV.skills)
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
        semantic_terms: mergeSemanticTerms(undefined, [skill], 'mentioned'),
        index: i,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: null,
      captured_at: now,
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
        semantic_terms: mergeSemanticTerms(
          undefined,
          extractOpenIdentifierTerms([exp.role, exp.description], 24).map((term) => term.surface),
          'demonstrated',
        ),
        index: i,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: null,
      captured_at: now,
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
      captured_at: now,
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
      captured_at: now,
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
        semantic_terms: mergeSemanticTerms(
          undefined,
          extractOpenIdentifierTerms([proj.name, proj.description], 24).map((term) => term.surface),
          'demonstrated',
        ),
        index: i,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: null,
      captured_at: now,
      confidence: DEFAULT_CONFIDENCE,
      supersedes: null,
      superseded_at: null,
      decomposition_version: DECOMPOSITION_VERSION,
    });
  }

  if (nodesToInsert.length === 0 && resumeText.trim().length >= 20) {
    const sourceQuote = resumeText.trim().slice(0, 4000);
    nodesToInsert.push({
      candidate_id: candidateId,
      node_type: 'Experience',
      narrative_text: `Candidate supplied resume evidence: ${sourceQuote.slice(0, 500)}`,
      extracted_properties_json: JSON.stringify({
        source: 'text_intake_fallback',
        semantic_terms: extractOpenIdentifierTerms([sourceQuote], 48).map((term) => ({
          surface: term.surface,
          canonical_key: term.canonicalKey,
          evidence_level: 'used',
        })),
        ...sourceQuoteProperties(resumeText, sourceQuote),
        index: 0,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: null,
      captured_at: now,
      confidence: DEFAULT_CONFIDENCE,
      supersedes: null,
      superseded_at: null,
      decomposition_version: DECOMPOSITION_VERSION,
    });
  }

  // Persist every node before embedding so source-backed evidence survives AI
  // outages or slow embedding calls.
  for (const node of nodesToInsert) {
    try {
      const insertedNode = await insertCandidateNode(_db, node);
      candidateNodes.push(insertedNode);
      inserted++;
    } catch (insertErr) {
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
      errors.push(`Insert failed for ${node.node_type}: ${msg}`);
    }
  }

  for (const insertedNode of candidateNodes) {
    try {
      const embedding = await embedCandidateNode(insertedNode.narrative_text, env as unknown as Parameters<typeof embedCandidateNode>[1]);
      const embeddingJson = JSON.stringify(embedding);
      await _db.prepare(
        `UPDATE candidate_nodes SET embedding_json = ?1, updated_at = unixepoch() WHERE id = ?2`,
      ).bind(embeddingJson, insertedNode.id).run();
      insertedNode.embedding_json = embeddingJson;
      embedded++;
      embeddings.push(embedding);
    } catch (embedErr) {
      const msg = embedErr instanceof Error ? embedErr.message : String(embedErr);
      errors.push(`Embed failed for ${insertedNode.node_type}: ${msg}`);
    }
  }

  // Write to Neo4j
  if (candidateNodes.length > 0) {
    try {
      await writeCandidateGraph({ candidateId, nodes: candidateNodes, env });
    } catch (writeErr) {
      const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      errors.push(`Neo4j write failed: ${msg}`);
    }
  }

  return { inserted, embedded, errors, embeddings };
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
    embeddings: [],
  };

  // Step 1: Use provided decomposition or fall back to parser-only nodes
  let decomposition: DecompositionResult | null = decompositionResult ?? null;

  // Step 2: Build node list
  const nodesToInsert: Array<Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'>> = [
    ...rawReviewEvidenceNodes(candidateId, resumeText),
  ];

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
      nodesToInsert.push(experienceToNode(candidateId, exp, i, resumeText));
    }
    for (let i = 0; i < decomposition.projects.length; i++) {
      const proj = decomposition.projects[i]!;
      nodesToInsert.push(projectToNode(candidateId, proj, i, resumeText));
    }
    for (let i = 0; i < decomposition.skills.length; i++) {
      const skill = decomposition.skills[i]!;
      nodesToInsert.push(skillToNode(candidateId, skill, i, resumeText));
    }
    for (let i = 0; i < decomposition.education.length; i++) {
      const edu = decomposition.education[i]!;
      nodesToInsert.push(educationToNode(candidateId, edu, i, resumeText));
    }
    for (let i = 0; i < decomposition.credentials.length; i++) {
      const cred = decomposition.credentials[i]!;
      nodesToInsert.push(credentialToNode(candidateId, cred, i, resumeText));
    }
    nodesToInsert.push(careerArcToNode(candidateId, decomposition.career_arc, decomposition, resumeText));
  } else {
    // No decomposition — fall back to parser-only nodes with lower confidence
    console.log('[resumeDecomposition] No decomposition result provided; falling back to parser-only nodes');
    const fallback = await writeParserOnlyNodes(db, candidateId, parsedCV, resumeText, env);
    result.nodesInserted = fallback.inserted;
    result.nodesEmbedded = fallback.embedded;
    result.errors.push(...fallback.errors);
    result.embeddings = fallback.embeddings;

    // Still update state and coverage
    try {
      await upsertCandidateProfileState(db, candidateId, 'seed');
    } catch (stateErr) {
      const msg = stateErr instanceof Error ? stateErr.message : String(stateErr);
      result.errors.push(`Profile state update failed: ${msg}`);
    }

    const neo4jConfig = buildNeo4jConfig(env);
    const driver = neo4jConfig ? getNeo4jDriver(neo4jConfig) : null;
    try {
      await computeCandidateCoverageWithFallback(db, candidateId, driver);
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

  // Step 3: Persist every node before embedding so source-backed evidence
  // survives AI outages or slow embedding calls.
  const candidateNodes: CandidateNode[] = [];
  for (const node of nodesToInsert) {
    try {
      const insertedNode = await insertCandidateNode(db, node);
      candidateNodes.push(insertedNode);
      result.nodesInserted++;
    } catch (insertErr) {
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
      console.warn('[resumeDecomposition] Insert failed for', node.node_type, ':', msg);
      result.errors.push(`Insert failed for ${node.node_type}: ${msg}`);
    }
  }

  for (const insertedNode of candidateNodes) {
    try {
      const embedding = await embedCandidateNode(insertedNode.narrative_text, env as unknown as Parameters<typeof embedCandidateNode>[1]);
      const embeddingJson = JSON.stringify(embedding);
      await db.prepare(
        `UPDATE candidate_nodes SET embedding_json = ?1, updated_at = unixepoch() WHERE id = ?2`,
      ).bind(embeddingJson, insertedNode.id).run();
      insertedNode.embedding_json = embeddingJson;
      result.nodesEmbedded++;
      result.embeddings.push(embedding);
    } catch (embedErr) {
      const msg = embedErr instanceof Error ? embedErr.message : String(embedErr);
      console.warn('[resumeDecomposition] Embed failed for', insertedNode.node_type, ':', msg);
      result.errors.push(`Embed failed for ${insertedNode.node_type}: ${msg}`);
    }
  }

  // Write to Neo4j
  if (candidateNodes.length > 0) {
    try {
      await writeCandidateGraph({ candidateId, nodes: candidateNodes, env });
    } catch (writeErr) {
      const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      console.warn('[resumeDecomposition] Neo4j write failed:', msg);
      result.errors.push(`Neo4j write failed: ${msg}`);
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
  const neo4jConfig = buildNeo4jConfig(env);
  const driver = neo4jConfig ? getNeo4jDriver(neo4jConfig) : null;
  try {
    await computeCandidateCoverageWithFallback(db, candidateId, driver);
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
