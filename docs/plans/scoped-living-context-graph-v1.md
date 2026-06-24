# Scoped Living Context Graph V1

Last updated: 2026-06-24

## Purpose

The broad graph goal is the production north star. This document defines the first concrete working loop.

V1 is successful when PIPE can take one role source, one candidate or developer source, and one repository source, decompose each into source-backed context records, connect them through one evidence-backed match, and render that connected graph with source provenance visible.

## V1 End State

V1 must prove this exact loop:

1. A hiring-team role conversation or simple job description creates a `role_context` graph.
2. A candidate or developer conversation, resume, message, or assessment creates a `workspace_person` graph.
3. A repository or pull request creates a `repo` or `repo_challenge_packet` graph.
4. A deterministic match creates a `match` graph that connects role evidence, person evidence, and repo evidence.
5. The UI visualizes the connected graph and lets the user inspect the exact source behind every displayed conclusion.

This is the minimum useful version of the hypergraph. It is not only a person graph, not only a repo graph, and not only a match report. It is the first loop where all three scopes can be decomposed, connected, explained, and rebuilt.

## Definitions

**Source artifact**

The immutable original content PIPE received: transcript, recording transcript, resume, message, assessment response, job description, repository file, PR diff, or review packet input.

**Source span**

The exact line, paragraph, byte range, character range, or repo line range that supports a later assertion. Source spans are the audit trail. No displayed conclusion is trusted without one, unless it is explicitly marked as a gap or missing evidence.

**Scope**

The graph boundary where evidence accumulates.

Current V1 scopes are:

- `role_context`: what a hiring team means by the role.
- `workspace_person`: what PIPE knows about the underlying person across contacts, applicants, meetings, resumes, messages, and assessments.
- `repo`: source-backed repository structure and behavior.
- `repo_challenge_packet`: a reviewable PR challenge derived from repo evidence.
- `match`: an evidence-backed decision connecting a person, role, and challenge.

**Context record**

The core semantic hyperedge. A context record is one meaning-bearing assertion with:

- one scope,
- one predicate,
- a narrative,
- exact source refs,
- zero or more linked entities,
- zero or more linked concepts,
- qualifiers and confidence,
- an extraction version.

This is why the system is a hypergraph rather than a simple node-edge graph: one context record can connect a source span, a role, a person, a repo file, a PR demand, multiple concepts, and a match decision at the same time.

**Concept**

An open semantic term learned from evidence. Concepts are persisted data, not code-owned enums. Unknown terms must survive ingestion and become searchable without adding a hard-coded skill, domain, alias, signal, node type, or semantic edge to application code.

**Projection**

A rebuildable read model or visualization model derived from artifacts, source spans, context records, concepts, and source refs. Projections can be optimized for UI or search, but they are never the source of truth.

**Visualization**

A graph view of scopes, context records, evidence, and match overlays. React Flow or any UI graph library is only a rendering layer. The persisted context graph remains authoritative.

## Required Paths

### Role Context Path

Input examples:

- simple job description,
- hiring manager meeting transcript,
- stakeholder message about requirements,
- role assessment rubric.

Required V1 behavior:

1. Store the original role source as an artifact version.
2. Create exact source spans for the role text or transcript paragraphs.
3. Create `context_records` with `scope_type = 'role_context'`.
4. Link each role assertion to source refs and open concepts.
5. Render role evidence in the graph, including exact source text.

Current proof:

- `persistSimpleJobDescriptionContext` creates `job_description` artifacts, source spans, open concepts, and `simple_job_description` context records.
- Role conversation participants now project answered `role_context_participants.exchanges` into `role_conversation_transcript` artifacts, exact question/answer source spans, `role_conversation_exchange` context records, linked stakeholder/exchange/question entities, and open concepts learned from literal conversation evidence. The scoped role graph read path backfills this projection idempotently before returning `GET /api/v1/role-contexts/:id/living-context`.

Main gap:

- Promote role conversation graph evidence into the browser-level role `GRAPH` and downstream role/person/repo matching proof, then combine it with recorded person evidence and live repo packets in deployed CI.

### Person Context Path

Input examples:

