import { type ComponentType, createElement } from 'react';
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
import { ReviewTabPanel } from '../../components/Panels/ReviewTabPanel';
import { ReviewLeftPanel } from '../../components/Panels/ReviewLeftPanel';
import { FileViewerPanel } from '../../components/Panels/FileViewerPanel';
import { DiffPanel, type Annotation, type InlineThread, type ResolvedLine } from '../../components/Assessment/DiffPanel';
import type { ReviewRound } from '../../types/conversation';
import { VoicePanel } from '../../components/Panels/VoicePanel';
import { CodeEditorPanel } from '../../components/Panels/CodeEditorPanel';
import { RunConsolePanel } from '../../components/Panels/RunConsolePanel';
import { DevContainerPanel } from '../../components/Panels/DevContainerPanel';

// Layouts
import { WorkspaceLayout } from '../../components/Assessment/WorkspaceLayout';
import { FullBleedLayout } from '../../components/Assessment/FullBleedLayout';
import { CodeWorkspaceLayout } from '../../components/Assessment/CodeWorkspaceLayout';
import { CodeBrowserLayout } from '../../components/Assessment/CodeBrowserLayout';

// Synthetic challenge panels
import { WelcomeScreen } from '../../components/Assessment/WelcomeScreen';

// ---------------------------------------------------------------------------
// Connected panels — HOC wrappers that bridge InterviewContext → panel props
// ---------------------------------------------------------------------------

