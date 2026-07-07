import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeScreen } from './WelcomeScreen';

describe('WelcomeScreen', () => {
  it('renders the expected time estimate when provided', () => {
    render(
      <WelcomeScreen
        pipelineName="Example Pipeline"
        stageName="Code Review"
        challenges={[{ title: 'Code Review', type: 'CODE_REVIEW' }]}
        expectedTimeMinutes={45}
        onStart={vi.fn()}
      />,
    );

    expect(screen.getByTestId('welcome-expected-time')).toBeInTheDocument();
    expect(screen.getByText('Expected time: ~45 minutes')).toBeInTheDocument();
  });

  it('does not render the expected time estimate when omitted', () => {
    render(
      <WelcomeScreen
        pipelineName="Example Pipeline"
        stageName="Code Review"
        challenges={[{ title: 'Code Review', type: 'CODE_REVIEW' }]}
        onStart={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('welcome-expected-time')).not.toBeInTheDocument();
  });
});
