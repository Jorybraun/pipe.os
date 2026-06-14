import {
  deterministicEntityId,
  LivingContextStore,
  stableJson,
} from './persistence';
import { ensureContactLivingContext } from './compatibility';
import {
  OPEN_TERM_RESOLVER_VERSION,
  openSemanticTerm,
} from './openTerms';
import type { EvidenceLevel, JsonObject, JsonValue } from './types';

const TRANSCRIPT_PROJECTION_TYPE = 'meeting_transcript_semantics';
const SIGNAL_POLICY_VERSION = 'living-context-signal-noisy-or-v1';

export interface MeetingTranscriptSegmentInput {
  stableSegmentId?: string | null;
  text: string;
  speakerLabel?: string | null;
  speakerRole?: string | null;
  contactId?: string | null;
  channel?: number | null;
  timestampStartMs?: number | null;
  timestampEndMs?: number | null;
  confidence?: number | null;
  metadata?: JsonObject;
}

export interface MeetingTranscriptConceptInput {
  surface: string;
  relationship: string;
  weight: number;
  evidenceLevel?: EvidenceLevel | null;
  strength?: number | null;
}

export interface MeetingTranscriptAssertionInput {
  sourceSegmentIds: string[];
  subjectSegmentId: string;
  predicate: string;
  narrative: string;
  objectType?: string | null;
  objectValue?: JsonValue;
  qualifiers?: JsonObject;
  concepts?: MeetingTranscriptConceptInput[];
  confidence?: number | null;
  polarity?: number | null;
}

export interface MeetingTranscriptIngestionInput {
  meetingId: string;
  ownerId: string;
  transcript?: string;
  segments?: MeetingTranscriptSegmentInput[];
  summary?: string | null;
  semanticAssertions?: MeetingTranscriptAssertionInput[];
  extractorVersion?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  recordingKey?: string | null;
  provider?: string | null;
}

interface CanonicalSegment extends MeetingTranscriptSegmentInput {
  stableSegmentId: string;
  charStart: number;
  charEnd: number;
  byteStart: number;
  byteEnd: number;
  lineStart: number;
  lineEnd: number;
  timestampStartMs: number | null;
  timestampEndMs: number | null;
}

interface CanonicalTranscript {
  contentText: string;
  segments: CanonicalSegment[];
}

interface ParticipantRow {
  contact_id: string;
  role: string;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
}

interface ArtifactVersionRow {
  id: string;
  version_number: number;
}

interface SignalEvidenceRow {
  assertion_id: string;
  interaction_id: string | null;
  strength: number;
  polarity: number;
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

function pairedTimestamps(
  start: number | null | undefined,
  end: number | null | undefined,
): [number | null, number | null] {
  if (
    typeof start !== 'number'
    || typeof end !== 'number'
    || !Number.isFinite(start)
    || !Number.isFinite(end)
    || start < 0
    || end < start
  ) {
    return [null, null];
  }
  return [Math.round(start), Math.round(end)];
}

function nonEmptyTextRange(content: string, start: number, end: number): [number, number] | null {
  while (start < end && /\s/.test(content[start] ?? '')) start++;
  while (end > start && /\s/.test(content[end - 1] ?? '')) end--;
  return start < end ? [start, end] : null;
}

function lineNumberAt(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index++) {
    if (content[index] === '\n') line++;
  }
  return line;
}

function segmentAtOffsets(
  contentText: string,
  input: MeetingTranscriptSegmentInput,
  stableSegmentId: string,
  charStart: number,
  charEnd: number,
): CanonicalSegment {
  const [timestampStartMs, timestampEndMs] = pairedTimestamps(
    input.timestampStartMs,
    input.timestampEndMs,
  );
  return {
    ...input,
    stableSegmentId,
    text: contentText.slice(charStart, charEnd),
    charStart,
    charEnd,
    byteStart: new TextEncoder().encode(contentText.slice(0, charStart)).byteLength,
    byteEnd: new TextEncoder().encode(contentText.slice(0, charEnd)).byteLength,
    lineStart: lineNumberAt(contentText, charStart),
    lineEnd: lineNumberAt(contentText, Math.max(charStart, charEnd - 1)),
    timestampStartMs,
    timestampEndMs,
  };
}

