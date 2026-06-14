# Handoff: UI Visualization Plan — Person-Centered Semantic Brain

**Date:** 2026-06-14
**Status:** Report-only (no implementation)
**Repository:** `Jorybraun/pipe.os`
**Branch:** `main`
**Depends on:** `knowledge/docs/handoffs/2026-06-13-living-context-repo-matching-handoff.md`
**Canonical plan:** `knowledge/plan/living-context-repo-matching-plan.md`

---

## 1. Current UI Surfaces That Already Show Living Context

### 1a. CandidateProfilePage — CONTEXT tab

**File:** `src/pages/CandidateProfilePage.tsx:1569-1777`

The CONTEXT tab renders `<LivingContextGraph>` inside the candidate profile.
It is one of several tabs (PROFILE, ENRICHMENT, CHALLENGES, CONTEXT).
The tab shows a `Network` icon and the label "CONTEXT". It receives:
- `candidateId` — D1 candidate row ID
- `standaloneReviewMatch` — populated for pipeline-free CODE_REVIEW invites

The tab is gated on having a valid `id` param. It is recruiter-facing (Clerk auth).

### 1b. LivingContextGraph component

**File:** `src/components/Candidate/LivingContextGraph.tsx` (703 lines)
**Styles:** `src/components/Candidate/LivingContextGraph.css` (718 lines)
**Data:** `src/hooks/useLivingContext.ts` → `GET /api/v1/candidates/:candidateId/living-context`

Three-column layout:

| Column | Content |
|--------|---------|
| Left rail | Person card (name, email, roles), interaction list with "All context" toggle |
| Main canvas | Signals grid (interaction + accumulated scores, evidence count, confidence), assertions (predicate, narrative, concepts, relationships, source buttons), source artifacts (type, version, spans) |
| Right inspector | Selected source evidence detail (exact text, locator, segment, version, evidence role, media type, span ID), interaction branch metadata |

Key capabilities already present:
- **Interaction-level filtering**: click any interaction to isolate its assertions/signals/artifacts
- **Accumulated context ("All")**: shows every assertion and signal across every interaction
- **Search**: full-text search across predicates, narratives, concepts, evidence text
- **Source provenance drill-down**: every assertion and signal links to exact `SourceButton` references; clicking one populates the inspector with `exactText`, locators, version, media type
- **Standalone CODE_REVIEW match panel** (`StandaloneReviewMatchPanel`): displays match status badge, selected PR (name, number, URL, title), match score, evidence alignment rows (atom → demand, pair score, candidate/PR source labels, exact snippets, shared concepts), evidence gaps, and candidate submission with annotations

### 1c. Meetings app — MeetingsPage detail panel

**File:** `apps/meetings/src/pages/MeetingsPage.tsx:451-700`

Shows a `MEETING_INTELLIGENCE` section when `transcript_summary` or `transcript_status !== 'NONE'`.
Renders:
- Transcript status label (RECORDING, PROCESSING, READY, FAILED)
- `transcript_summary` (plain text paragraph)
- `transcript_error` if failed

The detail panel also shows participants, room links, and scheduling data.

**No living context, assertions, or signals appear in the meetings app.**

### 1d. Meetings app — ContactsPage

**File:** `apps/meetings/src/pages/ContactsPage.tsx`

Standard CRUD contact list with type filter, search, detail drawer. Shows name, email, phone, company, title, notes, tags. Contact types: PROSPECT, CANDIDATE, HIRING_MANAGER, RECRUITER, OTHER.

Contacts have `candidate_id` field linking to the main app, but the contact detail never surfaces living context, assertions, or signals.

### 1e. AIAssistant

**File:** `apps/meetings/src/components/AIAssistant.tsx`

Chat-based copilot that can navigate to contacts/meetings and render `ContactCard` / `MeetingCard` components via agent actions. No semantic context, assertions, or signals are surfaced.

---

## 2. Missing UI Surfaces for Meeting Memory

### 2a. No person-level timeline in meetings app

Meetings are listed chronologically but there is no unified **person timeline** that shows:
- All meetings involving a given contact
- All assertions extracted from those meetings
- How signals evolved across meeting interactions
- Accumulated context for a person across meetings + CODE_REVIEW

### 2b. No living context in contact detail

The `ContactsPage` detail drawer shows only flat CRUD fields. A contact's accumulated semantic brain (assertions, signals, source evidence) is invisible even though the backend already ingests meeting transcripts into the living context graph via `workers/api/src/lib/livingContext/meetingTranscript.ts`.

### 2c. No assertion/signal view in meeting detail

`MeetingDetailPanel` shows `transcript_summary` as a single text blob. There is no breakdown of:
- Individual semantic assertions extracted from the meeting
- Signal evidence and evidence levels (mentioned, demonstrated, etc.)
- Exact source spans from the transcript

### 2d. No cross-source evidence comparison

The recruiter CONTEXT tab shows everything per-candidate, but there is no way to compare or merge evidence from meetings with evidence from CODE_REVIEW or resume intake side-by-side — the interaction filter shows one at a time.

### 2e. No meeting-to-candidate link in meetings UI

