# ADR-034: Challenge Design Authoring System — Template Packs, AI Generation, Multi-Language

**Date:** 2026-04-09
**Status:** Proposed
**Deciders:** Founder
**Supersedes:** [ADR-004](ADR-004-static-challenge-library.md) (static TypeScript challenge library at MVP)
**Extends:** [ADR-010](ADR-010-database-driven-challenge-library.md) (database-driven challenge library)
**Research brief:** `outputs/challenge-authoring-system-brief.md` (90 sources, 3 research dimensions)

---

## Context

Pipe's challenge system has three structural gaps:

1. **No connection between role discovery and challenge creation.** The role discovery agent produces a `CandidatePersona` (seniority, mustHaveSkills, niceToHaveSkills) and a `GeneratedJobDescription`, but this output is never consumed to generate or suggest challenges. Recruiters manually browse a hardcoded library.

2. **No template packs.** The preset system (`workers/api/src/lib/presets.ts`) has only `DEFAULT` and `BLANK`. A recruiter hiring a Frontend Mid engineer gets the same starting point as one hiring a Backend Senior — no role-specific curated challenge sets (FRONTEND, FULLSTACK, BACKEND, DATA_ENGINEERING).

3. **No multi-language code support.** Code implementation challenges are single-language. There's no infrastructure for a candidate to choose JavaScript or Python for the same challenge, and no external execution engine — Cloudflare Workers cannot run arbitrary user code.

ADR-004 established a static TypeScript library as the MVP approach. ADR-010 described a database-driven system but was never fully implemented — the library remains hardcoded at `src/content/challengeLibrary.ts` (~50 templates). This ADR supersedes both by defining the full authoring system architecture.

**Scope:** MCQ (`QUIZ_MCQ`), Code Implementation (`CODE_IMPLEMENTATION`), and Long-form text/video (`QUIZ_SHORT_ANSWER`). Excludes `CODE_REVIEW` (covered by CR-* in STRATEGY.md) and `FOLLOW_UP` (AI-generated post-submission).

---

## Decision

Build a challenge authoring system with three content sources unified in a single recruiter UX:

1. **AI generation from job description** — multi-agent pipeline consumes role discovery output to generate challenges with quality gates and confidence scoring.
2. **Template packs by role** — immutable, versioned challenge compositions (FRONTEND_JUNIOR, BACKEND_MID, etc.) stored in D1, browsable by role/seniority/skill.
3. **Recruiter-authored custom challenges** — existing per-type editors wrapped in a 4-step wizard flow.

Code execution for implementation challenges uses **Judge0 CE** (open-source, 60+ languages, self-hostable). MVP language set: **Python + JavaScript/TypeScript** (51% of hiring demand).

---

## Alternatives Considered

### Option A — Extend the existing preset system (chosen components)
- **Pros:** Minimal new infrastructure; `expandPreset()` pattern already works.
- **Cons:** Presets are hardcoded TS objects, not database-driven. No versioning, no recruiter customization, no AI generation. Doesn't scale past 5-10 presets.
- **Verdict:** Keep the expansion pattern, replace the data source with D1 tables.

### Option B — Full AI generation only (no template packs)
- **Pros:** Maximum automation; fewer templates to maintain.
- **Cons:** AI-generated challenges need human review before use. Cold-start problem: new recruiters want instant, validated content. Research [R1-S7] shows single-pass generation has quality issues. Competitors all have template libraries (table-stakes per competitive analysis of 8 platforms).
- **Verdict:** Rejected as standalone. AI generation is one of three content sources, not the only one.

### Option C — Third-party challenge library (HackerRank API, etc.)
- **Pros:** Instant access to thousands of validated challenges.
- **Cons:** Vendor lock-in. Cannot customize for role discovery integration. Cannot control quality or scoring alignment. Expensive licensing. Pipe's differentiator is the AI-native pipeline, not the content library.
- **Verdict:** Rejected. Build in-house, seed with AI-generated gold-standard templates.

### Option D — Client-side code execution (Pyodide/WASM)
- **Pros:** No external service dependency. Low latency.
- **Cons:** Limited to Python/JS. No audit trail. No resource enforcement. Browser-dependent. Cannot run test suites reliably. Research [R2] found this adds complexity without serving hiring use case.
- **Verdict:** Rejected for production. Judge0 CE provides server-side execution with resource limits, 60+ languages, and auditability.

---

## Rationale

### Why three content sources?

Competitive analysis of 8 platforms (HackerRank, Codility, TestGorilla, CodeSignal, Qualified.io, Adaface, Vervoe, Testlify) shows all converge on template libraries + custom creation as table-stakes. AI generation from JD is emerging (~30-40% of surveyed platforms have some form) but no platform shows confidence scores on generated content or offers batch variant generation. The three-source model covers the competitive floor while enabling differentiation.

### Why immutable versioned packs?

IMS QTI item banking standards and platform precedent (Moodle, TAO) converge on immutability after publish. Once a pack is assigned to a pipeline with live candidates, modifying the pack's content would compromise fairness — different candidates would see different challenges for the same assessment. Version-on-edit ensures auditability and fairness.

### Why Judge0 CE over alternatives?

