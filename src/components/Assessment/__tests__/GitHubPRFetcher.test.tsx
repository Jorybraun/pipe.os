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

  it('validates GitHub URL format', async () => {
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

    // Valid URL
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, 'https://github.com/facebook/react');
    // PR number still needed
    expect(fetchButton).toBeDisabled();
  });

  it('validates PR number format', async () => {
    render(
      <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
    );

    const prInput = screen.getByPlaceholderText('42');
    const fetchButton = screen.getByText('FETCH_FROM_GITHUB');

    // Invalid PR numbers (note: non-digits are filtered out)
    await userEvent.type(prInput, '0');
    expect(fetchButton).toBeDisabled();

    // Valid PR number
    await userEvent.clear(prInput);
    await userEvent.type(prInput, '42');
    // Still need valid URL
    expect(fetchButton).toBeDisabled();
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

  it('filters non-numeric characters from PR number', async () => {
    render(
      <GitHubPRFetcher onPRFetched={mockOnPRFetched} />
    );

    const prInput = screen.getByPlaceholderText('42') as HTMLInputElement;

    await userEvent.type(prInput, 'abc123def456');
    expect(prInput.value).toBe('123456');
  });

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
});
