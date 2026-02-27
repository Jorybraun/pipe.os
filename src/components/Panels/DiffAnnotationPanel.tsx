import { DiffReviewCanvas } from '../Assessment/CodeReview/DiffReviewCanvas';

interface DiffAnnotationPanelProps {
  snippets: Array<{
    id: string;
    title: string;
    code: string;
    language: string;
  }>;
  onAnnotationsChange: (annotations: any) => void;
}

/**
 * DiffAnnotationPanel - Wraps the existing DiffReviewCanvas for the composable system.
 */
export function DiffAnnotationPanel({
  snippets,
  onAnnotationsChange
}: DiffAnnotationPanelProps): JSX.Element {
  return (
    <div style={{ height: '100%', width: '100%', background: '#0c0c0e', overflowY: 'auto' }}>
      <DiffReviewCanvas 
        snippets={snippets}
        onAnnotationsChange={onAnnotationsChange}
      />
    </div>
  );
}
