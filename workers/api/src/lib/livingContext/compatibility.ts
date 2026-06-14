import type { CandidateNode } from '../../types';
import { LivingContextStore, deterministicEntityId } from './persistence';
import {
  normalizeOpenTermSurface,
  OPEN_TERM_RESOLVER_VERSION,
  openSemanticTerm,
  type OpenSemanticTerm,
} from './openTerms';
import type { EvidenceLevel } from './types';

interface LegacyCandidateIdentity {
  id: string;
  owner_id: string;
  pipeline_id: string | null;
  name: string | null;
  email: string | null;
  status: string;
}

interface LegacyContactIdentity {
  id: string;
  owner_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  type: string;
}

function identityKey(email: string | null, fallback: string): string {
  const normalized = email?.trim().toLowerCase();
  return normalized ? `email:${normalized}` : fallback;
}

async function existingPersonIngestionKey(
  db: D1Database,
  email: string | null,
  candidateId?: string,
): Promise<string | null> {
  if (candidateId) {
    const linked = await db.prepare(
      `SELECT p.ingestion_key
         FROM applications app
         JOIN workspace_people wp ON wp.id = app.workspace_person_id
         JOIN people p ON p.id = wp.person_id
        WHERE app.legacy_candidate_id = ?1`,
    ).bind(candidateId).first<{ ingestion_key: string }>();
    if (linked?.ingestion_key) return linked.ingestion_key;
  }
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  const byEmail = await db.prepare(
    `SELECT ingestion_key FROM people
      WHERE primary_email = ?1
      ORDER BY created_at
      LIMIT 1`,
  ).bind(normalized).first<{ ingestion_key: string }>();
  return byEmail?.ingestion_key ?? null;
}

function evidenceLevel(value: unknown): EvidenceLevel | null {
  const level = value;
  if (
    level === 'mentioned'
    || level === 'used'
    || level === 'explained'
    || level === 'selected'
    || level === 'implemented'
    || level === 'demonstrated'
    || level === 'validated'
  ) {
    return level;
  }
  return null;
}

export interface CandidateSemanticTerm extends OpenSemanticTerm {
  signalEligible: boolean;
  evidenceLevel: EvidenceLevel | null;
}

export function candidateNodeTerms(node: CandidateNode): CandidateSemanticTerm[] {
  try {
    const properties = node.extracted_properties_json
      ? JSON.parse(node.extracted_properties_json) as {
          semantic_terms?: Array<{
            surface?: unknown;
            canonical_key?: unknown;
            evidence_level?: unknown;
          }>;
        }
      : {};
    const explicit = Array.isArray(properties.semantic_terms)
      ? properties.semantic_terms.flatMap((term) => {
          if (typeof term.surface !== 'string') return [];
          const resolved = openSemanticTerm(term.surface);
          const canonicalKey = typeof term.canonical_key === 'string'
            && term.canonical_key.trim().length > 0
            ? term.canonical_key.trim()
            : resolved?.canonicalKey;
          const resolvedEvidenceLevel = evidenceLevel(term.evidence_level);
          return resolved && canonicalKey
            ? [{
                surface: resolved.surface,
                canonicalKey,
                signalEligible: resolvedEvidenceLevel !== null,
                evidenceLevel: resolvedEvidenceLevel,
              }]
            : [];
        })
      : [];
    const terms = new Map<string, CandidateSemanticTerm>();
    for (const term of explicit) {
      terms.set(term.canonicalKey, term);
    }
    return [...terms.values()];
  } catch {
    // Preserve the assertion even when legacy properties are malformed.
  }
  return [];
}

export async function ensureCandidateLivingContext(
  db: D1Database,
  candidateId: string,
): Promise<{ personId: string; workspacePersonId: string; applicationId: string } | null> {
  const candidate = await db.prepare(
    `SELECT id, owner_id, pipeline_id, name, email, status
       FROM candidates WHERE id = ?1`,
  ).bind(candidateId).first<LegacyCandidateIdentity>();
  if (!candidate) return null;

  const store = new LivingContextStore(db);
  const personIngestionKey = await existingPersonIngestionKey(db, candidate.email, candidate.id);
  const person = await store.upsertPerson({
    ingestionKey: personIngestionKey ?? identityKey(candidate.email, `candidate:${candidate.id}`),
    displayName: candidate.name,
    primaryEmail: candidate.email,
    externalIds: { legacyCandidateId: candidate.id },
  });
  const workspacePerson = await store.upsertWorkspacePerson({
    ingestionKey: `workspace:${candidate.owner_id}:person:${person.id}`,
    workspaceId: candidate.owner_id,
    personId: person.id,
    context: { source: 'legacy_candidate' },
  });
  const application = await store.upsertApplication({
    ingestionKey: `candidate:${candidate.id}`,
    workspacePersonId: workspacePerson.id,
    legacyCandidateId: candidate.id,
    pipelineId: candidate.pipeline_id,
    status: candidate.status,
  });
  await store.upsertPersonRole({
    ingestionKey: `candidate:${candidate.id}:role`,
    workspacePersonId: workspacePerson.id,
    applicationId: application.id,
    roleType: 'candidate',
    label: 'Candidate',
  });
  return { personId: person.id, workspacePersonId: workspacePerson.id, applicationId: application.id };
}