- recorded interview transcript,
- resume,
- recruiter note,
- candidate message,
- assessment answer.

Required V1 behavior:

1. Resolve contacts and applicants to the same underlying person when evidence indicates they are the same person.
2. Store each interaction as separate source evidence.
3. Create `context_records` with `scope_type = 'workspace_person'`.
4. Keep interaction-level evidence separate from accumulated person evidence.
5. Render both the interaction branch and the accumulated person graph.

Current proof:

- Meeting transcript ingestion and roleless candidate intake already prove same-person convergence and source-backed transcript evidence in the candidate graph.
- The standalone review browser path now renders meeting-shaped candidate evidence as a `video_meeting` / `meeting_transcript` interaction branch and uses the same source spans in the role/person/repo match bridge.
- Backend matcher coverage now starts from `ingestMeetingTranscriptToLivingContext`, writes `meeting_transcript_assertion` context records with exact transcript source spans and open concepts, converges the contact to the candidate person graph, and selects a source-backed PR challenge from that transcript-derived person evidence.
- Meeting-room route coverage now uploads a host recording plus transcription audio, runs structured transcription and analysis through `processRecording`, writes transcript-derived person-context assertions from the exact guest source span, creates the candidate bridge on match if needed, and selects a source-backed PR challenge from that recording-route evidence.
- Recruiter `CONTEXT` browser coverage now renders recording provenance on the meeting evidence branch: transcript `READY`, transcription provider, preserved `recording.webm`, preserved `transcription-audio.webm`, exact transcript evidence, and the connected role/person/repo evidence bridge.
- Video-room browser coverage now proves recording is host-manual and visible in recruiter `CONTEXT`: the host-side `Start recording` control is disabled before both participants connect, recording does not start automatically after connection, the host click marks the meeting `RECORDING`, host `End call` uploads multipart `recording.webm` plus `transcription-audio.webm`, the meeting reaches `READY`, a same-email roleless candidate converges onto the person graph, and the candidate `CONTEXT` tab renders the exact transcript source span plus both saved media keys on the meeting evidence branch.
- The same true host/guest browser recording path now continues into deterministic matching: it uses the exact recorded guest transcript span as existing person evidence, seeds only role/repo graph context for a fresh open concept, selects the specific source-backed PR packet, and renders the recorded person source beside role/JD and repo source spans in recruiter `CONTEXT`.
- Backend matcher coverage now proves the same role/person/repo loop with a live-shaped `mui/base-ui#973` packet: transcript-derived person context records plus role/JD source evidence select the specific PR packet and persist the match decision with role source, transcript source, selected packet hash, repo source spans, entities, and matched open concepts.
- The recording-to-match browser fixture can now run without seeding a repo packet when `E2E_EXISTING_REVIEW_PACKET_ID` is set. In that mode it records a popover/patient-click-threshold transcript, creates source-backed role evidence, requires the matcher to select the existing persisted packet, and asserts the UI bridge against live packet repo evidence such as `PATIENT_CLICK_THRESHOLD`.
- Remote E2E now has an opt-in live-packet lane for that proof: enable it by repo variable or manual workflow input, deploy the test API and standalone room worker, reset/seed test D1, insert only crawler input rows for `mui/base-ui#973`, run write-mode source-backed review-packet backfill, gate the persisted packet report, export the persisted context-ready packet ID from the backfill JSON, then run Playwright with that `E2E_EXISTING_REVIEW_PACKET_ID`.

Main gap:

- Resolve the GitHub Actions billing/spending-limit blocker, then rerun workflow `E2E Test Environment` with inputs `remote_e2e=true` and `live_review_packet_e2e=true`, then remove the remaining local/test provider overrides. Draft PR #100 is open from clean branch `codex/scoped-context-graph-ci`; earlier branch commit `208e7ce0f` was pushed and workflow run `28074000975` reached GitHub, but GitHub rejected the job before runner startup because recent account payments failed or the spending limit needs to be increased. Remote D1 now has graph tables and one real overlay-ready packet for `mui/base-ui#973`, with a `repo_challenge_packet` context record, repo source refs, concept links, and passing remote readiness. The workflow carries the test D1 database ID as test-environment config, derives the room worker URL from Wrangler output or the Cloudflare Workers subdomain API unless `TEST_VIDEO_ROOM_BASE` is present as an override, treats `E2E_EMAIL`/`E2E_PASSWORD` as optional overrides for the defaults already used by `e2e/auth.setup.ts`, and uses `CRAWLER_GITHUB_TOKEN` only as an optional override for the built-in GitHub token.

