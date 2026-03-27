import { useState, type ComponentType } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Skeleton } from '../components/ui/Skeleton';
import { useEditorChallenge } from '../hooks/useEditorChallenge';
import type { EditorFormProps } from '../components/Editor/types';

// Editor components
import { EditorHeader } from '../components/Editor/EditorHeader';
import { PreviewOverlay } from '../components/Editor/PreviewOverlay';
import { CodeImplEditor } from '../components/Editor/CodeImplEditor';
import { CodeReviewEditor } from '../components/Editor/CodeReviewEditor';
import { QuizMCQEditor } from '../components/Editor/QuizMCQEditor';
import { ShortAnswerEditor } from '../components/Editor/ShortAnswerEditor';
import { FollowUpEditor } from '../components/Editor/FollowUpEditor';

// ---------------------------------------------------------------------------
// Form map — type string → editor component
// ---------------------------------------------------------------------------

const EDITOR_FORM_MAP: Record<string, ComponentType<EditorFormProps>> = {
  CODE_IMPLEMENTATION: CodeImplEditor,
  QUIZ_MCQ: QuizMCQEditor,
  QUIZ_SHORT_ANSWER: ShortAnswerEditor,
  FOLLOW_UP: FollowUpEditor,
  // CODE_REVIEW handled separately (needs extra props)
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChallengeEditorPage(): JSX.Element {
  const { id: pipelineId, challengeId } = useParams<{ id: string; challengeId: string }>();
  const navigate = useNavigate();

  const {
    challenge,
    setChallenge,
    isLoading,
    isSaving,
    prFetched,
    setPrFetched,
    groundTruthAnnotations,
    setGroundTruthAnnotations,
    handleSave,
    handleClone,
  } = useEditorChallenge(challengeId, pipelineId);

  const [previewMode, setPreviewMode] = useState<'closed' | 'challenge' | 'stage'>('closed');

  // -------------------------------------------------------------------------
  // Loading / empty states
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div style={{ padding: 40 }}>
        <Skeleton width={200} height={32} style={{ marginBottom: 40 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>
          <Skeleton height={600} />
          <Skeleton height={600} />
        </div>
      </div>
    );
  }

  if (!challenge) return <div>Challenge not found.</div>;

  // -------------------------------------------------------------------------
  // Render form — map lookup or special case for CODE_REVIEW
  // -------------------------------------------------------------------------

  const Form = EDITOR_FORM_MAP[challenge.type];

  let formContent: JSX.Element;
  if (challenge.type === 'CODE_REVIEW') {
    formContent = (
      <CodeReviewEditor
        challenge={challenge}
        onChange={setChallenge}
        prFetched={prFetched}
        onPrFetchedChange={setPrFetched}
        groundTruthAnnotations={groundTruthAnnotations}
        onGroundTruthChange={setGroundTruthAnnotations}
      />
    );
  } else if (Form) {
    formContent = <Form challenge={challenge} onChange={setChallenge} />;
  } else {
    formContent = (
      <div style={{ padding: 40, border: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center', marginTop: 12 }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>
          No editor available for type: {challenge.type}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={{ paddingBottom: 100 }}>
      <EditorHeader
        challenge={challenge}
        onChange={setChallenge}
        isSaving={isSaving}
        isRunning={false}
        onBack={() => navigate(-1)}
        onRunTests={() => {/* handled internally by CodeImplEditor */}}
        onPreview={() => setPreviewMode('challenge')}
        {...(challenge.stageId ? { onPreviewStage: () => setPreviewMode('stage') } : {})}
        onClone={handleClone}
        onSave={handleSave}
      />

      {formContent}

      {previewMode !== 'closed' && (
        <PreviewOverlay
          challenge={challenge}
          onClose={() => setPreviewMode('closed')}
          {...(previewMode === 'stage' ? { stageMode: true } : {})}
        />
      )}
    </div>
  );
}
