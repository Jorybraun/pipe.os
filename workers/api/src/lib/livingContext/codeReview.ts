import type {
  ReviewComment,
  ReviewRound,
} from '../implementerAgent';
import type { ComprehensionExchange } from '../explainerAgent';
import { ensureCandidateLivingContext } from './compatibility';
import {
  deterministicEntityId,
  LivingContextStore,
} from './persistence';
import type { JsonObject } from './types';

export interface CodeReviewTranscript {
  rounds: ReviewRound[];
  explainer_exchanges?: ComprehensionExchange[];
  verdict?: {
    decision: string;
    summary: string;
    submittedAt: string;
  };
}

export interface CodeReviewTranscriptIngestionInput {
  sessionId: string;
  candidateId: string;
  challengeId: string;
  assessmentId: string;
  transcript: CodeReviewTranscript;
  status: string;
  implementerPersona?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  observedAt: string;
}

export interface CodeReviewScoreReportIngestionInput {
  sessionId: string;
  candidateId: string;
  challengeId: string;
  assessmentId: string;
  scoreReportJson: string;
  observedAt: string;
  producer: 'automated_scorer' | 'recruiter_override';
  producerId?: string | null;
  startedAt?: string | null;
}

interface DocumentSpan {
  stableSegmentId: string;
  exactText: string;
  charStart: number;
  charEnd: number;
  byteStart: number;
  byteEnd: number;
  lineStart: number;
  lineEnd: number;
  attributedToCandidate: boolean;
  metadata: JsonObject;
}

interface ArtifactVersionRow {
  id: string;
  version_number: number;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function lineNumberAt(value: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index++) {
    if (value[index] === '\n') line++;
  }
  return line;
}

class ReviewDocumentBuilder {
  private text = '';
  private readonly spans: DocumentSpan[] = [];

  append(value: string): void {
    this.text += value;
  }

  appendField(
    label: string,
    value: string | undefined,
    stableSegmentId: string,
    attributedToCandidate: boolean,
    metadata: JsonObject,
  ): void {
    if (value === undefined || value.length === 0) return;
    this.append(`${label}:\n`);
    const charStart = this.text.length;
    const byteStart = byteLength(this.text);
    this.append(value);
    const charEnd = this.text.length;
    const byteEnd = byteLength(this.text);
    const lineStart = lineNumberAt(this.text, charStart);
    const lineEnd = lineStart + Math.max(0, value.split('\n').length - 1);
    this.spans.push({
      stableSegmentId,
      exactText: value,
      charStart,
      charEnd,
      byteStart,
      byteEnd,
      lineStart,
      lineEnd,
      attributedToCandidate,
      metadata,
    });
    this.append('\n\n');
  }

  build(): { contentText: string; spans: DocumentSpan[] } {
    return { contentText: this.text, spans: this.spans };
  }
}

function commentMetadata(
  round: ReviewRound,
  comment: ReviewComment,
  commentIndex: number,
  field: string,
): JsonObject {
  return {
    actorType: 'candidate',
    sourceKind: 'review_comment',
    round: round.round,
    commentId: comment.id,
    commentIndex,
    field,
    file: comment.file ?? null,
    line: comment.line ?? null,
    severity: comment.severity ?? null,
    positive: comment.positive,
  };
}

