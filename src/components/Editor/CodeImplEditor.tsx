// ---------------------------------------------------------------------------
// CodeImplEditor — recruiter challenge editor for CODE_IMPLEMENTATION
//
// Tabbed layout: INSTRUCTIONS | CODE (multi-file) | SAMPLE_TESTS | HIDDEN_TESTS
// Docked console at bottom of editor area.
// MODE / ENGINE / FOLLOW_UP config lives in the DETAILS tab of ChallengeEditorPage.
// ---------------------------------------------------------------------------

import { useState, useCallback, useMemo } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { MonacoPanel } from '../Panels/MonacoPanel';
import { EditorTabBar } from './EditorTabBar';
import { FileTabBar } from './FileTabBar';
import { ConsolePanel } from './ConsolePanel';
import { Allotment } from '../ui/ResizablePane';
import {
  legacyToVFS,
  legacyTestsToVFS,
  languageFromPath,
} from '../../lib/challenge/virtualFS';
import { runTestsVFS } from '../../lib/challenge/testRunner';
import type { VirtualFS, EnhancedRunResult } from '../../lib/challenge/virtualFS';
import type { EditorFormProps } from './types';

type SectionTab = 'instructions' | 'code' | 'sample_tests' | 'hidden_tests';

const SECTION_TABS = [
  { key: 'instructions' as const, label: 'INSTRUCTIONS' },
  { key: 'code' as const, label: 'CODE' },
  { key: 'sample_tests' as const, label: 'SAMPLE_TESTS' },
  { key: 'hidden_tests' as const, label: 'HIDDEN_TESTS', badge: 'SERVER' },
];

