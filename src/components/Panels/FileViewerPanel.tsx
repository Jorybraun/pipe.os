/**
 * FileViewerPanel — read-only file viewer using Monaco.
 *
 * Fetches a file from /rpc/repo/:challengeId/file?path=... and displays
 * it in a read-only Monaco editor with syntax highlighting.
 */

import { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { ArrowLeft, GitBranch, Loader } from 'lucide-react';
import { useSessionToken } from '../../contexts/SessionTokenContext';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

// ─── Language detection ─────────────────────────────────────────────────────

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', mdx: 'markdown',
    css: 'css', scss: 'scss', less: 'less',
    html: 'html', xml: 'xml', svg: 'xml',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    yml: 'yaml', yaml: 'yaml', toml: 'ini',
    sql: 'sql', graphql: 'graphql', gql: 'graphql',
    dockerfile: 'dockerfile',
  };
  return map[ext] ?? 'plaintext';
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface FileViewerPanelProps {
  challengeId: string;
  filePath: string;
  onBack: () => void;
  /** Whether this file has changes in the diff */
  isChanged?: boolean;
  /** Navigate to the diff view for this file */
  onViewDiff?: (path: string) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function FileViewerPanel({ challengeId, filePath, onBack, isChanged, onViewDiff }: FileViewerPanelProps): JSX.Element {
  const sessionToken = useSessionToken();
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setContent(null);
    try {
      const headers: Record<string, string> = {};
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

      const res = await fetch(
        `${API_BASE}/rpc/repo/${challengeId}/file?path=${encodeURIComponent(filePath)}`,
        { headers },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { content: string };
      setContent(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setIsLoading(false);
    }
  }, [challengeId, filePath, sessionToken]);

  useEffect(() => {
    fetchFile();
  }, [fetchFile]);

  const language = detectLanguage(filePath);
  const fileName = filePath.split('/').pop() ?? filePath;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        borderBottom: '1px solid var(--pipe-border)',
        background: 'rgba(12,12,14,0.95)',
      }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: '#94a3b8',
            fontSize: 10,
            fontFamily: "'Space Mono', monospace",
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={12} />
          CHANGES
        </button>
        <span style={{
          fontSize: 12,
          color: '#64748b',
          fontFamily: "'Space Mono', monospace",
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {filePath}
        </span>
        {isChanged && onViewDiff && (
          <button
            onClick={() => onViewDiff(filePath)}
            title="View diff for this file"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              background: 'rgba(74,222,128,0.06)',
              border: '1px solid rgba(74,222,128,0.15)',
              borderRadius: 4,
              color: '#4ade80',
              fontSize: 10,
              fontFamily: "'Space Mono', monospace",
              letterSpacing: '0.06em',
              cursor: 'pointer',
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(74,222,128,0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(74,222,128,0.06)';
            }}
            data-testid="view-diff-btn"
          >
            <GitBranch size={11} />
            VIEW DIFF
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
            <Loader size={16} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
            Loading {fileName}...
          </div>
        )}
        {error && (
          <div style={{ padding: 20, color: '#ef4444', fontSize: 13 }}>
            {error}
          </div>
        )}
        {content !== null && (
          <Editor
            height="100%"
            language={language}
            value={content}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'Space Mono', monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              renderLineHighlight: 'none',
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              contextmenu: false,
            }}
          />
        )}
      </div>
    </div>
  );
}
