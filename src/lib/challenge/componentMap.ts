import type { ComponentType } from 'react';
import { connectInterview } from './connectInterview';
import type { VirtualFS } from './virtualFS';
import { legacyToVFS, mergeSubmissionIntoFS } from './virtualFS';

// Shells (context-free — they just wrap children)
import { TimerShell } from '../../components/Shells/TimerShell';
import { VideoShell } from '../../components/Shells/VideoShell';

// Pure panels (props-only, reusable, testable)
import { ProblemPanel } from '../../components/Panels/ProblemPanel';
import { MonacoPanel } from '../../components/Panels/MonacoPanel';
import { OptionsPanel } from '../../components/Panels/OptionsPanel';
import { TextareaPanel } from '../../components/Panels/TextareaPanel';
import { PreviewPanel } from '../../components/Panels/PreviewPanel';
import { VerdictPanel } from '../../components/Panels/VerdictPanel';
import { ReviewConversationPanel } from '../../components/Panels/ReviewConversationPanel';
import { DiffPanel, type Annotation } from '../../components/Assessment/DiffPanel';
import { VoicePanel } from '../../components/Panels/VoicePanel';
import { CodeEditorPanel } from '../../components/Panels/CodeEditorPanel';
import { RunConsolePanel } from '../../components/Panels/RunConsolePanel';

// Layouts
import { WorkspaceLayout } from '../../components/Assessment/WorkspaceLayout';
import { FullBleedLayout } from '../../components/Assessment/FullBleedLayout';
import { CodeWorkspaceLayout } from '../../components/Assessment/CodeWorkspaceLayout';
import { CodeBrowserLayout } from '../../components/Assessment/CodeBrowserLayout';

// ---------------------------------------------------------------------------
// Connected panels — HOC wrappers that bridge InterviewContext → panel props
// ---------------------------------------------------------------------------

const ConnectedProblemPanel = connectInterview(ProblemPanel, (ctx) => ({
  markdown: ctx.currentChallenge.instructions || 'No instructions provided.',
  ...(typeof ctx.currentChallenge.data.prDescription === 'string'
    ? { prDescription: ctx.currentChallenge.data.prDescription }
    : {}),
  ...(Array.isArray(ctx.currentChallenge.data.examples)
    ? { examples: ctx.currentChallenge.data.examples as Array<{ input: string; output: string; explanation?: string }> }
    : {}),
  ...(Array.isArray(ctx.currentChallenge.data.constraints)
    ? { constraints: ctx.currentChallenge.data.constraints as string[] }
    : {}),
}));

const ConnectedMonacoPanel = connectInterview(MonacoPanel, (ctx) => ({
  language: String(ctx.currentChallenge.data.language ?? 'javascript').toLowerCase(),
  value: (ctx.submission.code as string) || (ctx.currentChallenge.data.starterCode as string) || '',
  onChange: (code: string | undefined) => ctx.updateSubmission({ code: code ?? '' }),
  hideHeader: true,
}));

const ConnectedOptionsPanel = connectInterview(OptionsPanel, (ctx) => {
  const rawOptions = Array.isArray(ctx.currentChallenge.data.options) ? ctx.currentChallenge.data.options : [];
  const options = rawOptions.map((o: unknown, i: number) =>
    typeof o === 'string' ? { id: String(i), text: o } : (o as { id: string; text: string }),
  );
  const selectionMode = (ctx.currentChallenge.data.selectionMode as string) === 'multi' ? 'multi' : 'single';

  if (selectionMode === 'multi') {
    const rawSelected = (ctx.submission.answers as Record<string, unknown>)?.selected;
    const selectedIds: string[] = Array.isArray(rawSelected) ? (rawSelected as string[]) : [];
    return {
      question: (ctx.currentChallenge.data.question as string) || ctx.currentChallenge.title,
      options,
      selectionMode: 'multi' as const,
      selectedId: null,
      selectedIds,
      onSelect: (id: string) => {
        const rawCurrent = (ctx.submission.answers as Record<string, unknown>)?.selected;
        const current: string[] = Array.isArray(rawCurrent) ? [...(rawCurrent as string[])] : [];
        const idx = current.indexOf(id);
        if (idx >= 0) current.splice(idx, 1);
        else current.push(id);
        ctx.updateSubmission({ answers: { selected: current } });
      },
    };
  }

  return {
    question: (ctx.currentChallenge.data.question as string) || ctx.currentChallenge.title,
    options,
    selectedId: (ctx.submission.answers as Record<string, string> | undefined)?.current ?? null,
    onSelect: (id: string) => ctx.updateSubmission({ answers: { current: id } }),
  };
});