function canonicalizePlainTranscript(transcript: string): CanonicalTranscript {
  const segments: CanonicalSegment[] = [];
  const separator = /\n[ \t]*\n+/g;
  let cursor = 0;
  let ordinal = 0;
  for (let match = separator.exec(transcript); match; match = separator.exec(transcript)) {
    const range = nonEmptyTextRange(transcript, cursor, match.index);
    if (range) {
      ordinal++;
      segments.push(segmentAtOffsets(
        transcript,
        { text: transcript.slice(range[0], range[1]), speakerLabel: 'mixed' },
        `paragraph-${String(ordinal).padStart(4, '0')}`,
        range[0],
        range[1],
      ));
    }
    cursor = match.index + match[0].length;
  }
  const finalRange = nonEmptyTextRange(transcript, cursor, transcript.length);
  if (finalRange) {
    ordinal++;
    segments.push(segmentAtOffsets(
      transcript,
      { text: transcript.slice(finalRange[0], finalRange[1]), speakerLabel: 'mixed' },
      `paragraph-${String(ordinal).padStart(4, '0')}`,
      finalRange[0],
      finalRange[1],
    ));
  }
  if (segments.length === 0) throw new Error('Meeting transcript contains no text');
  return { contentText: transcript, segments };
}

function canonicalizeStructuredTranscript(
  inputs: MeetingTranscriptSegmentInput[],
): CanonicalTranscript {
  const usable = inputs.filter((segment) => segment.text.trim().length > 0);
  if (usable.length === 0) throw new Error('Meeting transcript contains no segments');
  const ids = new Set<string>();
  let contentText = '';
  const segments: CanonicalSegment[] = [];
  for (let index = 0; index < usable.length; index++) {
    const input = usable[index]!;
    const stableSegmentId = input.stableSegmentId?.trim()
      || `segment-${String(index + 1).padStart(4, '0')}`;
    if (ids.has(stableSegmentId)) {
      throw new Error(`Duplicate transcript segment id "${stableSegmentId}"`);
    }
    ids.add(stableSegmentId);
    if (contentText.length > 0) contentText += '\n\n';
    const charStart = contentText.length;
    contentText += input.text;
    segments.push(segmentAtOffsets(
      contentText,
      input,
      stableSegmentId,
      charStart,
      contentText.length,
    ));
  }
  return { contentText, segments };
}

export function canonicalizeMeetingTranscript(
  input: Pick<MeetingTranscriptIngestionInput, 'transcript' | 'segments'>,
): CanonicalTranscript {
  if (input.segments && input.segments.length > 0) {
    return canonicalizeStructuredTranscript(input.segments);
  }
  if (typeof input.transcript === 'string') return canonicalizePlainTranscript(input.transcript);
  throw new Error('Meeting transcript text or segments are required');
}

function storedString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

