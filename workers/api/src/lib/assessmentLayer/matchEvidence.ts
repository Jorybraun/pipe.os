import { AssessmentLayerStore, type AssessmentEvidenceSourceRefInput, type AssessmentSessionState } from './persistence';
import type { RoleSourceReference, SourceRef } from '../challengeMatching/types';
import { stableJson } from '../livingContext/persistence';
import type { JsonObject, JsonValue } from '../livingContext/types';

export interface MatchRunAssessmentEvidenceInput {
  matchRunId: string;
  candidateSourceRefs: readonly SourceRef[];
  repoSourceRefs: readonly SourceRef[];
  roleSourceReferences: readonly RoleSourceReference[];
}

interface MatchRunEvidenceRow {
  id: string;
  candidate_id: string;
  application_id: string | null;
  role_context_id: string | null;
  candidate_snapshot_id: string;
  role_snapshot_id: string;
  policy_version: string;
  model_version: string | null;
  status: string;
  query_json: string;
  recalled_packets_json: string;
  excluded_packets_json: string;
  ranked_results_json: string;
  selected_packet_id: string | null;
  created_at: number | string;
}

interface SelectedPacketRow {
  id: string;
  repo_snapshot_id: string;
  repo_id: number | string;
  pr_number: number | string;
  packet_version: string;
  source_hash: string;
  packet_json: string;
  production_ready: number;
  quality_score: number;
  created_at: number | string;
  updated_at: number | string;
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
  ).bind(tableName).first<{ name: string }>();
  return Boolean(row);
}

