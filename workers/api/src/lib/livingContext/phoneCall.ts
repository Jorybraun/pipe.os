import { ensureCandidateLivingContext } from './compatibility';
import {
  deterministicEntityId,
  LivingContextStore,
  stableJson,
} from './persistence';
import type { JsonValue } from './types';

export interface PhoneCallRecordingInput {
  storageKey: string;
  recordingSid?: string | null;
  mediaType?: string;
  byteLength?: number | null;
  durationSeconds?: number | null;
}

export interface PhoneCallIngestionInput {
  callId: string;
  candidateId: string;
  direction: string;
  startedAt?: string | null;
  endedAt?: string | null;
  twilioCallSid?: string | null;
  recording?: PhoneCallRecordingInput | null;
  transcript?: string | null;
  transcriptProvider?: string | null;
}

export interface PhoneRecruiterNoteInput {
  callId: string;
  candidateId: string;
  direction: string;
  note: string;
  observedAt: string;
  recruiterActorId: string;
  startedAt?: string | null;
  endedAt?: string | null;
}

function lineCount(text: string): number {
  return Math.max(1, text.split('\n').length);
}

async function upsertPhoneInteraction(
  db: D1Database,
  input: {
    callId: string;
    candidateId: string;
    direction: string;
    startedAt?: string | null;
    endedAt?: string | null;
  },
): Promise<{
  store: LivingContextStore;
  workspacePersonId: string;
  interactionId: string;
}> {
  const identity = await ensureCandidateLivingContext(db, input.candidateId);
  if (!identity) {
    throw new Error(`Candidate "${input.candidateId}" could not be resolved`);
  }
  const store = new LivingContextStore(db);
  const interaction = await store.upsertInteraction({
    ingestionKey: `phone-call:${input.callId}:person:${identity.workspacePersonId}`,
    workspacePersonId: identity.workspacePersonId,
    applicationId: identity.applicationId,
    interactionType: 'phone_call',
    externalReference: input.callId,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    metadata: {
      callId: input.callId,
      direction: input.direction,
    },
  });
  return {
    store,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
  };
}

export async function ingestPhoneCallToLivingContext(
  db: D1Database,
  input: PhoneCallIngestionInput,
): Promise<{ audioArtifacts: number; transcriptArtifacts: number }> {
  const { store, workspacePersonId, interactionId } = await upsertPhoneInteraction(db, input);
  let audioArtifacts = 0;
  let transcriptArtifacts = 0;

  if (input.recording) {
    const artifact = await store.upsertArtifact({
      ingestionKey: `phone-call:${input.callId}:recording`,
      workspacePersonId,
      interactionId,
      artifactType: 'phone_call_recording',
      logicalKey: input.callId,
      metadata: {
        callId: input.callId,
        recordingSid: input.recording.recordingSid ?? null,
        twilioCallSid: input.twilioCallSid ?? null,
        durationSeconds: input.recording.durationSeconds ?? null,
        channelMode: 'dual',
      },
    });
    const contentHash = await deterministicEntityId(
      'content',
      stableJson({
        storageKey: input.recording.storageKey,
        recordingSid: input.recording.recordingSid ?? null,
      } as JsonValue),
    );
    const existing = await db.prepare(
      `SELECT id FROM artifact_versions
        WHERE artifact_id = ?1 AND content_hash = ?2`,
    ).bind(artifact.id, contentHash).first<{ id: string }>();
    if (!existing) {
      const latest = await db.prepare(
        `SELECT COALESCE(MAX(version_number), 0) AS version_number
           FROM artifact_versions WHERE artifact_id = ?1`,
      ).bind(artifact.id).first<{ version_number: number }>();
      await store.createArtifactVersion({
        ingestionKey: `phone-call:${input.callId}:recording:${contentHash}`,
        artifactId: artifact.id,
        versionNumber: Number(latest?.version_number ?? 0) + 1,
        contentHash,
        mediaType: input.recording.mediaType ?? 'audio/mpeg',
        storageKey: input.recording.storageKey,
        byteLength: input.recording.byteLength ?? null,
        metadata: {
          speakerAttribution: 'unresolved',
          channelMode: 'dual',
        },
      });
    }
    audioArtifacts = 1;
  }

  if (typeof input.transcript === 'string' && input.transcript.length > 0) {
    const artifact = await store.upsertArtifact({
      ingestionKey: `phone-call:${input.callId}:transcript`,
      workspacePersonId,
      interactionId,
      artifactType: 'phone_call_transcript',
      logicalKey: input.callId,
      metadata: {
        callId: input.callId,
        provider: input.transcriptProvider ?? null,
        speakerAttribution: 'unresolved',
      },
    });
    const contentHash = await deterministicEntityId('content', input.transcript);
    let version = await db.prepare(
      `SELECT id, version_number FROM artifact_versions
        WHERE artifact_id = ?1 AND content_hash = ?2`,
    ).bind(artifact.id, contentHash).first<{ id: string; version_number: number }>();
    if (!version) {
      const latest = await db.prepare(
        `SELECT COALESCE(MAX(version_number), 0) AS version_number
           FROM artifact_versions WHERE artifact_id = ?1`,
      ).bind(artifact.id).first<{ version_number: number }>();
      const versionNumber = Number(latest?.version_number ?? 0) + 1;
      const persisted = await store.createArtifactVersion({
        ingestionKey: `phone-call:${input.callId}:transcript:${contentHash}`,
        artifactId: artifact.id,
        versionNumber,
        contentHash,
        mediaType: 'text/plain',
        contentText: input.transcript,
        byteLength: new TextEncoder().encode(input.transcript).byteLength,
        metadata: {
          provider: input.transcriptProvider ?? null,
          speakerAttribution: 'unresolved',
        },
      });
      version = { id: persisted.id, version_number: versionNumber };
    }
    await store.createSourceSpan({
      ingestionKey: `phone-call:${input.callId}:transcript:${version.id}:full`,
      artifactVersionId: version.id,
      stableSegmentId: 'transcript-full',
      byteStart: 0,
      byteEnd: new TextEncoder().encode(input.transcript).byteLength,
      charStart: 0,
      charEnd: input.transcript.length,
      lineStart: 1,
      lineEnd: lineCount(input.transcript),
      exactText: input.transcript,
      metadata: {
        speakerAttribution: 'unresolved',
        channelMode: 'mixed-by-transcriber',
      },
    });
    transcriptArtifacts = 1;
  }

  await store.enqueueProjection({
    ingestionKey: `phone-call:${input.callId}:projection`,
    projectionType: 'neo4j',
    aggregateType: 'workspace_person',
    aggregateId: workspacePersonId,
    operation: 'rebuild',
    payload: { callId: input.callId },
  });
  return { audioArtifacts, transcriptArtifacts };
}

