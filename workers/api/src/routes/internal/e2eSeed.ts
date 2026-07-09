import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import type { Env, Variables } from '../../types';
import {
  LivingContextStore,
  stableJson,
  type EvidenceLevel,
  type JsonValue,
} from '../../lib/livingContext';
import {
  buildChallengePacket,
  buildRepoSnapshot,
  buildSourceArtifact,
  buildSourceArtifactVersion,
  buildSourceSpan,
  buildStructuralFact,
  buildSymbol,
  deriveRepoSemantics,
  persistReviewChallengeGraph,
  type ChallengePacket as RepoChallengePacket,
  type NormalizedPullRequestFile,
  type NormalizedPullRequestInput,
  type RepositoryRef,
  type SourceArtifactKind,
  type StructuralFact,
} from '../../lib/repoSemanticGraph';
import {
  loadRoleChallengeSemantics,
  matchCandidateToReviewChallenge,
  type RoleSourceReference,
} from '../../lib/challengeMatching';

type SeedConceptInput = {
  canonicalKey: string;
  label?: string;
  namespace?: string;
  description?: string;
};

type SeedCandidateEvidenceInput = {
  exactText: string;
  predicate: string;
  narrative?: string;
  conceptKeys: string[];
  evidenceLevel: EvidenceLevel;
  strength?: number;
  confidence?: number;
};

type SeedCandidateEvidenceSourceInput = {
  interactionType?: string;
  artifactType?: string;
  externalReference?: string;
  logicalKey?: string;
  contextRecordType?: string;
  recordingKey?: string;
  transcriptionAudioKey?: string;
  provider?: string;
  transcriptStatus?: string;
};

type SeedRepoSpanInput = {
  key: string;
  path: string;
  exactText: string;
  artifactType?: string;
  lineStart?: number;
  lineEnd?: number;
};

type SeedDemandInput = {
  id: string;
  family: string;
  narrative: string;
  conceptKeys: string[];
  sourceSpanKeys: string[];
  weight: number;
  problems?: string[];
  mechanisms?: string[];
  domains?: string[];
  businessObjects?: string[];
  ownershipActions?: string[];
};

type SeedRoleSourceInput = {
  title?: string;
  jobDescriptionMd: string;
  selectedConceptKeys: string[];
};

type SeedRequest = {
  fixtureId?: string;
  candidateId: string;
  useExistingCandidateEvidence?: boolean;
  omitSamplePrRow?: boolean;
  existingChallengePacketId?: string;
  concepts: SeedConceptInput[];
  roleSource?: SeedRoleSourceInput;
  candidateEvidenceSource?: SeedCandidateEvidenceSourceInput;
  candidateEvidence: SeedCandidateEvidenceInput[];
  repo?: {
    githubUrl: string;
    fullName: string;
    primaryLanguage?: string;
    description?: string;
  };
  pullRequest?: {
    number: number;
    title: string;
    author?: string;
    baseSha?: string;
    headSha?: string;
    mergedAt?: string | null;
  };
  repoSpans: SeedRepoSpanInput[];
  demands: SeedDemandInput[];
};

type SeededRepoRequest = SeedRequest & {
  repo: NonNullable<SeedRequest['repo']>;
  pullRequest: NonNullable<SeedRequest['pullRequest']>;
  repoSpans: SeedRepoSpanInput[];
  demands: SeedDemandInput[];
};

const ALLOWED_EVIDENCE_LEVELS = new Set<EvidenceLevel>([
  'mentioned',
  'used',
  'explained',
  'selected',
  'implemented',
  'demonstrated',
  'validated',
]);

export const e2eSeed = new Hono<{ Bindings: Env; Variables: Variables }>();
e2eSeed.use('*', authMiddleware);

function isLocalOrTestRequest(env: Env, requestUrl: string): boolean {
  if (env.ENV === 'test') return true;
  const url = new URL(requestUrl);
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  const appBase = env.APP_BASE_URL ?? '';
  const localApp = appBase.startsWith('http://localhost:') || appBase.startsWith('http://127.0.0.1:');
  return localHost && localApp;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function stringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  const entries = value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error(`${key} must contain only non-empty strings`);
    }
    return entry.trim();
  });
  if (entries.length === 0) throw new Error(`${key} must not be empty`);
  return entries;
}

function optionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  return value === undefined ? undefined : stringArray(value, key);
}

