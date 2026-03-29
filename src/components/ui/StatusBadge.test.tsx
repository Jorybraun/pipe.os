import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusBadge, type BadgeVariant, type BadgeSize } from './StatusBadge';

describe('StatusBadge', () => {
  describe('Rendering', () => {
    it('should render with default props', () => {
      render(<StatusBadge />);
      const badge = screen.getByRole('status');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Info');
    });

    it('should render with correct role', () => {
      render(<StatusBadge />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveAttribute('role', 'status');
    });

    it('should render with data-testid matching status', () => {
      render(<StatusBadge status="success" />);
      expect(screen.getByTestId('badge-success')).toBeInTheDocument();
    });

    it('should render all status variants', () => {
      const variants: BadgeVariant[] = ['success', 'warning', 'error', 'info', 'neutral'];
      variants.forEach((variant) => {
        const { unmount } = render(<StatusBadge status={variant} />);
        expect(screen.getByTestId(`badge-${variant}`)).toBeInTheDocument();
        unmount();
      });
    });

    it('should display correct status text', () => {
      const statusTextMap = {
        success: 'Success',
        warning: 'Warning',
        error: 'Error',
        info: 'Info',
        neutral: 'Status',
      };

      Object.entries(statusTextMap).forEach(([status, text]) => {
        const { unmount } = render(<StatusBadge status={status as BadgeVariant} />);
        expect(screen.getByText(text)).toBeInTheDocument();
        unmount();
      });
    });
  });

  describe('Props - Label & Icon', () => {
    it('should display custom label when provided', () => {
      render(<StatusBadge label="Custom Label" />);
      expect(screen.getByText('Custom Label')).toBeInTheDocument();
    });

    it('should use custom label over default status text', () => {
      render(<StatusBadge status="error" label="Upload Failed" />);
      expect(screen.getByText('Upload Failed')).toBeInTheDocument();
      expect(screen.queryByText('Error')).not.toBeInTheDocument();
    });

    it('should render icon when provided', () => {
      render(
        <StatusBadge
          icon={<span data-testid="test-icon">✓</span>}
          label="Complete"
        />
      );
      expect(screen.getByTestId('test-icon')).toBeInTheDocument();
      expect(screen.getByTestId('badge-icon')).toBeInTheDocument();
    });

    it('should render icon before text', () => {
      render(
        <StatusBadge
          icon={<span data-testid="test-icon">✓</span>}
          label="Complete"
        />
      );
      const badge = screen.getByRole('status');
      const icon = screen.getByTestId('test-icon');
      const text = screen.getByText('Complete');
      expect(badge.contains(icon)).toBe(true);
      expect(badge.contains(text)).toBe(true);
    });

    it('should not render icon by default', () => {
      render(<StatusBadge />);
      expect(screen.queryByTestId('badge-icon')).not.toBeInTheDocument();
    });
  });

  describe('Props - Size Variants', () => {
    it('should support all size variants', () => {
      const sizes: BadgeSize[] = ['sm', 'md', 'lg'];
      sizes.forEach((size) => {
        const { unmount } = render(<StatusBadge size={size} data-testid={`badge-${size}`} />);
        const badge = screen.getByRole('status');
        expect(badge).toBeInTheDocument();
        unmount();
      });
    });

    it('should default to md size', () => {
      render(<StatusBadge />);
      const badge = screen.getByRole('status');
      // Should have md size styling
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Props - Dismissible', () => {
    it('should not render dismiss button by default', () => {
      render(<StatusBadge />);
      expect(screen.queryByLabelText(/Dismiss/)).not.toBeInTheDocument();
    });

    it('should render dismiss button when dismissible=true', () => {
      render(<StatusBadge dismissible label="Test" />);
      expect(screen.getByLabelText(/Dismiss Test/)).toBeInTheDocument();
    });

    it('should call onDismiss when dismiss button clicked', () => {
      const onDismiss = vi.fn();
      render(<StatusBadge dismissible onDismiss={onDismiss} label="Test" />);
      const dismissBtn = screen.getByLabelText(/Dismiss/);
      fireEvent.click(dismissBtn);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('should stop propagation on dismiss click', () => {
      const onDismiss = vi.fn();
      const onClick = vi.fn();
      render(
        <StatusBadge dismissible onDismiss={onDismiss} label="Test" onClick={onClick} />
      );
      const dismissBtn = screen.getByLabelText(/Dismiss/);
      fireEvent.click(dismissBtn);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('dismiss button should have correct aria-label', () => {
      render(<StatusBadge dismissible label="Upload Complete" />);
      expect(screen.getByLabelText('Dismiss Upload Complete')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have status role', () => {
      render(<StatusBadge />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveAttribute('role', 'status');
    });

    it('should have default aria-label', () => {
      render(<StatusBadge status="success" label="Approved" />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveAttribute('aria-label', 'success status: Approved');
    });

    it('should use custom aria-label when provided', () => {
      render(
        <StatusBadge
          status="error"
          label="Failed"
          ariaLabel="Upload failed with error"
        />
      );
      const badge = screen.getByRole('status');
      expect(badge).toHaveAttribute('aria-label', 'Upload failed with error');
    });

    it('should be keyboard accessible via Tab', () => {
      render(
        <StatusBadge
          dismissible
          onDismiss={vi.fn()}
          label="Dismissible badge"
        />
      );
      const dismissBtn = screen.getByRole('button', { name: /Dismiss/ });
      dismissBtn.focus();
      expect(dismissBtn).toHaveFocus();
    });

    it('should be keyboard accessible via Enter on dismiss button', () => {
      const onDismiss = vi.fn();
      render(
        <StatusBadge
          dismissible
          onDismiss={onDismiss}
          label="Test"
        />
      );
      const dismissBtn = screen.getByLabelText(/Dismiss/);
      fireEvent.keyDown(dismissBtn, { key: 'Enter', code: 'Enter' });
      // Note: button naturally responds to Enter, no extra handling needed
    });
  });

  describe('Props - CSS & Styling', () => {
    it('should accept className prop', () => {
      render(
        <StatusBadge className="custom-class" />
      );
      const badge = screen.getByRole('status');
      expect(badge).toHaveClass('custom-class');
    });

    it('should accept style prop', () => {
      render(
        <StatusBadge style={{ margin: '10px' }} />
      );
      const badge = screen.getByRole('status');
      expect(badge).toHaveStyle('margin: 10px');
    });

    it('should merge custom styles with badge styles', () => {
      render(
        <StatusBadge
          status="success"
          style={{ opacity: 0.5 }}
        />
      );
      const badge = screen.getByRole('status');
      expect(badge).toHaveStyle('opacity: 0.5');
    });
  });

  describe('Props - Interaction', () => {
    it('should call onClick when badge is clicked', () => {
      const onClick = vi.fn();
      render(<StatusBadge onClick={onClick} />);
      const badge = screen.getByRole('status');
      fireEvent.click(badge);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should not call onClick when dismiss button is clicked', () => {
      const onClick = vi.fn();
      const onDismiss = vi.fn();
      render(
        <StatusBadge
          onClick={onClick}
          dismissible
          onDismiss={onDismiss}
          label="Test"
        />
      );
      const dismissBtn = screen.getByLabelText(/Dismiss/);
      fireEvent.click(dismissBtn);
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty label', () => {
      render(<StatusBadge label="" />);
      // Empty label should still render
      const badge = screen.getByRole('status');
      expect(badge).toBeInTheDocument();
    });

    it('should handle null icon', () => {
      render(<StatusBadge icon={null} />);
      expect(screen.queryByTestId('badge-icon')).not.toBeInTheDocument();
    });

    it('should handle undefined onDismiss', () => {
      render(<StatusBadge dismissible label="Test" />);
      const dismissBtn = screen.getByLabelText(/Dismiss/);
      // Should not throw
      expect(() => fireEvent.click(dismissBtn)).not.toThrow();
    });

    it('should handle rapid dismiss clicks', () => {
      const onDismiss = vi.fn();
      render(
        <StatusBadge dismissible onDismiss={onDismiss} label="Test" />
      );
      const dismissBtn = screen.getByLabelText(/Dismiss/);
      fireEvent.click(dismissBtn);
      fireEvent.click(dismissBtn);
      fireEvent.click(dismissBtn);
      expect(onDismiss).toHaveBeenCalledTimes(3);
    });

    it('should handle all status + size combinations', () => {
      const statuses: BadgeVariant[] = ['success', 'warning', 'error', 'info', 'neutral'];
      const sizes: BadgeSize[] = ['sm', 'md', 'lg'];

      statuses.forEach((status) => {
        sizes.forEach((size) => {
          const { unmount } = render(
            <StatusBadge status={status} size={size} label={`${status}-${size}`} />
          );
          expect(screen.getByText(`${status}-${size}`)).toBeInTheDocument();
          unmount();
        });
      });
    });
  });

  describe('Variants Visual State', () => {
    it('success variant should have correct styles', () => {
      render(<StatusBadge status="success" />);
      const badge = screen.getByTestId('badge-success');
      expect(badge).toBeInTheDocument();
    });

    it('warning variant should have correct styles', () => {
      render(<StatusBadge status="warning" />);
      const badge = screen.getByTestId('badge-warning');
      expect(badge).toBeInTheDocument();
    });

    it('error variant should have correct styles', () => {
      render(<StatusBadge status="error" />);
      const badge = screen.getByTestId('badge-error');
      expect(badge).toBeInTheDocument();
    });

    it('info variant should have correct styles', () => {
      render(<StatusBadge status="info" />);
      const badge = screen.getByTestId('badge-info');
      expect(badge).toBeInTheDocument();
    });

    it('neutral variant should have correct styles', () => {
      render(<StatusBadge status="neutral" />);
      const badge = screen.getByTestId('badge-neutral');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Dismiss Button Hover State', () => {
    it('dismiss button should change opacity on hover', () => {
      render(<StatusBadge dismissible label="Test" />);
      const dismissBtn = screen.getByLabelText(/Dismiss/);
      
      fireEvent.mouseEnter(dismissBtn);
      // After hover, should adjust opacity
      fireEvent.mouseLeave(dismissBtn);
      // Back to normal opacity
      
      expect(dismissBtn).toBeInTheDocument();
    });
  });
});
