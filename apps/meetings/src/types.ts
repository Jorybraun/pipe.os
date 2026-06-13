/**
 * Domain types for the Meetings app.
 * Matches the backend schema from workers/meetings/src/types.ts
 */

// ─── Contact Types ─────────────────────────────────────────────────────────────

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

// ─── Meeting Types ─────────────────────────────────────────────────────────────

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

// ─── Meeting Participant Types ─────────────────────────────────────────────────

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

// ─── Participant with Contact Info ─────────────────────────────────────────────

export interface ParticipantWithContact extends MeetingParticipant {
  contact: Contact;
}
