/**
 * RepoSearchPage — semantic search over approved repos in the qualified_repos catalog.
 *
 * Route: /admin/repos/search
 * Auth: Clerk JWT (recruiter-only)
 */

import React, { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../../hooks/useApiClient';
import { ArrowLeft, Search, ExternalLink, Star } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: number;
  full_name: string;
  github_url: string;
  primary_language: string;
  stars: number;
  detected_domain: string | null;
  seniority_band: string | null;
  sloc: number | null;
  pr_quality_score: number;
  engineering_narrative: string | null;
  architecture_style: string | null;
  score: number;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

function fmtScore(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RepoSearchPage(): JSX.Element {
  const navigate = useNavigate();
  const api = useApiClient();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [lastQuery, setLastQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setIsLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await api.post<SearchResponse>('/api/v1/admin/repos/search', { query: q });
      setResults(res.results);
      setLastQuery(res.query);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: '0 0 80px', maxWidth: 1400, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => navigate('/admin/repos')}
            style={{ ...mono, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pipe-text-dim)', fontSize: 10, letterSpacing: '0.2em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
          >
            <ArrowLeft size={10} />
            REPO_CATALOG
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--pipe-text)', margin: 0 }}>
            Semantic Search
          </h1>
        </div>
        <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-dim)' }}>
          approved repos · bge-large-en-v1.5
        </div>
      </div>

      {/* Search form */}
      <form onSubmit={(e) => { void handleSearch(e); }} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. TypeScript microservices with async patterns and integration tests"
          disabled={isLoading}
          style={{
            ...mono,
            flex: 1,
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border)',
            color: 'var(--pipe-text)',
            padding: '10px 14px',
            fontSize: 12,
            borderRadius: 4,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          style={{
            ...mono,
            background: 'rgba(96,165,250,0.1)',
            color: '#60a5fa',
            border: '1px solid rgba(96,165,250,0.25)',
            padding: '10px 20px',
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: '0.1em',
            cursor: isLoading || !query.trim() ? 'not-allowed' : 'pointer',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            opacity: isLoading || !query.trim() ? 0.4 : 1,
          }}
        >
          <Search size={12} />
          {isLoading ? 'SEARCHING...' : 'SEARCH'}
        </button>
      </form>

      <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: 28 }}>
        Only approved repos with a pass 3 profile are indexed.
      </div>

      {error && (
        <div style={{ ...mono, color: '#f87171', fontSize: 11, marginBottom: 16 }}>{error}</div>
      )}

      {results !== null && results.length === 0 && (
        <div style={{ ...mono, color: 'var(--pipe-text-dim)', fontSize: 11, padding: '40px 0', textAlign: 'center' }}>
          No results for "{lastQuery}". Run pass 3 on approved repos to populate the index.
        </div>
      )}

      {results !== null && results.length > 0 && (
        <>
          <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: 12 }}>
            {results.length} result{results.length !== 1 ? 's' : ''} for "{lastQuery}"
          </div>

          {results.map((r) => (
            <div
              key={r.id}
              style={{
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                padding: '16px 18px',
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                <span style={{ ...mono, fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)' }}>{r.full_name}</span>
                <span style={{ ...mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)' }}>
                  {fmtScore(r.score)}
                </span>
                <a href={r.github_url} target="_blank" rel="noopener noreferrer" style={{ ...mono, marginLeft: 'auto', color: '#60a5fa', textDecoration: 'none', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ExternalLink size={10} /> github
                </a>
              </div>

              <div style={{ ...mono, display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: r.engineering_narrative ? 10 : 0 }}>
                <span>{r.primary_language}</span>
                {r.architecture_style && <span>{r.architecture_style}</span>}
                {r.detected_domain && <span>{r.detected_domain}</span>}
                {r.seniority_band && <span>{r.seniority_band}</span>}
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Star size={9} />{fmtNum(r.stars)}</span>
                <span>sloc {fmtNum(r.sloc)}</span>
                <span>pr_quality {r.pr_quality_score.toFixed(2)}</span>
              </div>

              {r.engineering_narrative && (
                <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', lineHeight: 1.6, borderTop: '1px solid var(--pipe-border)', paddingTop: 10, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {r.engineering_narrative}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