- **Sphere Engine:** 80+ languages but commercial-only, no free tier.
- **Piston API:** Restricted to non-commercial use as of Feb 2026.
- **Judge0 CE:** Open-source (MIT), 60+ languages, self-hostable, free RapidAPI tier for dev, configurable resource limits (CPU 2-15s, memory 128-256MB). Active community. REST API with sync mode.

### Why multi-agent generation instead of single-pass?

Research [R1-S7] demonstrates that no single LLM produces valid, unbiased, linguistically sound assessment items without specialized oversight. A 5-stage pipeline (generate → content review → linguistic evaluation → difficulty calibration → human approval) catches quality issues across multiple dimensions. The content reviewer MUST be a different model family from the generator (same principle as the consistency classifier per ADR-032/CR-5).

### Why Gemma for generation with Opus for seeds?

Research [R1-S18] found larger proprietary models outperform open-source on Bloom's Taxonomy alignment accuracy. This creates a deliberate cost-quality split: **Claude Opus 4.6 for gold-standard seed templates** (one-time, high-quality, reused thousands of times) and **Gemma 4 26B on Workers AI for variant generation and runtime generation** (cheap, high-volume, validated by quality gates). The Opus investment is amortized across all future uses; Gemma keeps per-generation cost negligible.

---

## Consequences

### Positive
- Recruiters get role-specific starting points instead of a blank canvas
- Role discovery output feeds directly into challenge generation — end-to-end coherence
- Multi-language support opens backend/fullstack/data engineering roles
- Immutable versioning ensures fairness and audit compliance
- AI generation with confidence scores is a competitive differentiator (no competitor shows this)
- Template pack system scales via AI generation — not limited by manual authoring capacity

### Negative / Trade-offs
- 4 new D1 tables + 2 ALTER TABLE migrations add schema complexity
- Judge0 dependency adds an external service to the stack (mitigated by self-hosting option)
- Multi-agent generation pipeline is more expensive per challenge than single-pass (~5x token cost), offset by quality improvement
- Seed template generation requires one-time Opus investment (~$50-100 for 50-75 templates)

### Risks
- **Bloom's → challenge type routing is unvalidated for developer roles** (research gap). Needs internal validation before encoding as ground truth in the generation pipeline.
- **Gemma 4 26B may underperform on MCQ Bloom's alignment** vs. larger models [R1-S18]. Pilot-test before relying on it. Fallback: use Sonnet for MCQ generation, Gemma only for classification tasks.
- **Judge0 CE maintenance burden** if self-hosted. Mitigation: start with RapidAPI managed, self-host when volume justifies.
- **Template library gap**: Pipe has 50 templates vs. competitors with 1K-300K. AI generation closes this gap over time, but initial seed library needs investment.

---

## Data Model

### New tables

```sql
-- challenge_templates: immutable challenge definitions
-- challenge_language_variants: per-language starter code + test suites
-- template_packs: versioned, immutable pack definitions
-- template_pack_items: pack composition (which challenges, what order)
```

Full schema in `outputs/challenge-authoring-system-brief.md` Part 2.1.

### Integration with existing schema

- Existing `challenges` table (pipeline instances) remains unchanged
- `template_packs → template_pack_items → challenge_templates` expand into `stages → challenges` via `expandPack()` (replaces `expandPreset()`)
- New columns on `stages`: `template_pack_id TEXT`, `template_pack_version INTEGER`

### New API routes

```
/api/v1/template-packs/*           Template pack CRUD
/api/v1/challenge-templates/*      Challenge template CRUD
/api/v1/generate/challenges        AI generation from role context
/api/v1/generate/variants          Batch variant generation
/rpc/execute                       Code execution via Judge0
```

---

## Model Routing (additions to CLAUDE.md table)

| Agent / job | Model | Provider | Why |
|---|---|---|---|
| Challenge generator (MCQ, long-form) | Gemma 4 26B | Workers AI | Structured JSON, cheap. Caveat: pilot-test Bloom's accuracy. |
| Challenge generator (code implementation) | Qwen 2.5-Coder 32B | Workers AI | Code-tuned for starter code + test suites |
| Content reviewer (validation) | Qwen 2.5-Coder 32B (if generator is Gemma) or Gemma (if generator is Qwen) | Workers AI | Must be different model family from generator |
| Linguistic evaluator + difficulty calibrator | Gemma 4 12B | Workers AI | Lightweight classification |
| Gold-standard seed templates (offline) | Claude Opus 4.6 | Anthropic | One-time quality investment |
| Variant generation (offline, batch) | Claude Sonnet 4.6 | Anthropic | Quality-sensitive, cost-insensitive, offline |

---

## Implementation Phases

| Phase | Scope | Maps to STRATEGY.md |
|---|---|---|
| CA Phase 1 | D1 migrations, seed script, template/pack CRUD routes | New — data foundation |
| CA Phase 2 | Template pack browser, 4-step wizard, drawer editors | New — recruiter UX |
| CA Phase 3 | AI generation pipeline, confidence scoring, human review | New — AI content |
| CA Phase 4 | Judge0 integration, language variants, execution | New — multi-language |
| CA Phase 5 | Batch generation, IRT calibration, pack sharing | Post-MVP |

---

## Follow-up

- Add CA-* findings to `knowledge/STRATEGY.md` finding → action map
- Update CLAUDE.md model routing table with new agents
- Supersede ADR-004 status
- Migrate `challengeLibrary.ts` templates to D1 seed script
- Write D1 migration `0004_challenge_authoring.sql`
