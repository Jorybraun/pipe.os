/**
 * StagePanel — /pipeline/:id/stage/:stageId.
 *
 * Nested under PipelineShellPage. Renders:
 *   - Editable stage title
 *   - Routed tabs for interview setup and people
 *   - <Outlet /> for the active tab
 *
 * The old right-side panel (email templates, time limit) is gone. Interview
 * configuration has moved from the floating ?config=<stageId> side panel into
 * the Configure tab.
 *
 * Shares outlet context downward to the tab components: both the parent
 * shell's data and this stage's detail + refetch.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router-dom';
import { ListChecks, Users, Settings, Trash2, Brain, Target, GitPullRequest, GitMerge } from 'lucide-react';
import { Skeleton } from '../components/ui/Skeleton';
import { useStageDetail } from '../hooks/useStageDetail';
import { useStageMutations } from '../hooks/useStageMutations';
import { useStageRefetch } from '../contexts/StageRefetchContext';
import type { StageDetail } from '../lib/api/types';
import type { PipelineShellContext } from './PipelineShellPage';

/**
 * Context provided to the three stage tab outlets. Tabs read via
 * `useOutletContext<StagePanelContext>()`.
 */
export interface StagePanelContext {
  shell: PipelineShellContext;
  stage: StageDetail;
  stageId: string;
  refetchStage: () => Promise<void>;
}

interface StageTabProps {
  to: string;
  isActive: boolean;
  label: string;
  count?: number;
  icon: JSX.Element;
  testId: string;
}

