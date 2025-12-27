import React from 'react';
import { SubTitle } from '../ui/SubTitle';
import { VideoRecorder } from '../VideoRecorder';

/**
 * Video tab content - stateless presentation component.
 */
export function VideoContent({ hasVideo, videoDuration, onSave, onDelete }) {
  return (
    <div>
      <SubTitle>VIDEO_RECORDING</SubTitle>
      <div style={{ marginTop: 16 }}>
        <VideoRecorder
          hasExistingVideo={hasVideo}
          existingDuration={videoDuration}
          onSave={onSave}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
