# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

**Task B — Role Discovery Agent:**
- Role Discovery agent now uses 6 calibrated probes instead of open-ended Six Domains exploration
- Role Context Document (RCD) is now the primary synthesis artifact
- Added calibration review UI for recruiters to flag and correct RCD attributes
- Added gap-filling agent for targeted clarifying questions

**Task C — Code Review Golden Path:**
- CODE_REVIEW stages now create review session on stage entry
- New review session endpoints: `/rpc/review/session/init`, `/message`, `/complete`
- Added dedicated review session page with diff + chat interface
- Recruiter dashboard now shows review session status, score, and transcript

**Infrastructure & Docs:**
- Phase 5 CI/CD: GitHub Actions workflows for CI, staging deploy, and production deploy
- ADR-041: Cloudflare-native deployment with Wrangler (drops Terraform)
- `workers/api/wrangler.jsonc` environments: `staging` and `production`
- `docs/project-brief.md`: Unified project vision, glossary, phased roadmap, and honest current-state snapshot
- `.claude/rules/terminology.md`: Mandatory domain language for all agents
- **Dual-layer embedding architecture (D1 ground truth + Vectorize ANN):** Migration `0042_embedding_json.sql` adds `embedding_json` to `candidate_ingestion`, `repo_engineering_signals`, and `role_contexts`; `role_contexts.role_searchable_profile` stores role narrative. Enables exact cosine computation and index rebuilds from D1.
- **Exact `role_candidate_cosine` computation:** `lib/embedding/cosine.ts` provides `cosineSimilarity()` and `parseEmbeddingJson()`; `orchestrate.ts` loads both embeddings from D1 and computes exact similarity at match time (falls back to `null` if missing).
- **Unified semantic search endpoints:** `POST /api/v1/search/candidates` and `POST /api/v1/search/repos` enable bidirectional search (role→candidates, role→repos, candidate→repos, repo→candidates) using dual-layer embeddings.
- **Role context embedding:** `buildAndStoreRoleEmbedding` fires best-effort when role discovery reaches `COMPLETE`, building `role_searchable_profile` from `job_description_md` and embedding via BGE-large-en-v1.5.

### Removed
- **Deprecated stage types:** Removed all dead stage types (`AI_COLLAB`, `PLANNING`, `VOICE`, `INGESTION`, `TECHNICAL`, `QUESTIONS`, `VOICE_INTERVIEW`) from frontend and backend.
- Locked to exactly 5 stage types: `SCREENING`, `CULTURAL`, `CODE_REVIEW`, `OPEN_SOURCE`, `LIVE_PANEL`.
- Aligned `workers/api/src/validation/stages.ts`, `src/lib/stageTemplates.ts`, `src/types/index.ts`, and all UI components.
- Removed `titleLower.includes(...)` fallback inference patterns in `StageIndexTab.tsx` and `StagePanel.tsx` — stages must have `stage_type` populated.
- Updated pipeline templates to use valid stage types only.
- Cleaned up unused lucide-react imports (Zap, Brain, Mic) from modified components.

### Changed
- `docs/vision.md`: Aligned with project brief — added product thesis, full vision reference, and guardrails
- `migration/PLAN.md`: Added Product Phases (P1–P5) section with 2026-04-22 decisions
- Documentation reorganization: unified navigation hub, split decisions into current/historical, extracted model routing, archived stale artifacts
- Deleted obsolete files: BUGS.md, TEST_ANALYSIS.md, TEST_STATUS.md, TODO.md, CONTRIBUTING.md, docs/README.md, docs/handoffs/
- Deleted AWS Amplify artifacts: `amplify/`, `amplify_outputs.json`, `amplify.yml`
- Deleted Terraform infrastructure: `infra/` directory
- Archived CHANGELOG.md to docs/archive/CHANGELOG-historical.md, restarted fresh
- Moved DREAM.md → docs/vision.md (trimmed to product vision only)
- Moved docs/DRIFT_LOG.md → docs/ops/drift-log.md, docs/audits/ → docs/ops/audits/
- Created docs/ai/model-routing.md as single source of truth for AI routing
- Rewrote CLAUDE.md as pure navigation hub + agent instructions (no content duplication)
- Rewrote root README.md (50 lines)
- Updated internal links across migration docs, knowledge docs, and source files

## [0.0.1] - 2026-04-22

### Added
- Initial changelog
