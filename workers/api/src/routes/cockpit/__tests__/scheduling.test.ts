import { describe, expect, it } from 'vitest';
import {
  scheduledInterviewMeetingCopy,
  scheduledInterviewRoomFeatures,
} from '../scheduling';

describe('scheduled assessment meeting contract', () => {
  it('makes open-source bug-fix invites explicit workspace assessments', () => {
    expect(scheduledInterviewRoomFeatures('OPEN_SOURCE_BUG_FIX')).toEqual({
      videoEnabled: true,
      workspaceEnabled: true,
      recordingEnabled: true,
      clippyEnabled: true,
    });

    expect(scheduledInterviewMeetingCopy({
      candidateName: 'Ada Lovelace',
      roleTitle: 'Runtime Infrastructure',
      stageTitle: 'Open-source bug fix',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
    })).toEqual({
      title: 'Ada Lovelace open-source bug-fix assessment',
      description: 'Runtime Infrastructure · Open-source bug fix · Controlled workspace with video, recording, chat, terminal, code-server, and real AI-bridge evidence',
    });
  });

  it('keeps standard video invites out of the dev workspace path', () => {
    expect(scheduledInterviewRoomFeatures('VIDEO')).toEqual({
      videoEnabled: true,
      workspaceEnabled: false,
      recordingEnabled: true,
      clippyEnabled: false,
    });

    expect(scheduledInterviewMeetingCopy({
      candidateName: 'Grace Hopper',
      roleTitle: 'Talent Pool',
      stageTitle: 'Video interview',
      interviewType: 'VIDEO',
    })).toEqual({
      title: 'Grace Hopper interview',
      description: 'Talent Pool · Video interview',
    });
  });
});
