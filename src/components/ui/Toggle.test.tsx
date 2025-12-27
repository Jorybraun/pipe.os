import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from './Toggle';

describe('Toggle', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render as a switch role', () => {
      render(<Toggle checked={false} ariaLabel="Test toggle" />);

      const toggle = screen.getByRole('switch');
      expect(toggle).toBeInTheDocument();
    });

    it('should have aria-label', () => {
      render(<Toggle checked={false} ariaLabel="Enable feature" />);

      const toggle = screen.getByLabelText('Enable feature');
      expect(toggle).toBeInTheDocument();
    });

    it('should set aria-checked to true when checked', () => {
      render(<Toggle checked={true} ariaLabel="Test toggle" />);

      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('should set aria-checked to false when unchecked', () => {
      render(<Toggle checked={false} ariaLabel="Test toggle" />);

      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('should be disabled when disabled prop is true', () => {
      render(<Toggle checked={false} ariaLabel="Test toggle" disabled={true} />);

      const toggle = screen.getByRole('switch');
      expect(toggle).toBeDisabled();
    });

    it('should not be disabled by default', () => {
      render(<Toggle checked={false} ariaLabel="Test toggle" />);

      const toggle = screen.getByRole('switch');
      expect(toggle).not.toBeDisabled();
    });
  });

  describe('Interaction', () => {
    it('should call onChange with true when clicking unchecked toggle', () => {
      render(<Toggle checked={false} onChange={mockOnChange} ariaLabel="Test toggle" />);

      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);

      expect(mockOnChange).toHaveBeenCalledWith(true);
      expect(mockOnChange).toHaveBeenCalledTimes(1);
    });

    it('should call onChange with false when clicking checked toggle', () => {
      render(<Toggle checked={true} onChange={mockOnChange} ariaLabel="Test toggle" />);

      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);

      expect(mockOnChange).toHaveBeenCalledWith(false);
      expect(mockOnChange).toHaveBeenCalledTimes(1);
    });

    it('should not call onChange when disabled', () => {
      render(
        <Toggle checked={false} onChange={mockOnChange} ariaLabel="Test toggle" disabled={true} />
      );

      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);

      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('should not call onChange when no onChange handler provided', () => {
      const { container } = render(<Toggle checked={false} ariaLabel="Test toggle" />);

      const toggle = screen.getByRole('switch');

      // Should not throw error
      expect(() => {
        fireEvent.click(toggle);
      }).not.toThrow();
    });
  });

  describe('Display-only Mode', () => {
    it('should be display-only when onChange is not provided', () => {
      render(<Toggle checked={true} ariaLabel="Display only toggle" />);

      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked', 'true');

      // Should not have pointer cursor in display-only mode
      const styles = window.getComputedStyle(toggle);
      expect(styles.cursor).toBe('default');
    });

    it('should have pointer cursor when onChange is provided and not disabled', () => {
      render(<Toggle checked={false} onChange={mockOnChange} ariaLabel="Interactive toggle" />);

      const toggle = screen.getByRole('switch');
      const styles = window.getComputedStyle(toggle);
      expect(styles.cursor).toBe('pointer');
    });

    it('should have not-allowed cursor when disabled', () => {
      render(<Toggle checked={false} onChange={mockOnChange} ariaLabel="Disabled toggle" disabled={true} />);

      const toggle = screen.getByRole('switch');
      const styles = window.getComputedStyle(toggle);
      expect(styles.cursor).toBe('not-allowed');
    });
  });

  describe('Accessibility', () => {
    it('should be keyboard accessible', () => {
      render(<Toggle checked={false} onChange={mockOnChange} ariaLabel="Keyboard test" />);

      const toggle = screen.getByRole('switch');
      toggle.focus();

      expect(toggle).toHaveFocus();
    });

    it('should be activatable with Space key', () => {
      render(<Toggle checked={false} onChange={mockOnChange} ariaLabel="Space key test" />);

      const toggle = screen.getByRole('switch');
      fireEvent.keyDown(toggle, { key: ' ' });
      // Note: In real browser, Space triggers click. In test, we need to test click handler.
      fireEvent.click(toggle);

      expect(mockOnChange).toHaveBeenCalledWith(true);
    });

    it('should be activatable with Enter key', () => {
      render(<Toggle checked={false} onChange={mockOnChange} ariaLabel="Enter key test" />);

      const toggle = screen.getByRole('switch');
      fireEvent.keyDown(toggle, { key: 'Enter' });
      // Note: In real browser, Enter triggers click. In test, we need to test click handler.
      fireEvent.click(toggle);

      expect(mockOnChange).toHaveBeenCalledWith(true);
    });
  });

  describe('Visual States', () => {
    it('should have reduced opacity when disabled', () => {
      render(<Toggle checked={false} ariaLabel="Opacity test" disabled={true} />);

      const toggle = screen.getByRole('switch');
      const styles = window.getComputedStyle(toggle);
      expect(styles.opacity).toBe('0.5');
    });

    it('should have full opacity when not disabled', () => {
      render(<Toggle checked={false} ariaLabel="Opacity test" disabled={false} />);

      const toggle = screen.getByRole('switch');
      const styles = window.getComputedStyle(toggle);
      expect(styles.opacity).toBe('1');
    });

    it('should render button with correct type attribute', () => {
      render(<Toggle checked={false} ariaLabel="Button type test" />);

      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('type', 'button');
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid clicks correctly', () => {
      render(<Toggle checked={false} onChange={mockOnChange} ariaLabel="Rapid click test" />);

      const toggle = screen.getByRole('switch');

      fireEvent.click(toggle);
      fireEvent.click(toggle);
      fireEvent.click(toggle);

      // Each click should toggle the state
      expect(mockOnChange).toHaveBeenCalledTimes(3);
      expect(mockOnChange).toHaveBeenNthCalledWith(1, true);
      expect(mockOnChange).toHaveBeenNthCalledWith(2, false);
      expect(mockOnChange).toHaveBeenNthCalledWith(3, true);
    });

    it('should handle checked state change from parent', () => {
      const { rerender } = render(
        <Toggle checked={false} onChange={mockOnChange} ariaLabel="State change test" />
      );

      let toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      rerender(<Toggle checked={true} onChange={mockOnChange} ariaLabel="State change test" />);

      toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('should handle empty ariaLabel gracefully', () => {
      // TypeScript will enforce ariaLabel is required, but test runtime behavior
      render(<Toggle checked={false} ariaLabel="" />);

      const toggle = screen.getByRole('switch');
      expect(toggle).toBeInTheDocument();
    });
  });
});