export async function ensureContactLivingContext(
  db: D1Database,
  contactId: string,
): Promise<{ personId: string; workspacePersonId: string } | null> {
  const contact = await db.prepare(
    `SELECT id, owner_id, name, email, phone, company, role, type
       FROM contacts WHERE id = ?1`,
  ).bind(contactId).first<LegacyContactIdentity>();
  if (!contact) return null;

  const store = new LivingContextStore(db);
  const personIngestionKey = await existingPersonIngestionKey(db, contact.email);
  const person = await store.upsertPerson({
    ingestionKey: personIngestionKey ?? identityKey(contact.email, `contact:${contact.id}`),
    displayName: contact.name,
    primaryEmail: contact.email,
    primaryPhone: contact.phone,
    externalIds: { legacyContactId: contact.id },
  });
  const workspacePerson = await store.upsertWorkspacePerson({
    ingestionKey: `workspace:${contact.owner_id}:person:${person.id}`,
    workspaceId: contact.owner_id,
    personId: person.id,
    context: {
      source: 'legacy_contact',
      contactId: contact.id,
      company: contact.company,
      role: contact.role,
    },
  });
  await store.upsertPersonRole({
    ingestionKey: `contact:${contact.id}:role:${contact.type}`,
    workspacePersonId: workspacePerson.id,
    roleType: contact.type,
    label: contact.role,
    attributes: { company: contact.company },
  });
  return { personId: person.id, workspacePersonId: workspacePerson.id };
}

export async function mirrorCandidateNodeToLivingContext(
  db: D1Database,
  node: CandidateNode,
): Promise<void> {
  const identity = await ensureCandidateLivingContext(db, node.candidate_id);
  if (!identity) return;

  const store = new LivingContextStore(db);
  const interaction = await store.upsertInteraction({
    ingestionKey: `legacy-source:${node.candidate_id}:${node.source_type}:${node.source_reference ?? node.id}`,
    workspacePersonId: identity.workspacePersonId,
    applicationId: identity.applicationId,
    interactionType: node.source_type,
    externalReference: node.source_reference,
    metadata: { compatibilityProjection: true },
  });
  const artifact = await store.upsertArtifact({
    ingestionKey: `candidate-node:${node.id}:artifact`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'legacy_candidate_node',
    logicalKey: node.id,
    metadata: { sourceType: node.source_type },
  });
  const contentHash = await deterministicEntityId('content', node.narrative_text);
  const byteLength = new TextEncoder().encode(node.narrative_text).byteLength;
  const version = await store.createArtifactVersion({
    ingestionKey: `candidate-node:${node.id}:version:1`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/plain',
    contentText: node.narrative_text,
    byteLength,
    metadata: { compatibilityProjection: true },
  });
  const span = await store.createSourceSpan({
    ingestionKey: `candidate-node:${node.id}:span`,
    artifactVersionId: version.id,
    stableSegmentId: node.id,
    byteStart: 0,
    byteEnd: byteLength,
    charStart: 0,
    charEnd: node.narrative_text.length,
    exactText: node.narrative_text,
    metadata: { sourceReference: node.source_reference },
  });
  const episode = await store.upsertEpisode({
    ingestionKey: `candidate-node:${node.id}:episode`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    narrative: node.narrative_text,
  });
  const assertion = await store.upsertAssertion({
    ingestionKey: `candidate-node:${node.id}:assertion`,
    workspacePersonId: identity.workspacePersonId,
    episodeId: episode.id,
    subjectType: 'workspace_person',
    subjectId: identity.workspacePersonId,
    predicate: `node_type:${normalizeOpenTermSurface(String(node.node_type)).replace(/\s+/g, '-')}`,
    objectType: 'narrative',
    objectValue: node.narrative_text,
    narrative: node.narrative_text,
    qualifiers: {
      legacyNodeId: node.id,
      legacyNodeType: node.node_type,
      extractedProperties: node.extracted_properties_json,
    },
    confidence: node.confidence,
    extractionVersion: node.decomposition_version,
    observedAt: new Date(node.captured_at * 1000).toISOString(),
  });
  await store.linkAssertionSourceSpan(assertion.id, span.id);
  await db.prepare(
    `DELETE FROM signal_evidence
      WHERE assertion_id = ?1
        AND json_extract(metadata_json, '$.resolver') IN (
          'open-source-term-v1',
          'open-source-term-v2'
        )`,
  ).bind(assertion.id).run();
  await db.prepare(
    `DELETE FROM assertion_concepts
      WHERE assertion_id = ?1
        AND relationship IN ('about', 'mentions')`,
  ).bind(assertion.id).run();
  for (const term of candidateNodeTerms(node)) {
    const concept = await store.upsertConcept({
      ingestionKey: `open-term:${term.canonicalKey}`,
      canonicalKey: term.canonicalKey,
      namespace: 'term',
      label: term.surface,
      metadata: {
        resolver: OPEN_TERM_RESOLVER_VERSION,
        source: 'legacy_candidate_node',
      },
    });
    await store.linkAssertionConcept(
      assertion.id,
      concept.id,
      term.signalEligible ? 'about' : 'mentions',
      1,
    );
    if (term.signalEligible && term.evidenceLevel && node.confidence !== null) {
      await store.upsertSignalEvidence({
        ingestionKey: `candidate-node:${node.id}:evidence:${term.canonicalKey}`,
        workspacePersonId: identity.workspacePersonId,
        interactionId: interaction.id,
        assertionId: assertion.id,
        conceptId: concept.id,
        signalKey: term.canonicalKey,
        evidenceLevel: term.evidenceLevel,
        strength: node.confidence,
        observedAt: new Date(node.captured_at * 1000).toISOString(),
        metadata: {
          sourceType: node.source_type,
          resolver: OPEN_TERM_RESOLVER_VERSION,
          signalEligibility: 'extractor_explicit',
        },
      });
    }
  }
  await store.enqueueProjection({
    ingestionKey: `candidate-node:${node.id}:neo4j`,
    projectionType: 'neo4j',
    aggregateType: 'workspace_person',
    aggregateId: identity.workspacePersonId,
    payload: { assertionId: assertion.id, legacyCandidateNodeId: node.id },
  });
}