const ConnectedTextareaPanel = connectInterview(TextareaPanel, (ctx) => ({
  question: (ctx.currentChallenge.data.question as string) || ctx.currentChallenge.title,
  value: (ctx.submission.text as string) || '',
  onChange: (text: string) => ctx.updateSubmission({ text }),
  ...(typeof ctx.currentChallenge.data.maxLength === 'number'
    ? { maxLength: ctx.currentChallenge.data.maxLength }
    : {}),
}));

const ConnectedPreviewPanel = connectInterview(PreviewPanel, (ctx) => ({
  code: (ctx.submission.code as string) || (ctx.currentChallenge.data.starterCode as string) || '',
  language: String(ctx.currentChallenge.data.language ?? 'javascript').toLowerCase(),
  hideHeader: true,
}));

/**
 * Parses a unified diff patch string into DiffHunk[].
 * Handles @@ headers and +/-/context lines.
 */
function parsePatchToHunks(patch: string): import('../../components/Assessment/DiffPanel').DiffHunk[] {
  if (!patch) return [];
  const lines = patch.split('\n');
  const hunks: import('../../components/Assessment/DiffPanel').DiffHunk[] = [];
  let currentHunk: import('../../components/Assessment/DiffPanel').DiffHunk | null = null;
  let lineNum = 1;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // Parse hunk header for starting line number
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      lineNum = match?.[1] != null ? parseInt(match[1], 10) : 1;
      currentHunk = { header: line, lines: [] };
      hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'addition', num: lineNum++, content: line.slice(1) });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'deletion', num: lineNum, content: line.slice(1) });
    } else {
      currentHunk.lines.push({ type: 'context', num: lineNum++, content: line.startsWith(' ') ? line.slice(1) : line });
    }
  }
  return hunks;
}

/**
 * Transforms GitHub-format cachedDiffJson into DiffPanel's DiffJson format.
 * GitHub format: { files: [{ filename, patch, additions, deletions }] }
 * DiffPanel format: { files: [{ path, status, additions, deletions, hunks }], stats }
 */
function normalizeDiffJson(raw: unknown): import('../../components/Assessment/DiffPanel').DiffJson {
  const empty: import('../../components/Assessment/DiffPanel').DiffJson = {
    files: [], stats: { filesChanged: 0, additions: 0, deletions: 0 },
  };
  if (typeof raw !== 'object' || raw === null || !('files' in (raw as Record<string, unknown>))) return empty;

  const rawObj = raw as Record<string, unknown>;
  const rawFiles = rawObj.files as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) return empty;

  // Check if already in DiffPanel format (has 'path' and 'hunks')
  const first = rawFiles[0] as Record<string, unknown> | undefined;
  if (first && typeof first.path === 'string' && Array.isArray(first.hunks)) {
    // Already correct format — pass through with stats
    const stats = rawObj.stats as { filesChanged: number; additions: number; deletions: number } | undefined;
    return {
      files: rawFiles as unknown as import('../../components/Assessment/DiffPanel').DiffFile[],
      stats: stats ?? {
        filesChanged: rawFiles.length,
        additions: rawFiles.reduce((s, f) => s + (Number(f.additions) || 0), 0),
        deletions: rawFiles.reduce((s, f) => s + (Number(f.deletions) || 0), 0),
      },
    };
  }

  // GitHub format — transform
  const files: import('../../components/Assessment/DiffPanel').DiffFile[] = rawFiles.map((f) => {
    const filename = (f.filename as string) || (f.path as string) || '(unknown)';
    const additions = Number(f.additions) || 0;
    const deletions = Number(f.deletions) || 0;
    const patch = typeof f.patch === 'string' ? f.patch : '';
    const status: 'added' | 'modified' | 'deleted' =
      deletions === 0 && additions > 0 ? 'added' : additions === 0 && deletions > 0 ? 'deleted' : 'modified';

    return { path: filename, status, additions, deletions, hunks: parsePatchToHunks(patch) };
  });

  return {
    files,
    stats: {
      filesChanged: files.length,
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
    },
  };
}

