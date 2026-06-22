export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface IngestedEntityInput {
  ingestionKey: string;
}

export interface PersonInput extends IngestedEntityInput {
  displayName?: string | null;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  externalIds?: JsonObject;
}

export interface WorkspacePersonInput extends IngestedEntityInput {
  workspaceId: string;
  personId: string;
  relationshipSummary?: string | null;
  context?: JsonObject;
}

export interface ApplicationInput extends IngestedEntityInput {
  workspacePersonId: string;
  legacyCandidateId?: string | null;
  pipelineId?: string | null;
  status?: string | null;
  context?: JsonObject;
}

export interface PersonRoleInput extends IngestedEntityInput {
  workspacePersonId: string;
  applicationId?: string | null;
  roleType: string;
  label?: string | null;
  attributes?: JsonObject;
  activeFrom?: string | null;
  activeTo?: string | null;
}

export interface InteractionInput extends IngestedEntityInput {
  workspacePersonId: string;
  applicationId?: string | null;
  interactionType: string;
  externalReference?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  metadata?: JsonObject;
}

export interface ArtifactInput extends IngestedEntityInput {
  workspacePersonId?: string | null;
  interactionId?: string | null;
  artifactType: string;
  logicalKey?: string | null;
  metadata?: JsonObject;
}

export interface ArtifactVersionInput extends IngestedEntityInput {
  artifactId: string;
  versionNumber: number;
  contentHash: string;
  mediaType: string;
  contentText?: string | null;
  storageKey?: string | null;
  byteLength?: number | null;
  metadata?: JsonObject;
}

export interface SourceSpanInput extends IngestedEntityInput {
  artifactVersionId: string;
  stableSegmentId?: string | null;
  byteStart?: number | null;
  byteEnd?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  timestampStartMs?: number | null;
  timestampEndMs?: number | null;
  exactText: string;
  exactTextHash?: string;
  metadata?: JsonObject;
}

export interface EpisodeInput extends IngestedEntityInput {
  workspacePersonId: string;
  interactionId?: string | null;
  narrative?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  metadata?: JsonObject;
}

export interface SemanticAssertionInput extends IngestedEntityInput {
  workspacePersonId: string;
  episodeId?: string | null;
  subjectType: string;
  subjectId?: string | null;
  predicate: string;
  objectType?: string | null;
  objectId?: string | null;
  objectValue?: JsonValue;
  narrative: string;
  qualifiers?: JsonObject;
  confidence?: number | null;
  polarity?: number;
  extractionVersion?: string | null;
  observedAt?: string | null;
}

export interface ContextRecordEntityInput {
  entityType: string;
  entityId?: string | null;
  relationship: string;
  value?: JsonValue;
  confidence?: number | null;
  metadata?: JsonObject;
}

export interface ContextRecordConceptInput {
  conceptId: string;
  relationship: string;
  weight?: number;
}

export interface ContextRecordSourceInput {
  sourceSpanId?: string | null;
  sourceRefType?: string | null;
  sourceRefId?: string | null;
  evidenceRole?: string;
  locator?: JsonObject;
  exactText?: string | null;
  contentHash?: string | null;
  metadata?: JsonObject;
}

/**
 * V1 source-backed meaning unit. Immutable artifact versions and source spans
 * remain the root truth; this record preserves extracted context that graph and
 * search projections can delete and rebuild. Person-scoped records use
 * workspacePersonId for compatibility; repo, role, and match records use
 * scopeType/scopeId plus source refs.
 */
export interface ContextRecordInput extends IngestedEntityInput {
  scopeType?: string | null;
  scopeId?: string | null;
  workspacePersonId?: string | null;
  interactionId?: string | null;
  applicationId?: string | null;
  episodeId?: string | null;
  assertionId?: string | null;
  recordType: string;
  predicate?: string | null;
  narrative: string;
  qualifiers?: JsonObject;
  confidence?: number | null;
  polarity?: number;
  extractionVersion?: string | null;
  observedAt?: string | null;
  sources: ContextRecordSourceInput[];
  entities?: ContextRecordEntityInput[];
  concepts?: ContextRecordConceptInput[];
}

export interface ConceptInput extends IngestedEntityInput {
  canonicalKey: string;
  namespace: string;
  label: string;
  description?: string | null;
  aliases?: string[];
  metadata?: JsonObject;
}

export type EvidenceLevel =
  | 'mentioned'
  | 'used'
  | 'explained'
  | 'selected'
  | 'implemented'
  | 'demonstrated'
  | 'validated';

export interface SignalEvidenceInput extends IngestedEntityInput {
  workspacePersonId: string;
  interactionId?: string | null;
  assertionId: string;
  conceptId?: string | null;
  signalKey: string;
  evidenceLevel: EvidenceLevel;
  strength: number;
  polarity?: number;
  observedAt?: string | null;
  metadata?: JsonObject;
}

export interface SignalSnapshotInput extends IngestedEntityInput {
  workspacePersonId: string;
  signalKey: string;
  interactionId?: string | null;
  asOf: string;
  conversationScore?: number | null;
  totalScore: number;
  confidence: number;
  evidenceCount: number;
  sourceDiversity: number;
  dimensions?: JsonObject;
  policyVersion: string;
}

export interface SemanticRelationshipInput extends IngestedEntityInput {
  workspacePersonId: string;
  fromEntityType: string;
  fromEntityId: string;
  predicate: string;
  toEntityType?: string | null;
  toEntityId?: string | null;
  toValue?: JsonValue;
  qualifiers?: JsonObject;
  confidence?: number | null;
  sourceAssertionId?: string | null;
}

export type ProjectionOperation = 'upsert' | 'delete' | 'rebuild';

export interface ProjectionJobInput extends IngestedEntityInput {
  projectionType: string;
  aggregateType: string;
  aggregateId: string;
  operation?: ProjectionOperation;
  payload?: JsonObject;
  availableAt?: string;
}

export interface PersistedEntity {
  id: string;
  ingestionKey: string;
}