function serializeTranscript(
  input: CodeReviewTranscriptIngestionInput,
): { contentText: string; spans: DocumentSpan[] } {
  const builder = new ReviewDocumentBuilder();
  builder.append(`Code review session: ${input.sessionId}\n`);
  builder.append(`Challenge: ${input.challengeId}\n`);
  builder.append(`Assessment: ${input.assessmentId}\n\n`);

  for (const [roundIndex, round] of input.transcript.rounds.entries()) {
    builder.append(`[Review round ${round.round}]\n\n`);
    for (const [commentIndex, comment] of round.reviewer_comments.entries()) {
      builder.append(`[Candidate comment ${comment.id}]\n`);
      if (comment.file) builder.append(`File: ${comment.file}\n`);
      if (comment.line !== undefined) builder.append(`Line: ${comment.line}\n`);
      builder.append('\n');
      const prefix = `round-${round.round}:comment-${commentIndex}`;
      builder.appendField(
        'What',
        comment.what,
        `${prefix}:what`,
        true,
        commentMetadata(round, comment, commentIndex, 'what'),
      );
      builder.appendField(
        'Why',
        comment.why,
        `${prefix}:why`,
        true,
        commentMetadata(round, comment, commentIndex, 'why'),
      );
      builder.appendField(
        'Suggestion',
        comment.suggestion,
        `${prefix}:suggestion`,
        true,
        commentMetadata(round, comment, commentIndex, 'suggestion'),
      );
    }
    builder.appendField(
      'Candidate round summary',
      round.reviewer_summary,
      `round-${round.round}:summary`,
      true,
      {
        actorType: 'candidate',
        sourceKind: 'review_summary',
        round: round.round,
        roundIndex,
      },
    );
    builder.appendField(
      'Candidate round verdict',
      round.reviewer_verdict,
      `round-${round.round}:verdict`,
      true,
      {
        actorType: 'candidate',
        sourceKind: 'review_round_verdict',
        round: round.round,
        roundIndex,
      },
    );
    for (const [responseIndex, response] of round.implementer_responses.entries()) {
      const prefix = `round-${round.round}:response-${responseIndex}`;
      builder.append(`[Implementer response to comment ${response.to_comment_id}]\n\n`);
      builder.appendField(
        'Response',
        response.content,
        `${prefix}:content`,
        false,
        {
          actorType: 'agent',
          sourceKind: 'implementer_response',
          round: round.round,
          responseIndex,
          toCommentId: response.to_comment_id,
          move: response.move,
        },
      );
      builder.appendField(
        'Updated code',
        response.updated_code,
        `${prefix}:updated-code`,
        false,
        {
          actorType: 'agent',
          sourceKind: 'implementer_updated_code',
          round: round.round,
          responseIndex,
          toCommentId: response.to_comment_id,
          move: response.move,
        },
      );
    }
  }

  for (const [exchangeIndex, exchange] of (
    input.transcript.explainer_exchanges ?? []
  ).entries()) {
    builder.append(`[Explainer exchange ${exchange.round}]\n`);
    if (exchange.question.file) builder.append(`File: ${exchange.question.file}\n`);
    if (exchange.question.line !== undefined) {
      builder.append(`Line: ${exchange.question.line}\n`);
    }
    builder.append('\n');
    builder.appendField(
      'Candidate question',
      exchange.question.text,
      `explainer-${exchangeIndex}:question`,
      true,
      {
        actorType: 'candidate',
        sourceKind: 'explainer_question',
        exchangeRound: exchange.round,
        exchangeIndex,
        file: exchange.question.file ?? null,
        line: exchange.question.line ?? null,
      },
    );
    builder.appendField(
      'Explainer answer',
      exchange.answer.content,
      `explainer-${exchangeIndex}:answer`,
      false,
      {
        actorType: 'agent',
        sourceKind: 'explainer_answer',
        exchangeRound: exchange.round,
        exchangeIndex,
        depthLevel: exchange.answer.depth_level,
        contextProvided: exchange.answer.context_provided,
      },
    );
  }

  if (input.transcript.verdict) {
    builder.append('[Final candidate verdict]\n\n');
    builder.appendField(
      'Decision',
      input.transcript.verdict.decision,
      'final-verdict:decision',
      true,
      {
        actorType: 'candidate',
        sourceKind: 'final_verdict_decision',
        submittedAt: input.transcript.verdict.submittedAt,
      },
    );
    builder.appendField(
      'Summary',
      input.transcript.verdict.summary,
      'final-verdict:summary',
      true,
      {
        actorType: 'candidate',
        sourceKind: 'final_verdict_summary',
        submittedAt: input.transcript.verdict.submittedAt,
      },
    );
  }

  return builder.build();
}