function parseSeedRequest(value: unknown): SeedRequest {
  const body = requireRecord(value, 'body');
  const existingChallengePacketId = optionalString(body, 'existingChallengePacketId');
  const repo = body.repo === undefined ? undefined : requireRecord(body.repo, 'repo');
  const pullRequest = body.pullRequest === undefined ? undefined : requireRecord(body.pullRequest, 'pullRequest');
  const conceptsRaw = body.concepts;
  const candidateEvidenceRaw = body.candidateEvidence;
  const useExistingCandidateEvidence = optionalBoolean(body, 'useExistingCandidateEvidence') ?? false;
  const roleSourceRaw = body.roleSource;
  const repoSpansRaw = body.repoSpans;
  const demandsRaw = body.demands;
  if (!Array.isArray(conceptsRaw) || conceptsRaw.length === 0) throw new Error('concepts must be a non-empty array');
  if (
    (!Array.isArray(candidateEvidenceRaw) || candidateEvidenceRaw.length === 0)
    && !useExistingCandidateEvidence
  ) {
    throw new Error('candidateEvidence must be a non-empty array');
  }
  if (candidateEvidenceRaw !== undefined && !Array.isArray(candidateEvidenceRaw)) {
    throw new Error('candidateEvidence must be an array');
  }
  const usingExistingPacket = Boolean(existingChallengePacketId);
  if (!usingExistingPacket) {
    if (!repo) throw new Error('repo is required unless existingChallengePacketId is provided');
    if (!pullRequest) throw new Error('pullRequest is required unless existingChallengePacketId is provided');
    if (!Array.isArray(repoSpansRaw) || repoSpansRaw.length === 0) throw new Error('repoSpans must be a non-empty array');
    if (!Array.isArray(demandsRaw) || demandsRaw.length === 0) throw new Error('demands must be a non-empty array');
  }
  if (repoSpansRaw !== undefined && !Array.isArray(repoSpansRaw)) {
    throw new Error('repoSpans must be an array');
  }
  if (demandsRaw !== undefined && !Array.isArray(demandsRaw)) {
    throw new Error('demands must be an array');
  }

  return {
    fixtureId: optionalString(body, 'fixtureId'),
    candidateId: requireString(body, 'candidateId'),
    useExistingCandidateEvidence,
    omitSamplePrRow: optionalBoolean(body, 'omitSamplePrRow') ?? false,
    existingChallengePacketId,
    concepts: conceptsRaw.map((entry, index) => {
      const concept = requireRecord(entry, `concepts[${index}]`);
      const canonicalKey = requireString(concept, 'canonicalKey');
      return {
        canonicalKey,
        label: optionalString(concept, 'label') ?? canonicalKey.split(':').at(-1) ?? canonicalKey,
        namespace: optionalString(concept, 'namespace') ?? canonicalKey.split(':')[0] ?? 'term',
        description: optionalString(concept, 'description'),
      };
    }),
    roleSource: roleSourceRaw === undefined
      ? undefined
      : (() => {
          const roleSource = requireRecord(roleSourceRaw, 'roleSource');
          return {
            title: optionalString(roleSource, 'title'),
            jobDescriptionMd: requireString(roleSource, 'jobDescriptionMd'),
            selectedConceptKeys: stringArray(roleSource.selectedConceptKeys, 'selectedConceptKeys'),
          };
        })(),
    candidateEvidenceSource: body.candidateEvidenceSource === undefined
      ? undefined
      : (() => {
          const source = requireRecord(body.candidateEvidenceSource, 'candidateEvidenceSource');
          return {
            interactionType: optionalString(source, 'interactionType'),
            artifactType: optionalString(source, 'artifactType'),
            externalReference: optionalString(source, 'externalReference'),
            logicalKey: optionalString(source, 'logicalKey'),
            contextRecordType: optionalString(source, 'contextRecordType'),
            recordingKey: optionalString(source, 'recordingKey'),
            transcriptionAudioKey: optionalString(source, 'transcriptionAudioKey'),
            provider: optionalString(source, 'provider'),
            transcriptStatus: optionalString(source, 'transcriptStatus'),
          };
        })(),
    candidateEvidence: (candidateEvidenceRaw ?? []).map((entry, index) => {
      const evidence = requireRecord(entry, `candidateEvidence[${index}]`);
      const evidenceLevel = requireString(evidence, 'evidenceLevel') as EvidenceLevel;
      if (!ALLOWED_EVIDENCE_LEVELS.has(evidenceLevel)) {
        throw new Error(`candidateEvidence[${index}].evidenceLevel is not supported by signal_evidence`);
      }
      return {
        exactText: requireString(evidence, 'exactText'),
        predicate: requireString(evidence, 'predicate'),
        narrative: optionalString(evidence, 'narrative'),
        conceptKeys: stringArray(evidence.conceptKeys, 'conceptKeys'),
        evidenceLevel,
        strength: optionalNumber(evidence, 'strength') ?? 1,
        confidence: optionalNumber(evidence, 'confidence') ?? 1,
      };
    }),
    repo: repo
      ? {
          githubUrl: requireString(repo, 'githubUrl'),
          fullName: requireString(repo, 'fullName'),
          primaryLanguage: optionalString(repo, 'primaryLanguage') ?? 'TypeScript',
          description: optionalString(repo, 'description'),
        }
      : undefined,
    pullRequest: pullRequest
      ? {
          number: requireNumber(pullRequest, 'number'),
          title: requireString(pullRequest, 'title'),
          author: optionalString(pullRequest, 'author') ?? 'pipe-e2e',
          baseSha: optionalString(pullRequest, 'baseSha') ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          headSha: optionalString(pullRequest, 'headSha') ?? 'dddddddddddddddddddddddddddddddddddddddd',
          mergedAt: typeof pullRequest.mergedAt === 'string' || pullRequest.mergedAt === null
            ? pullRequest.mergedAt
            : '2026-06-14T08:00:00.000Z',
        }
      : undefined,
    repoSpans: (repoSpansRaw ?? []).map((entry, index) => {
      const span = requireRecord(entry, `repoSpans[${index}]`);
      return {
        key: requireString(span, 'key'),
        path: requireString(span, 'path'),
        exactText: requireString(span, 'exactText'),
        artifactType: optionalString(span, 'artifactType') ?? 'source',
        lineStart: optionalNumber(span, 'lineStart') ?? 1,
        lineEnd: optionalNumber(span, 'lineEnd') ?? optionalNumber(span, 'lineStart') ?? 1,
      };
    }),
    demands: (demandsRaw ?? []).map((entry, index) => {
      const demand = requireRecord(entry, `demands[${index}]`);
      return {
        id: requireString(demand, 'id'),
        family: requireString(demand, 'family'),
        narrative: requireString(demand, 'narrative'),
        conceptKeys: stringArray(demand.conceptKeys, 'conceptKeys'),
        sourceSpanKeys: stringArray(demand.sourceSpanKeys, 'sourceSpanKeys'),
        weight: requireNumber(demand, 'weight'),
        problems: optionalStringArray(demand, 'problems'),
        mechanisms: optionalStringArray(demand, 'mechanisms'),
        domains: optionalStringArray(demand, 'domains'),
        businessObjects: optionalStringArray(demand, 'businessObjects'),
        ownershipActions: optionalStringArray(demand, 'ownershipActions'),
      };
    }),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function contentHash(value: string): Promise<`sha256:${string}`> {
  return `sha256:${await sha256Hex(value)}` as `sha256:${string}`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

const SOURCE_ARTIFACT_KINDS = new Set<SourceArtifactKind>([
  'source',
  'test',
  'manifest',
  'documentation',
  'ci',
  'issue',
  'pull_request',
  'patch',
  'commit_metadata',
  'other',
]);

function lineCount(value: string): number {
  return value.split('\n').length;
}

function sourceEndColumn(value: string): number {
  return (value.split('\n').at(-1) ?? '').length + 1;
}

function normalizeArtifactKind(span: SeedRepoSpanInput): SourceArtifactKind {
  const requested = span.artifactType?.trim().toLowerCase();
  if (requested && SOURCE_ARTIFACT_KINDS.has(requested as SourceArtifactKind)) {
    return requested as SourceArtifactKind;
  }
  return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(span.path) ? 'test' : 'source';
}

function normalizedLanguage(language: string | undefined): string {
  return (language ?? 'TypeScript').trim().toLowerCase();
}

function repositoryRef(seed: SeededRepoRequest): RepositoryRef {
  const [owner, ...nameParts] = seed.repo.fullName.split('/');
  return {
    provider: 'github',
    owner: owner || 'pipe',
    name: nameParts.join('/') || seed.repo.fullName,
    canonicalUrl: seed.repo.githubUrl,
  };
}

function testFrameworkForPath(path: string): string | undefined {
  if (/vitest|\.test\.[cm]?[jt]sx?$/i.test(path)) return 'vitest';
  if (/jest|\.spec\.[cm]?[jt]sx?$/i.test(path)) return 'jest';
  return undefined;
}

function symbolNameForSpan(span: SeedRepoSpanInput): string {
  const key = span.key.replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^_+|_+$/g, '');
  if (key) return key;
  return span.path.split('/').at(-1)?.replace(/\.[^.]+$/, '') || 'changedSymbol';
}

async function loadCandidateIdentity(db: D1Database, candidateId: string, userId: string): Promise<{
  candidateId: string;
  name: string;
  email: string;
  pipelineId: string | null;
  personId: string;
  workspacePersonId: string;
  applicationId: string;
}> {
  const candidate = await db.prepare(
    `SELECT id, name, email, pipeline_id
       FROM candidates
      WHERE id = ?1 AND owner_id = ?2`,
  ).bind(candidateId, userId).first<{
    id: string;
    name: string | null;
    email: string | null;
    pipeline_id: string | null;
  }>();
  if (!candidate) throw new Error('candidate was not found for the authenticated recruiter');
  const email = candidate.email?.trim().toLowerCase();
  if (!email) throw new Error('candidate email is required to seed identity evidence');

  const store = new LivingContextStore(db);
  const existingPerson = await db.prepare(
    `SELECT id, ingestion_key
       FROM people
      WHERE primary_email = ?1
      ORDER BY created_at
      LIMIT 1`,
  ).bind(email).first<{ id: string; ingestion_key: string }>();

  const person = await store.upsertPerson({
    ingestionKey: existingPerson?.ingestion_key ?? `email:${email}`,
    displayName: candidate.name ?? email,
    primaryEmail: email,
    externalIds: { legacyCandidateId: candidate.id },
  });
  const workspacePerson = await store.upsertWorkspacePerson({
    ingestionKey: `workspace:${userId}:person:${person.id}`,
    workspaceId: userId,
    personId: person.id,
    context: { talentPool: true },
  });
  const existingApplication = await db.prepare(
    `SELECT id, ingestion_key
       FROM applications
      WHERE legacy_candidate_id = ?1
      LIMIT 1`,
  ).bind(candidate.id).first<{ id: string; ingestion_key: string }>();
  const application = await store.upsertApplication({
    ingestionKey: existingApplication?.ingestion_key ?? `application:candidate:${candidate.id}`,
    workspacePersonId: workspacePerson.id,
    legacyCandidateId: candidate.id,
    pipelineId: candidate.pipeline_id,
    status: 'standalone_code_review_match_fixture',
    context: { seededBy: 'e2e', talentPool: candidate.pipeline_id === null },
  });

  return {
    candidateId: candidate.id,
    name: candidate.name ?? email,
    email,
    pipelineId: candidate.pipeline_id,
    personId: person.id,
    workspacePersonId: workspacePerson.id,
    applicationId: application.id,
  };
}

async function upsertSeedConcepts(
  store: LivingContextStore,
  concepts: SeedConceptInput[],
): Promise<Map<string, string>> {
  const conceptIds = new Map<string, string>();
  for (const concept of concepts) {
    const persisted = await store.upsertConcept({
      ingestionKey: `concept:${concept.canonicalKey}`,
      canonicalKey: concept.canonicalKey,
      namespace: concept.namespace ?? concept.canonicalKey.split(':')[0] ?? 'term',
      label: concept.label ?? concept.canonicalKey,
      description: concept.description,
      aliases: [],
      metadata: { source: 'e2e_seed' },
    });
    conceptIds.set(concept.canonicalKey, persisted.id);
  }
  return conceptIds;
}

async function seedCandidateEvidence(input: {
  db: D1Database;
  fixtureId: string;
  identity: Awaited<ReturnType<typeof loadCandidateIdentity>>;
  concepts: SeedConceptInput[];
  evidence: SeedCandidateEvidenceInput[];
  source?: SeedCandidateEvidenceSourceInput;
  now: string;
}): Promise<{ conceptIds: Map<string, string>; sourceSpanIds: string[] }> {
  const { db, fixtureId, identity, concepts, evidence, source, now } = input;
  const store = new LivingContextStore(db);
  const interactionType = source?.interactionType ?? 'assessment';
  const artifactType = source?.artifactType ?? 'assessment_response';
  const externalReference = source?.externalReference ?? `e2e:${fixtureId}`;
  const logicalKey = source?.logicalKey ?? `standalone-review-match-fixture:${fixtureId}`;
  const contextRecordType = source?.contextRecordType
    ?? (artifactType === 'meeting_transcript' ? 'meeting_transcript_assertion' : 'candidate_evidence_context');
  const conceptIds = await upsertSeedConcepts(store, concepts);

  const content = evidence.map((entry) => entry.exactText).join('\n');
  const interaction = await store.upsertInteraction({
    ingestionKey: `e2e:${fixtureId}:candidate:${identity.candidateId}:interaction`,
    workspacePersonId: identity.workspacePersonId,
    applicationId: identity.applicationId,
    interactionType,
    externalReference,
    startedAt: now,
    endedAt: now,
    metadata: { source: 'standalone-review-match-fixture', fixtureSource: source ?? null },
  });
  const artifact = await store.upsertArtifact({
    ingestionKey: `e2e:${fixtureId}:candidate:${identity.candidateId}:artifact`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    artifactType,
    logicalKey,
    metadata: { source: 'e2e_seed', fixtureSource: source ?? null },
  });
  const version = await store.createArtifactVersion({
    ingestionKey: `e2e:${fixtureId}:candidate:${identity.candidateId}:artifact-version:${await contentHash(content)}`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash: await contentHash(content),
    mediaType: 'text/plain',
    contentText: content,
    byteLength: byteLength(content),
    metadata: { source: 'e2e_seed', fixtureSource: source ?? null },
  });

  const sourceSpanIds: string[] = [];
  let cursor = 0;
  for (let index = 0; index < evidence.length; index += 1) {
    const entry = evidence[index]!;
    const charStart = cursor;
    const charEnd = charStart + entry.exactText.length;
    const sourceSpan = await store.createSourceSpan({
      ingestionKey: `e2e:${fixtureId}:candidate:${identity.candidateId}:span:${index}:${await contentHash(entry.exactText)}`,
      artifactVersionId: version.id,
      stableSegmentId: `evidence-${index + 1}`,
      byteStart: byteLength(content.slice(0, charStart)),
      byteEnd: byteLength(content.slice(0, charEnd)),
      charStart,
      charEnd,
      lineStart: index + 1,
      lineEnd: index + 1,
      exactText: entry.exactText,
      metadata: { source: 'e2e_seed', fixtureSource: source ?? null },
    });
    sourceSpanIds.push(sourceSpan.id);

    const episode = await store.upsertEpisode({
      ingestionKey: `e2e:${fixtureId}:candidate:${identity.candidateId}:episode:${index}`,
      workspacePersonId: identity.workspacePersonId,
      interactionId: interaction.id,
      narrative: entry.narrative ?? entry.exactText,
      startedAt: now,
      endedAt: now,
      metadata: { source: 'e2e_seed' },
    });
    const assertion = await store.upsertAssertion({
      ingestionKey: `e2e:${fixtureId}:candidate:${identity.candidateId}:assertion:${index}`,
      workspacePersonId: identity.workspacePersonId,
      episodeId: episode.id,
      subjectType: 'person',
      subjectId: identity.personId,
      predicate: entry.predicate,
      objectType: 'concept',
      objectValue: { conceptKeys: entry.conceptKeys },
      narrative: entry.narrative ?? entry.exactText,
      qualifiers: { source: 'e2e_seed' },
      confidence: entry.confidence ?? 1,
      polarity: 1,
      extractionVersion: 'e2e-source-backed-v1',
      observedAt: now,
    });
    await store.linkAssertionSourceSpan(assertion.id, sourceSpan.id);
    for (const conceptKey of entry.conceptKeys) {
      const conceptId = conceptIds.get(conceptKey);
      if (!conceptId) throw new Error(`candidate evidence references unknown concept ${conceptKey}`);
      await store.linkAssertionConcept(assertion.id, conceptId, 'about', 1);
      await store.upsertSignalEvidence({
        ingestionKey: `e2e:${fixtureId}:candidate:${identity.candidateId}:signal:${index}:${conceptKey}`,
        workspacePersonId: identity.workspacePersonId,
        interactionId: interaction.id,
        assertionId: assertion.id,
        conceptId,
        signalKey: conceptKey,
        evidenceLevel: entry.evidenceLevel,
        strength: entry.strength ?? 1,
        polarity: 1,
        observedAt: now,
        metadata: { source: 'e2e_seed' },
      });
    }
    await store.upsertContextRecord({
      ingestionKey: `e2e:${fixtureId}:candidate:${identity.candidateId}:context-record:${index}`,
      workspacePersonId: identity.workspacePersonId,
      applicationId: identity.applicationId,
      interactionId: interaction.id,
      episodeId: episode.id,
      assertionId: assertion.id,
      recordType: contextRecordType,
      predicate: entry.predicate,
      narrative: entry.narrative ?? entry.exactText,
      confidence: entry.confidence ?? 1,
      polarity: 1,
      extractionVersion: 'e2e-source-backed-v1',
      observedAt: now,
      sources: [{
        sourceSpanId: sourceSpan.id,
        evidenceRole: 'support',
        exactText: entry.exactText,
        contentHash: await contentHash(entry.exactText),
        locator: { fixtureId, line: index + 1 },
      }],
      entities: [
        { entityType: 'person', entityId: identity.personId, relationship: 'subject', confidence: 1 },
        { entityType: 'application', entityId: identity.applicationId, relationship: 'context', confidence: 1 },
      ],
      concepts: entry.conceptKeys.map((conceptKey) => ({
        conceptId: conceptIds.get(conceptKey)!,
        relationship: 'about',
        weight: 1,
      })),
    });
    cursor = charEnd + 1;
  }
  return { conceptIds, sourceSpanIds };
}

export async function buildFixtureChallengeInput(input: {
  fixtureId: string;
  seed: SeededRepoRequest;
  now: string;
}): Promise<{
  challengeInput: NormalizedPullRequestInput;
  structuralFacts: StructuralFact[];
}> {
  const { fixtureId, seed, now } = input;
  const repository = repositoryRef(seed);
  const snapshot = await buildRepoSnapshot({
    repository,
    commitSha: seed.pullRequest.headSha ?? 'dddddddddddddddddddddddddddddddddddddddd',
    defaultBranch: 'main',
    observedAt: now,
    treeHash: await contentHash(stableJson({
      fixtureId,
      spans: seed.repoSpans.map((span) => ({
        key: span.key,
        path: span.path,
        exactText: span.exactText,
      })),
    })),
    parentCommitShas: [seed.pullRequest.baseSha ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  });

  const metadataContent = stableJson({
    author: seed.pullRequest.author ?? 'pipe-e2e',
    baseSha: seed.pullRequest.baseSha ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headSha: seed.pullRequest.headSha ?? 'dddddddddddddddddddddddddddddddddddddddd',
    mergedAt: seed.pullRequest.mergedAt ?? now,
    number: seed.pullRequest.number,
    repository: seed.repo.fullName,
    title: seed.pullRequest.title,
    url: `${seed.repo.githubUrl}/pull/${seed.pullRequest.number}`,
  } as JsonValue);
  const metadataArtifact = await buildSourceArtifact({
    repoSnapshotId: snapshot.id,
    kind: 'pull_request',
    path: `.pipe/pull-requests/${seed.pullRequest.number}.json`,
    externalRef: `${seed.repo.githubUrl}/pull/${seed.pullRequest.number}`,
    language: 'json',
    mediaType: 'application/json',
  });
  const metadataVersion = await buildSourceArtifactVersion({
    artifactId: metadataArtifact.id,
    repoSnapshotId: snapshot.id,
    content: metadataContent,
    createdAt: now,
  });
  const metadataSpan = await buildSourceSpan({
    repoSnapshotId: snapshot.id,
    artifactId: metadataArtifact.id,
    artifactVersionId: metadataVersion.id,
    contentHash: metadataVersion.contentHash,
    start: { byteOffset: 0, line: 1, column: 1 },
    end: {
      byteOffset: metadataVersion.byteLength,
      line: lineCount(metadataContent),
      column: sourceEndColumn(metadataContent),
    },
    exactText: metadataContent,
    displayLabel: `${seed.repo.fullName}#${seed.pullRequest.number} metadata`,
    prSide: 'metadata',
  });

  const changedFiles: NormalizedPullRequestFile[] = [];
  const sourceArtifacts = [metadataArtifact];
  const sourceArtifactVersions = [metadataVersion];
  const sourceSpans = [metadataSpan];
  const spanIdsByKey = new Map<string, string>();
  const symbolIdsByKey = new Map<string, string>();
  const artifactKindsByKey = new Map<string, SourceArtifactKind>();

  for (const span of seed.repoSpans) {
    const kind = normalizeArtifactKind(span);
    const language = normalizedLanguage(seed.repo.primaryLanguage);
    const artifact = await buildSourceArtifact({
      repoSnapshotId: snapshot.id,
      kind,
      path: span.path,
      externalRef: `${seed.repo.githubUrl}/blob/${seed.pullRequest.headSha}/${span.path}`,
      language,
    });
    const version = await buildSourceArtifactVersion({
      artifactId: artifact.id,
      repoSnapshotId: snapshot.id,
      content: span.exactText,
      createdAt: now,
    });
    const sourceSpan = await buildSourceSpan({
      repoSnapshotId: snapshot.id,
      artifactId: artifact.id,
      artifactVersionId: version.id,
      contentHash: version.contentHash,
      start: { byteOffset: 0, line: span.lineStart ?? 1, column: 1 },
      end: {
        byteOffset: version.byteLength,
        line: span.lineEnd ?? ((span.lineStart ?? 1) + lineCount(span.exactText) - 1),
        column: sourceEndColumn(span.exactText),
      },
      exactText: span.exactText,
      displayLabel: `${span.path}:${span.lineStart ?? 1}`,
      prSide: 'head',
    });
    const symbolName = symbolNameForSpan(span);
    const symbol = await buildSymbol({
      repoSnapshotId: snapshot.id,
      language,
      qualifiedName: `${span.path}:${symbolName}`,
      name: symbolName,
      kind: kind === 'test' ? 'test' : 'function',
      definingSpanId: sourceSpan.id,
      exported: kind !== 'test',
    });

    sourceArtifacts.push(artifact);
    sourceArtifactVersions.push(version);
    sourceSpans.push(sourceSpan);
    spanIdsByKey.set(span.key, sourceSpan.id);
    symbolIdsByKey.set(span.key, symbol.id);
    artifactKindsByKey.set(span.key, kind);
    changedFiles.push({
      path: span.path,
      status: 'modified',
      language,
      additions: lineCount(span.exactText),
      deletions: 0,
      artifact,
      artifactVersion: version,
      hunks: [{
        header: `@@ ${span.key} @@`,
        patch: span.exactText,
        sourceSpan,
        changedSymbolIds: [symbol.id],
      }],
      symbols: [symbol],
    });
  }

  const factsById = new Map<string, StructuralFact>();
  for (const demand of seed.demands) {
    const sourceSpanIds = demand.sourceSpanKeys.map((key) => {
      const spanId = spanIdsByKey.get(key);
      if (!spanId) throw new Error(`demand ${demand.id} references unknown repo span key ${key}`);
      return spanId;
    });
    const subjectSymbolId = demand.sourceSpanKeys
      .map((key) => symbolIdsByKey.get(key))
      .find((id): id is string => Boolean(id));
    if (!subjectSymbolId) throw new Error(`demand ${demand.id} has no symbol-backed source span`);
    const touchesTest = demand.sourceSpanKeys.some((key) => artifactKindsByKey.get(key) === 'test');
    for (const conceptKey of demand.conceptKeys) {
      const fact = await buildStructuralFact({
        repoSnapshotId: snapshot.id,
        kind: touchesTest ? 'tests' : 'contains',
        subject: { symbolId: subjectSymbolId },
        object: { concept: conceptKey },
        sourceSpanIds,
        confidence: 1,
        parser: 'e2e-source-backed-fixture',
      });
      factsById.set(fact.id, fact);
    }
  }

  const tests = changedFiles
    .filter((file) => file.artifact.kind === 'test')
    .map((file) => ({
      path: file.path,
      framework: testFrameworkForPath(file.path),
      sourceSpanIds: file.hunks.map((hunk) => hunk.sourceSpan.id),
      relatedSymbolIds: [...new Set(file.hunks.flatMap((hunk) => hunk.changedSymbolIds))].sort(),
    }));

  return {
    challengeInput: {
      repoSnapshot: snapshot,
      number: seed.pullRequest.number,
      url: `${seed.repo.githubUrl}/pull/${seed.pullRequest.number}`,
      title: seed.pullRequest.title,
      author: seed.pullRequest.author ?? 'pipe-e2e',
      primaryLanguage: seed.repo.primaryLanguage ?? 'TypeScript',
      baseSha: seed.pullRequest.baseSha ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: seed.pullRequest.headSha ?? 'dddddddddddddddddddddddddddddddddddddddd',
      mergedAt: seed.pullRequest.mergedAt ?? now,
      metadataSourceSpanIds: [metadataSpan.id],
      sourceArtifacts,
      sourceArtifactVersions,
      sourceSpans,
      changedFiles,
      tests,
      structuralFacts: [...factsById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    },
    structuralFacts: [...factsById.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

async function seedRoleSourceContext(input: {
  db: D1Database;
  fixtureId: string;
  seed: SeedRequest;
  conceptIds: Map<string, string>;
  ownerId: string;
  pipelineId: string | null;
  now: string;
}): Promise<{
  roleContextId: string;
  roleSnapshotId: string;
  relevantConcepts: string[];
  requiredConcepts: string[];
  resolverVersion: string;
  sourceReferences: RoleSourceReference[];
} | null> {
  const { db, fixtureId, seed, conceptIds, ownerId, pipelineId, now } = input;
  const roleSource = seed.roleSource;
  if (!roleSource) return null;
  const roleContextId = `e2e-role-context-${fixtureId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 96)}`;
  const selectedConcepts = roleSource.selectedConceptKeys.map((conceptKey) => {
    const concept = seed.concepts.find((entry) => entry.canonicalKey === conceptKey);
    const conceptId = conceptIds.get(conceptKey);
    if (!concept || !conceptId) {
      throw new Error(`roleSource selectedConceptKeys references unknown concept ${conceptKey}`);
    }
    return {
      conceptKey,
      conceptId,
      label: concept.label ?? concept.canonicalKey.split(':').at(-1) ?? concept.canonicalKey,
    };
  });
  const selectedTerms = selectedConcepts.map((concept) => concept.label);
  const jobDescriptionHash = await contentHash(roleSource.jobDescriptionMd);

  await db.prepare(
    `INSERT INTO role_contexts (
       id, pipeline_id, owner_id, baseline, knowledge_state, exchanges,
       question_budget, questions_asked, status, job_description_md,
       rcd_version, rcd_json, validation_metadata, non_negotiable_skills_json,
       created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, '{}', '[]', 0, 0, 'COMPLETE', ?5,
       'simple-jd-v1', NULL, ?6, ?7, ?8, ?8)
     ON CONFLICT(id) DO UPDATE SET
       job_description_md = excluded.job_description_md,
       validation_metadata = excluded.validation_metadata,
       non_negotiable_skills_json = excluded.non_negotiable_skills_json,
       updated_at = excluded.updated_at`,
  ).bind(
    roleContextId,
    pipelineId,
    ownerId,
    JSON.stringify({ title: roleSource.title ?? 'E2E source-backed role', source: 'e2e_seed' }),
    roleSource.jobDescriptionMd,
    JSON.stringify({
      source: 'e2e_seed',
      fixtureId,
      selectedConceptKeys: roleSource.selectedConceptKeys,
      contentHash: jobDescriptionHash,
    }),
    JSON.stringify(selectedTerms),
    now,
  ).run();

  const store = new LivingContextStore(db);
  const artifact = await store.upsertArtifact({
    ingestionKey: `e2e:${fixtureId}:role:${roleContextId}:artifact`,
    artifactType: 'job_description',
    logicalKey: `standalone-review-match-fixture:${fixtureId}:role-source`,
    metadata: { source: 'e2e_seed', roleContextId },
  });
  const version = await store.createArtifactVersion({
    ingestionKey: `e2e:${fixtureId}:role:${roleContextId}:artifact-version:${jobDescriptionHash}`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash: jobDescriptionHash,
    mediaType: 'text/markdown',
    contentText: roleSource.jobDescriptionMd,
    byteLength: byteLength(roleSource.jobDescriptionMd),
    metadata: { source: 'e2e_seed', roleContextId },
  });
  const span = await store.createSourceSpan({
    ingestionKey: `e2e:${fixtureId}:role:${roleContextId}:source-span:${jobDescriptionHash}`,
    artifactVersionId: version.id,
    stableSegmentId: 'job-description',
    byteStart: 0,
    byteEnd: byteLength(roleSource.jobDescriptionMd),
    charStart: 0,
    charEnd: roleSource.jobDescriptionMd.length,
    lineStart: 1,
    lineEnd: roleSource.jobDescriptionMd.split('\n').length,
    exactText: roleSource.jobDescriptionMd,
    metadata: { source: 'e2e_seed', roleContextId },
  });
  await store.upsertContextRecord({
    ingestionKey: `e2e:${fixtureId}:role:${roleContextId}:job-description-context`,
    scopeType: 'role_context',
    scopeId: roleContextId,
    recordType: 'simple_job_description',
    predicate: 'defines role source text',
    narrative: `E2E source-backed role source for ${roleSource.title ?? roleContextId}.`,
    qualifiers: {
      roleContextId,
      pipelineId,
      selectedTerms,
      selectedConceptKeys: roleSource.selectedConceptKeys,
      contentHash: jobDescriptionHash,
    },
    confidence: 1,
    extractionVersion: 'simple-jd-v1',
    observedAt: now,
    sources: [{
      sourceSpanId: span.id,
      evidenceRole: 'source',
      exactText: roleSource.jobDescriptionMd,
      contentHash: jobDescriptionHash,
      locator: { fixtureId, source: 'job_description' },
    }],
    entities: [
      { entityType: 'role_context', entityId: roleContextId, relationship: 'scope' },
      {
        entityType: 'job_description',
        entityId: artifact.id,
        relationship: 'source_artifact',
        metadata: { artifactVersionId: version.id, sourceSpanId: span.id, contentHash: jobDescriptionHash },
      },
      ...selectedTerms.map((term) => ({
        entityType: 'selected_term',
        relationship: 'literal_term',
        value: { surface: term },
      })),
    ],
    concepts: selectedConcepts.map((concept) => ({
      conceptId: concept.conceptId,
      relationship: 'source_term',
      weight: 1,
    })),
  });

  const roleSemantics = await loadRoleChallengeSemantics(db, {
    id: roleContextId,
    rcd_version: 'simple-jd-v1',
    rcd_json: null,
    job_description_md: roleSource.jobDescriptionMd,
    non_negotiable_skills_json: JSON.stringify(selectedTerms),
  });
  return {
    roleContextId,
    roleSnapshotId: roleSemantics.roleSnapshotId,
    relevantConcepts: roleSemantics.relevantConcepts,
    requiredConcepts: roleSemantics.requiredConcepts,
    resolverVersion: roleSemantics.resolverVersion,
    sourceReferences: roleSemantics.sources.map((source) => ({
      entityId: source.roleNodeId,
      locator: source.sourceSection ?? 'role_context',
      conceptKeys: source.conceptKeys,
      sourceRefType: source.sourceRefType,
      sourceRefId: source.sourceRefId,
      sourceSpanId: source.sourceSpanId,
      exactText: source.exactText,
      contentHash: source.contentHash,
    })),
  };
}

async function seedRepoChallenge(input: {
  db: D1Database;
  fixtureId: string;
  seed: SeededRepoRequest;
  now: string;
}): Promise<{
  repoId: number;
  packetId: string;
  repoSourceSpanIds: string[];
  demandIds: string[];
  demandFamilies: string[];
  repoUrl: string;
  prNumber: number;
}> {
  const { db, fixtureId, seed, now } = input;
  await db.prepare(
    `INSERT INTO qualified_repos (
       github_url, full_name, description, primary_language, license_spdx,
       stars, last_pushed_at, has_ci, has_tests, test_framework,
       pr_quality_score, contamination_risk, detected_stack_json, pass,
       disqualified, crawled_at, refreshed_at
     ) VALUES (?1, ?2, ?3, ?4, 'NOASSERTION', 0, ?5, 1, 1, 'source-backed-fixture',
       1, 0, '[]', 2, 0, ?5, ?5)
     ON CONFLICT(github_url) DO UPDATE SET
       full_name = excluded.full_name,
       description = excluded.description,
       primary_language = excluded.primary_language,
       has_ci = excluded.has_ci,
       has_tests = excluded.has_tests,
       test_framework = excluded.test_framework,
       pr_quality_score = excluded.pr_quality_score,
       contamination_risk = excluded.contamination_risk,
       detected_stack_json = excluded.detected_stack_json,
       pass = excluded.pass,
       disqualified = excluded.disqualified,
       refreshed_at = excluded.refreshed_at`,
  ).bind(
    seed.repo.githubUrl,
    seed.repo.fullName,
    seed.repo.description ?? null,
    seed.repo.primaryLanguage ?? 'TypeScript',
    now,
  ).run();

  const repo = await db.prepare(
    'SELECT id FROM qualified_repos WHERE github_url = ?1',
  ).bind(seed.repo.githubUrl).first<{ id: number }>();
  if (!repo) throw new Error('failed to persist fixture repo');

  if (seed.omitSamplePrRow) {
    await db.prepare(
      `DELETE FROM repo_sample_prs WHERE repo_id = ?1 AND pr_number = ?2`,
    ).bind(repo.id, seed.pullRequest.number).run();
  } else {
    await db.prepare(
      `INSERT INTO repo_sample_prs (
         repo_id, pr_number, pr_url, title, merged_at, changed_file_count,
         modifies_tests, additions, deletions, construct_slugs_json,
         swe_bench_eligible, changed_file_paths_json
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, 0, '[]', 0, ?8)
       ON CONFLICT(repo_id, pr_number) DO UPDATE SET
         pr_url = excluded.pr_url,
         title = excluded.title,
         merged_at = excluded.merged_at,
         changed_file_count = excluded.changed_file_count,
         modifies_tests = excluded.modifies_tests,
         additions = excluded.additions,
         swe_bench_eligible = excluded.swe_bench_eligible,
         changed_file_paths_json = excluded.changed_file_paths_json`,
    ).bind(
      repo.id,
      seed.pullRequest.number,
      `${seed.repo.githubUrl}/pull/${seed.pullRequest.number}`,
      seed.pullRequest.title,
      seed.pullRequest.mergedAt ?? now,
      seed.repoSpans.length,
      seed.repoSpans.reduce((sum, span) => sum + span.exactText.split('\n').length, 0),
      JSON.stringify(seed.repoSpans.map((span) => span.path)),
    ).run();
  }

  const { challengeInput, structuralFacts } = await buildFixtureChallengeInput({ fixtureId, seed, now });
  const packet = await buildChallengePacket(challengeInput);
  console.error('[e2eSeed] packet size:', JSON.stringify(packet).length, 'fixtureId:', fixtureId);
  if (!packet.quality.eligible) {
    const failedGates = packet.quality.gates
      .filter((gate) => !gate.passed)
      .map((gate) => `${gate.gate}: ${gate.reason}`)
      .join('; ');
    throw new Error(`fixture did not produce a production-ready review challenge packet: ${failedGates}`);
  }
  const semantics = await deriveRepoSemantics({
    pullRequest: challengeInput,
    packet,
    structuralFacts,
  });
  await persistReviewChallengeGraph(db, repo.id, challengeInput, packet, {
    structuralFacts,
    codeEpisodes: semantics.episodes,
    facets: semantics.facets,
    semanticAssertions: semantics.assertions,
    repoSignals: semantics.signals,
  });

  return {
    repoId: repo.id,
    packetId: packet.id,
    repoSourceSpanIds: packet.sourceSpanIds,
    demandIds: packet.demands.map((demand) => demand.id),
    demandFamilies: packet.demandFamilies,
    repoUrl: seed.repo.githubUrl,
    prNumber: seed.pullRequest.number,
  };
}

function requireSeededRepoRequest(seed: SeedRequest): SeededRepoRequest {
  if (!seed.repo || !seed.pullRequest || seed.repoSpans.length === 0 || seed.demands.length === 0) {
    throw new Error('repo, pullRequest, repoSpans, and demands are required when no existingChallengePacketId is provided');
  }
  return seed as SeededRepoRequest;
}

export async function loadExistingRepoChallenge(input: {
  db: D1Database;
  packetId: string;
}): Promise<{
  repoId: number;
  packetId: string;
  repoSourceSpanIds: string[];
  demandIds: string[];
  demandFamilies: string[];
  repoUrl: string;
  prNumber: number;
}> {
  const row = await input.db.prepare(
    `SELECT rcp.id, rcp.repo_id, rcp.pr_number, rcp.production_ready,
            rcp.quality_score, rcp.packet_json, qr.github_url
       FROM review_challenge_packets rcp
       LEFT JOIN qualified_repos qr ON qr.id = rcp.repo_id
      WHERE rcp.id = ?1`,
  ).bind(input.packetId).first<{
    id: string;
    repo_id: number;
    pr_number: number | null;
    production_ready: number;
    quality_score: number | null;
    packet_json: string;
    github_url: string | null;
  }>();
  if (!row) throw new Error(`existingChallengePacketId ${input.packetId} was not found`);
  if (row.production_ready !== 1 || (row.quality_score ?? 0) < 0.7) {
    throw new Error(`existingChallengePacketId ${input.packetId} is not production-ready`);
  }

  let packet: RepoChallengePacket;
  try {
    packet = JSON.parse(row.packet_json) as RepoChallengePacket;
  } catch {
    throw new Error(`existingChallengePacketId ${input.packetId} has invalid packet_json`);
  }
  if (packet.id !== row.id) {
    throw new Error(`existingChallengePacketId ${input.packetId} does not match packet_json id ${packet.id}`);
  }

  return {
    repoId: row.repo_id,
    packetId: row.id,
    repoSourceSpanIds: packet.sourceSpanIds,
    demandIds: packet.demands.map((demand) => demand.id),
    demandFamilies: packet.demandFamilies,
    repoUrl: row.github_url ?? packet.repository.canonicalUrl,
    prNumber: row.pr_number ?? packet.pullRequest.number,
  };
}

/**
 * POST /api/v1/internal/e2e/talent-join-token
 *
 * E2E-only bridge for the self-serve talent pool join flow: the public
 * /rpc/talent/join endpoint intentionally delivers the invite token by email
 * only, so specs use this recruiter-authed, local/test-gated endpoint to
 * retrieve the token for a candidate the authed owner controls.
 */
e2eSeed.post('/talent-join-token', async (c) => {
  if (!isLocalOrTestRequest(c.env, c.req.url)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
  }

  let email: string;
  try {
    email = requireString(requireRecord(await c.req.json(), 'body'), 'email').toLowerCase();
  } catch (err) {
    return c.json({
      error: {
        code: 'BAD_REQUEST',
        message: err instanceof Error ? err.message : 'email is required.',
      },
    }, 400);
  }

  const houseOwnerId = c.env.TALENT_POOL_HOUSE_OWNER_ID?.trim();
  if (!houseOwnerId) {
    return c.json({ error: { code: 'JOIN_NOT_OPEN', message: 'TALENT_POOL_HOUSE_OWNER_ID is not configured.' } }, 503);
  }

  const row = await c.env.DB.prepare(
    `SELECT invite_token FROM candidates
      WHERE owner_id = ?1 AND lower(email) = ?2 AND pipeline_id IS NULL
      ORDER BY created_at ASC
      LIMIT 1`,
  )
    .bind(houseOwnerId, email)
    .first<{ invite_token: string }>();

  if (!row) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'No candidate for that email.' } }, 404);
  }

  return c.json({ inviteToken: row.invite_token });
});

e2eSeed.post('/standalone-review-match-fixture', async (c) => {
  if (!isLocalOrTestRequest(c.env, c.req.url)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
  }

  let seed: SeedRequest;
  try {
    seed = parseSeedRequest(await c.req.json());
  } catch (err) {
    return c.json({
      error: {
        code: 'BAD_REQUEST',
        message: err instanceof Error ? err.message : 'Invalid fixture request.',
      },
    }, 400);
  }

  const fixtureId = seed.fixtureId ?? `candidate:${seed.candidateId}:standalone-review-match`;
  const now = new Date().toISOString();
  try {
    const identity = await loadCandidateIdentity(c.env.DB, seed.candidateId, c.get('userId'));
    const candidate = seed.candidateEvidence.length > 0
      ? await seedCandidateEvidence({
          db: c.env.DB,
          fixtureId,
          identity,
          concepts: seed.concepts,
          evidence: seed.candidateEvidence,
          source: seed.candidateEvidenceSource,
          now,
        })
      : {
          conceptIds: await upsertSeedConcepts(new LivingContextStore(c.env.DB), seed.concepts),
          sourceSpanIds: [],
        };
    const repo = seed.existingChallengePacketId
      ? await loadExistingRepoChallenge({
          db: c.env.DB,
          packetId: seed.existingChallengePacketId,
        })
      : await seedRepoChallenge({
          db: c.env.DB,
          fixtureId,
          seed: requireSeededRepoRequest(seed),
          now,
        });
    const roleContext = await seedRoleSourceContext({
      db: c.env.DB,
      fixtureId,
      seed,
      conceptIds: candidate.conceptIds,
      ownerId: c.get('userId'),
      pipelineId: identity.pipelineId,
      now,
    });
    const seededMatch = roleContext
      ? await matchCandidateToReviewChallenge(c.env.DB, identity.candidateId, {
          roleContextId: roleContext.roleContextId,
          roleSnapshotId: 'standalone-code-review-v1',
          roleConcepts: roleContext.relevantConcepts,
          requiredConcepts: roleContext.requiredConcepts,
          conceptResolverVersion: roleContext.resolverVersion,
          roleSourceReferences: roleContext.sourceReferences,
        })
      : null;
    if (roleContext && (seededMatch?.status !== 'MATCHED' || !seededMatch.repoId || !seededMatch.prNumber)) {
      throw new Error(`fixture role-backed matcher returned ${seededMatch?.status ?? 'NO_MATCH'}`);
    }
    if (
      roleContext
      && seed.existingChallengePacketId
      && seededMatch?.explanation?.selectedPr?.challengeId !== seed.existingChallengePacketId
    ) {
      throw new Error(
        `fixture role-backed matcher selected ${seededMatch?.explanation?.selectedPr?.challengeId ?? 'NO_PACKET'} instead of existingChallengePacketId ${seed.existingChallengePacketId}`,
      );
    }
    if (roleContext && seededMatch?.repoId && seededMatch.prNumber) {
      const matchedRepo = await c.env.DB.prepare(
        `SELECT github_url FROM qualified_repos WHERE id = ?1`,
      ).bind(seededMatch.repoId).first<{ github_url: string | null }>();
      const matchedRepoUrl = matchedRepo?.github_url ?? repo.repoUrl;
      if (!matchedRepoUrl) throw new Error('fixture role-backed match selected repo without github_url');
      let standaloneInterview = await c.env.DB.prepare(
        `SELECT id
           FROM scheduled_interviews
          WHERE candidate_id = ?1
            AND interview_type = 'CODE_REVIEW'
            AND stage_id IS NULL
          ORDER BY created_at DESC
          LIMIT 1`,
      ).bind(identity.candidateId).first<{ id: string }>();
      if (!standaloneInterview) {
        const interviewId = crypto.randomUUID();
        await c.env.DB.prepare(
          `INSERT INTO scheduled_interviews (
             id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
             status, scheduled_at, scheduling_provider, scheduling_url, sync_source,
             created_at, updated_at
           ) VALUES (?1, ?2, ?3, NULL, ?4, 'CODE_REVIEW',
             'INVITED', NULL, NULL, NULL, 'MANUAL', ?5, ?5)`,
        ).bind(
          interviewId,
          identity.candidateId,
          identity.pipelineId,
          c.get('userId'),
          now,
        ).run();
        standaloneInterview = { id: interviewId };
      }
      await c.env.DB.prepare(
        `UPDATE scheduled_interviews
            SET matched_repo_id = ?1,
                github_repo_url = ?2,
                github_pr_number = ?3,
                updated_at = ?4
          WHERE id = ?5
            AND status NOT IN ('COMPLETED', 'CANCELLED')`,
      ).bind(
        seededMatch.repoId,
        matchedRepoUrl,
        seededMatch.prNumber,
        now,
        standaloneInterview.id,
      ).run();
    }

    return c.json({
      ok: true,
      fixtureId,
      candidateId: identity.candidateId,
      applicationId: identity.applicationId,
      workspacePersonId: identity.workspacePersonId,
      conceptKeys: [...candidate.conceptIds.keys()],
      candidateSourceSpanIds: candidate.sourceSpanIds,
      repoId: repo.repoId,
      packetId: repo.packetId,
      repoSourceSpanIds: repo.repoSourceSpanIds,
      demandIds: repo.demandIds,
      demandFamilies: repo.demandFamilies,
      repoUrl: repo.repoUrl,
      prNumber: repo.prNumber,
      roleContextId: roleContext?.roleContextId ?? null,
      roleSources: roleContext?.sourceReferences ?? [],
    });
  } catch (err) {
    console.error('[e2eSeed] Failed to seed standalone review fixture:', err);
    return c.json({
      error: {
        code: 'SEED_FAILED',
        message: err instanceof Error ? err.message : 'Fixture seed failed.',
      },
    }, 500);
  }
});
