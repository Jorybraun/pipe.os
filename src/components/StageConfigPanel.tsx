/**
 * StageConfigPanel — Multi-step stage configuration wizard.
 *
 * Step 1: Pick a stage type (SCREENING, CULTURAL, TECHNICAL, CODE_REVIEW, PANEL)
 *         → renames the stage, saves the type, swaps to step 2
 * Step 2: Type-specific challenge picker
 *         → browse/add challenges relevant to that type
 *
 * Renders in the Layout agentPanel slot via AppLayout.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, ArrowLeft, Phone, Users, Code, FileText, Zap, Search, GitPullRequest, Loader, AlertCircle, Plus, Trash2, Calendar, Video } from 'lucide-react';
import { STAGE_TYPE_CONFIGS, STAGE_TYPES, type StageType } from '../lib/stageTemplates';
import { useStageMutations } from '../hooks/useStageMutations';
import { useStageDetail } from '../hooks/useStageDetail';
import {
  ALL_CHALLENGE_TEMPLATES,
  type ChallengeTemplate,
  type ChallengeType,
} from '../content/challengeLibrary';
import { useChallengeMutations } from '../hooks/useChallengeMutations';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';

interface StageConfigPanelProps {
  stageId: string;
  onClose: () => void;
}

const STAGE_TYPE_ICONS: Record<StageType, typeof Phone> = {
  SCREENING: Phone,
  CULTURAL: Users,
  TECHNICAL: Zap,
  CODE_REVIEW: Code,
  PANEL: FileText,
};

/** Map stage types to the challenge types they should show */
const TYPE_TO_CHALLENGE_TYPES: Record<StageType, ChallengeType[]> = {
  SCREENING: ['QUIZ_SHORT_ANSWER', 'FOLLOW_UP'],
  CULTURAL: ['QUIZ_SHORT_ANSWER', 'FOLLOW_UP'],
  TECHNICAL: ['CODE_IMPLEMENTATION', 'QUIZ_SHORT_ANSWER', 'QUIZ_MCQ'],
  CODE_REVIEW: ['CODE_REVIEW'],
  PANEL: ['QUIZ_SHORT_ANSWER', 'FOLLOW_UP'],
};

export function StageConfigPanel({ stageId, onClose }: StageConfigPanelProps): JSX.Element {
  const { stage, isLoading, refetch } = useStageDetail(stageId);
  const { updateStage } = useStageMutations();
  const { createChallenge } = useChallengeMutations();

  const [selectedType, setSelectedType] = useState<StageType | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Sync from server on load
  useEffect(() => {
    if (stage && !initialized) {
      setSelectedType((stage.stageType as StageType | null) ?? null);
      setInitialized(true);
    }
  }, [stage, initialized]);

  const handleSelectType = async (type: StageType): Promise<void> => {
    setSelectedType(type);
    // Rename stage + save type
    const config = STAGE_TYPE_CONFIGS[type];
    try {
      await updateStage(stageId, {
        stageType: type,
        title: config.label,
      });
      await refetch();
    } catch (err) {
      console.error('[StageConfigPanel] Failed to update stage type:', err);
    }
  };

  const handleBack = (): void => {
    setSelectedType(null);
  };

  const handleAddChallenge = async (template: ChallengeTemplate): Promise<void> => {
    const count = stage?.challenges?.length ?? 0;
    try {
      await createChallenge(stageId, {
        type: template.type,
        title: template.title,
        instructions: template.instructions,
        config: template.config as Record<string, unknown>,
        order: count,
      });
      await refetch();
    } catch (err) {
      console.error('[StageConfigPanel] Failed to add challenge:', err);
    }
  };

  if (isLoading) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Space Mono", monospace',
        fontSize: 9,
        color: 'var(--pipe-text-dim)',
        letterSpacing: '0.15em',
      }}>
        LOADING...
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '"Space Mono", monospace',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 20px 16px',
        borderBottom: '1px solid var(--pipe-border, rgba(255,255,255,0.06))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {selectedType && (
            <button
              onClick={handleBack}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--pipe-text-dim)',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <div>
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
            }}>
              {selectedType ? STAGE_TYPE_CONFIGS[selectedType].label.toUpperCase() : 'STAGE_CONFIG'}
            </span>
            {stage && (
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--pipe-text)',
                marginTop: 4,
              }}>
                {stage.title}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      {selectedType ? (
        <>
          {/* Stage config toggles (always visible in step 2) */}
          <StageConfigToggles
            stageId={stageId}
            stage={stage}
            updateStage={updateStage}
            refetch={refetch}
          />

          {/* Challenge picker (type-specific) */}
          {selectedType === 'CODE_REVIEW' ? (
            <CodeReviewPicker
              key={stageId}
              stageId={stageId}
              existingCount={stage?.challenges?.length ?? 0}
              onAdded={refetch}
            />
          ) : (
            <TypeChallengePicker
              stageType={selectedType}
              onAdd={handleAddChallenge}
              existingCount={stage?.challenges?.length ?? 0}
            />
          )}
        </>
      ) : (
        <TypeSelector onSelect={(t) => void handleSelectType(t)} currentType={(stage?.stageType as StageType | null) ?? null} />
      )}
    </div>
  );
}

