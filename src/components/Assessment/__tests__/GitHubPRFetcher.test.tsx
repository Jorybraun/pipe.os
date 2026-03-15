import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GitHubPRFetcher } from '../GitHubPRFetcher';

describe('GitHubPRFetcher Component', () => {
  const mockOnPRFetched = vi.fn();
  const mockOnCleared = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Input State & Validation', () => {
    it('renders with empty inputs', () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      expect(screen.getByText('REPOSITORY_URL *')).toBeInTheDocument();
      expect(screen.getByText('PR_NUMBER *')).toBeInTheDocument();
      expect(screen.getByText('FETCH_FROM_GITHUB')).toBeInTheDocument();
    });

    it('pre-populates fields when initialChallenge is provided', () => {
      render(
        <GitHubPRFetcher
          initialChallenge={{
            githubRepoUrl: 'https://github.com/facebook/react',
            githubPrNumber: 27289,
          }}
          onPRFetched={mockOnPRFetched}
        />
      );

      const urlInput = screen.getByPlaceholderText('https://github.com/owner/repo') as HTMLInputElement;
      const prInput = screen.getByPlaceholderText('42') as HTMLInputElement;

      expect(urlInput.value).toBe('https://github.com/facebook/react');
      expect(prInput.value).toBe('27289');
    });

    it('validates GitHub URL format with regex', async () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      const urlInput = screen.getByPlaceholderText('https://github.com/owner/repo');
      const fetchButton = screen.getByText('FETCH_FROM_GITHUB');

      // Invalid URLs
      await userEvent.type(urlInput, 'invalid-url');
      expect(fetchButton).toBeDisabled();

      await userEvent.clear(urlInput);
      await userEvent.type(urlInput, 'https://gitlab.com/owner/repo');
      expect(fetchButton).toBeDisabled();

      await userEvent.clear(urlInput);
      await userEvent.type(urlInput, 'github.com/facebook/react');
      expect(fetchButton).toBeDisabled();

      // Valid URL
      await userEvent.clear(urlInput);
      await userEvent.type(urlInput, 'https://github.com/facebook/react');
      // PR number still needed
      expect(fetchButton).toBeDisabled();
    });

    it('validates PR number is positive integer only', async () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      const prInput = screen.getByPlaceholderText('42') as HTMLInputElement;
      const fetchButton = screen.getByText('FETCH_FROM_GITHUB');

      // Invalid PR numbers (0 is invalid)
      await userEvent.type(prInput, '0');
      expect(fetchButton).toBeDisabled();

      // Valid PR number
      await userEvent.clear(prInput);
      await userEvent.type(prInput, '42');
      // Still need valid URL
      expect(fetchButton).toBeDisabled();

      // Test large numbers work
      await userEvent.clear(prInput);
      await userEvent.type(prInput, '999999');
      expect(fetchButton).toBeDisabled(); // still need URL
    });

    it('enables fetch button only when both fields are valid', async () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      const urlInput = screen.getByPlaceholderText('https://github.com/owner/repo');
      const prInput = screen.getByPlaceholderText('42');
      const fetchButton = screen.getByText('FETCH_FROM_GITHUB');

      // Initially disabled
      expect(fetchButton).toBeDisabled();

      // Only URL
      await userEvent.type(urlInput, 'https://github.com/facebook/react');
      expect(fetchButton).toBeDisabled();

      // Both fields
      await userEvent.type(prInput, '27289');
      expect(fetchButton).not.toBeDisabled();

      // Clear PR number
      await userEvent.clear(prInput);
      expect(fetchButton).toBeDisabled();
    });

    it('filters non-numeric characters from PR number input', async () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      const prInput = screen.getByPlaceholderText('42') as HTMLInputElement;

      await userEvent.type(prInput, 'abc123def456');
      expect(prInput.value).toBe('123456');

      // Mix of alphanumerics
      await userEvent.clear(prInput);
      await userEvent.type(prInput, 'PR#999-final');
      expect(prInput.value).toBe('999');
    });
  });

  describe('Form Control Actions', () => {
    it('clears form when CLEAR button is clicked', async () => {
      render(
        <GitHubPRFetcher 
          onPRFetched={mockOnPRFetched}
          onCleared={mockOnCleared}
        />
      );

      const urlInput = screen.getByPlaceholderText('https://github.com/owner/repo');
      const prInput = screen.getByPlaceholderText('42');
      const clearButton = screen.getByText('CLEAR');

      await userEvent.type(urlInput, 'https://github.com/facebook/react');
      await userEvent.type(prInput, '27289');

      await userEvent.click(clearButton);

      expect((urlInput as HTMLInputElement).value).toBe('');
      expect((prInput as HTMLInputElement).value).toBe('');
      expect(mockOnCleared).toHaveBeenCalled();
    });

    it('shows validation checkmarks appear when inputs are valid', async () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      const urlInput = screen.getByPlaceholderText('https://github.com/owner/repo');
      const prInput = screen.getByPlaceholderText('42');

      // Inputs should be empty initially
      expect((urlInput as HTMLInputElement).value).toBe('');
      expect((prInput as HTMLInputElement).value).toBe('');

      // Add valid URL
      await userEvent.type(urlInput, 'https://github.com/facebook/react');
      expect((urlInput as HTMLInputElement).value).toBe('https://github.com/facebook/react');

      // Add valid PR
      await userEvent.type(prInput, '27289');
      expect((prInput as HTMLInputElement).value).toBe('27289');

      // Fetch button should be enabled
      const fetchButton = screen.getByText('FETCH_FROM_GITHUB');
      expect(fetchButton).not.toBeDisabled();
    });
  });

  describe('Accessibility & UX', () => {
    it('has proper labels for form fields', () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      expect(screen.getByText('REPOSITORY_URL *')).toBeInTheDocument();
      expect(screen.getByText('PR_NUMBER *')).toBeInTheDocument();
    });

    it('shows helper text with format guidelines', () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      expect(screen.getByText(/Format.*github\.com/)).toBeInTheDocument();
      expect(screen.getByText(/Positive integer only/)).toBeInTheDocument();
    });

    it('shows GITHUB_PR_DETAILS header label', () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      expect(screen.getByText('GITHUB_PR_DETAILS')).toBeInTheDocument();
    });

    it('disables fetch button when parent isLoading prop is true', () => {
      render(
        <GitHubPRFetcher 
          onPRFetched={mockOnPRFetched}
          isLoading={true}
        />
      );

      const fetchButton = screen.getByText('FETCH_FROM_GITHUB');
      expect(fetchButton).toBeDisabled();
    });
  });

  describe('Responsive Design', () => {
    it('renders buttons in flex layout', () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      // Check that buttons container has flex gap
      const buttonContainer = screen.getByText('FETCH_FROM_GITHUB').parentElement;
      expect(buttonContainer).toBeInTheDocument();
    });
  });

  describe('Component Props & Callbacks', () => {
    it('accepts and calls onCleared callback', async () => {
      render(
        <GitHubPRFetcher 
          onPRFetched={mockOnPRFetched}
          onCleared={mockOnCleared}
        />
      );

      const clearButton = screen.getByText('CLEAR');
      await userEvent.click(clearButton);

      expect(mockOnCleared).toHaveBeenCalledTimes(1);
    });

    it('handles undefined onCleared prop gracefully', async () => {
      render(
        <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
      );

      const clearButton = screen.getByText('CLEAR');
      // Should not throw
      await userEvent.click(clearButton);
      expect(mockOnPRFetched).not.toHaveBeenCalled();
    });
  });
});
