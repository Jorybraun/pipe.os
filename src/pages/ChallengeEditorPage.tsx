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

type EditorTab = 'DETAILS' | 'CONTENT_EDITOR' | 'SCORING_RUBRIC' | 'CANDIDATE_PREVIEW';

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
      <div style={{ padding: 40, color: 'rgba(255,255,255,0.5)', fontFamily: 'Space Mono' }}>
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
            border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: 12,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.4)',
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
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 800,
    fontFamily: 'Space Mono',
    cursor: 'pointer',
    letterSpacing: '0.05em',
  };

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #fbbf24' : '2px solid transparent',
    color: active ? '#fff' : 'rgba(255,255,255,0.4)',
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

      {/* ─── PAGE HEADER (unmounted in CANDIDATE_PREVIEW so h1 doesn't create duplicate
               text matches that violate Playwright strict mode locator assertions) */}
      {activeTab !== 'CANDIDATE_PREVIEW' && <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
          paddingTop: 24,
          paddingBottom: 20,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              marginTop: 4,
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.4)',
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
                color: 'rgba(255,255,255,0.3)',
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
                color: '#fff',
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
      </div>}

      {/* ─── TAB BAR ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 24,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
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
        <button
          onClick={() => setActiveTab('CANDIDATE_PREVIEW')}
          style={tabBtnStyle(activeTab === 'CANDIDATE_PREVIEW')}
        >
          CANDIDATE_PREVIEW
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
                color: 'rgba(255,255,255,0.4)',
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
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '14px 18px',
                color: '#fff',
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
                color: 'rgba(255,255,255,0.4)',
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
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '14px 18px',
                color: '#fff',
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
                color: 'rgba(255,255,255,0.4)',
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
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '12px 16px',
                color: '#fff',
                fontSize: 14,
                fontFamily: 'Space Mono',
                outline: 'none',
              }}
            />
          </div>

          {/* ── CODE_REVIEW-specific config ──────────────────────────────── */}
          {challenge.type === 'CODE_REVIEW' && (
            <>
              {/* Divider */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }} />

              {/* MULTI_TURN */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <Settings size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
                  <SubTitle>MULTI_TURN</SubTitle>
                </div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <input
                    data-testid="multi-turn-toggle"
                    type="checkbox"
                    checked={!!(challenge.config?.isMultiTurn)}
                    onChange={(e) =>
                      setChallenge({
                        ...challenge,
                        config: {
                          ...challenge.config,
                          isMultiTurn: e.target.checked,
                          // Apply defaults when enabling for the first time
                          implementerPersona:
                            challenge.config?.implementerPersona ?? 'junior',
                          maxRounds:
                            challenge.config?.maxRounds ?? 4,
                        },
                      })
                    }
                    style={{
                      width: 16,
                      height: 16,
                      accentColor: '#60a5fa',
                      cursor: 'pointer',
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: 'rgba(255,255,255,0.6)',
                      fontFamily: 'Space Mono',
                    }}
                  >
                    Enable multi-turn conversation
                  </span>
                </label>
              </div>

              {/* ENABLE_EXPLAINER */}
              {!!(challenge.config?.isMultiTurn) && (
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      data-testid="enable-explainer-toggle"
                      checked={!!challenge.config?.enableExplainer}
                      onChange={(e) =>
                        setChallenge({
                          ...challenge,
                          config: { ...challenge.config, enableExplainer: e.target.checked },
                        })
                      }
                      style={{ accentColor: '#60a5fa' }}
                    />
                    <span style={{
                      fontSize: 11,
                      color: 'rgba(255,255,255,0.6)',
                      fontFamily: 'Space Mono',
                    }}>
                      Enable "Ask" tab (explainer agent)
                    </span>
                  </label>
                  <div style={{ marginTop: 6, fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono', lineHeight: 1.5, marginLeft: 24 }}>
                    Candidate can ask the PR author questions about architecture & design decisions.
                  </div>
                </div>
              )}

              {/* MAX_EXPLAINER_QUESTIONS (when explainer enabled) */}
              {!!(challenge.config?.enableExplainer) && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <Settings size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
                    <SubTitle>MAX_EXPLAINER_QUESTIONS</SubTitle>
                  </div>
                  <input
                    data-testid="max-explainer-questions-input"
                    type="number"
                    min={3}
                    max={10}
                    value={(challenge.config?.maxExplainerQuestions as number | undefined) ?? 6}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value, 10) : 6;
                      setChallenge({
                        ...challenge,
                        config: { ...challenge.config, maxExplainerQuestions: val },
                      });
                    }}
                    style={{
                      width: 120,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 8,
                      padding: '10px 14px',
                      color: '#fff',
                      fontSize: 13,
                      fontFamily: 'Space Mono',
                      outline: 'none',
                    }}
                  />
                  <div style={{ marginTop: 8, fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono' }}>
                    How many questions the candidate can ask the PR author.
                  </div>
                </div>
              )}

              {/* IMPLEMENTER_PERSONA */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <Settings size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
                  <SubTitle>IMPLEMENTER_PERSONA</SubTitle>
                </div>
                <select
                  data-testid="implementer-persona-select"
                  disabled={!challenge.config?.isMultiTurn}
                  value={(challenge.config?.implementerPersona as string | undefined) ?? 'junior'}
                  onChange={(e) =>
                    setChallenge({
                      ...challenge,
                      config: { ...challenge.config, implementerPersona: e.target.value },
                    })
                  }
                  style={{
                    width: 200,
                    background: challenge.config?.isMultiTurn
                      ? 'rgba(255,255,255,0.05)'
                      : 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    color: challenge.config?.isMultiTurn
                      ? '#fff'
                      : 'rgba(255,255,255,0.25)',
                    fontSize: 13,
                    fontFamily: 'Space Mono',
                    outline: 'none',
                    cursor: challenge.config?.isMultiTurn ? 'pointer' : 'not-allowed',
                  }}
                >
                  <option value="junior">junior</option>
                  <option value="senior">senior</option>
                </select>
              </div>

              {/* MAX_ROUNDS */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <Settings size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
                  <SubTitle>MAX_ROUNDS</SubTitle>
                </div>
                <input
                  data-testid="max-rounds-input"
                  type="number"
                  disabled={!challenge.config?.isMultiTurn}
                  min={2}
                  max={6}
                  value={
                    challenge.config?.isMultiTurn
                      ? ((challenge.config?.maxRounds as number | undefined) ?? 4)
                      : ''
                  }
                  placeholder={challenge.config?.isMultiTurn ? undefined : '4'}
                  onChange={(e) => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : 4;
                    setChallenge({
                      ...challenge,
                      config: { ...challenge.config, maxRounds: val },
                    });
                  }}
                  style={{
                    width: 120,
                    background: challenge.config?.isMultiTurn
                      ? 'rgba(255,255,255,0.05)'
                      : 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    color: challenge.config?.isMultiTurn
                      ? '#fff'
                      : 'rgba(255,255,255,0.25)',
                    fontSize: 13,
                    fontFamily: 'Space Mono',
                    outline: 'none',
                    cursor: challenge.config?.isMultiTurn ? 'text' : 'not-allowed',
                  }}
                />
              </div>
            </>
          )}

          {/* ── CODE_IMPLEMENTATION-specific config ──────────────────────── */}
          {challenge.type === 'CODE_IMPLEMENTATION' && (
            <>
              {/* Divider */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }} />

              {/* MODE */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <Terminal size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
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
                  <Settings size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
                  <SubTitle>ENGINE</SubTitle>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{
                    padding: 12,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 4,
                  }}>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'Space Mono', marginBottom: 4 }}>
                      RUNTIME
                    </div>
                    <div style={{ fontSize: 11, color: '#fff', fontWeight: 700 }}>
                      {(challenge.config?.mode as string | undefined) === 'frontend'
                        ? 'Browser (Sandpack)'
                        : 'Node.js / V8'}
                    </div>
                  </div>
                  <div style={{
                    padding: 12,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 4,
                  }}>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'Space Mono', marginBottom: 4 }}>
                      SCORING
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'Space Mono', lineHeight: 1.6 }}>
                      Sample 30% + Hidden 70%
                    </div>
                  </div>
                </div>
              </div>

              {/* FOLLOW_UP */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <Settings size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
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
                  accentColor="#a78bfa"
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
              border: '1px dashed rgba(255,255,255,0.1)',
              borderRadius: 12,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.4)',
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
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '14px 18px',
                color: '#fff',
                fontSize: 14,
                fontFamily: 'inherit',
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </div>
        </div>
      )}

      {/* ─── CANDIDATE_PREVIEW TAB ───────────────────────────────────────────── */}
      {activeTab === 'CANDIDATE_PREVIEW' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <button
              style={{
                ...headerBtnStyle,
                fontSize: 9,
                letterSpacing: '0.1em',
              }}
            >
              FULL_SCREEN
            </button>
          </div>
          <div
            style={{
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              overflow: 'hidden',
              minHeight: 400,
              background: 'rgba(0,0,0,0.3)',
              padding: 32,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.3)',
                fontFamily: 'Space Mono',
                marginBottom: 16,
                letterSpacing: '0.15em',
              }}
            >
              CANDIDATE_VIEW
            </div>
            {challenge.instructions && !challenge.config?.question && (
              <div
                style={{
                  fontSize: 15,
                  color: '#fff',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                  marginBottom: 24,
                }}
              >
                {challenge.instructions}
              </div>
            )}
            {challenge.type === 'QUIZ_SHORT_ANSWER' && !!challenge.config?.question && (
              <div
                style={{
                  padding: '20px 24px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 600,
                  color: '#fff',
                  marginBottom: 16,
                }}
              >
                {String(challenge.config.question)}
              </div>
            )}
            {challenge.type === 'QUIZ_MCQ' && !!challenge.config?.question && (
              <div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: '#fff',
                    marginBottom: 16,
                  }}
                >
                  {String(challenge.config.question)}
                </div>
              </div>
            )}
            <div
              style={{
                marginTop: 8,
                fontSize: 10,
                color: 'rgba(255,255,255,0.2)',
                fontFamily: 'Space Mono',
              }}
            >
              TYPE: {challenge.type}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
