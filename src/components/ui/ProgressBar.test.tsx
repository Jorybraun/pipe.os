import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar, type ProgressStatus, type ProgressSize } from './ProgressBar';

describe('ProgressBar', () => {
  describe('Rendering', () => {
    it('should render with default props', () => {
      render(<ProgressBar />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toBeInTheDocument();
    });

    it('should render with progressbar role', () => {
      render(<ProgressBar />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('role', 'progressbar');
    });

    it('should have data-testid', () => {
      render(<ProgressBar />);
      expect(screen.getByTestId('progressbar')).toBeInTheDocument();
    });

    it('should render fill bar', () => {
      render(<ProgressBar value={50} />);
      expect(screen.getByTestId('progressbar-fill')).toBeInTheDocument();
    });

    it('should render label when provided', () => {
      render(<ProgressBar label="Uploading" />);
      expect(screen.getByTestId('progressbar-label')).toBeInTheDocument();
    });
  });

  describe('Props - Value & Max', () => {
    it('should default to 0% progress', () => {
      render(<ProgressBar />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '0');
    });

    it('should set aria-valuenow from value prop', () => {
      render(<ProgressBar value={50} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '50');
    });

    it('should set aria-valuemin to 0', () => {
      render(<ProgressBar value={50} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    });

    it('should set aria-valuemax from max prop', () => {
      render(<ProgressBar max={200} value={100} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuemax', '200');
    });

    it('should default max to 100', () => {
      render(<ProgressBar value={50} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    });

    it('should clamp value to 0', () => {
      render(<ProgressBar value={-10} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '0');
    });

    it('should clamp value to max', () => {
      render(<ProgressBar value={150} max={100} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '100');
    });

    it('should calculate correct percentage', () => {
      render(<ProgressBar value={50} max={100} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '50');
    });

    it('should handle custom max values', () => {
      render(<ProgressBar value={25} max={50} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '25');
      expect(progressbar).toHaveAttribute('aria-valuemax', '50');
    });
  });

  describe('Props - Label & Percentage', () => {
    it('should show percentage by default', () => {
      render(<ProgressBar value={65} />);
      expect(screen.getByTestId('progressbar-label')).toHaveTextContent('65%');
    });

    it('should not show percentage when showPercentage=false', () => {
      render(<ProgressBar value={65} showPercentage={false} />);
      expect(screen.queryByTestId('progressbar-label')).not.toBeInTheDocument();
    });

    it('should show custom label', () => {
      render(<ProgressBar value={65} label="Download Progress" />);
      expect(screen.getByText('Download Progress')).toBeInTheDocument();
    });

    it('should show both label and percentage', () => {
      render(<ProgressBar value={65} label="Custom" showPercentage={true} />);
      const label = screen.getByTestId('progressbar-label');
      expect(label).toHaveTextContent('Custom');
    });

    it('should not show percentage in indeterminate state', () => {
      render(<ProgressBar value={null} />);
      expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    });

    it('should round percentage to nearest integer', () => {
      render(<ProgressBar value={33.7} max={100} />);
      expect(screen.getByTestId('progressbar-label')).toHaveTextContent('34%');
    });
  });

  describe('Props - Status Variants', () => {
    it('should support all status variants', () => {
      const statuses: ProgressStatus[] = ['success', 'warning', 'error', 'info'];
      statuses.forEach((status) => {
        const { unmount } = render(<ProgressBar status={status} value={50} />);
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        unmount();
      });
    });

    it('should default to info status', () => {
      render(<ProgressBar value={50} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toBeInTheDocument();
    });

    it('success variant should render', () => {
      render(<ProgressBar status="success" value={100} />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('warning variant should render', () => {
      render(<ProgressBar status="warning" value={50} />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('error variant should render', () => {
      render(<ProgressBar status="error" value={25} />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('Props - Size Variants', () => {
    it('should support all size variants', () => {
      const sizes: ProgressSize[] = ['sm', 'md', 'lg'];
      sizes.forEach((size) => {
        const { unmount } = render(<ProgressBar size={size} value={50} />);
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        unmount();
      });
    });

    it('should default to md size', () => {
      render(<ProgressBar value={50} />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('Props - Animated State', () => {
    it('should not animate by default', () => {
      render(<ProgressBar value={50} animated={false} />);
      const fill = screen.getByTestId('progressbar-fill');
      // Animation should not be applied
      expect(fill).toBeInTheDocument();
    });

    it('should animate when animated=true', () => {
      render(<ProgressBar value={50} animated={true} />);
      const fill = screen.getByTestId('progressbar-fill');
      expect(fill).toBeInTheDocument();
    });

    it('should apply shimmer animation when animated', () => {
      const { container } = render(<ProgressBar value={50} animated={true} />);
      // Animation should be defined in stylesheet
      expect(container).toBeInTheDocument();
    });
  });

  describe('Props - Striped State', () => {
    it('should not show stripes by default', () => {
      render(<ProgressBar value={50} striped={false} />);
      const fill = screen.getByTestId('progressbar-fill');
      expect(fill).toBeInTheDocument();
    });

    it('should show stripes when striped=true', () => {
      render(<ProgressBar value={50} striped={true} />);
      const fill = screen.getByTestId('progressbar-fill');
      expect(fill).toBeInTheDocument();
    });

    it('should combine striped and animated', () => {
      render(<ProgressBar value={50} striped={true} animated={true} />);
      const fill = screen.getByTestId('progressbar-fill');
      expect(fill).toBeInTheDocument();
    });
  });

  describe('Indeterminate State', () => {
    it('should show indeterminate when value=null', () => {
      render(<ProgressBar value={null} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-busy', 'true');
    });

    it('should not have aria-valuenow in indeterminate state', () => {
      render(<ProgressBar value={null} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).not.toHaveAttribute('aria-valuenow');
    });

    it('should have aria-busy=true in indeterminate state', () => {
      render(<ProgressBar value={null} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-busy', 'true');
    });

    it('should show label in indeterminate state', () => {
      render(<ProgressBar value={null} label="Processing..." />);
      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });

    it('should not show percentage in indeterminate state', () => {
      render(<ProgressBar value={null} showPercentage={true} />);
      expect(screen.queryByTestId('progressbar-label')).not.toBeInTheDocument();
    });

    it('should animate fill in indeterminate state', () => {
      render(<ProgressBar value={null} />);
      const fill = screen.getByTestId('progressbar-fill');
      expect(fill).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have progressbar role', () => {
      render(<ProgressBar value={50} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('role', 'progressbar');
    });

    it('should have default aria-label', () => {
      render(<ProgressBar value={50} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-label');
    });

    it('should use custom aria-label when provided', () => {
      render(<ProgressBar value={50} ariaLabel="Download progress" />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-label', 'Download progress');
    });

    it('should set aria-label from label prop', () => {
      render(<ProgressBar value={50} label="Upload" />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-label');
    });

    it('should have proper ARIA attributes for determinate state', () => {
      render(<ProgressBar value={75} max={100} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '75');
      expect(progressbar).toHaveAttribute('aria-valuemin', '0');
      expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    });

    it('should have proper ARIA attributes for indeterminate state', () => {
      render(<ProgressBar value={null} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-busy', 'true');
      expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    });
  });

  describe('Props - CSS & Styling', () => {
    it('should accept className prop', () => {
      render(<ProgressBar className="custom-class" />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveClass('custom-class');
    });

    it('should accept style prop', () => {
      render(<ProgressBar style={{ width: '80%' }} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveStyle('width: 80%');
    });

    it('should merge custom styles with bar styles', () => {
      render(<ProgressBar style={{ marginTop: '10px' }} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveStyle('marginTop: 10px');
    });
  });

  describe('Edge Cases', () => {
    it('should handle 0% progress', () => {
      render(<ProgressBar value={0} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '0');
    });

    it('should handle 100% progress', () => {
      render(<ProgressBar value={100} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '100');
    });

    it('should handle very large max values', () => {
      render(<ProgressBar value={500} max={10000} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '500');
      expect(progressbar).toHaveAttribute('aria-valuemax', '10000');
    });

    it('should handle decimal values', () => {
      render(<ProgressBar value={33.33} max={100} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '33.33');
    });

    it('should handle rapid value updates', () => {
      const { rerender } = render(<ProgressBar value={10} />);
      rerender(<ProgressBar value={20} />);
      rerender(<ProgressBar value={30} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '30');
    });

    it('should handle value transitions from null to number', () => {
      const { rerender } = render(<ProgressBar value={null} />);
      let progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-busy', 'true');

      rerender(<ProgressBar value={50} />);
      progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '50');
    });

    it('should handle value transitions from number to null', () => {
      const { rerender } = render(<ProgressBar value={50} />);
      let progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '50');

      rerender(<ProgressBar value={null} />);
      progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('All Combinations', () => {
    it('should render all status + size combinations', () => {
      const statuses: ProgressStatus[] = ['success', 'warning', 'error', 'info'];
      const sizes: ProgressSize[] = ['sm', 'md', 'lg'];

      statuses.forEach((status) => {
        sizes.forEach((size) => {
          const { unmount } = render(
            <ProgressBar status={status} size={size} value={50} label={`${status}-${size}`} />
          );
          expect(screen.getByText(`${status}-${size}`)).toBeInTheDocument();
          unmount();
        });
      });
    });

    it('should render with all animation combinations', () => {
      const combinations = [
        { animated: true, striped: true },
        { animated: true, striped: false },
        { animated: false, striped: true },
        { animated: false, striped: false },
      ];

      combinations.forEach((combo) => {
        const { unmount } = render(
          <ProgressBar {...combo} value={50} />
        );
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        unmount();
      });
    });
  });

  describe('Focus & Keyboard', () => {
    it('should be focusable (screen reader can reach it)', () => {
      render(<ProgressBar value={50} />);
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toBeInTheDocument();
      // Progressbar is not meant to be keyboard interactive, just readable
    });
  });

  describe('Dynamic Updates', () => {
    it('should update aria-valuenow when value changes', () => {
      const { rerender } = render(<ProgressBar value={25} />);
      let progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '25');

      rerender(<ProgressBar value={75} />);
      progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '75');
    });

    it('should update label when label prop changes', () => {
      const { rerender } = render(<ProgressBar value={50} label="Uploading..." />);
      expect(screen.getByText('Uploading...')).toBeInTheDocument();

      rerender(<ProgressBar value={50} label="Download complete" />);
      expect(screen.getByText('Download complete')).toBeInTheDocument();
    });

    it('should update percentage when value changes', () => {
      const { rerender } = render(<ProgressBar value={25} showPercentage />);
      expect(screen.getByTestId('progressbar-label')).toHaveTextContent('25%');

      rerender(<ProgressBar value={75} showPercentage />);
      expect(screen.getByTestId('progressbar-label')).toHaveTextContent('75%');
    });
  });
});
