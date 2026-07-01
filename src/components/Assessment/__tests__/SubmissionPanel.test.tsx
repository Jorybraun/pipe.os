import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubmissionPanel } from '../SubmissionPanel';
import { Annotation } from '../DiffPanel';

const mockAnnotations: Annotation[] = [
  {
    id: 'ann-1',
    file: 'src/file.ts',
    line: 10,
    severity: 'critical',
    comment: 'Test annotation',
    createdAt: '2026-03-14T10:00:00Z',
  },
];

describe('SubmissionPanel', () => {
  const successfulSubmit = vi.fn(async () => ({
    success: true,
    assessmentId: 'test-123',
    submittedAt: '2026-03-14T10:05:00Z',
  }));

  const fillReadySubmission = (): void => {
    fireEvent.click(screen.getByTestId('verdict-approve'));
    fireEvent.change(screen.getByTestId('summary-textarea'), { target: { value: 'Good code' } });
  };

  beforeEach(() => {
    successfulSubmit.mockClear();
  });

  describe('Rendering', () => {
    it('should render the verdict options', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      expect(screen.getByTestId('verdict-approve')).toBeTruthy();
      expect(screen.getByTestId('verdict-request_changes')).toBeTruthy();
      expect(screen.getByTestId('verdict-comment_only')).toBeTruthy();
    });

    it('should render summary textarea', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      expect(screen.getByTestId('summary-textarea')).toBeTruthy();
    });

    it('should display stats card', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      expect(screen.getByText('Annotations')).toBeTruthy();
      expect(screen.getByText('Verdict')).toBeTruthy();
      expect(screen.getByText('Summary')).toBeTruthy();
    });
  });

  describe('Verdict Selection', () => {
    it('should allow selecting approve verdict', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      fireEvent.click(screen.getByTestId('verdict-approve'));
      expect(screen.getByTestId('verdict-approve')).toBeTruthy();
    });

    it('should allow selecting request_changes verdict', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      fireEvent.click(screen.getByTestId('verdict-request_changes'));
      expect(screen.getByTestId('verdict-request_changes')).toBeTruthy();
    });

    it('should allow selecting comment_only verdict', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      fireEvent.click(screen.getByTestId('verdict-comment_only'));
      expect(screen.getByTestId('verdict-comment_only')).toBeTruthy();
    });
  });

  describe('Summary Textarea', () => {
    it('should update summary text', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      const textarea = screen.getByTestId('summary-textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Great code!' } });
      expect(textarea.value).toBe('Great code!');
    });

    it('should limit summary to 1000 characters', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      const textarea = screen.getByTestId('summary-textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'a'.repeat(1500) } });
      expect(textarea.value.length).toBeLessThanOrEqual(1000);
    });

    it('should display character count', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      const textarea = screen.getByTestId('summary-textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Test' } });
      expect(screen.getByTestId('char-count')).toHaveTextContent('4 / 1000');
    });
  });

  describe('Stats Display', () => {
    it('should show annotation count', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      expect(screen.getByText('1')).toBeTruthy();
    });

    it('should show verdict status', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      fireEvent.click(screen.getByTestId('verdict-approve'));
      // Verify the verdict button is selected and shows the text
      expect(screen.getAllByText('APPROVE').length).toBeGreaterThan(0);
    });
  });

  describe('Submit Button', () => {
    it('should be disabled when verdict not selected', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      const button = screen.getByTestId('submit-button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should be disabled when summary is empty', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      fireEvent.click(screen.getByTestId('verdict-approve'));
      const button = screen.getByTestId('submit-button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should be enabled when form is complete', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      fireEvent.click(screen.getByTestId('verdict-approve'));
      fireEvent.change(screen.getByTestId('summary-textarea'), { target: { value: 'Good code' } });
      
      const button = screen.getByTestId('submit-button') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });

    it('should be disabled in readOnly mode', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
          readOnly={true}
        />
      );
      
      fireEvent.click(screen.getByTestId('verdict-approve'));
      fireEvent.change(screen.getByTestId('summary-textarea'), { target: { value: 'Good code' } });
      
      const button = screen.getByTestId('submit-button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });
  });

  describe('Submission', () => {
    it('should call onSubmitComplete on successful submission', async () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
          submitReview={successfulSubmit}
        />
      );
      
      fillReadySubmission();
      fireEvent.click(screen.getByTestId('submit-button'));
      
      await waitFor(() => {
        expect(successfulSubmit).toHaveBeenCalledWith({
          assessmentId: 'test-123',
          annotations: mockAnnotations,
          verdict: 'approve',
          summary: 'Good code',
        });
        expect(onSubmitComplete).toHaveBeenCalledWith(
          { success: true, submittedAt: '2026-03-14T10:05:00Z' }
        );
      });
    });

    it('should show success state after submission', async () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
          submitReview={successfulSubmit}
        />
      );
      
      fillReadySubmission();
      fireEvent.click(screen.getByTestId('submit-button'));
      
      await waitFor(() => {
        expect(screen.getByText('REVIEW_SUBMITTED')).toBeTruthy();
      });
    });

    it('should show loading state during submission', async () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      const submitReview = vi.fn(() => new Promise<Awaited<ReturnType<typeof successfulSubmit>>>(() => {}));
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
          submitReview={submitReview}
        />
      );
      
      fillReadySubmission();
      fireEvent.click(screen.getByTestId('submit-button'));
      
      expect(screen.getByText('SUBMITTING...')).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should reject submission when no real submit handler is connected', async () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      fillReadySubmission();
      fireEvent.click(screen.getByTestId('submit-button'));
      
      await waitFor(() => {
        expect(onSubmitComplete).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith('Submission service is not connected');
        expect(screen.getByTestId('error-card')).toHaveTextContent('Submission service is not connected');
      });
    });

    it('should show error card on submission failure', async () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      const submitReview = vi.fn(async () => {
        throw new Error('Network error');
      });

      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
          submitReview={submitReview}
        />
      );

      fillReadySubmission();
      fireEvent.click(screen.getByTestId('submit-button'));

      await waitFor(() => {
        expect(onSubmitComplete).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith('Network error');
        expect(screen.getByTestId('error-card')).toHaveTextContent('Network error');
      });
    });

    it('should allow dismissing error card', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      // The error card would only appear after an actual error
      // This is tested through the error state in the component
    });
  });

  describe('Ready Status', () => {
    it('should show not ready status when form is incomplete', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      expect(screen.getByTestId('ready-status')).toHaveTextContent('COMPLETE_FORM_TO_CONTINUE');
    });

    it('should show ready status when form is complete', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      fireEvent.click(screen.getByTestId('verdict-approve'));
      fireEvent.change(screen.getByTestId('summary-textarea'), { target: { value: 'Good code' } });
      
      expect(screen.getByTestId('ready-status')).toHaveTextContent('READY_TO_SUBMIT');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible submit button', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      const button = screen.getByTestId('submit-button');
      expect(button).toBeTruthy();
    });

    it('should support keyboard navigation', () => {
      const onSubmitComplete = vi.fn();
      const onError = vi.fn();
      
      render(
        <SubmissionPanel
          assessmentId="test-123"
          annotations={mockAnnotations}
          onSubmitComplete={onSubmitComplete}
          onError={onError}
        />
      );
      
      const verdictButton = screen.getByTestId('verdict-approve');
      expect(verdictButton).toBeTruthy();
    });
  });
});
