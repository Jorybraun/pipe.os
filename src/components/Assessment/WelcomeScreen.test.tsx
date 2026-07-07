import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../contexts/ThemeContext';

vi.mock('../ui/AppBackground', () => ({
  AppBackground: () => <div data-testid="app-background-mock" />,
}));

import { WelcomeScreen } from './WelcomeScreen';

function renderWelcomeScreen(expectedTimeMinutes?: number | null): void {
  const props = {
    pipelineName: 'Example Pipeline',
    stageName: 'Code Review',
    challenges: [{ title: 'Code Review', type: 'CODE_REVIEW' }],
    onStart: vi.fn(),
    ...(expectedTimeMinutes === undefined ? {} : { expectedTimeMinutes }),
  };
  render(
    <ThemeProvider forceMode="pipe-blue">
      <WelcomeScreen {...props} />
    </ThemeProvider>,
  );
}

describe('WelcomeScreen', () => {
  it('renders the expected time estimate when provided', () => {
    renderWelcomeScreen(45);

    expect(screen.getByTestId('welcome-expected-time')).toBeInTheDocument();
    expect(screen.getByText('Expected time: ~45 minutes')).toBeInTheDocument();
  });

  it('does not render the expected time estimate when omitted', () => {
    renderWelcomeScreen();

    expect(screen.queryByTestId('welcome-expected-time')).not.toBeInTheDocument();
  });
});
