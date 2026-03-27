import { SandpackProvider, SandpackPreview, SandpackLayout } from "@codesandbox/sandpack-react";
import { useMemo } from 'react';
import type { VirtualFS } from '../../lib/challenge/virtualFS';
import { fsToSandpackFiles } from '../../lib/challenge/virtualFS';

interface PreviewPanelProps {
  /** Legacy single-code mode */
  code?: string;
  language?: string;
  /** New multi-file VirtualFS mode */
  virtualFS?: VirtualFS;
  /** Sandpack template override */
  template?: string;
  hideHeader?: boolean;
}

/**
 * PreviewPanel - Renders a live preview of code using Sandpack.
 * Supports both legacy single-code and new VirtualFS multi-file mode.
 */
export function PreviewPanel({
  code,
  language,
  virtualFS,
  template: templateOverride,
  hideHeader = false,
}: PreviewPanelProps): JSX.Element {
  const files = useMemo(() => {
    // New VirtualFS mode
    if (virtualFS) {
      return fsToSandpackFiles(virtualFS);
    }

    // Legacy single-code mode
    if (code !== undefined) {
      const lang = (language ?? 'javascript').toLowerCase();
      if (lang === 'javascript' || lang === 'typescript') {
        const extension = lang === 'typescript' ? 'tsx' : 'js';
        return { [`/App.${extension}`]: code };
      }
    }
    return {};
  }, [code, language, virtualFS]);

  const resolvedTemplate = useMemo(() => {
    if (templateOverride) return templateOverride;
    // Auto-detect: if VFS has .html file, use vanilla template
    if (virtualFS) {
      const hasHtml = Object.keys(virtualFS).some((p) => p.endsWith('.html'));
      if (hasHtml) return 'vanilla';
    }
    const lang = (language ?? 'javascript').toLowerCase();
    return lang === 'typescript' ? 'react-ts' : 'react';
  }, [language, virtualFS, templateOverride]);

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: '#0c0c0e' }}>
      {!hideHeader && (
        <header style={{
          padding: '10px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(255,255,255,0.02)',
          flexShrink: 0,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono', letterSpacing: '0.1em' }}>
            PREVIEW
          </span>
        </header>
      )}

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <SandpackProvider
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          template={resolvedTemplate as any}
          files={files}
          theme="dark"
          options={{
            classes: {
              "sp-wrapper": "custom-sandpack"
            }
          }}
        >
          <SandpackLayout style={{ height: '100%', border: 'none', borderRadius: 0 }}>
            <SandpackPreview
              style={{ height: '100%' }}
              showNavigator={false}
              showRefreshButton={true}
            />
          </SandpackLayout>
        </SandpackProvider>
      </div>

      <style>{`
        .custom-sandpack {
          height: 100%;
        }
        .sp-layout {
          height: 100% !important;
        }
      `}</style>
    </div>
  );
}
