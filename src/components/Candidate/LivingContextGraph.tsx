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
  LivingContextSignal,
  LivingContextSourceRef,
  StandaloneReviewMatchRecord,
  StandaloneReviewSourceRef,
} from '../../lib/api/types';
import { useLivingContext } from '../../hooks/useLivingContext';
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

function interactionDate(interaction: LivingContextInteraction): string {
  return formatDate(interaction.startedAt ?? interaction.createdAt);
}

function reviewSourceLabel(source: StandaloneReviewSourceRef): string {
  return source.locator
    ?? `${source.artifactId.slice(0, 10)}:${source.startOffset}-${source.endOffset}`;
}

function matchStatusLabel(status: StandaloneReviewMatchRecord['matchStatus']): string {
  return status.replace(/_/g, ' ');
}

function StandaloneReviewMatchPanel({
  match,
}: {
  match: StandaloneReviewMatchRecord | null;
}): JSX.Element | null {
  if (!match) return null;
  const primaryEvidence = match.evidence.slice(0, 3);
  return (
    <section className="living-context__review-match" aria-label="Standalone code review match">
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
          {match.submitted && <span>Review submitted</span>}
        </div>
      )}

      {primaryEvidence.length > 0 && (
        <div className="living-context__review-evidence">
          {primaryEvidence.map((entry) => (
            <div key={`${entry.atomId}:${entry.demandId}`} className="living-context__review-evidence-row">
              <div className="living-context__review-evidence-score">
                {Math.round(entry.pairScore * 100)}%
              </div>
              <div>
                <div className="living-context__review-evidence-title">
                  {entry.atomId} → {entry.demandId}
                </div>
                <div className="living-context__review-evidence-sources">
                  <span>candidate: {entry.candidateSourceRefs.map(reviewSourceLabel).join(', ') || 'source missing'}</span>
                  <span>PR: {entry.challengeSourceRefs.map(reviewSourceLabel).join(', ') || 'source missing'}</span>
                </div>
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
          ))}
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

export function LivingContextGraph({
  candidateId,
  standaloneReviewMatch,
}: {
  candidateId: string;
  standaloneReviewMatch?: StandaloneReviewMatchRecord | null;
}): JSX.Element {
  const { livingContext, isLoading, error, refetch } = useLivingContext(candidateId);
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
    ['Artifacts', livingContext.summary.artifactCount],
    ['Source spans', livingContext.summary.sourceSpanCount],
    ['Assertions', livingContext.summary.assertionCount],
    ['Signals', livingContext.summary.signalCount],
  ] as const;

  return (
    <div className="living-context">
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
