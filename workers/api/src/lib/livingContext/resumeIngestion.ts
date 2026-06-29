/**
 * Native resume-to-living-context ingestion.
 *
 * Creates proper per-paragraph source spans directly in the living context
 * graph — no legacy candidate-node bridge required.
 *
 * Flow:
 *   1. Ensure person/workspace identity via ensureCandidateLivingContext
 *   2. Create interaction (type: resume_upload)
 *   3. Create artifact + version with full resume text
 *   4. Split resume into structural sections → source spans
 *   5. Create episodes + assertions per section
 *   6. Resolve open terms → concepts + signal evidence
 *   7. Create context records linking assertions to source spans
 *   8. Enqueue neo4j projection
 */

import {
  deterministicEntityId,
  LivingContextStore,
  stableJson,
} from './persistence';
import { ensureCandidateLivingContext } from './compatibility';
import {
  OPEN_TERM_RESOLVER_VERSION,
  openSemanticTerm,
} from './openTerms';
import type { EvidenceLevel, JsonObject, JsonValue } from './types';

const RESUME_INGESTION_VERSION = 'resume-living-context-v1';
const SIGNAL_POLICY_VERSION = 'living-context-signal-noisy-or-v1';

export interface ResumeSection {
  /** Stable identifier for this section across re-ingestions. */
  stableId: string;
  /** Section heading (e.g. "Experience", "Education", "Skills"). */
  heading: string | null;
  /** Raw text content of the section. */
  text: string;
  /** Section type classification. */
  sectionType: ResumeSectionType;
  /** Optional structured metadata for this section. */
  metadata?: JsonObject;
}

export type ResumeSectionType =
  | 'summary'
  | 'experience'
  | 'education'
  | 'skills'
  | 'projects'
  | 'certifications'
  | 'publications'
  | 'awards'
  | 'languages'
  | 'references'
  | 'other';

export interface ResumeAssertionInput {
  /** Which source section IDs this assertion draws from. */
  sourceSectionIds: string[];
  /** The primary section ID where the assertion is grounded. */
  primarySectionId: string;
  /** Assertion predicate (e.g. "has_skill", "worked_at", "studied_at"). */
  predicate: string;
  /** Human-readable narrative describing the assertion. */
  narrative: string;
  /** Optional object type for the assertion (e.g. "company", "skill"). */
  objectType?: string | null;
  /** Optional object value. */
  objectValue?: JsonValue;
  /** Optional qualifiers providing extra context. */
  qualifiers?: JsonObject;
  /** Concepts referenced by this assertion. */
  concepts?: ResumeConceptInput[];
  /** Confidence in this assertion (0-1). */
  confidence?: number | null;
}

export interface ResumeConceptInput {
  /** Surface form as it appears in the resume. */
  surface: string;
  /** Relationship to the assertion. */
  relationship: string;
  /** Weight of this concept in the assertion. */
  weight: number;
  /** Evidence level for signal creation. */
  evidenceLevel?: EvidenceLevel | null;
  /** Signal strength (0-1). */
  strength?: number | null;
}

export interface ResumeIngestionInput {
  /** Candidate ID in the legacy system. */
  candidateId: string;
  /** R2 storage key of the original resume file. */
  storageKey: string;
  /** Media type of the resume (e.g. "application/pdf"). */
  mediaType: string;
  /** Full extracted text content of the resume. */
  resumeText: string;
  /** Structured sections parsed from the resume. */
  sections?: ResumeSection[];
  /** Pre-extracted semantic assertions (from LLM decomposition). */
  semanticAssertions?: ResumeAssertionInput[];
  /** Version of the extraction pipeline that produced assertions. */
  extractorVersion?: string;
  /** When the resume was uploaded. */
  uploadedAt?: string | null;
}

export interface ResumeIngestionResult {
  personId: string;
  workspacePersonId: string;
  applicationId: string;
  interactionId: string;
  artifactId: string;
  artifactVersionId: string;
  sourceSpanCount: number;
  assertionCount: number;
  conceptCount: number;
  signalEvidenceCount: number;
}

interface CanonicalSection {
  stableId: string;
  heading: string | null;
  text: string;
  sectionType: ResumeSectionType;
  charStart: number;
  charEnd: number;
  byteStart: number;
  byteEnd: number;
  lineStart: number;
  lineEnd: number;
  metadata: JsonObject;
}