### Repository Context Path

Input examples:

- repository file,
- PR diff,
- commit metadata,
- source-backed repository crawler output,
- review challenge packet input.

Required V1 behavior:

1. Preserve commit, file, and line-level provenance.
2. Decompose code into files, spans, symbols, structural facts, behavioral episodes, assertions, and signals.
3. Create source-backed context records for reviewable PR challenge packets.
4. Reject repository evidence that lacks exact provenance.
5. Render repo structure and PR demand evidence in the graph.

Current proof:

- Review challenge packet persistence creates source-backed repo spans and packet context records.
- The focused matcher proof now builds a live-shaped `mui/base-ui#973` packet through the normal repo graph builders and persistence path, including source/test artifacts, exact repo source spans, symbols, structural facts, a behavioral episode, a semantic assertion, a repo signal, and a packet context projection.

Main gap:

- Broaden remote review-packet coverage beyond the first persisted `mui/base-ui#973` packet, then rebuild Neo4j/search projections from D1 as rebuildable projections.

### Match Path

Input examples:

- role context records,
- person context records,
- repo challenge packet context records.

Required V1 behavior:

1. Select one specific reviewable PR challenge.
2. Create a match decision context record.
3. Link aligned role, person, and repo evidence to exact sources.
4. Report missing evidence and stretch areas explicitly.
5. Render the match overlay with role source, candidate source, repo source, excluded packets, and gaps.

Current proof:

- Candidate-to-PR matching already carries role/JD, candidate, and repo source refs through match explanations and UI overlay tests.
- The candidate graph now renders an evidence bridge that puts role requirement evidence, person evidence, and repo challenge evidence into one aligned row, preserving source-ref metadata for each side.
- Focused Playwright coverage proves the recruiter candidate `CONTEXT` tab renders the bridge after standalone review submission with exact role/JD text, meeting-transcript candidate source text, repo source text, open concepts, and source-ref attributes visible.
- Focused matcher coverage now proves a real transcript-ingestion path can produce person-context semantics that select the PR packet and persist candidate/repo source refs in the match query and explanation.
- Meeting-room route coverage now proves the recording upload/transcription route can produce match-eligible source-backed person evidence and persist selected candidate/repo evidence on the `candidate_pr_match_decision` context record.
- True host/guest browser coverage now proves the user-visible recording UX can feed that same match path: manual recording, transcript `READY`, same-person candidate convergence, fresh unknown concept survival, selected packet identity, and a rendered role/person/repo source bridge in recruiter `CONTEXT`.

Main gap:

- Promote the live-shaped matcher proof to the actual live/backfilled `mui/base-ui#973` packet in the browser/deployed CI environment.

## What "Hypergraph" Means Here

PIPE's hypergraph is not just a visual graph with more edges.

A normal edge says:

```text
candidate -> knows -> Kafka
```

PIPE's source-backed hyperedge says:

```text
context_record:
  scope: workspace_person/person-123
  predicate: described production incident recovery work
  source: transcript paragraph 14
  entities:
    - person-123 as subject
    - meeting-456 as interaction
    - repo_challenge_packet-789 as later aligned demand
  concepts:
    - term:incident-recovery
    - term:kafka
  qualifiers:
    tense: past_work
    evidence_kind: self_reported_interview
```

One semantic record can connect multiple nodes, concepts, sources, and later match decisions without flattening the meaning into separate disconnected binary edges. The visualization can draw many edges from that record, but the persisted record remains the meaning-bearing unit.

## Non-Goals For V1

