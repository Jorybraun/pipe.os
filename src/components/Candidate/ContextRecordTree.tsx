import { useState } from 'react';
import { ChevronRight, Quote } from 'lucide-react';
import type {
  LivingContextRecord,
  LivingContextRecordEntity,
  LivingContextRecordSourceRef,
  LivingContextSourceRef,
} from '../../lib/api/types';

function titleCase(value: string): string {
  return value
    .replace(/[_:-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayLabel(value: string): string {
  return titleCase(value.toLowerCase());
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
}

function confidenceLabel(value: number | null): string | null {
  return value === null ? null : `${Math.round(value * 100)}%`;
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

function isSourceSpanRef(source: LivingContextRecordSourceRef): source is LivingContextSourceRef {
  return typeof source.sourceSpanId === 'string';
}

function genericLocatorLabel(locator: Record<string, unknown>): string | null {
  const path = typeof locator.path === 'string'
    ? locator.path
    : typeof locator.file === 'string'
      ? locator.file
      : null;
  const lineStart = typeof locator.lineStart === 'number'
    ? locator.lineStart
    : typeof locator.line_start === 'number'
      ? locator.line_start
      : null;
  const lineEnd = typeof locator.lineEnd === 'number'
    ? locator.lineEnd
    : typeof locator.line_end === 'number'
      ? locator.line_end
      : null;

  if (path && lineStart !== null && lineEnd !== null) {
    return lineStart === lineEnd ? `${path}:${lineStart}` : `${path}:${lineStart}-${lineEnd}`;
  }
  if (path) return path;
  const id = typeof locator.id === 'string' ? locator.id : null;
  return id;
}

function recordSourceLabel(source: LivingContextRecordSourceRef): string {
  if (isSourceSpanRef(source)) {
    return `${titleCase(source.artifactType)} ${locatorLabel(source)}`;
  }
  return `${titleCase(source.sourceRefType)} ${genericLocatorLabel(source.locator) ?? source.sourceRefId}`;
}

function recordSourceSnippet(source: LivingContextRecordSourceRef): string | null {
  return source.exactText?.trim() || null;
}

function valueLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function entityLabel(entity: LivingContextRecordEntity): string {
  return valueLabel(entity.value)
    ?? entity.entityId
    ?? entity.entityType;
}

export function ContextRecordTree({
  record,
  onSelectSource,
}: {
  record: LivingContextRecord;
  onSelectSource: (source: LivingContextSourceRef) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const dateLabel = formatDate(record.observedAt);
  const recordConfidence = confidenceLabel(record.confidence);
  const polarityLabel = record.polarity < 0 ? 'negative' : record.polarity > 0 ? 'positive' : 'neutral';
  const predicateLabel = record.predicate ?? record.recordType;

  return (
    <article className="living-context__context-record">
      <button
        type="button"
        className="living-context__context-record-toggle"
        aria-label={`${expanded ? 'Collapse' : 'Expand'} context record`}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRight
          size={13}
          className={expanded ? 'living-context__context-record-chevron--open' : undefined}
        />
        <span className="living-context__context-record-title" title={predicateLabel}>
          {displayLabel(predicateLabel)}
        </span>
        <span className="living-context__context-record-type">{displayLabel(record.recordType)}</span>
        {recordConfidence && <span className="living-context__context-record-meta">{recordConfidence}</span>}
        {dateLabel && <span className="living-context__context-record-meta">{dateLabel}</span>}
        {record.polarity <= 0 && <span className="living-context__context-record-meta">{polarityLabel}</span>}
      </button>

      <div className="living-context__narrative">{record.narrative}</div>

      {expanded && (
        <div className="living-context__context-record-body">
          {record.entities.length > 0 && (
            <section>
              <div className="living-context__context-record-heading">Entities</div>
              <div className="living-context__context-record-list">
                {record.entities.map((entity, index) => (
                  <div
                    key={`${record.id}:entity:${entity.entityType}:${entity.entityId ?? index}`}
                    className="living-context__context-record-row"
                  >
                    <span>{entityLabel(entity)}</span>
                    <span>{entity.relationship}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {record.concepts.length > 0 && (
            <section>
              <div className="living-context__context-record-heading">Concepts</div>
              <div className="living-context__concepts">
                {record.concepts.map((concept) => (
                  <span
                    key={`${record.id}:concept:${concept.id}:${concept.relationship}`}
                    className="living-context__concept"
                    title={`${concept.canonicalKey} · weight ${concept.weight.toFixed(2)}`}
                  >
                    {concept.label}
                  </span>
                ))}
              </div>
            </section>
          )}

          {record.sources.length > 0 && (
            <section>
              <div className="living-context__context-record-heading">Source evidence</div>
              <div className="living-context__source-links">
                {record.sources.map((source) => {
                  const key = `${record.id}:source:${source.sourceRefType ?? 'source_span'}:${source.sourceRefId ?? source.sourceSpanId}:${source.evidenceRole ?? ''}`;
                  const label = recordSourceLabel(source);
                  const snippet = recordSourceSnippet(source);
                  if (isSourceSpanRef(source)) {
                    return (
                      <button
                        key={key}
                        type="button"
                        className="living-context__source-button"
                        onClick={() => onSelectSource(source)}
                        title={snippet ?? source.exactText}
                        data-testid="context-record-source-ref"
                        data-source-ref-type={source.sourceRefType ?? 'source_span'}
                        data-source-ref-id={source.sourceRefId ?? source.sourceSpanId}
                        data-source-span-id={source.sourceSpanId}
                      >
                        <Quote size={10} />
                        <span>{label}</span>
                      </button>
                    );
                  }
                  return (
                    <span
                      key={key}
                      className="living-context__source-button living-context__source-button--static"
                      title={snippet ?? source.sourceRefId}
                      data-testid="context-record-source-ref"
                      data-source-ref-type={source.sourceRefType}
                      data-source-ref-id={source.sourceRefId}
                      data-content-hash={source.contentHash ?? undefined}
                    >
                      <Quote size={10} />
                      <span>{label}</span>
                    </span>
                  );
                })}
              </div>
              {recordSourceSnippet(record.sources[0]!) && (
                <div className="living-context__context-record-source-snippet">
                  {recordSourceSnippet(record.sources[0]!)}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </article>
  );
}

export function ContextRecordForest({
  records,
  onSelectSource,
}: {
  records: LivingContextRecord[];
  onSelectSource: (source: LivingContextSourceRef) => void;
}): JSX.Element {
  if (records.length === 0) {
    return <div className="living-context__empty">NO_CONTEXT_RECORDS</div>;
  }

  return (
    <div className="living-context__context-records">
      {records.map((record) => (
        <ContextRecordTree
          key={record.id}
          record={record}
          onSelectSource={onSelectSource}
        />
      ))}
    </div>
  );
}