function storedNumber(
  record: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

export function parseStoredMeetingTranscript(
  transcriptJson: string,
): { transcript: string; segments: MeetingTranscriptSegmentInput[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(transcriptJson);
  } catch {
    return {
      transcript: transcriptJson,
      segments: [{
        stableSegmentId: 'legacy-0001',
        text: transcriptJson,
        speakerLabel: 'mixed',
      }],
    };
  }
  if (!Array.isArray(parsed)) {
    const transcript = typeof parsed === 'string' ? parsed : transcriptJson;
    return {
      transcript,
      segments: [{
        stableSegmentId: 'legacy-0001',
        text: transcript,
        speakerLabel: 'mixed',
      }],
    };
  }

  const segments = parsed.flatMap((entry, index): MeetingTranscriptSegmentInput[] => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const text = storedString(record, 'text', 'content', 'transcript');
    if (!text) return [];
    const start = storedNumber(record, 'timestamp_start_ms', 'timestampStartMs');
    const end = storedNumber(record, 'timestamp_end_ms', 'timestampEndMs');
    const [timestampStartMs, timestampEndMs] = pairedTimestamps(start, end);
    return [{
      stableSegmentId: storedString(
        record,
        'stable_segment_id',
        'stableSegmentId',
        'id',
      ) ?? `legacy-${String(index + 1).padStart(4, '0')}`,
      text,
      speakerLabel: storedString(record, 'speaker', 'speaker_label', 'speakerLabel'),
      speakerRole: storedString(record, 'role', 'speaker_role', 'speakerRole'),
      contactId: storedString(record, 'contact_id', 'contactId'),
      channel: storedNumber(record, 'channel'),
      timestampStartMs,
      timestampEndMs,
      confidence: boundedScore(record.confidence),
      metadata: {
        legacyTimestamp: storedString(record, 'timestamp'),
        legacyTimestampMs: storedNumber(record, 'timestamp_ms', 'timestampMs'),
      },
    }];
  });
  if (segments.length === 0) {
    return {
      transcript: transcriptJson,
      segments: [{
        stableSegmentId: 'legacy-0001',
        text: transcriptJson,
        speakerLabel: 'mixed',
      }],
    };
  }
  return {
    transcript: segments.map((segment) => segment.text).join('\n\n'),
    segments,
  };
}

async function removePriorSemanticProjection(
  db: D1Database,
  artifactId: string,
): Promise<Array<{ workspace_person_id: string; signal_key: string }>> {
  const affected = await db.prepare(
    `SELECT DISTINCT se.workspace_person_id, se.signal_key
       FROM semantic_projection_runs spr
       JOIN semantic_projection_entities spe
         ON spe.run_id = spr.id AND spe.entity_type = 'assertion'
       JOIN signal_evidence se ON se.assertion_id = spe.entity_id
      WHERE spr.artifact_id = ?1 AND spr.projection_type = ?2`,
  ).bind(artifactId, TRANSCRIPT_PROJECTION_TYPE)
    .all<{ workspace_person_id: string; signal_key: string }>();

  await db.prepare(
    `DELETE FROM semantic_assertions
      WHERE id IN (
        SELECT spe.entity_id
          FROM semantic_projection_runs spr
          JOIN semantic_projection_entities spe ON spe.run_id = spr.id
         WHERE spr.artifact_id = ?1
           AND spr.projection_type = ?2
           AND spe.entity_type = 'assertion'
      )`,
  ).bind(artifactId, TRANSCRIPT_PROJECTION_TYPE).run();
  await db.prepare(
    `DELETE FROM episodes
      WHERE id IN (
        SELECT spe.entity_id
          FROM semantic_projection_runs spr
          JOIN semantic_projection_entities spe ON spe.run_id = spr.id
         WHERE spr.artifact_id = ?1
           AND spr.projection_type = ?2
           AND spe.entity_type = 'episode'
      )`,
  ).bind(artifactId, TRANSCRIPT_PROJECTION_TYPE).run();
  await db.prepare(
    `DELETE FROM semantic_projection_runs
      WHERE artifact_id = ?1 AND projection_type = ?2`,
  ).bind(artifactId, TRANSCRIPT_PROJECTION_TYPE).run();
  return affected.results ?? [];
}

function noisyOr(rows: SignalEvidenceRow[]): {
  score: number;
  confidence: number;
  positiveSupport: number;
  negativeSupport: number;
} {
  let positiveRemainder = 1;
  let negativeRemainder = 1;
  let confidenceRemainder = 1;
  for (const row of rows) {
    const contribution = row.strength * Math.abs(row.polarity);
    confidenceRemainder *= 1 - contribution;
    if (row.polarity >= 0) positiveRemainder *= 1 - contribution;
    else negativeRemainder *= 1 - contribution;
  }
  const positiveSupport = 1 - positiveRemainder;
  const negativeSupport = 1 - negativeRemainder;
  return {
    score: Math.max(0, Math.min(1, positiveSupport - negativeSupport)),
    confidence: Math.max(0, Math.min(1, 1 - confidenceRemainder)),
    positiveSupport,
    negativeSupport,
  };
}

