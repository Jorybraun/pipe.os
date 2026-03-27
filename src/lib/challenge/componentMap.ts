import type { ComponentType } from 'react';
import { connectInterview } from './connectInterview';

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
import { DiffPanel, type Annotation } from '../../components/Assessment/DiffPanel';
import { VoicePanel } from '../../components/Panels/VoicePanel';

// Layouts
import { WorkspaceLayout } from '../../components/Assessment/WorkspaceLayout';
import { FullBleedLayout } from '../../components/Assessment/FullBleedLayout';

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

const ConnectedDiffPanel = connectInterview(DiffPanel, (ctx) => {
  // Parse cachedDiffJson if available
  const raw = ctx.currentChallenge.data.cachedDiffJson;
  const diff = (typeof raw === 'object' && raw !== null && 'files' in (raw as Record<string, unknown>))
    ? raw as { files: unknown[]; stats: { filesChanged: number; additions: number; deletions: number } }
    : { files: [], stats: { filesChanged: 0, additions: 0, deletions: 0 } };

  return {
    diff: diff as import('../../components/Assessment/DiffPanel').DiffJson,
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

const ConnectedVoicePanel = connectInterview(VoicePanel, (ctx) => ({
  question: (ctx.currentChallenge.data.question as string) || ctx.currentChallenge.title,
  transcript: (ctx.submission.text as string) || '',
  onTranscriptChange: (text: string) => ctx.updateSubmission({ text, inputMode: 'voice' }),
}));

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
  'voice': ConnectedVoicePanel,

  // Layouts
  'workspace': WorkspaceLayout,
  'fullbleed': FullBleedLayout,

  // TODO: connect these
  // 'voice': ConnectedVoicePanel,
  // 'video-submission': ConnectedVideoSubmissionPanel,
  // 'follow-up': ConnectedFollowUpPanel,
  // 'console': ConnectedConsolePanel,
  // 'tests': ConnectedTestsPanel,
  // 'workspace-browser': BrowserLayout,
  // 'fullbleed': FullBleedLayout,
};
