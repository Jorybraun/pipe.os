import type {
  LivingContextArtifact,
  LivingContextAssertion,
  LivingContextInteraction,
  LivingContextReadModel,
  LivingContextRecord,
  LivingContextRecordEntity,
  LivingContextRecordSourceRef,
  LivingContextSignal,
  LivingContextSourceRef,
} from './api/types';
import {
  contextRecordNarrative,
  contextRecordTitle,
  contextRecordTypeLabel,
  titleCaseSemanticLabel,
} from './livingContextDisplay';

export type LivingContextTreeNodeKind =
  | 'person'
  | 'interaction'
  | 'accumulated_context'
  | 'artifact'
  | 'source_span'
  | 'context_record'
  | 'assertion'
  | 'signal'
  | 'entity'
  | 'concept'
  | 'provenance_ref';

export interface LivingContextTreeNode {
  id: string;
  kind: LivingContextTreeNodeKind;
  label: string;
  detail: string | null;
  observedAt: string | null;
  sourceText: string | null;
  children: LivingContextTreeNode[];
  sourceRef?: LivingContextRecordSourceRef;
}

export interface LivingContextInteractionBranch {
  interaction: LivingContextInteraction;
  artifacts: LivingContextArtifact[];
  sourceSpans: LivingContextSourceRef[];
  contextRecords: LivingContextRecord[];
  assertions: LivingContextAssertion[];
  signals: LivingContextSignal[];
  isMeetingEvidence: boolean;
  node: LivingContextTreeNode;
}

export interface LivingContextTree {
  root: LivingContextTreeNode;
  interactionBranches: LivingContextInteractionBranch[];
  accumulatedNode: LivingContextTreeNode | null;
}

function isSourceSpanRef(source: LivingContextRecordSourceRef): source is LivingContextSourceRef {
  return typeof source.sourceSpanId === 'string';
}

function formatLocator(source: LivingContextSourceRef): string {
  if (source.lineStart !== null && source.lineEnd !== null) {
    return source.lineStart === source.lineEnd
      ? `line ${source.lineStart}`
      : `lines ${source.lineStart}-${source.lineEnd}`;
  }
  if (source.timestampStartMs !== null && source.timestampEndMs !== null) {
    return `${(source.timestampStartMs / 1000).toFixed(1)}s-${(source.timestampEndMs / 1000).toFixed(1)}s`;
  }
  if (source.charStart !== null && source.charEnd !== null) {
    return `chars ${source.charStart}-${source.charEnd}`;
  }
  return source.stableSegmentId ?? source.sourceSpanId;
}

function genericSourceLabel(source: Exclude<LivingContextRecordSourceRef, LivingContextSourceRef>): string {
  const locatorId = typeof source.locator.id === 'string'
    ? source.locator.id
    : typeof source.locator.path === 'string'
      ? source.locator.path
      : source.sourceRefId;
  return `${titleCaseSemanticLabel(source.sourceRefType)} ${locatorId}`;
}

function artifactNode(artifact: LivingContextArtifact): LivingContextTreeNode {
  return {
    id: `artifact:${artifact.id}`,
    kind: 'artifact',
    label: titleCaseSemanticLabel(artifact.artifactType),
    detail: artifact.logicalKey ?? artifact.id,
    observedAt: artifact.createdAt,
    sourceText: null,
    children: artifact.sourceSpans.map(sourceSpanNode),
  };
}

function sourceSpanNode(source: LivingContextSourceRef): LivingContextTreeNode {
  return {
    id: `source_span:${source.sourceSpanId}`,
    kind: 'source_span',
    label: `${titleCaseSemanticLabel(source.artifactType)} ${formatLocator(source)}`,
    detail: source.artifactLogicalKey ?? source.stableSegmentId ?? source.sourceSpanId,
    observedAt: null,
    sourceText: source.exactText,
    children: [],
    sourceRef: source,
  };
}

function recordSourceNode(source: LivingContextRecordSourceRef): LivingContextTreeNode {
  if (isSourceSpanRef(source)) return sourceSpanNode(source);
  return {
    id: `provenance_ref:${source.sourceRefType}:${source.sourceRefId}`,
    kind: 'provenance_ref',
    label: genericSourceLabel(source),
    detail: source.contentHash,
    observedAt: null,
    sourceText: source.exactText,
    children: [],
    sourceRef: source,
  };
}

function conceptNodes(record: LivingContextRecord | LivingContextAssertion): LivingContextTreeNode[] {
  return record.concepts.map((concept) => ({
    id: `concept:${concept.id}:${concept.relationship}`,
    kind: 'concept' as const,
    label: concept.label,
    detail: `${concept.relationship} · ${Math.round(concept.weight * 100)}%`,
    observedAt: null,
    sourceText: null,
    children: [],
  }));
}

