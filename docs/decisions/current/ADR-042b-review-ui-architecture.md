# ADR-042b: Review Session UI Architecture

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Solo founder

---

## Context

The existing candidate-facing challenge system uses a generic `ChallengeRenderer` that inspects `challenge.type` and dispatches to type-specific sub-components (`CodeReviewChallenge`, `ShortAnswerChallenge`, `VideoChallenge`, etc.). This composability is valuable for simple challenge types, but the CODE_REVIEW golden path has outgrown it:

1. **The conversation thread is not a sidebar.** In the generic renderer, the challenge component owns the full viewport and any chat is an overlay or sidebar. For code review, the diff and the conversation are co-primary surfaces — neither is auxiliary.

2. **State management complexity.** The generic renderer stores challenge state in a flat `ChallengeSubmission` blob. A multi-turn review session has nested state: per-PR transcript, implementer responses pending/resolved, scoring status, verdict form validity. Flattening this into the generic blob produces frequent sync bugs.

3. **Navigation semantics differ.** Most challenges are "answer → submit → done." CODE_REVIEW is "review → respond → review next PR → ... → verdict." The generic renderer's single-phase model does not map to this multi-phase flow.

4. **Recruiter dashboard needs a dedicated view.** The recruiter does not take the challenge; they observe the session. The generic renderer has no "observer mode."

---

## Decision

**Build a dedicated `ReviewSessionPage` that bypasses the generic `ChallengeRenderer` for CODE_REVIEW stages.**

### Architecture

```
Candidate flow:
  StageRouter (sees stage_type === 'CODE_REVIEW')
    └─► ReviewSessionPage
          ├─ ReviewHeader (PR title, progress, timer)
          ├─ TwoPaneLayout
          │    ├─ DiffPanel ( Monaco / custom diff, inline annotation anchors )
          │    └─ ConversationPanel ( threaded turns, implementer avatars, input composer )
          └─ VerdictBar (approve / request changes + summary — appears after final PR round)

Recruiter flow:
  CandidateProfile → ReviewSessionObserver
          ├─ Read-only DiffPanel (snapshot at time of candidate's last annotation)
          ├─ TranscriptPanel (full conversation, collapsible)
          └─ ScorePanel (overall score, BARS dimensions, evidence quotes)
```

### Design principles

1. **The diff is not a document; it is a conversation surface.** Annotations are not static highlights — they are the first turn of a thread. Clicking a line creates an annotation; the annotation spawns a thread in the conversation panel.

2. **Turns are first-class entities.** The transcript is an array of `Turn` objects, not a flat message log. A turn contains:
   - `turn_number`
   - `actor`: `candidate` | `implementer` | `system`
   - `type`: `annotation` | `response` | `verdict` | `system_event`
   - `content`
   - `line_references` (for annotation turns)
   - `timestamp`

3. **No generic challenge state blob.** `ReviewSessionPage` maintains its own `ReviewSessionState` (React context + reducer) and syncs to the server via the dedicated `/rpc/review/session/:id/message` endpoint. The generic `ChallengeSubmission` table is bypassed for transcript storage; only the final score and verdict are written back to the submission record for aggregation.

4. **Observer mode is a separate component, not a prop flag.** `ReviewSessionObserver` shares the `DiffPanel` and `ConversationPanel` sub-components in read-only mode but has its own layout tuned for recruiter review (wider transcript, score summary sticky on the right).

### File structure

```
src/pages/review/
  ReviewSessionPage.tsx          — candidate entry point
  ReviewSessionObserver.tsx      — recruiter entry point
  ReviewHeader.tsx
  TwoPaneLayout.tsx
  DiffPanel/
    DiffPanel.tsx
    InlineAnnotation.tsx
    LineAnchor.tsx
  ConversationPanel/
    ConversationPanel.tsx
    TurnBubble.tsx
    InputComposer.tsx
    ImplementerAvatar.tsx
  VerdictBar.tsx
  hooks/
    useReviewSession.ts          — fetches session, polls for status
    useTranscript.ts             — local optimistic updates + server sync
  types/
    reviewSession.ts             — Turn, ReviewSessionState, etc.
```

---

## Consequences

### Positive
- UI model matches the conversation model: diff and chat are peers, not primary/secondary
- State management is isolated from the generic challenge renderer's assumptions
- Recruiter observer mode can evolve independently (e.g., add audio playback, add AI-generated summary)
- Easy to add review-specific UX affordances: line-level threading, syntax-highlighted code blocks in chat, side-by-side diff toggle

### Negative / Risks
- CODE_REVIEW is no longer "just another challenge type" — it is a distinct page type. Adding a fourth review-like stage type in the future would require similar dedicated pages
- Some shared challenge infrastructure (timer, autosave, accessibility shell) must be duplicated or explicitly imported
- Increases bundle size if both generic renderer and review page are loaded; mitigated by route-based code splitting

## Alternatives Considered
- **Extend ChallengeRenderer with a "conversation layout" mode** — Rejected: the generic renderer's challenge→submission abstraction is too constraining. Adding conversation threading, multi-PR flow, and implementer state would require rewriting the renderer's core assumptions. A dedicated page is cleaner.
- **Keep generic renderer, render conversation as a slide-over** — Rejected: violates the design principle that diff and conversation are co-primary. Slide-overs work for Q&A; they do not work for a 10-turn technical negotiation.

## Open Questions
- Should the diff panel use Monaco Editor or a lighter custom diff renderer? (Leaning toward custom for faster load and simpler annotation anchoring)
- Should the recruiter observer mode allow real-time follow-along (WebSocket / SSE) or snapshot-only polling? (Deferred — polling for MVP)
