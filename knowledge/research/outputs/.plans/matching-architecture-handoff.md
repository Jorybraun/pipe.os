# Handoff — Matching Architecture + Embedding Validation

**Date:** 2026-04-22
**Context window status:** Saturated. Fresh agent required.
**Scope:** Everything discussed about candidate-repo-role matching, embedding validation, and assessment signals.

---

## What we built (implementation complete)

- **Dual-layer embedding architecture** (D1 ground truth + Vectorize ANN) — migration 0042, 67 tests passing
- **Candidate Discovery v2 agent** — extracts `candidate_searchable_profile`, `key_concepts`, `career_context`, `situation_signature` from resume
- **`matchReposForCandidate`** — SQL graph score (skills + domain + seniority + language) + optional BGE embedding rerank
- **`candidateSituationFit`** — LLM scorer that reasons over candidate narrative + repo engineering signals
- **`triangulateMatch`** — weighted combinator blending 4 signals (role_repo, candidate_repo, role_candidate_cosine, skill_coverage)
- **Research brief:** `knowledge/outputs/embedding-validation-brief.md` — synthetic sniff test protocol, recruiter feedback calibration, metrics

---

## The architectural debate (unresolved)

### Four matching mechanisms were discussed

1. **SQL graph matching** (`matchRepos.ts`) — hard filters on skills, domain, seniority, language. Fast, explainable, dumb. Used for MVP repo selection today.
2. **BGE embedding similarity** — semantic vector matching. Built and tested but unvalidated. Founder skeptical of its value for recruiting.
3. **Assessment signals** — behavioral telemetry from code review / dev container / culture interview (TDD patterns, AI acceptance, churn, pushback handling). Research exists in RND but no schema or implementation.
4. **LLM situational scorer** (`candidateSituationFit`) — reads narrative profiles and reasons about nuanced fit ("terraform for ecommerce high-end client"). Most aligned with founder's desire for "highly intelligent" matching.

### Founder's explicit positions

- **Matching is NOT shelved.** `migration/PLAN.md` Phase 7 says deferred; founder explicitly overrode this.
- **Wants highly intelligent matching, not taxonomy/keyword matching.** SQL is acceptable for hard filters (language, seniority) but NOT as the primary matching mechanism.
- **Assessment signals are valuable.** Capturing demonstrated behavior from tests makes candidates reusable long-term.
- **Embeddings are unproven.** The synthetic sniff test must run before trusting BGE for ranking. Weights are guesses.
- **No graph DB needed.** D1 + JSON columns + LLM reasoning is sufficient.
- **Candidate reuse is a core requirement.** A candidate who takes one assessment should be matchable for future roles without re-ingestion.

---

## Key files to read

| File | Why |
|---|---|
| `knowledge/outputs/embedding-validation-brief.md` | Validation protocol for BGE embeddings |
| `workers/api/src/lib/candidateDiscovery/agent.ts` | Candidate Discovery agent implementation |
| `workers/api/src/lib/candidateDiscovery/prompts.ts` | System prompt + output schema |
| `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts` | LLM-based situational scorer |
| `workers/api/src/lib/match/matchReposForCandidate.ts` | Graph + embedding rerank pipeline |
| `workers/api/src/lib/repoDiscovery/matchRepos.ts` | SQL graph matcher (skills/domain/seniority/language) |
| `docs/vision.md` | Core product thesis: "The assessment IS the work" |
| `knowledge/rnd/outputs/human-judgment-research-telemetry.md` | Behavioral signals from dev containers (RND research) |

---

## Open questions requiring founder decision

1. **Primary matching mechanism:** Is the LLM scorer (`candidateSituationFit`) the main match path, with SQL as pre-filter? Or do we need a hybrid?
2. **Assessment signals schema:** Do we add `candidate_assessment_signals` now, or after dev containers ship?
3. **Embedding validation:** Run the synthetic sniff test (2 hours) or skip it and rely on LLM scorer?
4. **MVP scope:** Does the first real candidate test use SQL-only matching, or does it include `candidateSituationFit`?

---

## What to do next

**If the founder asks about matching:**
- Read this handoff (2 min)
- Read `embedding-validation-brief.md` (5 min)
- Ask the founder which of the 4 open questions they want decided

**If the founder asks to implement:**
- The LLM scorer (`candidateSituationFit`) is the most aligned with their "highly intelligent" requirement
- SQL graph matching already works for hard filters
- Assessment signals require schema design + telemetry instrumentation (not yet built)
- Embedding rerank exists but is optional and unvalidated

---

## One-paragraph TL;DR for a cold agent

PIPE has a working SQL graph matcher for repo selection and a built-but-unvalidated BGE embedding pipeline. The founder wants highly intelligent matching that reasons like a human recruiter ("terraform for ecommerce high-end client"), not just taxonomy tags. The `candidateSituationFit` LLM scorer is the closest existing implementation. Assessment signals from candidate test performance are the founder's preferred long-term approach for candidate reuse. The embedding validation brief exists but the sniff test hasn't been run. Four architectural decisions are unresolved and need founder input before implementation resumes.
