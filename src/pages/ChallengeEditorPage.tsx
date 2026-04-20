/**
 * ChallengeEditorPage — Phase 2 (Cloudflare migration)
 *
 * Replaces all Amplify data calls with Cloudflare Worker API calls via:
 *   useEditorChallengeV2 — load challenge
 *   useChallengeSave     — save + clone
 *
 * URL patterns:
 *   /pipeline/:id/challenges/:challengeId         — existing challenge
 *   /pipeline/:id/challenges/NEW_CODE_IMPLEMENTATION?stageId=... — new challenge
 *
 * No aws-amplify imports anywhere in this file.
 */

import { useState, useEffect, useCallback, type ComponentType } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, Save, Terminal, Settings } from 'lucide-react';
import { Skeleton } from '../components/ui/Skeleton';
import { useEditorChallengeV2 } from '../hooks/useEditorChallengeV2';
import { useChallengeSave } from '../hooks/useChallengeSave';
import type { EditorFormProps } from '../components/Editor/types';
import { ModeSelector } from '../components/Editor/ModeSelector';
import { FollowUpConfiguration } from '../components/Editor/FollowUpConfiguration';
import { SubTitle } from '../components';
import {
  createDefaultFS,
  createDefaultTestFS,
} from '../lib/challenge/virtualFS';

// Editor components
import { CodeImplEditor } from '../components/Editor/CodeImplEditor';
import { CodeReviewEditor } from '../components/Editor/CodeReviewEditor';
import { QuizMCQEditor } from '../components/Editor/QuizMCQEditor';
import { ShortAnswerEditor } from '../components/Editor/ShortAnswerEditor';
import { FollowUpEditor } from '../components/Editor/FollowUpEditor';

// ─── Form map — challenge type → editor component ──────────────────────────────

const EDITOR_FORM_MAP: Record<string, ComponentType<EditorFormProps>> = {
  CODE_IMPLEMENTATION: CodeImplEditor,
  QUIZ_MCQ: QuizMCQEditor,
  QUIZ_SHORT_ANSWER: ShortAnswerEditor,
  FOLLOW_UP: FollowUpEditor,
  // CODE_REVIEW handled separately
};

// ─── Tab type ──────────────────────────────────────────────────────────────────