function entityValueText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function entityNodes(record: LivingContextRecord): LivingContextTreeNode[] {
  return record.entities.map((entity: LivingContextRecordEntity, index) => {
    const valueText = entityValueText(entity.value);
    const label = entity.entityId ?? valueText ?? titleCaseSemanticLabel(entity.entityType);
    const confidence = entity.confidence === null
      ? null
      : `${Math.round(entity.confidence * 100)}%`;
    return {
      id: `entity:${record.id}:${entity.entityType}:${entity.entityId ?? entity.relationship}:${index}`,
      kind: 'entity' as const,
      label,
      detail: [
        titleCaseSemanticLabel(entity.entityType),
        entity.relationship,
        confidence,
      ].filter((value): value is string => Boolean(value)).join(' · '),
      observedAt: null,
      sourceText: valueText,
      children: [],
    };
  });
}

function contextRecordNode(record: LivingContextRecord): LivingContextTreeNode {
  return {
    id: `context_record:${record.id}`,
    kind: 'context_record',
    label: contextRecordTitle(record),
    detail: contextRecordTypeLabel(record),
    observedAt: record.observedAt,
    sourceText: contextRecordNarrative(record),
    children: [
      ...record.sources.map(recordSourceNode),
      ...entityNodes(record),
      ...conceptNodes(record),
    ],
  };
}

function assertionNode(assertion: LivingContextAssertion): LivingContextTreeNode {
  return {
    id: `assertion:${assertion.id}`,
    kind: 'assertion',
    label: titleCaseSemanticLabel(assertion.predicate),
    detail: assertion.confidence === null ? null : `${Math.round(assertion.confidence * 100)}% confidence`,
    observedAt: assertion.observedAt,
    sourceText: assertion.narrative,
    children: [
      ...assertion.sources.map(sourceSpanNode),
      ...conceptNodes(assertion),
    ],
  };
}

function signalNode(signal: LivingContextSignal): LivingContextTreeNode {
  const sourceNodes = signal.evidence
    .flatMap((evidence) => evidence.sources)
    .map(sourceSpanNode);
  return {
    id: `signal:${signal.signalKey}`,
    kind: 'signal',
    label: signal.label,
    detail: `${Math.round(signal.totalScore * 100)}% accumulated · ${signal.evidenceCount} evidence`,
    observedAt: signal.asOf,
    sourceText: null,
    children: sourceNodes,
  };
}

function interactionLabel(interaction: LivingContextInteraction): string {
  return titleCaseSemanticLabel(interaction.interactionType);
}

function sourceSpanIdsForArtifacts(artifacts: LivingContextArtifact[]): Set<string> {
  return new Set(artifacts.flatMap((artifact) =>
    artifact.sourceSpans.map((source) => source.sourceSpanId),
  ));
}

function contextRecordsForInteraction(
  records: LivingContextRecord[],
  interactionId: string,
  sourceSpanIds: Set<string>,
): LivingContextRecord[] {
  return records.filter((record) => record.interactionId === interactionId
    || record.sources.some((source) => (
      isSourceSpanRef(source) && sourceSpanIds.has(source.sourceSpanId)
    )));
}

function signalsForInteraction(
  signals: LivingContextSignal[],
  interactionId: string,
): LivingContextSignal[] {
  return signals.filter((signal) => signal.interactionId === interactionId
    || signal.evidence.some((evidence) => evidence.interactionId === interactionId));
}

function isMeetingEvidenceBranch(
  interaction: LivingContextInteraction,
  artifacts: LivingContextArtifact[],
): boolean {
  const interactionType = interaction.interactionType.toLowerCase();
  return interactionType.includes('meeting')
    || interactionType.includes('interview')
    || artifacts.some((artifact) => artifact.artifactType.toLowerCase() === 'meeting_transcript');
}

function branchNode(input: {
  interaction: LivingContextInteraction;
  artifacts: LivingContextArtifact[];
  contextRecords: LivingContextRecord[];
  assertions: LivingContextAssertion[];
  signals: LivingContextSignal[];
}): LivingContextTreeNode {
  return {
    id: `interaction:${input.interaction.id}`,
    kind: 'interaction',
    label: interactionLabel(input.interaction),
    detail: input.interaction.externalReference,
    observedAt: input.interaction.startedAt ?? input.interaction.createdAt,
    sourceText: null,
    children: [
      ...input.artifacts.map(artifactNode),
      ...input.contextRecords.map(contextRecordNode),
      ...input.assertions.map(assertionNode),
      ...input.signals.map(signalNode),
    ],
  };
}

