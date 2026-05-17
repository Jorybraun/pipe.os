# UX Design: Repo-Match Configuration Surface

**Date:** 2026-04-18
**Owner:** Lead (deep-research workflow)
**Input:** competitor scan `repo-personalized-interview-config-competitor-scan.md`
**Output:** concrete wireframe + flow for the match-configuration UI referenced in sub-questions 5–8

---

## Design principles

Derived from the scan + STRATEGY.md + Role Discovery ADRs:

1. **Conversational first, form second.** Role Discovery already elicits the role's competencies through conversation. Extending one question into that conversation costs nothing and respects the product's conversational-configuration thesis (PIPE differentiator vs. HireVue wizard-heavy UX).
2. **Two visible knobs, two defaulted knobs.** Of the four axes (philosophy × tolerance × linkage × automation), expose **philosophy** + **tolerance** prominently. Default **linkage** to shared-repo and **automation** to per-candidate with no UI affordance at the pipeline level; move them into an "Advanced" disclosure.
3. **One chip summarizes the whole config.** Following Pattern D from the scan, Pipeline Launch shows one chip that says "Match: Hybrid · Moderate tolerance" with an edit affordance. Most recruiters will never open it.
4. **Guardrails fire at commit time, not at edit time.** If the recruiter's combination is indefensible (per Q8 list), show the warning when they click "Launch pipeline," not inline on every dropdown. Don't block early — let them see their intent before arguing.
5. **Candidate-side transparency per 2026-04-17 guardrails brief.** When a candidate sees their repo in the interview, they see a one-sentence rationale (rationale-before-question XAI pattern). This is not configurable by the recruiter — it ships on.

---

## Flow: where config surfaces in the recruiter journey

```
 Recruiter journey (current)                     Recruiter journey (after this feature)
 ┌─────────────────┐                             ┌─────────────────┐
 │ Sign in         │                             │ Sign in         │
 └────────┬────────┘                             └────────┬────────┘
          │                                               │
          ▼                                               ▼
 ┌─────────────────┐                             ┌─────────────────┐
 │ Role Discovery  │  (conversational intake     │ Role Discovery  │← NEW: one question
 │ (agent chat)    │   of role + competencies)   │ (agent chat)    │  elicits match philosophy
 └────────┬────────┘                             └────────┬────────┘  into role_contexts
          │                                               │
          ▼                                               ▼
 ┌─────────────────┐                             ┌─────────────────┐
 │ Pipeline Setup  │  (pick challenges,          │ Pipeline Setup  │← NEW: match-config chip
 │                 │   name pipeline)            │  + match chip   │  with default from RCD
 └────────┬────────┘                             └────────┬────────┘
          │                                               │
          ▼                                               ▼
 ┌─────────────────┐                             ┌─────────────────┐
 │ Launch pipeline │                             │ Launch pipeline │← NEW: guardrail
 │                 │                             │  (guardrail fires│  enforcement at
 │                 │                             │   if combo bad)  │  commit time
 └─────────────────┘                             └─────────────────┘
          │                                               │
          ▼                                               ▼
 ┌─────────────────┐                             ┌─────────────────┐
 │ Candidates flow │  (same items for all)       │ Candidates flow │← NEW: per-candidate
 │ through         │                             │ through         │  repo auto-match
 └─────────────────┘                             └─────────────────┘  (invisible to recruiter)
```

Three insertions:
- **A**: one conversational question inside Role Discovery.
- **B**: one chip + optional disclosure on Pipeline Setup.
- **C**: pre-flight guardrail at Launch.

None are their own page. All are inlined into existing flows.

---

## Insertion A: Role Discovery conversational elicitation

### New agent prompt segment

Added to the Role Discovery agent's conversation flow (per `workers/api/src/lib/roleAgentPrompts.ts`). Fires after competencies are collected but before the role is saved.

**Agent says** (1 of 3 phrasings, agent picks contextually):

> *"One more thing before we wrap the role. When candidates take their interview, we pick one real codebase per candidate that best fits this role. There's a choice to make here: do you want that codebase to **stretch them toward what the role needs** — so we might pick something unfamiliar to them but on-target — or do you want it to **build on what they already know** and validate they can hold their own in a world like their past work? Or somewhere in between?"*