export async function rebuildLivingContextSignalSnapshot(
  db: D1Database,
  store: LivingContextStore,
  workspacePersonId: string,
  signalKey: string,
  interactionId: string | null,
  artifactVersionId: string,
  asOf: string,
): Promise<void> {
  await db.prepare(
    `DELETE FROM signal_snapshots
      WHERE workspace_person_id = ?1
        AND signal_key = ?2
        AND policy_version = ?3`,
  ).bind(workspacePersonId, signalKey, SIGNAL_POLICY_VERSION).run();
  const evidence = await db.prepare(
    `SELECT assertion_id, interaction_id, strength, polarity
       FROM signal_evidence
      WHERE workspace_person_id = ?1 AND signal_key = ?2
      ORDER BY COALESCE(observed_at, created_at), id`,
  ).bind(workspacePersonId, signalKey).all<SignalEvidenceRow>();
  const rows = evidence.results ?? [];
  if (rows.length === 0) return;

  const total = noisyOr(rows);
  const conversationRows = interactionId
    ? rows.filter((row) => row.interaction_id === interactionId)
    : [];
  const conversation = conversationRows.length > 0 ? noisyOr(conversationRows) : null;
  const sourceDiversity = new Set(
    rows.map((row) => row.interaction_id ?? `assertion:${row.assertion_id}`),
  ).size;
  await store.upsertSignalSnapshot({
    ingestionKey: `signal-snapshot:${workspacePersonId}:${signalKey}:${artifactVersionId}`,
    workspacePersonId,
    signalKey,
    interactionId,
    asOf,
    conversationScore: conversation?.score ?? null,
    totalScore: total.score,
    confidence: total.confidence,
    evidenceCount: rows.length,
    sourceDiversity,
    dimensions: {
      positiveSupport: total.positiveSupport,
      negativeSupport: total.negativeSupport,
      conversationEvidenceCount: conversationRows.length,
    },
    policyVersion: SIGNAL_POLICY_VERSION,
  });
}

