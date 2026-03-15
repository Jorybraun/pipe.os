import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GroundTruthAnnotationEditor } from '../GroundTruthAnnotationEditor';

describe('GroundTruthAnnotationEditor Component', () => {
  const mockOnAnnotationsChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering & Initial State', () => {
    it('renders with empty initial state', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      expect(screen.getByText('EXPECTED_ANNOTATIONS')).toBeInTheDocument();
      expect(screen.getByText('SENIOR REVIEWER')).toBeInTheDocument();
      expect(screen.getByText('MID-LEVEL REVIEWER')).toBeInTheDocument();
      expect(screen.getByText('JUNIOR REVIEWER')).toBeInTheDocument();
    });

    it('displays helper text explaining purpose', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      expect(screen.getByText(/Define what annotations each reviewer level should find/)).toBeInTheDocument();
    });

    it('pre-populates annotations when provided', () => {
      const initialAnnotations = {
        senior: [
          { id: '1', file: 'src/app.ts', line: 42, severity: 'critical' as const, comment: 'SQL injection risk' }
        ],
        mid: [],
        junior: [],
      };

      render(
        <GroundTruthAnnotationEditor 
          initialAnnotations={initialAnnotations}
          onAnnotationsChange={mockOnAnnotationsChange}
        />
      );

      expect(screen.getByDisplayValue('src/app.ts')).toBeInTheDocument();
      expect(screen.getByDisplayValue('SQL injection risk')).toBeInTheDocument();
    });

    it('shows all three reviewer levels with annotation counts', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      // Check that all levels show "0 ANNOTATIONS"
      const annotations = screen.getAllByText(/ANNOTATIONS/);
      expect(annotations.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Annotation Management', () => {
    it('has add annotation buttons for each level', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      const buttons = screen.getAllByRole('button');
      // Should have multiple buttons (level headers + add buttons)
      expect(buttons.length).toBeGreaterThan(3);
    });

    it('displays severity level options', () => {
      const initialAnnotations = {
        senior: [
          { id: '1', file: 'src/app.ts', line: 42, severity: 'critical' as const, comment: 'Test' }
        ],
        mid: [],
        junior: [],
      };

      render(
        <GroundTruthAnnotationEditor 
          initialAnnotations={initialAnnotations}
          onAnnotationsChange={mockOnAnnotationsChange}
        />
      );

      expect(screen.getByText('CRITICAL')).toBeInTheDocument();
      expect(screen.getByText('MAJOR')).toBeInTheDocument();
      expect(screen.getByText('MINOR')).toBeInTheDocument();
    });

    it('calls onAnnotationsChange with proper structure', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      expect(mockOnAnnotationsChange).toHaveBeenCalled();
      const lastCall = mockOnAnnotationsChange.mock.calls[mockOnAnnotationsChange.mock.calls.length - 1][0];
      
      expect(lastCall).toHaveProperty('senior');
      expect(lastCall).toHaveProperty('mid');
      expect(lastCall).toHaveProperty('junior');
      expect(Array.isArray(lastCall.senior)).toBe(true);
      expect(Array.isArray(lastCall.mid)).toBe(true);
      expect(Array.isArray(lastCall.junior)).toBe(true);
    });
  });

  describe('Accessibility & UX', () => {
    it('uses semantic HTML with proper button roles', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('displays clear section headers', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      expect(screen.getByText('EXPECTED_ANNOTATIONS')).toBeInTheDocument();
      expect(screen.getByText('SENIOR REVIEWER')).toBeInTheDocument();
      expect(screen.getByText('MID-LEVEL REVIEWER')).toBeInTheDocument();
      expect(screen.getByText('JUNIOR REVIEWER')).toBeInTheDocument();
    });
  });

  describe('Empty State Display', () => {
    it('shows empty state message for levels with no annotations', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      // All three levels should show "No annotations yet"
      const emptyMessages = screen.getAllByText('No annotations yet');
      expect(emptyMessages.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Form Inputs', () => {
    it('provides file path input field', () => {
      const initialAnnotations = {
        senior: [
          { id: '1', file: 'src/app.ts', line: 42, severity: 'critical' as const, comment: 'Test' }
        ],
        mid: [],
        junior: [],
      };

      render(
        <GroundTruthAnnotationEditor 
          initialAnnotations={initialAnnotations}
          onAnnotationsChange={mockOnAnnotationsChange}
        />
      );

      const fileInput = screen.getByDisplayValue('src/app.ts');
      expect(fileInput).toBeInTheDocument();
    });

    it('provides line number input field', () => {
      const initialAnnotations = {
        senior: [
          { id: '1', file: 'src/app.ts', line: 42, severity: 'critical' as const, comment: 'Test' }
        ],
        mid: [],
        junior: [],
      };

      render(
        <GroundTruthAnnotationEditor 
          initialAnnotations={initialAnnotations}
          onAnnotationsChange={mockOnAnnotationsChange}
        />
      );

      const lineInput = screen.getByDisplayValue('42') as HTMLInputElement;
      expect(lineInput).toBeInTheDocument();
      expect(lineInput.type).toBe('number');
    });

    it('provides comment textarea field', () => {
      const initialAnnotations = {
        senior: [
          { id: '1', file: 'src/app.ts', line: 42, severity: 'critical' as const, comment: 'Test comment' }
        ],
        mid: [],
        junior: [],
      };

      render(
        <GroundTruthAnnotationEditor 
          initialAnnotations={initialAnnotations}
          onAnnotationsChange={mockOnAnnotationsChange}
        />
      );

      const commentField = screen.getByDisplayValue('Test comment') as HTMLTextAreaElement;
      expect(commentField).toBeInTheDocument();
      expect(commentField.tagName).toBe('TEXTAREA');
    });
  });

  describe('Prop Handling', () => {
    it('handles undefined initialAnnotations', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      expect(screen.getByText('SENIOR REVIEWER')).toBeInTheDocument();
    });

    it('handles empty arrays for each level', () => {
      render(
        <GroundTruthAnnotationEditor 
          initialAnnotations={{ senior: [], mid: [], junior: [] }}
          onAnnotationsChange={mockOnAnnotationsChange}
        />
      );

      const emptyMessages = screen.getAllByText('No annotations yet');
      expect(emptyMessages.length).toBeGreaterThanOrEqual(3);
    });
  });
});
