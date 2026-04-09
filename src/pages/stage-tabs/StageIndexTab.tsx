/**
 * StageIndexTab — index route under /pipeline/:id/stage/:stageId.
 *
 * Routes to the correct detail tab based on stage type:
 *   - CULTURAL → CultureDetailTab
 *   - CODE_REVIEW → CodeReviewDetailTab
 *   - TECHNICAL (Questions) → QuestionsDetailTab
 *   - Everything else → ChallengesTab (generic fallback)
 */

import { useOutletContext } from 'react-router-dom';
import ChallengesTab from './ChallengesTab';
import CultureDetailTab from './CultureDetailTab';
import CodeReviewDetailTab from './CodeReviewDetailTab';
import QuestionsDetailTab from './QuestionsDetailTab';
import ScreeningDetailTab from './ScreeningDetailTab';
import type { StagePanelContext } from '../StagePanel';

export default function StageIndexTab(): JSX.Element {
  const { stage } = useOutletContext<StagePanelContext>();

  const titleLower = stage.title.toLowerCase();

  if (
    stage.stageType === 'CULTURAL' ||
    (!stage.stageType && (titleLower.includes('cultural') || titleLower.includes('culture')))
  ) {
    return <CultureDetailTab />;
  }

  const hasCodeReview = stage.challenges?.some((c) => c.type === 'CODE_REVIEW');
  if (
    stage.stageType === 'CODE_REVIEW' ||
    hasCodeReview ||
    (!stage.stageType && titleLower.includes('code review'))
  ) {
    return <CodeReviewDetailTab />;
  }

  if (
    stage.stageType === 'TECHNICAL' ||
    (!stage.stageType && (titleLower.includes('question') || titleLower.includes('technical')))
  ) {
    return <QuestionsDetailTab />;
  }

  if (
    stage.stageType === 'SCREENING' ||
    (!stage.stageType && titleLower.includes('screening'))
  ) {
    return <ScreeningDetailTab />;
  }

  return <ChallengesTab />;
}
