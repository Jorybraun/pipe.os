/**
 * Environment bindings for the meetings Worker.
 * Shares the same D1 database (pipe-db) as the API Worker.
 */
export interface Env {
  /** D1 database binding — shared with pipe-api. */
  DB: D1Database;
  /** R2 bucket for meeting recordings. */
  STORAGE: R2Bucket;
  /** Workers AI binding for transcription (Whisper). */
  AI: Ai;
  /** Clerk secret key for JWT verification. */
  CLERK_SECRET_KEY: string;
  /** When 'true', bypasses Clerk JWT verification in local dev. */
  DEV_AUTH_BYPASS?: string;
  /** User ID to use when DEV_AUTH_BYPASS is enabled. */
  DEV_BYPASS_USER_ID?: string;
  /** Resend API key for meeting invite emails. */
  RESEND_API_KEY?: string;
  /** Base URL for the meetings app (e.g. https://meet.hire-pipe.com). */
  MEETINGS_APP_URL?: string;
  /** Base URL for the standalone video room app. */
  VIDEO_ROOM_APP_URL?: string;
  /** Base URL for the main app (e.g. https://pipe.build). */
  APP_BASE_URL?: string;
}

/** Hono context variables set by middleware. */
export interface Variables {
  userId: string;
}

// ─── Domain Types ─────────────────────────────────────────────────────────────

export type ContactType = 'PROSPECT' | 'CANDIDATE' | 'HIRING_MANAGER' | 'RECRUITER' | 'OTHER';

export interface Contact {
  id: string;
  owner_id: string;
  type: ContactType;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  notes: string | null;
  candidate_id: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

export type MeetingStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type MeetingType = 'DISCOVERY' | 'INTERVIEW' | 'FOLLOW_UP' | 'DEMO' | 'OTHER';
export type TranscriptStatus = 'NONE' | 'RECORDING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface Meeting {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  status: MeetingStatus;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  meeting_url: string | null;
  meeting_type: MeetingType;
  transcript_status: TranscriptStatus;
  transcript_json: string | null;
  transcript_summary: string | null;
  recording_r2_key: string | null;
  transcript_analysis_json: string | null;
  transcript_error: string | null;
  scheduled_interview_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ParticipantRole = 'HOST' | 'ATTENDEE' | 'OBSERVER';

export interface MeetingParticipant {
  id: string;
  meeting_id: string;
  contact_id: string;
  role: ParticipantRole;
  invite_sent_at: string | null;
  joined_at: string | null;
  left_at: string | null;
  created_at: string;
  updated_at: string;
}
