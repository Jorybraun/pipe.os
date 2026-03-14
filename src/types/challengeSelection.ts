import type { ChallengeTemplate } from '../content/challengeLibrary';

/**
 * Discriminated union representing what the recruiter selected in ChallengePicker.
 *
 * - 'library': a static template from challengeLibrary.ts
 * - 'github': a real PR selected from the GitHub PR browser
 */
export type ChallengeSelection =
  | { source: 'library'; template: ChallengeTemplate }
  | {
      source: 'github';
      repoUrl: string;
      prNumber: number;
      prTitle: string;
      prDescription: string;
      prAuthor: string;
    };
