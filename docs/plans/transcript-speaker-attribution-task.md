# Task: Stream-Backed Transcript Speaker Attribution

## Problem

Meeting transcripts must know who is speaking so every extracted assertion can be linked to the correct participant and person/context graph evidence.

The current video-room recorder builds a two-channel transcription stream from the host browser:

- channel 0: host local audio
- channel 1: guest remote audio

The server maps Deepgram multichannel output as:

- channel 0 -> `host`
- channel 1 -> `guest`

This is the correct direction, but the fallback transcription path collapses audio into a mixed transcript and loses speaker attribution.

## Acceptance Criteria

- Persist an explicit channel-to-participant map with every recording upload.
- Verify the browser-produced transcription audio preserves two channels in deployed room-dev.
- Keep Deepgram multichannel as the attributed path and mark fallback transcripts as `summary_only`.
- Do not attach mixed/fallback statements to a candidate/person graph as if the guest said them.
- Add e2e coverage proving host speech and guest speech become separate transcript segments with `role`, `channel`, and source segment IDs.
- Preserve exact transcript segment provenance for living-context graph ingestion.

## Implementation Notes

- Continue allowing only the host to upload the recording.
- Upload speaker metadata alongside `recording` and `transcriptionAudio` in the multipart form.
- Store speaker metadata in R2/D1 next to `transcript_json`.
- If Deepgram returns fewer than two channels, keep the transcript searchable but set `personContextMode = summary_only`.
- Future live transcription should use participant stream IDs directly rather than inferring role after recording.
