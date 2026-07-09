# Design: Recruiter Invite Creation (MVP)

Status: **DRAFT — awaiting approval**
Builds on: [`mvp-talent-pool-invite.md`](mvp-talent-pool-invite.md) (pipeline-free invites, shipped)
Scope: redesign of the invite-creation flow — modal layout, confirmation step, invite email copy, error states, success states. All 4 interview types stay.

---

## 1. Goal

A recruiter invites a candidate in under a minute:

```
Pick type → enter candidate → (optional) JD + resume + message → review email → send
```

The recruiter always sees **exactly what the candidate will receive** before anything is sent, and always leaves the modal with a working link — even when email delivery fails.

---

## 2. Current State & Gaps

What exists (all reused, not rebuilt):

| Piece | Where | Status |
|---|---|---|
| Invite modal (type cards, name/email, notes, Calendly/manual, repo override, OSS packet, success + copy) | `src/components/Scheduling/InviteCreationModal.tsx` | Keep, restructure |
| Create interview | `POST /api/v1/scheduling/interviews` (`workers/api/src/routes/cockpit/scheduling.ts:8744`) | Extend |
| Send invite email (supports `message`, `sendEmail:false`) | `POST /api/v1/scheduling/interviews/:id/invite` (`scheduling.ts:9377`) | Reuse — `message` is currently never sent from this modal |
| Email composition (subject/CTA per type, dark HTML template) | inline in `scheduling.ts:9507-9581` | Extract to lib + preview endpoint |
| Resume upload + AI ingestion | `POST /api/v1/candidates/:id/resume` (used by `CandidateIntakeModal`) | Reuse |
| Standalone candidate + `/assess/:token` minting | `ensureStandaloneCandidateForInterview` | Reuse, move earlier |

Gaps this design closes:

1. **No job description** field — matching and assessment agents get no role context on standalone invites.
2. **No resume attach** at invite time — candidate profile starts empty.
3. **No personal message + no email preview** — recruiter sends blind; server supports `message` but the modal never passes it.
4. **No confirmation step** — form goes straight to create+send.
5. **Email-failure recovery is copy-only** — no retry.

---

## 3. Flow

```
          ┌─────────┐  REVIEW INVITE →  ┌──────────────┐  CREATE & SEND  ┌──────────┐
  open →  │ COMPOSE │ ────────────────→ │ REVIEW & SEND│ ──────────────→ │ CREATING │
          └─────────┘  ← BACK           └──────────────┘                 └────┬─────┘
               ↑                              ↑  create failed (banner)       │
               └── INVITE ANOTHER ────────────┴────────────┐                  │
                                                           │                  ▼
                                              ┌────────────┴───────────────────────┐
                                              │ RESULT                             │
                                              │  A. sent    B. link-only  C. email │
                                              │  (green)    (blue)        failed   │
                                              │                           (amber)  │
                                              └────────────────────────────────────┘
```

- Create failure returns to **REVIEW & SEND** with an error banner; all form state preserved.
- Email failure still lands on **RESULT** (interview exists) in the amber variant with retry.

---

## 4. Modal — Step 1: COMPOSE

Same shell as today: 720px max, `var(--pipe-bg)`, 1px `var(--pipe-border)`, radius 8, Space Mono labels (10px, 0.15em tracking). New: step indicator in the header.

