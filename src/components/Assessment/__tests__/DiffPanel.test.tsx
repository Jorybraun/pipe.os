import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffPanel, DiffJson, Annotation } from '../DiffPanel';

const mockDiff: DiffJson = {
  files: [
    {
      path: 'src/services/email_sender.py',
      status: 'modified',
      additions: 89,
      deletions: 12,
      hunks: [
        {
          header: '@@ -15,8 +15,10 @@ class EmailSender:',
          lines: [
            { type: 'context', num: 15, content: 'class EmailSender:' },
            { type: 'context', num: 16, content: '    def __init__(self):' },
            { type: 'deletion', num: 17, content: '        self.config = {}' },
            { type: 'addition', num: 18, content: '        self.config = DEFAULT_CONFIG' },
            { type: 'addition', num: 19, content: '        self.rate_limiter = RateLimiter()' },
            { type: 'context', num: 20, content: 'return results' },
          ],
        },
      ],
    },
    {
      path: 'src/utils/rate_limiter.py',
      status: 'added',
      additions: 31,
      deletions: 0,
      hunks: [
        {
          header: '@@ -0,0 +1,31 @@',
          lines: [
            { type: 'addition', num: 1, content: 'import time' },
            { type: 'addition', num: 2, content: 'class RateLimiter:' },
            { type: 'addition', num: 3, content: '    def __init__(self):' },
          ],
        },
      ],
    },
  ],
  stats: {
    filesChanged: 2,
    additions: 120,
    deletions: 12,
  },
};

const mockAnnotations: Annotation[] = [
  {
    id: 'ann-1',
    file: 'src/services/email_sender.py',
    line: 18,
    severity: 'critical',
    comment: 'Bare exception catch',
    createdAt: '2026-03-14T10:00:00Z',
  },
];

