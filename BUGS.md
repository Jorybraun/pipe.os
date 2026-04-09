# Bugs & Chores

Drop items here during QA. No ceremony. `/pm bug: <description>` appends to this file.

---

## Open

- [x] **P1** SELECT_PR button on Code Review stage redirects to home page (navigate path is wrong) — FIXED
- [ ] Code Review stage shows VIDEO_SCREENING content when stageType is null (legacy stages never got typed)
- [ ] Cultural Fit stage 4 is a duplicate — same pipeline has two "Cultural Fit" stages
- [ ] Stage config wizard (EDIT_STAGE button) opens InlineChallengeAdder which is wrong for cultural/code-review stages
- [ ] Benchmark save uses raw `fetch()` instead of the authenticated API client — will fail with Clerk auth
- [ ] Code review config save uses raw `fetch()` — same auth issue
- [ ] Vite ESM cache doesn't invalidate on file changes — requires manual `rm -rf node_modules/.vite`
- [ ] Pipeline overview has massive scroll gap between header and content (fixed header + background shader layout)
- [ ] QWK calibration harness exists but has never been run against Gemma
- [ ] Consent payload links to `/data-deletion` and `/request-human-interview` — both dead pages
- [ ] Scoring is fire-and-forget (waitUntil) with no retry or dead-man switch
- [ ] Parse-failure sentinel scores (confidence:0, score:3) look identical to real mid-range scores in recruiter UI

## Ideas (not bugs, just captured)

- ATS plugin integration (what does an ATS do? research needed)
- Challenge template library — needs to be diverse but tailored, not generic like TestGorilla
- Intake flow as a non-negotiable feature
- Agent design system improvements

## Fixed

_(move items here when done)_
