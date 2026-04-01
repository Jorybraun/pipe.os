/**
 * MermaidBlock — renders a mermaid diagram from source text.
 *
 * Uses mermaid.render() in a useEffect. Falls back to monospace <pre> on failure.
 */

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// Initialize once — dark theme, no auto-start
let initialized = false;
function ensureInit(): void {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      background: '#0c0c0e',
      primaryColor: '#3b82f6',
      primaryTextColor: '#e2e8f0',
      lineColor: '#475569',
      fontSize: '13px',
    },
  });
  initialized = true;
}

let nextId = 0;

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${nextId++}`);

  useEffect(() => {
    let cancelled = false;

    async function render(): Promise<void> {
      ensureInit();
      try {
        const { svg } = await mermaid.render(idRef.current, code.trim());
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: 16,
        margin: '12px 0',
      }}>
        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
          mermaid diagram
        </div>
        <pre style={{
          fontFamily: 'monospace',
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          color: '#94a3b8',
          margin: 0,
        }}>
          {code}
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: 16,
        margin: '12px 0',
        overflow: 'auto',
      }}
    />
  );
}