describe('DiffPanel', () => {
  describe('Rendering', () => {
    it('should render the DiffPanel with all files', () => {
      render(<DiffPanel diff={mockDiff} />);
      expect(screen.getByTestId('diff-content')).toBeTruthy();
    });

    it('should display file tabs', () => {
      render(<DiffPanel diff={mockDiff} />);
      expect(screen.getByTestId('file-tab-0')).toHaveTextContent('email_sender.py');
      expect(screen.getByTestId('file-tab-1')).toHaveTextContent('rate_limiter.py');
    });

    it('should show correct file status badges', () => {
      render(<DiffPanel diff={mockDiff} />);
      expect(screen.getByTestId('file-tab-0')).toHaveTextContent('MOD');
      expect(screen.getByTestId('file-tab-1')).toHaveTextContent('NEW');
    });

    it('should display file statistics', () => {
      render(<DiffPanel diff={mockDiff} />);
      expect(screen.getByText('email_sender.py')).toBeTruthy();
      expect(screen.getByText('+89')).toBeTruthy();
      expect(screen.getByText('-12')).toBeTruthy();
    });
  });

  describe('File Tab Navigation', () => {
    it('should switch between files on tab click', () => {
      render(<DiffPanel diff={mockDiff} />);
      
      const tab0 = screen.getByTestId('file-tab-0');
      const tab1 = screen.getByTestId('file-tab-1');
      
      expect(tab0).toHaveAttribute('aria-selected', 'true');
      expect(tab1).toHaveAttribute('aria-selected', 'false');
      
      fireEvent.click(tab1);
      expect(tab1).toHaveAttribute('aria-selected', 'true');
    });

    it('should update file content when switching tabs', () => {
      render(<DiffPanel diff={mockDiff} />);
      
      expect(screen.getByText('@@ -15,8 +15,10 @@ class EmailSender:')).toBeTruthy();
      
      fireEvent.click(screen.getByTestId('file-tab-1'));
      expect(screen.getByText('@@ -0,0 +1,31 @@')).toBeTruthy();
    });

    it('should display correct line numbers for active file', () => {
      render(<DiffPanel diff={mockDiff} />);
      
      expect(screen.getByTestId('diff-line-15')).toBeTruthy();
      expect(screen.getByTestId('diff-line-17')).toBeTruthy();
    });
  });

  describe('Diff Content', () => {
    it('should render hunks with headers', () => {
      render(<DiffPanel diff={mockDiff} />);
      expect(screen.getByText('@@ -15,8 +15,10 @@ class EmailSender:')).toBeTruthy();
    });

    it('should display context lines', () => {
      render(<DiffPanel diff={mockDiff} />);
      expect(screen.getByText('class EmailSender:')).toBeTruthy();
      expect(screen.getByText('def __init__(self):')).toBeTruthy();
    });

    it('should display addition lines', () => {
      render(<DiffPanel diff={mockDiff} />);
      expect(screen.getByText('self.config = DEFAULT_CONFIG')).toBeTruthy();
      expect(screen.getByText('self.rate_limiter = RateLimiter()')).toBeTruthy();
    });

    it('should display deletion lines with strikethrough', () => {
      render(<DiffPanel diff={mockDiff} />);
      const deletionLine = screen.getByText('self.config = {}');
      expect(deletionLine).toBeTruthy();
    });
  });

  describe('Annotations', () => {
    it('should display annotation badge on annotated lines', () => {
      render(<DiffPanel diff={mockDiff} annotations={mockAnnotations} />);
      expect(screen.getByTestId('annotation-badge-18')).toBeTruthy();
      expect(screen.getByTestId('annotation-badge-18')).toHaveTextContent('1');
    });

    it('should display annotation details', () => {
      render(<DiffPanel diff={mockDiff} annotations={mockAnnotations} />);
      expect(screen.getByTestId('annotation-display-ann-1')).toBeTruthy();
      expect(screen.getByText('Bare exception catch')).toBeTruthy();
      expect(screen.getByText('critical')).toBeTruthy();
    });

    it('should show multiple annotations on same line', () => {
      const multiAnnotations: Annotation[] = [
        ...mockAnnotations,
        {
          id: 'ann-2',
          file: 'src/services/email_sender.py',
          line: 18,
          severity: 'major',
          comment: 'Check error types',
          createdAt: '2026-03-14T10:01:00Z',
        },
      ];
      render(<DiffPanel diff={mockDiff} annotations={multiAnnotations} />);
      expect(screen.getByTestId('annotation-badge-18')).toHaveTextContent('2');
    });
  });

  describe('Annotation Editor', () => {
    it('should not show annotation form in readOnly mode', () => {
      render(<DiffPanel diff={mockDiff} readOnly={true} />);
      fireEvent.click(screen.getByTestId('diff-line-15'));
      expect(screen.queryByTestId('annotation-editor-form')).toBeNull();
    });

    it('should show annotation form on line click', () => {
      const onAnnotationAdd = vi.fn();
      render(<DiffPanel diff={mockDiff} onAnnotationAdd={onAnnotationAdd} />);
      
      fireEvent.click(screen.getByTestId('diff-line-16'));
      expect(screen.getByTestId('annotation-editor-form')).toBeTruthy();
    });

    it('should not show annotation form for deletion lines', () => {
      render(<DiffPanel diff={mockDiff} />);
      fireEvent.click(screen.getByTestId('diff-line-17')); // deletion line
      expect(screen.queryByTestId('annotation-editor-form')).toBeNull();
    });

    it('should allow changing severity', () => {
      render(<DiffPanel diff={mockDiff} />);
      fireEvent.click(screen.getByTestId('diff-line-15'));
      
      const select = screen.getByTestId('severity-selector') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'major' } });
      expect(select.value).toBe('major');
    });

    it('should limit annotation comment to 500 characters', () => {
      render(<DiffPanel diff={mockDiff} />);
      fireEvent.click(screen.getByTestId('diff-line-15'));
      
      const input = screen.getByTestId('annotation-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'a'.repeat(600) } });
      expect(input.value.length).toBeLessThanOrEqual(500);
    });

    it('should disable save button when comment is empty', () => {
      render(<DiffPanel diff={mockDiff} />);
      fireEvent.click(screen.getByTestId('diff-line-15'));
      
      const button = screen.getByTestId('save-annotation-btn') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should enable save button when comment is entered', () => {
      render(<DiffPanel diff={mockDiff} />);
      fireEvent.click(screen.getByTestId('diff-line-15'));
      
      const input = screen.getByTestId('annotation-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Test comment' } });
      
      const button = screen.getByTestId('save-annotation-btn') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });

    it('should call onAnnotationAdd with correct data', () => {
      const onAnnotationAdd = vi.fn();
      render(<DiffPanel diff={mockDiff} onAnnotationAdd={onAnnotationAdd} />);
      
      fireEvent.click(screen.getByTestId('diff-line-15'));
      fireEvent.change(screen.getByTestId('annotation-input'), { target: { value: 'Test' } });
      fireEvent.click(screen.getByTestId('save-annotation-btn'));
      
      expect(onAnnotationAdd).toHaveBeenCalledWith({
        file: 'src/services/email_sender.py',
        line: 15,
        severity: 'critical',
        comment: 'Test',
      });
    });

    it('should clear form after saving annotation', () => {
      const onAnnotationAdd = vi.fn();
      render(<DiffPanel diff={mockDiff} onAnnotationAdd={onAnnotationAdd} />);
      
      fireEvent.click(screen.getByTestId('diff-line-15'));
      fireEvent.change(screen.getByTestId('annotation-input'), { target: { value: 'Test' } });
      fireEvent.click(screen.getByTestId('save-annotation-btn'));
      
      expect(screen.queryByTestId('annotation-editor-form')).toBeNull();
    });

    it('should close form on cancel', () => {
      render(<DiffPanel diff={mockDiff} />);
      fireEvent.click(screen.getByTestId('diff-line-15'));
      fireEvent.click(screen.getByTestId('cancel-annotation-btn'));
      expect(screen.queryByTestId('annotation-editor-form')).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels on tabs', () => {
      render(<DiffPanel diff={mockDiff} />);
      expect(screen.getByTestId('file-tab-0')).toHaveAttribute('aria-selected');
    });

    it('should be keyboard navigable', () => {
      render(<DiffPanel diff={mockDiff} />);
      const tab = screen.getByTestId('file-tab-0');
      tab.focus();
      expect(document.activeElement).toBe(tab);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty diff files array', () => {
      const emptyDiff: DiffJson = {
        files: [],
        stats: { filesChanged: 0, additions: 0, deletions: 0 },
      };
      render(<DiffPanel diff={emptyDiff} />);
      expect(screen.getByText('No diff files available')).toBeTruthy();
    });

    it('should toggle annotation form on same line click', () => {
      render(<DiffPanel diff={mockDiff} />);
      const line = screen.getByTestId('diff-line-15');
      
      fireEvent.click(line);
      expect(screen.getByTestId('annotation-editor-form')).toBeTruthy();
      
      fireEvent.click(line);
      expect(screen.queryByTestId('annotation-editor-form')).toBeNull();
    });
  });
});
