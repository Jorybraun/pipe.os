export interface ReviewSessionStatusColors {
  text: string;
  bg: string;
  border: string;
}

export const REVIEW_SESSION_STATUS_COLORS: Record<string, ReviewSessionStatusColors> = {
  pending: { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)' },
  in_progress: { text: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.3)' },
  scoring: { text: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)' },
  scored: { text: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' },
  scoring_failed: { text: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)' },
};

export const REVIEW_SESSION_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  scoring: 'Scoring…',
  scored: 'Scored',
  scoring_failed: 'Scoring Failed',
};

const FALLBACK: ReviewSessionStatusColors = {
  text: '#fbbf24',
  bg: 'rgba(251,191,36,0.1)',
  border: 'rgba(251,191,36,0.3)',
};

export function getReviewSessionStatusColors(status: string): ReviewSessionStatusColors {
  return REVIEW_SESSION_STATUS_COLORS[status] ?? FALLBACK;
}
