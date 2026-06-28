import type { Driver } from 'neo4j-driver';
import type { Env } from '../../types';
import { buildNeo4jConfig, createNeo4jDriver } from '../neo4j/driver';
import { runWriteQuery } from '../neo4j/query';
import type { ProjectionOperation } from './types';

interface ProjectionJobRow {
  id: string;
  aggregate_id: string;
  operation: ProjectionOperation;
}

interface WorkspaceIdentityRow {
  workspace_person_id: string;
  workspace_id: string;
  relationship_summary: string | null;
  workspace_context_json: string;
  person_id: string;
  display_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  external_ids_json: string;
}

interface InteractionRow {
  id: string;
  interaction_type: string;
  external_reference: string | null;
  started_at: string | null;
  ended_at: string | null;
  metadata_json: string;
}

interface ApplicationRow {
  id: string;
  legacy_candidate_id: string | null;
  pipeline_id: string | null;
  status: string | null;
  context_json: string;
}

interface PersonRoleRow {
  id: string;
  application_id: string | null;
  role_type: string;
  label: string | null;
  attributes_json: string;
  active_from: string | null;
  active_to: string | null;
}

interface ArtifactRow {
  id: string;
  artifact_type: string;
  logical_key: string | null;
  metadata_json: string;
}

interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version_number: number;
  content_hash: string;
  media_type: string;
  storage_key: string | null;
  byte_length: number | null;
  metadata_json: string;
}

interface SourceSpanRow {
  id: string;
  artifact_version_id: string;
  stable_segment_id: string | null;
  byte_start: number | null;
  byte_end: number | null;
  char_start: number | null;
  char_end: number | null;
  line_start: number | null;
  line_end: number | null;
  timestamp_start_ms: number | null;
  timestamp_end_ms: number | null;
  exact_text: string;
  exact_text_hash: string;
  metadata_json: string;
}

interface InteractionArtifactRow {
  interaction_id: string;
  artifact_id: string;
  relationship: string;
}

interface EpisodeRow {
  id: string;
  interaction_id: string | null;
  narrative: string | null;
  started_at: string | null;
  ended_at: string | null;
  metadata_json: string;
}

interface AssertionRow {
  id: string;
  episode_id: string | null;
  subject_type: string;
  subject_id: string | null;
  predicate: string;
  object_type: string | null;
  object_id: string | null;
  object_value_json: string | null;
  narrative: string;
  qualifiers_json: string;
  confidence: number | null;
  polarity: number;
  extraction_version: string | null;
  observed_at: string | null;
}

interface AssertionSpanRow {
  assertion_id: string;
  source_span_id: string;
  evidence_role: string;
}

interface SourceSpanAttributionRow {
  source_span_id: string;
  attribution_source: string;
  confidence: number | null;
  metadata_json: string;
}

interface ConceptRow {
  id: string;
  canonical_key: string;
  namespace: string;
  label: string;
  description: string | null;
  aliases_json: string;
  metadata_json: string;
}

interface AssertionConceptRow {
  assertion_id: string;
  concept_id: string;
  relationship: string;
  weight: number;
}

interface SignalEvidenceRow {
  id: string;
  interaction_id: string | null;
  assertion_id: string;
  concept_id: string | null;
  signal_key: string;
  evidence_level: string;
  strength: number;
  polarity: number;
  observed_at: string | null;
  metadata_json: string;
}

interface SignalSnapshotRow {
  id: string;
  signal_key: string;
  interaction_id: string | null;
  as_of: string;
  conversation_score: number | null;
  total_score: number;
  confidence: number;
  evidence_count: number;
  source_diversity: number;
  dimensions_json: string;
  policy_version: string;
}

interface SemanticRelationshipRow {
  id: string;
  from_entity_type: string;
  from_entity_id: string;
  predicate: string;
  to_entity_type: string | null;
  to_entity_id: string | null;
  to_value_json: string | null;
  qualifiers_json: string;
  confidence: number | null;
  source_assertion_id: string | null;
}

interface ContextRecordRow {
  id: string;
  scope_type: string;
  scope_id: string;
  interaction_id: string | null;
  application_id: string | null;
  episode_id: string | null;
  assertion_id: string | null;
  record_type: string;
  predicate: string | null;
  narrative: string;
  qualifiers_json: string;
  confidence: number | null;
  polarity: number;
  extraction_version: string | null;
  observed_at: string | null;
}

interface ContextRecordSourceRefRow {
  context_record_id: string;
  source_ref_type: string;
  source_ref_id: string;
  source_span_id: string | null;
  evidence_role: string;
  locator_json: string;
  exact_text: string | null;
  content_hash: string | null;
  metadata_json: string;
}