```
┌────────────────────────────────────────────────────────────────┐
│ INTERVIEW                                                   ✕  │
│ New invite                            [1 COMPOSE] · 2 REVIEW   │
├────────────────────────────────────────────────────────────────┤
│ ASSESSMENT TYPE                                                │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│ │ ▣ Video  │ │ Code-    │ │ Dev-     │ │ Open-    │            │
│ │ interview│ │ review   │ │ container│ │ source   │            │
│ │ Live     │ │ Async PR │ │ challenge│ │ bug fix  │            │
│ │ video    │ │ review   │ │ Live     │ │ Matched  │            │
│ │ call     │ │ ~45–60m  │ │ workspace│ │ repo task│            │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                                                │
│ CANDIDATE                                                      │
│ ┌── NAME ──────────────────┐  ┌── EMAIL ────────────────────┐  │
│ │ Jane Doe                 │  │ jane@example.com            │  │
│ └──────────────────────────┘  └─────────────────────────────┘  │
│ ┌── RESUME (OPTIONAL) ────────────────────────────────────── ┐ │
│ │  ⇪ Attach .pdf or .docx — builds the candidate profile     │ │
│ └─────────────────────────────────────────────────────────── ┘ │
│                                                                │
│ ROLE CONTEXT (OPTIONAL)                                        │
│ ┌── JOB DESCRIPTION ──────────────────────────────────────── ┐ │
│ │ Paste the job description…                                 │ │
│ └─────────────────────────────────────────────────────────── ┘ │
│ Used to match a better task and brief the assessment agents.  │
│                                                                │
│ ── type-specific section (unchanged behavior) ──────────────── │
│  VIDEO:      scheduling (manual room / Calendly) + when + room │
│              features (video/workspace/recording)              │
│  CODE_REVIEW / OSS / DEV_CONTAINER: challenge repo             │
│              (auto-match ⇄ manual override) + OSS packet +     │
│              packet checklist — exactly as today               │
│                                                                │
│ MESSAGE TO CANDIDATE (OPTIONAL)                                │
│ ┌────────────────────────────────────────────────────────── ┐  │
│ │ Shown inside the invite email, in your voice…              │ │
│ └─────────────────────────────────────────────────────────── ┘ │
│                                                                │
│ OBJECTIVE / NOTES (INTERNAL)                                   │
│ ┌ Why are we running this interview?… ─────────────────────── ┐│
│ └─────────────────────────────────────────────────────────── ┘ │
│                                                                │
│                          [ CANCEL ]   [ REVIEW INVITE → ]      │
└────────────────────────────────────────────────────────────────┘
```

Field spec:

| Field | Required | Notes |
|---|---|---|
| Assessment type | yes (default `VIDEO`, or `initialInterviewType` prefill) | Existing 4 cards; each card gains a one-line time hint |
| Name / Email | yes | Existing; email validated on blur |
| Resume | no | `.pdf`/`.docx`, ≤ 10 MB (same limits as `CandidateIntakeModal`). Chip with filename + remove ✕ once attached. File held client-side until create. |
| Job description | no | Plain-text textarea, ≤ 20 000 chars. Persisted on the interview; threaded into repo matching + agent briefing. |
| Message to candidate | no | ≤ 1 000 chars. Rendered in the email's highlighted block (existing `customMessage` slot). **Candidate-facing** — labeled as such. |
| Objective / notes | no | Existing `recruiterNotes`. Relabeled **INTERNAL** to prevent confusion with the candidate message. |
| Type-specific config | as today | Repo override, OSS packet + checklist gating, Calendly/manual + WHEN, room features — no behavior change. |

**Distinction that matters:** `MESSAGE TO CANDIDATE` (goes in the email) vs `OBJECTIVE / NOTES` (internal only). Today the modal has only the internal field, which recruiters plausibly mistake for the email body.

---

## 5. Modal — Step 2: REVIEW & SEND (confirmation state)

