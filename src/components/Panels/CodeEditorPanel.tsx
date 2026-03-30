// ---------------------------------------------------------------------------
// CodeEditorPanel — multi-file Monaco editor with file tabs
// Candidate-facing panel for CODE_IMPLEMENTATION challenges.
// ---------------------------------------------------------------------------

import { useState, useMemo, useCallback } from 'react';
import { MonacoPanel } from './MonacoPanel';
import { FileTabBar } from '../Editor/FileTabBar';
import type { VirtualFS } from '../../lib/challenge/virtualFS';

interface CodeEditorPanelProps {
  /** Starter file definitions (from challenge data) */
  starterFiles: VirtualFS;
  /** Current candidate file contents (from submission) */
  submittedFiles: Record<string, string>;
  /** Called when candidate edits a file */
  onFileChange: (path: string, content: string) => void;
  /** Default active file path */
  defaultActiveFile?: string;
}

export function CodeEditorPanel({
  starterFiles,
  submittedFiles,
  onFileChange,
  defaultActiveFile,
}: CodeEditorPanelProps): JSX.Element {
  const editablePaths = useMemo(
    () => Object.keys(starterFiles).filter((p) => !starterFiles[p]?.readOnly),
    [starterFiles],
  );

  const [activeFile, setActiveFile] = useState<string>(
    defaultActiveFile ?? editablePaths[0] ?? Object.keys(starterFiles)[0] ?? '',
  );

  // Build display FS: merge starter definitions with submitted content
  const displayFiles: VirtualFS = useMemo(() => {
    const merged: VirtualFS = {};
    for (const [path, file] of Object.entries(starterFiles)) {
      merged[path] = {
        ...file,
        content: submittedFiles[path] ?? file.content,
      };
    }
    return merged;
  }, [starterFiles, submittedFiles]);

  const handleChange = useCallback((val: string | undefined) => {
    onFileChange(activeFile, val ?? '');
  }, [activeFile, onFileChange]);

  const currentFile = displayFiles[activeFile];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0c0c0e' }}>
      <FileTabBar
        files={displayFiles}
        activeFile={activeFile}
        onSelect={setActiveFile}
      />
      <div style={{ flex: 1 }}>
        {currentFile ? (
          <MonacoPanel
            language={currentFile.language ?? 'javascript'}
            value={currentFile.content}
            onChange={handleChange}
            {...(currentFile.readOnly ? { readOnly: true } : {})}
            hideHeader
          />
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'rgba(255,255,255,0.2)',
            fontFamily: 'Space Mono',
            fontSize: 11,
          }}>
            No file selected.
          </div>
        )}
      </div>
    </div>
  );
}