export function CodeImplEditor({ challenge, onChange }: EditorFormProps): JSX.Element {
  const [activeSection, setActiveSection] = useState<SectionTab>('code');
  const [runResult, setRunResult] = useState<EnhancedRunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // ── Derived state ────────────────────────────────────────────────────────
  const language = String(challenge.config?.language ?? 'javascript').toLowerCase();

  const codeFiles: VirtualFS = useMemo(
    () => (challenge.config?.files as VirtualFS) ?? legacyToVFS(challenge.config ?? {}),
    [challenge.config],
  );

  const sampleTestFiles: VirtualFS = useMemo(() => {
    if (challenge.config?.sampleTestFiles) return challenge.config.sampleTestFiles as VirtualFS;
    // Legacy: if there's no explicit sampleTestFiles, use an empty set
    return {};
  }, [challenge.config]);

  const hiddenTestFiles: VirtualFS = useMemo(
    () => (challenge.serverConfig?.hiddenTestFiles as VirtualFS) ?? legacyTestsToVFS(challenge.serverConfig ?? {}),
    [challenge.serverConfig],
  );

  // Active file within each tab
  const [activeCodeFile, setActiveCodeFile] = useState<string>(
    (challenge.config?.activeFile as string) ?? Object.keys(codeFiles)[0] ?? '/solution.js',
  );
  const [activeSampleFile, setActiveSampleFile] = useState<string>(
    Object.keys(sampleTestFiles)[0] ?? '',
  );
  const [activeHiddenFile, setActiveHiddenFile] = useState<string>(
    Object.keys(hiddenTestFiles)[0] ?? '/solution.test.js',
  );

  // ── Helpers ──────────────────────────────────────────────────────────────
  const setConfig = useCallback((patch: Record<string, unknown>) =>
    onChange({ ...challenge, config: { ...challenge.config, ...patch } }),
  [challenge, onChange]);

  const setServerConfig = useCallback((patch: Record<string, unknown>) =>
    onChange({ ...challenge, serverConfig: { ...challenge.serverConfig, ...patch } }),
  [challenge, onChange]);

  const updateCodeFile = useCallback((path: string, content: string | undefined) => {
    const updated = { ...codeFiles };
    if (updated[path]) {
      updated[path] = { ...updated[path], content: content ?? '' };
    }
    setConfig({ files: updated });
  }, [codeFiles, setConfig]);

  const updateSampleFile = useCallback((path: string, content: string | undefined) => {
    const updated = { ...sampleTestFiles };
    if (updated[path]) {
      updated[path] = { ...updated[path], content: content ?? '' };
    }
    setConfig({ sampleTestFiles: updated });
  }, [sampleTestFiles, setConfig]);

  const updateHiddenFile = useCallback((path: string, content: string | undefined) => {
    const updated = { ...hiddenTestFiles };
    if (updated[path]) {
      updated[path] = { ...updated[path], content: content ?? '' };
    }
    setServerConfig({ hiddenTestFiles: updated });
  }, [hiddenTestFiles, setServerConfig]);

  // ── File CRUD ────────────────────────────────────────────────────────────
  const addFile = useCallback((targetFS: 'code' | 'sample' | 'hidden') => {
    const name = window.prompt('File name (e.g. utils.js):');
    if (!name) return;
    const path = name.startsWith('/') ? name : '/' + name;
    const lang = languageFromPath(path);
    const newFile = { content: '', language: lang };

    if (targetFS === 'code') {
      setConfig({ files: { ...codeFiles, [path]: newFile } });
      setActiveCodeFile(path);
    } else if (targetFS === 'sample') {
      setConfig({ sampleTestFiles: { ...sampleTestFiles, [path]: newFile } });
      setActiveSampleFile(path);
    } else {
      setServerConfig({ hiddenTestFiles: { ...hiddenTestFiles, [path]: newFile } });
      setActiveHiddenFile(path);
    }
  }, [codeFiles, sampleTestFiles, hiddenTestFiles, setConfig, setServerConfig]);

  const removeFile = useCallback((path: string, targetFS: 'code' | 'sample' | 'hidden') => {
    if (targetFS === 'code') {
      const updated = { ...codeFiles };
      delete updated[path];
      setConfig({ files: updated });
      const remaining = Object.keys(updated);
      if (activeCodeFile === path && remaining.length > 0) setActiveCodeFile(remaining[0] ?? '');
    } else if (targetFS === 'sample') {
      const updated = { ...sampleTestFiles };
      delete updated[path];
      setConfig({ sampleTestFiles: updated });
      const remaining = Object.keys(updated);
      if (activeSampleFile === path && remaining.length > 0) setActiveSampleFile(remaining[0] ?? '');
    } else {
      const updated = { ...hiddenTestFiles };
      delete updated[path];
      setServerConfig({ hiddenTestFiles: updated });
      const remaining = Object.keys(updated);
      if (activeHiddenFile === path && remaining.length > 0) setActiveHiddenFile(remaining[0] ?? '');
    }
  }, [codeFiles, sampleTestFiles, hiddenTestFiles, activeCodeFile, activeSampleFile, activeHiddenFile, setConfig, setServerConfig]);

  // ── Run tests ────────────────────────────────────────────────────────────
  const handleRunTests = useCallback(async () => {
    setIsRunning(true);
    setRunResult(null);
    // Run sample + hidden tests together in editor context
    const allTests: VirtualFS = { ...sampleTestFiles, ...hiddenTestFiles };
    const result = await runTestsVFS(codeFiles, allTests, language);
    setRunResult(result);
    setIsRunning(false);
  }, [codeFiles, sampleTestFiles, hiddenTestFiles, language]);

  // ── Language selector ────────────────────────────────────────────────────
  const langSelect = (
    <select
      value={language}
      onChange={(e) => setConfig({ language: e.target.value })}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'rgba(255,255,255,0.7)',
        fontFamily: 'Space Mono',
        fontSize: 10,
        padding: '4px 8px',
        outline: 'none',
      }}
    >
      <option value="javascript">JAVASCRIPT</option>
      <option value="typescript">TYPESCRIPT</option>
    </select>
  );

  // ── Section content ──────────────────────────────────────────────────────
  const renderSection = (): JSX.Element => {
    switch (activeSection) {
      case 'instructions':
        return (
          <MonacoPanel
            language="markdown"
            value={challenge.instructions || ''}
            onChange={(val) => onChange({ ...challenge, instructions: val ?? '' })}
            hideHeader
          />
        );

      case 'code':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <FileTabBar
              files={codeFiles}
              activeFile={activeCodeFile}
              onSelect={setActiveCodeFile}
              onAdd={() => addFile('code')}
              onRemove={(p) => removeFile(p, 'code')}
            />
            <div style={{ flex: 1 }}>
              {codeFiles[activeCodeFile] && (
                <MonacoPanel
                  language={codeFiles[activeCodeFile].language}
                  value={codeFiles[activeCodeFile].content}
                  onChange={(val) => updateCodeFile(activeCodeFile, val)}
                  {...(codeFiles[activeCodeFile].readOnly ? { readOnly: true } : {})}
                  hideHeader
                />
              )}
            </div>
          </div>
        );

      case 'sample_tests': {
        const hasSample = Object.keys(sampleTestFiles).length > 0;
        if (!hasSample) {
          return (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 16,
            }}>
              <Eye size={24} style={{ color: 'rgba(255,255,255,0.15)' }} />
              <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', textAlign: 'center' }}>
                Sample tests are visible to candidates.<br />
                They run in-browser for instant feedback.
              </div>
              <button
                onClick={() => addFile('sample')}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--pipe-text, #fff)',
                  padding: '8px 20px',
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: 'Space Mono',
                  cursor: 'pointer',
                }}
              >
                + ADD_SAMPLE_TEST
              </button>
            </div>
          );
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <FileTabBar
              files={sampleTestFiles}
              activeFile={activeSampleFile}
              onSelect={setActiveSampleFile}
              onAdd={() => addFile('sample')}
              onRemove={(p) => removeFile(p, 'sample')}
            />
            <div style={{ flex: 1 }}>
              {sampleTestFiles[activeSampleFile] && (
                <MonacoPanel
                  language={sampleTestFiles[activeSampleFile].language}
                  value={sampleTestFiles[activeSampleFile].content}
                  onChange={(val) => updateSampleFile(activeSampleFile, val)}
                  hideHeader
                />
              )}
            </div>
          </div>
        );
      }

      case 'hidden_tests':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{
              padding: '8px 16px',
              background: 'rgba(248,113,113,0.06)',
              borderBottom: '1px solid rgba(248,113,113,0.12)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <EyeOff size={12} style={{ color: 'rgba(248,113,113,0.6)' }} />
              <span style={{ fontSize: 9, fontFamily: 'Space Mono', color: 'rgba(248,113,113,0.6)', letterSpacing: '0.1em' }}>
                HIDDEN_FROM_CANDIDATES — runs server-side on submission
              </span>
            </div>
            <FileTabBar
              files={hiddenTestFiles}
              activeFile={activeHiddenFile}
              onSelect={setActiveHiddenFile}
              onAdd={() => addFile('hidden')}
              onRemove={(p) => removeFile(p, 'hidden')}
            />
            <div style={{ flex: 1 }}>
              {hiddenTestFiles[activeHiddenFile] && (
                <MonacoPanel
                  language={hiddenTestFiles[activeHiddenFile].language}
                  value={hiddenTestFiles[activeHiddenFile].content}
                  onChange={(val) => updateHiddenFile(activeHiddenFile, val)}
                  hideHeader
                />
              )}
            </div>
          </div>
        );
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ height: 'calc(100vh - 140px)', marginTop: 16 }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0c0c0e',
        border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}>
        <EditorTabBar
          tabs={SECTION_TABS}
          activeKey={activeSection}
          onSelect={(k) => setActiveSection(k as SectionTab)}
        />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Allotment vertical defaultSizes={[75, 25]}>
            <Allotment.Pane minSize={200}>
              {renderSection()}
            </Allotment.Pane>
            <Allotment.Pane minSize={36}>
              <ConsolePanel
                result={runResult}
                isRunning={isRunning}
                onClear={() => setRunResult(null)}
              />
            </Allotment.Pane>
          </Allotment>
        </div>
        {/* Run bar */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
        }}>
          {langSelect}
          <button
            onClick={handleRunTests}
            disabled={isRunning}
            style={{
              background: isRunning ? 'rgba(255,255,255,0.04)' : '#a78bfa',
              border: 'none',
              color: isRunning ? 'rgba(255,255,255,0.4)' : '#000',
              padding: '8px 20px',
              fontSize: 10,
              fontWeight: 800,
              fontFamily: 'Space Mono',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            {isRunning ? 'RUNNING...' : 'RUN_ALL_TESTS'}
          </button>
        </div>
      </div>
    </div>
  );
}
