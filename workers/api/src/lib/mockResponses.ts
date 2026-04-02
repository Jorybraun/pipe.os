/**
 * Mock responses for AI agents when API keys are not configured
 * Used for local testing without real API calls
 */

import type { ImplementerResponse, ReviewComment } from './implementerAgent';
import type { ScoreReport } from './scorerAgent';
import type { ComprehensionQuestion, ExplainerResponse } from './explainerAgent';

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
 * Generate deterministic mock explainer response for comprehension mode
 * Includes a sample mermaid diagram to exercise frontend rendering
 */
export function getMockExplainerResponse(
  question: ComprehensionQuestion,
): ExplainerResponse {
  const location = question.file
    ? ` about ${question.file}${question.line ? `:${question.line}` : ''}`
    : '';

  return {
    content: `Good question${location}. This PR adds a caching layer to the status endpoint to reduce database load during peak traffic.\n\nThe approach uses an in-memory LRU cache with a 5-second TTL. When a request comes in, we check the cache first — if we have a fresh result, we return it immediately without hitting the database.\n\nHere's the data flow:\n\n\`\`\`mermaid\nsequenceDiagram\n    participant Client\n    participant API\n    participant Cache\n    participant DB\n    Client->>API: GET /status\n    API->>Cache: lookup(key)\n    alt Cache hit\n        Cache-->>API: cached result\n    else Cache miss\n        API->>DB: SELECT status\n        DB-->>API: result\n        API->>Cache: store(key, result, ttl=5s)\n    end\n    API-->>Client: status response\n\`\`\`\n\nThe key trade-off is freshness vs. load — a 5-second TTL means data can be slightly stale, but it reduces DB queries by ~95% under load.`,
    context_provided: ['architecture', 'data_flow', 'trade_off'],
    depth_level: 'moderate',
  };
}

/**
 * Generate deterministic mock comprehension score report
 */
export function getMockComprehensionScoreReport(): {
  question_quality: { score: number; summary: string };
  comprehension: { score: number; insights_discovered: number[]; insights_missed: number[]; summary: string };
  decision_quality: { score: number; summary: string };
  efficiency: { score: number; questions_to_insight_ratio: number; round_efficiency: number; redundancy_score: number };
  overall: { score: number; band: string; narrative: string; strengths: string[]; growth_areas: string[] };
} {
  return {
    question_quality: {
      score: 72,
      summary: 'Candidate asked strategic questions that built progressively toward understanding.',
    },
    comprehension: {
      score: 68,
      insights_discovered: [1, 2],
      insights_missed: [3, 4],
      summary: 'Identified the core purpose and main trade-off but missed deeper architectural implications.',
    },
    decision_quality: {
      score: 75,
      summary: 'Verdict aligned with ideal outcome with reasonable rationale.',
    },
    efficiency: {
      score: 70,
      questions_to_insight_ratio: 0.5,
      round_efficiency: 65,
      redundancy_score: 80,
    },
    overall: {
      score: 71,
      band: 'adequate',
      narrative: 'The candidate demonstrates solid comprehension skills, asking purposeful questions that reveal understanding of the system. They identified the core caching trade-off but could probe deeper into architectural risks.',
      strengths: ['Strategic questioning', 'Trade-off identification'],
      growth_areas: ['Deeper architectural probing', 'Risk assessment'],
    },
  };
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