**Mapping** (agent classifies the recruiter's answer):

| Recruiter says | match_philosophy | tolerance |
|---|---|---|
| "Stretch them / test if they can handle our stack / we want to see if they can learn" | tailored | strict |
| "Something they'll recognize / validate their claimed experience / no point matching them with something they've never seen" | validate | lenient |
| "Both / a codebase shaped like what we do but within reason / don't drown them" | hybrid | moderate |
| "Tailor it but cut slack for adjacent experience" | tailored | moderate |
| "Validate but only if they claim the tech we care about" | validate | strict |

Agent confirms: *"Got it — I'll have the system pick codebases that [stretch toward the role / build on their experience / strike a balance] for each candidate. You can change this later on the pipeline."*

### Data flow

- Agent writes `match_philosophy` + `match_tolerance` into `role_contexts` (the canonical role profile from ADR-036).
- When the recruiter launches a pipeline for this role, the pipeline inherits those values as the default.

### Why conversational (not a form)

- Every other platform (HireVue, HackerRank) makes this a checkbox question on a config page. Those pages are the ones recruiters skip.
- PIPE's unique UX asset is the Role Discovery agent. Using it for one more question costs no new surface.
- Conversational elicitation also surfaces the decision at the point when the recruiter is thinking about the role, not about "administrative settings."

---

## Insertion B: Pipeline Setup match chip

### Wireframe (ascii)

```
┌───────────────────────────────────────────────────────────────────┐
│  Pipeline Setup                                                   │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Role:    Senior Frontend Engineer — Acme Corp                    │
│  Stages:  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐         │
│           │ Code Review │ │ ADR Review  │ │ Code Impl.  │         │
│           └─────────────┘ └─────────────┘ └─────────────┘         │
│                                                                   │
│  Match:   [ Hybrid · Moderate tolerance ✎ ]                       │← chip
│           Codebase auto-selected per candidate,                   │
│           anchored across all three stages.                       │
│                                                                   │
│  [ Launch pipeline ]                                              │
└───────────────────────────────────────────────────────────────────┘
```

### Chip states

- **Default (from Role Discovery):** `Hybrid · Moderate` / `Tailored · Strict` / `Validate · Lenient` / etc.
- **User hasn't finished Role Discovery:** `Match: Recommended default (edit in Role Discovery)` — can't edit directly; directs user back.
- **Recruiter overrode manually:** chip shows `(overridden)` suffix, with an undo to revert to Role Discovery value.

### Chip click → modal (not page)

```
┌──────────────────────────────────────────────┐
│  Match configuration                    [×]  │
├──────────────────────────────────────────────┤
│                                              │
│  Philosophy                                  │
│  ( ) Tailored to the role                    │
│  (•) Hybrid — both                           │
│  ( ) Validate candidate experience           │
│                                              │
│  Tolerance                                   │
│  ( ) Strict — close match required           │
│  (•) Moderate                                │
│  ( ) Lenient — accept adjacent matches       │
│                                              │
│  ▼ Advanced                                  │
│    Stage linkage: Shared repo ▾              │
│    Automation:    Per-candidate auto-match ▾ │
│                                              │
│  [ Preview 3 sample matches ]                │
│                                              │
│  [ Cancel ]              [ Save ]            │
└──────────────────────────────────────────────┘
```

### Preview affordance

"Preview 3 sample matches" runs the current config against 3 synthetic candidate profiles (senior backend + adjacent-stack junior + bootcamp grad) and shows:

- Which repo would be chosen for each.
- Match score breakdown (role-fit / candidate-fit / combined).
- Seniority band match.
- Any guardrails that would fire.

This is the single most important affordance in the modal — it builds confidence in the match algorithm without requiring the recruiter to read docs about T/V/H semantics.

---

## Insertion C: Pre-flight guardrail at Launch

When the recruiter clicks "Launch pipeline," before the D1 write:

```python
# pseudo-code
def check_guardrails(config, role_context):
    if config.philosophy == "tailored" and config.tolerance == "strict" \
       and role_context.stack_rarity > threshold \
       and config.automation == "per-pipeline" \
       and config.auto_reject_enabled:
        return BLOCK("Tailored-strict + uncommon-stack + auto-reject is a discrimination risk. "
                     "Remove auto-reject OR switch to Hybrid OR add recruiter review.")

    if config.philosophy == "tailored" and config.auto_reject_enabled \
       and not config.recruiter_review:
        return WARN("Auto-reject without human review on stretch mode. "
                    "Mobley v. Workday makes this litigable. Continue?")

    if config.philosophy == "validate" and candidate_profile_sparsity > threshold:
        return WARN("Validate mode needs strong candidate profile signal. "
                    "Fallback to Hybrid for candidates with sparse profiles.")

    if config.linkage == "per-stage" and config.automation == "per-pipeline":
        return BLOCK("Per-stage linkage requires per-candidate automation. "
                     "Adjust one of them.")
```

### UI surface

- **BLOCK**: red banner at top of Launch page, can't proceed until fixed.
- **WARN**: yellow banner with a "Continue anyway" + "Adjust" buttons. Audit-logged if continued.

Both banners include a "why?" link to the internal doc explaining the guardrail's legal / validity rationale.

---

## Backend surface (sketch, for ADR-039)

New D1 table (schema sketch, not final — ADR-039 will finalize):

```sql
CREATE TABLE pipeline_match_config (
  pipeline_id INTEGER PRIMARY KEY,
  match_philosophy TEXT NOT NULL CHECK (match_philosophy IN ('tailored','hybrid','validate')),
  match_tolerance TEXT NOT NULL CHECK (match_tolerance IN ('strict','moderate','lenient')),
  stage_linkage TEXT NOT NULL DEFAULT 'shared_repo' CHECK (stage_linkage IN ('shared_repo','per_stage')),
  automation_mode TEXT NOT NULL DEFAULT 'per_candidate' CHECK (automation_mode IN ('per_pipeline','per_candidate','per_stage','recruiter_override')),
  overridden_from_role_context INTEGER DEFAULT 0,  -- 1 if recruiter changed from RCD default
  guardrail_overrides_json TEXT,                    -- audit log of warnings continued past
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (pipeline_id) REFERENCES pipelines(id)
);
```

And columns added to `role_contexts` (existing RCD table):

```sql
ALTER TABLE role_contexts ADD COLUMN match_philosophy TEXT CHECK (match_philosophy IN ('tailored','hybrid','validate'));
ALTER TABLE role_contexts ADD COLUMN match_tolerance TEXT CHECK (match_tolerance IN ('strict','moderate','lenient'));
```

When a pipeline is created:
1. Look up the role's `role_contexts` → read `match_philosophy` + `match_tolerance` as defaults.
2. Insert into `pipeline_match_config` with defaults applied (linkage=shared, automation=per_candidate).
3. Recruiter chip reads from `pipeline_match_config`; edits write back to the same row.

---

## Candidate-side surface (for completeness)

When the candidate reaches their first station:

```
┌───────────────────────────────────────────────────────────────────┐
│  Station 1 of 3 — Code Review                                     │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  You'll be reviewing a PR in a TypeScript/React codebase.         │
│                                                                   │
│  > Why this repo? We picked this codebase because it closely      │← XAI rationale
│  > matches the stack and patterns of the role you're              │  (per 2026-04-17
│  > interviewing for. You'll see the same codebase across all      │  guardrails brief)
│  > three stations.                                                │
│                                                                   │
│  [ Start ]                                                        │
└───────────────────────────────────────────────────────────────────┘
```

Phrasing varies per match philosophy:

- **Tailored:** *"We picked this codebase because it's representative of the role's tech stack and will stretch you toward what you'd work on day-to-day."*
- **Validate:** *"We picked this codebase because it resembles projects you've worked on before, so we can see you at your best."*
- **Hybrid:** *"We picked this codebase because it matches both the role's stack and your prior experience."*

This text is NOT configurable by the recruiter — it ships as part of the product. Transparency is a product commitment, not an account setting.

---

## Interaction with adjacent features

### Role Discovery (ADR-036)

- New fields `match_philosophy` + `match_tolerance` on `role_contexts`.
- New conversational branch in `roleAgentPrompts.ts` after competency collection.
- Existing RCD data contract extended, not replaced.

### Challenge authoring (ADR-034)

- Challenge templates must tag their anchor mode: "works well with tailored", "works well with validate", or "any".
- The matcher uses these tags as a soft weight when ranking repo×template pairs.

### Pipeline Launch (existing flow)

- Pre-launch guardrail check is new. Hooks into existing launch handler.
- Launch handler already reads pipeline config; reads `pipeline_match_config` as well.

### Culture interview (ADR-029)

- Unaffected. Culture interview has its own question generation, not repo-anchored.

---

## Out of scope (v1)

Explicitly deferred to v2 / follow-up:

- **Per-stage match configuration** (Pattern C from scan) — too much surface area, skip in v1.
- **Account-level default** (Pattern D extended) — users with many pipelines will want this; ship as v2 admin setting.
- **Dedicated wizard step** (Pattern B from scan) — rejected; keep Pipeline Setup as a single page.
- **Live match preview on every chip edit** — nice-to-have but hits Vectorize per keystroke. "Preview 3 sample matches" is the v1 compromise.

---

## Pieces to validate with user before ADR-039

1. **Conversational elicitation phrasing** — the agent's one-question insertion needs founder approval. Dry-run with 2–3 recruiters before shipping.
2. **Chip label copy** — "Hybrid · Moderate tolerance" — jargon-y. May need "Balanced / Moderate" or similar softening.
3. **Guardrail copy** — block vs warn thresholds; legal-review input on disparate-impact language.
4. **Preview affordance UX** — is showing 3 sample candidates enough, or does the recruiter need to see more? Usability test.

These are open for the synthesis draft to flag as remaining questions for the founder.

---

## Commitments closed

This doc closes the design track of the plan (Qs 5–8):

- [x] Q5 answer: Conversational (Pattern A) + chip on Pipeline Setup (Pattern D). No dedicated wizard step. No per-challenge surface.
- [x] Q6 answer: Default shared-repo. Per-stage deferred to v2.
- [x] Q7 answer: Default per-candidate automation. Per-pipeline exposed as an option. Per-stage deferred. Recruiter-override deferred to enterprise tier.
- [x] Q8 answer: 5 guardrails enumerated (2 block, 3 warn). Surfaces at Launch, not inline.
- [x] Wireframe: chip + modal + disclosure + preview sketched.
- [x] Pipeline Launch guardrail behavior sketched.
- [x] Candidate-side transparency text variants written.
- [x] D1 schema sketch provided for ADR-039.

Next: await R1 and R2 research track completion, then synthesize the full brief combining research-track recommendations with this design-track output.
