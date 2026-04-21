import { NavLink } from 'react-router-dom';
import { Home, Plus, Phone, Users, Zap, FileText, GitPullRequest, Settings2 } from 'lucide-react';
import type { OverviewStage, OverviewCandidate, OverviewMatchConfig } from '../../lib/api/types';
import type { StageType } from '../../lib/stageTemplates';

/**
 * StageStepper — horizontal, router-driven navigation between the pipeline
 * insights view and each stage panel.
 *
 * Nodes:
 *   [HOME] — ⦿ — [STAGE 1] — ⦿ — [STAGE 2] — ... — ⦿ — [+ ADD_STAGE]
 *
 * The circle gate connectors (⦿) are clickable — opening StageGatePanel.
 */

const STAGE_TYPE_ICON: Record<StageType, typeof Phone> = {
  SCREENING: Phone,
  CULTURAL: Users,
  TECHNICAL: Zap,
  CODE_REVIEW: GitPullRequest,
  PANEL: FileText,
};

export interface StageStepperProps {
  pipelineId: string;
  stages: OverviewStage[];
  candidates: OverviewCandidate[];
  /** Show the ADD_STAGE trailing link. Hidden for ACTIVE pipelines. */
  canAddStage: boolean;
  /**
   * When provided and the pipeline is empty, clicking ADD_STAGE calls this
   * instead of navigating to the /new-stage route. Used to open the inline
   * form in the EMPTY_PIPELINE quickstart card.
   */
  onAddStage?: () => void;
  /** Inherited match config (ADR-039). When present, renders a chip per stage. */
  matchConfig?: OverviewMatchConfig | null;
  /**
   * Called when a gate circle is clicked. Receives the stageId the gate leads
   * into. Parent opens StageGatePanel for that stage.
   */
  onStageGateClick?: (stageId: string) => void;
}

const NODE_BASE: React.CSSProperties = {
  flex: '0 0 auto',
  minWidth: 180,
  padding: '14px 18px',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  borderRadius: 10,
  textDecoration: 'none',
  transition: 'all 0.2s ease',
  fontFamily: '"Space Mono", monospace',
  cursor: 'pointer',
};

const NODE_INACTIVE: React.CSSProperties = {
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border-light)',
  color: 'var(--pipe-text-muted)',
};

const NODE_ACTIVE: React.CSSProperties = {
  background: 'var(--pipe-surface-hover)',
  border: '1px solid var(--pipe-text-dim)',
  color: 'var(--pipe-text)',
};

interface StageGateProps {
  stageId: string;
  onClick: (id: string) => void;
  hasConfig: boolean;
}

function StageGate({ stageId, onClick, hasConfig }: StageGateProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid="stage-gate-connector"
      data-stage-id={stageId}
      onClick={() => onClick(stageId)}
      title="Configure stage gate"
      style={{
        width: 32,
        height: 32,
        flex: '0 0 auto',
        flexShrink: 0,
        borderRadius: '50%',
        background: hasConfig ? 'rgba(96,165,250,0.06)' : 'var(--pipe-surface)',
        border: hasConfig
          ? '1px solid rgba(96,165,250,0.25)'
          : '1px solid var(--pipe-border-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(96,165,250,0.12)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(96,165,250,0.5)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = hasConfig
          ? 'rgba(96,165,250,0.06)'
          : 'var(--pipe-surface)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = hasConfig
          ? 'rgba(96,165,250,0.25)'
          : 'var(--pipe-border-light)';
      }}
    >
      <Settings2
        size={12}
        color={hasConfig ? '#60a5fa' : 'var(--pipe-text-dim)'}
      />
    </button>
  );
}

/** Thin horizontal line connecting nodes when gate is not applicable (e.g. before HOME). */
function Line(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 20,
        height: 1,
        background: 'var(--pipe-border-light)',
        flex: '0 0 auto',
      }}
    />
  );
}