```
┌────────────────────────────────────────────────────────────────┐
│ INTERVIEW                                                   ✕  │
│ Review & send                          1 COMPOSE · [2 REVIEW]  │
├────────────────────────────────────────────────────────────────┤
│ ┌ SUMMARY ──────────────────────────────────────────────────┐  │
│ │ TYPE      Code-review interview — async, ~45–60 min       │  │
│ │ TO        Jane Doe · jane@example.com                     │  │
│ │ ROLE      Senior Frontend Engineer          (JD attached) │  │
│ │ RESUME    jane-doe-cv.pdf                                 │  │
│ │ TASK      Auto-matched after invite  /  owner/repo #123   │  │
│ │ WHEN      — (candidate starts when ready)                 │  │
│ └───────────────────────────────────────────────────────────┘  │
│                                                                │
│ DELIVERY                                                       │
│ (•) Email the invite from PIPE                                 │
│ ( ) Don't email — I'll send the link myself                    │
│                                                                │
│ EMAIL PREVIEW                                                  │
│ SUBJECT: Code review invitation — Senior Frontend Engineer     │
│ ┌───────────────────────────────────────────────────────────┐  │
│ │ [sandboxed iframe — exact server-rendered HTML,           │  │
│ │  personal message block included, link shown as           │  │
│ │  “…/assess/‹generated-after-send›”]                       │  │
│ └───────────────────────────────────────────────────────────┘  │
│                                                                │
│ (error banner slot — see §8)                                   │
│                                                                │
│               [ ← BACK ]         [ CREATE & SEND INVITE ]      │
└────────────────────────────────────────────────────────────────┘
```

Rules:

- **Preview is server-rendered.** New endpoint (§10) returns `{subject, html}` from the *same* composition function used at send time — zero copy drift. Rendered in `<iframe sandbox srcDoc>`. Fetched on step entry and debounced on delivery-toggle change.
- The invite link placeholder reads `…/assess/‹created after send›` (or room link equivalents) since the token doesn't exist yet. Everything else is exact.
- Delivery choice maps to existing server behavior: `sendEmail !== false` → send; `false` → mark `invite_link_sent_at`, skip email. Copy-only mode hides the preview's "will be emailed" framing and changes the primary button to `CREATE & COPY LINK`.
- Primary button while working: existing status box + `aria-busy`, text `Creating interview and preparing invite delivery...` (unchanged).
- Calendly variant: SUMMARY `WHEN` row reads `Candidate picks a time (Calendly — ‹event name›)`; button `CREATE & SEND SCHEDULING LINK`.

---

## 6. Modal — RESULT states

### A. Sent (green — `rgba(74,222,128,…)` panel, existing style)

```
│ ✓ Invite sent to Jane Doe (jane@example.com)                   │
│   Code-review interview · via Resend                           │
│                                                                │
│   ┌ https://pipe.build/assess/tk_9f2…        [ COPY ] ┐        │
│                                                                │
│   (assessmentSetup message when present — unchanged, e.g.      │
│    “PIPE will select a source-backed PR only after candidate   │
│     evidence exists…”)                                         │
│                                                                │
│        [ INVITE ANOTHER ]   [ VIEW INTERVIEW ]   [ DONE ]      │
```

### B. Link-only (blue — recruiter chose to send it themselves)

```
│ ✓ Interview created for Jane Doe — no email sent (your call)   │
│   ┌ https://pipe.build/assess/tk_9f2…   [ COPIED ✓ ] ┐         │
│   Send this link to the candidate however you like.            │
│   It's unique to them — treat it like a password.              │
```

Best-effort auto-copy on arrival; the COPY control always remains (auto-copy is never assumed to have succeeded). `COPIED ✓` state for 2s after any copy, as today.

### C. Email failed / timed out (amber)

```
│ ⚠ Interview created, but the invite email didn't send.         │
│   {short reason, e.g. “Email provider rejected the address.”   │
│    or the existing timeout copy}                               │
│   ┌ https://pipe.build/assess/tk_9f2…        [ COPY ] ┐        │
│                                                                │
│        [ RETRY EMAIL ]   [ VIEW INTERVIEW ]   [ DONE ]         │
```

`RETRY EMAIL` re-calls `POST /interviews/:id/invite` (idempotent — regenerates nothing, resends the same link). On success, panel flips to variant A.

New in all variants: **INVITE ANOTHER** resets to COMPOSE keeping the assessment type + JD (batch-inviting several candidates to the same role is the common loop).