function lineNumberAt(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index++) {
    if (content[index] === '\n') line++;
  }
  return line;
}

function nonEmptyTextRange(content: string, start: number, end: number): [number, number] | null {
  while (start < end && /\s/.test(content[start] ?? '')) start++;
  while (end > start && /\s/.test(content[end - 1] ?? '')) end--;
  return start < end ? [start, end] : null;
}

function boundedScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function boundedPolarity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1
    ? value
    : 1;
}

const SECTION_HEADING_PATTERNS: Array<[RegExp, ResumeSectionType]> = [
  [/^(professional\s+)?summary|^(career\s+)?objective|^profile|^about/i, 'summary'],
  [/^(work\s+)?experience|^employment|^career\s+history|^professional\s+history/i, 'experience'],
  [/^education|^academic|^qualifications/i, 'education'],
  [/^(technical\s+)?skills|^competencies|^technologies|^tools/i, 'skills'],
  [/^projects|^personal\s+projects|^portfolio/i, 'projects'],
  [/^certifications?|^licenses?/i, 'certifications'],
  [/^publications?|^papers|^research/i, 'publications'],
  [/^awards?|^honors?|^achievements?/i, 'awards'],
  [/^languages?/i, 'languages'],
  [/^references?/i, 'references'],
];

function classifySection(heading: string | null): ResumeSectionType {
  if (!heading) return 'other';
  const trimmed = heading.trim();
  for (const [pattern, sectionType] of SECTION_HEADING_PATTERNS) {
    if (pattern.test(trimmed)) return sectionType;
  }
  return 'other';
}

/**
 * Split plain resume text into structural sections by detecting headings.
 * Falls back to paragraph splitting when no headings are found.
 */
export function splitResumeIntoSections(resumeText: string): ResumeSection[] {
  const headingPattern = /^([A-Z][A-Z\s&/,]{2,})(?:\s*[:—–-])?\s*$/gm;
  const headingMatches: Array<{ heading: string; index: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(resumeText)) !== null) {
    headingMatches.push({ heading: match[1]!.trim(), index: match.index });
  }

  if (headingMatches.length >= 2) {
    const sections: ResumeSection[] = [];
    for (let i = 0; i < headingMatches.length; i++) {
      const current = headingMatches[i]!;
      const next = headingMatches[i + 1];
      const sectionEnd = next ? next.index : resumeText.length;
      const headingEnd = resumeText.indexOf('\n', current.index);
      const bodyStart = headingEnd >= 0 ? headingEnd + 1 : current.index + current.heading.length;
      const text = resumeText.slice(bodyStart, sectionEnd).trim();
      if (text.length > 0) {
        const sectionType = classifySection(current.heading);
        sections.push({
          stableId: `section-${String(i + 1).padStart(3, '0')}-${sectionType}`,
          heading: current.heading,
          text,
          sectionType,
        });
      }
    }
    const preambleText = resumeText.slice(0, headingMatches[0]!.index).trim();
    if (preambleText.length > 0) {
      sections.unshift({
        stableId: 'section-000-summary',
        heading: null,
        text: preambleText,
        sectionType: 'summary',
      });
    }
    return sections;
  }

  const paragraphs = resumeText.split(/\n\s*\n+/).filter((p) => p.trim().length > 0);
  return paragraphs.map((paragraph, index) => ({
    stableId: `paragraph-${String(index + 1).padStart(4, '0')}`,
    heading: null,
    text: paragraph.trim(),
    sectionType: index === 0 ? 'summary' as ResumeSectionType : 'other' as ResumeSectionType,
  }));
}

function canonicalizeSections(
  resumeText: string,
  sections: ResumeSection[],
): CanonicalSection[] {
  const canonicalized: CanonicalSection[] = [];
  const encoder = new TextEncoder();

  for (const section of sections) {
    const startIndex = resumeText.indexOf(section.text);
    const charStart = startIndex >= 0 ? startIndex : 0;
    const charEnd = charStart + section.text.length;
    const range = nonEmptyTextRange(resumeText, charStart, charEnd);
    if (!range) continue;

    canonicalized.push({
      stableId: section.stableId,
      heading: section.heading,
      text: resumeText.slice(range[0], range[1]),
      sectionType: section.sectionType,
      charStart: range[0],
      charEnd: range[1],
      byteStart: encoder.encode(resumeText.slice(0, range[0])).byteLength,
      byteEnd: encoder.encode(resumeText.slice(0, range[1])).byteLength,
      lineStart: lineNumberAt(resumeText, range[0]),
      lineEnd: lineNumberAt(resumeText, Math.max(range[0], range[1] - 1)),
      metadata: section.metadata ?? {},
    });
  }
  return canonicalized;
}