const ConnectedProblemPanel = connectInterview(ProblemPanel, (ctx) => ({
  markdown: ctx.currentChallenge.instructions || 'No instructions provided.',
  ...(typeof ctx.currentChallenge.data.prDescription === 'string'
    ? { prDescription: ctx.currentChallenge.data.prDescription }
    : {}),
  ...(ctx.currentChallenge.data.issueBody
    ? { issueBody: ctx.currentChallenge.data.issueBody as { title?: string | null; body?: string | null; labels?: string[] } }
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
export function normalizeDiffJson(raw: unknown): import('../../components/Assessment/DiffPanel').DiffJson {
  const empty: import('../../components/Assessment/DiffPanel').DiffJson = {
    files: [], stats: { filesChanged: 0, additions: 0, deletions: 0 },
  };
  if (typeof raw !== 'object' || raw === null || !('files' in (raw as Record<string, unknown>))) return empty;

  const rawObj = raw as Record<string, unknown>;
  const rawFiles = rawObj.files as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) return empty;

  // Check if already in DiffPanel format (has 'path' or 'filename', and 'hunks' array)
  const first = rawFiles[0] as Record<string, unknown> | undefined;
  const hasStructuredHunks = first && Array.isArray(first.hunks) &&
    (first.hunks as unknown[]).length > 0 &&
    typeof ((first.hunks as Array<Record<string, unknown>>)[0]?.lines) === 'object';

  if (hasStructuredHunks) {
    // Worker format (filename + structured hunks) or DiffPanel format (path + hunks)
    // Normalize to DiffPanel format: path, status, hunks with {type, num, content}
    const mapType = (t: string): 'addition' | 'deletion' | 'context' => {
      if (t === 'added' || t === 'addition') return 'addition';
      if (t === 'removed' || t === 'deletion') return 'deletion';
      return 'context';
    };

    const files: import('../../components/Assessment/DiffPanel').DiffFile[] = rawFiles.map((f) => {
      const path = (f.path as string) || (f.filename as string) || '(unknown)';
      const additions = Number(f.additions) || 0;
      const deletions = Number(f.deletions) || 0;
      const status = (f.status as 'added' | 'modified' | 'deleted') ??
        (deletions === 0 && additions > 0 ? 'added' : additions === 0 && deletions > 0 ? 'deleted' : 'modified');
      const hunks = (f.hunks as Array<Record<string, unknown>>).map((h) => ({
        header: (h.header as string) || '',
        lines: (Array.isArray(h.lines) ? h.lines as Array<Record<string, unknown>> : []).map((l, idx) => ({
          type: mapType((l.type as string) || ''),
          num: (l.lineNumber as number) ?? (l.num as number) ?? (idx + 1),
          content: (l.content as string) ?? '',
        })),
      }));
      return { path, status, additions, deletions, hunks };
    });

    const stats = rawObj.stats as { filesChanged: number; additions: number; deletions: number } | undefined;
    return {
      files,
      stats: stats ?? {
        filesChanged: files.length,
        additions: files.reduce((s, f) => s + f.additions, 0),
        deletions: files.reduce((s, f) => s + f.deletions, 0),
      },
    };
  }

  // Legacy GitHub format (raw patch string) — transform
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

/**
 * Build InlineThread[] from rounds data by matching ReviewComments to file+line.
 * This lets the DiffPanel show implementer responses nested under annotations.
 */
function buildInlineThreads(rounds: ReviewRound[]): InlineThread[] {
  // Map comment_id → { file, line }
  const commentLocations = new Map<number, { file: string; line: number }>();
  // Map file:line → exchanges
  const threadMap = new Map<string, InlineThread>();

  for (const round of rounds) {
    for (const comment of round.reviewer_comments) {
      if (comment.file && comment.line != null) {
        commentLocations.set(comment.id, { file: comment.file, line: comment.line });
      }
    }
    for (const resp of round.implementer_responses) {
      const loc = commentLocations.get(resp.to_comment_id);
      if (!loc) continue;
      const key = `${loc.file}:${loc.line}`;
      if (!threadMap.has(key)) {
        threadMap.set(key, { file: loc.file, line: loc.line, exchanges: [] });
      }
      threadMap.get(key)!.exchanges.push({
        actor: 'implementer',
        move: resp.move,
        content: resp.content,
        round: round.round,
        ...(typeof resp.updated_code === 'string' ? { updated_code: resp.updated_code } : {}),
      });
    }
  }

  return Array.from(threadMap.values());
}

/** ResolvedLine[] from explicitly accepted changes */
function buildResolvedLines(acceptedLines: ResolvedLine[]): ResolvedLine[] {
  return [...acceptedLines];
}

const ConnectedDiffPanel = connectInterview(DiffPanel, (ctx) => {
  const raw = ctx.currentChallenge.data.cachedDiffJson;
  const diff = normalizeDiffJson(raw);
  const rounds = (ctx.submission.rounds as ReviewRound[]) ?? [];
  const acceptedLines = (ctx.submission.acceptedLines as ResolvedLine[]) ?? [];

  return {
    diff,
    annotations: (ctx.submission.annotations as Annotation[]) ?? [],
    inlineThreads: buildInlineThreads(rounds),
    resolvedLines: buildResolvedLines(acceptedLines),
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
    onAcceptChange: (file: string, line: number) => {
      const current = (ctx.submission.acceptedLines as ResolvedLine[]) ?? [];
      if (current.some(r => r.file === file && r.line === line)) return;
      ctx.updateSubmission({
        acceptedLines: [...current, { file, line }],
      });
    },
    onDeclineChange: (file: string, line: number, reason: string) => {
      const current = (ctx.submission.declinedChanges as Array<{ file: string; line: number; reason: string }>) ?? [];
      ctx.updateSubmission({
        declinedChanges: [...current, { file, line, reason }],
      });
    },
    inlineReplies: (ctx.submission.inlineReplies as Record<string, string>) ?? {},
    onInlineReplyChange: (file: string, line: number, value: string) => {
      const current = (ctx.submission.inlineReplies as Record<string, string>) ?? {};
      ctx.updateSubmission({
        inlineReplies: { ...current, [`${file}:${line}`]: value },
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

/** Center panel for code review — shows diff OR file viewer based on selectedFile */
const ConnectedReviewCenterPanel = connectInterview(
  // Wrapper that delegates to DiffPanel or FileViewerPanel
  function ReviewCenterSwitch(props: Record<string, unknown>) {
    const selectedFile = props._selectedFile as string | null;
    const challengeId = props._challengeId as string;
    const onBack = props._onBack as () => void;

    if (selectedFile) {
      const changedFiles = props._changedFiles as Set<string>;
      const isChanged = changedFiles.has(selectedFile);
      const onViewDiff = props._onViewDiff as (path: string) => void;
      return createElement(FileViewerPanel, { challengeId, filePath: selectedFile, onBack, isChanged, onViewDiff });
    }
    // Render the DiffPanel with all its props (strip our internal props)
    const { _selectedFile: _sf, _challengeId: _ci, _onBack: _ob, _changedFiles: _cf, _onViewDiff: _vd, ...diffProps } = props;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createElement(DiffPanel, diffProps as any);
  },
  (ctx) => {
    const raw = ctx.currentChallenge.data.cachedDiffJson;
    const diff = normalizeDiffJson(raw);
    const rounds = (ctx.submission.rounds as ReviewRound[]) ?? [];
    const acceptedLines = (ctx.submission.acceptedLines as ResolvedLine[]) ?? [];

    return {
      // DiffPanel props
      diff,
      annotations: (ctx.submission.annotations as Annotation[]) ?? [],
      inlineThreads: buildInlineThreads(rounds),
      resolvedLines: buildResolvedLines(acceptedLines),
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
      onAcceptChange: (file: string, line: number) => {
        const current = (ctx.submission.acceptedLines as ResolvedLine[]) ?? [];
        if (current.some(r => r.file === file && r.line === line)) return;
        ctx.updateSubmission({ acceptedLines: [...current, { file, line }] });
      },
      onDeclineChange: (file: string, line: number, reason: string) => {
        const current = (ctx.submission.declinedChanges as Array<{ file: string; line: number; reason: string }>) ?? [];
        ctx.updateSubmission({ declinedChanges: [...current, { file, line, reason }] });
      },
      inlineReplies: (ctx.submission.inlineReplies as Record<string, string>) ?? {},
      onInlineReplyChange: (file: string, line: number, value: string) => {
        const current = (ctx.submission.inlineReplies as Record<string, string>) ?? {};
        ctx.updateSubmission({ inlineReplies: { ...current, [`${file}:${line}`]: value } });
      },
      // View file from diff
      onViewFile: (path: string) => ctx.updateSubmission({ selectedFile: path }),
      // File viewer props
      _selectedFile: (ctx.submission.selectedFile as string | null) ?? null,
      _challengeId: (ctx.currentChallenge.data.id as string) ?? '',
      _onBack: () => ctx.updateSubmission({ selectedFile: null }),
      _changedFiles: new Set(diff.files.map((f: { path: string }) => f.path)),
      _onViewDiff: (_path: string) => {
        ctx.updateSubmission({ selectedFile: null });
      },
    };
  },
);

const ConnectedVoicePanel = connectInterview(VoicePanel, (ctx) => ({
  question: (ctx.currentChallenge.data.question as string) || ctx.currentChallenge.title,
  transcript: (ctx.submission.text as string) || '',
  onTranscriptChange: (text: string) => ctx.updateSubmission({ text, inputMode: 'voice' }),
  uploadUrl: '',
  sessionToken: null,
  challengeId: (ctx.currentChallenge.data.id as string) ?? '',
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

const ConnectedDevContainerPanel = connectInterview(DevContainerPanel, (ctx) => ({
  challengeId: ctx.currentChallenge.id,
}));

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

// Synthetic challenge panels — connected via InterviewContext
const ConnectedWelcomePanel = connectInterview(WelcomeScreen, (ctx) => ({
  pipelineName: ctx.currentChallenge.title || 'Technical Assessment',
  stageName: ctx.currentChallenge.title || 'Interview',
  challengeType: 'CODE_REVIEW' as const,
  onStart: () => ctx.submit(),
}));

// LIVE_VIDEO challenge panel
import { VideoInterviewStep } from '../../components/Video/VideoInterviewStep';

// AGENT_INTERVIEW challenge panel
import { AgentInterviewChallenge } from '../../components/Assessment/AgentInterviewChallenge';

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
  'conversation': ReviewTabPanel,
  'review-left': ReviewLeftPanel,
  'review-center': ConnectedReviewCenterPanel,
  'voice': ConnectedVoicePanel,

  // CODE_IMPLEMENTATION panels
  'code-editor': ConnectedCodeEditorPanel,
  'console': ConnectedRunConsolePanel,
  'code-preview': ConnectedCodePreviewPanel,
  'devcontainer': ConnectedDevContainerPanel,

  // Synthetic challenge panels
  'welcome': ConnectedWelcomePanel,
  'video-waiting': VideoInterviewStep,
  'agent-interview': AgentInterviewChallenge,

  // Layouts
  'workspace': WorkspaceLayout,
  'fullbleed': FullBleedLayout,
  'code-workspace': CodeWorkspaceLayout,
  'code-browser': CodeBrowserLayout,
};
