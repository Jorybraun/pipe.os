/**
 * ConfigureTab — /pipeline/:id/stage/:stageId/configure.
 *
 * Hosts the existing StageConfigPanel component inline. Previously this panel
 * was rendered floating in AppLayout's agentPanel slot, triggered by
 * ?config=<stageId>. The redesign promotes stage configuration to a
 * first-class tab.
 *
 * StageConfigPanel already owns its own chrome, so we do not wrap it in a
 * SectionCard — we just give it a container div with min-height so the
 * layout doesn't collapse while it's loading.
 */

import { useNavigate, useOutletContext } from 'react-router-dom';
import { StageConfigPanel } from '../../components/StageConfigPanel';
import type { StagePanelContext } from '../StagePanel';

export default function ConfigureTab(): JSX.Element {
  const { shell, stageId } = useOutletContext<StagePanelContext>();
  const navigate = useNavigate();

  return (
    <div
      data-testid="stage-tab-content-configure"
      style={{
        minHeight: 520,
        background: 'var(--pipe-surface)',
        border: '1px solid var(--pipe-border)',
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      <StageConfigPanel
        stageId={stageId}
        onClose={() => {
          navigate(`/pipeline/${shell.pipelineId}/stage/${stageId}`);
        }}
      />
    </div>
  );
}