const ConnectedDiffPanel = connectInterview(DiffPanel, (ctx) => {
  const raw = ctx.currentChallenge.data.cachedDiffJson;
  const diff = normalizeDiffJson(raw);

  return {
    diff,
    annotations: (ctx.submission.annotations as Annotation[]) ?? [],
    onAnnotationAdd: (a: { file: string; line: number; severity: 'critical' | 'major' | 'minor'; comment: string }) => {
      const annotation: Annotation = {
        ...a,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      ctx.updateSubmission({
        annotations: [...((ctx.submission.annotations as Annotation[]) ?? []), annotation],
      });
    },
  };
});

const ConnectedVerdictPanel = connectInterview(VerdictPanel, (ctx) => ({
  annotations: (ctx.submission.annotations as Array<{ id: string; file: string; line: number; severity: 'critical' | 'major' | 'minor'; comment: string; createdAt: string }>) ?? [],
  verdict: (ctx.submission.verdict as string | null) ?? null,
  summary: (ctx.submission.summary as string) ?? '',
  onVerdictChange: (verdict: string) => ctx.updateSubmission({ verdict }),
  onSummaryChange: (summary: string) => ctx.updateSubmission({ summary }),
}));

// ConnectedConversationPanel removed — replaced by ReviewConversationPanel
// which uses useReviewSession() hook for real RPC calls instead of stubs.

const ConnectedVoicePanel = connectInterview(VoicePanel, (ctx) => ({
  question: (ctx.currentChallenge.data.question as string) || ctx.currentChallenge.title,
  transcript: (ctx.submission.text as string) || '',
  onTranscriptChange: (text: string) => ctx.updateSubmission({ text, inputMode: 'voice' }),
}));

// CODE_IMPLEMENTATION connected panels

const ConnectedCodeEditorPanel = connectInterview(CodeEditorPanel, (ctx) => {
  const starterFiles: VirtualFS = (ctx.currentChallenge.data.files as VirtualFS)
    ?? legacyToVFS(ctx.currentChallenge.data);
  const submittedFiles = (ctx.submission.files as Record<string, string>) ?? {};

  return {
    starterFiles,
    submittedFiles,
    onFileChange: (path: string, content: string) => {
      const current = (ctx.submission.files as Record<string, string>) ?? {};
      ctx.updateSubmission({ files: { ...current, [path]: content } });
    },
  };
});

const ConnectedRunConsolePanel = connectInterview(RunConsolePanel, (ctx) => {
  const starterFiles: VirtualFS = (ctx.currentChallenge.data.files as VirtualFS)
    ?? legacyToVFS(ctx.currentChallenge.data);
  const submittedFiles = (ctx.submission.files as Record<string, string>) ?? {};
  const candidateFS = mergeSubmissionIntoFS(starterFiles, submittedFiles);
  const sampleTestFiles = (ctx.currentChallenge.data.sampleTestFiles as VirtualFS) ?? {};
  const language = String(ctx.currentChallenge.data.language ?? 'javascript').toLowerCase();

  return {
    candidateFiles: candidateFS,
    sampleTestFiles,
    language,
    onRunComplete: (result) => {
      ctx.setRunState({
        status: result.status === 'success' ? 'success' : 'error',
        logs: result.logs,
        ...(result.error ? { error: result.error } : {}),
        durationMs: result.durationMs,
      });
    },
  };
});

const ConnectedCodePreviewPanel = connectInterview(PreviewPanel, (ctx) => {
  const starterFiles: VirtualFS = (ctx.currentChallenge.data.files as VirtualFS)
    ?? legacyToVFS(ctx.currentChallenge.data);
  const submittedFiles = (ctx.submission.files as Record<string, string>) ?? {};
  const merged = mergeSubmissionIntoFS(starterFiles, submittedFiles);

  return {
    virtualFS: merged,
    hideHeader: true,
  };
});

// ---------------------------------------------------------------------------
// Component map — flat type → component lookup
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const COMPONENT_MAP: Record<string, ComponentType<any>> = {
  // Shells
  'timer': TimerShell,
  'video': VideoShell,

  // Connected panels
  'problem': ConnectedProblemPanel,
  'monaco': ConnectedMonacoPanel,
  'options': ConnectedOptionsPanel,
  'textarea': ConnectedTextareaPanel,
  'preview': ConnectedPreviewPanel,
  'diff': ConnectedDiffPanel,
  'verdict': ConnectedVerdictPanel,
  'conversation': ReviewConversationPanel,
  'voice': ConnectedVoicePanel,

  // CODE_IMPLEMENTATION panels
  'code-editor': ConnectedCodeEditorPanel,
  'console': ConnectedRunConsolePanel,
  'code-preview': ConnectedCodePreviewPanel,

  // Layouts
  'workspace': WorkspaceLayout,
  'fullbleed': FullBleedLayout,
  'code-workspace': CodeWorkspaceLayout,
  'code-browser': CodeBrowserLayout,
};
