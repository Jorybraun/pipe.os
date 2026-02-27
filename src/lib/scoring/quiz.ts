import { QuizQuestion } from '../../content/quizQuestions';

// ============================================================================
// Types
// ============================================================================

interface QuizSubmission {
  answers: Record<string, number>; // questionId -> selectedIndex
}

export interface QuizScoreResult {
  total: number;
  breakdown: {
    correct: number;
    total: number;
  };
}

// ============================================================================
// Logic
// ============================================================================

/**
 * scoreQuiz - Computes a score for a multiple-choice quiz.
 * 
 * Formula: (correct / total) * 100
 */
export function scoreQuiz(
  submission: QuizSubmission,
  questions: QuizQuestion[]
): QuizScoreResult {
  if (!questions || questions.length === 0) {
    return { total: 0, breakdown: { correct: 0, total: 0 } };
  }

  const answers = submission.answers || {};
  let correctCount = 0;

  questions.forEach(q => {
    const selected = answers[q.id];
    if (selected === q.correct) {
      correctCount++;
    }
  });

  const total = Math.round((correctCount / questions.length) * 100);

  return {
    total,
    breakdown: {
      correct: correctCount,
      total: questions.length
    }
  };
}