Resume-upload failure after a successful create is **non-blocking**: variant A/B renders with an amber sub-line — `Resume upload failed — retry from the interview page.`

---

## 7. Invite email copy

One shared frame (existing dark template kept: `#0c0c0e`, Space Mono, logo, white CTA button), type-specific slots. Composition extracted to `workers/api/src/lib/inviteEmail.ts`.

### Frame

```
[logo]
Hi {{candidateName}},

{{intro — per type}}

┌ personal message block (only when provided) ──────────────┐
│ “{{customMessage}}” — {{recruiterName}}                    │
└───────────────────────────────────────────────────────────┘

┌ details card ─────────────────────────────────────────────┐
│ Role:    {{roleTitle}}          (row omitted when absent)  │
│ Format:  {{format — per type}}                             │
│ Time:    {{time — per type}}                               │
│ When:    {{scheduledTime}}      (only when scheduled)      │
│ Needs:   {{needs — per type}}                              │
└───────────────────────────────────────────────────────────┘

        [ {{CTA}} → ]        (white button, existing style)

If the button doesn't work, copy this link:
{{link}}

This link is unique to you — please don't forward it.
Questions? Just reply to this email.
```

`replyTo` set to the recruiter's email so "just reply" is real. `roleTitle` = pipeline title when attached, else the first line/title inferred from the JD, else the row is omitted (never the current placeholder `Interview`).

### Per-type slots

| Type | Subject | Intro | Format / Time / Needs | CTA |
|---|---|---|---|---|
| VIDEO (manual, unscheduled) | `Video interview invitation — {{roleTitle}}` | You've been invited to a video interview. | Live video call / ~45 min / Camera, mic, quiet spot | `JOIN VIDEO CALL` |
| VIDEO (manual, scheduled) | `Video interview — {{roleTitle}} ({{scheduledTime}})` | same + confirmed time in card | same | `JOIN VIDEO CALL` |
| VIDEO (Calendly) | `Schedule your interview — {{roleTitle}}` | You've been invited to a video interview. Pick any time that works for you. | Live video call / ~45 min / — | `PICK A TIME` |
| CODE_REVIEW | `Code review invitation — {{roleTitle}}` | You've been invited to a short code-review exercise. You'll read a real pull request and leave review comments — the same work you'd do on the job. | Async — start when you're ready / About 45–60 minutes / A laptop and a browser. No account or sign-up. | `START CODE REVIEW` |
| OPEN_SOURCE_BUG_FIX | `Coding exercise invitation — {{roleTitle}}` | You've been invited to a hands-on exercise: fixing a real bug in an open-source codebase, in a ready-to-code workspace in your browser. | Guided workspace — nothing to install / About 60–90 minutes / A laptop and a browser | `OPEN YOUR WORKSPACE` |
| DEV_CONTAINER_CHALLENGE | `Coding exercise invitation — {{roleTitle}}` | You've been invited to a live coding exercise in a prepared development workspace — nothing to install. | Live workspace session / About 60–90 minutes / A laptop and a browser | `OPEN YOUR WORKSPACE` |

Subject fallback without a role: drop the ` — {{roleTitle}}` suffix.

