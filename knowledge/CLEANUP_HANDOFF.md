# Handoff: Knowledge Directory Cleanup — What Happened & What To Do

**Date:** 2026-04-23
**Status:** BLOCKED — requires founder decision before any action
**Context:** Agent-initiated cleanup of `knowledge/` directory created untracked duplicates and new flat files. Live files intact. Git shows no deletions.

---

## The Goal (What We Were Trying To Do)

The `knowledge/` directory had accumulated research artifacts across multiple runs:
- Final briefs (e.g., `code-review-content-sourcing.md`)
- Drafts (pre-citation working copies, e.g., `.drafts/code-review-content-sourcing-draft.md`)
- Plans (research decomposition docs, e.g., `.plans/code-review-content-sourcing.md`)
- Research files (raw researcher outputs, e.g., `code-review-content-sourcing-research-mining.md`)
- Provenance & verification reports
- Superseded plans from earlier iterations

The intent was to **archive process artifacts** (drafts, plans, superseded) and keep only **final deliverables** and **operational content** in live locations.

---

## What Actually Happened

An agent created:
1. **`knowledge/.archive/`** — untracked directory containing copies of:
   - All `.drafts/` files (from outputs, business, rnd, interview, marketing)
   - All `.plans/` files (from outputs, business, rnd, interview, marketing)
   - All `_superseded/` files
   - Old `INDEX.md` (renamed to `INDEX-2026-04-23.md`)
   - Marketing final briefs (also still live in `knowledge/marketing/outputs/`)
   - `manifest.md` describing the intended cleanup

2. **New flat files** (also untracked):
   - `knowledge/README.md` — LLM-wiki philosophy doc
   - `knowledge/RESEARCH.md` — append-only findings index (138 entries from STRATEGY.md)
   - `knowledge/OPERATIONAL.md` — flattened runtime content (culture questions, probes, calibration)

3. **Modified files**:
   - `knowledge/INDEX.md` — updated to reference new structure
   - `knowledge/STRATEGY.md` — updated with new findings and references

**Critical: No files were deleted from live locations.** The `.drafts/`, `.plans/`, `_superseded/` folders still exist in their original locations. The `.archive/` is just a copy.

---

## The Current Mess

```
knowledge/
├── .archive/                    ← UNTRACKED — copies of everything below
│   ├── drafts/                  ← copies of live .drafts/
│   ├── plans/                   ← copies of live .plans/
│   ├── superseded/              ← copies of live _superseded/
│   ├── marketing/outputs/       ← copies of live marketing/outputs/
│   ├── intake_outreach/         ← copies of live intake_outreach/
│   ├── manifest.md              ← cleanup description
│   └── INDEX-2026-04-23.md      ← old index
│
├── README.md                    ← UNTRACKED — new flat file
├── RESEARCH.md                  ← UNTRACKED — new flat file
├── OPERATIONAL.md               ← UNTRACKED — new flat file (136KB)
├── INDEX.md                     ← MODIFIED — references new structure
├── STRATEGY.md                  ← MODIFIED — updated findings
│
├── outputs/                     ← LIVE — all final briefs still here
│   ├── .drafts/                 ← LIVE — still here (not removed)
│   ├── .plans/                  ← LIVE — still here (not removed)
│   ├── _superseded/             ← LIVE — still here (not removed)
│   ├── *.md                     ← LIVE — final briefs
│   └── *-research-*.md          ← LIVE — research files
│
├── marketing/outputs/           ← LIVE — same structure as outputs/
├── business/outputs/            ← LIVE — same structure
├── rnd/outputs/                 ← LIVE — same structure
├── interview/                   ← LIVE — interview config briefs
├── culture/                     ← LIVE — operational content
├── calibration/                 ← LIVE — scorer calibration runbook
└── ...
```

**Result:** Everything exists in two places (live + `.archive/`), plus three new untracked flat files that may or may not be wanted.

---

## The Problem

1. **Redundancy:** `.archive/` is 58 files, ~240KB of exact duplicates. Everything in it also exists live.
2. **Untracked files:** `.archive/`, `README.md`, `RESEARCH.md`, `OPERATIONAL.md` are not in git. They were created by an agent but never committed.
3. **Broken references:** `STRATEGY.md` and `INDEX.md` now reference paths like `knowledge/outputs/.plans/*` which still exist live, but the cleanup manifest claims they were "moved to archive."
4. **Unclear value of new files:** `RESEARCH.md` and `OPERATIONAL.md` are large (43KB and 138KB) and duplicate information already in `STRATEGY.md` and `culture/` respectively.

---

## Options

### Option A: Revert Everything (Conservative)
- Delete `.archive/` entirely
- Delete `README.md`, `RESEARCH.md`, `OPERATIONAL.md`
- Revert `INDEX.md` and `STRATEGY.md` to pre-cleanup state
- Result: Exactly what we had before the cleanup attempt

### Option B: Complete the Cleanup (Aggressive)
- Keep `.archive/` as the permanent archive location
- Delete live `.drafts/`, `.plans/`, `_superseded/` from all directories (outputs, business, rnd, marketing, interview)
- Keep the new flat files (`README.md`, `RESEARCH.md`, `OPERATIONAL.md`) if they provide value
- Update all references in `STRATEGY.md` and `INDEX.md` to point to `.archive/` for drafts/plans
- Result: Clean live directory with only finals + operational content; process artifacts in `.archive/`

### Option C: Hybrid (Recommended)
- Delete `.archive/` — it's just copies, git history preserves everything
- Delete `README.md`, `RESEARCH.md`, `OPERATIONAL.md` — they're untracked and duplicate existing content
- Keep live `.drafts/`, `.plans/`, `_superseded/` — they have value for provenance and research traceability
- Revert `INDEX.md` to pre-cleanup state (or keep current if it's better)
- Result: Back to known-good state, no redundancy, no untracked files

---

## What I Need From You

1. **Which option?** A, B, or C — or something else
2. **Are the new flat files valuable?** Does `RESEARCH.md` (findings index) or `OPERATIONAL.md` (flattened culture content) serve a purpose the existing files don't?
3. **Do you want `.drafts/` and `.plans/` kept live or archived?** The research methodology requires provenance; drafts and plans are part of that.

**Do not proceed without explicit founder decision.** This affects the research infrastructure and git hygiene.

---

## Evidence

Git diff from pre-cleanup commit (`99364ed`):
```
Added (untracked):  knowledge/.archive/, knowledge/RESEARCH.md, knowledge/OPERATIONAL.md
Modified:           knowledge/INDEX.md, knowledge/STRATEGY.md
Deleted:            NOTHING
```

All changes are uncommitted. The live directory structure is intact.

---

## Next Steps (Pending Decision)

- [ ] Founder selects option A, B, or C
- [ ] Execute cleanup per selected option
- [ ] Commit the result with clear message
- [ ] Update any agent instructions that reference the old or new structure