- Live AI assistant during the call.
- Live captions or real-time interventions.
- Hard-coded skills, aliases, seniority levels, domains, node types, or semantic predicates.
- A graph UI that invents conclusions from layout data.
- Matching from embeddings alone.
- Repository summaries that cannot be traced to exact files, commits, and lines.
- Calling the system production-ready before browser E2E, idempotent backfills, rebuildable projections, and expert-labelled evaluation pass.

## V1 Acceptance Checks

V1 is specific enough when these checks pass:

1. A role source appears in the graph with exact source text and open concepts.
2. A candidate or developer source appears in the graph with exact source text and open concepts.
3. A repo or PR source appears in the graph with exact file/line provenance and open concepts.
4. A match connects role, person, and repo context records without generic fallback.
5. The match explanation shows aligned evidence, missing evidence, and stretch areas.
6. The visualization renders source-backed context records as inspectable hyperedges.
7. Unknown concepts survive ingestion without code changes.
8. Projections can be deleted and rebuilt from artifacts, source spans, context records, concepts, and source refs.
9. The browser E2E proves the loop from input to graph to match overlay.
10. The evaluation gate uses expert-labelled examples with reviewer and source provenance.

## Continuous Integration Working Loop

Each implementation slice should follow this loop:

1. Pick one scope and one source type.
2. Persist the source artifact and exact source spans.
3. Create source-backed context records with open concepts.
4. Build or update a rebuildable projection.
5. Render the projection in the graph UI.
6. Add a focused API/component test.
7. Add or extend a browser E2E for the user-visible path.
8. Run the relevant type-check, unit tests, and `git diff --check`.
9. Update the tracker with evidence and the next missing proof.

## Next Concrete Slice

The role-context scoped graph read model now exists:

```text
GET /api/v1/role-contexts/:id/living-context
```

It returns the same kind of source-backed graph substrate that the candidate graph uses today:

- role artifacts,
- source spans,
- context records,
- concepts,
- source refs.

That turns simple job descriptions and answered role conversations into first-class visual graph inputs. The role graph is now rendered as a `GRAPH` tab on the interview-plan overview when a role context exists, and the candidate graph renders a match evidence bridge that shows role-context evidence beside person evidence and repo challenge evidence in one connected overlay. The standalone review browser path now verifies that bridge with source-backed role evidence, meeting-shaped candidate transcript evidence, and repo packet evidence.

The matcher proof now also starts from real meeting-transcript ingestion instead of hand-shaped candidate atoms: transcript segments become source spans, source spans back `meeting_transcript_assertion` hyperedges, those hyperedges produce candidate match atoms, and the deterministic matcher selects a source-backed PR packet with repo source spans in the explanation. The route-level proof goes one step further: the host recording upload path preserves `recording.webm` and `transcription-audio.webm`, processes the transcript through the meeting-room pipeline, repairs the candidate/person application bridge when matching needs it, and persists selected candidate/repo source refs on the match decision record. The browser proof now closes the user-visible loop: host-manual recording produces attributed transcript evidence, candidate convergence reuses that evidence, matching selects the fresh packet ID, and recruiter `CONTEXT` renders the recorded transcript source beside the role and repo source spans. The latest backend proof aligns that same role/person/repo loop with a live-shaped `mui/base-ui#973` packet and verifies the selected match hyperedge persists role source, transcript source, packet hash, repo source spans, entities, and matched open concepts. The CI wiring now makes the real-packet browser proof executable against a deployed test environment without opening production-only internal routes, and the room app now requires an explicit host click before recording starts.

Important attribution boundary: a summary-only or mixed-speaker recording transcript is valid meeting evidence and remains searchable as a source artifact, but it is not promoted into candidate/person match evidence. Only attributed guest/person transcript segments can create `meeting_transcript_assertion` hyperedges that participate in deterministic candidate-to-PR matching. This keeps the graph useful without laundering host speech, room noise, or provider guesses into candidate claims.

The next best slice is to resolve the GitHub Actions billing/spending-limit blocker and rerun workflow `E2E Test Environment` with inputs `remote_e2e=true` and `live_review_packet_e2e=true`, proving the deployed recording-to-match browser loop uses the actual backfilled `mui/base-ui#973` packet in test D1, then broaden remote review-packet coverage and rebuild graph/search projections from D1.
