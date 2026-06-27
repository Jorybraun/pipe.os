// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserWindow } from './BrowserWindow';

describe('BrowserWindow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an external-open fallback for sites that block embedded browsing', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onNavigate = vi.fn();
    render(<BrowserWindow onNavigate={onNavigate} />);

    fireEvent.change(screen.getByTestId('room-browser-address-input'), {
      target: { value: 'https://www.google.com' },
    });
    fireEvent.click(screen.getByTestId('room-browser-go'));

    expect(onNavigate).toHaveBeenCalledWith('https://www.google.com', {
      trigger: 'go_button',
      knownEmbedBlocked: true,
    });
    expect(screen.getByTestId('room-browser-embed-blocked').textContent).toContain('blocks embedded browsing');

    fireEvent.click(screen.getByRole('button', { name: 'Open site' }));

    expect(open).toHaveBeenCalledWith('https://www.google.com', '_blank', 'noopener,noreferrer');
  });

  it('reports back and forward navigation so browser history is synced and recorded', () => {
    const onNavigate = vi.fn();
    render(<BrowserWindow onNavigate={onNavigate} />);

    fireEvent.change(screen.getByTestId('room-browser-address-input'), {
      target: { value: 'example.com' },
    });
    fireEvent.click(screen.getByTestId('room-browser-go'));
    fireEvent.change(screen.getByTestId('room-browser-address-input'), {
      target: { value: 'example.org' },
    });
    fireEvent.click(screen.getByTestId('room-browser-go'));

    fireEvent.click(screen.getByTitle('Back'));
    fireEvent.click(screen.getByTitle('Forward'));

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'https://example.com', {
      trigger: 'go_button',
      knownEmbedBlocked: false,
    });
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'https://example.org', {
      trigger: 'go_button',
      knownEmbedBlocked: false,
    });
    expect(onNavigate).toHaveBeenNthCalledWith(3, 'https://example.com', {
      trigger: 'history_back',
      knownEmbedBlocked: false,
    });
    expect(onNavigate).toHaveBeenNthCalledWith(4, 'https://example.org', {
      trigger: 'history_forward',
      knownEmbedBlocked: false,
    });
  });
});
