import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileCode, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface Example {
  input: string;
  output: string;
  explanation?: string;
}

interface ProblemPanelProps {
  markdown: string;
  prDescription?: string;
  examples?: Example[];
  constraints?: string[];
  linkedArtifact?: {
    label: string;
    code: string;
    language: string;
  };
}

/**
 * ProblemPanel - Displays the challenge description, examples, and constraints.
 */
export function ProblemPanel({
  markdown,
  prDescription,
  examples,
  constraints,
  linkedArtifact
}: ProblemPanelProps): JSX.Element {
  const [isArtifactOpen, setIsArtifactOpen] = useState(false);

  return (
    <div style={{ padding: '32px', color: 'var(--pipe-text, #fff)', fontSize: 15, lineHeight: 1.6 }}>
      {/* PR Description Section */}
      {prDescription && (
        <div style={{ marginBottom: 40, padding: 24, background: 'rgba(96, 165, 250, 0.05)', border: '1px solid rgba(96, 165, 250, 0.1)', borderRadius: 8 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', color: '#60a5fa', marginBottom: 12, fontFamily: 'Space Mono', fontWeight: 700 }}>
            PULL_REQUEST_DESCRIPTION
          </div>
          <div style={{ maxWidth: 'none', fontSize: 14 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {prDescription}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Markdown Content */}
      <div style={{ maxWidth: 'none' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {markdown}
        </ReactMarkdown>
      </div>

      {/* Examples Section */}
      {examples && examples.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <h3 style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--pipe-text-dim)', marginBottom: 16, fontFamily: 'Space Mono' }}>
            EXAMPLES
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {examples.map((ex, i) => (
              <div key={i} style={{ background: 'var(--pipe-surface)', border: '1px solid var(--pipe-border)', borderRadius: 4, padding: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>INPUT</span>
                  <code style={{ fontSize: 13, color: '#60a5fa', fontFamily: 'Space Mono' }}>{ex.input}</code>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 12 }}>
                  <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>OUTPUT</span>
                  <code style={{ fontSize: 13, color: '#34d399', fontFamily: 'Space Mono' }}>{ex.output}</code>
                </div>
                {ex.explanation && (
                  <p style={{ marginTop: 12, fontSize: 12, color: 'var(--pipe-text-dim)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
                    {ex.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Constraints Section */}
      {constraints && constraints.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <h3 style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--pipe-text-dim)', marginBottom: 16, fontFamily: 'Space Mono' }}>
            CONSTRAINTS
          </h3>
          <ul style={{ paddingLeft: 16, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {constraints.map((c, i) => (
              <li key={i} style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Linked Artifact */}
      {linkedArtifact && (
        <div style={{ marginTop: 40, borderTop: '1px solid var(--pipe-border)', paddingTop: 24 }}>
          <button 
            onClick={() => setIsArtifactOpen(!isArtifactOpen)}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 12, 
              background: 'none', 
              border: 'none', 
              color: 'var(--pipe-text, #fff)', 
              fontSize: 12, 
              fontWeight: 700, 
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'Space Mono'
            }}
          >
            <FileCode size={16} color="#60a5fa" />
            {linkedArtifact.label}
            <ChevronDown size={14} style={{ transform: isArtifactOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>

          {isArtifactOpen && (
            <div style={{ marginTop: 16, background: '#000', borderRadius: 4, padding: 16, border: '1px solid var(--pipe-border)' }}>
              <pre style={{ margin: 0, fontSize: 12, color: 'var(--pipe-text-muted)', fontFamily: 'Space Mono', overflowX: 'auto' }}>
                {linkedArtifact.code}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
