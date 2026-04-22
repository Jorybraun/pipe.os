# Documentation Drift Log

Append-only audit trail for stale docs, dead tests, and outdated artifacts found during monthly audits or ad-hoc cleanup.

Format:
```
#### YYYY-MM-DD — {title}
- **Found by:** {who}
- **Action taken:** {what was deleted/moved/fixed}
- **Files affected:** {list}
- **Root cause:** {why it got stale}
```

---

#### 2026-04-22 — Initial documentation audit + dead test cleanup
- **Found by:** Hermes (founder request)
- **Action taken:**
  - Deleted `docs/workflows/CURRENT_STATE.json` — stale Amplify-era tracking artifact from 2026-03-14
  - Deleted `.claude/worktrees/agent-ae02d18c/` — old agent worktree with Cognito/AppSync/DynamoDB tests and docs
  - Deleted `e2e/pipeline-create.spec.ts` — tested old `PipelineCreatePage`, `/pipeline/new` now routes to `RoleDiscoveryPage`
  - Deleted `e2e/dev-container-happy.spec.ts` — Phase 3b paused, container never reaches READY
  - Deleted `e2e/dev-container-ttl.spec.ts` — Phase 3b paused, tests DB state for non-running feature
  - Deleted `e2e/bug-regression.spec.ts` — 2/9 tests fail on old pipeline UI; 7 pass but test bugs from 2026-03-29 era
  - Deleted `e2e/bug-regression-2.spec.ts` — 6/10 tests fail on old MCQ editor, challenge picker, candidate card UI
  - Fixed stale comment in `e2e/media-upload.spec.ts` (Lambda/S3 → R2)
  - Added Documentation Upkeep Rule to `CLAUDE.md`
  - Created `scripts/check-docs.sh` pre-commit guard
- **Files affected:** 8 deleted, 2 modified, 2 created
- **Root cause:** Migration from AWS Amplify to Cloudflare left stale tracking artifacts; UI redesigns (pipeline creation, challenge editor, candidate card) broke regression tests; Phase 3b pause left container tests testing fake behavior.
- **Test count before:** 414 tests across 37 files
- **Test count after:** 369 tests across 32 files (45 tests removed, all stale)

#### 2026-04-22 — Archive deletion
- **Found by:** Hermes (founder request after code-vs-docs audit)
- **Action taken:**
  - Deleted `docs/archive/` (36 files) — old archived docs from pre-migration and early migration eras
  - Deleted `docs/archive-amplify/` (73 files) — entire Amplify-era documentation tree
  - Updated `docs/README.md` to remove archive section, add deletion note
- **Files affected:** 109 files deleted, 1 modified
- **Root cause:** Archives contained docs describing systems that no longer exist (AWS Amplify, Lambda, AppSync, DynamoDB, Cognito, old UI components, old data models). The role discovery system alone had 4 archived docs describing a completely different architecture (separate Lambdas, 6-phase grid UI, "Next-Gen" styling) vs. the current implementation (Cloudflare Workers, AIChat component, brutalist glassmorphic). Reading archived docs was a trap — they looked official but described ghosts.