function StageTab({
  to,
  isActive,
  label,
  count,
  icon,
  testId,
}: StageTabProps): JSX.Element {
  return (
    <Link
      to={to}
      data-testid={testId}
      data-active={isActive ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 22px',
        background: isActive ? 'var(--pipe-surface-hover)' : 'transparent',
        border: `1px solid ${
          isActive ? 'var(--pipe-text-dim)' : 'var(--pipe-border-light)'
        }`,
        borderBottom: isActive
          ? '2px solid var(--pipe-text)'
          : '1px solid var(--pipe-border-light)',
        color: isActive ? 'var(--pipe-text)' : 'var(--pipe-text-muted)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.15em',
        fontFamily: '"Space Mono", monospace',
        textDecoration: 'none',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      {icon}
      {label}
      {typeof count === 'number' && (
        <span
          style={{
            fontSize: 9,
            padding: '1px 6px',
            background: 'var(--pipe-surface-hover)',
            borderRadius: 3,
            color: isActive ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
          }}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

export default function StagePanel(): JSX.Element {
  const shell = useOutletContext<PipelineShellContext>();
  const { stageId } = useParams<{ stageId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const { stage, isLoading, refetch } = useStageDetail(stageId);
  const { updateStage, deleteStage } = useStageMutations();
  const { registerRefetch } = useStageRefetch();

  // Let StageConfigPanel (rendered inside the Configure tab) trigger a refetch.
  useEffect(() => {
    registerRefetch(refetch);
  }, [registerRefetch, refetch]);

  const [localTitle, setLocalTitle] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!stageId) return;
    setIsDeleting(true);
    try {
      await deleteStage(stageId);
      await shell.refetch();
      navigate(`/pipeline/${shell.pipelineId}`);
    } catch (err) {
      console.error('[StagePanel] Failed to delete round:', err);
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }, [stageId, deleteStage, shell, navigate]);
  const displayTitle = localTitle !== null ? localTitle : stage?.title ?? '';

  const handleTitleBlur = useCallback(async (): Promise<void> => {
    if (!stageId || localTitle === null) return;
    const title = localTitle.trim();
    setLocalTitle(null);
    if (!title || title === stage?.title) return;
    try {
      await updateStage(stageId, { title });
      await refetch();
      await shell.refetch();
    } catch (err) {
      console.error('[StagePanel] Failed to update round title:', err);
    }
  }, [stageId, localTitle, stage?.title, updateStage, refetch, shell]);

  if (isLoading && !stage) {
    return (
      <div data-testid="stage-panel">
        <Skeleton width={320} height={32} style={{ marginBottom: 24 }} />
        <Skeleton width="100%" height={42} style={{ marginBottom: 24 }} />
        <Skeleton width="100%" height={320} />
      </div>
    );
  }

  if (!stage || !stageId) {
    return (
      <div
        style={{
          padding: 40,
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
          fontSize: 11,
          letterSpacing: '0.1em',
        }}
      >
        INTERVIEW_NOT_FOUND.{' '}
        <button
          onClick={() => navigate(`/pipeline/${shell.pipelineId}`)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pipe-text)',
            textDecoration: 'underline',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          BACK_TO_OVERVIEW
        </button>
      </div>
    );
  }

  const stageCandidates = shell.candidates.filter(
    (c) => c.currentStageId === stageId,
  );
  const challengeCount = stage.challenges?.length ?? 0;

  const stagePath = `/pipeline/${shell.pipelineId}/stage/${stageId}`;

  // ── Stage variant detection ────────────────────────────────────────────
  // Determines which tab layout + index component to render.
  // Primary: stageType field. Stages must have stage_type populated.
  const stageVariant: 'cultural' | 'code-review' | 'screening' | 'generic' = (() => {
    if (stage.stageType === 'CULTURAL') return 'cultural';
    if (
      stage.stageType === 'CODE_REVIEW' ||
      stage.challenges?.some((c) => c.type === 'CODE_REVIEW')
    ) return 'code-review';
    if (stage.stageType === 'SCREENING') return 'screening';
    return 'generic';
  })();

  // ── Tab config per variant ─────────────────────────────────────────────
  interface TabDef { key: string; path: string; label: string; icon: JSX.Element; count?: number }

  const gateTab: TabDef = { key: 'gate', path: '/gate', label: 'RULES', icon: <GitMerge size={12} /> };

  const tabConfigs: Record<typeof stageVariant, TabDef[]> = {
    'cultural': [
      { key: 'details', path: '', label: 'DETAILS', icon: <Brain size={12} /> },
      { key: 'benchmark', path: '/benchmark', label: 'BENCHMARK', icon: <Target size={12} /> },
      gateTab,
      { key: 'candidates', path: '/candidates', label: 'PEOPLE', icon: <Users size={12} />, count: stageCandidates.length },
    ],
    'code-review': [
      { key: 'details', path: '', label: 'DETAILS', icon: <GitPullRequest size={12} /> },
      gateTab,
      { key: 'candidates', path: '/candidates', label: 'PEOPLE', icon: <Users size={12} />, count: stageCandidates.length },
    ],
    'screening': [
      { key: 'details', path: '', label: 'DETAILS', icon: <ListChecks size={12} /> },
      gateTab,
      { key: 'candidates', path: '/candidates', label: 'PEOPLE', icon: <Users size={12} />, count: stageCandidates.length },
    ],
    'generic': [
      { key: 'challenges', path: '', label: 'SETUP', icon: <ListChecks size={12} />, count: challengeCount },
      gateTab,
      { key: 'candidates', path: '/candidates', label: 'PEOPLE', icon: <Users size={12} />, count: stageCandidates.length },
      { key: 'configure', path: '/configure', label: 'ADVANCED', icon: <Settings size={12} /> },
    ],
  };

  const tabs = tabConfigs[stageVariant];

  // Compute active tab from pathname
  const sub = location.pathname.slice(stagePath.length).replace(/^\//, '');
  const matchedTab = tabs.find((t) => t.path === `/${sub}`);
  const activeTab = matchedTab?.key ?? tabs[0]?.key ?? 'details';

  const outletContext: StagePanelContext = {
    shell,
    stage,
    stageId,
    refetchStage: refetch,
  };

  return (
    <div data-testid="stage-panel">
      {/* Header — editable title + delete */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            marginBottom: 8,
            fontFamily: '"Space Mono", monospace',
          }}
        >
          INTERVIEW / {stage.id.substring(0, 8)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <input
            data-testid="stage-title-input"
            value={displayTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={() => void handleTitleBlur()}
            placeholder="Interview title"
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--pipe-border)',
              fontSize: 22,
              fontWeight: 800,
              color: 'var(--pipe-text)',
              padding: '4px 0',
              outline: 'none',
              width: '100%',
              maxWidth: 560,
              fontFamily: 'inherit',
            }}
          />
          {confirmDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: '#f87171', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
                DELETE_INTERVIEW?
              </span>
              <button
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                style={{
                  padding: '6px 12px',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  background: 'rgba(248,113,113,0.12)',
                  border: '1px solid rgba(248,113,113,0.4)',
                  color: '#f87171',
                  cursor: isDeleting ? 'default' : 'pointer',
                }}
              >
                {isDeleting ? '...' : 'CONFIRM'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={isDeleting}
                style={{
                  padding: '6px 12px',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  background: 'transparent',
                  border: '1px solid var(--pipe-border)',
                  color: 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                }}
              >
                CANCEL
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete interview"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                background: 'transparent',
                border: '1px solid var(--pipe-border)',
                color: 'var(--pipe-text-dim)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Trash2 size={12} />
              DELETE
            </button>
          )}
        </div>
      </div>

      {/* Tabs — driven by stageVariant config */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 2,
          marginBottom: 24,
        }}
      >
        {tabs.map((tab) => (
          <StageTab
            key={tab.key}
            to={`${stagePath}${tab.path}`}
            isActive={activeTab === tab.key}
            label={tab.label}
            {...(tab.count !== undefined ? { count: tab.count } : {})}
            icon={tab.icon}
            testId={`stage-tab-${tab.key}`}
          />
        ))}
      </div>

      <Outlet context={outletContext} />
    </div>
  );
}
