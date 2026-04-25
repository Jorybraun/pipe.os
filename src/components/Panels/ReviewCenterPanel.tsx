/**
 * ReviewCenterPanel — switches between PR diff view and file viewer.
 *
 * When submission.selectedFile is null → shows the DiffPanel (PR changes).
 * When a file is selected → shows FileViewerPanel (read-only Monaco).
 */

import { useInterview } from '../../contexts/InterviewContext';
import { FileViewerPanel } from './FileViewerPanel';

interface ReviewCenterPanelProps {
  diffPanel: JSX.Element;
}

export function ReviewCenterPanel({ diffPanel }: ReviewCenterPanelProps): JSX.Element {
  const ctx = useInterview();
  const challengeData = ctx.currentChallenge?.data as Record<string, unknown> | undefined;
  const challengeId = (challengeData?.id as string) ?? '';
  const selectedFile = (ctx.submission.selectedFile as string | null) ?? null;

  if (selectedFile) {
    return (
      <FileViewerPanel
        challengeId={challengeId}
        filePath={selectedFile}
        onBack={() => ctx.updateSubmission({ selectedFile: null })}
      />
    );
  }

  return diffPanel;
}
