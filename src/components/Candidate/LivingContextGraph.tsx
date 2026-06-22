import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Code,
  ExternalLink,
  FileText,
  GitPullRequest,
  MessageSquare,
  Mic,
  Network,
  Quote,
  RefreshCw,
  Search,
  UserRound,
  Video,
} from 'lucide-react';
import type {
  LivingContextArtifact,
  LivingContextAssertion,
  LivingContextInteraction,
  LivingContextSignal,
  LivingContextSourceRef,
  SourceContentSearchResult,
  StandaloneReviewMatchRecord,
  StandaloneReviewSourceRef,
  StandaloneReviewUnmatchedDemand,
  StandaloneReviewStretchArea,
} from '../../lib/api/types';
import { useLivingContext } from '../../hooks/useLivingContext';
import { useRepoOverlay } from '../../hooks/useRepoOverlay';
import { useSourceSearch } from '../../hooks/useSourceSearch';
import type { RepoOverlayFile } from '../../hooks/useRepoOverlay';
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

function interactionDuration(interaction: LivingContextInteraction): string | null {
  if (!interaction.startedAt || !interaction.endedAt) return null;
  const start = new Date(interaction.startedAt).getTime();
  const end = new Date(interaction.endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const minutes = Math.round((end - start) / 60000);
  if (minutes <= 0) return null;
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function InteractionIcon({ type }: { type: string }): JSX.Element {
  const normalized = type.toLowerCase();
  if (normalized.includes('meeting') || normalized.includes('video')) {
    return <Video size={11} color="var(--lc-structural)" />;
  }
  if (normalized.includes('interview') || normalized.includes('call')) {
    return <Mic size={11} color="var(--lc-structural)" />;
  }
  if (normalized.includes('message') || normalized.includes('email')) {
    return <MessageSquare size={11} color="var(--lc-structural)" />;
  }
  if (normalized.includes('code') || normalized.includes('review')) {
    return <Code size={11} color="var(--lc-structural)" />;
  }
  return <Activity size={11} color="var(--lc-structural)" />;
}

function reviewSourceLabel(source: StandaloneReviewSourceRef): string {
  return source.locator
    ?? `${source.artifactId.slice(0, 10)}:${source.startOffset}-${source.endOffset}`;
}

function reviewSourceSnippet(sources: StandaloneReviewSourceRef[]): string | null {
  return sources
    .map((source) => source.exactText?.trim())
    .find((text): text is string => Boolean(text)) ?? null;
}

function matchStatusLabel(status: StandaloneReviewMatchRecord['matchStatus']): string {
  return status.replace(/_/g, ' ');
}

function UnmatchedDemandsPanel({
  demands,
}: {
  demands: StandaloneReviewUnmatchedDemand[];
}): JSX.Element {
  return (
    <div className="living-context__unmatched-demands">
      <div className="living-context__eyebrow">
        Unmatched demands ({demands.length})
      </div>
      <div className="living-context__demand-list">
        {demands.map((demand) => (
          <div key={demand.demandId} className="living-context__demand-item">
            <div className="living-context__demand-head">
              <span className="living-context__demand-family">{demand.family}</span>
              <span className="living-context__demand-weight">
                {Math.round(demand.weight * 100)}% weight
              </span>
              {demand.roleRequirement && (
                <span className="living-context__demand-badge">role req</span>
              )}
            </div>
            <div className="living-context__demand-narrative">{demand.narrative}</div>
            {demand.concepts.length > 0 && (
              <div className="living-context__concepts">
                {demand.concepts.slice(0, 4).map((concept) => (
                  <span key={`${demand.demandId}:${concept}`} className="living-context__concept">
                    {concept}
                  </span>
                ))}
              </div>
            )}
            {demand.challengeSourceRefs.length > 0 && (
              <div className="living-context__demand-source">
                {demand.challengeSourceRefs.slice(0, 2).map((ref, index) => (
                  <span key={`${demand.demandId}:source:${index}`} className="living-context__demand-ref">
                    {ref.locator ?? `${ref.artifactId.slice(0, 8)}:${ref.startOffset}-${ref.endOffset}`}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StretchAreasPanel({
  areas,
}: {
  areas: StandaloneReviewStretchArea[];
}): JSX.Element {
  return (
    <div className="living-context__stretch-areas">
      <div className="living-context__eyebrow">
        Stretch areas ({areas.length})
      </div>
      <div className="living-context__stretch-list">
        {areas.map((area, index) => (
          <div key={`${area.atomId}:${area.demandId}:${index}`} className="living-context__stretch-item">
            <div className="living-context__stretch-head">
              <span className="living-context__stretch-dimension">{area.dimension}</span>
              <span className="living-context__stretch-concepts">
                {area.atomConcept} → {area.demandConcept}
              </span>
            </div>
            <div className="living-context__stretch-narratives">
              <div className="living-context__stretch-narrative">
                <span className="living-context__stretch-label">Candidate</span>
                <span>{area.candidateNarrative}</span>
              </div>
              <div className="living-context__stretch-narrative">
                <span className="living-context__stretch-label">Demand</span>
                <span>{area.demandNarrative}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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

      {match.submission && (
        <div className="living-context__review-submission">
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
        <div className="living-context__review-evidence">
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
                    <span>candidate: {entry.candidateSourceRefs.map(reviewSourceLabel).join(', ') || 'source missing'}</span>
                    <span>PR: {entry.challengeSourceRefs.map(reviewSourceLabel).join(', ') || 'source missing'}</span>
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

      {match.unmatchedDemands && match.unmatchedDemands.length > 0 && (
        <UnmatchedDemandsPanel demands={match.unmatchedDemands} />
      )}

      {match.stretchAreas && match.stretchAreas.length > 0 && (
        <StretchAreasPanel areas={match.stretchAreas} />
      )}
    </section>
  );
}

interface MatchedSpanEntry {
  atomId: string;
  demandId: string;
  pairScore: number;
  exactText: string;
  startOffset: number;
  endOffset: number;
  sharedConcepts: string[];
}

function buildMatchedFileMap(
  match: StandaloneReviewMatchRecord,
): Map<string, MatchedSpanEntry[]> {
  const fileMap = new Map<string, MatchedSpanEntry[]>();
  for (const entry of match.evidence) {
    for (const ref of entry.challengeSourceRefs) {
      const filePath = ref.locator?.split(':')[0] ?? ref.artifactId;
      const existing = fileMap.get(filePath) ?? [];
      existing.push({
        atomId: entry.atomId,
        demandId: entry.demandId,
        pairScore: entry.pairScore,
        exactText: ref.exactText ?? '',
        startOffset: ref.startOffset,
        endOffset: ref.endOffset,
        sharedConcepts: entry.sharedConcepts,
      });
      fileMap.set(filePath, existing);
    }
  }
  return fileMap;
}

function RepoFileTreeNode({
  file,
  matchedSpans,
}: {
  file: RepoOverlayFile;
  matchedSpans: MatchedSpanEntry[];
}): JSX.Element {
  const [expanded, setExpanded] = useState(matchedSpans.length > 0);
  const hasMatches = matchedSpans.length > 0;
  const hasDemands = file.spans.some((span) => span.demandIds.length > 0);

  return (
    <div className={`living-context__repo-file${hasMatches ? ' living-context__repo-file--matched' : ''}`}>
      <button
        type="button"
        className="living-context__repo-file-path"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <FileText size={11} />
        <span>{file.path}</span>
        {hasMatches && (
          <span className="living-context__count living-context__count--matched">
            {matchedSpans.length} matched
          </span>
        )}
        {!hasMatches && hasDemands && (
          <span className="living-context__count living-context__count--demand">
            {file.spans.filter((s) => s.demandIds.length > 0).length} demands
          </span>
        )}
        {file.symbols.length > 0 && (
          <span className="living-context__count">
            {file.symbols.length} symbol{file.symbols.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="living-context__file-size">
          {file.byteLength > 1024
            ? `${(file.byteLength / 1024).toFixed(1)}KB`
            : `${file.byteLength}B`}
        </span>
      </button>
      {expanded && matchedSpans.length > 0 && (
        <div className="living-context__repo-file-spans">
          {matchedSpans.map((span, index) => (
            <div
              key={`${file.path}:${span.startOffset}:${span.demandId}:${index}`}
              className="living-context__repo-span"
            >
              <div className="living-context__repo-span-head">
                <span className="living-context__repo-span-score">
                  {Math.round(span.pairScore * 100)}%
                </span>
                <span>{span.demandId}</span>
                <span>bytes {span.startOffset}-{span.endOffset}</span>
              </div>
              {span.exactText && (
                <blockquote className="living-context__repo-span-text">
                  {span.exactText.length > 120
                    ? `${span.exactText.slice(0, 120)}...`
                    : span.exactText}
                </blockquote>
              )}
              {span.sharedConcepts.length > 0 && (
                <div className="living-context__concepts">
                  {span.sharedConcepts.slice(0, 3).map((concept) => (
                    <span key={`${file.path}:${span.demandId}:${concept}`} className="living-context__concept">
                      {concept}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {expanded && matchedSpans.length === 0 && file.symbols.length > 0 && (
        <div className="living-context__repo-file-symbols">
          {file.symbols.slice(0, 5).map((symbol) => (
            <div key={symbol.id} className="living-context__repo-symbol">
              <Code size={10} />
              <span className="living-context__repo-symbol-name">{symbol.qualifiedName}</span>
              <span className="living-context__repo-symbol-kind">{symbol.kind}</span>
            </div>
          ))}
          {file.symbols.length > 5 && (
            <div className="living-context__repo-symbol-overflow">
              +{file.symbols.length - 5} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RepoOverlayPanel({
  match,
}: {
  match: StandaloneReviewMatchRecord | null;
}): JSX.Element | null {
  const [showFullTree, setShowFullTree] = useState(false);
  const { overlay, isLoading: overlayLoading } = useRepoOverlay(
    match?.repoId ?? null,
  );

  const matchedFileMap = useMemo(
    () => (match ? buildMatchedFileMap(match) : new Map<string, MatchedSpanEntry[]>()),
    [match],
  );

  const toggleFullTree = useCallback(() => {
    setShowFullTree((prev) => !prev);
  }, []);

  if (!match || match.evidence.length === 0) return null;
  if (matchedFileMap.size === 0) return null;

  const overlayFiles = overlay?.files ?? [];
  const matchedPaths = new Set(matchedFileMap.keys());
  const unmatchedFiles = overlayFiles.filter((f) => !matchedPaths.has(f.path));

  return (
    <section className="living-context__repo-overlay" aria-label="Repository structure overlay">
      <div className="living-context__section-head">
        <div className="living-context__section-title">Repository overlay</div>
        <GitPullRequest size={14} color="var(--lc-structural)" />
      </div>
      <div className="living-context__eyebrow">
        {match.repoName ?? 'repository'} PR #{match.prNumber}
        {' · '}{matchedFileMap.size} file{matchedFileMap.size === 1 ? '' : 's'} matched
        {overlay && ` · ${overlay.fileCount} total · ${overlay.symbolCount} symbols`}
      </div>

      <div className="living-context__repo-files">
        {overlay ? (
          <>
            {overlayFiles
              .filter((f) => matchedPaths.has(f.path))
              .map((file) => (
                <RepoFileTreeNode
                  key={file.path}
                  file={file}
                  matchedSpans={matchedFileMap.get(file.path) ?? []}
                />
              ))}

            {unmatchedFiles.length > 0 && (
              <>
                <button
                  type="button"
                  className="living-context__repo-tree-toggle"
                  onClick={toggleFullTree}
                  aria-expanded={showFullTree}
                >
                  {showFullTree
                    ? `Hide ${unmatchedFiles.length} unmatched files`
                    : `Show ${unmatchedFiles.length} unmatched files`}
                </button>
                {showFullTree && unmatchedFiles.map((file) => (
                  <RepoFileTreeNode
                    key={file.path}
                    file={file}
                    matchedSpans={[]}
                  />
                ))}
              </>
            )}
          </>
        ) : (
          [...matchedFileMap.entries()].map(([filePath, spans]) => (
            <div key={filePath} className="living-context__repo-file living-context__repo-file--matched">
              <div className="living-context__repo-file-path">
                <FileText size={11} />
                <span>{filePath}</span>
                <span className="living-context__count">{spans.length}</span>
              </div>
              <div className="living-context__repo-file-spans">
                {spans.map((span, index) => (
                  <div
                    key={`${filePath}:${span.startOffset}:${span.demandId}:${index}`}
                    className="living-context__repo-span"
                  >
                    <div className="living-context__repo-span-head">
                      <span className="living-context__repo-span-score">
                        {Math.round(span.pairScore * 100)}%
                      </span>
                      <span>{span.demandId}</span>
                      <span>bytes {span.startOffset}-{span.endOffset}</span>
                    </div>
                    {span.exactText && (
                      <blockquote className="living-context__repo-span-text">
                        {span.exactText.length > 120
                          ? `${span.exactText.slice(0, 120)}...`
                          : span.exactText}
                      </blockquote>
                    )}
                    {span.sharedConcepts.length > 0 && (
                      <div className="living-context__concepts">
                        {span.sharedConcepts.slice(0, 3).map((concept) => (
                          <span key={`${filePath}:${span.demandId}:${concept}`} className="living-context__concept">
                            {concept}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {overlayLoading && (
        <div className="living-context__repo-loading">Loading full repository context...</div>
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

function sourceSearchLocator(result: SourceContentSearchResult): string {
  if (result.lineStart !== null && result.lineEnd !== null) {
    return result.lineStart === result.lineEnd
      ? `line ${result.lineStart}`
      : `lines ${result.lineStart}-${result.lineEnd}`;
  }
  if (result.timestampStartMs !== null && result.timestampEndMs !== null) {
    return `${(result.timestampStartMs / 1000).toFixed(1)}s-${(result.timestampEndMs / 1000).toFixed(1)}s`;
  }
  if (result.charStart !== null && result.charEnd !== null) {
    return `chars ${result.charStart}-${result.charEnd}`;
  }
  return result.sourceSpanId.slice(0, 8);
}

function highlightMatch(text: string, query: string): JSX.Element {
  if (!query || query.length < 2) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="living-context__highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function SourceSearchResults({
  results,
  isSearching,
  searchError,
  query,
}: {
  results: SourceContentSearchResult[];
  isSearching: boolean;
  searchError: Error | null;
  query: string;
}): JSX.Element | null {
  if (!query || query.trim().length < 2) return null;

  return (
    <div className="living-context__source-search">
      <div className="living-context__section-head">
        <div className="living-context__section-title">Source content search</div>
        <div className="living-context__count">
          {isSearching ? '...' : results.length}
        </div>
      </div>
      {searchError && (
        <div className="living-context__search-error">{searchError.message}</div>
      )}
      {!isSearching && results.length === 0 && !searchError && (
        <div className="living-context__empty">NO_SOURCE_MATCHES</div>
      )}
      {results.length > 0 && (
        <div className="living-context__search-results">
          {results.map((result) => (
            <div key={`${result.assertionId}:${result.sourceSpanId}`} className="living-context__search-hit">
              <div className="living-context__search-hit-head">
                <span className="living-context__search-hit-predicate">{result.predicate}</span>
                <span className="living-context__search-hit-type">{result.artifactType}</span>
                {result.confidence !== null && (
                  <span className="living-context__search-hit-conf">
                    {Math.round(result.confidence * 100)}%
                  </span>
                )}
              </div>
              <div className="living-context__search-hit-narrative">
                {highlightMatch(result.narrative, query)}
              </div>
              <blockquote className="living-context__search-hit-quote">
                {highlightMatch(result.exactText, query)}
              </blockquote>
              <div className="living-context__search-hit-meta">
                <span className="living-context__search-hit-locator">
                  {sourceSearchLocator(result)}
                </span>
                {result.artifactLogicalKey && (
                  <span className="living-context__search-hit-key">
                    {result.artifactLogicalKey}
                  </span>
                )}
              </div>
              {result.concepts.length > 0 && (
                <div className="living-context__concepts">
                  {result.concepts.slice(0, 5).map((concept) => (
                    <span key={`${result.assertionId}:${concept}`} className="living-context__concept">
                      {concept}
                    </span>
                  ))}
                </div>
              )}
            </div>
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
  const { results: sourceSearchResults, isSearching, searchError, search: serverSearch, clear: clearSearch } = useSourceSearch(candidateId);
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<LivingContextSourceRef | null>(null);
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLowerCase();

  const handleSearchChange = useCallback((value: string): void => {
    setSearch(value);
    if (value.trim().length >= 2) {
      void serverSearch(value);
    } else {
      clearSearch();
    }
  }, [serverSearch, clearSearch]);

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
    ['Concepts', livingContext.summary.conceptCount],
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
            onChange={(event) => handleSearchChange(event.target.value)}
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

      <SourceSearchResults
        results={sourceSearchResults}
        isSearching={isSearching}
        searchError={searchError}
        query={search}
      />

      <StandaloneReviewMatchPanel match={standaloneReviewMatch ?? null} />
      <RepoOverlayPanel match={standaloneReviewMatch ?? null} />

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
          {Object.keys(livingContext.summary.interactionTypeBreakdown).length > 1 && (
            <div className="living-context__type-breakdown">
              {Object.entries(livingContext.summary.interactionTypeBreakdown).map(([type, count]) => (
                <span key={type} className="living-context__type-badge">
                  <InteractionIcon type={type} />
                  {count}
                </span>
              ))}
            </div>
          )}
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
                <div className="living-context__interaction-header">
                  <InteractionIcon type={interaction.interactionType} />
                  <div className="living-context__interaction-title">
                    {titleCase(interaction.interactionType)}
                  </div>
                </div>
                <div className="living-context__interaction-meta">
                  <span>{interactionDate(interaction)}</span>
                  <span>{interaction.assertionIds.length} assertions</span>
                  <span>{interaction.signalKeys.length} signals</span>
                  {interaction.conceptCount > 0 && (
                    <span>{interaction.conceptCount} concepts</span>
                  )}
                </div>
                {interaction.artifactIds.length > 0 && (
                  <div className="living-context__interaction-artifacts">
                    <span>{interaction.artifactIds.length} artifact{interaction.artifactIds.length === 1 ? '' : 's'}</span>
                  </div>
                )}
                {interactionDuration(interaction) && (
                  <div className="living-context__interaction-duration">
                    {interactionDuration(interaction)}
                  </div>
                )}
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
