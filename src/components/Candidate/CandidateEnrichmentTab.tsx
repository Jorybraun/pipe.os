/**
 * CandidateEnrichmentTab — displays all AI-generated enrichment data and repo
 * match information for a single candidate.
 */

import { GitBranch, Github, AlertCircle, CheckCircle, XCircle, Clock, Cpu, Layers, Database } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../';
import type { CandidateEnrichmentRecord } from '../../lib/api/types';

interface CandidateEnrichmentTabProps {
  ingestion: CandidateEnrichmentRecord;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getScoreColor(score: number | null): string {
  if (score === null) return 'var(--pipe-text-dim)';
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#fbbf24';
  return '#f87171';
}

function getStatusBadge(status: string) {
  const config: Record<
    string,
    { icon: React.ReactNode; color: string; bg: string; border: string; label: string }
  > = {
    pending: {
      icon: <Clock size={10} />,
      color: '#9ca3af',
      bg: 'rgba(156,163,175,0.1)',
      border: 'rgba(156,163,175,0.25)',
      label: 'PENDING',
    },
    profile_generated: {
      icon: <CheckCircle size={10} />,
      color: '#60a5fa',
      bg: 'rgba(96,165,250,0.1)',
      border: 'rgba(96,165,250,0.25)',
      label: 'PROFILE GENERATED',
    },
    embedded: {
      icon: <CheckCircle size={10} />,
      color: '#60a5fa',
      bg: 'rgba(96,165,250,0.1)',
      border: 'rgba(96,165,250,0.25)',
      label: 'EMBEDDED',
    },
    matched: {
      icon: <CheckCircle size={10} />,
      color: '#10b981',
      bg: 'rgba(16,185,129,0.1)',
      border: 'rgba(16,185,129,0.25)',
      label: 'MATCHED',
    },
    failed: {
      icon: <XCircle size={10} />,
      color: '#f87171',
      bg: 'rgba(248,113,113,0.1)',
      border: 'rgba(248,113,113,0.25)',
      label: 'FAILED',
    },
  };

  const c = config[status] ?? config.pending;
  if (!c) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        color: c.color,
        letterSpacing: '0.08em',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function DimensionBar({ label, value }: { label: string; value: number }): JSX.Element {
  const color = getScoreColor(value);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 9,
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            letterSpacing: '0.08em',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            color,
            fontFamily: '"Space Mono", monospace',
          }}
        >
          {Math.round(value)}
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: 'rgba(255,255,255,0.05)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, value))}%`,
            height: '100%',
            background: color,
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

function TagPill({ children, variant = 'neutral' }: { children: React.ReactNode; variant?: 'match' | 'mismatch' | 'neutral' | 'model' }): JSX.Element {
  const colors = {
    match: { color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.15)' },
    mismatch: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.15)' },
    neutral: { color: 'rgba(96,165,250,0.7)', bg: 'rgba(96,165,250,0.06)', border: 'rgba(96,165,250,0.12)' },
    model: { color: 'rgba(255,255,255,0.5)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)' },
  };
  const c = colors[variant];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 8px',
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        color: c.color,
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {children}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <span
        style={{
          fontSize: 9,
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--pipe-text)',
          fontFamily: '"Space Mono", monospace',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function JsonBlock({ data, label }: { data: unknown; label: string }): JSX.Element | null {
  if (!data) return null;
  let rendered: React.ReactNode;
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    rendered = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((item, i) => (
          <div
            key={i}
            style={{
              padding: '8px 12px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              fontSize: 11,
              color: 'var(--pipe-text-muted)',
              lineHeight: 1.5,
            }}
          >
            {typeof item === 'string' ? item : JSON.stringify(item)}
          </div>
        ))}
      </div>
    );
  } else if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return null;
    rendered = (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {entries.map(([k, v]) => {
          const valStr = typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : JSON.stringify(v);
          return <TagPill key={k} variant="neutral">{`${k}: ${valStr}`.toUpperCase()}</TagPill>;
        })}
      </div>
    );
  } else {
    rendered = String(data);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          fontSize: 9,
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
          letterSpacing: '0.15em',
        }}
      >
        {label}
      </div>
      {rendered}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CandidateEnrichmentTab({ ingestion }: CandidateEnrichmentTabProps): JSX.Element {
  const keyConcepts = ingestion.keyConcepts;
  const conceptTags: string[] = [];

  if (keyConcepts && typeof keyConcepts === 'object') {
    const extract = (val: unknown): string[] => {
      if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
      if (typeof val === 'string') return [val];
      return [];
    };

    for (const [key, val] of Object.entries(keyConcepts)) {
      const items = extract(val);
      for (const item of items) {
        conceptTags.push(`${key}: ${item}`);
      }
    }
  }

  const dimensions = ingestion.dimensions;
  const reasoning = ingestion.reasoning;
  const scoreColor = getScoreColor(ingestion.triangulatedScore);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── AI Profile ────────────────────────────────────────────────────── */}
      <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <SubTitle>AI PROFILE</SubTitle>
          {ingestion.modelUsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Cpu size={10} color="var(--pipe-text-dim)" />
              <TagPill variant="model">{ingestion.modelUsed.toUpperCase()}</TagPill>
            </div>
          )}
        </div>

        {ingestion.candidateSearchableProfile ? (
          <div
            style={{
              fontSize: 14,
              color: 'var(--pipe-text-muted)',
              lineHeight: 1.7,
              marginBottom: conceptTags.length > 0 ? 20 : 0,
            }}
          >
            {ingestion.candidateSearchableProfile}
          </div>
        ) : (
          <div
            style={{
              fontSize: 12,
              color: 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
              fontStyle: 'italic',
              marginBottom: conceptTags.length > 0 ? 20 : 0,
            }}
          >
            No searchable profile generated yet.
          </div>
        )}

        {conceptTags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
            {conceptTags.map((tag) => (
              <TagPill key={tag}>{tag.toUpperCase()}</TagPill>
            ))}
          </div>
        )}

        {/* Model provenance */}
        <div
          style={{
            paddingTop: 16,
            borderTop: '1px solid var(--pipe-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {ingestion.profileVersion && <MetaRow label="PROFILE VERSION" value={ingestion.profileVersion} />}
          {ingestion.decompositionVersion && <MetaRow label="DECOMPOSITION VERSION" value={ingestion.decompositionVersion} />}
          {ingestion.profileGeneratedAt && (
            <MetaRow label="PROFILE GENERATED" value={new Date(ingestion.profileGeneratedAt).toLocaleString()} />
          )}
          {ingestion.profileEmbeddedAt && (
            <MetaRow label="PROFILE EMBEDDED" value={new Date(ingestion.profileEmbeddedAt).toLocaleString()} />
          )}
        </div>
      </LiquidMetalCard>

      {/* ── Career Context ────────────────────────────────────────────────── */}
      {(ingestion.careerContext || ingestion.situationSignature || ingestion.keySituations) && (
        <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <Layers size={12} color="var(--pipe-text-dim)" />
            <SubTitle>CAREER CONTEXT</SubTitle>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {ingestion.careerContext && <JsonBlock data={ingestion.careerContext} label="CAREER CONTEXT" />}
            {ingestion.situationSignature && <JsonBlock data={ingestion.situationSignature} label="SITUATION SIGNATURE" />}
            {ingestion.keySituations && <JsonBlock data={ingestion.keySituations} label="KEY SITUATIONS" />}
          </div>
        </LiquidMetalCard>
      )}

      {/* ── Enrichment Status ─────────────────────────────────────────────── */}
      <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
        <div style={{ marginBottom: 20 }}>
          <SubTitle>ENRICHMENT STATUS</SubTitle>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {getStatusBadge(ingestion.status)}
            {ingestion.enrichmentJobStatus && (
              <span
                style={{
                  fontSize: 9,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.08em',
                }}
              >
                JOB: {ingestion.enrichmentJobStatus}
              </span>
            )}
          </div>

          {ingestion.githubUrl && (
            <a
              href={ingestion.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: '#60a5fa',
                fontFamily: '"Space Mono", monospace',
                textDecoration: 'none',
              }}
            >
              <Github size={14} />
              {ingestion.githubUrl.replace(/^https:\/\/github\.com\//, '')}
            </a>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ingestion.lastEnrichedAt && (
              <MetaRow label="LAST ENRICHED" value={new Date(ingestion.lastEnrichedAt).toLocaleString()} />
            )}
            {ingestion.matchedAt && (
              <MetaRow label="MATCHED AT" value={new Date(ingestion.matchedAt).toLocaleString()} />
            )}
          </div>

          {ingestion.errorText && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '12px 16px',
                background: 'rgba(248,113,113,0.06)',
                border: '1px solid rgba(248,113,113,0.15)',
                borderRadius: 6,
              }}
            >
              <AlertCircle size={14} color="#f87171" style={{ marginTop: 2, flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 11,
                  color: '#f87171',
                  lineHeight: 1.5,
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {ingestion.errorText}
              </span>
            </div>
          )}
        </div>
      </LiquidMetalCard>

      {/* ── Repo Match ────────────────────────────────────────────────────── */}
      {ingestion.status === 'matched' && (
        <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <SubTitle>REPO MATCH</SubTitle>
            {ingestion.matchPhilosophy && (
              <span
                style={{
                  display: 'inline-block',
                  padding: '3px 10px',
                  background: 'rgba(96,165,250,0.08)',
                  border: '1px solid rgba(96,165,250,0.2)',
                  borderRadius: 4,
                  fontSize: 9,
                  fontWeight: 700,
                  color: '#60a5fa',
                  letterSpacing: '0.08em',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {ingestion.matchPhilosophy.toUpperCase()}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Matched repo */}
            {ingestion.matchedRepoName && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <GitBranch size={16} color="var(--pipe-accent)" />
                {ingestion.matchedRepoUrl ? (
                  <a
                    href={ingestion.matchedRepoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: 'var(--pipe-accent)',
                      fontFamily: '"Space Mono", monospace',
                      textDecoration: 'none',
                    }}
                  >
                    {ingestion.matchedRepoName}
                  </a>
                ) : (
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: 'var(--pipe-text)',
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    {ingestion.matchedRepoName}
                  </span>
                )}
              </div>
            )}

            {/* Scores */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, flexWrap: 'wrap' }}>
              {ingestion.triangulatedScore !== null && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <div
                    style={{
                      fontSize: 56,
                      fontWeight: 900,
                      color: scoreColor,
                      lineHeight: 1,
                      letterSpacing: '-0.04em',
                    }}
                  >
                    {Math.round(ingestion.triangulatedScore)}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                      letterSpacing: '0.15em',
                    }}
                  >
                    TRIANGULATED
                  </div>
                </div>
              )}
              {ingestion.roleCandidateCosine !== null && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <Database size={12} color="var(--pipe-text-dim)" />
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 800,
                      color: 'var(--pipe-text)',
                      fontFamily: '"Space Mono", monospace',
                      lineHeight: 1,
                    }}
                  >
                    {ingestion.roleCandidateCosine.toFixed(3)}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                      letterSpacing: '0.1em',
                    }}
                  >
                    ROLE-COSINE
                  </div>
                </div>
              )}
            </div>

            {/* Dimension breakdown */}
            {dimensions && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--pipe-text-dim)',
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: '0.15em',
                    marginBottom: 4,
                  }}
                >
                  DIMENSION BREAKDOWN
                </div>
                <DimensionBar label="SKILL COVERAGE" value={dimensions.skillCoverage} />
                <DimensionBar label="SEMANTIC SIMILARITY" value={dimensions.semanticSimilarity} />
                <DimensionBar label="SITUATION FIT" value={dimensions.situationFit} />
                <DimensionBar label="ROLE ALIGNMENT" value={dimensions.roleAlignment} />
              </div>
            )}

            {/* Reasoning */}
            {reasoning && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {reasoning.matches.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 9,
                        color: '#10b981',
                        fontFamily: '"Space Mono", monospace',
                        letterSpacing: '0.15em',
                        marginBottom: 10,
                      }}
                    >
                      MATCHES
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {reasoning.matches.map((m, i) => (
                        <TagPill key={i} variant="match">
                          {m.toUpperCase()}
                        </TagPill>
                      ))}
                    </div>
                  </div>
                )}
                {reasoning.mismatches.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 9,
                        color: '#fbbf24',
                        fontFamily: '"Space Mono", monospace',
                        letterSpacing: '0.15em',
                        marginBottom: 10,
                      }}
                    >
                      MISMATCHES
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {reasoning.mismatches.map((m, i) => (
                        <TagPill key={i} variant="mismatch">
                          {m.toUpperCase()}
                        </TagPill>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </LiquidMetalCard>
      )}
    </div>
  );
}