/**
 * Ingest a resume into the living context graph.
 *
 * Creates all necessary entities: interaction, artifact, source spans,
 * episodes, assertions, concepts, signal evidence, and context records.
 * Fully idempotent — re-ingestion with the same candidateId + storageKey
 * updates existing records.
 */
export async function ingestResumeToLivingContext(
  db: D1Database,
  input: ResumeIngestionInput,
): Promise<ResumeIngestionResult | null> {
  const identity = await ensureCandidateLivingContext(db, input.candidateId);
  if (!identity) return null;

  const store = new LivingContextStore(db);
  const { workspacePersonId, applicationId, personId } = identity;
  const ingestionBase = `resume:${input.candidateId}:${input.storageKey}`;

  // 1. Create interaction
  const interaction = await store.upsertInteraction({
    ingestionKey: `${ingestionBase}:interaction`,
    workspacePersonId,
    applicationId,
    interactionType: 'resume_upload',
    externalReference: input.storageKey,
    startedAt: input.uploadedAt ?? new Date().toISOString(),
    metadata: {
      mediaType: input.mediaType,
      storageKey: input.storageKey,
      extractorVersion: input.extractorVersion ?? RESUME_INGESTION_VERSION,
    },
  });

  // 2. Create artifact + version
  const artifact = await store.upsertArtifact({
    ingestionKey: `${ingestionBase}:artifact`,
    workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'resume',
    logicalKey: input.storageKey,
    metadata: { mediaType: input.mediaType },
  });

  const contentHash = await deterministicEntityId('content', input.resumeText);
  const byteLength = new TextEncoder().encode(input.resumeText).byteLength;
  const version = await store.createArtifactVersion({
    ingestionKey: `${ingestionBase}:version:1`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/plain',
    contentText: input.resumeText,
    storageKey: input.storageKey,
    byteLength,
    metadata: {
      originalMediaType: input.mediaType,
      extractorVersion: input.extractorVersion ?? RESUME_INGESTION_VERSION,
    },
  });

  // 3. Split into sections and create source spans
  const rawSections = input.sections ?? splitResumeIntoSections(input.resumeText);
  const sections = canonicalizeSections(input.resumeText, rawSections);

  const spanMap = new Map<string, string>();
  for (const section of sections) {
    const span = await store.createSourceSpan({
      ingestionKey: `${ingestionBase}:span:${section.stableId}`,
      artifactVersionId: version.id,
      stableSegmentId: section.stableId,
      byteStart: section.byteStart,
      byteEnd: section.byteEnd,
      charStart: section.charStart,
      charEnd: section.charEnd,
      lineStart: section.lineStart,
      lineEnd: section.lineEnd,
      exactText: section.text,
      metadata: {
        ...section.metadata,
        heading: section.heading,
        sectionType: section.sectionType,
      },
    });
    spanMap.set(section.stableId, span.id);
  }

  // 4. Process semantic assertions
  let assertionCount = 0;
  let conceptCount = 0;
  let signalEvidenceCount = 0;
  const processedConcepts = new Set<string>();

  const assertions = input.semanticAssertions ?? buildDefaultAssertions(sections);
  for (const assertionInput of assertions) {
    const primarySpanId = spanMap.get(assertionInput.primarySectionId);
    if (!primarySpanId) continue;

    const episode = await store.upsertEpisode({
      ingestionKey: `${ingestionBase}:episode:${assertionInput.primarySectionId}:${assertionInput.predicate}`,
      workspacePersonId,
      interactionId: interaction.id,
      narrative: assertionInput.narrative,
    });

    const assertion = await store.upsertAssertion({
      ingestionKey: `${ingestionBase}:assertion:${assertionInput.primarySectionId}:${assertionInput.predicate}`,
      workspacePersonId,
      episodeId: episode.id,
      subjectType: 'workspace_person',
      subjectId: workspacePersonId,
      predicate: assertionInput.predicate,
      objectType: assertionInput.objectType ?? null,
      objectValue: assertionInput.objectValue ?? null,
      narrative: assertionInput.narrative,
      qualifiers: assertionInput.qualifiers ?? {},
      confidence: boundedScore(assertionInput.confidence) ?? 0.8,
      extractionVersion: input.extractorVersion ?? RESUME_INGESTION_VERSION,
      observedAt: input.uploadedAt ?? new Date().toISOString(),
    });
    assertionCount++;

    // Link assertion to all referenced source spans
    for (const sectionId of assertionInput.sourceSectionIds) {
      const spanId = spanMap.get(sectionId);
      if (spanId) {
        await store.linkAssertionSourceSpan(assertion.id, spanId);
      }
    }
    // Always link primary span
    await store.linkAssertionSourceSpan(assertion.id, primarySpanId);

    // 5. Resolve concepts and create signal evidence
    const contextRecordConcepts: Array<{
      conceptId: string;
      relationship: string;
      weight: number;
    }> = [];

    const concepts = assertionInput.concepts ?? [];
    for (const conceptInput of concepts) {
      const term = openSemanticTerm(conceptInput.surface);
      if (!term) continue;

      const concept = await store.upsertConcept({
        ingestionKey: `open-term:${term.canonicalKey}`,
        canonicalKey: term.canonicalKey,
        namespace: 'term',
        label: conceptInput.surface,
        metadata: {
          resolver: OPEN_TERM_RESOLVER_VERSION,
          source: 'resume_ingestion',
        },
      });

      if (!processedConcepts.has(concept.id)) {
        processedConcepts.add(concept.id);
        conceptCount++;
      }

      await store.linkAssertionConcept(
        assertion.id,
        concept.id,
        conceptInput.relationship,
        conceptInput.weight,
      );

      contextRecordConcepts.push({
        conceptId: concept.id,
        relationship: conceptInput.relationship,
        weight: conceptInput.weight,
      });

      // Create signal evidence if eligible
      const evidenceLevel = conceptInput.evidenceLevel ?? null;
      const strength = boundedScore(conceptInput.strength) ?? boundedScore(assertionInput.confidence) ?? 0.7;
      if (evidenceLevel && strength > 0) {
        await store.upsertSignalEvidence({
          ingestionKey: `${ingestionBase}:evidence:${assertion.id}:${term.canonicalKey}`,
          workspacePersonId,
          interactionId: interaction.id,
          assertionId: assertion.id,
          conceptId: concept.id,
          signalKey: term.canonicalKey,
          evidenceLevel,
          strength,
          observedAt: input.uploadedAt ?? new Date().toISOString(),
          metadata: {
            sourceType: 'resume',
            resolver: OPEN_TERM_RESOLVER_VERSION,
            policyVersion: SIGNAL_POLICY_VERSION,
          },
        });
        signalEvidenceCount++;
      }
    }

    // 6. Create context record
    const sourceRefs = assertionInput.sourceSectionIds
      .map((sectionId) => spanMap.get(sectionId))
      .filter((id): id is string => Boolean(id))
      .map((spanId) => ({ sourceSpanId: spanId, evidenceRole: 'source' as const }));
    if (!sourceRefs.some((ref) => ref.sourceSpanId === primarySpanId)) {
      sourceRefs.push({ sourceSpanId: primarySpanId, evidenceRole: 'source' as const });
    }

    await store.upsertContextRecord({
      ingestionKey: `${ingestionBase}:context-record:${assertionInput.primarySectionId}:${assertionInput.predicate}`,
      workspacePersonId,
      interactionId: interaction.id,
      applicationId,
      episodeId: episode.id,
      assertionId: assertion.id,
      recordType: 'resume_assertion',
      predicate: assertionInput.predicate,
      narrative: assertionInput.narrative,
      qualifiers: assertionInput.qualifiers ?? {},
      confidence: boundedScore(assertionInput.confidence) ?? 0.8,
      extractionVersion: input.extractorVersion ?? RESUME_INGESTION_VERSION,
      observedAt: input.uploadedAt ?? new Date().toISOString(),
      sources: sourceRefs,
      entities: [
        {
          entityType: 'workspace_person',
          entityId: workspacePersonId,
          relationship: 'subject',
        },
        {
          entityType: 'artifact',
          entityId: artifact.id,
          relationship: 'source_artifact',
        },
      ],
      concepts: contextRecordConcepts,
    });
  }

  // 7. Enqueue neo4j projection
  await store.enqueueProjection({
    ingestionKey: `${ingestionBase}:neo4j`,
    projectionType: 'neo4j',
    aggregateType: 'workspace_person',
    aggregateId: workspacePersonId,
    payload: {
      trigger: 'resume_ingestion',
      interactionId: interaction.id,
      artifactId: artifact.id,
    },
  });

  return {
    personId,
    workspacePersonId,
    applicationId,
    interactionId: interaction.id,
    artifactId: artifact.id,
    artifactVersionId: version.id,
    sourceSpanCount: spanMap.size,
    assertionCount,
    conceptCount,
    signalEvidenceCount,
  };
}