interface ContextRecordEntityRow {
  context_record_id: string;
  entity_key: string;
  entity_type: string;
  entity_id: string | null;
  relationship: string;
  value_json: string | null;
  confidence: number | null;
  metadata_json: string;
}

interface ContextRecordConceptRow {
  context_record_id: string;
  concept_id: string;
  canonical_key: string;
  namespace: string;
  label: string;
  description: string | null;
  aliases_json: string;
  metadata_json: string;
  relationship: string;
  weight: number;
}

async function clearWorkspacePersonProjection(
  driver: Driver,
  workspacePersonId: string,
  deleteIdentity = false,
): Promise<void> {
  await runWriteQuery(
    driver,
    `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
     OPTIONAL MATCH (wp)-[:HAS_CONTEXT_ENTITY]->(entity)
     DETACH DELETE entity`,
    { workspace_person_id: workspacePersonId },
  );
  await runWriteQuery(
    driver,
    `MATCH ()-[r:ATTRIBUTED_TO]->(wp:WorkspacePerson {
       workspace_person_id: $workspace_person_id
     })
     DELETE r`,
    { workspace_person_id: workspacePersonId },
  );
  await runWriteQuery(
    driver,
    `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
           -[:HAS_ASSERTION]->(legacy:SemanticAssertion)
     DETACH DELETE legacy`,
    { workspace_person_id: workspacePersonId },
  );
  if (deleteIdentity) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       DETACH DELETE wp`,
      { workspace_person_id: workspacePersonId },
    );
  }
}

async function projectWorkspacePerson(
  env: Env,
  driver: Driver,
  workspacePersonId: string,
): Promise<void> {
  const identity = await env.DB.prepare(
    `SELECT wp.id AS workspace_person_id, wp.workspace_id,
            wp.relationship_summary, wp.context_json AS workspace_context_json,
            p.id AS person_id, p.display_name, p.primary_email, p.primary_phone,
            p.external_ids_json
       FROM workspace_people wp
       JOIN people p ON p.id = wp.person_id
      WHERE wp.id = ?1`,
  ).bind(workspacePersonId).first<WorkspaceIdentityRow>();

  await clearWorkspacePersonProjection(driver, workspacePersonId);
  if (!identity) return;

  const [
    applications,
    personRoles,
    interactions,
    artifacts,
    artifactVersions,
    sourceSpans,
    interactionArtifacts,
    episodes,
    assertions,
    assertionSpans,
    sourceSpanAttributions,
    concepts,
    assertionConcepts,
    signalEvidence,
    signalSnapshots,
    semanticRelationships,
    contextRecords,
    contextRecordSourceRefs,
    contextRecordEntities,
    contextRecordConcepts,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT id, legacy_candidate_id, pipeline_id, status, context_json
         FROM applications
        WHERE workspace_person_id = ?1
        ORDER BY created_at, id`,
    ).bind(workspacePersonId).all<ApplicationRow>(),
    env.DB.prepare(
      `SELECT id, application_id, role_type, label, attributes_json,
              active_from, active_to
         FROM person_roles
        WHERE workspace_person_id = ?1
        ORDER BY COALESCE(active_from, created_at), id`,
    ).bind(workspacePersonId).all<PersonRoleRow>(),
    env.DB.prepare(
      `SELECT id, interaction_type, external_reference, started_at, ended_at, metadata_json
         FROM interactions
        WHERE workspace_person_id = ?1
        ORDER BY COALESCE(started_at, created_at), id`,
    ).bind(workspacePersonId).all<InteractionRow>(),
    env.DB.prepare(
      `SELECT DISTINCT a.id, a.artifact_type, a.logical_key, a.metadata_json
         FROM artifacts a
         LEFT JOIN artifact_interactions ai ON ai.artifact_id = a.id
         LEFT JOIN interactions linked_i ON linked_i.id = ai.interaction_id
        WHERE a.workspace_person_id = ?1
           OR a.interaction_id IN (
             SELECT id FROM interactions WHERE workspace_person_id = ?1
           )
           OR linked_i.workspace_person_id = ?1
        ORDER BY a.id`,
    ).bind(workspacePersonId).all<ArtifactRow>(),
    env.DB.prepare(
      `SELECT av.id, av.artifact_id, av.version_number, av.content_hash,
              av.media_type, av.storage_key, av.byte_length, av.metadata_json
         FROM artifact_versions av
        WHERE av.artifact_id IN (
          SELECT a.id
            FROM artifacts a
            LEFT JOIN artifact_interactions ai ON ai.artifact_id = a.id
            LEFT JOIN interactions linked_i ON linked_i.id = ai.interaction_id
           WHERE a.workspace_person_id = ?1
              OR a.interaction_id IN (
                SELECT id FROM interactions WHERE workspace_person_id = ?1
              )
              OR linked_i.workspace_person_id = ?1
        )
        ORDER BY av.artifact_id, av.version_number`,
    ).bind(workspacePersonId).all<ArtifactVersionRow>(),
    env.DB.prepare(
      `SELECT ss.id, ss.artifact_version_id, ss.stable_segment_id,
              ss.byte_start, ss.byte_end, ss.char_start, ss.char_end,
              ss.line_start, ss.line_end, ss.timestamp_start_ms,
              ss.timestamp_end_ms, ss.exact_text, ss.exact_text_hash,
              ss.metadata_json
         FROM source_spans ss
        WHERE ss.artifact_version_id IN (
          SELECT av.id
            FROM artifact_versions av
            JOIN artifacts a ON a.id = av.artifact_id
            LEFT JOIN artifact_interactions ai ON ai.artifact_id = a.id
            LEFT JOIN interactions linked_i ON linked_i.id = ai.interaction_id
           WHERE a.workspace_person_id = ?1
              OR a.interaction_id IN (
                SELECT id FROM interactions WHERE workspace_person_id = ?1
              )
              OR linked_i.workspace_person_id = ?1
        )
        ORDER BY ss.artifact_version_id, ss.char_start, ss.id`,
    ).bind(workspacePersonId).all<SourceSpanRow>(),
    env.DB.prepare(
      `SELECT interaction_id, artifact_id, relationship
         FROM artifact_interactions
        WHERE interaction_id IN (
          SELECT id FROM interactions WHERE workspace_person_id = ?1
        )
       UNION
       SELECT interaction_id, id AS artifact_id, 'source_artifact' AS relationship
         FROM artifacts
        WHERE interaction_id IN (
          SELECT id FROM interactions WHERE workspace_person_id = ?1
        )`,
    ).bind(workspacePersonId).all<InteractionArtifactRow>(),
    env.DB.prepare(
      `SELECT id, interaction_id, narrative, started_at, ended_at, metadata_json
         FROM episodes
        WHERE workspace_person_id = ?1
        ORDER BY COALESCE(started_at, created_at), id`,
    ).bind(workspacePersonId).all<EpisodeRow>(),
    env.DB.prepare(
      `SELECT id, episode_id, subject_type, subject_id, predicate,
              object_type, object_id, object_value_json, narrative,
              qualifiers_json, confidence, polarity, extraction_version, observed_at
         FROM semantic_assertions
        WHERE workspace_person_id = ?1
        ORDER BY COALESCE(observed_at, created_at), id`,
    ).bind(workspacePersonId).all<AssertionRow>(),
    env.DB.prepare(
      `SELECT ass.assertion_id, ass.source_span_id, ass.evidence_role
         FROM assertion_source_spans ass
         JOIN semantic_assertions sa ON sa.id = ass.assertion_id
        WHERE sa.workspace_person_id = ?1
        ORDER BY ass.assertion_id, ass.source_span_id, ass.evidence_role`,
    ).bind(workspacePersonId).all<AssertionSpanRow>(),
    env.DB.prepare(
      `SELECT source_span_id, attribution_source, confidence, metadata_json
         FROM source_span_attributions
        WHERE workspace_person_id = ?1
        ORDER BY source_span_id, attribution_source`,
    ).bind(workspacePersonId).all<SourceSpanAttributionRow>(),
    env.DB.prepare(
      `SELECT DISTINCT c.id, c.canonical_key, c.namespace, c.label,
              c.description, c.aliases_json, c.metadata_json
         FROM concepts c
         JOIN assertion_concepts ac ON ac.concept_id = c.id
         JOIN semantic_assertions sa ON sa.id = ac.assertion_id
        WHERE sa.workspace_person_id = ?1
        UNION
        SELECT DISTINCT c.id, c.canonical_key, c.namespace, c.label,
              c.description, c.aliases_json, c.metadata_json
         FROM concepts c
         JOIN context_record_concepts crc ON crc.concept_id = c.id
         JOIN context_records cr ON cr.id = crc.context_record_id
        WHERE cr.workspace_person_id = ?1
        ORDER BY c.canonical_key`,
    ).bind(workspacePersonId).all<ConceptRow>(),
    env.DB.prepare(
      `SELECT ac.assertion_id, ac.concept_id, ac.relationship, ac.weight
         FROM assertion_concepts ac
         JOIN semantic_assertions sa ON sa.id = ac.assertion_id
        WHERE sa.workspace_person_id = ?1
        ORDER BY ac.assertion_id, ac.concept_id, ac.relationship`,
    ).bind(workspacePersonId).all<AssertionConceptRow>(),
    env.DB.prepare(
      `SELECT id, interaction_id, assertion_id, concept_id, signal_key,
              evidence_level, strength, polarity, observed_at, metadata_json
         FROM signal_evidence
        WHERE workspace_person_id = ?1
        ORDER BY COALESCE(observed_at, created_at), id`,
    ).bind(workspacePersonId).all<SignalEvidenceRow>(),
    env.DB.prepare(
      `SELECT id, signal_key, interaction_id, as_of, conversation_score,
              total_score, confidence, evidence_count, source_diversity,
              dimensions_json, policy_version
         FROM signal_snapshots
        WHERE workspace_person_id = ?1
        ORDER BY as_of, id`,
    ).bind(workspacePersonId).all<SignalSnapshotRow>(),
    env.DB.prepare(
      `SELECT id, from_entity_type, from_entity_id, predicate,
              to_entity_type, to_entity_id, to_value_json, qualifiers_json,
              confidence, source_assertion_id
         FROM semantic_relationships
        WHERE workspace_person_id = ?1
        ORDER BY id`,
    ).bind(workspacePersonId).all<SemanticRelationshipRow>(),
    env.DB.prepare(
      `SELECT id, scope_type, scope_id, interaction_id, application_id,
              episode_id, assertion_id, record_type, predicate, narrative,
              qualifiers_json, confidence, polarity, extraction_version, observed_at
         FROM context_records
        WHERE workspace_person_id = ?1
        ORDER BY COALESCE(observed_at, created_at), id`,
    ).bind(workspacePersonId).all<ContextRecordRow>(),
    env.DB.prepare(
      `SELECT crsr.context_record_id, crsr.source_ref_type, crsr.source_ref_id,
              crsr.source_span_id, crsr.evidence_role, crsr.locator_json,
              crsr.exact_text, crsr.content_hash, crsr.metadata_json
         FROM context_record_source_refs crsr
         JOIN context_records cr ON cr.id = crsr.context_record_id
        WHERE cr.workspace_person_id = ?1
        ORDER BY crsr.context_record_id, crsr.source_ref_type, crsr.source_ref_id, crsr.evidence_role`,
    ).bind(workspacePersonId).all<ContextRecordSourceRefRow>(),
    env.DB.prepare(
      `SELECT cre.context_record_id, cre.entity_key, cre.entity_type, cre.entity_id,
              cre.relationship, cre.value_json, cre.confidence, cre.metadata_json
         FROM context_record_entities cre
         JOIN context_records cr ON cr.id = cre.context_record_id
        WHERE cr.workspace_person_id = ?1
        ORDER BY cre.context_record_id, cre.relationship, cre.entity_type, cre.entity_id`,
    ).bind(workspacePersonId).all<ContextRecordEntityRow>(),
    env.DB.prepare(
      `SELECT crc.context_record_id, crc.concept_id, c.canonical_key,
              c.namespace, c.label, c.description, c.aliases_json,
              c.metadata_json, crc.relationship, crc.weight
         FROM context_record_concepts crc
         JOIN context_records cr ON cr.id = crc.context_record_id
         JOIN concepts c ON c.id = crc.concept_id
        WHERE cr.workspace_person_id = ?1
        ORDER BY crc.context_record_id, crc.weight DESC, c.label`,
    ).bind(workspacePersonId).all<ContextRecordConceptRow>(),
  ]);

  await runWriteQuery(
    driver,
    `MERGE (p:Person {person_id: $person.person_id})
     SET p.display_name = $person.display_name,
         p.primary_email = $person.primary_email,
         p.primary_phone = $person.primary_phone,
         p.external_ids_json = $person.external_ids_json
     MERGE (wp:WorkspacePerson {workspace_person_id: $workspace_person.workspace_person_id})
     SET wp.workspace_id = $workspace_person.workspace_id,
         wp.relationship_summary = $workspace_person.relationship_summary,
         wp.context_json = $workspace_person.context_json
     MERGE (p)-[:HAS_WORKSPACE_CONTEXT]->(wp)`,
    {
      person: {
        person_id: identity.person_id,
        display_name: identity.display_name,
        primary_email: identity.primary_email,
        primary_phone: identity.primary_phone,
        external_ids_json: identity.external_ids_json,
      },
      workspace_person: {
        workspace_person_id: identity.workspace_person_id,
        workspace_id: identity.workspace_id,
        relationship_summary: identity.relationship_summary,
        context_json: identity.workspace_context_json,
      },
    },
  );

  if (applications.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MERGE (app:Application {application_id: row.id})
       SET app.legacy_candidate_id = row.legacy_candidate_id,
           app.pipeline_id = row.pipeline_id,
           app.status = row.status,
           app.context_json = row.context_json
       MERGE (wp)-[:HAS_CONTEXT_ENTITY]->(app)`,
      { workspace_person_id: workspacePersonId, rows: applications.results },
    );
  }
  if (personRoles.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MERGE (pr:PersonRole {person_role_id: row.id})
       SET pr.role_type = row.role_type,
           pr.label = row.label,
           pr.attributes_json = row.attributes_json,
           pr.active_from = row.active_from,
           pr.active_to = row.active_to
       MERGE (wp)-[:HAS_CONTEXT_ENTITY]->(pr)
       FOREACH (_ IN CASE WHEN row.application_id IS NULL THEN [] ELSE [1] END |
         MERGE (app:Application {application_id: row.application_id})
         MERGE (pr)-[:FOR_APPLICATION]->(app)
       )`,
      { workspace_person_id: workspacePersonId, rows: personRoles.results },
    );
  }
  if (interactions.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MERGE (i:Interaction {interaction_id: row.id})
       SET i.interaction_type = row.interaction_type,
           i.external_reference = row.external_reference,
           i.started_at = row.started_at,
           i.ended_at = row.ended_at,
           i.metadata_json = row.metadata_json
       MERGE (wp)-[:HAS_CONTEXT_ENTITY]->(i)`,
      { workspace_person_id: workspacePersonId, rows: interactions.results },
    );
  }
  if (artifacts.results.length > 0) {
    await runWriteQuery(
      driver,
      `UNWIND $rows AS row
       MERGE (a:Artifact {artifact_id: row.id})
       SET a.artifact_type = row.artifact_type,
           a.logical_key = row.logical_key,
           a.metadata_json = row.metadata_json`,
      { rows: artifacts.results },
    );
  }
  if (artifactVersions.results.length > 0) {
    await runWriteQuery(
      driver,
      `UNWIND $rows AS row
       MATCH (a:Artifact {artifact_id: row.artifact_id})
       MERGE (v:ArtifactVersion {artifact_version_id: row.id})
       SET v.version_number = row.version_number,
           v.content_hash = row.content_hash,
           v.media_type = row.media_type,
           v.storage_key = row.storage_key,
           v.byte_length = row.byte_length,
           v.metadata_json = row.metadata_json
       MERGE (a)-[:HAS_VERSION]->(v)`,
      { rows: artifactVersions.results },
    );
  }
  if (sourceSpans.results.length > 0) {
    await runWriteQuery(
      driver,
      `UNWIND $rows AS row
       MATCH (v:ArtifactVersion {artifact_version_id: row.artifact_version_id})
       MERGE (s:SourceSpan {source_span_id: row.id})
       SET s.stable_segment_id = row.stable_segment_id,
           s.byte_start = row.byte_start,
           s.byte_end = row.byte_end,
           s.char_start = row.char_start,
           s.char_end = row.char_end,
           s.line_start = row.line_start,
           s.line_end = row.line_end,
           s.timestamp_start_ms = row.timestamp_start_ms,
           s.timestamp_end_ms = row.timestamp_end_ms,
           s.exact_text = row.exact_text,
           s.exact_text_hash = row.exact_text_hash,
           s.metadata_json = row.metadata_json
       MERGE (v)-[:HAS_SPAN]->(s)`,
      { rows: sourceSpans.results },
    );
  }
  if (interactionArtifacts.results.length > 0) {
    await runWriteQuery(
      driver,
      `UNWIND $rows AS row
       MATCH (i:Interaction {interaction_id: row.interaction_id})
       MATCH (a:Artifact {artifact_id: row.artifact_id})
       MERGE (i)-[r:HAS_ARTIFACT {relationship: row.relationship}]->(a)`,
      { rows: interactionArtifacts.results },
    );
  }
  if (episodes.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MERGE (e:Episode {episode_id: row.id})
       SET e.interaction_id = row.interaction_id,
           e.narrative = row.narrative,
           e.started_at = row.started_at,
           e.ended_at = row.ended_at,
           e.metadata_json = row.metadata_json
       MERGE (wp)-[:HAS_CONTEXT_ENTITY]->(e)
       FOREACH (_ IN CASE WHEN row.interaction_id IS NULL THEN [] ELSE [1] END |
         MERGE (i:Interaction {interaction_id: row.interaction_id})
         MERGE (i)-[:HAS_EPISODE]->(e)
       )`,
      { workspace_person_id: workspacePersonId, rows: episodes.results },
    );
  }
  if (assertions.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MERGE (a:SemanticAssertion {assertion_id: row.id})
       SET a.subject_type = row.subject_type,
           a.subject_id = row.subject_id,
           a.predicate = row.predicate,
           a.object_type = row.object_type,
           a.object_id = row.object_id,
           a.object_value_json = row.object_value_json,
           a.narrative = row.narrative,
           a.qualifiers_json = row.qualifiers_json,
           a.confidence = row.confidence,
           a.polarity = row.polarity,
           a.extraction_version = row.extraction_version,
           a.observed_at = row.observed_at
       MERGE (wp)-[:HAS_CONTEXT_ENTITY]->(a)
       FOREACH (_ IN CASE WHEN row.episode_id IS NULL THEN [] ELSE [1] END |
         MERGE (e:Episode {episode_id: row.episode_id})
         MERGE (e)-[:HAS_ASSERTION]->(a)
       )`,
      { workspace_person_id: workspacePersonId, rows: assertions.results },
    );
  }
  if (assertionSpans.results.length > 0) {
    await runWriteQuery(
      driver,
      `UNWIND $rows AS row
       MATCH (a:SemanticAssertion {assertion_id: row.assertion_id})
       MATCH (s:SourceSpan {source_span_id: row.source_span_id})
       MERGE (a)-[r:SUPPORTED_BY {evidence_role: row.evidence_role}]->(s)`,
      { rows: assertionSpans.results },
    );
  }
  if (sourceSpanAttributions.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MATCH (s:SourceSpan {source_span_id: row.source_span_id})
       MERGE (s)-[r:ATTRIBUTED_TO {
         attribution_source: row.attribution_source
       }]->(wp)
       SET r.confidence = row.confidence,
           r.metadata_json = row.metadata_json`,
      { workspace_person_id: workspacePersonId, rows: sourceSpanAttributions.results },
    );
  }
  if (concepts.results.length > 0) {
    await runWriteQuery(
      driver,
      `UNWIND $rows AS row
       MERGE (c:Concept {concept_id: row.id})
       SET c.canonical_key = row.canonical_key,
           c.namespace = row.namespace,
           c.label = row.label,
           c.description = row.description,
           c.aliases_json = row.aliases_json,
           c.metadata_json = row.metadata_json`,
      { rows: concepts.results },
    );
  }
  if (assertionConcepts.results.length > 0) {
    await runWriteQuery(
      driver,
      `UNWIND $rows AS row
       MATCH (a:SemanticAssertion {assertion_id: row.assertion_id})
       MATCH (c:Concept {concept_id: row.concept_id})
       MERGE (a)-[r:RELATES_TO {
         concept_id: row.concept_id,
         relationship: row.relationship
       }]->(c)
       SET r.weight = row.weight`,
      { rows: assertionConcepts.results },
    );
  }
  if (signalEvidence.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MERGE (se:SignalEvidence {signal_evidence_id: row.id})
       SET se.interaction_id = row.interaction_id,
           se.signal_key = row.signal_key,
           se.evidence_level = row.evidence_level,
           se.strength = row.strength,
           se.polarity = row.polarity,
           se.observed_at = row.observed_at,
           se.metadata_json = row.metadata_json
       MERGE (wp)-[:HAS_CONTEXT_ENTITY]->(se)
       MERGE (a:SemanticAssertion {assertion_id: row.assertion_id})
       MERGE (se)-[:DERIVED_FROM]->(a)
       FOREACH (_ IN CASE WHEN row.concept_id IS NULL THEN [] ELSE [1] END |
         MERGE (c:Concept {concept_id: row.concept_id})
         MERGE (se)-[:REFERENCES]->(c)
       )`,
      { workspace_person_id: workspacePersonId, rows: signalEvidence.results },
    );
  }
  if (signalSnapshots.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MERGE (ss:SignalSnapshot {signal_snapshot_id: row.id})
       SET ss.signal_key = row.signal_key,
           ss.interaction_id = row.interaction_id,
           ss.as_of = row.as_of,
           ss.conversation_score = row.conversation_score,
           ss.total_score = row.total_score,
           ss.confidence = row.confidence,
           ss.evidence_count = row.evidence_count,
           ss.source_diversity = row.source_diversity,
           ss.dimensions_json = row.dimensions_json,
           ss.policy_version = row.policy_version
       MERGE (wp)-[:HAS_CONTEXT_ENTITY]->(ss)`,
      { workspace_person_id: workspacePersonId, rows: signalSnapshots.results },
    );
  }
  if (semanticRelationships.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MERGE (sr:SemanticRelationship {semantic_relationship_id: row.id})
       SET sr.from_entity_type = row.from_entity_type,
           sr.from_entity_id = row.from_entity_id,
           sr.predicate = row.predicate,
           sr.to_entity_type = row.to_entity_type,
           sr.to_entity_id = row.to_entity_id,
           sr.to_value_json = row.to_value_json,
           sr.qualifiers_json = row.qualifiers_json,
           sr.confidence = row.confidence,
           sr.source_assertion_id = row.source_assertion_id
       MERGE (wp)-[:HAS_CONTEXT_ENTITY]->(sr)
       FOREACH (_ IN CASE WHEN row.source_assertion_id IS NULL THEN [] ELSE [1] END |
         MERGE (a:SemanticAssertion {assertion_id: row.source_assertion_id})
         MERGE (sr)-[:DERIVED_FROM]->(a)
       )`,
      { workspace_person_id: workspacePersonId, rows: semanticRelationships.results },
    );
  }
  if (contextRecords.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MERGE (cr:ContextRecord {context_record_id: row.id})
       SET cr.scope_type = row.scope_type,
           cr.scope_id = row.scope_id,
           cr.record_type = row.record_type,
           cr.predicate = row.predicate,
           cr.narrative = row.narrative,
           cr.qualifiers_json = row.qualifiers_json,
           cr.confidence = row.confidence,
           cr.polarity = row.polarity,
           cr.extraction_version = row.extraction_version,
           cr.observed_at = row.observed_at
       MERGE (wp)-[:HAS_CONTEXT_ENTITY]->(cr)
       FOREACH (_ IN CASE WHEN row.interaction_id IS NULL THEN [] ELSE [1] END |
         MERGE (i:Interaction {interaction_id: row.interaction_id})
         MERGE (cr)-[:OBSERVED_IN]->(i)
       )
       FOREACH (_ IN CASE WHEN row.application_id IS NULL THEN [] ELSE [1] END |
         MERGE (app:Application {application_id: row.application_id})
         MERGE (cr)-[:FOR_APPLICATION]->(app)
       )
       FOREACH (_ IN CASE WHEN row.episode_id IS NULL THEN [] ELSE [1] END |
         MERGE (e:Episode {episode_id: row.episode_id})
         MERGE (cr)-[:PART_OF_EPISODE]->(e)
       )
       FOREACH (_ IN CASE WHEN row.assertion_id IS NULL THEN [] ELSE [1] END |
         MERGE (a:SemanticAssertion {assertion_id: row.assertion_id})
         MERGE (cr)-[:DERIVED_FROM]->(a)
       )`,
      { workspace_person_id: workspacePersonId, rows: contextRecords.results },
    );
  }
  if (contextRecordSourceRefs.results.length > 0) {
    await runWriteQuery(
      driver,
      `UNWIND $rows AS row
       MATCH (cr:ContextRecord {context_record_id: row.context_record_id})
       FOREACH (_ IN CASE WHEN row.source_span_id IS NULL THEN [] ELSE [1] END |
         MATCH (s:SourceSpan {source_span_id: row.source_span_id})
         MERGE (cr)-[r:EVIDENCED_BY {
           source_ref_type: row.source_ref_type,
           evidence_role: row.evidence_role
         }]->(s)
         SET r.locator_json = row.locator_json,
             r.exact_text = row.exact_text,
             r.content_hash = row.content_hash,
             r.metadata_json = row.metadata_json
       )`,
      { rows: contextRecordSourceRefs.results },
    );
  }
  if (contextRecordEntities.results.length > 0) {
    await runWriteQuery(
      driver,
      `MATCH (wp:WorkspacePerson {workspace_person_id: $workspace_person_id})
       UNWIND $rows AS row
       MATCH (cr:ContextRecord {context_record_id: row.context_record_id})
       MERGE (entity:ContextEntity {
         entity_type: row.entity_type,
         entity_key: row.entity_key
       })
       SET entity.entity_id = row.entity_id,
           entity.value_json = row.value_json,
           entity.confidence = row.confidence,
           entity.metadata_json = row.metadata_json
       MERGE (wp)-[:HAS_CONTEXT_ENTITY]->(entity)
       MERGE (cr)-[r:REFERENCES_ENTITY {relationship: row.relationship}]->(entity)`,
      { workspace_person_id: workspacePersonId, rows: contextRecordEntities.results },
    );
  }
  if (contextRecordConcepts.results.length > 0) {
    await runWriteQuery(
      driver,
      `UNWIND $rows AS row
       MATCH (cr:ContextRecord {context_record_id: row.context_record_id})
       MERGE (c:Concept {concept_id: row.concept_id})
       SET c.canonical_key = row.canonical_key,
           c.namespace = row.namespace,
           c.label = row.label,
           c.description = row.description,
           c.aliases_json = row.aliases_json,
           c.metadata_json = row.metadata_json
       MERGE (cr)-[r:RELATES_TO_CONCEPT {
         concept_id: row.concept_id,
         relationship: row.relationship
       }]->(c)
       SET r.weight = row.weight`,
      { rows: contextRecordConcepts.results },
    );
  }
}

