/**
 * StageIndexTab — index route under /pipeline/:id/stage/:stageId.
 *
 * Routes to the correct detail tab based on stage type:
 *   - CULTURAL → CultureDetailTab
 *   - CODE_REVIEW → CodeReviewDetailTab
 *   - SCREENING → ScreeningDetailTab
 *   - OPEN_SOURCE → ChallengesTab (generic fallback)
 *   - LIVE_PANEL → ChallengesTab (generic fallback)
 *   - Everything else → ChallengesTab (generic fallback)
 */

import { useOutletContext } from 'react-router-dom';
import ChallengesTab from './ChallengesTab';
import CultureDetailTab from './CultureDetailTab';
import CodeReviewDetailTab from './CodeReviewDetailTab';
import OpenSourceDetailTab from './OpenSourceDetailTab';
import ScreeningDetailTab from './ScreeningDetailTab';
import type { StagePanelContext } from '../StagePanel';

export default function StageIndexTab(): JSX.Element {
  const { stage } = useOutletContext<StagePanelContext>();

  if (stage.stageType === 'CULTURAL') {
    return <CultureDetailTab />;
  }

  const hasCodeReview = stage.challenges?.some((c) => c.type === 'CODE_REVIEW');
  if (stage.stageType === 'CODE_REVIEW' || hasCodeReview) {
    return <CodeReviewDetailTab />;
  }

  if (stage.stageType === 'SCREENING') {
    return <ScreeningDetailTab />;
  }

  if (stage.stageType === 'OPEN_SOURCE') {
    return <OpenSourceDetailTab />;
  }

  return <ChallengesTab />;
}