/**
 * Build default assertions from sections when no LLM extraction is available.
 * Creates one assertion per section based on section type.
 */
function buildDefaultAssertions(sections: CanonicalSection[]): ResumeAssertionInput[] {
  const assertions: ResumeAssertionInput[] = [];

  for (const section of sections) {
    const predicate = sectionTypeToPredicate(section.sectionType);
    const narrative = section.text.length > 200
      ? section.text.slice(0, 200) + '...'
      : section.text;

    const concepts = extractConceptsFromText(section.text, section.sectionType);

    assertions.push({
      sourceSectionIds: [section.stableId],
      primarySectionId: section.stableId,
      predicate,
      narrative,
      objectType: section.sectionType,
      qualifiers: {
        heading: section.heading,
        sectionType: section.sectionType,
        fullTextLength: section.text.length,
      },
      concepts,
      confidence: 0.7,
    });
  }
  return assertions;
}

function sectionTypeToPredicate(sectionType: ResumeSectionType): string {
  switch (sectionType) {
    case 'summary': return 'describes_self';
    case 'experience': return 'worked_at';
    case 'education': return 'studied_at';
    case 'skills': return 'has_skill';
    case 'projects': return 'built_project';
    case 'certifications': return 'holds_certification';
    case 'publications': return 'published';
    case 'awards': return 'received_award';
    case 'languages': return 'speaks_language';
    case 'references': return 'referenced_by';
    default: return 'states';
  }
}