export async function ingestPhoneRecruiterNote(
  db: D1Database,
  input: PhoneRecruiterNoteInput,
): Promise<void> {
  const { store, workspacePersonId, interactionId } = await upsertPhoneInteraction(db, input);
  const eventKey = await deterministicEntityId(
    'phone_recruiter_note_event',
    `${input.callId}:${input.observedAt}:${input.recruiterActorId}:${input.note}`,
  );
  const artifact = await store.upsertArtifact({
    ingestionKey: `phone-call:${input.callId}:recruiter-note:${eventKey}`,
    workspacePersonId,
    interactionId,
    artifactType: 'recruiter_note',
    logicalKey: `${input.callId}:${input.observedAt}`,
    metadata: {
      callId: input.callId,
      authorType: 'recruiter',
      authorId: input.recruiterActorId,
      observedAt: input.observedAt,
      cleared: input.note.length === 0,
    },
  });
  const contentHash = await deterministicEntityId('content', input.note);
  const version = await store.createArtifactVersion({
    ingestionKey: `phone-call:${input.callId}:recruiter-note:${eventKey}:version`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/plain',
    contentText: input.note,
    byteLength: new TextEncoder().encode(input.note).byteLength,
    metadata: {
      authorType: 'recruiter',
      authorId: input.recruiterActorId,
      observedAt: input.observedAt,
    },
  });
  if (input.note.length > 0) {
    await store.createSourceSpan({
      ingestionKey: `phone-call:${input.callId}:recruiter-note:${eventKey}:full`,
      artifactVersionId: version.id,
      stableSegmentId: 'note-full',
      byteStart: 0,
      byteEnd: new TextEncoder().encode(input.note).byteLength,
      charStart: 0,
      charEnd: input.note.length,
      lineStart: 1,
      lineEnd: lineCount(input.note),
      exactText: input.note,
      metadata: {
        authorType: 'recruiter',
        authorId: input.recruiterActorId,
      },
    });
  }
  await store.enqueueProjection({
    ingestionKey: `phone-call:${input.callId}:recruiter-note:${eventKey}:projection`,
    projectionType: 'neo4j',
    aggregateType: 'workspace_person',
    aggregateId: workspacePersonId,
    operation: 'rebuild',
    payload: {
      callId: input.callId,
      recruiterNoteArtifactId: artifact.id,
    },
  });
}