A meeting participant who is also a candidate has `candidate_id` on the contact, but the meetings app never links to the candidate's living context graph.

---

## 3. Proposed Information Architecture

### 3a. Person Timeline

A vertical timeline view rooted on a person/contact that shows every interaction as a node:

```
Person: Jane Doe (jane@example.com)
├─ 2026-06-10 · MEETING · Discovery call
│  ├─ 4 assertions, 3 signals extracted
│  └─ [Expand to see assertion cards]
├─ 2026-06-11 · RESUME · Resume intake
│  ├─ 12 assertions, 8 signals extracted
│  └─ [Expand]
├─ 2026-06-12 · CODE_REVIEW · Standalone review
│  ├─ Match: repo-x #42 (87% score)
│  ├─ 6 assertions, 5 signals
│  └─ [Expand]
└─ Accumulated: 22 assertions, 16 signals, 3 source types
```

**Placement:** Could live in the meetings app contact detail (for contacts) and in the main app's CONTEXT tab (for candidates). Both views use the same `LivingContextReadModel`.

### 3b. Source Evidence Drawer

An expandable side drawer (or bottom sheet) that opens when clicking any source reference. Shows:

- Full `exactText` with highlight on the referenced span
- Artifact type, version, media type
- Locator (line range, timestamp range, or char range)
- Evidence role and stable segment ID
- Other assertions that reference the same source span

Already partially implemented as the right-rail inspector in `LivingContextGraph`. The missing piece is making it accessible from timeline and meeting-level views.

### 3c. Semantic Assertions Section

Per-interaction or accumulated view of assertions with:

- Predicate + narrative display (already exists in `AssertionNode`)
- Concept tags with relationship and weight (already exists)
- Related predicates from relationships (already exists)
- Source link buttons (already exists)

**No new component needed** — `AssertionNode` is reusable. It just needs to be surfaced in the meetings app and in the timeline.

### 3d. Signal Cards

Per-signal card showing:

- Label and namespace
- Interaction score vs accumulated score (dual progress bars, already in `SignalNode`)
- Evidence count, source diversity, confidence
- Evidence level breakdown (mentioned/used/explained/demonstrated/validated)

**`SignalNode` is reusable.** Needs surfacing in meetings and timeline.

### 3e. Match Overlay

For candidates with a standalone CODE_REVIEW match, overlay the match evidence on the person timeline:

- Which candidate assertions aligned with which PR demands
- Pair scores and shared concepts
- Evidence gaps and guardrails

`StandaloneReviewMatchPanel` already renders this. It should also be accessible from the timeline view when the CODE_REVIEW interaction is expanded.

### 3f. Repository Evidence Panel

When a match is present, show:

- Repo name, PR number, PR URL, PR title
- Match status badge
- Candidate evidence → PR demand alignment rows with source snippets
- Shared concepts
- Submission summary and annotations

All of this already exists in `StandaloneReviewMatchPanel`. For the timeline, it would appear as an expandable section under the CODE_REVIEW interaction node.

---

## 4. Minimal MVP Screen Sequence

### Screen 1: Enhanced Contact Detail (meetings app)

Add a "CONTEXT" section below existing contact fields in the `ContactsPage` detail drawer. If `contact.candidate_id` is set, fetch living context and render:
- Summary metrics bar (interaction count, assertion count, signal count)
- Condensed interaction list (type + date + counts)
- Link to full context in main app: "View full context →"

### Screen 2: Meeting Intelligence Expansion (meetings app)

Replace the flat `transcript_summary` in `MeetingDetailPanel` with:
- Per-participant assertion cards (collapsed by default)
- Signal badges extracted from that meeting
- Source span buttons linking to exact transcript locations

### Screen 3: Person Timeline (main app CONTEXT tab)

Add a timeline toggle to `LivingContextGraph` that switches from the current flat list of interactions to a chronological timeline view with expandable interaction nodes.

### Screen 4: Cross-Source Evidence Comparison (main app CONTEXT tab)

Add a "Compare" mode where two interactions can be selected simultaneously, showing assertions and signals side-by-side with shared concepts highlighted.

**MVP priority: Screen 1 → Screen 2 → Screen 3 → Screen 4.**

---

## 5. Exact Components Likely Touched in a Future PR

| Component/File | Change | Risk |
|----------------|--------|------|
| `apps/meetings/src/pages/ContactsPage.tsx` | Add context summary section to detail drawer | Low — additive UI |
| `apps/meetings/src/pages/MeetingsPage.tsx` | Expand `MEETING_INTELLIGENCE` with assertion/signal cards | Low — additive UI |
| `apps/meetings/src/types.ts` | May need `candidate_id` resolved to living context types | **Contract change needed** (see §6) |
| `src/components/Candidate/LivingContextGraph.tsx` | Add timeline toggle, interaction expansion, compare mode | Medium — refactor layout modes |
| `src/components/Candidate/LivingContextGraph.css` | Timeline and compare mode styles | Low |
| `src/hooks/useLivingContext.ts` | Possibly accept `personId` as alternative to `candidateId` | **Contract change needed** (see §6) |
| `src/pages/CandidateProfilePage.tsx` | Wire timeline toggle prop | Low |
| New: `apps/meetings/src/hooks/useContactContext.ts` | Fetch living context for a contact via meetings API | **Contract change needed** (see §6) |
| New: `apps/meetings/src/components/PersonContextSummary.tsx` | Compact context summary widget for contact drawer | Low — new component |
| New: `apps/meetings/src/components/MeetingAssertions.tsx` | Per-meeting assertion/signal cards for meeting detail | Low — new component |