function sourceSpanBelongsToInteraction(
  source: LivingContextRecordSourceRef,
  interactionSourceSpanIds: Set<string>,
): boolean {
  return isSourceSpanRef(source) && interactionSourceSpanIds.has(source.sourceSpanId);
}

function signalBelongsToInteraction(
  signal: LivingContextSignal,
  interactionIds: Set<string>,
  interactionSourceSpanIds: Set<string>,
): boolean {
  return (signal.interactionId !== null && interactionIds.has(signal.interactionId))
    || signal.evidence.some((evidence) => (
      (evidence.interactionId !== null && interactionIds.has(evidence.interactionId))
      || evidence.sources.some((source) => sourceSpanBelongsToInteraction(source, interactionSourceSpanIds))
    ));
}

export function buildLivingContextBranches(
  livingContext: LivingContextReadModel,
): LivingContextInteractionBranch[] {
  return livingContext.interactions.map((interaction) => {
    const artifacts = livingContext.artifacts.filter(
      (artifact) => artifact.interactionId === interaction.id,
    );
    const sourceSpanIds = sourceSpanIdsForArtifacts(artifacts);
    const contextRecords = contextRecordsForInteraction(
      livingContext.contextRecords,
      interaction.id,
      sourceSpanIds,
    );
    const assertions = livingContext.assertions.filter(
      (assertion) => assertion.interactionId === interaction.id,
    );
    const signals = signalsForInteraction(livingContext.signals, interaction.id);
    const sourceSpans = artifacts.flatMap((artifact) => artifact.sourceSpans);

    return {
      interaction,
      artifacts,
      sourceSpans,
      contextRecords,
      assertions,
      signals,
      isMeetingEvidence: isMeetingEvidenceBranch(interaction, artifacts),
      node: branchNode({ interaction, artifacts, contextRecords, assertions, signals }),
    };
  });
}

function accumulatedNode(livingContext: LivingContextReadModel): LivingContextTreeNode | null {
  const interactionIds = new Set(livingContext.interactions.map((interaction) => interaction.id));
  const interactionSourceSpanIds = sourceSpanIdsForArtifacts(
    livingContext.artifacts.filter((artifact) => (
      artifact.interactionId !== null && interactionIds.has(artifact.interactionId)
    )),
  );
  const artifacts = livingContext.artifacts.filter((artifact) => (
    artifact.interactionId === null || !interactionIds.has(artifact.interactionId)
  ));
  const contextRecords = livingContext.contextRecords.filter((record) => (
    (record.interactionId === null || !interactionIds.has(record.interactionId))
    && !record.sources.some((source) => sourceSpanBelongsToInteraction(source, interactionSourceSpanIds))
  ));
  const assertions = livingContext.assertions.filter((assertion) => (
    (assertion.interactionId === null || !interactionIds.has(assertion.interactionId))
    && !assertion.sources.some((source) => interactionSourceSpanIds.has(source.sourceSpanId))
  ));
  const signals = livingContext.signals.filter((signal) => (
    !signalBelongsToInteraction(signal, interactionIds, interactionSourceSpanIds)
  ));
  const children = [
    ...artifacts.map(artifactNode),
    ...contextRecords.map(contextRecordNode),
    ...assertions.map(assertionNode),
    ...signals.map(signalNode),
  ];
  if (children.length === 0) return null;
  return {
    id: 'accumulated_context',
    kind: 'accumulated_context',
    label: 'Accumulated Context',
    detail: 'Evidence that is not scoped to a single interaction',
    observedAt: null,
    sourceText: null,
    children,
  };
}

export function buildLivingContextTree(
  livingContext: LivingContextReadModel,
): LivingContextTree {
  const interactionBranches = buildLivingContextBranches(livingContext);
  const accumulated = accumulatedNode(livingContext);
  const rootChildren = [
    ...interactionBranches.map((branch) => branch.node),
    ...(accumulated ? [accumulated] : []),
  ];
  const personLabel = livingContext.person?.displayName
    ?? livingContext.person?.primaryEmail
    ?? 'Person';

  return {
    root: {
      id: livingContext.person?.personId ?? 'person',
      kind: 'person',
      label: personLabel,
      detail: livingContext.person?.relationshipSummary ?? null,
      observedAt: null,
      sourceText: null,
      children: rootChildren,
    },
    interactionBranches,
    accumulatedNode: accumulated,
  };
}
