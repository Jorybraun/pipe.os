import { useCallback, useEffect, useMemo, useState } from 'react';
import { Network, Quote, RefreshCcw } from 'lucide-react';
import { ContextRecordForest } from '../Candidate/ContextRecordTree';
import { useApiClient } from '../../hooks/useApiClient';
import type {
  LivingContextArtifact,
  LivingContextSourceRef,
  ScopedLivingContextReadModel,
  ScopedLivingContextResponse,
} from '../../lib/api/types';
import { titleCaseSemanticLabel } from '../../lib/livingContextDisplay';
import '../Candidate/LivingContextGraph.css';

function sourceLocator(source: LivingContextSourceRef): string {
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

function sourceLabel(source: LivingContextSourceRef): string {
  return `${titleCaseSemanticLabel(source.artifactType)} ${sourceLocator(source)}`;
}

function metricValue(value: number): string {
  return value.toLocaleString();
}

function ArtifactSourceList({
  artifact,
  onSelectSource,
}: {
  artifact: LivingContextArtifact;
  onSelectSource: (source: LivingContextSourceRef) => void;
}): JSX.Element {
  return (
    <article className="living-context__artifact">
      <div className="living-context__artifact-title">{titleCaseSemanticLabel(artifact.artifactType)}</div>
      <div className="living-context__artifact-meta">
        <span>{artifact.logicalKey ?? artifact.id}</span>
        <span>v{artifact.latestVersionNumber ?? 'n/a'}</span>
      </div>
      {artifact.sourceSpans.length > 0 && (
        <div className="living-context__source-links">
          {artifact.sourceSpans.map((source) => (
            <button
              key={`${artifact.id}:${source.sourceSpanId}`}
              type="button"
              className="living-context__source-button"
              onClick={() => onSelectSource(source)}
              data-testid="role-context-artifact-source"
              data-source-span-id={source.sourceSpanId}
              title={source.exactText}
            >
              <Quote size={10} />
              <span>{sourceLabel(source)}</span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

export function RoleContextLivingGraphView({
  livingContext,
  onRefresh,
  isRefreshing = false,
}: {
  livingContext: ScopedLivingContextReadModel;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}): JSX.Element {
  const [selectedSource, setSelectedSource] = useState<LivingContextSourceRef | null>(
    livingContext.contextRecords
      .flatMap((record) => record.sources)
      .find((source): source is LivingContextSourceRef => typeof source.sourceSpanId === 'string')
      ?? livingContext.artifacts.flatMap((artifact) => artifact.sourceSpans)[0]
      ?? null,
  );

  useEffect(() => {
    setSelectedSource(
      livingContext.contextRecords
        .flatMap((record) => record.sources)
        .find((source): source is LivingContextSourceRef => typeof source.sourceSpanId === 'string')
        ?? livingContext.artifacts.flatMap((artifact) => artifact.sourceSpans)[0]
        ?? null,
    );
  }, [livingContext]);

  const concepts = useMemo(() => {
    const seen = new Set<string>();
    return livingContext.contextRecords.flatMap((record) => record.concepts).filter((concept) => {
      const key = `${concept.canonicalKey}:${concept.relationship}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [livingContext.contextRecords]);

  const metrics = [
    ['HYPEREDGES', metricValue(livingContext.summary.contextRecordCount)],
    ['SOURCES', metricValue(livingContext.summary.sourceSpanCount)],
    ['ARTIFACTS', metricValue(livingContext.summary.artifactCount)],
    ['CONCEPTS', metricValue(concepts.length)],
  ];

  return (
    <div className="living-context" data-testid="role-context-living-graph">
      <div className="living-context__toolbar">
        <div>
          <div className="living-context__eyebrow">{livingContext.scope.scopeType}</div>
          <div className="living-context__section-title">
            {livingContext.scope.label ?? livingContext.scope.scopeId}
          </div>
        </div>
        {onRefresh && (
          <button
            type="button"
            className="living-context__refresh"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCcw size={13} />
            {isRefreshing ? 'Refreshing' : 'Refresh'}
          </button>
        )}
      </div>

      <div className="living-context__summary">
        {metrics.map(([label, value]) => (
          <div key={label} className="living-context__metric">
            <div className="living-context__metric-value">{value}</div>
            <div className="living-context__metric-label">{label}</div>
          </div>
        ))}
      </div>

      <div className="living-context__workspace">
        <aside className="living-context__rail">
          <div className="living-context__person">
            <Network size={18} />
            <div>
              <div className="living-context__person-name">
                {livingContext.scope.label ?? 'Role context'}
              </div>
              <div className="living-context__person-meta">
                {livingContext.scope.status ?? 'unknown'} · {livingContext.scope.scopeId}
              </div>
            </div>
          </div>

          <div className="living-context__section-head">
            <div className="living-context__section-title">Concepts</div>
            <div className="living-context__count">{concepts.length}</div>
          </div>
          {concepts.length > 0 ? (
            <div className="living-context__concepts">
              {concepts.map((concept) => (
                <span
                  key={`${concept.canonicalKey}:${concept.relationship}`}
                  className="living-context__concept"
                  title={`${concept.canonicalKey} · ${concept.relationship}`}
                >
                  {concept.label}
                </span>
              ))}
            </div>
          ) : (
            <div className="living-context__empty">No open concepts yet.</div>
          )}
        </aside>

        <main className="living-context__canvas">
          <div className="living-context__section-head">
            <div>
              <div className="living-context__section-title">Context records</div>
              <div className="living-context__eyebrow">
                {livingContext.contextRecords.length} source-backed hyperedges
              </div>
            </div>
            <div className="living-context__count">{livingContext.contextRecords.length}</div>
          </div>
          <ContextRecordForest
            records={livingContext.contextRecords}
            onSelectSource={setSelectedSource}
          />

          <div className="living-context__artifacts" style={{ marginTop: 22 }}>
            <div className="living-context__section-head">
              <div className="living-context__section-title">Source artifacts</div>
              <div className="living-context__count">{livingContext.artifacts.length}</div>
            </div>
            {livingContext.artifacts.length > 0 ? (
              livingContext.artifacts.map((artifact) => (
                <ArtifactSourceList
                  key={artifact.id}
                  artifact={artifact}
                  onSelectSource={setSelectedSource}
                />
              ))
            ) : (
              <div className="living-context__empty">No source artifacts yet.</div>
            )}
          </div>
        </main>

        <aside className="living-context__inspector">
          <div className="living-context__section-head">
            <div className="living-context__section-title">Source evidence</div>
          </div>
          {selectedSource ? (
            <>
              <div className="living-context__eyebrow">
                {titleCaseSemanticLabel(selectedSource.artifactType)} · {sourceLocator(selectedSource)}
              </div>
              <blockquote className="living-context__quote">
                {selectedSource.exactText}
              </blockquote>
              <dl className="living-context__locator">
                <dt>Artifact</dt>
                <dd>{selectedSource.artifactLogicalKey ?? selectedSource.artifactId}</dd>
                <dt>Source span</dt>
                <dd>{selectedSource.sourceSpanId}</dd>
                <dt>Version</dt>
                <dd>{selectedSource.artifactVersionId}</dd>
              </dl>
            </>
          ) : (
            <div className="living-context__empty">No source selected.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

export function RoleContextLivingGraph({
  roleContextId,
  initialLivingContext,
}: {
  roleContextId: string;
  initialLivingContext?: ScopedLivingContextReadModel | null;
}): JSX.Element {
  const api = useApiClient();
  const [livingContext, setLivingContext] = useState<ScopedLivingContextReadModel | null>(
    initialLivingContext ?? null,
  );
  const [isLoading, setIsLoading] = useState(initialLivingContext === undefined);
  const [error, setError] = useState<Error | null>(null);

  const fetchLivingContext = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<ScopedLivingContextResponse>(
        `/api/v1/role-contexts/${roleContextId}/living-context`,
      );
      setLivingContext(response.livingContext);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load role context graph'));
    } finally {
      setIsLoading(false);
    }
  }, [api, roleContextId]);

  useEffect(() => {
    if (initialLivingContext !== undefined) {
      setLivingContext(initialLivingContext);
      setIsLoading(false);
      setError(null);
      return;
    }
    void fetchLivingContext();
  }, [fetchLivingContext, initialLivingContext]);

  if (isLoading && !livingContext) {
    return <div className="living-context__loading">Loading source-backed role graph...</div>;
  }

  if (error && !livingContext) {
    return (
      <div className="living-context__empty">
        {error.message}
      </div>
    );
  }

  if (!livingContext) {
    return <div className="living-context__empty">No source-backed role graph yet.</div>;
  }

  return (
    <RoleContextLivingGraphView
      livingContext={livingContext}
      onRefresh={() => void fetchLivingContext()}
      isRefreshing={isLoading}
    />
  );
}