Copy changes vs today (intentional, aligned with the candidate de-jargonization work in PRs #259–#263):

| Current | Proposed | Why |
|---|---|---|
| Subject `Assessment invitation — Interview` | type-specific subjects above | "Assessment invitation — Interview" is jargon + placeholder leak |
| CTA `START ASSESSMENT` | `START CODE REVIEW` | Names the actual activity |
| CTA `JOIN ASSESSMENT WORKSPACE` | `OPEN YOUR WORKSPACE` | Shorter, warmer |
| CTA `SCHEDULE INTERVIEW` | `PICK A TIME` | Action the candidate takes |
| Greeting fallback `Hi there` from email prefix | keep (unchanged) | |

### Example — CODE_REVIEW, with message, no schedule

> **Subject:** Code review invitation — Senior Frontend Engineer
>
> Hi Jane,
>
> You've been invited to a short code-review exercise. You'll read a real pull request and leave review comments — the same work you'd do on the job.
>
> > "Loved your work on the design-system talk — this should feel familiar. No prep needed." — Hans
>
> **Role:** Senior Frontend Engineer
> **Format:** Async — start when you're ready
> **Time:** About 45–60 minutes
> **Needs:** A laptop and a browser. No account or sign-up.
>
> **[ START CODE REVIEW → ]**
>
> If the button doesn't work, copy this link:
> `https://pipe.build/assess/tk_…`
>
> This link is unique to you — please don't forward it.
> Questions? Just reply to this email.

---

## 8. Error states

| # | Condition | Surface | Copy | Recovery |
|---|---|---|---|---|
| E1 | Invalid email format (on blur) | inline, red, under field | `Enter a valid email address, like name@company.com.` | CTA disabled |
| E2 | Required fields missing | hint line above actions | `Add the candidate's name and email to continue.` | CTA disabled (never a dead button with no explanation) |
| E3 | Resume wrong type / > 10 MB | inline under dropzone | `Use a .pdf or .docx up to 10 MB.` | File rejected; form untouched |
| E4 | JD > 20 000 chars | inline counter turns red | `Trim the job description to 20,000 characters.` | CTA disabled |
| E5 | OSS manual packet incomplete | existing `PacketChecklist` `Missing` rows | unchanged | CTA disabled (unchanged) |
| E6 | Calendly selected, not connected / no event type | existing inline amber | unchanged (`Calendly is not connected. Open Settings…`) | CTA disabled for that mode |
| E7 | Preview fetch fails | grey placeholder in preview slot | `Preview unavailable — the email will still send normally.` | non-blocking; SEND stays enabled |
| E8 | Create request fails (validation/network/server) | red banner on REVIEW step, `role="alert"` | `Couldn't create the interview — nothing was sent.` + server detail | `TRY AGAIN`; full form state preserved |
| E9 | Create ok, email send fails | RESULT variant C (amber) | §6C | `RETRY EMAIL` / copy link |
| E10 | Email delivery timeout (existing `withTimeout`, 8s) | RESULT variant C | existing copy: `Interview created, but invite delivery is taking longer than expected…` | copy link; treat as queued |
| E11 | Resume upload fails post-create | amber sub-line in RESULT A/B | `Resume upload failed — retry from the interview page.` | non-blocking |

Principles: destructive-free failure (E8 guarantees "nothing was sent"), never lose typed input, every disabled CTA explains itself, email failure never orphans the invite (link always visible).

---

## 9. Validation rules

- Name: trimmed length ≥ 1.
- Email: trimmed, single RFC-ish check (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), lowercased at submit (server already normalizes).
- PR number: positive integer when present (unchanged).
- Packet checklist gating for manual OSS (unchanged, incl. 40-char SHA check).
- Resume: MIME + extension in {pdf, docx}, size ≤ 10 MB.
- JD ≤ 20 000 chars; message ≤ 1 000 chars.
- `REVIEW INVITE →` enabled ⇔ all of the above; `CREATE & SEND` additionally requires preview state ≠ loading (E7 failure does **not** block).

---

## 10. Data & API changes

1. **Migration (next free number, ≥ 0116):** `ALTER TABLE scheduled_interviews ADD COLUMN job_description TEXT;`
2. **`POST /api/v1/scheduling/interviews`** — accept optional `jobDescription` (zod `.max(20000)`), persist it; for assessment types create the standalone candidate **at creation time** (today it's minted at email-send in `ensureStandaloneCandidateForInterview`) and return `candidateId` in the response. Thread `job_description` into repo matching + agent briefing where pipeline role context is consumed today (`orchestrate.ts` role-context path).
3. **`POST /api/v1/scheduling/interviews/:id/invite`** — no schema change; the modal starts passing `message` and `sendEmail`.
4. **New `POST /api/v1/scheduling/invite-email-preview`** — body: the compose-state projection (type, names, role title, message, scheduled time, delivery mode); returns `{subject, html}` with a placeholder link. Pure function shared with the real send path (`lib/inviteEmail.ts`). Auth: recruiter (Clerk), same as other `/api/v1/scheduling/*`.
5. **Resume:** client uploads to existing `POST /api/v1/candidates/:candidateId/resume` right after create using the returned `candidateId`, before showing RESULT (upload failure → E11, non-blocking).
6. **`replyTo`:** invite emails set reply-to to the recruiter's account email.

Security (per AGENTS.md):

- Candidate-facing links carry **invite tokens only**; `candidateId` appears solely in the recruiter-authenticated response.
- JD and internal notes are recruiter data — never rendered into candidate surfaces; the email includes only the derived `roleTitle`.
- Preview endpoint renders from the caller's own input under recruiter auth — no cross-tenant reads; no ground truth in any email.

---

## 11. BDD scenarios (Playwright, `e2e/recruiter-invite-creation.spec.ts`)

1. **Compose gating** — REVIEW disabled with empty/invalid email; inline E1/E2 copy visible; enabled once valid.
2. **Review & send (CODE_REVIEW)** — summary rows correct; preview iframe shows type-specific subject + personal message; CREATE & SEND → RESULT A with `/assess/` link and email-sent line.
3. **Copy-only delivery** — toggle "send it myself" → button `CREATE & COPY LINK` → RESULT B; API called with `sendEmail:false`; interview marked link-sent.
4. **Email failure recovery** — mock invite 500 → RESULT C amber, link present; `RETRY EMAIL` (mock 200) flips to variant A.
5. **Create failure keeps state** — mock create 500 → E8 banner on REVIEW; BACK shows all typed values intact.
6. **JD + resume threading** — attach both → create payload contains `jobDescription`; resume POST hits `/candidates/:id/resume`; E11 path when upload fails.
7. **OSS manual packet gating unchanged** — checklist `Missing` rows block REVIEW.
8. **Video + Calendly** — connected fixture → scheduling-link summary + `PICK A TIME` preview subject.
9. **Invite another** — from RESULT A, resets to COMPOSE retaining type + JD, clearing candidate fields.

Unit: `inviteEmail` composition table-tests (per type × scheduled × message × role fallback), modal step-machine tests extending `InviteCreationModal.test.tsx`.

---

## 12. Implementation plan

| Phase | Work | Files |
|---|---|---|
| 1 | Extract email composition + preview endpoint + unit tests | `workers/api/src/lib/inviteEmail.ts` (new), `routes/cockpit/scheduling.ts`, worker tests |
| 2 | Migration + `jobDescription`/`candidateId` in create + matching thread-through | `migrations/01xx_add_job_description.sql`, `scheduling.ts`, `lib/candidateDiscovery/orchestrate.ts` |
| 3 | Modal restructure: steps, new fields, delivery toggle, RESULT variants, retry | `InviteCreationModal.tsx` + `.test.tsx`, `SchedulingDashboard.tsx` (pass `message`/`sendEmail`, resume upload, retry hook) |
| 4 | BDD e2e + Chrome visual validation + CHANGELOG | `e2e/recruiter-invite-creation.spec.ts` (new) |

Each phase lands with `npx tsc --noEmit` clean and its tests green before the next starts (BDD-first per AGENTS.md).

---

## 13. Out of scope (MVP)

- Bulk / CSV invites (single-candidate loop covered by INVITE ANOTHER).
- Recruiter-editable email templates UI (D1 `notification_templates` already override defaults server-side).
- Reminder / follow-up emails.
- Existing-candidate picker inside the modal (profile pages already prefill via `initial*` props / query params — unchanged).
- Deadline enforcement on assessment links.