type EditorTab = 'DETAILS' | 'CONTENT_EDITOR' | 'SCORING_RUBRIC';

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ChallengeEditorPage(): JSX.Element {
  const { id: pipelineId, challengeId } = useParams<{ id: string; challengeId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // stageId for NEW_* routes is passed as a query param.
  const stageIdFromQuery = searchParams.get('stageId') ?? undefined;

  const { challenge, setChallenge, isLoading, isNew, error } = useEditorChallengeV2(
    challengeId,
    pipelineId,
  );

  const { save, clone, isSaving, error: saveError } = useChallengeSave();

  const [activeTab, setActiveTab] = useState<EditorTab>('DETAILS');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // prFetched is false until the challenge loads; we sync it once on load
  // so that CODE_REVIEW challenges with cached PR data show the cached panel.
  const [prFetched, setPrFetched] = useState(false);
  const [prFetchedInitialised, setPrFetchedInitialised] = useState(false);

  useEffect(() => {
    if (!isLoading && challenge && !prFetchedInitialised) {
      setPrFetched(
        !!(
          challenge.githubRepoUrl &&
          challenge.githubPrNumber &&
          (challenge.cachedDiffJson || challenge.githubPrTitle)
        ),
      );
      setPrFetchedInitialised(true);
    }
  }, [isLoading, challenge, prFetchedInitialised]);
  const [groundTruthAnnotations, setGroundTruthAnnotations] = useState<Record<string, unknown[]>>(
    { senior: [], mid: [], junior: [] },
  );

  /**
   * Handle MODE switch for CODE_IMPLEMENTATION challenges.
   * Declared before early returns to satisfy Rules of Hooks.
   */
  const handleModeChange = useCallback((newMode: 'backend' | 'frontend'): void => {
    if (!challenge) return;
    const codeFiles = (challenge.config?.files as Record<string, unknown> | undefined) ?? {};
    const hasExistingFiles = Object.keys(codeFiles).length > 0;
    if (hasExistingFiles) {
      const confirmed = window.confirm(
        `Switch to ${newMode} mode? This will replace starter files with defaults.`,
      );
      if (!confirmed) return;
    }
    const defaults = createDefaultFS(newMode);
    const defaultTests = createDefaultTestFS(newMode);
    setChallenge({
      ...challenge,
      config: {
        ...challenge.config,
        mode: newMode,
        files: defaults,
        sampleTestFiles: {},
      },
      serverConfig: {
        ...challenge.serverConfig,
        hiddenTestFiles: defaultTests,
      },
    });
  }, [challenge, setChallenge]);

  // ─── Loading / error states ──────────────────────────────────────────────────

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

  if (error) {
    return (
      <div style={{ padding: 40, color: '#f87171', fontFamily: 'Space Mono' }}>
        Error loading challenge: {error}
      </div>
    );
  }

  if (!challenge) {
    return (
      <div style={{ padding: 40, color: 'var(--pipe-text-muted)', fontFamily: 'Space Mono' }}>
        Challenge not found.
      </div>
    );
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────────

  const handleSave = async (): Promise<void> => {
    if (!challenge) return;

    const stageId = challenge.stageId ?? stageIdFromQuery;
    const newId = await save(
      challenge.id,
      challenge,
      stageId,
      groundTruthAnnotations,
    );

    if (newId) {
      // Show success indicator briefly.
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);

      // If this was a new challenge, navigate to the real ID.
      if (isNew && newId !== challenge.id) {
        navigate(`/pipeline/${pipelineId}/challenges/${newId}`, { replace: true });
      }
    }
  };

  const handleClone = (): void => {
    if (!challenge || isNew) return;
    const newId = crypto.randomUUID().replace(/-/g, '');
    navigate(`/pipeline/${pipelineId}/challenges/${newId}`, {
      replace: true,
      state: { pendingTitle: `${challenge.title} (Clone)`, cloneOf: challenge.id },
    });
    void clone(challenge.id, newId);
  };

  // ─── Resolve form content for CONTENT_EDITOR tab ──────────────────────────────

  let contentEditorContent: JSX.Element;

  if (challenge.type === 'CODE_REVIEW') {
    contentEditorContent = (
      <CodeReviewEditor
        challenge={challenge}
        onChange={setChallenge}
        prFetched={prFetched}
        onPrFetchedChange={setPrFetched}
        groundTruthAnnotations={groundTruthAnnotations}
        onGroundTruthChange={setGroundTruthAnnotations}
      />
    );
  } else if (challenge.type === 'CODE_IMPLEMENTATION') {
    contentEditorContent = (
      <CodeImplEditor challenge={challenge} onChange={setChallenge} />
    );
  } else {
    const Form = EDITOR_FORM_MAP[challenge.type];
    if (Form) {
      contentEditorContent = <Form challenge={challenge} onChange={setChallenge} />;
    } else {
      contentEditorContent = (
        <div
          style={{
            marginTop: 24,
            padding: '40px',
            border: '1px dashed var(--pipe-border)',
            borderRadius: 12,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: 'var(--pipe-text-dim)',
              fontFamily: 'Space Mono',
            }}
          >
            Content authoring coming soon for type: {challenge.type}
          </div>
        </div>
      );
    }
  }

  // ─── Styles ───────────────────────────────────────────────────────────────────

  const headerBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 18px',
    background: 'var(--pipe-surface)',
    color: 'var(--pipe-text, #fff)',
    border: '1px solid var(--pipe-border)',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 800,
    fontFamily: 'Space Mono',
    cursor: 'pointer',
    letterSpacing: '0.05em',
  };

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    background: active ? 'var(--pipe-surface-hover)' : 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #fbbf24' : '2px solid transparent',
    color: active ? 'var(--pipe-text, #fff)' : 'var(--pipe-text-dim)',
    fontSize: 10,
    fontWeight: 700,
    fontFamily: 'Space Mono',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ paddingBottom: 100, maxWidth: 1400, margin: '0 auto', padding: '0 32px 100px' }}>

      {/* ─── PAGE HEADER ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
          paddingTop: 24,
          paddingBottom: 20,
          borderBottom: '1px solid var(--pipe-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              marginTop: 4,
              background: 'none',
              border: 'none',
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
            }}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            {/* Breadcrumb / type indicator */}
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                marginBottom: 8,
                fontFamily: 'Space Mono',
              }}
            >
              CHALLENGE_EDITOR / {challenge.type}
            </div>
            {/* Page title (h1) */}
            <h1
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 800,
                color: 'var(--pipe-text, #fff)',
                lineHeight: 1.2,
              }}
            >
              {challenge.title || '(untitled)'}
            </h1>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saveError && (
            <span
              data-testid="save-error"
              style={{
                fontSize: 10,
                color: '#f87171',
                fontFamily: 'Space Mono',
                letterSpacing: '0.1em',
              }}
            >
              SAVE_FAILED: {saveError}
            </span>
          )}
          {saveSuccess && (
            <span
              data-testid="save-success"
              style={{
                fontSize: 10,
                color: '#4ade80',
                fontFamily: 'Space Mono',
                letterSpacing: '0.1em',
              }}
            >
              SAVED
            </span>
          )}
          {!isNew && (
            <button onClick={handleClone} disabled={isSaving} style={headerBtnStyle}>
              <Copy size={16} />
              CLONE
            </button>
          )}
          <button
            data-testid="save-changes-button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            style={{ ...headerBtnStyle, background: '#fff', color: '#000', border: 'none' }}
          >
            <Save size={16} />
            {isSaving ? 'SAVING...' : 'SAVE_CHANGES'}
          </button>
        </div>
      </div>

      {/* ─── TAB BAR ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 24,
          borderBottom: '1px solid var(--pipe-border)',
        }}
      >
        <button
          onClick={() => setActiveTab('DETAILS')}
          style={tabBtnStyle(activeTab === 'DETAILS')}
        >
          DETAILS
        </button>
        <button
          onClick={() => setActiveTab('CONTENT_EDITOR')}
          style={tabBtnStyle(activeTab === 'CONTENT_EDITOR')}
        >
          CONTENT_EDITOR
        </button>
        <button
          onClick={() => setActiveTab('SCORING_RUBRIC')}
          style={tabBtnStyle(activeTab === 'SCORING_RUBRIC')}
        >
          SCORING_RUBRIC
        </button>
      </div>

      {/* ─── DETAILS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'DETAILS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 800 }}>

          {/* Challenge title field */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                fontFamily: 'Space Mono',
                marginBottom: 10,
              }}
            >
              CHALLENGE_TITLE
            </label>
            <input
              data-testid="challenge-title-input"
              value={challenge.title}
              onChange={(e) => setChallenge({ ...challenge, title: e.target.value })}
              placeholder="Challenge title..."
              style={{
                width: '100%',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 8,
                padding: '14px 18px',
                color: 'var(--pipe-text, #fff)',
                fontSize: 16,
                fontWeight: 700,
                fontFamily: 'inherit',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
            />
          </div>

          {/* Instructions field */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                fontFamily: 'Space Mono',
                marginBottom: 10,
              }}
            >
              INSTRUCTIONS
            </label>
            <textarea
              data-testid="challenge-instructions-input"
              value={challenge.instructions ?? ''}
              onChange={(e) => setChallenge({ ...challenge, instructions: e.target.value })}
              placeholder="Candidate-facing instructions (markdown supported)..."
              rows={10}
              style={{
                width: '100%',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 8,
                padding: '14px 18px',
                color: 'var(--pipe-text, #fff)',
                fontSize: 14,
                fontFamily: 'inherit',
                outline: 'none',
                resize: 'vertical',
                lineHeight: 1.6,
              }}
            />
          </div>

          {/* Time limit field */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                fontFamily: 'Space Mono',
                marginBottom: 10,
              }}
            >
              TIME_LIMIT (MINUTES)
            </label>
            <input
              type="number"
              value={(challenge.config?.timeLimit as number | undefined) ?? ''}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value, 10) : null;
                setChallenge({
                  ...challenge,
                  config: { ...challenge.config, timeLimit: val ?? undefined },
                });
              }}
              placeholder="Leave empty for untimed"
              style={{
                width: 200,
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 8,
                padding: '12px 16px',
                color: 'var(--pipe-text, #fff)',
                fontSize: 14,
                fontFamily: 'Space Mono',
                outline: 'none',
              }}
            />
          </div>


          {/* ── CODE_IMPLEMENTATION-specific config ──────────────────────── */}
          {challenge.type === 'CODE_IMPLEMENTATION' && (
            <>
              {/* Divider */}
              <div style={{ borderTop: '1px solid var(--pipe-border)', paddingTop: 8 }} />

              {/* MODE */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <Terminal size={14} style={{ color: 'var(--pipe-text-dim)' }} />
                  <SubTitle>MODE</SubTitle>
                </div>
                <ModeSelector
                  mode={(challenge.config?.mode as 'backend' | 'frontend') ?? 'backend'}
                  onChange={handleModeChange}
                />
              </div>

              {/* ENGINE */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <Settings size={14} style={{ color: 'var(--pipe-text-dim)' }} />
                  <SubTitle>ENGINE</SubTitle>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{
                    padding: 12,
                    background: 'var(--pipe-surface)',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 4,
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', marginBottom: 4 }}>
                      RUNTIME
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--pipe-text, #fff)', fontWeight: 700 }}>
                      {(challenge.config?.mode as string | undefined) === 'frontend'
                        ? 'Browser (Sandpack)'
                        : 'Node.js / V8'}
                    </div>
                  </div>
                  <div style={{
                    padding: 12,
                    background: 'var(--pipe-surface)',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 4,
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', marginBottom: 4 }}>
                      SCORING
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: 'Space Mono', lineHeight: 1.6 }}>
                      Sample 30% + Hidden 70%
                    </div>
                  </div>
                </div>
              </div>

              {/* FOLLOW_UP */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <Settings size={14} style={{ color: 'var(--pipe-text-dim)' }} />
                  <SubTitle>FOLLOW_UP</SubTitle>
                </div>
                <FollowUpConfiguration
                  enabled={!!challenge.config?.enableFollowUp}
                  onChange={(val) =>
                    setChallenge({
                      ...challenge,
                      config: { ...challenge.config, enableFollowUp: val },
                    })
                  }
                  accentColor="var(--pipe-accent)"
                />
              </div>
            </>
          )}

        </div>
      )}

      {/* ─── CONTENT_EDITOR TAB ──────────────────────────────────────────────── */}
      {activeTab === 'CONTENT_EDITOR' && contentEditorContent}

      {/* ─── SCORING_RUBRIC TAB ──────────────────────────────────────────────── */}
      {activeTab === 'SCORING_RUBRIC' && (
        <div style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              padding: '32px 40px',
              border: '1px dashed var(--pipe-border)',
              borderRadius: 12,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: 'var(--pipe-text-dim)',
                fontFamily: 'Space Mono',
                marginBottom: 16,
              }}
            >
              SCORING_CRITERIA
            </div>
            <textarea
              value={(challenge.serverConfig?.scoringRubric as string) ?? ''}
              onChange={(e) =>
                setChallenge({
                  ...challenge,
                  serverConfig: { ...challenge.serverConfig, scoringRubric: e.target.value },
                })
              }
              placeholder="Describe how this challenge should be scored..."
              rows={8}
              style={{
                width: '100%',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 8,
                padding: '14px 18px',
                color: 'var(--pipe-text, #fff)',
                fontSize: 14,
                fontFamily: 'inherit',
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </div>
        </div>
      )}


    </div>
  );
}
