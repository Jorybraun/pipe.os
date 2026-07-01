-- 0111_backfill_dev_container_session_timestamps.sql
--
-- Migrations 0097 and 0101 rebuilt dev_container_sessions with
-- CREATE TABLE AS SELECT, which stripped timestamp defaults from D1. New app
-- inserts now stamp timestamps explicitly; this migration repairs any older
-- rows that were inserted while the copied table accepted NULL timestamps.

UPDATE dev_container_sessions
   SET created_at = COALESCE(
         NULLIF(created_at, ''),
         NULLIF(updated_at, ''),
         NULLIF(started_at, ''),
         NULLIF(stopped_at, ''),
         NULLIF(warned_at, ''),
         NULLIF(expires_at, ''),
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ),
       updated_at = COALESCE(
         NULLIF(updated_at, ''),
         NULLIF(created_at, ''),
         NULLIF(started_at, ''),
         NULLIF(stopped_at, ''),
         NULLIF(warned_at, ''),
         NULLIF(expires_at, ''),
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       )
 WHERE created_at IS NULL
    OR trim(created_at) = ''
    OR updated_at IS NULL
    OR trim(updated_at) = '';
