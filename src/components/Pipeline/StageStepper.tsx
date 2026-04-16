import { NavLink } from 'react-router-dom';
import { Home, Plus, Phone, Users, Zap, FileText, GitPullRequest } from 'lucide-react';
import type { OverviewStage, OverviewCandidate } from '../../lib/api/types';
import type { StageType } from '../../lib/stageTemplates';

/**
 * StageStepper — horizontal, router-driven navigation between the pipeline
 * insights view and each stage panel.
 *
 * Nodes:
 *   [HOME] — [STAGE 1] — [STAGE 2] — ... — [+ ADD_STAGE]
 *
 * The home node links to `/pipeline/:id` (insights). Each stage node links to
 * `/pipeline/:id/stage/:stageId`. Active state is driven by NavLink so route
 * changes and browser history update the stepper without any extra state.
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

const CONNECTOR: React.CSSProperties = {
  width: 16,
  height: 1,
  background: 'var(--pipe-border)',
  flex: '0 0 auto',
};

export function StageStepper({
  pipelineId,
  stages,
  candidates,
  canAddStage,
  onAddStage,
}: StageStepperProps): JSX.Element {
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
    <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
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

      {stages.map((stage, index) => {
        const candidateCount = candidates.filter(
          (c) => c.currentStageId === stage.id,
        ).length;
        const TypeIcon = stage.stageType
          ? STAGE_TYPE_ICON[stage.stageType as StageType] ?? FileText
          : FileText;

        return (
          <div
            key={stage.id}
            style={{ display: 'flex', alignItems: 'center' }}
          >
            <div style={CONNECTOR} />
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
                    {index + 1}
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
          </div>
        );
      })}

      {canAddStage && (
        <>
          <div style={CONNECTOR} />
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
