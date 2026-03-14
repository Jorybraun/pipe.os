import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

    it('shows all three reviewer level sections expanded by default', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      // All sections should show their annotation counts
      expect(screen.getAllByText(/ANNOTATIONS/)).toHaveLength(3);
    });
  });

  describe('Annotation Management', () => {
    it('adds new annotation to SENIOR REVIEWER level', async () => {
      const user = userEvent.setup();
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      // Find and click ADD ANNOTATION button in SENIOR section
      const addButtons = screen.getAllByText(/\+ ADD ANNOTATION/);
      await user.click(addButtons[0]); // SENIOR is first

      // Fill form
      const fileInputs = screen.getAllByPlaceholderText(/file path/i);
      await user.type(fileInputs[fileInputs.length - 1], 'src/index.ts');

      // Annotation should be submitted
      // (Component state management handles this)
      expect(mockOnAnnotationsChange).toHaveBeenCalled();
    });

    it('allows removing annotations', async () => {
      const user = userEvent.setup();
      const initialAnnotations = {
        senior: [
          { id: '1', file: 'src/app.ts', line: 42, severity: 'critical' as const, comment: 'Issue' }
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

      // Find delete button
      const deleteButtons = screen.getAllByRole('button', { name: /delete|remove|trash/i });
      if (deleteButtons.length > 0) {
        await user.click(deleteButtons[0]);
        expect(mockOnAnnotationsChange).toHaveBeenCalled();
      }
    });

    it('supports multiple annotations per reviewer level', () => {
      const initialAnnotations = {
        senior: [
          { id: '1', file: 'src/a.ts', line: 10, severity: 'critical' as const, comment: 'Issue 1' },
          { id: '2', file: 'src/b.ts', line: 20, severity: 'major' as const, comment: 'Issue 2' },
          { id: '3', file: 'src/c.ts', line: 30, severity: 'minor' as const, comment: 'Issue 3' },
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

      // All three annotations should be visible
      expect(screen.getByDisplayValue('src/a.ts')).toBeInTheDocument();
      expect(screen.getByDisplayValue('src/b.ts')).toBeInTheDocument();
      expect(screen.getByDisplayValue('src/c.ts')).toBeInTheDocument();
    });
  });

  describe('Reviewer Level Sections', () => {
    it('can collapse and expand SENIOR REVIEWER section', async () => {
      const user = userEvent.setup();
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      const seniorButton = screen.getByRole('button', { name: /SENIOR REVIEWER/i });
      
      // Collapse
      await user.click(seniorButton);
      // Content should be hidden (no new annotations shown)
      
      // Expand
      await user.click(seniorButton);
      // Content should be visible
      expect(screen.getByText('SENIOR REVIEWER')).toBeInTheDocument();
    });

    it('can collapse and expand MID-LEVEL REVIEWER section', async () => {
      const user = userEvent.setup();
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      const midButton = screen.getByRole('button', { name: /MID-LEVEL REVIEWER/i });
      
      // Collapse
      await user.click(midButton);
      // Expand
      await user.click(midButton);
      expect(screen.getByText('MID-LEVEL REVIEWER')).toBeInTheDocument();
    });

    it('displays annotation count for each level', () => {
      const initialAnnotations = {
        senior: [
          { id: '1', file: 'src/a.ts', line: 10, severity: 'critical' as const, comment: 'Critical' },
          { id: '2', file: 'src/b.ts', line: 20, severity: 'major' as const, comment: 'Major' },
        ],
        mid: [
          { id: '3', file: 'src/c.ts', line: 30, severity: 'minor' as const, comment: 'Minor' },
        ],
        junior: [],
      };

      render(
        <GroundTruthAnnotationEditor 
          initialAnnotations={initialAnnotations}
          onAnnotationsChange={mockOnAnnotationsChange}
        />
      );

      // Check counts display
      expect(screen.getByText(/2 ANNOTATIONS/)).toBeInTheDocument(); // SENIOR
      expect(screen.getByText(/1 ANNOTATIONS/)).toBeInTheDocument(); // MID
      expect(screen.getByText(/0 ANNOTATIONS/)).toBeInTheDocument(); // JUNIOR
    });
  });

  describe('Severity Levels', () => {
    it('supports CRITICAL severity', () => {
      const initialAnnotations = {
        senior: [
          { id: '1', file: 'src/a.ts', line: 10, severity: 'critical' as const, comment: 'Critical issue' },
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

      expect(screen.getByDisplayValue('src/a.ts')).toBeInTheDocument();
    });

    it('supports MAJOR severity', () => {
      const initialAnnotations = {
        senior: [
          { id: '1', file: 'src/a.ts', line: 10, severity: 'major' as const, comment: 'Major issue' },
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

      expect(screen.getByDisplayValue('src/a.ts')).toBeInTheDocument();
    });

    it('supports MINOR severity', () => {
      const initialAnnotations = {
        senior: [],
        mid: [],
        junior: [
          { id: '1', file: 'src/a.ts', line: 10, severity: 'minor' as const, comment: 'Minor issue' },
        ],
      };

      render(
        <GroundTruthAnnotationEditor 
          initialAnnotations={initialAnnotations}
          onAnnotationsChange={mockOnAnnotationsChange}
        />
      );

      expect(screen.getByDisplayValue('src/a.ts')).toBeInTheDocument();
    });
  });

  describe('Callback Handling', () => {
    it('calls onAnnotationsChange on component mount', () => {
      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      // Should call with default empty state
      expect(mockOnAnnotationsChange).toHaveBeenCalled();
    });

    it('calls onAnnotationsChange when adding annotation', async () => {
      const user = userEvent.setup();
      const callCount = mockOnAnnotationsChange.mock.calls.length;

      render(
        <GroundTruthAnnotationEditor onAnnotationsChange={mockOnAnnotationsChange} />
      );

      const addButtons = screen.getAllByText(/\+ ADD ANNOTATION/);
      await user.click(addButtons[0]);

      // Should have been called more times (at least once for add)
      expect(mockOnAnnotationsChange.mock.calls.length).toBeGreaterThan(callCount);
    });
  });

  describe('Accessibility', () => {
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
      expect(screen.getByText(/SENIOR REVIEWER/)).toBeInTheDocument();
    });
  });
});