async function hasAssessmentSchema(db: D1Database): Promise<boolean> {
  return await tableExists(db, 'assessment_sessions')
    && await tableExists(db, 'context_records')
    && await tableExists(db, 'context_record_source_refs');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function unixSecondsToIso(value: number | string): string {
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(seconds)) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function matchRunSnapshot(row: MatchRunEvidenceRow): JsonObject {
  return {
    sourceKind: 'match_runs.row',
    id: row.id,
    candidateId: row.candidate_id,
    applicationId: row.application_id,
    roleContextId: row.role_context_id,
    candidateSnapshotId: row.candidate_snapshot_id,
    roleSnapshotId: row.role_snapshot_id,
    policyVersion: row.policy_version,
    modelVersion: row.model_version,
    status: row.status,
    queryJson: row.query_json,
    recalledPacketsJson: row.recalled_packets_json,
    excludedPacketsJson: row.excluded_packets_json,
    rankedResultsJson: row.ranked_results_json,
    selectedPacketId: row.selected_packet_id,
    createdAtUnix: typeof row.created_at === 'number' ? row.created_at : Number(row.created_at),
  };
}

function selectedPacketLocator(input: {
  matchRunId: string;
  packet: SelectedPacketRow;
}): JsonObject {
  return {
    matchRunId: input.matchRunId,
    repoSnapshotId: input.packet.repo_snapshot_id,
    repoId: String(input.packet.repo_id),
    prNumber: Number(input.packet.pr_number),
    packetVersion: input.packet.packet_version,
  };
}

async function selectedPacketSourceRef(
  matchRunId: string,
  packet: SelectedPacketRow | null,
): Promise<AssessmentEvidenceSourceRefInput | null> {
  if (!packet) return null;
  return {
    sourceRefType: 'review_challenge_packet',
    sourceRefId: packet.id,
    evidenceRole: 'selected_packet',
    locator: selectedPacketLocator({ matchRunId, packet }),
    exactText: packet.packet_json,
    contentHash: packet.source_hash || await sha256Hex(packet.packet_json),
    metadata: {
      sourceKind: 'review_challenge_packets.packet_json',
      productionReady: packet.production_ready,
      qualityScore: packet.quality_score,
      createdAtUnix: typeof packet.created_at === 'number' ? packet.created_at : Number(packet.created_at),
      updatedAtUnix: typeof packet.updated_at === 'number' ? packet.updated_at : Number(packet.updated_at),
    },
  };
}

async function sourceRefToAssessmentRef(
  ref: SourceRef,
  evidenceRole: string,
): Promise<AssessmentEvidenceSourceRefInput | null> {
  const sourceRefType = ref.sourceRefType?.trim();
  const sourceRefId = ref.sourceRefId?.trim();
  const exactText = ref.exactText;
  if (!sourceRefType || !sourceRefId || !exactText?.trim()) return null;

  return {
    sourceRefType,
    sourceRefId,
    sourceSpanId: sourceRefType === 'source_span' ? ref.sourceSpanId ?? sourceRefId : null,
    evidenceRole,
    locator: {
      artifactId: ref.artifactId,
      artifactVersion: ref.artifactVersion,
      locator: ref.locator ?? null,
      startOffset: ref.startOffset,
      endOffset: ref.endOffset,
    },
    exactText,
    contentHash: ref.contentHash?.trim() || await sha256Hex(exactText),
    metadata: {
      sourceKind: 'match_alignment_source_ref',
    },
  };
}

async function roleSourceToAssessmentRef(
  roleSource: RoleSourceReference,
): Promise<AssessmentEvidenceSourceRefInput | null> {
  if (!roleSource.exactText?.trim()) return null;
  const hasTypedRef = Boolean(roleSource.sourceRefType?.trim() && roleSource.sourceRefId?.trim());
  const sourceRefType = hasTypedRef ? roleSource.sourceRefType!.trim() : 'role_source';
  const sourceRefId = hasTypedRef ? roleSource.sourceRefId!.trim() : roleSource.entityId;

  return {
    sourceRefType,
    sourceRefId,
    sourceSpanId: sourceRefType === 'source_span' ? roleSource.sourceSpanId ?? sourceRefId : null,
    evidenceRole: 'role_source',
    locator: {
      locator: roleSource.locator,
    },
    exactText: roleSource.exactText,
    contentHash: roleSource.contentHash?.trim() || await sha256Hex(roleSource.exactText),
    metadata: {
      sourceKind: 'role_source_reference',
      roleSourceEntityId: roleSource.entityId,
      conceptKeys: roleSource.conceptKeys,
    },
  };
}

async function selectedAlignmentSourceRefs(
  input: MatchRunAssessmentEvidenceInput,
): Promise<AssessmentEvidenceSourceRefInput[]> {
  const refs: AssessmentEvidenceSourceRefInput[] = [];
  for (const sourceRef of input.candidateSourceRefs) {
    const ref = await sourceRefToAssessmentRef(sourceRef, 'selected_candidate_evidence');
    if (ref) refs.push(ref);
  }
  for (const sourceRef of input.repoSourceRefs) {
    const ref = await sourceRefToAssessmentRef(sourceRef, 'selected_repo_evidence');
    if (ref) refs.push(ref);
  }
  for (const roleSource of input.roleSourceReferences) {
    const ref = await roleSourceToAssessmentRef(roleSource);
    if (ref) refs.push(ref);
  }
  return refs;
}

async function currentAssessmentState(
  db: D1Database,
  sessionId: string,
): Promise<AssessmentSessionState | null> {
  const row = await db.prepare(
    'SELECT state FROM assessment_sessions WHERE id = ?1',
  ).bind(sessionId).first<{ state: AssessmentSessionState }>();
  return row?.state ?? null;
}

async function markAssessmentSessionInProgress(input: {
  db: D1Database;
  store: AssessmentLayerStore;
  sessionId: string;
}): Promise<void> {
  const state = await currentAssessmentState(input.db, input.sessionId);
  if (state !== 'INTAKE') return;
  await input.store.transitionAssessmentState({
    sessionId: input.sessionId,
    toState: 'IN_PROGRESS',
    reason: 'Candidate-to-PR match decision captured as assessment evidence.',
    actorType: 'system',
  });
}

async function loadMatchRun(db: D1Database, matchRunId: string): Promise<MatchRunEvidenceRow> {
  const row = await db.prepare(
    `SELECT id, candidate_id, application_id, role_context_id,
            candidate_snapshot_id, role_snapshot_id, policy_version, model_version,
            status, query_json, recalled_packets_json, excluded_packets_json,
            ranked_results_json, selected_packet_id, created_at
       FROM match_runs
      WHERE id = ?1`,
  ).bind(matchRunId).first<MatchRunEvidenceRow>();
  if (!row) throw new Error(`match run ${matchRunId} not found`);
  return row;
}

async function loadSelectedPacket(
  db: D1Database,
  packetId: string | null,
): Promise<SelectedPacketRow | null> {
  if (!packetId) return null;
  return await db.prepare(
    `SELECT id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash,
            packet_json, production_ready, quality_score, created_at, updated_at
       FROM review_challenge_packets
      WHERE id = ?1`,
  ).bind(packetId).first<SelectedPacketRow>();
}

async function loadCandidateWorkspaceId(db: D1Database, candidateId: string): Promise<string | null> {
  const row = await db.prepare(
    'SELECT owner_id FROM candidates WHERE id = ?1',
  ).bind(candidateId).first<{ owner_id: string | null }>();
  return row?.owner_id ?? null;
}

export async function ingestMatchRunAssessmentEvidence(
  db: D1Database,
  input: MatchRunAssessmentEvidenceInput,
): Promise<void> {
  if (!await hasAssessmentSchema(db)) return;

  const matchRun = await loadMatchRun(db, input.matchRunId);
  const selectedPacket = await loadSelectedPacket(db, matchRun.selected_packet_id);
  const observedAt = unixSecondsToIso(matchRun.created_at);
  const store = new AssessmentLayerStore(db, () => observedAt);
  const snapshot = matchRunSnapshot(matchRun);
  const matchRunExactText = stableJson(snapshot as JsonValue);
  const sourceRefs: AssessmentEvidenceSourceRefInput[] = [
    {
      sourceRefType: 'match_run',
      sourceRefId: matchRun.id,
      evidenceRole: 'decision_record',
      locator: {
        matchRunId: matchRun.id,
        candidateId: matchRun.candidate_id,
        roleSnapshotId: matchRun.role_snapshot_id,
        status: matchRun.status,
      },
      exactText: matchRunExactText,
      contentHash: await sha256Hex(matchRunExactText),
      metadata: {
        sourceKind: 'match_runs.row',
        policyVersion: matchRun.policy_version,
        modelVersion: matchRun.model_version,
      },
    },
  ];

  const packetRef = await selectedPacketSourceRef(matchRun.id, selectedPacket);
  if (packetRef) sourceRefs.push(packetRef);
  sourceRefs.push(...await selectedAlignmentSourceRefs(input));

  const session = await store.createAssessmentSession({
    ingestionKey: `assessment-session:repo-match:${matchRun.id}`,
    interviewId: matchRun.id,
    mode: 'REPO_MATCHING',
    candidateId: matchRun.candidate_id,
    workspaceId: await loadCandidateWorkspaceId(db, matchRun.candidate_id),
    createdBy: 'candidate-pr-matcher',
    metadata: {
      matchRunId: matchRun.id,
      applicationId: matchRun.application_id,
      roleContextId: matchRun.role_context_id,
      candidateSnapshotId: matchRun.candidate_snapshot_id,
      roleSnapshotId: matchRun.role_snapshot_id,
      selectedPacketId: matchRun.selected_packet_id,
      source: 'match_runs',
    },
  });

  await store.recordAssessmentEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:repo-match:${matchRun.id}:decision`,
    kind: 'match_decision',
    actorType: 'system',
    narrative: matchRun.status === 'MATCHED' && matchRun.selected_packet_id
      ? `Candidate-to-PR match run ${matchRun.id} selected packet ${matchRun.selected_packet_id}.`
      : `Candidate-to-PR match run ${matchRun.id} returned ${matchRun.status}.`,
    payload: {
      matchRunId: matchRun.id,
      candidateId: matchRun.candidate_id,
      applicationId: matchRun.application_id,
      roleContextId: matchRun.role_context_id,
      candidateSnapshotId: matchRun.candidate_snapshot_id,
      roleSnapshotId: matchRun.role_snapshot_id,
      policyVersion: matchRun.policy_version,
      modelVersion: matchRun.model_version,
      status: matchRun.status,
      selectedPacketId: matchRun.selected_packet_id,
      selectedPacket: selectedPacket ? jsonValue({
        id: selectedPacket.id,
        repoId: selectedPacket.repo_id,
        prNumber: selectedPacket.pr_number,
        packetVersion: selectedPacket.packet_version,
        sourceHash: selectedPacket.source_hash,
      }) : null,
    },
    occurredAt: observedAt,
    sourceRefs,
  });

  await markAssessmentSessionInProgress({ db, store, sessionId: session.id });
}