/**
 * Enqueue rebuild projection jobs for all workspace persons.
 *
 * This is the "fully rebuildable projections" capability: D1 remains the
 * source of truth, and Neo4j projections can be deleted and reconstructed
 * at any time by scheduling rebuild jobs through the projection outbox.
 *
 * Returns the number of rebuild jobs enqueued.
 */
export async function scheduleFullProjectionRebuild(
  db: D1Database,
  batchSize = 100,
): Promise<{ enqueued: number }> {
  let afterId = '';
  let enqueued = 0;
  const now = new Date().toISOString();

  for (;;) {
    const page = await db.prepare(
      `SELECT id FROM workspace_people WHERE id > ?1 ORDER BY id LIMIT ?2`,
    ).bind(afterId, batchSize).all<{ id: string }>();

    if (!page.results || page.results.length === 0) break;

    for (const row of page.results) {
      const ingestionKey = `rebuild:neo4j:workspace_person:${row.id}`;
      const jobId = `rebuild-${row.id}-${Date.now()}`;
      await db.prepare(
        `INSERT INTO projection_outbox (
           id, ingestion_key, projection_type, aggregate_type, aggregate_id,
           operation, status, available_at, created_at, updated_at
         ) VALUES (
           ?1, ?2, 'neo4j', 'workspace_person', ?3, 'rebuild',
           'pending', ?4, ?4, ?4
         )
         ON CONFLICT(ingestion_key) DO UPDATE
           SET operation = 'rebuild', status = 'pending',
               available_at = ?4, updated_at = ?4
           WHERE status NOT IN ('processing')`,
      ).bind(jobId, ingestionKey, row.id, now).run();
      enqueued++;
    }

    afterId = page.results.at(-1)!.id;
  }

  return { enqueued };
}

