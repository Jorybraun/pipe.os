import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ExternalLink,
  FileText,
  GitPullRequest,
  Network,
  Quote,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react';
import type {
  LivingContextArtifact,
  LivingContextAssertion,
  LivingContextInteraction,
  LivingContextReadModel,
  LivingContextRecord,
  LivingContextSignal,
  LivingContextSourceRef,
  StandaloneReviewExcludedPacket,
  StandaloneReviewEvaluatedChallenge,
  StandaloneReviewMatchRecord,
  StandaloneReviewPacketDetail,
  StandaloneReviewPacketDemand,
  StandaloneReviewPacketQualityGate,
  StandaloneReviewRoleSource,
  StandaloneReviewSourceRef,
  StandaloneReviewMatchNarrative,
  StandaloneReviewStretchArea,
} from '../../lib/api/types';
import { useLivingContext } from '../../hooks/useLivingContext';
import { buildLivingContextBranches } from '../../lib/livingContextTree';
import { ContextRecordForest } from './ContextRecordTree';
import './LivingContextGraph.css';

function titleCase(value: string): string {
  return value
    .replace(/[_:-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null): string {
  if (!value) return 'Undated';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

function scoreLabel(value: number | null): string {
  return value === null ? 'No interaction score' : `${Math.round(value * 100)}%`;
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function locatorLabel(source: LivingContextSourceRef): string {
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
  return source.stableSegmentId ?? 'source';
}

function includesQuery(values: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

function entityValueLabel(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

function interactionDate(interaction: LivingContextInteraction): string {
  return formatDate(interaction.startedAt ?? interaction.createdAt);
}

function hasLivingEvidence(context: LivingContextReadModel): boolean {
  const { summary } = context;
  return (
    summary.interactionCount > 0
    || summary.artifactCount > 0
    || summary.contextRecordCount > 0
    || summary.assertionCount > 0
    || summary.signalCount > 0
    || summary.sourceSpanCount > 0
    || context.interactions.length > 0
    || context.artifacts.length > 0
    || context.contextRecords.length > 0
    || context.assertions.length > 0
    || context.signals.length > 0
  );
}

type RecordingProvenance = {
  recordingKey?: string;
  transcriptionAudioKey?: string;
  provider?: string;
  transcriptStatus?: string;
};

function asMetadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sourceMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return asMetadataRecord(metadata.fixtureSource) ?? metadata;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function mergeRecordingProvenance(
  target: RecordingProvenance,
  metadata: Record<string, unknown>,
): void {
  const source = sourceMetadata(metadata);
  const recordingKey = metadataString(source, 'recordingKey');
  const transcriptionAudioKey = metadataString(source, 'transcriptionAudioKey');
  const provider = metadataString(source, 'provider');
  const transcriptStatus = metadataString(source, 'transcriptStatus');
  if (target.recordingKey === undefined && recordingKey) target.recordingKey = recordingKey;
  if (target.transcriptionAudioKey === undefined && transcriptionAudioKey) {
    target.transcriptionAudioKey = transcriptionAudioKey;
  }
  if (target.provider === undefined && provider) target.provider = provider;
  if (target.transcriptStatus === undefined && transcriptStatus) target.transcriptStatus = transcriptStatus;
}

function recordingProvenanceForBranch(
  interaction: LivingContextInteraction,
  artifacts: LivingContextArtifact[],
): RecordingProvenance | null {
  const provenance: RecordingProvenance = {};
  mergeRecordingProvenance(provenance, interaction.metadata);
  for (const artifact of artifacts) {
    mergeRecordingProvenance(provenance, artifact.metadata);
    for (const source of artifact.sourceSpans) {
      mergeRecordingProvenance(provenance, source.metadata);
    }
  }
  return provenance.recordingKey
    || provenance.transcriptionAudioKey
    || provenance.provider
    || provenance.transcriptStatus
    ? provenance
    : null;
}

function reviewSourceLabel(source: StandaloneReviewSourceRef): string {
  return source.locator
    ?? `${source.artifactId.slice(0, 10)}:${source.startOffset}-${source.endOffset}`;
}

function reviewSourceStatus(sources: StandaloneReviewSourceRef[]): string {
  return sources.length > 0
    ? sources.map(reviewSourceLabel).join(', ')
    : 'missing source evidence';
}

function reviewSourceSnippet(sources: StandaloneReviewSourceRef[]): string | null {
  return sources
    .map((source) => source.exactText?.trim())
    .find((text): text is string => Boolean(text)) ?? null;
}

function roleSourceLabel(source: StandaloneReviewRoleSource): string {
  return source.locator || source.entityId;
}

function roleSourceSnippet(source: StandaloneReviewRoleSource): string | null {
  return source.exactText?.trim() || null;
}

function reviewSourceFileLabel(source: StandaloneReviewSourceRef): string {
  if (!source.locator) return source.artifactId;
  const lineLocator = source.locator.match(/^(.+?)(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/);
  return lineLocator?.[1] ?? source.locator;
}

function reviewAnchorId(value: string, index: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `repo-demand-${index}-${slug || 'source'}`;
}

function uniqueReviewSourceLabels(sources: StandaloneReviewSourceRef[]): string[] {
  return [...new Set(sources.map(reviewSourceFileLabel))];
}

function matchStatusLabel(status: StandaloneReviewMatchRecord['matchStatus']): string {
  return status.replace(/_/g, ' ');
}

function reviewExclusionReasonLabel(reason: StandaloneReviewExcludedPacket['reason']): string {
  if (reason === 'DEMAND_WITHOUT_SOURCE_SPANS') return 'Demand lacks source spans';
  if (reason === 'MISSING_DEMAND_SOURCE_SPANS') return 'Missing repo source spans';
  if (reason === 'PACKET_NOT_PRODUCTION_READY') return 'Packet not production-ready';
  if (reason === 'PACKET_PROVENANCE_INVALID') return 'Invalid packet provenance';
  if (reason === 'PACKET_CONTEXT_PROJECTION_INCOMPLETE') return 'Missing graph projection';
  return 'Job-description guardrail';
}

function reviewExclusionDetail(packet: StandaloneReviewExcludedPacket): string {
  const details = [
    packet.repoId ? `repo ${packet.repoId}` : null,
    packet.prNumber !== null ? `PR #${packet.prNumber}` : null,
    packet.demandIds.length ? `demands ${packet.demandIds.join(', ')}` : null,
    packet.missingSourceSpanIds.length ? `missing spans ${packet.missingSourceSpanIds.join(', ')}` : null,
    packet.gateFailures.length ? `failed gates ${packet.gateFailures.join(', ')}` : null,
    packet.provenanceFailures.length ? `provenance ${packet.provenanceFailures.slice(0, 2).join(', ')}` : null,
    packet.contextProjectionFailures.length ? `graph context ${packet.contextProjectionFailures.slice(0, 2).join(', ')}` : null,
    packet.qualityScore !== null ? `quality ${packet.qualityScore.toFixed(2)}` : null,
  ].filter((value): value is string => Boolean(value));
  return details.join(' · ') || packet.id;
}

function reviewedChallengeDetail(challenge: StandaloneReviewEvaluatedChallenge): string {
  const parts = [
    `PR #${challenge.prNumber}`,
    `${challenge.alignedDemandCount} aligned demand${challenge.alignedDemandCount === 1 ? '' : 's'}`,
    `${challenge.stretchCount} stretch area${challenge.stretchCount === 1 ? '' : 's'}`,
    challenge.provenanceComplete ? 'provenance complete' : 'provenance incomplete',
  ];
  if (challenge.rejectionReasons.length > 0) {
    parts.push(challenge.rejectionReasons.slice(0, 2).join(', '));
  }
  return parts.join(' · ');
}

function ReviewSourceList({
  label,
  sources,
}: {
  label: string;
  sources: StandaloneReviewSourceRef[];
}): JSX.Element {
  return (
    <div className="living-context__repo-source-list">
      <div className="living-context__eyebrow">{label}</div>
      {sources.length > 0 ? (
        sources.slice(0, 3).map((source, index) => (
          <div
            key={`${label}:${source.artifactId}:${source.startOffset}:${source.endOffset}:${index}`}
            className="living-context__repo-source"
            data-testid="review-source-card"
            data-source-ref-type={source.sourceRefType}
            data-source-ref-id={source.sourceRefId}
            data-source-span-id={source.sourceSpanId}
            data-content-hash={source.contentHash}
          >
            <div>
              <strong>{reviewSourceLabel(source)}</strong>
              <span>{source.artifactVersion}</span>
            </div>
            {source.exactText && <blockquote>{source.exactText}</blockquote>}
          </div>
        ))
      ) : (
        <div className="living-context__repo-source living-context__repo-source--missing">
          missing source evidence
        </div>
      )}
    </div>
  );
}

function BridgeRoleSourceList({
  roleSources,
}: {
  roleSources: StandaloneReviewRoleSource[];
}): JSX.Element {
  if (roleSources.length === 0) {
    return (
      <div className="living-context__bridge-source living-context__bridge-source--missing">
        missing role source
      </div>
    );
  }

  return (
    <>
      {roleSources.slice(0, 2).map((source) => (
        <div
          key={`${source.entityId}:${source.locator}:${source.sourceRefId ?? ''}`}
          className="living-context__bridge-source"
          data-testid="match-bridge-role-source"
          data-source-ref-type={source.sourceRefType}
          data-source-ref-id={source.sourceRefId}
          data-source-span-id={source.sourceSpanId}
          data-content-hash={source.contentHash}
        >
          <strong>{roleSourceLabel(source)}</strong>
          {source.conceptKeys.length > 0 && (
            <span>{source.conceptKeys.slice(0, 3).join(', ')}</span>
          )}
          {roleSourceSnippet(source) && (
            <blockquote>{roleSourceSnippet(source)}</blockquote>
          )}
        </div>
      ))}
    </>
  );
}

function BridgeReviewSourceList({
  sources,
  missingLabel,
  testId,
}: {
  sources: StandaloneReviewSourceRef[];
  missingLabel: string;
  testId: string;
}): JSX.Element {
  if (sources.length === 0) {
    return (
      <div className="living-context__bridge-source living-context__bridge-source--missing">
        {missingLabel}
      </div>
    );
  }

  return (
    <>
      {sources.slice(0, 2).map((source, index) => (
        <div
          key={`${testId}:${source.artifactId}:${source.startOffset}:${source.endOffset}:${index}`}
          className="living-context__bridge-source"
          data-testid={testId}
          data-source-ref-type={source.sourceRefType}
          data-source-ref-id={source.sourceRefId}
          data-source-span-id={source.sourceSpanId}
          data-content-hash={source.contentHash}
        >
          <strong>{reviewSourceLabel(source)}</strong>
          <span>{source.artifactVersion}</span>
          {source.exactText && <blockquote>{source.exactText}</blockquote>}
        </div>
      ))}
    </>
  );
}

function MatchEvidenceBridgePanel({
  match,
}: {
  match: StandaloneReviewMatchRecord;
}): JSX.Element | null {
  if (match.evidence.length === 0 && match.roleSources.length === 0) return null;

  return (
    <section
      className="living-context__match-bridge"
      aria-label="Cross-scope match evidence bridge"
      data-testid="match-evidence-bridge"
    >
      <div className="living-context__section-head">
        <div>
          <div className="living-context__section-title">Evidence bridge</div>
          <div className="living-context__eyebrow">
            {'role context -> person context -> repo challenge'}
          </div>
        </div>
        <Network size={14} color="var(--lc-source)" />
      </div>

      <div className="living-context__bridge-grid living-context__bridge-grid--head">
        <div>Role requirement</div>
        <div>Person evidence</div>
        <div>Repo challenge</div>
      </div>

      {match.evidence.length > 0 ? (
        match.evidence.slice(0, 4).map((entry) => (
            <article
              key={`${entry.atomId}:${entry.demandId}`}
              className="living-context__bridge-row"
              data-testid="match-bridge-row"
            >
              <div className="living-context__bridge-row-head">
                <strong>{`${entry.atomId} -> ${entry.demandId}`}</strong>
                <span>{Math.round(entry.pairScore * 100)}% alignment</span>
                {entry.purpose && <span>{entry.purpose}</span>}
              </div>
              {entry.sharedConcepts.length > 0 && (
                <div className="living-context__concepts">
                  {entry.sharedConcepts.slice(0, 5).map((concept) => (
                    <span key={`${entry.atomId}:${entry.demandId}:${concept}`} className="living-context__concept">
                      {concept}
                    </span>
                  ))}
                </div>
              )}
              <div className="living-context__bridge-grid">
                <div>
                  <BridgeRoleSourceList roleSources={entry.roleSourceRefs} />
                </div>
                <div>
                  <BridgeReviewSourceList
                    sources={entry.candidateSourceRefs}
                    missingLabel="missing person source"
                    testId="match-bridge-person-source"
                  />
                </div>
                <div>
                  <BridgeReviewSourceList
                    sources={entry.challengeSourceRefs}
                    missingLabel="missing repo source"
                    testId="match-bridge-repo-source"
                  />
                </div>
              </div>
            </article>
        ))
      ) : (
        <div className="living-context__bridge-source living-context__bridge-source--missing">
          No aligned person/repo evidence yet.
        </div>
      )}
    </section>
  );
}

function RepositoryOverlayPanel({
  match,
}: {
  match: StandaloneReviewMatchRecord;
}): JSX.Element | null {
  if (match.evidence.length === 0) return null;

  const repoLabel = match.repoName ?? match.repoUrl ?? 'Selected repository';
  const prLabel = match.prNumber !== null ? `PR #${match.prNumber}` : 'Selected PR';
  const demandAnchors = match.evidence.map((entry, index) => ({
    entry,
    anchorId: reviewAnchorId(entry.demandId, index),
    sourceLabels: uniqueReviewSourceLabels(entry.challengeSourceRefs),
  }));

  return (
    <section
      className="living-context__repo-overlay"
      aria-label="Repository evidence overlay"
      data-testid="repository-overlay-panel"
    >
      <div className="living-context__section-head">
        <div>
          <div className="living-context__section-title">Repository evidence overlay</div>
          <div className="living-context__eyebrow">
            {repoLabel} · {prLabel}
          </div>
        </div>
        <GitPullRequest size={14} color="var(--lc-source)" />
      </div>

      <div className="living-context__repo-overlay-layout">
        <nav className="living-context__repo-nav" aria-label="Repository source spans">
          {demandAnchors.map(({ entry, anchorId, sourceLabels }) => (
            <a key={anchorId} href={`#${anchorId}`}>
              <span>{sourceLabels.join(', ') || 'missing PR source'}</span>
              <strong>{entry.demandId}</strong>
            </a>
          ))}
        </nav>

        <div className="living-context__repo-demands">
          {demandAnchors.map(({ entry, anchorId, sourceLabels }) => (
            <article
              id={anchorId}
              key={anchorId}
              className="living-context__repo-demand"
              data-testid="repository-overlay-demand"
            >
              <div className="living-context__repo-demand-head">
                <div>
                  <div className="living-context__repo-demand-title">{entry.demandId}</div>
                  <div className="living-context__repo-demand-meta">
                    <span>{Math.round(entry.pairScore * 100)}% alignment</span>
                    {entry.purpose && <span>{entry.purpose}</span>}
                    {sourceLabels.map((sourceLabel) => (
                      <span key={`${anchorId}:${sourceLabel}`}>{sourceLabel}</span>
                    ))}
                  </div>
                </div>
                <div className="living-context__repo-atom">{entry.atomId}</div>
              </div>

              <div className="living-context__repo-source-grid">
                <ReviewSourceList
                  label="Candidate source"
                  sources={entry.candidateSourceRefs}
                />
                <ReviewSourceList
                  label="PR demand source"
                  sources={entry.challengeSourceRefs}
                />
              </div>

              {entry.sharedConcepts.length > 0 && (
                <div className="living-context__concepts">
                  {entry.sharedConcepts.slice(0, 5).map((concept) => (
                    <span key={`${anchorId}:${concept}`} className="living-context__concept">
                      {concept}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function fileNameFromPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function directoryFromPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : '';
}

function demandFamilyLabel(family: string): string {
  const [namespace, ...rest] = family.split(':');
  const detail = rest.join(':');
  const ns = titleCase(namespace ?? family);
  if (!detail) return ns;
  return `${titleCase(detail)} (${ns})`;
}

function PacketProvenanceToggle({
  showIds,
  onToggle,
}: {
  showIds: boolean;
  onToggle: (value: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="living-context__packet-toggle"
      onClick={() => onToggle(!showIds)}
      aria-pressed={showIds}
      aria-label="Toggle provenance IDs"
      data-testid="packet-provenance-toggle"
    >
      {showIds ? 'Hide provenance IDs' : 'Show provenance IDs'}
    </button>
  );
}

function PacketFileList({
  packet,
  showIds,
}: {
  packet: StandaloneReviewPacketDetail;
  showIds: boolean;
}): JSX.Element | null {
  if (packet.changedFilePaths.length === 0) return null;
  return (
    <div className="living-context__packet-files" data-testid="packet-files">
      <div className="living-context__eyebrow">Files</div>
      <ul>
        {packet.changedFilePaths.map((path) => {
          const dir = directoryFromPath(path);
          const name = fileNameFromPath(path);
          return (
            <li key={path} data-testid="packet-file-row">
              <div className="living-context__packet-file-path">
                {dir && <span className="living-context__packet-file-dir">{dir}/</span>}
                <strong>{name}</strong>
              </div>
              <div className="living-context__packet-file-meta">
                <span>{packet.sourceSpanIds.length} spans</span>
                <span>{packet.changedSymbolIds.length} symbols</span>
              </div>
              {showIds && (
                <div className="living-context__packet-file-ids" data-testid="packet-file-ids">
                  {path}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PacketStructuralFacts({
  packet,
}: {
  packet: StandaloneReviewPacketDetail;
}): JSX.Element | null {
  const gates = packet.quality?.gates ?? [];
  if (gates.length === 0) return null;
  return (
    <div className="living-context__packet-facts" data-testid="packet-structural-facts">
      <div className="living-context__eyebrow">Structural facts</div>
      <ul>
        {gates.map((gate: StandaloneReviewPacketQualityGate) => (
          <li
            key={gate.gate}
            className={gate.passed ? 'living-context__fact--pass' : 'living-context__fact--fail'}
            data-testid="packet-structural-fact"
            data-gate={gate.gate}
            data-passed={gate.passed}
          >
            <span>{titleCase(gate.gate.replace(/_/g, ' '))}</span>
            <strong>{gate.passed ? 'Pass' : 'Fail'}</strong>
            <p>{gate.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PacketBehavioralEpisodes({
  packet,
}: {
  packet: StandaloneReviewPacketDetail;
}): JSX.Element | null {
  const hasTests = packet.testChanges.length > 0;
  const hasIssue = packet.issue !== null;
  if (!hasTests && !hasIssue) return null;
  return (
    <div className="living-context__packet-episodes" data-testid="packet-behavioral-episodes">
      <div className="living-context__eyebrow">Behavioral episodes</div>
      <ul>
        {packet.testChanges.map((test) => (
          <li key={test.path} data-testid="packet-test-change">
            <span>{fileNameFromPath(test.path)}</span>
            <strong>{test.framework ?? 'test'}</strong>
            <p>{test.path}</p>
          </li>
        ))}
        {packet.issue && (
          <li key={`issue:${packet.issue.number}`} data-testid="packet-issue">
            <span>Issue #{packet.issue.number}</span>
            <strong>{packet.issue.title}</strong>
            {packet.issue.labels.length > 0 && (
              <div className="living-context__concepts">
                {packet.issue.labels.map((label) => (
                  <span key={`issue-label:${label}`} className="living-context__concept">
                    {label}
                  </span>
                ))}
              </div>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}

function PacketAssertions({
  packet,
  showIds,
}: {
  packet: StandaloneReviewPacketDetail;
  showIds: boolean;
}): JSX.Element | null {
  if (packet.demands.length === 0) return null;
  return (
    <div className="living-context__packet-assertions" data-testid="packet-assertions">
      <div className="living-context__eyebrow">Packet assertions</div>
      <div className="living-context__packet-demand-list">
        {packet.demands.map((demand: StandaloneReviewPacketDemand) => (
          <article
            key={demand.id}
            className="living-context__packet-demand"
            data-testid="packet-demand"
          >
            <div className="living-context__packet-demand-head">
              <strong>{demandFamilyLabel(demand.family)}</strong>
              <span>{Math.round(demand.weight * 100)}% weight</span>
            </div>
            {demand.narrative && <p>{demand.narrative}</p>}
            {demand.conceptKeys.length > 0 && (
              <div className="living-context__concepts">
                {demand.conceptKeys.slice(0, 6).map((concept) => (
                  <span key={`${demand.id}:${concept}`} className="living-context__concept">
                    {concept}
                  </span>
                ))}
              </div>
            )}
            {showIds && (
              <dl className="living-context__packet-demand-ids" data-testid="packet-demand-ids">
                <dt>Demand ID</dt>
                <dd>{demand.id}</dd>
                <dt>Span IDs</dt>
                <dd>{demand.sourceSpanIds.join(', ') || '—'}</dd>
                <dt>Symbol IDs</dt>
                <dd>{demand.changedSymbolIds.join(', ') || '—'}</dd>
              </dl>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function PacketConcepts({
  packet,
}: {
  packet: StandaloneReviewPacketDetail;
}): JSX.Element | null {
  const concepts = [...new Set([
    ...packet.demandFamilies,
    ...packet.demands.flatMap((demand) => demand.conceptKeys),
  ])];
  if (concepts.length === 0) return null;
  return (
    <div className="living-context__packet-concepts" data-testid="packet-concepts">
      <div className="living-context__eyebrow">Packet concepts</div>
      <div className="living-context__concepts">
        {concepts.slice(0, 12).map((concept) => (
          <span key={concept} className="living-context__concept">{concept}</span>
        ))}
      </div>
    </div>
  );
}

function RepoPacketPanel({
  match,
}: {
  match: StandaloneReviewMatchRecord;
}): JSX.Element | null {
  const packet: StandaloneReviewPacketDetail | null = match.packet;
  const [showIds, setShowIds] = useState(false);
  if (!packet) return null;
  const repoLabel = match.repoName ?? match.repoUrl ?? 'Selected repository';
  const prLabel = match.prNumber !== null ? `PR #${match.prNumber}` : 'Selected PR';
  const hasContent = packet.changedFilePaths.length > 0
    || packet.demands.length > 0
    || packet.sourceSpanIds.length > 0
    || (packet.quality?.gates.length ?? 0) > 0
    || packet.testChanges.length > 0
    || packet.issue !== null;
  if (!hasContent) return null;

  return (
    <section
      className="living-context__repo-packet"
      aria-label="Repository packet"
      data-testid="repo-packet-panel"
    >
      <div className="living-context__section-head">
        <div>
          <div className="living-context__section-title">Repository packet</div>
          <div className="living-context__eyebrow">
            {repoLabel} · {prLabel} · {packet.sourceSpanIds.length} source spans · {packet.changedSymbolIds.length} symbols
          </div>
        </div>
        <div className="living-context__packet-head-actions">
          <PacketProvenanceToggle showIds={showIds} onToggle={setShowIds} />
        </div>
      </div>

      <div className="living-context__packet-layout">
        <PacketFileList packet={packet} showIds={showIds} />
        <div className="living-context__packet-side">
          <PacketConcepts packet={packet} />
          <PacketStructuralFacts packet={packet} />
          <PacketBehavioralEpisodes packet={packet} />
        </div>
      </div>

      <PacketAssertions packet={packet} showIds={showIds} />

      {showIds && (
        <dl className="living-context__packet-provenance" data-testid="packet-provenance-detail">
          <dt>Packet ID</dt>
          <dd>{packet.packetId}</dd>
          <dt>Source span IDs</dt>
          <dd>{packet.sourceSpanIds.join(', ') || '—'}</dd>
          <dt>Changed symbol IDs</dt>
          <dd>{packet.changedSymbolIds.slice(0, 12).join(', ') || '—'}</dd>
          {packet.quality && (
            <>
              <dt>Quality score</dt>
              <dd>{Math.round(packet.quality.score * 100)}%</dd>
              <dt>Eligible</dt>
              <dd>{packet.quality.eligible ? 'Yes' : 'No'}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

function StretchAreasPanel({
  stretchAreas,
}: {
  stretchAreas: StandaloneReviewStretchArea[];
}): JSX.Element | null {
  if (stretchAreas.length === 0) return null;
  return (
    <section
      className="living-context__stretch-areas"
      aria-label="Stretch areas"
      data-testid="stretch-areas-panel"
    >
      <div className="living-context__section-head">
        <div>
          <div className="living-context__section-title">Stretch areas</div>
          <div className="living-context__eyebrow">
            {stretchAreas.length} demand{stretchAreas.length === 1 ? '' : 's'} matched via adjacent experience
          </div>
        </div>
      </div>
      <div className="living-context__diagnostic-list">
        {stretchAreas.map((area) => (
          <article
            key={`${area.atomId}:${area.demandId}`}
            className="living-context__stretch-row"
            data-testid="stretch-area-row"
          >
            <div className="living-context__stretch-head">
              <span className="living-context__stretch-dimension">{titleCase(area.dimension)}</span>
              <span className="living-context__stretch-concepts">
                {area.atomConcept} → {area.demandConcept}
              </span>
            </div>
            <div className="living-context__repo-source-grid">
              <ReviewSourceList label="Candidate source" sources={area.candidateSourceRefs} />
              <ReviewSourceList label="PR demand source" sources={area.challengeSourceRefs} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function UnmatchedDemandsPanel({
  unmatchedDemandIds,
  packet,
}: {
  unmatchedDemandIds: string[];
  packet: StandaloneReviewPacketDetail | null;
}): JSX.Element | null {
  if (unmatchedDemandIds.length === 0) return null;
  const demandDetails = packet?.demands.filter((demand) =>
    unmatchedDemandIds.includes(demand.id)
  ) ?? [];
  return (
    <section
      className="living-context__unmatched-demands"
      aria-label="Unmatched demands"
      data-testid="unmatched-demands-panel"
    >
      <div className="living-context__section-head">
        <div>
          <div className="living-context__section-title">Unmatched demands</div>
          <div className="living-context__eyebrow">
            {unmatchedDemandIds.length} PR demand{unmatchedDemandIds.length === 1 ? '' : 's'} without candidate evidence
          </div>
        </div>
      </div>
      <div className="living-context__diagnostic-list">
        {demandDetails.length > 0 ? (
          demandDetails.map((demand) => (
            <div
              key={demand.id}
              className="living-context__diagnostic-row"
              data-testid="unmatched-demand-row"
            >
              <strong>{demand.id}</strong>
              <span className="living-context__concept">{demand.family}</span>
              {demand.narrative && <p>{demand.narrative}</p>}
              {demand.conceptKeys.length > 0 && (
                <div className="living-context__concepts">
                  {demand.conceptKeys.slice(0, 5).map((concept) => (
                    <span key={`${demand.id}:${concept}`} className="living-context__concept">
                      {concept}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          unmatchedDemandIds.map((demandId) => (
            <div key={demandId} className="living-context__diagnostic-row">
              <strong>{demandId}</strong>
              <span className="living-context__missing-evidence">No candidate alignment</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function MatchNarrativePanel({
  narrative,
}: {
  narrative: StandaloneReviewMatchNarrative | null;
}): JSX.Element | null {
  if (!narrative) return null;
  return (
    <section
      className="living-context__match-narrative"
      aria-label="Match narrative"
      data-testid="match-narrative-panel"
    >
      <div className="living-context__section-head">
        <div>
          <div className="living-context__section-title">{narrative.title}</div>
          <div className="living-context__eyebrow">{narrative.verdict}</div>
        </div>
        <Quote size={14} color="var(--lc-source)" />
      </div>
      {narrative.sections.map((section) => (
        <div key={section.heading} className="living-context__narrative-section">
          <div className="living-context__eyebrow">{section.heading}</div>
          <ul>
            {section.items.map((item, index) => (
              <li key={`${section.heading}:${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function StandaloneReviewMatchPanel({
  match,
}: {
  match: StandaloneReviewMatchRecord | null;
}): JSX.Element | null {
  if (!match) return null;
  const primaryEvidence = match.evidence.slice(0, 3);
  const excludedPackets = match.diagnostics.excludedPackets.slice(0, 4);
  const evaluatedChallenges = match.diagnostics.evaluatedChallenges.slice(0, 4);
  const recalledPacketIds = match.diagnostics.recalledPacketIds.slice(0, 6);
  const selectedChallenge = evaluatedChallenges.find((challenge) =>
    challenge.prNumber === match.prNumber
      && (match.repoId === null || challenge.repoId === String(match.repoId)),
  ) ?? evaluatedChallenges.find((challenge) => challenge.rank === 1) ?? null;
  const selectedStretchCount = selectedChallenge?.stretchCount ?? null;
  return (
    <section
      className="living-context__review-match"
      aria-label="Standalone code review match"
      data-testid="standalone-review-match-panel"
    >
      <div className="living-context__review-match-head">
        <div>
          <div className="living-context__section-title">Code review match</div>
          <div className="living-context__review-match-title">
            {match.repoName ?? match.repoUrl ?? 'No PR selected yet'}
            {match.prNumber !== null ? ` #${match.prNumber}` : ''}
          </div>
        </div>
        <span className={`living-context__match-status living-context__match-status--${match.matchStatus.toLowerCase()}`}>
          {matchStatusLabel(match.matchStatus)}
        </span>
      </div>

      <div className="living-context__review-match-summary">{match.summary}</div>

      {(match.prUrl || match.score !== null || match.submitted) && (
        <div className="living-context__review-match-meta">
          {match.prUrl && (
            <a href={match.prUrl} target="_blank" rel="noopener noreferrer">
              <GitPullRequest size={12} />
              {match.prTitle ?? 'Selected PR'}
              <ExternalLink size={10} />
            </a>
          )}
          {match.score !== null && <span>{Math.round(match.score * 100)}% match score</span>}
          {selectedStretchCount !== null && selectedStretchCount > 0 && (
            <span>{selectedStretchCount} stretch area{selectedStretchCount === 1 ? '' : 's'}</span>
          )}
          {match.submitted && <span>Review submitted</span>}
        </div>
      )}

      {match.roleSources.length > 0 && (
        <div className="living-context__role-sources" data-testid="standalone-review-role-sources">
          <span>Role sources</span>
          <div>
            {match.roleSources.slice(0, 4).map((source) => (
              <span key={`${source.entityId}:${source.locator}`} className="living-context__role-source">
                {roleSourceLabel(source)}
                {source.conceptKeys.length > 0 && (
                  <small>{source.conceptKeys.slice(0, 3).join(', ')}</small>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {match.submission && (
        <div className="living-context__review-submission" data-testid="standalone-review-submission">
          <div className="living-context__eyebrow">Candidate review result</div>
          <div className="living-context__review-submission-meta">
            {match.submission.verdict && <span>{titleCase(match.submission.verdict)}</span>}
            <span>{match.submission.annotationCount} annotation{match.submission.annotationCount === 1 ? '' : 's'}</span>
            {match.completedAt && <span>{formatDate(match.completedAt)}</span>}
          </div>
          {match.submission.summary && (
            <blockquote>{match.submission.summary}</blockquote>
          )}
          {match.submission.annotations.length > 0 && (
            <div className="living-context__review-submission-annotations">
              {match.submission.annotations.map((annotation, index) => (
                <div key={`${annotation.file ?? 'annotation'}:${annotation.line ?? index}:${index}`}>
                  <span>
                    {[annotation.file, annotation.line !== null ? `line ${annotation.line}` : null, annotation.severity]
                      .filter((value): value is string => Boolean(value))
                      .join(' · ') || `annotation ${index + 1}`}
                  </span>
                  <p>{annotation.comment}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <MatchEvidenceBridgePanel match={match} />

      {primaryEvidence.length > 0 && (
        <div className="living-context__review-evidence" data-testid="standalone-review-evidence">
          {primaryEvidence.map((entry) => {
            const candidateSnippet = reviewSourceSnippet(entry.candidateSourceRefs);
            const challengeSnippet = reviewSourceSnippet(entry.challengeSourceRefs);
            return (
              <div key={`${entry.atomId}:${entry.demandId}`} className="living-context__review-evidence-row">
                <div className="living-context__review-evidence-score">
                  {Math.round(entry.pairScore * 100)}%
                </div>
                <div>
                  <div className="living-context__review-evidence-title">
                    {entry.atomId} → {entry.demandId}
                  </div>
                  <div className="living-context__review-evidence-sources">
                    <span className={entry.candidateSourceRefs.length === 0 ? 'living-context__missing-evidence' : undefined}>
                      candidate: {reviewSourceStatus(entry.candidateSourceRefs)}
                    </span>
                    <span className={entry.challengeSourceRefs.length === 0 ? 'living-context__missing-evidence' : undefined}>
                      PR: {reviewSourceStatus(entry.challengeSourceRefs)}
                    </span>
                  </div>
                  {(candidateSnippet || challengeSnippet) && (
                    <div className="living-context__review-source-snippets">
                      {candidateSnippet && (
                        <blockquote>
                          <span>Candidate evidence</span>
                          {candidateSnippet}
                        </blockquote>
                      )}
                      {challengeSnippet && (
                        <blockquote>
                          <span>PR demand evidence</span>
                          {challengeSnippet}
                        </blockquote>
                      )}
                    </div>
                  )}
                  {entry.sharedConcepts.length > 0 && (
                    <div className="living-context__concepts">
                      {entry.sharedConcepts.slice(0, 4).map((concept) => (
                        <span key={`${entry.atomId}:${entry.demandId}:${concept}`} className="living-context__concept">
                          {concept}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RepositoryOverlayPanel match={match} />

      <RepoPacketPanel match={match} />

      <StretchAreasPanel stretchAreas={match.stretchAreas} />

      <UnmatchedDemandsPanel
        unmatchedDemandIds={match.unmatchedDemandIds}
        packet={match.packet}
      />

      <MatchNarrativePanel narrative={match.matchNarrative} />

      {match.gaps.length > 0 && (
        <div className="living-context__review-gaps">
          <div className="living-context__eyebrow">Evidence gaps / guardrails</div>
          <ul>
            {match.gaps.slice(0, 4).map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

      {(recalledPacketIds.length > 0 || excludedPackets.length > 0 || evaluatedChallenges.length > 0) && (
        <div className="living-context__review-diagnostics" data-testid="standalone-review-diagnostics">
          {recalledPacketIds.length > 0 && (
            <div>
              <div className="living-context__eyebrow">Recalled packets</div>
              <div className="living-context__packet-strip">
                {recalledPacketIds.map((packetId) => (
                  <span key={packetId}>{packetId}</span>
                ))}
              </div>
            </div>
          )}

          {excludedPackets.length > 0 && (
            <div>
              <div className="living-context__eyebrow">Excluded challenge packets</div>
              <div className="living-context__diagnostic-list">
                {excludedPackets.map((packet) => (
                  <div key={`${packet.id}:${packet.reason}`} className="living-context__diagnostic-row">
                    <span>{reviewExclusionReasonLabel(packet.reason)}</span>
                    <strong>{packet.id}</strong>
                    <p>{reviewExclusionDetail(packet)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {evaluatedChallenges.length > 0 && (
            <div>
              <div className="living-context__eyebrow">Evaluated challenge evidence</div>
              <div className="living-context__diagnostic-list">
                {evaluatedChallenges.map((challenge) => (
                  <div key={challenge.challengeId} className="living-context__diagnostic-row">
                    <span>{challenge.eligible ? 'Eligible' : 'Blocked'}</span>
                    <strong>{challenge.challengeId}</strong>
                    <p>{reviewedChallengeDetail(challenge)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SourceButton({
  source,
  onSelect,
}: {
  source: LivingContextSourceRef;
  onSelect: (source: LivingContextSourceRef) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="living-context__source-button"
      onClick={() => onSelect(source)}
      title={source.exactText}
    >
      <Quote size={10} />
      <span>{titleCase(source.artifactType)} · {locatorLabel(source)}</span>
    </button>
  );
}

function SignalNode({
  signal,
  onSelectSource,
}: {
  signal: LivingContextSignal;
  onSelectSource: (source: LivingContextSourceRef) => void;
}): JSX.Element {
  const interactionScore = signal.conversationScore;
  return (
    <div className="living-context__signal">
      <div className="living-context__signal-title">{signal.label}</div>
      <div className="living-context__scores">
        <div>
          <div className="living-context__score-label">
            <span>Interaction</span>
            <span>{scoreLabel(interactionScore)}</span>
          </div>
          <div className="living-context__score-track">
            <div
              className="living-context__score-fill"
              style={{ width: `${Math.round((interactionScore ?? 0) * 100)}%`, opacity: 0.62 }}
            />
          </div>
        </div>
        <div>
          <div className="living-context__score-label">
            <span>Accumulated</span>
            <span>{Math.round(signal.totalScore * 100)}%</span>
          </div>
          <div className="living-context__score-track">
            <div
              className="living-context__score-fill"
              style={{ width: `${Math.round(signal.totalScore * 100)}%` }}
            />
          </div>
        </div>
      </div>
      <div className="living-context__signal-foot">
        <span>{signal.evidenceCount} evidence</span>
        <span>{signal.sourceDiversity} sources</span>
        <span>{Math.round(signal.confidence * 100)}% confidence</span>
      </div>
      {signal.evidence.some((evidence) => evidence.sources.length > 0) && (
        <div className="living-context__source-links">
          {signal.evidence.flatMap((evidence) => evidence.sources).slice(0, 2).map((source, index) => (
            <SourceButton
              key={`${signal.signalKey}:${source.sourceSpanId}:${index}`}
              source={source}
              onSelect={onSelectSource}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AssertionNode({
  assertion,
  relatedPredicates,
  onSelectSource,
}: {
  assertion: LivingContextAssertion;
  relatedPredicates: string[];
  onSelectSource: (source: LivingContextSourceRef) => void;
}): JSX.Element {
  return (
    <div className="living-context__assertion">
      <div className="living-context__predicate">{assertion.predicate}</div>
      <div className="living-context__narrative">{assertion.narrative}</div>
      {assertion.concepts.length > 0 && (
        <div className="living-context__concepts">
          {assertion.concepts.map((concept) => (
            <span
              key={`${assertion.id}:${concept.id}:${concept.relationship}`}
              className="living-context__concept"
              title={`${concept.relationship} · weight ${concept.weight.toFixed(2)}`}
            >
              {concept.label} · {concept.relationship}
            </span>
          ))}
        </div>
      )}
      {relatedPredicates.length > 0 && (
        <div className="living-context__relations">
          {relatedPredicates.map((predicate, index) => (
            <span key={`${assertion.id}:${predicate}:${index}`} className="living-context__relation">
              {predicate}
            </span>
          ))}
        </div>
      )}
      {assertion.sources.length > 0 && (
        <div className="living-context__source-links">
          {assertion.sources.map((source) => (
            <SourceButton
              key={`${assertion.id}:${source.sourceSpanId}:${source.evidenceRole ?? ''}`}
              source={source}
              onSelect={onSelectSource}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactNode({
  artifact,
  onSelectSource,
}: {
  artifact: LivingContextArtifact;
  onSelectSource: (source: LivingContextSourceRef) => void;
}): JSX.Element {
  return (
    <div className="living-context__artifact">
      <div className="living-context__artifact-title">{titleCase(artifact.artifactType)}</div>
      <div className="living-context__artifact-meta">
        version {artifact.latestVersionNumber ?? '—'} · {artifact.sourceSpans.length} spans
      </div>
      {artifact.sourceSpans.length > 0 && (
        <div className="living-context__source-links">
          {artifact.sourceSpans.slice(0, 3).map((source) => (
            <SourceButton
              key={`${artifact.id}:${source.sourceSpanId}`}
              source={source}
              onSelect={onSelectSource}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingRecordingProvenance({
  provenance,
}: {
  provenance: RecordingProvenance;
}): JSX.Element {
  const entries = [
    provenance.transcriptStatus
      ? { label: 'Transcript', value: provenance.transcriptStatus }
      : null,
    provenance.provider
      ? { label: 'Provider', value: provenance.provider }
      : null,
    provenance.recordingKey
      ? { label: 'Recording', value: provenance.recordingKey }
      : null,
    provenance.transcriptionAudioKey
      ? { label: 'Audio', value: provenance.transcriptionAudioKey }
      : null,
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry));

  return (
    <div
      className="living-context__meeting-recording"
      data-testid="meeting-recording-provenance"
    >
      {entries.map((entry) => (
        <span key={`${entry.label}:${entry.value}`}>
          <strong>{entry.label}</strong>
          {entry.value}
        </span>
      ))}
    </div>
  );
}

function MeetingEvidencePanel({
  livingContext,
  onSelectSource,
}: {
  livingContext: LivingContextReadModel;
  onSelectSource: (source: LivingContextSourceRef) => void;
}): JSX.Element | null {
  const branches = buildLivingContextBranches(livingContext).filter((branch) => branch.isMeetingEvidence);
  const branchViews = branches.map((branch) => ({
    branch,
    recordingProvenance: recordingProvenanceForBranch(branch.interaction, branch.artifacts),
  }));

  if (branches.length === 0) return null;

  return (
    <section
      className="living-context__meeting-evidence"
      aria-label="Meeting evidence"
      data-testid="meeting-evidence-panel"
    >
      <div className="living-context__section-head">
        <div>
          <div className="living-context__section-title">Meeting evidence</div>
          <div className="living-context__eyebrow">
            Transcript-backed interaction branches
          </div>
        </div>
        <div className="living-context__count">{branches.length}</div>
      </div>

      <div className="living-context__meeting-grid">
        {branchViews.map(({ branch, recordingProvenance }) => (
          <article
            key={branch.interaction.id}
            className="living-context__meeting-card"
            data-testid="meeting-evidence-card"
          >
            <div className="living-context__meeting-head">
              <div>
                <div className="living-context__meeting-title">
                  {titleCase(branch.interaction.interactionType)}
                </div>
                <div className="living-context__meeting-meta">
                  <span>{interactionDate(branch.interaction)}</span>
                  {branch.interaction.externalReference && (
                    <span>{branch.interaction.externalReference}</span>
                  )}
                </div>
              </div>
              <div className="living-context__meeting-counts">
                <span>{countLabel(branch.artifacts.length, 'artifact')}</span>
                <span>{countLabel(branch.sourceSpans.length, 'span')}</span>
                <span>{countLabel(branch.assertions.length, 'claim')}</span>
              </div>
            </div>

            {recordingProvenance && (
              <MeetingRecordingProvenance provenance={recordingProvenance} />
            )}

            {branch.sourceSpans.length > 0 && (
              <div className="living-context__meeting-sources">
                {branch.sourceSpans.slice(0, 2).map((source) => (
                  <div
                    key={`${branch.interaction.id}:${source.sourceSpanId}`}
                    className="living-context__meeting-source"
                    data-testid="meeting-evidence-source"
                  >
                    <SourceButton source={source} onSelect={onSelectSource} />
                    <blockquote>{source.exactText}</blockquote>
                  </div>
                ))}
              </div>
            )}

            {branch.contextRecords.length > 0 && (
              <div className="living-context__meeting-records">
                {branch.contextRecords.slice(0, 2).map((record) => (
                  <div key={record.id} className="living-context__meeting-record">
                    <span>{titleCase(record.recordType)}</span>
                    <p>{record.narrative}</p>
                  </div>
                ))}
              </div>
            )}

            {branch.assertions.length > 0 && (
              <div className="living-context__meeting-assertions">
                {branch.assertions.slice(0, 2).map((assertion) => (
                  <div key={assertion.id}>
                    <span>{assertion.predicate}</span>
                    <p>{assertion.narrative}</p>
                  </div>
                ))}
              </div>
            )}

            {branch.signals.length > 0 && (
              <div className="living-context__concepts">
                {branch.signals.slice(0, 4).map((signal) => (
                  <span key={`${branch.interaction.id}:${signal.signalKey}`} className="living-context__concept">
                    {signal.label}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export function LivingContextGraph({
  candidateId,
  livingContextEndpoint,
  initialLivingContext,
  standaloneReviewMatch,
}: {
  candidateId: string;
  livingContextEndpoint?: string;
  initialLivingContext?: LivingContextReadModel | null;
  standaloneReviewMatch?: StandaloneReviewMatchRecord | null;
}): JSX.Element {
  const livingContextSource = livingContextEndpoint
    ? initialLivingContext === undefined
      ? { endpoint: livingContextEndpoint }
      : { endpoint: livingContextEndpoint, initialLivingContext }
    : candidateId;
  const { livingContext, isLoading, error, refetch } = useLivingContext(livingContextSource);
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<LivingContextSourceRef | null>(null);
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLowerCase();

  useEffect(() => {
    if (!livingContext || selectedInteractionId !== null) return;
    setSelectedInteractionId('all');
  }, [livingContext, selectedInteractionId]);

  useEffect(() => {
    if (selectedSource || !livingContext) return;
    const firstSource =
      livingContext.assertions.find((assertion) => assertion.sources.length > 0)?.sources[0]
      ?? livingContext.artifacts.find((artifact) => artifact.sourceSpans.length > 0)?.sourceSpans[0]
      ?? null;
    setSelectedSource(firstSource);
  }, [livingContext, selectedSource]);

  const selectedInteraction = livingContext?.interactions.find(
    (interaction) => interaction.id === selectedInteractionId,
  ) ?? null;

  const contextRecordIdsByInteraction = useMemo(() => {
    const index = new Map<string, Set<string>>();
    if (!livingContext) return index;
    for (const branch of buildLivingContextBranches(livingContext)) {
      index.set(
        branch.interaction.id,
        new Set(branch.contextRecords.map((record) => record.id)),
      );
    }
    return index;
  }, [livingContext]);

  const isRecordVisibleForInteraction = useMemo(() => (
    (record: LivingContextRecord): boolean => {
      if (selectedInteractionId === 'all') return true;
      if (record.interactionId === selectedInteractionId) return true;
      return contextRecordIdsByInteraction.get(selectedInteractionId ?? '')?.has(record.id) ?? false;
    }
  ), [contextRecordIdsByInteraction, selectedInteractionId]);

  const visibleAssertions = useMemo(() => {
    if (!livingContext) return [];
    return livingContext.assertions.filter((assertion) => {
      if (selectedInteractionId !== 'all' && assertion.interactionId !== selectedInteractionId) {
        return false;
      }
      return includesQuery([
        assertion.predicate,
        assertion.narrative,
        ...assertion.concepts.flatMap((concept) => [
          concept.label,
          concept.canonicalKey,
          concept.relationship,
        ]),
        ...assertion.sources.map((source) => source.exactText),
      ], normalizedSearch);
    });
  }, [livingContext, normalizedSearch, selectedInteractionId]);

  const visibleSignals = useMemo(() => {
    if (!livingContext) return [];
    return livingContext.signals.filter((signal) => {
      if (selectedInteractionId !== 'all') {
        const interactionEvidence = signal.evidence.some(
          (evidence) => evidence.interactionId === selectedInteractionId,
        );
        if (!interactionEvidence) return false;
      }
      return includesQuery([
        signal.label,
        signal.signalKey,
        signal.namespace,
        ...signal.evidence.flatMap((evidence) => [
          evidence.evidenceLevel,
          evidence.assertionNarrative,
          evidence.assertionPredicate,
          ...evidence.sources.map((source) => source.exactText),
        ]),
      ], normalizedSearch);
    });
  }, [isRecordVisibleForInteraction, livingContext, normalizedSearch]);

  const visibleArtifacts = useMemo(() => {
    if (!livingContext) return [];
    return livingContext.artifacts.filter((artifact) => {
      if (selectedInteractionId !== 'all' && artifact.interactionId !== selectedInteractionId) {
        return false;
      }
      return includesQuery([
        artifact.artifactType,
        artifact.logicalKey,
        ...artifact.sourceSpans.map((source) => source.exactText),
      ], normalizedSearch);
    });
  }, [livingContext, normalizedSearch, selectedInteractionId]);

  const visibleContextRecords = useMemo(() => {
    if (!livingContext) return [];
    return livingContext.contextRecords.filter((record) => {
      if (!isRecordVisibleForInteraction(record)) {
        return false;
      }
      return includesQuery([
        record.predicate,
        record.narrative,
        record.recordType,
        ...record.entities.flatMap((entity) => [
          entity.entityType,
          entity.relationship,
          entityValueLabel(entity.value),
        ]),
        ...record.concepts.flatMap((concept) => [
          concept.label,
          concept.canonicalKey,
          concept.namespace,
          concept.relationship,
        ]),
        ...record.sources.flatMap((source) => [
          source.exactText ?? null,
          source.sourceRefType,
          source.sourceRefId,
        ]),
      ], normalizedSearch);
    });
  }, [livingContext, normalizedSearch, selectedInteractionId]);

  const relationshipsByAssertion = useMemo(() => {
    const index = new Map<string, string[]>();
    for (const relationship of livingContext?.relationships ?? []) {
      const ids = [
        relationship.sourceAssertionId,
        relationship.fromEntityType === 'assertion' ? relationship.fromEntityId : null,
        relationship.toEntityType === 'assertion' ? relationship.toEntityId : null,
      ].filter((value): value is string => Boolean(value));
      for (const id of ids) {
        const predicates = index.get(id) ?? [];
        if (!predicates.includes(relationship.predicate)) predicates.push(relationship.predicate);
        index.set(id, predicates);
      }
    }
    return index;
  }, [livingContext]);

  if (isLoading && !livingContext) {
    return <div className="living-context__loading">Loading source-backed context...</div>;
  }
  if (error || !livingContext) {
    return (
      <div className="living-context__empty">
        {error?.message ?? 'Living context is unavailable.'}
      </div>
    );
  }

  const reviewMatch = standaloneReviewMatch ?? null;
  const livingEvidencePresent = hasLivingEvidence(livingContext);

  if (!livingEvidencePresent) {
    return (
      <div className="living-context living-context--quiet" data-testid="living-context-quiet">
        <StandaloneReviewMatchPanel match={reviewMatch} />
        <div className="living-context__empty" data-testid="living-context-empty">
          No source-backed living evidence yet for this person.
        </div>
      </div>
    );
  }

  const summaryMetrics = [
    ['Interactions', livingContext.summary.interactionCount],
    ['Context records', livingContext.summary.contextRecordCount],
    ['Artifacts', livingContext.summary.artifactCount],
    ['Source spans', livingContext.summary.sourceSpanCount],
    ['Evidence claims', livingContext.summary.assertionCount],
    ['Signals', livingContext.summary.signalCount],
  ] as const;
  const hasSummaryContent = summaryMetrics.some(([, value]) => value > 0);
  const hasGraphContent = livingContext.interactions.length > 0
    || livingContext.contextRecords.length > 0
    || livingContext.assertions.length > 0
    || livingContext.signals.length > 0
    || livingContext.artifacts.length > 0;

  return (
    <div className="living-context" data-testid="living-context-graph">
      <div className="living-context__toolbar">
        <div className="living-context__search">
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search evidence, concepts, and source text..."
            aria-label="Search living context"
          />
        </div>
        <button
          type="button"
          className="living-context__refresh"
          onClick={() => void refetch()}
          disabled={isLoading}
          title="Refresh living context"
          aria-label="Refresh living context"
        >
          <RefreshCw size={14} className={isLoading ? 'spin' : undefined} />
        </button>
      </div>

      <StandaloneReviewMatchPanel match={reviewMatch} />

      {hasSummaryContent && (
        <div className="living-context__summary" data-testid="living-context-summary">
          {summaryMetrics.map(([label, value]) => (
            <div key={label} className="living-context__metric">
              <div className="living-context__metric-value">{value}</div>
              <div className="living-context__metric-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      <MeetingEvidencePanel
        livingContext={livingContext}
        onSelectSource={setSelectedSource}
      />

      {hasGraphContent ? (
      <div className="living-context__workspace">
        <aside className="living-context__rail">
          <div className="living-context__person">
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              <UserRound size={14} color="var(--lc-structural)" />
              <div style={{ minWidth: 0 }}>
                <div className="living-context__person-name">
                  {livingContext.person?.displayName ?? livingContext.person?.primaryEmail ?? 'Person'}
                </div>
                <div className="living-context__person-meta">
                  {livingContext.person?.roles.map((role) => role.roleType).join(' · ') || 'person'}
                </div>
              </div>
            </div>
          </div>

          <div className="living-context__section-head">
            <div className="living-context__section-title">Interactions</div>
            <div className="living-context__count">{livingContext.interactions.length}</div>
          </div>
          <div className="living-context__interactions">
            <button
              type="button"
              className={`living-context__interaction ${selectedInteractionId === 'all' ? 'living-context__interaction--active' : ''}`}
              onClick={() => setSelectedInteractionId('all')}
            >
              <div className="living-context__interaction-title">All context</div>
              <div className="living-context__interaction-meta">
                <span>{livingContext.summary.assertionCount} claims</span>
                <span>{livingContext.summary.signalCount} signals</span>
              </div>
            </button>
            {livingContext.interactions.map((interaction) => (
              <button
                key={interaction.id}
                type="button"
                className={`living-context__interaction ${selectedInteractionId === interaction.id ? 'living-context__interaction--active' : ''}`}
                onClick={() => setSelectedInteractionId(interaction.id)}
              >
                <div className="living-context__interaction-title">
                  {titleCase(interaction.interactionType)}
                </div>
                <div className="living-context__interaction-meta">
                  <span>{interactionDate(interaction)}</span>
                  <span>{interaction.assertionIds.length} claims</span>
                  <span>{interaction.signalKeys.length} signals</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="living-context__canvas">
          <div className="living-context__section-head">
            <div>
              <div className="living-context__section-title">
                {selectedInteraction ? titleCase(selectedInteraction.interactionType) : 'Accumulated context'}
              </div>
              <div className="living-context__eyebrow">
                {selectedInteraction ? interactionDate(selectedInteraction) : 'Across every interaction'}
              </div>
            </div>
            <Network size={15} color="var(--pipe-text-dim)" />
          </div>

          <div className="living-context__section-head" style={{ marginTop: 20 }}>
            <div className="living-context__section-title">Context records</div>
            <div className="living-context__count">{visibleContextRecords.length}</div>
          </div>
          <ContextRecordForest
            records={visibleContextRecords}
            onSelectSource={setSelectedSource}
          />

          {visibleSignals.length > 0 && (
            <>
              <div className="living-context__section-head" style={{ marginTop: 22 }}>
                <div className="living-context__section-title">Signals</div>
                <div className="living-context__count">{visibleSignals.length}</div>
              </div>
              <div className="living-context__signal-grid">
                {visibleSignals.map((signal) => (
                  <SignalNode
                    key={signal.signalKey}
                    signal={signal}
                    onSelectSource={setSelectedSource}
                  />
                ))}
              </div>
            </>
          )}

          {visibleAssertions.length > 0 && (
            <>
              <div className="living-context__section-head" style={{ marginTop: 22 }}>
                <div className="living-context__section-title">Evidence claims</div>
                <div className="living-context__count">{visibleAssertions.length}</div>
              </div>
              <div className="living-context__assertions">
                {visibleAssertions.map((assertion) => (
                  <AssertionNode
                    key={assertion.id}
                    assertion={assertion}
                    relatedPredicates={relationshipsByAssertion.get(assertion.id) ?? []}
                    onSelectSource={setSelectedSource}
                  />
                ))}
              </div>
            </>
          )}

          {visibleArtifacts.length > 0 && (
            <div className="living-context__artifacts">
              <div className="living-context__section-head">
                <div className="living-context__section-title">Source artifacts</div>
                <div className="living-context__count">{visibleArtifacts.length}</div>
              </div>
              {visibleArtifacts.map((artifact) => (
                <ArtifactNode
                  key={artifact.id}
                  artifact={artifact}
                  onSelectSource={setSelectedSource}
                />
              ))}
            </div>
          )}
        </main>

        <aside className="living-context__inspector">
          <div className="living-context__section-head">
            <div className="living-context__section-title">Source evidence</div>
            <FileText size={14} color="var(--lc-source)" />
          </div>
          {selectedSource ? (
            <>
              <div className="living-context__eyebrow">
                {titleCase(selectedSource.artifactType)}
              </div>
              <blockquote className="living-context__quote">
                {selectedSource.exactText}
              </blockquote>
              <dl className="living-context__locator">
                <dt>Locator</dt>
                <dd>{locatorLabel(selectedSource)}</dd>
                <dt>Segment</dt>
                <dd>{selectedSource.stableSegmentId ?? '—'}</dd>
                <dt>Version</dt>
                <dd>{selectedSource.artifactVersionNumber}</dd>
                <dt>Evidence role</dt>
                <dd>{selectedSource.evidenceRole ?? 'source'}</dd>
                <dt>Media</dt>
                <dd>{selectedSource.mediaType}</dd>
                <dt>Span ID</dt>
                <dd>{selectedSource.sourceSpanId}</dd>
              </dl>
            </>
          ) : (
            <div className="living-context__empty">Select source evidence to inspect the original text.</div>
          )}
          {selectedInteraction && (
            <div style={{ marginTop: 24 }}>
              <div className="living-context__section-head">
                <div className="living-context__section-title">Interaction branch</div>
                <Activity size={13} color="var(--pipe-text-dim)" />
              </div>
              <dl className="living-context__locator">
                <dt>Type</dt>
                <dd>{selectedInteraction.interactionType}</dd>
                <dt>Reference</dt>
                <dd>{selectedInteraction.externalReference ?? '—'}</dd>
                <dt>Artifacts</dt>
                <dd>{selectedInteraction.artifactIds.length}</dd>
                <dt>Evidence claims</dt>
                <dd>{selectedInteraction.assertionIds.length}</dd>
                <dt>Signals</dt>
                <dd>{selectedInteraction.signalKeys.length}</dd>
              </dl>
            </div>
          )}
        </aside>
      </div>
      ) : (
        <div className="living-context__quiet-empty" data-testid="living-context-quiet-empty">
          No living context evidence yet. Source-backed context will appear here after resumes, meetings, or assessments are ingested.
        </div>
      )}
    </div>
  );
}