function formatMatchChip(cfg: OverviewMatchConfig): string {
  const phil = cfg.matchPhilosophy ? cap(cfg.matchPhilosophy) : '—';
  const tol = cfg.tolerance ? cap(cfg.tolerance) : '—';
  return `${phil} · ${tol}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function StageStepper({
  pipelineId,
  stages,
  candidates,
  canAddStage,
  onAddStage,
  matchConfig,
  onStageGateClick,
}: StageStepperProps): JSX.Element {
  const hasConfig = !!matchConfig;

  const handleGateClick = (stageId: string): void => {
    onStageGateClick?.(stageId);
  };

  return (
    <div
      data-testid="stage-stepper"
      style={{
        overflowX: 'auto',
        width: '100%',
        minWidth: 0,
        marginBottom: 24,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '16px 0',
          width: 'max-content',
        }}
      >
        {/* Home node — insights route */}
        <NavLink
          to={`/pipeline/${pipelineId}`}
          end
          data-testid="stepper-home"
          style={({ isActive }) => ({
            ...NODE_BASE,
            minWidth: 64,
            padding: '14px',
            justifyContent: 'center',
            ...(isActive ? NODE_ACTIVE : NODE_INACTIVE),
          })}
        >
          {({ isActive }) => (
            <Home
              size={16}
              color={isActive ? 'var(--pipe-text)' : 'var(--pipe-text-muted)'}
            />
          )}
        </NavLink>

        {stages.map((stage) => {
          const candidateCount = candidates.filter(
            (c) => c.currentStageId === stage.id,
          ).length;
          const TypeIcon = stage.stageType
            ? STAGE_TYPE_ICON[stage.stageType as StageType] ?? FileText
            : FileText;

          return (
            <div
              key={stage.id}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}
            >
              {/* Gate circle */}
              {onStageGateClick ? (
                <StageGate
                  stageId={stage.id}
                  onClick={handleGateClick}
                  hasConfig={hasConfig}
                />
              ) : (
                <Line />
              )}

              {/* Stage node + match chip stacked */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <NavLink
                  to={`/pipeline/${pipelineId}/stage/${stage.id}`}
                  data-testid="stepper-stage"
                  data-stage-id={stage.id}
                  style={({ isActive }) => ({
                    ...NODE_BASE,
                    ...(isActive ? NODE_ACTIVE : NODE_INACTIVE),
                  })}
                >
                  {({ isActive }) => (
                    <>
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: isActive
                            ? 'var(--pipe-surface-hover)'
                            : 'var(--pipe-surface)',
                          border: '1px solid var(--pipe-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 800,
                          color: isActive
                            ? 'var(--pipe-text)'
                            : 'var(--pipe-text-muted)',
                          flexShrink: 0,
                        }}
                      >
                        {stage.sortOrder + 1}
                      </div>
                      <TypeIcon
                        size={14}
                        color={
                          isActive ? 'var(--pipe-text)' : 'var(--pipe-text-muted)'
                        }
                      />
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: 140,
                          }}
                        >
                          {(stage.title ?? 'STAGE').toUpperCase()}
                        </div>
                        <div
                          style={{
                            fontSize: 8,
                            letterSpacing: '0.15em',
                            color: 'var(--pipe-text-dim)',
                          }}
                        >
                          {candidateCount} CANDIDATE{candidateCount === 1 ? '' : 'S'}
                        </div>
                      </div>
                    </>
                  )}
                </NavLink>

                {/* Match chip — click opens gate panel */}
                {matchConfig && onStageGateClick && (
                  <button
                    type="button"
                    data-testid="match-config-chip"
                    data-stage-id={stage.id}
                    onClick={() => handleGateClick(stage.id)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      background: 'transparent',
                      border: '1px solid rgba(96,165,250,0.2)',
                      borderRadius: 4,
                      color: '#60a5fa',
                      fontSize: 9,
                      letterSpacing: '0.08em',
                      fontFamily: '"Space Mono", monospace',
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                    }}
                  >
                    <Settings2 size={8} />
                    MATCH: {formatMatchChip(matchConfig).toUpperCase()}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {canAddStage && (
          <>
            <Line />
            {onAddStage ? (
              <button
                type="button"
                data-testid="stepper-add-stage"
                onClick={onAddStage}
                style={{
                  ...NODE_BASE,
                  minWidth: 140,
                  border: '1px dashed var(--pipe-border)',
                  background: 'var(--pipe-surface)',
                  color: 'var(--pipe-text-muted)',
                }}
              >
                <Plus size={14} />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.15em',
                  }}
                >
                  ADD_STAGE
                </span>
              </button>
            ) : (
              <NavLink
                to={`/pipeline/${pipelineId}/new-stage`}
                data-testid="stepper-add-stage"
                style={({ isActive }) => ({
                  ...NODE_BASE,
                  minWidth: 140,
                  border: '1px dashed var(--pipe-border)',
                  background: isActive
                    ? 'var(--pipe-surface-hover)'
                    : 'var(--pipe-surface)',
                  color: 'var(--pipe-text-muted)',
                })}
              >
                <Plus size={14} />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.15em',
                  }}
                >
                  ADD_STAGE
                </span>
              </NavLink>
            )}
          </>
        )}
      </div>
    </div>
  );
}
