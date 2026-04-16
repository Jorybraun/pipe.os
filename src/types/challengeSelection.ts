/**
 * Represents a GitHub PR selected in ChallengePicker for a CODE_REVIEW challenge.
 */
export type ChallengeSelection = {
  source: 'github';
  repoUrl: string;
  prNumber: number;
  prTitle: string;
  prDescription: string;
  prAuthor: string;
};
