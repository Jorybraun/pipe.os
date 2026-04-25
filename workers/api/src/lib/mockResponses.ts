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
 * Generate deterministic mock score report (6-dimension BARS rubric)
 * Ensures tests pass without real scoring API calls
 */
export function getMockScoreReport(): ScoreReport {
  return {
    dimensions: {
      issue_identification: 4,
      reasoning_quality: 3,
      prioritization: 4,
      question_formation: 3,
      revision_evaluation: 3,
      ai_direction: 3,
    },
    evidence: {
      issue_identification_evidence: 'Found 2 of 3 planted bugs with correct categorization.',
      prioritization_evidence: 'Severity labels mostly correct; one minor miscalibration.',
      revision_evaluation_evidence: 'Verified critical fix but accepted one minor incomplete fix.',
      reasoning_quality_evidence: 'Most findings explain the failure mechanism.',
      question_formation_evidence: 'Asked one clarifying question before critiquing.',
      ai_direction_evidence: 'Evaluated implementer proposals on merit in most cases.',
    },
    metrics: {
      bugs_found: [1, 2],
      bugs_missed: [3],
      bugs_found_pct: 0.67,
      false_positive_count: 1,
      true_finding_count: 2,
      approved_with_unfound_critical: false,
      cave_ratio: 0.25,
      fix_verifications: 2,
    },
    effectiveness: {
      ris: 65.0,
      efficiency: 70.0,
      delta: 80.0,
      score: 68.5,
    },
    overall: {
      score: 52,
      band: 'adequate',
      narrative: 'The candidate demonstrates solid review skills, identifying most critical bugs and explaining their impact clearly. They could improve by verifying all claimed fixes rather than accepting some at face value.',
      strengths: ['Found critical bugs with correct severity', 'Clear technical explanations'],
      growth_areas: ['Verify all claimed fixes before accepting', 'Ask more clarifying questions'],
    },
    scorer_a_summary: 'Good bug detection and prioritization with room for improvement in fix verification.',
    scorer_b_summary: 'Clear reasoning with adequate question formation and AI direction.',
  };
}