---

## 6. Shared Contract Changes Needed (Do Not Implement — Report Only)

### 6a. Meetings API needs a living context endpoint

The meetings worker (`workers/meetings/`) currently has no route to fetch living context. The main API has `GET /api/v1/candidates/:candidateId/living-context`, but:

- The meetings app identifies people by `contact_id`, not `candidate_id`
- A contact may not have a `candidate_id` yet (PROSPECT type)
- The living context read model is keyed on `person_id` / `workspace_person_id`

**Needed contract:** Either:
1. Add `GET /api/v1/contacts/:contactId/living-context` to the meetings worker (proxying to the main API via service binding or shared D1), or
2. Add a person-ID resolution endpoint that maps `contact_id → person_id` and let the meetings app call the main API's living context endpoint directly, or
3. Expose a shared `useLivingContext` hook that accepts either `candidateId` or `contactId` and resolves internally.

### 6b. Meeting-scoped assertions need interaction ID correlation

The `MeetingDetailPanel` needs to show only assertions from a specific meeting. This requires:
- The meeting's `id` to correlate with a `LivingContextInteraction.id` or `externalReference`
- The current `LivingContextReadModel` already has `interaction.externalReference` which could store the meeting ID

**Needed contract:** Confirm that `meetingTranscript.ts` ingestion stores the meeting ID as `externalReference` on the interaction. If not, this is a write-side change.

### 6c. Person-level vs candidate-level data access

`useLivingContext` currently fetches by `candidateId`. The meetings app's contacts may represent people who are not yet candidates. The living context system supports `Person` as a first-class entity.

**Needed contract:** Expose `GET /api/v1/persons/:personId/living-context` or extend the existing endpoint to accept `personId` as a query parameter.

---

## 7. Risks and Constraints

### 7a. Exposing source snippets to recruiter UI

`exactText` from source spans is already exposed in the recruiter CONTEXT tab. This is acceptable for recruiter-facing views (Clerk auth).

**Risk:** If the timeline or assertions are ever exposed in a candidate-facing view, `exactText` from other interactions (e.g., recruiter notes, other candidates' data) must be filtered server-side. The current read model does not distinguish audience.

### 7b. Exposing internal IDs

The current `LivingContextGraph` inspector shows `sourceSpanId` in the detail pane. Per CLAUDE.md security rules, internal IDs (D1 row IDs) should not leak to candidate-facing clients. This is currently safe because the CONTEXT tab is recruiter-only, but:

**Risk:** If any of these components are reused in candidate-facing pages, internal IDs must be stripped or replaced with opaque references.

### 7c. Meetings app is a separate worker

The meetings app (`apps/meetings/`) runs as a separate Cloudflare Worker with its own D1 database. Living context data lives in the main API's D1 database. Cross-worker data access requires:
- Service bindings (Worker-to-Worker calls), or
- Shared D1 binding (same database accessed by both workers), or
- Client-side API calls from the meetings SPA to the main API

This is an architectural decision that should be made before implementing the contact context summary.

### 7d. Performance: full read model for summary

`useLivingContext` fetches the complete `LivingContextReadModel` including all assertions, signals, artifacts, and source spans. For a contact summary widget that only needs counts and interaction list, this is over-fetching.

**Risk:** If contacts accumulate many interactions (10+ meetings), the payload becomes large. A `GET .../living-context/summary` endpoint returning only counts and interaction metadata would be more appropriate.

### 7e. Meeting transcript ingestion completeness

The handoff doc notes that meeting transcript ingestion is "present and tested" but the UI "has not received current browser/runtime QA". Before building meeting-level assertion views, verify:
- That completed meetings actually produce `LivingContextInteraction` records
- That the interaction's `externalReference` links back to the meeting ID
- That assertions extracted from transcripts have proper source spans with timestamp offsets

---

## 8. Non-Goals (Explicitly Out of Scope)

- No changes to API schemas, types, or contracts
- No changes to the living-context read model or persistence layer
- No changes to the matcher logic or challenge matching engine
- No changes to meeting ingestion pipelines
- No D1 migrations
- No Neo4j schema changes

---

## 9. Summary

The `LivingContextGraph` component is a mature, rich visualization that already shows the full person semantic brain with interaction-level filtering, source provenance, and CODE_REVIEW match evidence. The primary gap is that **the meetings app has zero access to this data** — contacts and meetings show no assertions, signals, or accumulated context even though the backend already ingests meeting transcripts.

Bridging this gap requires three contract-level decisions (§6a–6c) before any UI implementation. Once those are resolved, the MVP sequence (§4) can be implemented incrementally using existing reusable components (`AssertionNode`, `SignalNode`, `SourceButton`, `StandaloneReviewMatchPanel`).
