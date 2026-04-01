/**
 * ReviewLeftPanel — left panel for code review with Brief/Files tabs.
 *
 * BRIEF tab shows the problem/instructions (ProblemPanel).
 * FILES tab shows the repo file tree (FileTreePanel).
 *
 * When a file is selected, it writes to InterviewContext submission so
 * the center panel can switch from diff to file viewer.
 */

import { useState } from 'react';
import { FileText, FolderTree } from 'lucide-react';
import { useInterview } from '../../contexts/InterviewContext';
import { TabNav, type Tab } from '../ui/TabNav';
import { FileTreePanel } from './FileTreePanel';

// ─── Tab definitions ────────────────────────────────────────────────────────

const TABS: Tab[] = [
  { id: 'brief', label: 'BRIEF', icon: <FileText size={12} /> },
  { id: 'files', label: 'FILES', icon: <FolderTree size={12} /> },
];

// ─── Connected ProblemPanel (inline — reads from context) ───────────────────

function ConnectedBrief(): JSX.Element {
  const ctx = useInterview();
  const data = ctx.currentChallenge?.data as Record<string, unknown> | undefined;
  const instructions = (data?.instructions as string) ?? '';
  const prDescription = (data?.githubPrDescription as string) ?? '';

  return (
    <div style={{ padding: 24, color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 1.7, overflowY: 'auto' }}>
      {prDescription && (
        <div style={{
          marginBottom: 24,
          padding: 16,
          background: 'rgba(96,165,250,0.05)',
          border: '1px solid rgba(96,165,250,0.1)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#60a5fa', marginBottom: 8, fontFamily: "'Space Mono', monospace" }}>
            PR_DESCRIPTION
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{prDescription}</div>
        </div>
      )}
      {instructions && (
        <div style={{ whiteSpace: 'pre-wrap' }}>{instructions}</div>
      )}
      {!instructions && !prDescription && (
        <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>
          Review the code changes in the diff panel.
        </div>
      )}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ReviewLeftPanel(): JSX.Element {
  const ctx = useInterview();
  const [activeTab, setActiveTab] = useState<string>('brief');

  const challengeData = ctx.currentChallenge?.data as Record<string, unknown> | undefined;
  const challengeId = (challengeData?.id as string) ?? '';
  const hasRepo = !!(challengeData?.githubRepoUrl);
  const selectedFile = (ctx.submission.selectedFile as string | null) ?? null;

  // Extract changed file paths from the cached diff
  const changedFiles = (() => {
    const diffJson = challengeData?.cachedDiffJson as { files?: Array<{ filename?: string; path?: string }> } | undefined;
    if (!diffJson?.files) return new Set<string>();
    return new Set(diffJson.files.map((f) => f.filename ?? f.path ?? '').filter(Boolean));
  })();

  const handleFileSelect = (path: string): void => {
    ctx.updateSubmission({ selectedFile: path });
  };

  const handleShowDiff = (): void => {
    ctx.updateSubmission({ selectedFile: null });
  };

  // No repo linked — just show brief, no tabs
  if (!hasRepo) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'rgba(12,12,14,0.95)' }}>
        <ConnectedBrief />
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(12,12,14,0.95)',
      borderRight: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Tab navigation */}
      <div style={{ padding: '12px 12px 0' }}>
        <TabNav
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {activeTab === 'brief' && <ConnectedBrief />}
        {activeTab === 'files' && (
          <FileTreePanel
            challengeId={challengeId}
            selectedFile={selectedFile}
            changedFiles={changedFiles}
            onFileSelect={handleFileSelect}
            onShowDiff={handleShowDiff}
          />
        )}
      </div>
    </div>
  );
}