async function ensureReviewContext(
  db: D1Database,
  input: {
    sessionId: string;
    candidateId: string;
    challengeId: string;
    assessmentId: string;
    status: string;
    implementerPersona?: string | null;
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
    ingestionKey: `code-review:${input.sessionId}:person:${identity.workspacePersonId}`,
    workspacePersonId: identity.workspacePersonId,
    applicationId: identity.applicationId,
    interactionType: 'code_review_assessment',
    externalReference: input.sessionId,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    metadata: {
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      assessmentId: input.assessmentId,
      status: input.status,
      implementerPersona: input.implementerPersona ?? null,
    },
  });
  return {
    store,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
  };
}

async function findOrCreateTextVersion(
  db: D1Database,
  store: LivingContextStore,
  input: {
    artifactId: string;
    ingestionKeyPrefix: string;
    contentText: string;
    mediaType: string;
    metadata: JsonObject;
  },
): Promise<ArtifactVersionRow> {
  const contentHash = await deterministicEntityId('content', input.contentText);
  let version = await db.prepare(
    `SELECT id, version_number
       FROM artifact_versions
      WHERE artifact_id = ?1 AND content_hash = ?2`,
  ).bind(input.artifactId, contentHash).first<ArtifactVersionRow>();
  if (version) return version;

  const latest = await db.prepare(
    `SELECT COALESCE(MAX(version_number), 0) AS version_number
       FROM artifact_versions WHERE artifact_id = ?1`,
  ).bind(input.artifactId).first<{ version_number: number }>();
  const versionNumber = Number(latest?.version_number ?? 0) + 1;
  const persisted = await store.createArtifactVersion({
    ingestionKey: `${input.ingestionKeyPrefix}:${contentHash}`,
    artifactId: input.artifactId,
    versionNumber,
    contentHash,
    mediaType: input.mediaType,
    contentText: input.contentText,
    byteLength: byteLength(input.contentText),
    metadata: input.metadata,
  });
  version = { id: persisted.id, version_number: versionNumber };
  return version;
}

export async function ingestCodeReviewTranscriptToLivingContext(
  db: D1Database,
  input: CodeReviewTranscriptIngestionInput,
): Promise<{ artifactVersionId: string; sourceSpanCount: number; candidateSpanCount: number }> {
  const { store, workspacePersonId, interactionId } = await ensureReviewContext(db, {
    ...input,
    endedAt: input.endedAt ?? null,
  });
  const document = serializeTranscript(input);
  const artifact = await store.upsertArtifact({
    ingestionKey: `code-review:${input.sessionId}:transcript`,
    workspacePersonId,
    interactionId,
    artifactType: 'code_review_transcript',
    logicalKey: input.sessionId,
    metadata: {
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      assessmentId: input.assessmentId,
      status: input.status,
      format: 'source-exact-text-v1',
    },
  });
  const version = await findOrCreateTextVersion(db, store, {
    artifactId: artifact.id,
    ingestionKeyPrefix: `code-review:${input.sessionId}:transcript`,
    contentText: document.contentText,
    mediaType: 'text/plain',
    metadata: {
      observedAt: input.observedAt,
      status: input.status,
      segmentCount: document.spans.length,
      format: 'source-exact-text-v1',
    },
  });

  let candidateSpanCount = 0;
  for (const span of document.spans) {
    const persisted = await store.createSourceSpan({
      ingestionKey: `code-review:${input.sessionId}:transcript:${version.id}:${span.stableSegmentId}`,
      artifactVersionId: version.id,
      stableSegmentId: span.stableSegmentId,
      byteStart: span.byteStart,
      byteEnd: span.byteEnd,
      charStart: span.charStart,
      charEnd: span.charEnd,
      lineStart: span.lineStart,
      lineEnd: span.lineEnd,
      exactText: span.exactText,
      metadata: span.metadata,
    });
    if (span.attributedToCandidate) {
      candidateSpanCount++;
      await db.prepare(
        `INSERT INTO source_span_attributions (
           source_span_id, workspace_person_id, attribution_source,
           confidence, metadata_json, created_at
         ) VALUES (?1, ?2, 'authenticated-code-review-session', 1, ?3, ?4)
         ON CONFLICT(source_span_id, workspace_person_id, attribution_source) DO NOTHING`,
      ).bind(
        persisted.id,
        workspacePersonId,
        JSON.stringify({
          candidateId: input.candidateId,
          sessionId: input.sessionId,
        }),
        input.observedAt,
      ).run();
    }
  }

  await store.enqueueProjection({
    ingestionKey: `code-review:${input.sessionId}:transcript:${version.id}:projection`,
    projectionType: 'neo4j',
    aggregateType: 'workspace_person',
    aggregateId: workspacePersonId,
    operation: 'rebuild',
    payload: {
      sessionId: input.sessionId,
      transcriptArtifactId: artifact.id,
      transcriptArtifactVersionId: version.id,
    },
  });
  return {
    artifactVersionId: version.id,
    sourceSpanCount: document.spans.length,
    candidateSpanCount,
  };
}

