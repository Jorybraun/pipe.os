import { useState, ReactNode, useMemo, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import { resolveLayout, PanelType } from '../../lib/challenge/resolveLayout';
import { resolveShells } from '../../lib/challenge/resolveShells';
import { WorkspaceLayout } from './WorkspaceLayout';
import { TimerShell } from '../Shells/TimerShell';
import { ProblemPanel } from '../Panels/ProblemPanel';
import { MonacoPanel } from '../Panels/MonacoPanel';
import { OptionsPanel } from '../Panels/OptionsPanel';
import { TextareaPanel } from '../Panels/TextareaPanel';
import { DiffPanel, type DiffJson, type Annotation } from '../Assessment/DiffPanel';
import { PreviewPanel } from '../Panels/PreviewPanel';
import { CodeReviewChallenge } from './CodeReviewChallenge';

// Client for on-demand diff fetch (uses default auth mode)
const diffClient = generateClient<Schema>();

// ============================================================================
// Types
// ============================================================================

interface ChallengeRegistryProps {
  challenge: {
    id: string;
    type: string | null;
    title: string;
    instructions: string | null;
    config: unknown;
    codeArtifact?: unknown;
    cachedDiffJson?: unknown;
    githubPrTitle?: string | null;
    githubRepoUrl?: string | null;
    githubPrNumber?: number | null;
    githubPrDescription?: string | null;
    cachedMetadata?: unknown;
  };
  stageTimeLimit?: number | null;
  onSubmissionChange: (submission: unknown) => void;
  onSubmit: (submission: unknown) => void;
}

// ============================================================================
// Helpers
// ============================================================================

/** Convert fetchGitHubPR wire format (lineNumber) → DiffPanel format (num) */
function parseDiffJson(raw: unknown): DiffJson | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as {
    files?: Array<{
      path: string;
      status: string;
      additions: number;
      deletions: number;
      hunks: Array<{
        header: string;
        lines: Array<{ type: string; lineNumber: number; content: string }>;
      }>;
    }>;
  };
  if (!r.files?.length) return null;
  return {
    files: r.files.map((f) => ({
      path: f.path,
      status: f.status as 'added' | 'modified' | 'deleted',
      additions: f.additions,
      deletions: f.deletions,
      hunks: f.hunks.map((h) => ({
        header: h.header,
        lines: h.lines.map((l) => ({
          type: l.type as 'addition' | 'deletion' | 'context',
          num: l.lineNumber,
          content: l.content,
        })),
      })),
    })),
    stats: {
      filesChanged: r.files.length,
      additions: r.files.reduce((s, f) => s + f.additions, 0),
      deletions: r.files.reduce((s, f) => s + f.deletions, 0),
    },
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * ChallengeRegistry - Assembler that composes shells and panels for a challenge.
 * This is the primary entry point for rendering any challenge type.
 */
export function ChallengeRegistry({
  challenge,
  stageTimeLimit,
  onSubmissionChange,
  onSubmit,
}: ChallengeRegistryProps): JSX.Element {
  const layout = useMemo(() => resolveLayout(challenge), [challenge]);
  const shells = useMemo(() => resolveShells(challenge, stageTimeLimit), [challenge, stageTimeLimit]);

  const config = useMemo(() => {
    return typeof challenge.config === 'string'
      ? (JSON.parse(challenge.config) as Record<string, unknown>)
      : ((challenge.config ?? {}) as Record<string, unknown>);
  }, [challenge.config]);

  // Diff state (CODE_REVIEW only)
  const [localDiff, setLocalDiff] = useState<DiffJson | null>(null);
  const [isFetchingDiff, setIsFetchingDiff] = useState(false);

  // Submission State
  const [submission, setSubmission] = useState<Record<string, unknown>>(() => {
    if (challenge.type === 'QUIZ_MCQ') return { answers: {} };
    if (challenge.type === 'CODE_REVIEW') return { annotations: [], verdict: null, summary: '' };
    if (challenge.type === 'QUIZ_SHORT_ANSWER') return { text: '' };
    if (challenge.type === 'CODE_IMPLEMENTATION')
      return { code: (config.starterCode as string) || '' };
    return {};
  });

  // Notify parent of submission changes
  useEffect(() => {
    onSubmissionChange(submission);
  }, [submission, onSubmissionChange]);

  // On-demand diff fetch for CODE_REVIEW when cachedDiffJson is absent
  useEffect(() => {
    if (challenge.type !== 'CODE_REVIEW') return;

    // Try to parse cachedDiffJson first
    if (challenge.cachedDiffJson) {
      const parsed = parseDiffJson(
        typeof challenge.cachedDiffJson === 'string'
          ? (JSON.parse(challenge.cachedDiffJson) as unknown)
          : challenge.cachedDiffJson
      );
      if (parsed) {
        setLocalDiff(parsed);
        return;
      }
    }

    // Fall back to on-demand fetch if repo/PR info available
    if (!challenge.githubRepoUrl || !challenge.githubPrNumber) return;

    setIsFetchingDiff(true);
    void (async () => {
      try {
        const result = await diffClient.mutations.fetchGitHubPR({
          repoUrl: challenge.githubRepoUrl!,
          prNumber: challenge.githubPrNumber!,
          skipCache: false,
        });
        const payload = result.data as {
          success?: boolean;
          data?: { diff?: unknown };
        } | null;
        if (payload?.success && payload.data?.diff) {
          const parsed = parseDiffJson(payload.data.diff);
          if (parsed) setLocalDiff(parsed);
        }
      } catch (err) {
        console.error('[ChallengeRegistry] fetchGitHubPR failed:', err);
      } finally {
        setIsFetchingDiff(false);
      }
    })();
    // Run once per challenge id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge.id]);

  // ---------------------------------------------------------------------------
  // CODE_REVIEW bypass — renders its own 3-column layout
  // ---------------------------------------------------------------------------

  if (challenge.type === 'CODE_REVIEW') {
    const codeReviewContent = (
      <CodeReviewChallenge
        challenge={challenge}
        diff={localDiff}
        isFetchingDiff={isFetchingDiff}
        submission={
          submission as { annotations: Annotation[]; verdict: string | null; summary: string }
        }
        onSubmissionChange={(s) => {
          setSubmission(s as Record<string, unknown>);
        }}
        onSubmit={onSubmit}
      />
    );

    if (shells.timer.enabled) {
      return (
        <TimerShell
          timeLimit={shells.timer.timeLimit}
          onExpire={() => onSubmit(submission)}
        >
          {codeReviewContent}
        </TimerShell>
      );
    }
    return codeReviewContent;
  }

  // ---------------------------------------------------------------------------
  // Panel Rendering (non-CODE_REVIEW)
  // ---------------------------------------------------------------------------

  const renderPanel = (panelType: PanelType | null): ReactNode => {
    if (!panelType) return null;

    switch (panelType) {
      case 'problem': {
        // Safely extract typed props from unknown config blob
        const prDesc = typeof config.prDescription === 'string' ? config.prDescription : undefined;
        const constraints = Array.isArray(config.constraints)
          ? (config.constraints as string[]).filter((c): c is string => typeof c === 'string')
          : undefined;
        const examples = Array.isArray(config.examples)
          ? (config.examples as Array<{ input: string; output: string; explanation?: string }>).filter(
              (e): e is { input: string; output: string; explanation?: string } =>
                typeof e === 'object' &&
                e !== null &&
                typeof (e as Record<string, unknown>).input === 'string' &&
                typeof (e as Record<string, unknown>).output === 'string'
            )
          : undefined;
        return (
          <ProblemPanel
            markdown={challenge.instructions || 'No instructions provided.'}
            {...(prDesc !== undefined ? { prDescription: prDesc } : {})}
            {...(examples !== undefined ? { examples } : {})}
            {...(constraints !== undefined ? { constraints } : {})}
            {...(config.originalCode
              ? {
                  linkedArtifact: {
                    label: 'View original code',
                    code: config.originalCode as string,
                    language: (config.language as string) || 'javascript',
                  },
                }
              : {})}
          />
        );
      }

      case 'monaco':
        return (
          <MonacoPanel
            language={(config.language as string) || 'javascript'}
            value={(submission.code as string) || (config.starterCode as string) || ''}
            onChange={(code) =>
              setSubmission((prev) => ({ ...prev, code }))
            }
          />
        );

      case 'options': {
        // Normalize options to { id, text } shape — config may store as strings or objects
        const rawOptions = Array.isArray(config.options) ? config.options : [];
        const normalizedOptions = rawOptions.map((o, i) =>
          typeof o === 'string'
            ? { id: String(i), text: o }
            : (o as { id: string; text: string })
        );
        return (
          <OptionsPanel
            question={(config.question as string) || challenge.title}
            options={normalizedOptions}
            selectedId={
              (submission.answers as Record<string, string> | undefined)?.current ?? null
            }
            onSelect={(id) =>
              setSubmission((prev) => ({
                ...prev,
                answers: { current: id },
              }))
            }
          />
        );
      }

      case 'textarea': {
        const maxLen = typeof config.maxLength === 'number' ? config.maxLength : undefined;
        return (
          <TextareaPanel
            question={(config.question as string) || challenge.title}
            value={(submission.text as string) || ''}
            onChange={(text) => setSubmission((prev) => ({ ...prev, text }))}
            {...(maxLen !== undefined ? { maxLength: maxLen } : {})}
          />
        );
      }

      case 'diff-annotation': {
        // This path is only reached for non-CODE_REVIEW types that might
        // use a diff panel (unlikely in practice but kept for completeness)
        const raw = challenge.cachedDiffJson
          ? (typeof challenge.cachedDiffJson === 'string'
              ? (JSON.parse(challenge.cachedDiffJson) as unknown)
              : challenge.cachedDiffJson)
          : null;

        const diffForPanel = parseDiffJson(raw);

        if (!diffForPanel) {
          return (
            <div
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                color: 'rgba(255,255,255,0.3)',
                fontFamily: 'Space Mono',
              }}
            >
              <div style={{ fontSize: 11, letterSpacing: '0.1em' }}>DIFF_LOADING</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
                The PR diff is being fetched. Refresh in a moment.
              </div>
            </div>
          );
        }

        return (
          <DiffPanel
            diff={diffForPanel}
            annotations={(submission.annotations as Annotation[]) ?? []}
            onAnnotationAdd={(a) => {
              const annotation: Annotation = {
                ...a,
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
              };
              setSubmission((prev) => ({
                ...prev,
                annotations: [
                  ...((prev.annotations as Annotation[]) ?? []),
                  annotation,
                ],
              }));
            }}
          />
        );
      }

      case 'preview':
        return (
          <PreviewPanel
            code={(submission.code as string) || (config.starterCode as string) || ''}
            language={(config.language as string) || 'javascript'}
          />
        );

      case 'tests':
        return (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'rgba(255,255,255,0.2)',
              fontFamily: 'Space Mono',
              fontSize: 10,
            }}
          >
            TEST_PANEL_COMING_SOON
          </div>
        );

      default:
        return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Assembly (non-CODE_REVIEW)
  // ---------------------------------------------------------------------------

  const workspace = (
    <WorkspaceLayout
      leftPanel={renderPanel(layout.leftPanel)}
      centerPanel={renderPanel(layout.centerPanel) as ReactNode}
      rightPanel={renderPanel(layout.rightPanel)}
    />
  );

  let content = workspace;

  if (shells.timer.enabled) {
    content = (
      <TimerShell timeLimit={shells.timer.timeLimit} onExpire={() => onSubmit(submission)}>
        {content}
      </TimerShell>
    );
  }

  return content;
}
