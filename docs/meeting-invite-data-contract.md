# Meeting Invite Data Contract

## Overview

This document defines the data contract for meeting invites in PIPE-OS, supporting both contact-first (direct video calls) and pipeline-integrated (screening interviews) meeting models.

## Meeting Types

### `DIRECT_VIDEO_CALL`
- Contact-first meeting targeting a person by name and email
- Does not require candidate, pipeline, or stage context upfront
- Used for initial outreach, exploratory calls, or direct conversations

### `SCREENING_INTERVIEW`  
- Pipeline-integrated meeting tied to a specific candidate, pipeline, and stage
- Traditional scheduled interview flow
- Requires candidateId, pipelineId, and stageId

## Data Model

### ScheduledInterview Schema

```typescript
interface ScheduledInterview {
  // Core identification
  id: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;

  // Meeting type
  meetingType: 'DIRECT_VIDEO_CALL' | 'SCREENING_INTERVIEW';

  // Pipeline context (optional for contact-first)
  candidateId?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;

  // Recipient information (for contact-first)
  recipientName?: string | null;
  recipientEmail?: string | null;

  // Scheduling details
  status: 'INVITED' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  scheduledAt?: string | null;
  meetingUrl?: string | null;
  schedulingProvider?: 'CALENDLY' | 'CAL_COM' | 'MANUAL' | null;
  schedulingUrl?: string | null;
  externalEventId?: string | null;

  // Metadata
  recruiterNotes?: string | null;
  syncSource?: 'MANUAL' | 'WEBHOOK' | null;
  lastSyncedAt?: string | null;
  inviteLinkSentAt?: string | null;
  emailSentAt?: string | null;

  // Enriched fields (from JOINs)
  candidateName?: string | null;
  candidateEmail?: string | null;
  pipelineTitle?: string | null;
  stageTitle?: string | null;
}
```

## Validation Rules

### Contact-First Meetings
- Must provide: `recipientName` and `recipientEmail`
- Optional: `candidateId`, `pipelineId`, `stageId` (can be linked later)
- Default `meetingType`: `DIRECT_VIDEO_CALL`

### Pipeline-Integrated Meetings  
- Must provide: `candidateId`, `pipelineId`, `stageId`
- Optional: `recipientName`, `recipientEmail` (can use candidate data)
- Default `meetingType`: `SCREENING_INTERVIEW`

### General Constraint
- Either pipeline context (`candidateId` + `pipelineId` + `stageId`) OR recipient info (`recipientName` + `recipientEmail`) must be provided
- Both can be provided (e.g., screening interview with explicit recipient override)

## Graph Association Contract

### Recipient → Transcript → Meeting Artifact

This contract defines how meeting artifacts (transcripts, recordings, notes) are associated with recipients in the graph.

#### 1. Recipient Identification
- **Contact-first**: Identified by `recipientEmail` (unique per meeting)
- **Pipeline-integrated**: Identified by `candidate.email` from candidates table

#### 2. Transcript Storage
- Transcripts are stored in `voice_sessions` table with:
  - `transcript_json`: Full conversation transcript
  - `metadata.type`: Meeting type (`role-discovery`, `culture-interview`, `agent-interview`)
  - `metadata.contextId`: Optional role context ID
  - `metadata.ownerId`: Recruiter who initiated the session

#### 3. Graph Association
```
recipient_email (scheduled_interviews.recipient_email OR candidates.email)
  ↓
voice_sessions.id (via meeting_id or context association)
  ↓
transcript_json (voice_sessions.transcript_json)
  ↓
meeting_artifact (derived from transcript + metadata)
```

#### 4. Association Patterns

**Pattern A: Contact-First Direct Call**
```
scheduled_interviews.recipient_email
  → voice_sessions (linked via external_event_id or custom meeting_id field)
  → transcript_json
  → meeting_artifact (stored as JSON blob or separate table)
```

**Pattern B: Pipeline-Integrated Screening**
```
candidates.email
  → scheduled_interviews.candidate_id
  → voice_sessions (linked via candidate_id or contextId)
  → transcript_json
  → meeting_artifact
```

**Pattern C: Role Discovery Session**
```
role_context_participants.participant_email
  → voice_sessions.metadata.contextId (role_contexts.id)
  → transcript_json
  → role_context_document (synthesized from transcript)
```

#### 5. Artifact Types
- **Transcript**: Raw conversation text (JSON array of role/text pairs)
- **Summary**: AI-generated meeting summary
- **Action Items**: Extracted tasks and decisions
- **Assessment**: Candidate evaluation (for screening interviews)
- **Role Context Document**: Synthesized role definition (for role discovery)

## Feature Flags

### Role Discovery
- **Flag**: `FEATURE_FLAG_ROLE_DISCOVERY`
- **Default**: `false` (MVP scope)
- **Controls**: 
  - Role discovery page (`/pipeline/new` route)
  - Multi-stakeholder role intake UI
  - Role context participant management

### Pipeline Builder
- **Flag**: `FEATURE_FLAG_PIPELINE_BUILDER`
- **Default**: `false` (post-MVP)
- **Controls**:
  - Auto-stage construction from role context
  - AI-assisted pipeline configuration
  - Pipeline builder page (not yet implemented)

## Migration Notes

### Database Migration (0075_contact_first_meetings.sql)
- Added `meeting_type` column with CHECK constraint
- Added `recipient_name` and `recipient_email` columns
- Made `candidate_id`, `pipeline_id`, `stage_id` optional (nullable)
- Backfilled existing records with `meeting_type = 'SCREENING_INTERVIEW'`
- Added index on `recipient_email` for lookup performance

### TypeScript Type Updates
- Updated `ScheduledInterview` interface in `src/lib/scheduling/types.ts`
- Added `MeetingType` enum
- Made pipeline context fields optional
- Added recipient fields
- Updated validation schema in `workers/api/src/routes/cockpit/scheduling.ts`

## Acceptance Criteria Status

- [x] Meeting type supports direct video call and screening interview
- [x] Invite can target a person by name and email without candidateId, pipelineId, or stageId
- [x] Existing scheduled interview flow remains compatible (backfilled as SCREENING_INTERVIEW)
- [x] Feature flags exist for role discovery and pipeline builder visibility and default off for this MVP
- [x] Graph association contract is documented for recipient to transcript to meeting artifact

## Implementation Notes

1. **Backward Compatibility**: Existing scheduled interviews are preserved and default to `SCREENING_INTERVIEW` type
2. **Validation**: API enforces that either pipeline context OR recipient info is provided
3. **Flexibility**: Both models can coexist; a meeting can start contact-first and later be linked to a pipeline
4. **Transcription**: Real transcription is used in production; test-mode data should be clearly labeled as such
5. **Feature Flags**: Role discovery and pipeline builder are gated behind flags that default to `false` for MVP