export async function ingestCodeReviewScoreReportToLivingContext(
  db: D1Database,
  input: CodeReviewScoreReportIngestionInput,
): Promise<{ artifactVersionId: string }> {
  const { store, workspacePersonId, interactionId } = await ensureReviewContext(db, {
    ...input,
    status: 'scored',
  });
  const producerKey = input.producer === 'automated_scorer'
    ? 'automated'
    : `recruiter:${input.producerId ?? 'unknown'}`;
  const artifact = await store.upsertArtifact({
    ingestionKey: `code-review:${input.sessionId}:score-report:${producerKey}`,
    workspacePersonId,
    interactionId,
    artifactType: 'code_review_score_report',
    logicalKey: input.sessionId,
    metadata: {
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      assessmentId: input.assessmentId,
      producer: input.producer,
      producerId: input.producerId ?? null,
      candidateAttribution: false,
    },
  });
  const version = await findOrCreateTextVersion(db, store, {
    artifactId: artifact.id,
    ingestionKeyPrefix: `code-review:${input.sessionId}:score-report:${producerKey}`,
    contentText: input.scoreReportJson,
    mediaType: 'application/json',
    metadata: {
      observedAt: input.observedAt,
      producer: input.producer,
      producerId: input.producerId ?? null,
      candidateAttribution: false,
    },
  });
  await store.createSourceSpan({
    ingestionKey: `code-review:${input.sessionId}:score-report:${version.id}:full`,
    artifactVersionId: version.id,
    stableSegmentId: 'score-report-full',
    byteStart: 0,
    byteEnd: byteLength(input.scoreReportJson),
    charStart: 0,
    charEnd: input.scoreReportJson.length,
    lineStart: 1,
    lineEnd: Math.max(1, input.scoreReportJson.split('\n').length),
    exactText: input.scoreReportJson,
    metadata: {
      actorType: input.producer === 'automated_scorer' ? 'agent' : 'recruiter',
      sourceKind: 'score_report',
      producer: input.producer,
      producerId: input.producerId ?? null,
      candidateAttribution: false,
    },
  });
  await store.enqueueProjection({
    ingestionKey: `code-review:${input.sessionId}:score-report:${version.id}:projection`,
    projectionType: 'neo4j',
    aggregateType: 'workspace_person',
    aggregateId: workspacePersonId,
    operation: 'rebuild',
    payload: {
      sessionId: input.sessionId,
      scoreReportArtifactId: artifact.id,
      scoreReportArtifactVersionId: version.id,
    },
  });
  return { artifactVersionId: version.id };
}
