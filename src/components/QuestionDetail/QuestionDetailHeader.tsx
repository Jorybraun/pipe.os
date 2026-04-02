import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Props for the QuestionDetailHeader component.
 */
export interface QuestionDetailHeaderProps {
  /**
   * Current question ID.
   */
  questionId: string;

  /**
   * Optional callback fired when back button is clicked.
   */
  onBack?: () => void;
}

/**
 * Header component for question detail view with back navigation.
 *
 * Displays a back arrow button that navigates to the pipeline builder.
 * Keyboard accessible with Enter/Space key support.
 */
export function QuestionDetailHeader({
  questionId,
  onBack,
}: QuestionDetailHeaderProps): JSX.Element {
  const navigate = useNavigate();
  const { id, stage } = useParams<{ id: string; stage: string }>();

  const handleBack = (): void => {
    if (onBack) {
      onBack();
    }
    // Navigate back to the stage detail page (questions list)
    navigate(`/pipeline/${id}/${stage}`);
  };

  return (
    <div style={{ marginBottom: 32, display: 'flex', alignItems: 'center', gap: 16 }}>
      <button
        type="button"
        onClick={handleBack}
        aria-label="Back to questions list"
        style={{
          padding: 12,
          background: 'var(--pipe-surface)',
          border: '1px solid var(--pipe-border)',
          color: 'var(--pipe-text-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
          e.currentTarget.style.color = '#fff';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
        }}
      >
        <ArrowLeft size={18} />
      </button>

      <div>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}>
          QUESTION DETAIL
        </div>
        <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)', marginTop: 4 }}>
          {questionId}
        </div>
      </div>
    </div>
  );
}