async function linkProjectionEntity(
  db: D1Database,
  runId: string,
  entityType: string,
  entityId: string,
  createdAt: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO semantic_projection_entities (run_id, entity_type, entity_id, created_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(run_id, entity_type, entity_id) DO NOTHING`,
  ).bind(runId, entityType, entityId, createdAt).run();
}

export async function ingestMeetingTranscriptToLivingContext(
  db: D1Database,
  input: MeetingTranscriptIngestionInput,
): Promise<{
  artifactId: string;
  artifactVersionId: string;
  versionNumber: number;
  sourceSpanCount: number;
  assertionCount: number;
}> {
  const canonical = canonicalizeMeetingTranscript(input);
  const participants = await db.prepare(
    `SELECT mp.contact_id, mp.role, m.started_at, m.ended_at, m.updated_at
       FROM meeting_participants mp
       JOIN meetings m ON m.id = mp.meeting_id
      WHERE mp.meeting_id = ?1
      ORDER BY mp.created_at, mp.id`,
  ).bind(input.meetingId).all<ParticipantRow>();
  const participantRows = participants.results ?? [];
  const store = new LivingContextStore(db);
  const identities = new Map<string, {
    workspacePersonId: string;
    interactionId: string;
  }>();
  const effectiveStartedAt = input.startedAt ?? participantRows[0]?.started_at ?? null;
  const effectiveEndedAt = input.endedAt ?? participantRows[0]?.ended_at ?? null;
  const observedAt = effectiveEndedAt
    ?? effectiveStartedAt
    ?? participantRows[0]?.updated_at
    ?? new Date().toISOString();

  for (const participant of participantRows) {
    const identity = await ensureContactLivingContext(db, participant.contact_id);
    if (!identity) continue;
    const interaction = await store.upsertInteraction({
      ingestionKey: `meeting:${input.meetingId}:person:${identity.workspacePersonId}`,
      workspacePersonId: identity.workspacePersonId,
      interactionType: 'video_meeting',
      externalReference: input.meetingId,
      startedAt: effectiveStartedAt,
      endedAt: effectiveEndedAt,
      metadata: {
        ownerId: input.ownerId,
        participantRole: participant.role,
      },
    });
    identities.set(participant.contact_id, {
      workspacePersonId: identity.workspacePersonId,
      interactionId: interaction.id,
    });
  }

  const artifact = await store.upsertArtifact({
    ingestionKey: `meeting:${input.meetingId}:transcript`,
    artifactType: 'meeting_transcript',
    logicalKey: input.meetingId,
    metadata: {
      meetingId: input.meetingId,
      recordingKey: input.recordingKey ?? null,
      provider: input.provider ?? null,
    },
  });
  const now = new Date().toISOString();
  for (const identity of identities.values()) {
    await db.prepare(
      `INSERT INTO artifact_interactions (
         artifact_id, interaction_id, relationship, created_at
       ) VALUES (?1, ?2, 'transcript_of', ?3)
       ON CONFLICT(artifact_id, interaction_id, relationship) DO NOTHING`,
    ).bind(artifact.id, identity.interactionId, now).run();
  }

  const contentHash = await deterministicEntityId('content', canonical.contentText);
  let version = await db.prepare(
    `SELECT id, version_number
       FROM artifact_versions
      WHERE artifact_id = ?1 AND content_hash = ?2`,
  ).bind(artifact.id, contentHash).first<ArtifactVersionRow>();
  if (!version) {
    const latest = await db.prepare(
      `SELECT COALESCE(MAX(version_number), 0) AS version_number
         FROM artifact_versions WHERE artifact_id = ?1`,
    ).bind(artifact.id).first<{ version_number: number }>();
    const versionNumber = Number(latest?.version_number ?? 0) + 1;
    const persisted = await store.createArtifactVersion({
      ingestionKey: `meeting:${input.meetingId}:transcript:${contentHash}`,
      artifactId: artifact.id,
      versionNumber,
      contentHash,
      mediaType: 'text/plain',
      contentText: canonical.contentText,
      byteLength: new TextEncoder().encode(canonical.contentText).byteLength,
      metadata: {
        meetingId: input.meetingId,
        provider: input.provider ?? null,
        segmentCount: canonical.segments.length,
      },
    });
    version = { id: persisted.id, version_number: versionNumber };
  }

  const spanBySegmentId = new Map<string, {
    id: string;
    contactId: string | null;
  }>();
  for (const segment of canonical.segments) {
    const span = await store.createSourceSpan({
      ingestionKey: `meeting:${input.meetingId}:transcript:${version.id}:segment:${segment.stableSegmentId}`,
      artifactVersionId: version.id,
      stableSegmentId: segment.stableSegmentId,
      byteStart: segment.byteStart,
      byteEnd: segment.byteEnd,
      charStart: segment.charStart,
      charEnd: segment.charEnd,
      lineStart: segment.lineStart,
      lineEnd: segment.lineEnd,
      timestampStartMs: segment.timestampStartMs,
      timestampEndMs: segment.timestampEndMs,
      exactText: segment.text,
      metadata: {
        speakerLabel: segment.speakerLabel ?? null,
        speakerRole: segment.speakerRole ?? null,
        channel: segment.channel ?? null,
        providerConfidence: boundedScore(segment.confidence),
        ...(segment.metadata ?? {}),
      },
    });
    const attributed = segment.contactId ? identities.get(segment.contactId) : null;
    if (attributed) {
      await db.prepare(
        `INSERT INTO source_span_attributions (
           source_span_id, workspace_person_id, attribution_source,
           confidence, metadata_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(source_span_id, workspace_person_id, attribution_source)
         DO NOTHING`,
      ).bind(
        span.id,
        attributed.workspacePersonId,
        'transcript_source',
        boundedScore(segment.confidence),
        stableJson({
          contactId: segment.contactId ?? null,
          speakerLabel: segment.speakerLabel ?? null,
          speakerRole: segment.speakerRole ?? null,
          channel: segment.channel ?? null,
        }),
        now,
      ).run();
    }
    spanBySegmentId.set(segment.stableSegmentId, {
      id: span.id,
      contactId: attributed ? segment.contactId ?? null : null,
    });
  }

  let outputHash = contentHash;
  let runId: string | null = null;
  let assertionCount = 0;
  if (input.semanticAssertions !== undefined) {
    const priorSignals = await removePriorSemanticProjection(db, artifact.id);
    const extractorVersion = input.extractorVersion ?? 'meeting-transcript-open-v1';
    const assertions = input.semanticAssertions;
    outputHash = await deterministicEntityId(
      'semantic_projection',
      stableJson(assertions as unknown as JsonValue),
    );
    const semanticRunId = await deterministicEntityId(
      'semantic_projection_run',
      `${artifact.id}:${version.id}:${extractorVersion}:${outputHash}`,
    );
    runId = semanticRunId;
    await db.prepare(
      `INSERT INTO semantic_projection_runs (
         id, ingestion_key, artifact_id, artifact_version_id, projection_type,
         extractor_version, output_hash, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(
      semanticRunId,
      `meeting:${input.meetingId}:semantics:${version.id}:${extractorVersion}:${outputHash}`,
      artifact.id,
      version.id,
      TRANSCRIPT_PROJECTION_TYPE,
      extractorVersion,
      outputHash,
      now,
    ).run();

    const affectedSignals = new Map<string, {
      workspacePersonId: string;
      signalKey: string;
      interactionId: string | null;
    }>();
    for (const prior of priorSignals) {
      affectedSignals.set(`${prior.workspace_person_id}\u0000${prior.signal_key}`, {
        workspacePersonId: prior.workspace_person_id,
        signalKey: prior.signal_key,
        interactionId: null,
      });
    }

    for (const extracted of assertions) {
    const subjectSpan = spanBySegmentId.get(extracted.subjectSegmentId);
    if (!subjectSpan?.contactId) continue;
    const identity = identities.get(subjectSpan.contactId);
    if (!identity) continue;
    const sourceSpans = [...new Set(extracted.sourceSegmentIds)]
      .map((segmentId) => spanBySegmentId.get(segmentId))
      .filter((span): span is { id: string; contactId: string | null } => Boolean(span));
    if (
      sourceSpans.length === 0
      || !extracted.sourceSegmentIds.includes(extracted.subjectSegmentId)
      || extracted.predicate.trim().length === 0
      || extracted.narrative.trim().length === 0
    ) {
      continue;
    }
    const semanticKey = await deterministicEntityId(
      'meeting_semantic',
      stableJson({
        sourceSegmentIds: [...new Set(extracted.sourceSegmentIds)],
        subjectSegmentId: extracted.subjectSegmentId,
        predicate: extracted.predicate.trim(),
        narrative: extracted.narrative.trim(),
        objectType: extracted.objectType ?? null,
        objectValue: extracted.objectValue ?? null,
      }),
    );
    const episode = await store.upsertEpisode({
      ingestionKey: `meeting:${input.meetingId}:episode:${version.id}:${semanticKey}`,
      workspacePersonId: identity.workspacePersonId,
      interactionId: identity.interactionId,
      narrative: extracted.narrative.trim(),
      startedAt: effectiveStartedAt,
      endedAt: effectiveEndedAt,
      metadata: {
        artifactVersionId: version.id,
        semanticProjectionRunId: semanticRunId,
      },
    });
    await linkProjectionEntity(db, semanticRunId, 'episode', episode.id, now);
    const assertion = await store.upsertAssertion({
      ingestionKey: `meeting:${input.meetingId}:assertion:${version.id}:${semanticKey}`,
      workspacePersonId: identity.workspacePersonId,
      episodeId: episode.id,
      subjectType: 'workspace_person',
      subjectId: identity.workspacePersonId,
      predicate: extracted.predicate.trim(),
      objectType: extracted.objectType?.trim() || null,
      objectValue: extracted.objectValue,
      narrative: extracted.narrative.trim(),
      qualifiers: {
        ...(extracted.qualifiers ?? {}),
        artifactVersionId: version.id,
        subjectSegmentId: extracted.subjectSegmentId,
        semanticProjectionRunId: semanticRunId,
      },
      confidence: boundedScore(extracted.confidence),
      polarity: boundedPolarity(extracted.polarity),
      extractionVersion: extractorVersion,
      observedAt,
    });
    await linkProjectionEntity(db, semanticRunId, 'assertion', assertion.id, now);
    for (const sourceSpan of sourceSpans) {
      await store.linkAssertionSourceSpan(assertion.id, sourceSpan.id, 'source');
    }
    for (const conceptInput of extracted.concepts ?? []) {
      const term = openSemanticTerm(conceptInput.surface);
      const relationship = conceptInput.relationship.trim();
      const weight = boundedScore(conceptInput.weight);
      if (!term || relationship.length === 0 || weight === null) continue;
      const concept = await store.upsertConcept({
        ingestionKey: `open-term:${term.canonicalKey}`,
        canonicalKey: term.canonicalKey,
        namespace: 'term',
        label: term.surface,
        metadata: {
          resolver: OPEN_TERM_RESOLVER_VERSION,
          source: 'meeting_transcript',
        },
      });
      await store.linkAssertionConcept(
        assertion.id,
        concept.id,
        relationship,
        weight,
      );
      const strength = boundedScore(conceptInput.strength);
      if (conceptInput.evidenceLevel && strength !== null) {
        await store.upsertSignalEvidence({
          ingestionKey: `meeting:${input.meetingId}:evidence:${assertion.id}:${term.canonicalKey}`,
          workspacePersonId: identity.workspacePersonId,
          interactionId: identity.interactionId,
          assertionId: assertion.id,
          conceptId: concept.id,
          signalKey: term.canonicalKey,
          evidenceLevel: conceptInput.evidenceLevel,
          strength,
          polarity: boundedPolarity(extracted.polarity),
          observedAt,
          metadata: {
            artifactVersionId: version.id,
            semanticProjectionRunId: semanticRunId,
          },
        });
        affectedSignals.set(`${identity.workspacePersonId}\u0000${term.canonicalKey}`, {
          workspacePersonId: identity.workspacePersonId,
          signalKey: term.canonicalKey,
          interactionId: identity.interactionId,
        });
      }
    }
    assertionCount++;
    }

    for (const affected of affectedSignals.values()) {
      await rebuildLivingContextSignalSnapshot(
        db,
        store,
        affected.workspacePersonId,
        affected.signalKey,
        affected.interactionId,
        version.id,
        observedAt,
      );
    }
  }
  for (const identity of identities.values()) {
    await store.enqueueProjection({
      ingestionKey: `meeting:${input.meetingId}:projection:${identity.workspacePersonId}:${version.id}:${outputHash}`,
      projectionType: 'neo4j',
      aggregateType: 'workspace_person',
      aggregateId: identity.workspacePersonId,
      operation: 'rebuild',
      payload: {
        artifactId: artifact.id,
        artifactVersionId: version.id,
        semanticProjectionRunId: runId,
      },
    });
  }

  return {
    artifactId: artifact.id,
    artifactVersionId: version.id,
    versionNumber: version.version_number,
    sourceSpanCount: canonical.segments.length,
    assertionCount,
  };
}