/**
 * Extract concepts from text content using lightweight heuristic detection.
 * Identifies technical terms, tools, and domain concepts.
 */
function extractConceptsFromText(
  text: string,
  sectionType: ResumeSectionType,
): ResumeConceptInput[] {
  const concepts: ResumeConceptInput[] = [];
  const seen = new Set<string>();

  const technicalTermPattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+|[A-Z]{2,}(?:\.[a-z]+)*|[a-z]+(?:\.[a-z]+){2,})\b/g;
  let match: RegExpExecArray | null;
  while ((match = technicalTermPattern.exec(text)) !== null) {
    const surface = match[1]!;
    const normalized = surface.toLowerCase();
    if (normalized.length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);

    const evidenceLevel = sectionTypeToEvidenceLevel(sectionType);
    concepts.push({
      surface,
      relationship: 'about',
      weight: 1,
      evidenceLevel,
      strength: sectionType === 'experience' ? 0.8 : 0.6,
    });
  }

  const toolPattern = /\b(React|Vue|Angular|Node\.?js|TypeScript|Python|Java|Go|Rust|Docker|Kubernetes|AWS|GCP|Azure|PostgreSQL|MongoDB|Redis|GraphQL|REST|gRPC|Terraform|CI\/CD|Git|Linux|Kafka|RabbitMQ|Elasticsearch|Next\.?js|Express|Django|Flask|Spring|Rails|Swift|Kotlin|C\+\+|C#|PHP|Ruby|Scala|Haskell|Elixir|Clojure)\b/gi;
  while ((match = toolPattern.exec(text)) !== null) {
    const surface = match[1]!;
    const normalized = surface.toLowerCase().replace(/\./g, '');
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    concepts.push({
      surface,
      relationship: 'about',
      weight: 1,
      evidenceLevel: sectionTypeToEvidenceLevel(sectionType),
      strength: sectionType === 'skills' ? 0.9 : 0.7,
    });
  }

  return concepts.slice(0, 30);
}

function sectionTypeToEvidenceLevel(sectionType: ResumeSectionType): EvidenceLevel {
  switch (sectionType) {
    case 'experience': return 'implemented';
    case 'projects': return 'demonstrated';
    case 'skills': return 'used';
    case 'education': return 'explained';
    case 'certifications': return 'validated';
    default: return 'mentioned';
  }
}
