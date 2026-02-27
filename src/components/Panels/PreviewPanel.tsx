import { SandpackProvider, SandpackPreview, SandpackLayout } from "@codesandbox/sandpack-react";
import { useMemo } from 'react';

interface PreviewPanelProps {
  code: string;
  language: string;
}

/**
 * PreviewPanel - Renders a live preview of code using Sandpack.
 * Optimized for React component challenges.
 */
export function PreviewPanel({ code, language }: PreviewPanelProps): JSX.Element {
  const files = useMemo(() => {
    if (language.toLowerCase() === 'javascript' || language.toLowerCase() === 'typescript') {
      const extension = language.toLowerCase() === 'typescript' ? 'tsx' : 'js';
      return {
        [`/App.${extension}`]: code
      };
    }
    return {};
  }, [code, language]);

  const template = useMemo(() => {
    return language.toLowerCase() === 'typescript' ? 'react-ts' : 'react';
  }, [language]);

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: '#0c0c0e' }}>
      <header style={{ 
        padding: '12px 20px', 
        borderBottom: '1px solid rgba(255,255,255,0.06)', 
        display: 'flex', 
        alignItems: 'center',
        gap: 12,
        background: 'rgba(255,255,255,0.02)'
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono', letterSpacing: '0.1em' }}>
          LIVE_PREVIEW
        </span>
      </header>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <SandpackProvider
          template={template as any}
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