// ── Step 1: Type selector ───────────────────────────────────────────────────

function TypeSelector({ onSelect, currentType }: {
  onSelect: (type: StageType) => void;
  currentType: StageType | null;
}): JSX.Element {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <label style={labelStyle}>STAGE_TYPE</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {STAGE_TYPES.map((key) => {
            const config = STAGE_TYPE_CONFIGS[key];
            const Icon = STAGE_TYPE_ICONS[key];
            const isActive = currentType === key;
            return (
              <button
                key={key}
                onClick={() => onSelect(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontFamily: '"Space Mono", monospace',
                  background: isActive ? 'rgba(167,139,250,0.12)' : 'var(--pipe-surface)',
                  border: isActive ? '1px solid rgba(167,139,250,0.3)' : '1px solid var(--pipe-border)',
                  borderRadius: 4,
                  color: isActive ? '#a78bfa' : 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'left',
                }}
              >
                <Icon size={14} />
                <div>
                  <div>{config.label.toUpperCase()}</div>
                  <div style={{
                    fontSize: 8,
                    fontWeight: 400,
                    letterSpacing: '0.05em',
                    opacity: 0.7,
                    marginTop: 2,
                  }}>
                    {config.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Type-specific challenge picker ──────────────────────────────────

function TypeChallengePicker({ stageType, onAdd, existingCount }: {
  stageType: StageType;
  onAdd: (template: ChallengeTemplate) => Promise<void>;
  existingCount: number;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const challengeTypes = TYPE_TO_CHALLENGE_TYPES[stageType];

  const filtered = useMemo(() => {
    let templates = ALL_CHALLENGE_TEMPLATES.filter((t) =>
      challengeTypes.includes(t.type),
    );
    if (search.trim()) {
      const q = search.toLowerCase();
      templates = templates.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return templates;
  }, [challengeTypes, search]);

  return (
    <>
      {/* Search */}
      <div style={{ padding: '12px 20px 0' }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={12}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--pipe-text-dim)',
            }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search challenges..."
            style={{
              width: '100%',
              padding: '8px 10px 8px 30px',
              fontSize: 10,
              fontFamily: '"Space Mono", monospace',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text)',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Template list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && (
          <div style={{
            padding: 20,
            textAlign: 'center',
            fontSize: 9,
            color: 'var(--pipe-text-dim)',
            letterSpacing: '0.1em',
          }}>
            NO_CHALLENGES_FOUND
          </div>
        )}
        {filtered.map((template) => (
          <button
            key={template.id}
            onClick={() => void onAdd(template)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--pipe-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {template.title}
              </div>
              <div style={{
                fontSize: 8,
                color: 'var(--pipe-text-dim)',
                marginTop: 3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                opacity: 0.6,
              }}>
                {template.description}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--pipe-border)',
        fontSize: 8,
        color: 'var(--pipe-text-dim)',
        letterSpacing: '0.1em',
        textAlign: 'center',
      }}>
        {filtered.length} CHALLENGES — {existingCount} ADDED
      </div>
    </>
  );
}

// ── Stage config toggles (scheduling + video) ──────────────────────────────

function StageConfigToggles({ stageId, stage, updateStage, refetch }: {
  stageId: string;
  stage: ReturnType<typeof useStageDetail>['stage'];
  updateStage: ReturnType<typeof useStageMutations>['updateStage'];
  refetch: () => Promise<void>;
}): JSX.Element {
  const [isScheduled, setIsScheduled] = useState(stage?.isScheduled ?? false);
  const [isVideoMeeting, setIsVideoMeeting] = useState(stage?.mode === 'LIVE_VIDEO');

  const handleToggleScheduling = async (value: boolean): Promise<void> => {
    setIsScheduled(value);
    try {
      await updateStage(stageId, { isScheduled: value });
      await refetch();
    } catch (err) {
      console.error('[StageConfigToggles] Failed to update scheduling:', err);
      setIsScheduled(!value);
    }
  };

  const handleToggleVideo = async (value: boolean): Promise<void> => {
    setIsVideoMeeting(value);
    try {
      await updateStage(stageId, { mode: value ? 'LIVE_VIDEO' : 'ASYNC' });
      await refetch();
    } catch (err) {
      console.error('[StageConfigToggles] Failed to update video:', err);
      setIsVideoMeeting(!value);
    }
  };

  return (
    <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 16, borderBottom: '1px solid var(--pipe-border)' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={12} style={{ color: 'var(--pipe-text-dim)' }} />
            <span style={{ ...labelStyle, marginBottom: 0 }}>SCHEDULING_LINK</span>
          </div>
          <ToggleSwitch value={isScheduled} onChange={(v) => void handleToggleScheduling(v)} />
        </div>
        <div style={{ marginTop: 4, fontSize: 8, color: 'var(--pipe-text-dim)', opacity: 0.6, letterSpacing: '0.05em' }}>
          Candidates receive a scheduling link
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Video size={12} style={{ color: 'var(--pipe-text-dim)' }} />
            <span style={{ ...labelStyle, marginBottom: 0 }}>VIDEO_MEETING</span>
          </div>
          <ToggleSwitch value={isVideoMeeting} onChange={(v) => void handleToggleVideo(v)} />
        </div>
        <div style={{ marginTop: 4, fontSize: 8, color: 'var(--pipe-text-dim)', opacity: 0.6, letterSpacing: '0.05em' }}>
          This stage includes a live video meeting
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: value ? '#a78bfa' : 'var(--pipe-surface)',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
      }}
    >
      <div style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#fff',
        position: 'absolute',
        top: 2,
        left: value ? 18 : 2,
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

// ── Step 2 (CODE_REVIEW): GitHub PR picker ──────────────────────────────────

interface PRSummary {
  number: number;
  title: string;
  description: string;
  author: string;
  avatar: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  labels: string[];
  baseBranch: string;
  featureBranch: string;
}

function isValidGitHubUrl(url: string): boolean {
  return url.startsWith('https://github.com/') && url.split('/').filter(Boolean).length >= 4;
}

const DEFAULT_REPOS = [
  'https://github.com/el-pipe-o/interview-monorepo',
  'https://github.com/el-pipe-o/slopify',
];
const SAVED_REPOS_KEY = 'pipe_saved_repos';

function CodeReviewPicker({ stageId, existingCount, onAdded }: {
  stageId: string;
  existingCount: number;
  onAdded: () => Promise<void>;
}): JSX.Element {
  const { getToken } = useClerkAuth();
  const { createChallenge } = useChallengeMutations();

  const [repoUrl, setRepoUrl] = useState('');
  const [prs, setPrs] = useState<PRSummary[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [newRepoUrl, setNewRepoUrl] = useState('');

  const [savedRepos, setSavedRepos] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_REPOS_KEY);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      const merged = [...DEFAULT_REPOS];
      for (const r of parsed) {
        if (!merged.includes(r)) merged.push(r);
      }
      return merged;
    } catch {
      return [...DEFAULT_REPOS];
    }
  });

  useEffect(() => {
    try { localStorage.setItem(SAVED_REPOS_KEY, JSON.stringify(savedRepos)); } catch { /* */ }
  }, [savedRepos]);

  const fetchPRs = useCallback(async (url: string): Promise<void> => {
    if (!isValidGitHubUrl(url)) return;
    setRepoUrl(url);
    setIsFetching(true);
    setError(null);
    setPrs([]);
    try {
      const api = createApiClient({ getToken });
      const result = await api.get<{
        success: boolean;
        error?: string;
        data?: { prs: PRSummary[] };
      }>(`/api/v1/github/pulls?repoUrl=${encodeURIComponent(url.trim())}&state=open`);
      if (!result.success) {
        setError(result.error ?? 'Failed to fetch pull requests.');
        return;
      }
      const fetched = result.data?.prs ?? [];
      setPrs(fetched);
      if (fetched.length === 0) setError('No open pull requests found.');
    } catch (err) {
      console.error('[CodeReviewPicker] Failed to list PRs:', err);
      setError('Failed to fetch pull requests.');
    } finally {
      setIsFetching(false);
    }
  }, [getToken]);

  const handleAddPR = async (pr: PRSummary): Promise<void> => {
    try {
      const created = await createChallenge(stageId, {
        type: 'CODE_REVIEW',
        title: pr.title,
        instructions: pr.description,
        githubRepoUrl: repoUrl,
        githubPrNumber: pr.number,
        githubPrTitle: pr.title,
        githubPrDescription: pr.description,
        order: existingCount,
      });
      // Fire-and-forget: cache the diff
      void (async () => {
        try {
          const api = createApiClient({ getToken });
          await api.post('/api/v1/github/pr', {
            repoUrl,
            prNumber: pr.number,
            challengeId: created.id,
          });
        } catch { /* best effort */ }
      })();
      await onAdded();
    } catch (err) {
      console.error('[CodeReviewPicker] Failed to add PR:', err);
    }
  };

  const handleAddRepo = (): void => {
    const trimmed = newRepoUrl.trim();
    if (!isValidGitHubUrl(trimmed) || savedRepos.includes(trimmed)) return;
    setSavedRepos((prev) => [...prev, trimmed]);
    setNewRepoUrl('');
    setShowAddRepo(false);
    void fetchPRs(trimmed);
  };

  return (
    <>
      {/* Repo selector */}
      <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={labelStyle}>SELECT_REPOSITORY</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {savedRepos.map((repo) => {
            const shortName = repo.replace('https://github.com/', '');
            const isActive = repoUrl === repo;
            return (
              <div key={repo} style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => void fetchPRs(repo)}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    fontFamily: '"Space Mono", monospace',
                    background: isActive ? 'rgba(96,165,250,0.12)' : 'transparent',
                    border: isActive ? '1px solid rgba(96,165,250,0.3)' : '1px solid var(--pipe-border)',
                    borderRadius: 4,
                    color: isActive ? '#60a5fa' : 'var(--pipe-text-dim)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {shortName}
                </button>
                {!DEFAULT_REPOS.includes(repo) && (
                  <button
                    onClick={() => setSavedRepos((prev) => prev.filter((r) => r !== repo))}
                    style={{
                      background: 'none',
                      border: '1px solid var(--pipe-border)',
                      borderRadius: 4,
                      color: 'var(--pipe-text-dim)',
                      cursor: 'pointer',
                      padding: '0 6px',
                      opacity: 0.5,
                    }}
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {showAddRepo ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              autoFocus
              type="text"
              value={newRepoUrl}
              onChange={(e) => setNewRepoUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddRepo(); if (e.key === 'Escape') setShowAddRepo(false); }}
              placeholder="https://github.com/owner/repo"
              style={{
                flex: 1,
                padding: '8px 10px',
                fontSize: 9,
                fontFamily: '"Space Mono", monospace',
                background: 'transparent',
                border: `1px solid ${isValidGitHubUrl(newRepoUrl) ? 'rgba(96,165,250,0.5)' : 'var(--pipe-border)'}`,
                borderRadius: 4,
                color: 'var(--pipe-text)',
                outline: 'none',
              }}
            />
            <button
              onClick={handleAddRepo}
              disabled={!isValidGitHubUrl(newRepoUrl)}
              style={{
                padding: '8px 12px',
                fontSize: 8,
                fontWeight: 700,
                fontFamily: '"Space Mono", monospace',
                background: isValidGitHubUrl(newRepoUrl) ? 'rgba(96,165,250,0.12)' : 'transparent',
                border: `1px solid ${isValidGitHubUrl(newRepoUrl) ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
                borderRadius: 4,
                color: isValidGitHubUrl(newRepoUrl) ? '#60a5fa' : 'var(--pipe-text-dim)',
                cursor: isValidGitHubUrl(newRepoUrl) ? 'pointer' : 'default',
                letterSpacing: '0.08em',
              }}
            >
              SAVE
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddRepo(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 10px',
              fontSize: 8,
              fontWeight: 700,
              fontFamily: '"Space Mono", monospace',
              background: 'transparent',
              border: '1px dashed var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              letterSpacing: '0.08em',
            }}
          >
            <Plus size={10} /> ADD_REPO
          </button>
        )}
      </div>

      {/* PR list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>
        {isFetching ? (
          <div style={{
            padding: 40,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            opacity: 0.6,
          }}>
            <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 9, fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
              FETCHING_PRS...
            </span>
          </div>
        ) : error ? (
          <div style={{
            padding: 16,
            display: 'flex',
            gap: 10,
            background: 'rgba(248,113,113,0.04)',
            border: '1px solid rgba(248,113,113,0.15)',
            borderRadius: 6,
          }}>
            <AlertCircle size={14} color="#f87171" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 9, color: '#f87171', fontFamily: '"Space Mono", monospace' }}>{error}</span>
          </div>
        ) : !repoUrl ? (
          <div style={{
            padding: 40,
            textAlign: 'center',
            opacity: 0.3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}>
            <GitPullRequest size={32} />
            <span style={{ fontSize: 9, fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
              SELECT_A_REPOSITORY
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {prs.map((pr) => (
              <button
                key={pr.number}
                onClick={() => void handleAddPR(pr)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '10px 12px',
                  background: 'transparent',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                <GitPullRequest size={12} style={{ color: '#60a5fa', flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)' }}>#{pr.number}</span>
                    {pr.draft && (
                      <span style={{
                        fontSize: 7,
                        padding: '1px 4px',
                        background: 'var(--pipe-surface)',
                        border: '1px solid var(--pipe-border)',
                        borderRadius: 2,
                        color: 'var(--pipe-text-dim)',
                      }}>
                        DRAFT
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--pipe-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {pr.title}
                  </div>
                  <div style={{
                    fontSize: 8,
                    color: 'var(--pipe-text-dim)',
                    marginTop: 3,
                    opacity: 0.6,
                  }}>
                    {pr.author} · {pr.featureBranch} → {pr.baseBranch}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--pipe-border)',
        fontSize: 8,
        color: 'var(--pipe-text-dim)',
        letterSpacing: '0.1em',
        textAlign: 'center',
      }}>
        {prs.length} PRS — {existingCount} ADDED
      </div>
    </>
  );
}

// ── Shared styles ───────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.15em',
  color: 'var(--pipe-text-dim)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 10,
};
