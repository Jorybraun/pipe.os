/**
 * Mock responses for AI agents when API keys are not configured
 * Used for local testing without real API calls
 */

import type { ImplementerResponse, ReviewComment } from './implementerAgent';
import type { ScoreReport } from './scorerAgent';

/**
 * Generate deterministic mock implementer responses based on comment count
 * Ensures tests are reproducible without external API calls
 */
export function getMockImplementerResponses(
  newComments: ReviewComment[],
  persona: 'junior' | 'senior',
): ImplementerResponse[] {
  return newComments.map((comment, idx) => {
    const moveOptions: Array<'comment' | 'change' | 'pushback'> = ['comment', 'change', 'pushback'];
    const moveIdx = (comment.id + idx + (persona === 'junior' ? 1 : 0)) % moveOptions.length;
    const move = moveOptions[moveIdx]!;

    return {
      to_comment_id: comment.id,
      move,
      content:
        persona === 'junior'
          ? `Thanks for pointing that out. I'll ${move === 'change' ? 'fix' : 'consider'} this.`
          : `Good catch. Here's my perspective on this: ${comment.what.toLowerCase()}. I've ${move === 'change' ? 'updated the code' : 'documented'} accordingly.`,
      ...(move === 'change' ? { updated_code: '// Updated code here\nfunction example() { return true; }' } : {}),
    };
  });
}

/**
 * Generate deterministic mock score report
 * Ensures tests pass without real scoring API calls
 */
export function getMockScoreReport(): ScoreReport {
  return {
    overall_score: 75,
    technical_score: {
      score: 75,
      dimensions: {
        understanding: 7,
        approach: 7,
        implementation: 8,
      },
      summary: 'Good technical understanding with room for improvement in edge case handling.',
    },
    conversation_score: {
      score: 70,
      dimensions: {
        clarity: 7,
        engagement: 7,
        responsiveness: 6,
      },
      summary: 'Clear communication and good engagement with reviewer feedback.',
    },
    practice_score: {
      score: 78,
      dimensions: {
        code_quality: 8,
        testing: 7,
        documentation: 8,
      },
      summary: 'Good coding practices with attention to quality and maintainability.',
    },
    narrative: 'The candidate demonstrates solid technical abilities and good communication. They should focus on handling edge cases and writing more comprehensive tests.',
  };
}
