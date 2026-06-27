-- 0099_calendly_meeting_event_link.sql
-- Keep the provider event reference on the linked meeting as well as the
-- scheduled interview so Calendly bookings can be inspected 1:1.

ALTER TABLE meetings ADD COLUMN scheduling_provider TEXT;
ALTER TABLE meetings ADD COLUMN external_event_id TEXT;

UPDATE meetings
   SET scheduling_provider = (
         SELECT si.scheduling_provider
           FROM scheduled_interviews si
          WHERE si.id = meetings.scheduled_interview_id
       ),
       external_event_id = (
         SELECT si.external_event_id
           FROM scheduled_interviews si
          WHERE si.id = meetings.scheduled_interview_id
       )
 WHERE scheduled_interview_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meetings_external_event
  ON meetings(owner_id, scheduling_provider, external_event_id);
