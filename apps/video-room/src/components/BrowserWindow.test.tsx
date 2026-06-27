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

    expect(onNavigate).toHaveBeenCalledWith('https://www.google.com');
    expect(screen.getByTestId('room-browser-embed-blocked').textContent).toContain('blocks embedded browsing');

    fireEvent.click(screen.getByRole('button', { name: 'Open site' }));

    expect(open).toHaveBeenCalledWith('https://www.google.com', '_blank', 'noopener,noreferrer');
  });
});
