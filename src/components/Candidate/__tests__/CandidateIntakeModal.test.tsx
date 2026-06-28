import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateIntakeModal } from '../CandidateIntakeModal';

const mocks = vi.hoisted(() => ({
  createCandidate: vi.fn(),
  post: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock('../../../hooks/useCandidateCreate', () => ({
  useCandidateCreate: () => ({
    create: mocks.createCandidate,
    isSubmitting: false,
    error: null,
    createdId: null,
    inviteToken: null,
    reset: vi.fn(),
  }),
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => ({
    getToken: mocks.getToken,
  }),
}));

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: { mode: 'dark' },
  }),
}));

vi.mock('../../../lib/api/client', () => ({
  createApiClient: () => ({
    post: mocks.post,
  }),
}));

describe('CandidateIntakeModal invite confirmation', () => {
  beforeEach(() => {
    mocks.createCandidate.mockReset();
    mocks.post.mockReset();
    mocks.getToken.mockReset();
  });

  it('shows the delivered assessment URL instead of the video room URL for assessment invites', async () => {
    mocks.createCandidate.mockResolvedValue({
      id: 'candidate-1',
      inviteToken: 'candidate-token',
      scheduledInterview: {
        id: 'interview-1',
        status: 'INVITED',
        meetingUrl: null,
      },
    });
    mocks.post.mockResolvedValue({
      success: true,
      emailSent: false,
      deliveredUrl: 'https://app-dev.hire-pipe.com/assess/assessment-token',
      meetingUrl: 'https://room-dev.hire-pipe.com/room/room-token',
    });

    render(
      <CandidateIntakeModal
        pipelineId="pipeline-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('E.g. John Doe'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.change(screen.getByPlaceholderText('john@example.com'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(screen.getByText('INITIATE_INTAKE'));

    await waitFor(() => {
      expect(screen.getByText('https://app-dev.hire-pipe.com/assess/assessment-token')).toBeTruthy();
    });
    expect(screen.queryByText('https://room-dev.hire-pipe.com/room/room-token')).toBeNull();
  });
});
