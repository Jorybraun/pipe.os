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
  LivingContextSignal,
  LivingContextSourceRef,
  StandaloneReviewExcludedPacket,
  StandaloneReviewEvaluatedChallenge,
  StandaloneReviewMatchRecord,
  StandaloneReviewSourceRef,
} from '../../lib/api/types';
import { useLivingContext } from '../../hooks/useLivingContext';
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

function isMeetingEvidenceInteraction(
  interaction: LivingContextInteraction,
  artifacts: LivingContextArtifact[],
): boolean {
  const interactionType = interaction.interactionType.toLowerCase();
  return interactionType.includes('meeting')
    || artifacts.some((artifact) => artifact.artifactType.toLowerCase() === 'meeting_transcript');
}

function matchStatusLabel(status: StandaloneReviewMatchRecord['matchStatus']): string {
  return status.replace(/_/g, ' ');
}

function reviewExclusionReasonLabel(reason: StandaloneReviewExcludedPacket['reason']): string {
  if (reason === 'DEMAND_WITHOUT_SOURCE_SPANS') return 'Demand lacks source spans';
  if (reason === 'MISSING_DEMAND_SOURCE_SPANS') return 'Missing repo source spans';
  if (reason === 'PACKET_NOT_PRODUCTION_READY') return 'Packet not production-ready';
  return 'Job-description guardrail';
}

function reviewExclusionDetail(packet: StandaloneReviewExcludedPacket): string {
  const details = [
    packet.repoId ? `repo ${packet.repoId}` : null,
    packet.prNumber !== null ? `PR #${packet.prNumber}` : null,
    packet.demandIds.length ? `demands ${packet.demandIds.join(', ')}` : null,
    packet.missingSourceSpanIds.length ? `missing spans ${packet.missingSourceSpanIds.join(', ')}` : null,
    packet.gateFailures.length ? `failed gates ${packet.gateFailures.join(', ')}` : null,
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
          <div className="living-context__section-title">Standalone CODE_REVIEW match</div>
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

function MeetingEvidencePanel({
  livingContext,
  onSelectSource,
}: {
  livingContext: LivingContextReadModel;
  onSelectSource: (source: LivingContextSourceRef) => void;
}): JSX.Element | null {
  const branches = livingContext.interactions
    .map((interaction) => {
      const artifacts = livingContext.artifacts.filter(
        (artifact) => artifact.interactionId === interaction.id,
      );
      const assertions = livingContext.assertions.filter(
        (assertion) => assertion.interactionId === interaction.id,
      );
      const contextRecords = livingContext.contextRecords.filter(
        (record) => record.interactionId === interaction.id,
      );
      const sourceSpans = artifacts.flatMap((artifact) => artifact.sourceSpans);
      const signalLabels = livingContext.signals
        .filter((signal) => signal.evidence.some((evidence) => evidence.interactionId === interaction.id))
        .map((signal) => signal.label);

      return {
        interaction,
        artifacts,
        assertions,
        contextRecords,
        sourceSpans,
        signalLabels,
      };
    })
    .filter((branch) => isMeetingEvidenceInteraction(branch.interaction, branch.artifacts));

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
        {branches.map((branch) => (
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
                <span>{countLabel(branch.assertions.length, 'assertion')}</span>
              </div>
            </div>

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

            {branch.signalLabels.length > 0 && (
              <div className="living-context__concepts">
                {branch.signalLabels.slice(0, 4).map((label) => (
                  <span key={`${branch.interaction.id}:${label}`} className="living-context__concept">
                    {label}
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
    setSelectedInteractionId(livingContext.interactions[0]?.id ?? 'all');
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
  }, [livingContext, normalizedSearch, selectedInteractionId]);

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
      if (selectedInteractionId !== 'all' && record.interactionId !== selectedInteractionId) {
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
        ...record.sources.map((source) => source.exactText),
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
    return <div className="living-context__loading">LOADING_CONTEXT_GRAPH</div>;
  }
  if (error || !livingContext) {
    return (
      <div className="living-context__empty">
        {error?.message ?? 'Living context is unavailable.'}
      </div>
    );
  }

  const summaryMetrics = [
    ['Interactions', livingContext.summary.interactionCount],
    ['Context records', livingContext.summary.contextRecordCount],
    ['Artifacts', livingContext.summary.artifactCount],
    ['Source spans', livingContext.summary.sourceSpanCount],
    ['Assertions', livingContext.summary.assertionCount],
    ['Signals', livingContext.summary.signalCount],
  ] as const;

  return (
    <div className="living-context" data-testid="living-context-graph">
      <div className="living-context__toolbar">
        <div className="living-context__search">
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="SEARCH EVIDENCE, CONCEPTS, ASSERTIONS..."
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

      <StandaloneReviewMatchPanel match={standaloneReviewMatch ?? null} />

      <div className="living-context__summary">
        {summaryMetrics.map(([label, value]) => (
          <div key={label} className="living-context__metric">
            <div className="living-context__metric-value">{value}</div>
            <div className="living-context__metric-label">{label}</div>
          </div>
        ))}
      </div>

      <MeetingEvidencePanel
        livingContext={livingContext}
        onSelectSource={setSelectedSource}
      />

      <div className="living-context__workspace">
        <aside className="living-context__rail">
          <div className="living-context__person">
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              <UserRound size={14} color="var(--lc-structural)" />
              <div style={{ minWidth: 0 }}>
                <div className="living-context__person-name">
                  {livingContext.person.displayName ?? livingContext.person.primaryEmail ?? 'Person'}
                </div>
                <div className="living-context__person-meta">
                  {livingContext.person.roles.map((role) => role.roleType).join(' · ') || 'person'}
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
                <span>{livingContext.summary.assertionCount} assertions</span>
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
                  <span>{interaction.assertionIds.length} assertions</span>
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

          <div className="living-context__section-head" style={{ marginTop: 22 }}>
            <div className="living-context__section-title">Signals</div>
            <div className="living-context__count">{visibleSignals.length}</div>
          </div>
          {visibleSignals.length > 0 ? (
            <div className="living-context__signal-grid">
              {visibleSignals.map((signal) => (
                <SignalNode
                  key={signal.signalKey}
                  signal={signal}
                  onSelectSource={setSelectedSource}
                />
              ))}
            </div>
          ) : (
            <div className="living-context__empty">NO_SIGNAL_EVIDENCE</div>
          )}

          <div className="living-context__section-head" style={{ marginTop: 22 }}>
            <div className="living-context__section-title">Assertions</div>
            <div className="living-context__count">{visibleAssertions.length}</div>
          </div>
          {visibleAssertions.length > 0 ? (
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
          ) : (
            <div className="living-context__empty">NO_SOURCE_BACKED_ASSERTIONS</div>
          )}

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
            <div className="living-context__empty">NO_SOURCE_SELECTED</div>
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
                <dt>Assertions</dt>
                <dd>{selectedInteraction.assertionIds.length}</dd>
                <dt>Signals</dt>
                <dd>{selectedInteraction.signalKeys.length}</dd>
              </dl>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
