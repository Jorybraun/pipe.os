/**
 * Screening question templates — seed data for the screening stage.
 *
 * Organized by category so the UI can group them logically.
 * These are always available as starting points; recruiters can
 * customize or add their own.
 */

export type ScreeningCategory =
  | 'background'
  | 'motivation'
  | 'compensation'
  | 'experience'
  | 'availability'
  | 'logistics';

export type InputMode = 'text' | 'voice' | 'video';

export interface ScreeningQuestionTemplate {
  id: string;
  category: ScreeningCategory;
  text: string;
  /** Why a recruiter would ask this — shown as helper text */
  purpose: string;
  /** Suggested follow-ups the recruiter can ask */
  followUps?: string[];
  /** Preferred response format — recruiter can override when adding */
  defaultInputMode?: InputMode;
}

export const SCREENING_CATEGORIES: Record<ScreeningCategory, { label: string; description: string }> = {
  background: {
    label: 'Background',
    description: 'Who is this person and what do they bring?',
  },
  motivation: {
    label: 'Motivation',
    description: 'Why this role, why now?',
  },
  compensation: {
    label: 'Compensation',
    description: 'Salary expectations and total comp',
  },
  experience: {
    label: 'Experience',
    description: 'Relevant skills and past work',
  },
  availability: {
    label: 'Availability',
    description: 'Start date, notice period, location',
  },
  logistics: {
    label: 'Logistics',
    description: 'Work authorization, relocation, remote preferences',
  },
};

export const SCREENING_QUESTIONS: ScreeningQuestionTemplate[] = [
  // ── Background ──────────────────────────────────────────────────────────
  {
    id: 'scr-bg-1',
    category: 'background',
    text: 'Tell me a bit about yourself and your current role.',
    purpose: 'Warm-up opener — get a sense of who they are.',
    defaultInputMode: 'voice',
    followUps: [
      'What does a typical day look like for you?',
      'What part of your current role do you enjoy most?',
    ],
  },
  {
    id: 'scr-bg-2',
    category: 'background',
    text: 'Walk me through your career path — how did you end up where you are today?',
    purpose: 'Understand career trajectory and growth pattern.',
  },
  {
    id: 'scr-bg-3',
    category: 'background',
    text: 'What are you most proud of professionally?',
    purpose: 'Reveals what they value and where they see their strengths.',
    defaultInputMode: 'video',
  },

  // ── Motivation ──────────────────────────────────────────────────────────
  {
    id: 'scr-mo-1',
    category: 'motivation',
    text: 'What prompted you to explore new opportunities right now?',
    purpose: 'Understand push/pull factors — are they running from or toward something?',
    followUps: [
      'Is there anything that could change your mind about leaving?',
    ],
  },
  {
    id: 'scr-mo-2',
    category: 'motivation',
    text: 'What caught your eye about this role specifically?',
    purpose: 'Gauge genuine interest vs. passive browsing.',
  },
  {
    id: 'scr-mo-3',
    category: 'motivation',
    text: 'What does your ideal next role look like?',
    purpose: 'Check alignment between their expectations and what you offer.',
    followUps: [
      'What would make you say no to an offer?',
      'What are your must-haves vs. nice-to-haves?',
    ],
  },
  {
    id: 'scr-mo-4',
    category: 'motivation',
    text: 'What do you know about our company so far?',
    purpose: 'Assess research effort and genuine interest.',
  },

  // ── Compensation ────────────────────────────────────────────────────────
  {
    id: 'scr-co-1',
    category: 'compensation',
    text: 'What are your salary expectations for this role?',
    purpose: 'Early alignment on comp to avoid wasted time on both sides.',
    followUps: [
      'Is that base salary or total compensation?',
      'Are you flexible on that range?',
    ],
  },
  {
    id: 'scr-co-2',
    category: 'compensation',
    text: 'What does your current compensation package look like?',
    purpose: 'Understand their baseline and what a compelling offer needs to beat.',
  },
  {
    id: 'scr-co-3',
    category: 'compensation',
    text: 'Besides salary, what benefits or perks matter most to you?',
    purpose: 'Surface non-monetary factors (equity, remote, PTO, learning budget).',
  },

  // ── Experience ──────────────────────────────────────────────────────────
  {
    id: 'scr-ex-1',
    category: 'experience',
    text: 'Describe a recent project that is most relevant to this role.',
    purpose: 'Assess hands-on relevance to the position.',
    followUps: [
      'What was your specific contribution?',
      'What was the outcome?',
    ],
  },
  {
    id: 'scr-ex-2',
    category: 'experience',
    text: 'What technologies or tools are you working with day to day?',
    purpose: 'Quick stack alignment check.',
  },
  {
    id: 'scr-ex-3',
    category: 'experience',
    text: 'Have you worked in a similar team size / stage before?',
    purpose: 'Startup vs. enterprise fit — pace, ambiguity tolerance, autonomy.',
  },
  {
    id: 'scr-ex-4',
    category: 'experience',
    text: 'How many years of experience do you have with [key skill]?',
    purpose: 'Hard requirement check — fill in the bracketed skill.',
  },

  // ── Availability ────────────────────────────────────────────────────────
  {
    id: 'scr-av-1',
    category: 'availability',
    text: 'What is your notice period or earliest start date?',
    purpose: 'Timeline alignment — can they start when you need them?',
  },
  {
    id: 'scr-av-2',
    category: 'availability',
    text: 'Are you interviewing with other companies right now?',
    purpose: 'Urgency check — do you need to speed up your process?',
    followUps: [
      'How far along are you with them?',
      'Do you have any deadlines for offers?',
    ],
  },
  {
    id: 'scr-av-3',
    category: 'availability',
    text: 'What does your availability look like for the next round of interviews?',
    purpose: 'Scheduling logistics for the technical stage.',
  },

  // ── Logistics ───────────────────────────────────────────────────────────
  {
    id: 'scr-lo-1',
    category: 'logistics',
    text: 'Are you authorized to work in [country] without sponsorship?',
    purpose: 'Legal requirement — fill in the country.',
  },
  {
    id: 'scr-lo-2',
    category: 'logistics',
    text: 'This role is [remote/hybrid/onsite] — does that work for you?',
    purpose: 'Location and work-mode alignment.',
  },
  {
    id: 'scr-lo-3',
    category: 'logistics',
    text: 'Would you be open to relocating if required?',
    purpose: 'Only relevant for onsite/hybrid roles.',
  },
];

/** Group questions by category for UI rendering */
export function groupByCategory(): Map<ScreeningCategory, ScreeningQuestionTemplate[]> {
  const groups = new Map<ScreeningCategory, ScreeningQuestionTemplate[]>();
  for (const q of SCREENING_QUESTIONS) {
    const list = groups.get(q.category) ?? [];
    list.push(q);
    groups.set(q.category, list);
  }
  return groups;
}