export async function processProjectionOutbox(
  env: Env,
  limit = 25,
): Promise<{ completed: number; failed: number }> {
  const now = new Date();
  const staleLock = new Date(now.getTime() - 5 * 60_000).toISOString();
  const jobs = await env.DB.prepare(
    `SELECT id, aggregate_id, operation
       FROM projection_outbox
      WHERE projection_type = 'neo4j'
        AND aggregate_type = 'workspace_person'
        AND (
          (status IN ('pending', 'failed') AND available_at <= ?1)
          OR (status = 'processing' AND locked_at <= ?2)
        )
      ORDER BY created_at
      LIMIT ?3`,
  ).bind(now.toISOString(), staleLock, limit).all<ProjectionJobRow>();
  let completed = 0;
  let failed = 0;

  const config = buildNeo4jConfig(env);
  if (!config) return { completed, failed };
  const driver = createNeo4jDriver(config);
  try {
    for (const job of jobs.results ?? []) {
      const claimedAt = new Date().toISOString();
      const claim = await env.DB.prepare(
        `UPDATE projection_outbox
            SET status = 'processing', attempts = attempts + 1,
                locked_at = ?2, locked_by = 'worker-cron', updated_at = ?2
          WHERE id = ?1
            AND (
              status IN ('pending', 'failed')
              OR (status = 'processing' AND locked_at <= ?3)
            )`,
      ).bind(job.id, claimedAt, staleLock).run();
      if ((claim.meta.changes ?? 0) === 0) continue;

      try {
        if (job.operation === 'delete') {
          await clearWorkspacePersonProjection(driver, job.aggregate_id, true);
        } else {
          await projectWorkspacePerson(env, driver, job.aggregate_id);
        }
        await env.DB.prepare(
          `UPDATE projection_outbox
              SET status = 'completed', completed_at = ?2, last_error = NULL,
                  locked_at = NULL, locked_by = NULL, updated_at = ?2
            WHERE id = ?1 AND status = 'processing'`,
        ).bind(job.id, new Date().toISOString()).run();
        completed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedAt = new Date();
        await env.DB.prepare(
          `UPDATE projection_outbox
              SET status = 'failed', last_error = ?2, locked_at = NULL,
                  locked_by = NULL, available_at = ?3, updated_at = ?4
            WHERE id = ?1 AND status = 'processing'`,
        ).bind(
          job.id,
          message.slice(0, 2000),
          new Date(failedAt.getTime() + 60_000).toISOString(),
          failedAt.toISOString(),
        ).run();
        failed++;
      }
    }
  } finally {
    await driver.close();
  }
  return { completed, failed };
}
