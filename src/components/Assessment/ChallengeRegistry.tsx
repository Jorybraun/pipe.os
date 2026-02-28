import { useState, ReactNode, useMemo, useEffect } from 'react';
import { resolveLayout, PanelType } from '../../lib/challenge/resolveLayout';
import { resolveShells } from '../../lib/challenge/resolveShells';
import { WorkspaceLayout } from './WorkspaceLayout';
import { TimerShell } from '../Shells/TimerShell';
import { ProblemPanel } from '../Panels/ProblemPanel';
import { MonacoPanel } from '../Panels/MonacoPanel';
import { OptionsPanel } from '../Panels/OptionsPanel';
import { TextareaPanel } from '../Panels/TextareaPanel';
import { DiffAnnotationPanel } from '../Panels/DiffAnnotationPanel';
import { PreviewPanel } from '../Panels/PreviewPanel';

// ============================================================================
// Types
// ============================================================================

interface ChallengeRegistryProps {
  challenge: {
    id: string;
    type: string | null;
    title: string;
    instructions: string | null;
    config: any;
    codeArtifact?: any;
  };
  stageTimeLimit?: number | null;
  onSubmissionChange: (submission: any) => void;
  onSubmit: (submission: any) => void;
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
      ? JSON.parse(challenge.config) 
      : (challenge.config || {});
  }, [challenge.config]);

  // Submission State
  const [submission, setSubmission] = useState<any>(() => {
    if (challenge.type === 'QUIZ_MCQ') return { answers: {} };
    if (challenge.type === 'CODE_REVIEW') return { annotations: {} };
    if (challenge.type === 'QUIZ_SHORT_ANSWER') return { text: '' };
    if (challenge.type === 'CODE_IMPLEMENTATION') return { code: config.starterCode || '' };
    return {};
  });

  // Notify parent of submission changes
  useEffect(() => {
    onSubmissionChange(submission);
  }, [submission, onSubmissionChange]);

  // ---------------------------------------------------------------------------
  // Panel Rendering
  // ---------------------------------------------------------------------------

  const renderPanel = (panelType: PanelType | null): ReactNode => {
    if (!panelType) return null;

    switch (panelType) {
      case 'problem':
        return (
          <ProblemPanel
            markdown={challenge.instructions || 'No instructions provided.'}
            prDescription={config.prDescription}
            examples={config.examples}
            constraints={config.constraints}
            linkedArtifact={config.originalCode ? {
              label: 'View original code',
              code: config.originalCode,
              language: config.language || 'javascript'
            } : undefined}
          />
        );

      case 'monaco':
        return (
          <MonacoPanel
            language={config.language || 'javascript'}
            value={submission.code || config.starterCode || ''}
            onChange={(code) => setSubmission((prev: any) => ({ ...prev, code }))}
          />
        );

      case 'options':
        return (
          <OptionsPanel
            question={config.question || challenge.title}
            options={config.options || []}
            selectedId={submission.answers?.current || null}
            onSelect={(id) => setSubmission((prev: any) => ({ ...prev, answers: { current: id } }))}
          />
        );

      case 'textarea':
        return (
          <TextareaPanel
            question={config.question || challenge.title}
            value={submission.text || ''}
            onChange={(text) => setSubmission((prev: any) => ({ ...prev, text }))}
            maxLength={config.maxLength}
          />
        );

      case 'diff-annotation': {
        const artifact = challenge.codeArtifact;
        
        // Snippets can come from: 
        // 1. A linked CodeArtifact model (Phase 7+)
        // 2. The challenge.config.code field (cloned from template)
        // 3. The challenge.config.snippets array (Legacy/other)
        let rawSnippets: any[] = [];
        
        if (config.code) {
          rawSnippets = [config];
        } else if (artifact) {
          rawSnippets = [artifact];
        } else if (Array.isArray(config.snippets)) {
          rawSnippets = config.snippets;
        }

        console.log('[ChallengeRegistry] Mapping snippets for DiffView:', { 
          count: rawSnippets.length, 
          source: artifact ? 'artifact' : config.code ? 'config.code' : 'config.snippets' 
        });

        return (
          <DiffAnnotationPanel
            snippets={rawSnippets.map((s: any, i: number) => ({
              id: s.id || `snippet-${i}`,
              title: s.title || challenge.title || 'File for Review',
              code: s.code || '',
              language: s.language || 'javascript'
            }))}
            onAnnotationsChange={(annotations) => setSubmission((prev: any) => ({ ...prev, annotations }))}
          />
        );
      }

      case 'preview':
        return (
          <PreviewPanel 
            code={submission.code || config.starterCode || ''} 
            language={config.language || 'javascript'} 
          />
        );

      case 'tests':
        return (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Mono', fontSize: 10 }}>
            TEST_PANEL_COMING_SOON
          </div>
        );

      default:
        return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Assembly
  // ---------------------------------------------------------------------------

  const workspace = (
    <WorkspaceLayout
      leftPanel={renderPanel(layout.leftPanel)}
      centerPanel={renderPanel(layout.centerPanel) as ReactNode}
      rightPanel={renderPanel(layout.rightPanel)}
    />
  );

  // Wrap with shells
  let content = workspace;

  if (shells.timer.enabled) {
    content = (
      <TimerShell
        timeLimit={shells.timer.timeLimit}
        onExpire={() => onSubmit(submission)}
      >
        {content}
      </TimerShell>
    );
  }

  // Future: if (shells.recording.enabled) content = <RecordingShell>{content}</RecordingShell>

  return content;
}
