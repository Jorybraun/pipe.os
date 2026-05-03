import { describe, it, expect } from 'vitest';
import {
  evaluateAnswer,
  specificityScore,
  evaluateTranscript,
  type AnswerEvaluation,
} from '../answerEvaluator';

// ─── specificityScore ──────────────────────────────────────────────────────────

describe('specificityScore', () => {
  it('returns 0 for empty string', () => {
    expect(specificityScore('')).toBe(0);
  });

  it('detects numbers', () => {
    expect(specificityScore('We had 12 engineers on the team.')).toBeGreaterThanOrEqual(1);
  });

  it('detects dates', () => {
    expect(specificityScore('In March 2023 we shipped the feature.')).toBeGreaterThanOrEqual(1);
  });

  it('detects examples', () => {
    expect(specificityScore('For example, we used Kafka for streaming.')).toBeGreaterThanOrEqual(1);
  });

  it('detects specificity words', () => {
    expect(specificityScore('Specifically, I called the vendor named Acme.')).toBeGreaterThanOrEqual(1);
  });

  it('detects tech stack mentions', () => {
    expect(specificityScore('We run on AWS and built with TypeScript.')).toBeGreaterThanOrEqual(1);
  });

  it('sums multiple signals', () => {
    const text =
      'In Jan 2022 we had 5 engineers. For example, we specifically built a tool named Pipeline.';
    expect(specificityScore(text)).toBeGreaterThanOrEqual(3);
  });
});

// ─── evaluateAnswer ────────────────────────────────────────────────────────────

describe('evaluateAnswer', () => {
  it('classifies empty answer as thin', () => {
    const result = evaluateAnswer('');
    expect(result.quality).toBe('thin');
    expect(result.needsFollowUp).toBe(true);
  });

  it('classifies whitespace-only answer as thin', () => {
    const result = evaluateAnswer('   ');
    expect(result.quality).toBe('thin');
    expect(result.needsFollowUp).toBe(true);
  });

  it('classifies short vague answer as thin', () => {
    const result = evaluateAnswer('I just worked on stuff.');
    expect(result.quality).toBe('thin');
    expect(result.needsFollowUp).toBe(true);
  });

  it('classifies moderately long answer as moderate', () => {
    const result = evaluateAnswer(
      'I worked on the backend team and handled API integrations with third-party services.',
    );
    expect(result.quality).toBe('moderate');
    expect(result.needsFollowUp).toBe(false);
  });

  it('classifies specific short answer as moderate', () => {
    const result = evaluateAnswer('We used Kafka for event streaming in 2023.');
    expect(result.quality).toBe('moderate');
    expect(result.needsFollowUp).toBe(false);
  });

  it('classifies long specific answer as rich', () => {
    const result = evaluateAnswer(
      'In March 2022 I joined the platform team as a senior engineer. We had 8 engineers ' +
        'and I specifically owned the migration from monolith to microservices. For example, ' +
        'I broke the billing service out first using TypeScript and Kafka.',
    );
    expect(result.quality).toBe('rich');
    expect(result.needsFollowUp).toBe(false);
  });

  it('classifies long but vague answer as moderate', () => {
    const result = evaluateAnswer(
      'I have been working in software engineering for a very long time and have done many ' +
        'different things across various teams and projects with lots of people.',
    );
    expect(result.quality).toBe('moderate');
    expect(result.needsFollowUp).toBe(false);
  });

  it('includes reasoning for every classification', () => {
    const thin = evaluateAnswer('Nope.');
    const moderate = evaluateAnswer('I worked on backend systems with APIs.');
    const rich = evaluateAnswer(
      'In 2023 I led a team of 6 engineers to rebuild the checkout flow using Next.js and Stripe.',
    );
    expect(thin.reasoning.length).toBeGreaterThan(0);
    expect(moderate.reasoning.length).toBeGreaterThan(0);
    expect(rich.reasoning.length).toBeGreaterThan(0);
  });
});

// ─── evaluateTranscript ────────────────────────────────────────────────────────

describe('evaluateTranscript', () => {
  it('returns empty map for no turns', () => {
    const result = evaluateTranscript([]);
    expect(result.size).toBe(0);
  });

  it('evaluates only seed turns with responses', () => {
    const turns = [
      { candidateResponse: 'I worked at Acme for two years.', probeOf: null },
      { candidateResponse: 'Mostly backend work.', probeOf: 'q-1' }, // probe
      { candidateResponse: null, probeOf: null }, // pending
      { candidateResponse: 'I led the migration in 2023 with 5 engineers.', probeOf: null },
    ];
    const result = evaluateTranscript(turns);
    expect(result.size).toBe(2);
    expect(result.has(0)).toBe(true);
    expect(result.has(1)).toBe(false); // probe skipped
    expect(result.has(2)).toBe(false); // pending skipped
    expect(result.has(3)).toBe(true);
  });

  it('maps evaluations correctly by index', () => {
    const turns = [
      { candidateResponse: 'Short.', probeOf: null },
      {
        candidateResponse:
          'In March 2023 I joined the platform team and specifically built a distributed ' +
          'event processing system using Kafka and TypeScript. We had 5 microservices ' +
          'and I owned the retry logic. For example, I designed a dead-letter queue ' +
          'pattern that reduced failures by 40%.',
        probeOf: null,
      },
    ];
    const result = evaluateTranscript(turns);
    expect(result.get(0)!.quality).toBe('thin');
    expect(result.get(1)!.quality).toBe('rich');
  });
});
