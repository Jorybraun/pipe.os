# ADR-036: Role Discovery + Repo Understanding Data Contract

**Date:** 2026-04-10
**Status:** Proposed
**Deciders:** Hans (founder)
**Supersedes:** [ADR-028](ADR-028-multi-stakeholder-role-discovery.md) sections treating `CandidatePersona` as the canonical artifact produced by synthesis
**Extends:** [ADR-027](ADR-027-role-discovery-agent.md), [ADR-029](ADR-029-culture-interview-agent-architecture.md), [ADR-030](ADR-030-culture-profile-operationalization.md), [ADR-031](ADR-031-ai-hiring-compliance-architecture.md), [ADR-032](ADR-032-code-review-research-integration.md), [ADR-035](ADR-035-global-copilot-agent.md)
**Source of truth:** [`knowledge/outputs/role-discovery-data-contract.md`](../../knowledge/outputs/role-discovery-data-contract.md) (2026-04-10, 84 cited sources, 1 round, PASS WITH NOTES — 3 MAJOR patched, 0 FATAL) and [`knowledge/STRATEGY.md`](../../knowledge/STRATEGY.md) RD-1 through RD-24
**Research provenance:** [`knowledge/outputs/role-discovery-data-contract.provenance.md`](../../knowledge/outputs/role-discovery-data-contract.provenance.md)
**Verification report:** [`knowledge/outputs/role-discovery-data-contract-verification.md`](../../knowledge/outputs/role-discovery-data-contract-verification.md)

---

## Context

Two drifts had accumulated in the pipeline and they are halves of one bridge. Neither half is useful without the other, so they are addressed together in a single ADR.

**Drift 1 — Role Discovery flattening (RD-1 through RD-22).** The Role Discovery agent (ADR-027) runs a research-grounded IDEO design-thinking protocol documented in `migration/dersign-thinking.md` Part 8. That research document is explicit that the canonical artifact of the interview is a **Knowledge State JSON** with hierarchical, story-grounded, motivationally-grounded understanding across six domains (why, work, team, bar, codebase, process), including laddering chains (attribute → consequence → value), per-turn energy signals, and cross-stakeholder disagreements. In code, synthesis flattens that Knowledge State into an 8-field `CandidatePersona` (`workers/api/src/types.ts:223`) — `seniority`, `archetype`, `mustHaveSkills[]`, `niceToHaveSkills[]`, `disposition[]`, `careerSignal`, `redFlags[]`, `dealbreakers[]`. Laddering collapses into `mustHaveSkills[]`. Stories remain as prose in `exchanges[].answer`. Energy signals are never persisted. Cross-stakeholder contradictions live only in free-text `reasoning`. Multi-stakeholder perspective data introduced by ADR-028 never reaches culture scoring. The Knowledge State is persisted but no downstream consumer reads it — culture role resolution reads only `persona.seniority + persona.archetype` (`cultureRoleResolution.ts:52-74`), challenge generation reads 5 persona fields (`challengeGeneration/prompts.ts:35-39`), repo discovery reads `persona.mustHaveSkills` (`repoDiscovery/discover.ts:46-71`). The richest structured output of the intake interview is dead inventory.

**Drift 2 — Repo library has no AI reasoning layer (RD-23, RD-24).** The repo crawler (`scripts/crawl-repos/`) completed Pass 1 (GitHub search + manifest parsing) and Pass 2 (clone + SLOC/CCN + construct-slug regex + PR sampling into `repo_sample_prs`) but has zero LLM calls. The richest substrate available — `repo_sample_prs` metadata (title, changed-file count, test-touched flag, issue-resolution link, construct-slug tags, SWE-bench eligibility) plus repo-level constructs, stack, seniority band, and complexity metrics — is queried only by a SQL CTE join in `matchRepos.ts` on `qualified_repos ← repo_skills ← repo_constructs` with hard filters + weighted scoring on skill keywords from `persona.mustHaveSkills[]`. Role Discovery's signal and the repo library's signal meet at a keyword join, and the richer structure on both sides dies at that boundary.

The two drifts compound. Even if Role Discovery produces a richer Role Context Document, there is nothing on the repo side capable of reasoning over it. And even if the repo side gains an AI enrichment pass, there is no stable input contract for it to consume. This ADR defines both halves of the data contract so they land together.

The research run (plan at `knowledge/outputs/.plans/role-discovery-data-contract.md`, 11 sub-questions, 4 parallel researcher threads) produced 84 cited sources across four research files, a Lead-written synthesis brief, a verifier citation + URL pass, and a reviewer evidence-integrity pass with verdict PASS WITH NOTES (0 FATAL, 3 MAJOR patched, 5 MINOR accepted). Every load-bearing claim in this ADR traces back to a `[R#-S#]` marker in the final brief.

---

## Decision

Close both drifts with a single data contract — a Role Context Document (RCD) that replaces `CandidatePersona` as the canonical synthesis output, plus a Repo Understanding Contract (RUC) built on two new D1 tables and a two-stage retrieval architecture.

### Half 1 — The Role Context Document (supersedes CandidatePersona)

#### 1.1 Schema shape: hybrid qualitative architecture

The RCD is structured as a **domain matrix** keyed by `(stakeholder_type, domain)` where every cell carries the same five ingredients drawn from four qualitative-research traditions (R1):

- **Framework analysis matrix** (Ritchie & Spencer 1994, Gale et al. 2013) — superior to thematic analysis when the research question requires comparison across cases. Supplies the `(row=stakeholder, col=domain)` indexing.
- **IPA evidence-anchor pattern** (Smith, Flowers & Larkin 2009) — every interpretation must be traceable to a verbatim transcript quote. Supplies the mandatory `attribute_quote` field with `source_exchange_id` and character offsets.
- **Grounded theory axial coding** (Charmaz 2014; Strauss & Corbin 1998) — open codes become axial links with directionality. Supplies the `open_codes[]` and `axial_links[]` arrays.
- **Means-End Chain laddering** (Reynolds & Gutman 1988) — the `attribute → consequence → value` triad is the canonical representation of interview-extracted motivational hierarchy. Supplies the `laddering_chains[]` field with strict directionality (A→C→V, never the reverse).

Each cell also carries `primary_authority: boolean` indicating whether this stakeholder is the domain-authoritative source (e.g., Hiring Manager is authoritative on Why/Bar; Team Member is authoritative on Team/Process). The matrix is the first-class artifact. Flat `consumer_slice` fields are derived at write time from the matrix for backwards-compatible consumers.

**Top-level schema sketch** (full JSON schema in the research brief §1.1):

```typescript
type RoleContextDocument = {
  rcd_version: string;                 // semver; invalidation key for downstream caches
  role_context_id: string;             // stable id across interview rounds
  pipeline_id: string;
  created_at: string;                  // ISO 8601

  domain_matrix: {
    [stakeholder_type in StakeholderType]?: {
      [domain in Domain]?: DomainCell;
    };
  };

  conflicts: ConflictRecord[];         // first-class cross-stakeholder disagreements
  technical_context: TechnicalContext; // derived aggregate read by challengeGen + repo search
  team_culture_profile: TeamCultureProfile; // 5-signal output (§1.4)
  bars_overrides: BarsOverride[];      // per-dimension anchor deltas (§1.5)
  probe_bank_enrichment: ProbeEnrichment; // role-setup-time additions to static bank (§1.6)
  dealbreakers: DealbreakerRecord[];   // HITL-gated (§1.7)
  red_flags: RedFlagRecord[];          // advisory-only

  consumer_slice: CachedPersona;       // derived cache — CandidatePersona shape for legacy readers

  validation_metadata: {               // versioning precondition per §3.3
    schema_version: string;
    synthesis_model: string;
    synthesis_prompt_version: string;
    verification_pass_model: string;
    face_validity_reviewed_at: string | null;
    face_validity_reviewer: string | null;
  };
};

type StakeholderType = 'HIRING_MANAGER' | 'TEAM_MEMBER' | 'INTERNAL_RECRUITER' | 'EXTERNAL_RECRUITER';
type Domain = 'why' | 'work' | 'team' | 'bar' | 'codebase' | 'process';

type DomainCell = {
  primary_authority: boolean;
  laddering_chains: Array<{
    attribute_quote: string;           // verbatim transcript quote
    source_exchange_id: string;
    consequence: string;               // Reynolds & Gutman directionality enforced at prompt layer
    value: string;
    energy_signal: 'high' | 'medium' | 'low' | 'unknown';
  }>;
  open_codes: string[];                // grounded theory Tier 1
  axial_links: Array<{
    from_code: string;
    to_code: string;
    relation: 'causes' | 'enables' | 'blocks' | 'contradicts' | 'instantiates';
  }>;
  stories: StoryRecord[];              // structured situation/action/outcome/moral
  summary: string;                     // constructive, never blunt (per feedback memory)
};

type StoryRecord = {
  situation: string;
  action: string;
  outcome: string;
  moral: string;                       // what the story tells us about the team
  source_exchange_id: string;
};

type ConflictRecord = {
  domain: Domain;
  field: string;                       // e.g., 'team.collaboration_style'
  stakeholder_a: StakeholderType;
  position_a: string;
  stakeholder_b: StakeholderType;
  position_b: string;
  conflict_flag: 'minor' | 'material' | 'blocking';
  resolution_strategy: 'prefer_authoritative' | 'preserve_both' | 'escalate_to_recruiter';
};
```

This resolves **RD-1 through RD-7**: every field that was lost in the flat persona is preserved as a first-class column. The `consumer_slice` view keeps legacy readers working during the migration.

#### 1.2 Synthesis prompting: three-layer pattern

The synthesis step rewrites around a three-layer pattern drawn from the constrained-decoding and schema-guided generation literature (R1):

1. **Schema-guided generation with field-level exemplars.** The system prompt contains the full RCD JSON schema plus one worked exemplar per field type (a laddering_chain, a story, a conflict, a dealbreaker). The model sees examples of shape, not just the shape itself. Grounded in Chain-of-Density (Adams et al. 2023) and schema-in-prompt patterns (PARSE: Dong et al. 2024 reports 34% extraction accuracy improvement from description enhancement + 55% from structural reorganization = 89% combined).
2. **Constrained JSON decoding** via `response_format: json_schema` or equivalent structured output mode. The model physically cannot emit fields outside the schema. Failure-mode elimination is at the token level, not the retry level.
3. **Verification pass.** After the primary synthesis call (Gemma 4 26B on Workers AI), a second Gemma 4 12B call reads the RCD and the original transcript and checks that every `attribute_quote` field contains text that appears verbatim in the referenced exchange, every `consequence` is grounded in a stated consequence (not projected), and every `value` is not a generic HR platitude ("collaboration", "growth"). Cells that fail verification are either regenerated or downgraded to `confidence: low` with an inspector tag.

**Load-bearing rule: bottom-up ordering.** The synthesis prompt must instruct the model to extract `attribute_quote` → `consequence` → `value` in that order, not the reverse. The Means-End Chain directionality is preserved by the prompt structure, not by hope. Reversing the order causes **value projection** — the model leads with generic values ("they care about quality") and back-fills evidence to fit, producing plausible-but-fabricated ladders.

**Five named failure modes** that the prompt, the schema, and the verification pass must collectively defend against (R1):

1. **Value projection** — values generated first, evidence fitted after. Defense: bottom-up ordering + quote grounding.
2. **Consequence genericization** — consequences compressed to platitudes ("better code quality"). Defense: exemplar field showing specific behavior-level consequences.
3. **Energy-signal inflation** — every signal labeled "high". Defense: require a verbatim quote justifying any "high" label.
4. **Domain-coverage collapse** — only 2–3 of the six domains populated. Defense: schema requires all six domain keys present; empty cells must be explicitly marked `coverage: not_probed`.
5. **Stakeholder averaging on first pass** — the model silently averages positions from two stakeholders rather than preserving both. Defense: the matrix structure prevents this by keying on stakeholder; per-stakeholder cells are required.

This resolves **RD-3** (laddering chains preserved) and **RD-8** (synthesis prompt rewrite).

#### 1.3 Multi-stakeholder aggregation: three-tier

Per R4, multi-source assessment literature is clear that aggregation without scalar-invariance testing is invalid. Conway & Huffcutt (1997) report a supervisor–peer correlation of ρ=.34, which means **89% of the variance is source-unique** — averaging two stakeholders' positions discards nearly all the information. The three-tier protocol:

- **Tier 1 — Domain-authoritative anchors.** Each of the six domains has a primary authority designated by stakeholder type. HM is authoritative on Why and Bar. TM is authoritative on Team and Process. Both are joint-authoritative on Codebase and Work. The RCD's per-domain `primary_authority` flag determines whose cell is the anchor when downstream consumers need a single value.
- **Tier 2 — Shared-domain preservation with conflict flags.** On domains where both stakeholders have a view, both cells are preserved. A `ConflictRecord` is emitted whenever cells diverge. Downstream consumers decide how to handle disagreement — the RCD never fabricates a midpoint.
- **Tier 3 — Explicit-formula aggregates.** A small set of genuinely consensus fields (e.g., `team_culture_profile.psychological_safety.priority_rank`) is computed by an explicit formula documented in the synthesis prompt. No implicit averaging anywhere.

Disagreement is its own category, not a midpoint. This follows the RAND/UCLA Appropriateness Method — when experts disagree, the disagreement is the finding, not a computational nuisance.

This resolves **RD-6** (structured disagreement records).

#### 1.4 Team culture profile: five-signal set

Per R2, the culture signal set is five dimensions:

- **4 OCAI Competing Values Framework archetypes** — Clan, Adhocracy, Market, Hierarchy (Cameron & Quinn 2006; Heritage et al. 2014). Cronbach's α is in the range .69–.83 across archetypes under Current-culture framing. **Critical caveat:** Heritage et al. report that the *Ideal culture* framing — the framing Harver uses for candidate screening — has **no significant relationship with job satisfaction**, while the *Current culture* framing does. Harver uses the invalid framing anyway. PIPE does not. OCAI signals in the RCD profile **the team** under Current-culture framing (HM and TM reporting on what the team is actually like), never the candidate.
- **Psychological safety** — independently validated by Edmondson (1999) and Google's Project Aristotle. Predicts team performance in ways the four OCAI archetypes do not capture. Qualitative evidence base but architecturally essential.

**Excluded** from the RCD culture profile:
- Plum's 10 Talents (no published independent validation)
- Pymetrics' 91 traits (data-hungry calibration infeasible at MVP scale)
- Lattice's competencies (post-hire only; not a pre-hire tool)
- Culture Amp's 10 engagement factors (useful as *input* to Team-domain probes but not as candidate-facing dimensions)

The `team_culture_profile` is a 1–5 priority scale per signal, scored from the Role Discovery interview's Team domain. **Per-stakeholder scores are preserved rather than averaged**, per §1.3. The culture scorer reads this profile to calibrate which dimensions matter for the role.

This resolves **RD-9 through RD-12** (replaces the 4-keyword regex + 3 hardcoded overlays in `cultureRoleResolution.ts` with a structured team profile).

#### 1.5 BARS calibration: universal base + RCD-derived overrides

Per R2, the BARS research (Smith & Kendall 1963; Hodges 1999; Campion et al. 1997; Kell et al. 2017 ETS RR-17-28) supports a hybrid approach. A **universal base rubric** provides the shared psychometric backbone with Hodges-compliant anchors at every level. **Per-dimension overrides** derived from the RCD's laddering chains adjust anchor language for team-specific context — e.g., a "ownership Level 5" anchor might read "pushes back on PMs when the spec is unclear" for a team whose HM described push-back culture, versus "executes exactly as specified and escalates ambiguity" for a team whose HM described tight-spec culture.

Overrides are generated at **role setup time**, not per-candidate. The generation step reads the relevant laddering chains from the RCD's `work.bar` and `team` domains, produces candidate override anchors, and presents them to the recruiter for inline approval in the pipeline wizard. Approved overrides are persisted to the `role_contexts.bars_overrides` column and are versioned with the RCD.

**Never per-candidate dynamic generation.** Per-candidate BARS tailoring fails NYC Local Law 144 auditability (the recruiter cannot show a consistent rubric was applied across candidates) and EU AI Act Article 14 interpretability (the scoring rationale depends on transient state).

This resolves **RD-13** (BARS override mechanism).

#### 1.6 Probe bank: static base + role-setup-time enrichment

Per R2, probe generation follows the same pattern as BARS — a **static bank** is the default and a **role-setup-time enrichment** layer adds team-specific probes derived from the RCD's laddering chains. The enrichment step reads the Team domain chains, identifies probe-worthy specifics (e.g., "the HM said the last conflict was around v2 launch criteria"), and generates candidate probes that the recruiter approves before they enter the active bank for this role. Approved probes are persisted to a new `role_probe_bank` table keyed by `role_context_id`.

**Never per-candidate dynamic generation** — same auditability reasoning as §1.5. The candidate-facing culture interview always draws from a finite, versioned, recruiter-approved bank.

New D1 table:

```sql
CREATE TABLE role_probe_bank (
  id TEXT PRIMARY KEY,
  role_context_id TEXT NOT NULL REFERENCES role_contexts(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,             -- which culture/behavioral dimension this probes
  probe_text TEXT NOT NULL,
  source TEXT NOT NULL,                -- 'static_base' | 'rcd_enriched'
  source_chain_id TEXT,                -- pointer into RCD laddering_chains (enriched only)
  approved_by TEXT NOT NULL,           -- recruiter user id
  approved_at TEXT NOT NULL,           -- ISO 8601
  rcd_version TEXT NOT NULL,           -- invalidation key
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_role_probe_bank_role ON role_probe_bank(role_context_id);
CREATE INDEX idx_role_probe_bank_dim ON role_probe_bank(role_context_id, dimension);
```

This resolves **RD-15** (team-specific probe generation without sacrificing audit trails).

#### 1.7 Dealbreaker gates: auto-flag-then-HITL, never auto-fail

Per R2, the legal evidence base for automated hard-fail decisions in hiring is unambiguous. Auto-fail is indefensible.

- **Griggs v. Duke Power Co., 401 U.S. 424 (1971)** — disparate impact doctrine; neutral practices with discriminatory effect violate Title VII even without discriminatory intent. Business necessity defense requires that the selection procedure be "demonstrably a reasonable measure of job performance."
- **Uniform Guidelines 29 CFR Part 1607** — operationalize adverse impact via the four-fifths (80%) rule. Applies independently to each step in a sequential selection process. Auto-fail gates are independently subject to adverse-impact analysis and cannot demonstrate individualized assessment.
- **EEOC v. iTutorGroup (2023)** — the EEOC's first successful AI hiring discrimination settlement, structurally identical to an auto-fail dealbreaker gate. Software automatically rejected female applicants age 55+ and male applicants age 60+; 200+ affected applicants; $365,000 settlement + 5+ years of EEOC monitoring. The EEOC's legal finding: *it is immaterial that the software made the rejection "automatically" — intentional programming of the filter is itself discriminatory intent.* Any auto-fail dealbreaker in PIPE that correlates with a protected characteristic reproduces this mechanism.
- **Mobley v. Workday (2025)** — in active litigation as of 2026-04-10; conditionally certified as a nationwide ADEA class action. The certification analysis indicates (pending final merits): AI vendors may be directly liable as employer "agents," the scale of AI hiring decisions creates class-action exposure individual claims did not, and the employer using the vendor's tool is not automatically insulated from co-liability. The practical implication for PIPE is identical regardless of merits: vendor and customer should assume shared exposure for automated screening outcomes.
- **EU AI Act Annex III / Article 14** (applicable from 2 August 2026) — classifies recruitment AI as high-risk and requires that natural persons be able to "halt, suspend, or override" outputs, remain aware of automation-bias tendencies, and that "no AI tool should make final placement, rejection, or evaluation decisions without a qualified human in the loop." A pure auto-fail mechanism is non-compliant on its face.

**Decision:** Dealbreakers are **auto-flag-then-HITL gates**. The scorer detects a dealbreaker hit and raises a flag that blocks candidate advancement until a human reviews. The recruiter sees the flag with the dealbreaker definition, the matching evidence, and a pre-populated `jobRelatednessNote` plus `jobRelatednessStrength` field explaining the business-necessity rationale. The recruiter either confirms the rejection (creating an audit trail that supports a Griggs business-necessity defense) or overrides.

**Red flags** are advisory-only. They surface in the recruiter UI but never block candidate advancement automatically. This mirrors ADR-031's compliance gate pattern.

Each dealbreaker in the RCD carries:

```typescript
type DealbreakerRecord = {
  id: string;
  label: string;                       // human-readable summary
  pattern: string;                     // what to look for in culture/code-review outputs
  source_stakeholder: StakeholderType; // who raised it
  source_chain_id: string;             // pointer into RCD laddering_chains
  job_relatedness_note: string;        // pre-populated Griggs defense text
  job_relatedness_strength: 'strong' | 'moderate' | 'weak';
  evidence_quote: string;              // verbatim quote from source
};
```

This resolves **RD-16** (dealbreaker propagation without adverse-impact exposure).

---

### Half 2 — The Repo Understanding Contract (RUC)

#### 2.1 Nine codebase signals across three tiers

Per R3, the Mining-Software-Repositories literature identifies a concrete set of signals that meaningfully differentiate codebase shape for challenge-relevant matching. Nine signals ranked across three tiers:

**Tier 1 — Computable today from existing PIPE schema** (no Pass 2 extension needed):
1. `test_touch_rate` — fraction of PRs in `repo_sample_prs` with `test_touched=true`. Already captured.
2. `mean_changed_files`, `p90_changed_files` — from existing `changed_files` column on `repo_sample_prs`.
3. `issue_link_rate` — fraction of PRs in `repo_sample_prs` with a non-null `issue_link`.
4. `complexity_band` — from existing Pass 2 scc/lizard output on `qualified_repos`.
5. `swe_bench_eligibility_rate` — fraction of PRs in `repo_sample_prs` tagged SWE-bench-eligible.

**Tier 2 — Needs Pass 2 extension** (second-round work):
6. `architecture_style` — monolith, microservice, modular monolith, serverless. Detectable from directory structure + manifest analysis (Verano Merino 2022 microservice detection).
7. `review_density` — mean PR comments per PR (GitHub API call at Pass 2 time).
8. `commit_cadence` — commits/week over trailing 12 months (git log analysis).
9. `satd_density` — self-admitted technical debt markers per KLOC (grep for SATD patterns).

**Tier 3 — Requires new substrate** (deferred): README embeddings, diff-level semantic embeddings, deep code-smell analysis. Explicitly out of scope for RD-P4.

The five Tier-1 signals plus the existing stack/construct/seniority/complexity data are **sufficient substrate for the Pass 3 summarizer to produce a useful `repo_engineering_signals` row today**. Tier 2 additions can land in a later crawler sprint without invalidating the RUC schema (since signals are a JSON blob).

This resolves **RD-20, RD-21** (signals beyond skill keywords) and is compatible with the existing `repo_constructs` semantic layer.

#### 2.2 Two-stage retrieval architecture (Q11 — load-bearing)

The single most architecturally load-bearing question in the research run resolved cleanly to a **two-stage IR architecture** mirroring the ColBERT offline/online split and the AIF asynchronous preranking framework. Three alternatives were evaluated:

- **Alternative A — Offline-only per-repo summarization.** An LLM reads each repo once and writes a role-agnostic engineering narrative, reused across every role. Supported by hierarchical repository summarization literature and ColBERT's offline document precomputation. *Verdict: right for signal extraction, wrong as the sole step* — SWE-bench evidence indicates query-agnostic retrieval (BM25) recovers the oracle file set at meaningfully limited rates even with large context windows. A summary written without a role in mind cannot reason about "does this repo's review culture match the HIPAA-constrained environment the recruiter described?"
- **Alternative B — Runtime-only per-(role × repo) alignment.** A cross-encoder reranker that jointly encodes role and repo at query time. Supported by rec-sys reranking literature — cross-encoders are more accurate than bi-encoders at relevance judgment. *Verdict: right shape for a reranking step, wrong if applied over the full candidate set without pre-filtering* — token burn at every role creation event; latency at discovery time infeasible on Cloudflare's 30-second Worker timeout for 50 inline pairs; no caching possible unless role context is exactly identical; judgment inconsistency across sampled runs.
- **Alternative C — Two-stage: offline per-repo signals + runtime per-(role × repo) rerank.** The IR literature's standard architecture for systems that must balance cost, latency, and relevance accuracy. Supported by ColBERT's offline/online split, the precomputation/caching research (27–58% latency reduction), and the AIF asynchronous inference framework: "interaction-independent components can be decoupled from the sequential pipeline and precomputed asynchronously." **Recommended.**

**The specific call for PIPE:**

**Stage 0 — Existing SQL retriever.** `matchRepos.ts` stays as the stage-0 filter: the existing CTE join on `qualified_repos ← repo_skills ← repo_constructs` with hard filters + weighted scoring. Returns the top-N SQL candidates (default N=20) fast, cheap, and deterministic. No changes to the existing query.

**Stage 1 — Offline Pass 3 on Vertex AI Gemma 4 26B.** A new crawler pass (`scripts/crawl-repos/pass3/run.ts`) runs as a batch job. For each repo it reads `repo_sample_prs` metadata + `repo_constructs` + Pass 2 signals and calls Gemma 4 26B to produce one `repo_engineering_signals` row, **role-agnostic by design**. Output is a structured JSON blob describing the repo's engineering culture on the five Tier-1 signals (expanding to nine as Tier-2 ships), plus a short narrative summary in `engineering_narrative`. Re-run on crawler re-crawl. Content-hashed so unchanged repos aren't re-summarized. Cost is near-zero (Vertex AI Gemma free tier).

**Stage 2 — Runtime role-fit rerank on Gemma 4 26B.** A new Worker handler (`workers/api/src/lib/repoDiscovery/roleFitRerank.ts`) sits between `discover.ts` and the final ranked result. After `matchRepos` returns its 20 stage-0 candidates, the Worker reads the RCD Technical Context + the Pass 3 `repo_engineering_signals` for each candidate, calls Gemma 4 26B on Workers AI to produce per-candidate alignment scores with structured reasoning, and persists to a new `repo_role_alignment` table. Keyed by `(role_context_id, repo_id)` with `rcd_version` + `signals_version` as explicit invalidation columns. Subsequent recruits to the same role read the cached row rather than re-paying the LLM call. Gemma 4 26B matches CLAUDE.md routing: real-time hot path, per-discovery latency budget, Workers AI daily quota compatible (rerank is low-volume vs. culture interview turns).

**Data flow is acyclic.** Role Discovery writes RCD → Worker reads it. Crawler Pass 3 writes `repo_engineering_signals` → Worker reads it. Worker writes `repo_role_alignment` → app reads it. No component writes to a table another component also writes to.

**Model routing:** Gemma 4 26B for both Pass 3 (offline signal extraction via Vertex AI) and runtime rerank (via Workers AI). Originally designed with different model families for independent error detection, but the current implementation accepts same-family routing for the initial library build.

This resolves **RD-23** (crawler Pass 3) and **RD-24** (Worker runtime role-fit pass).

#### 2.3 New D1 tables

```sql
-- Pass 3 offline signal extraction (role-agnostic, amortized)
CREATE TABLE repo_engineering_signals (
  repo_id TEXT PRIMARY KEY REFERENCES qualified_repos(id) ON DELETE CASCADE,
  signals_version TEXT NOT NULL,       -- semver; invalidation key
  content_hash TEXT NOT NULL,          -- of the inputs; skip re-run if unchanged

  -- Tier 1 signals (computable from existing substrate)
  test_touch_rate REAL,                -- 0.0–1.0
  mean_changed_files REAL,
  p90_changed_files INTEGER,
  issue_link_rate REAL,                -- 0.0–1.0
  complexity_band TEXT,                -- 'low' | 'medium' | 'high' | 'mixed'
  swe_bench_eligibility_rate REAL,     -- 0.0–1.0

  -- Tier 2 signals (populated as Pass 2 extends)
  architecture_style TEXT,             -- 'monolith' | 'microservice' | 'modular_monolith' | 'serverless' | 'unknown'
  review_density REAL,                 -- mean PR comments per PR
  commit_cadence REAL,                 -- commits/week trailing 12 mo
  satd_density REAL,                   -- SATD markers per KLOC

  -- Narrative output
  engineering_narrative TEXT NOT NULL, -- ~200-word structured summary from Gemma 4 26B
  signal_json TEXT NOT NULL,           -- full structured output blob for future signals

  -- Provenance
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model_used TEXT NOT NULL,            -- 'claude-haiku-4-5-20251001' etc.
  model_version TEXT NOT NULL
);

CREATE INDEX idx_repo_signals_version ON repo_engineering_signals(signals_version);
CREATE INDEX idx_repo_signals_hash ON repo_engineering_signals(content_hash);

-- Stage-2 runtime role-fit rerank (cached per role × repo)
CREATE TABLE repo_role_alignment (
  role_context_id TEXT NOT NULL REFERENCES role_contexts(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,

  alignment_score REAL NOT NULL,       -- 0.0–1.0
  alignment_band TEXT NOT NULL,        -- 'strong' | 'moderate' | 'weak' | 'mismatch'
  reasoning_json TEXT NOT NULL,        -- structured per-signal justification
  per_signal_scores TEXT NOT NULL,     -- JSON { test_touch_rate: 0.82, architecture_style: 0.65, ... }

  -- Invalidation keys
  rcd_version TEXT NOT NULL,           -- role context version when this was generated
  signals_version TEXT NOT NULL,       -- signals version when this was generated

  -- Provenance
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model_used TEXT NOT NULL,            -- '@cf/google/gemma-4-26b-a4b-it' etc.

  PRIMARY KEY (role_context_id, repo_id)
);

CREATE INDEX idx_role_alignment_role ON repo_role_alignment(role_context_id, alignment_score DESC);
CREATE INDEX idx_role_alignment_rcd_ver ON repo_role_alignment(role_context_id, rcd_version);
```

Existing `role_contexts` table gains new columns (migration, not replacement):

```sql
ALTER TABLE role_contexts ADD COLUMN rcd_version TEXT;
ALTER TABLE role_contexts ADD COLUMN rcd_json TEXT;               -- full RoleContextDocument
ALTER TABLE role_contexts ADD COLUMN validation_metadata TEXT;    -- versioning precondition
ALTER TABLE role_contexts ADD COLUMN bars_overrides TEXT;         -- JSON array
-- persona_json remains as legacy cache; eventually demoted to consumer_slice
```

---

### Cross-cutting — Validation methodology

Per R4, local criterion studies are infeasible at PIPE's volumes. To detect a correlation of r=.30 requires N≈85; r=.20 requires N≈193. The first customer will not generate those cohorts in a reasonable window. The research prescribes a **staged evidence ladder**:

| Stage | Sample size | Method | Evidence strength | Source grounding |
|---|---|---|---|---|
| **E0 — Face validity** | N=0 (pre-deployment) | Content review by SME panel; CVR scoring against job analysis | Expert-judgment only | SIOP 2018 Principles; Lawshe 1975 |
| **E1 — Convergent bootstrap** | N=30–50 | Structured interview scores vs. Role Discovery-derived expectations (within-cohort); inter-rater agreement on BARS | Weak construct validity | Shadish/Cook/Campbell 2002 |
| **E2 — Transportability** | N=100–200 | Sackett et al. 2022 r_op=.42 transported to PIPE's format per Hoffman 1999; synthetic validity per Johnson & Carter 2010 | Indirect criterion inference | Hoffman 1999; SIOP 2018 |
| **E3 — Criterion-suggestive** | N=300–500 | Interrupted Time Series or Non-Equivalent Groups quasi-experiment on first-90-day performance ratings | Quasi-criterion | Shadish/Cook/Campbell 2002; Conway & Huffcutt 1997 |

**Precondition for any of this is versioning.** The RCD's `validation_metadata` column and the RUC's `rcd_version` + `signals_version` columns are not optional — without them, old cohorts mix silently with new ones after schema evolution and every comparison becomes confounded. **No schema change ships without bumping the version column and recording it in `validation_metadata`.** This is a load-bearing engineering rule, not a nice-to-have.

This resolves **RD-10** coverage (validation methodology) and establishes the versioning discipline needed for every future ADR that touches the RCD or RUC.

---

## Model routing

Per CLAUDE.md AI routing principles and research Q8/Q11:

| Step | Primary model | Provider | Rationale |
|---|---|---|---|
| Role Discovery live interview (turn FSM) | `@cf/google/gemma-4-26b-a4b-it` | Workers AI | Unchanged from existing ADR-027 migration off Mistral. |
| RCD synthesis primary call | `@cf/google/gemma-4-26b-a4b-it` | Workers AI | Real-time hot path; structured JSON output; constrained decoding via `response_format`. |
| RCD synthesis verification pass | Gemma 4 12B | Workers AI | Offline, bulk-eligible, cost-sensitive. |
| BARS override generation (role setup time) | Gemma 4 26B | Vertex AI | Quality-sensitive, offline, recruiter reviews output before persistence. |
| Probe bank enrichment (role setup time) | Gemma 4 26B | Vertex AI | Same reasoning as BARS overrides — offline, recruiter-gated. |
| Crawler Pass 3 (offline per-repo signal summarization) | `gemma-4-26b-a4b-it-maas` | Vertex AI | Offline batch, cost-sensitive, structured JSON output. Same model family as rerank (deviation accepted — see note). |
| Worker runtime role-fit rerank | `@cf/google/gemma-4-26b-a4b-it` | Workers AI | Real-time, per-(role × repo), cached in `repo_role_alignment` after first run per role. |

**Note on model independence:** The original design specified different model families for Pass 3 (signal writer) and runtime rerank to enable independent error detection. The current implementation uses Gemma for both. This deviation is accepted for the initial library build — the priority is getting signals into production so role discovery works. If systematic signal errors are observed, a future iteration can restore model-family independence by swapping Pass 3 to Mistral Devstral or Qwen.

---

## Schema migration plan

A single migration (`0022_role_discovery_data_contract.sql`) adds:

1. Columns on `role_contexts`: `rcd_version`, `rcd_json`, `validation_metadata`, `bars_overrides`
2. New table: `repo_engineering_signals`
3. New table: `repo_role_alignment`
4. New table: `role_probe_bank`

`persona_json` is **not** dropped in this migration. It is demoted to a cached view column written at synthesis time from `rcd_json.consumer_slice`, so legacy consumers continue to function during the cutover. Persona drops in a future migration once every consumer is off it.

---

## Consequences

**Positive:**
- Role Discovery's research-grounded depth is finally preserved through synthesis and readable by every downstream consumer.
- Culture interview (ADR-029), challenge generation (ADR-032, ADR-034), and repo discovery gain team-specific calibration derived from real stakeholder evidence, not 4-keyword regex.
- The 3rd AI pass gap in the repo crawler closes; `matchRepos.ts` becomes a two-stage retriever with per-candidate justification the recruiter can audit.
- Compliance posture materially improves: dealbreaker gates are HITL-only per Griggs/iTutorGroup/Mobley/EU AI Act Art 14; every rejection carries a pre-populated business-necessity defense; BARS anchors and probe banks are versioned and auditable under NYC LL 144.
- Validation methodology has a defensible staged ladder that doesn't require N=200 at the first customer.
- Global Copilot (ADR-035) gains a new tool surface: `explain_repo_for_role` that reads `repo_role_alignment.reasoning_json` and surfaces it in the recruiter drawer.

**Negative / cost:**
- Schema migration on the hottest table in the system (`role_contexts`). Requires a cutover plan that keeps `persona_json` writable for legacy readers.
- Synthesis rewrite changes the hottest prompt in the Role Discovery agent. Regression risk on existing role contexts — old interviews synthesized before the rewrite will still have a flat persona and will need a backfill pass.
- Two new tables (`repo_engineering_signals`, `repo_role_alignment`) plus `role_probe_bank` — three new writable surfaces with their own migration, index, and maintenance cost.
- Crawler Pass 3 runs on Vertex AI Gemma (free tier) — near-zero token cost per library refresh.
- Runtime rerank adds one Gemma 4 call per (role × repo) pair on first access. Subsequent recruits to the same role hit the cache. Expected cost: negligible if cache hits dominate; monitor on the Workers AI daily quota.
- Consumer rewrites span five files (`cultureRoleResolution`, `cultureQuestionBank`, `cultureScorer`, `challengeGeneration/pipeline`, `repoDiscovery/discover`). Sequenced work across two research domains (culture + code review).

**Neutral / deferred:**
- Tier 2 signals (architecture_style, review_density, commit_cadence, satd_density) are designed into the schema but deferred to a second crawler sprint. `repo_engineering_signals` rows ship with NULLs in those columns initially.
- README / diff-level embeddings remain deferred (RD-22) — Pass 3 structured summaries are the MVP path.
- Storing raw PR diffs is out of scope; Pass 3 reasons over `repo_sample_prs` metadata only.
- Pre-computing all (role × repo) alignment pairs is not feasible — role contexts are created on demand and cannot be enumerated. Runtime rerank is lazy per role.

---

## Alternatives considered

- **Keep `CandidatePersona`, enrich downstream consumers to read `knowledge_state` directly.** Rejected — perpetuates the flattening at synthesis; every consumer re-parses JSON; no schema discipline; no versioning story.
- **One-size-fits-all "rich persona".** Rejected — different consumers have genuinely different extraction needs (culture cares about BARS overrides, challenge gen cares about Technical Context, repo search cares about codebase-shape signals). A shared rich object becomes a god-object.
- **Dynamic per-candidate probe generation** (research Q5 counterfactual). Rejected — fails NYC Local Law 144 auditability and EU AI Act Article 14 interpretability. Role-setup-time enrichment is the compliant alternative.
- **Auto-fail dealbreaker gates** (research Q9 counterfactual). Rejected — Griggs/iTutorGroup/EU AI Act Article 14 make this legally indefensible. HITL-only is the compliant alternative.
- **Ideal-culture OCAI framing for candidate screening** (Harver's approach). Rejected — Heritage et al. 2014 report no significant relationship with job satisfaction under that framing. Current-culture framing is the validated alternative and it describes *the team*, not *the candidate*.
- **Single-model routing** (Gemma for everything). Originally rejected for independent-read principle, but **accepted for initial library build** — priority is getting signals into production. May revisit if systematic errors are observed.
- **Runtime-only (Alternative B) reranking.** Rejected per Q11 analysis — token burn, latency, consistency, no caching. Amortization of offline signals across roles is architecturally necessary.
- **Offline-only (Alternative A) summarization.** Rejected per Q11 analysis — role-agnostic summaries cannot reason about role-specific questions (SWE-bench-grounded limit on query-agnostic retrieval).
- **Pre-compute all (role × repo) alignment pairs ahead of time.** Rejected — combinatorial; role contexts are created on demand; cannot be enumerated.
- **Put Pass 3 in the Worker, not the CLI crawler.** Rejected — Pass 3 needs batch economics and fits the existing CLI pipeline. The Worker's per-request model is wrong for bulk enrichment.
- **Embedding-based semantic search over READMEs / diffs.** Deferred to post-MVP. Structured summaries via Pass 3 are the MVP path per research Q6.

---

## Phased rollout

Implementation is sequenced into four phases. Each phase has explicit BDD acceptance tests per the CLAUDE.md development approach. Phases 2 and 3 can run in either order after Phase 1 lands (founder decision — culture-first vs. repo-first).

### Phase 1 — Foundation (schema + synthesis rewrite)

**Goal:** Land the RCD schema and rewrite synthesis so the Role Discovery agent produces RCDs instead of flat personas. Legacy `persona_json` writes as a cached view from `rcd_json.consumer_slice` so nothing breaks.

1. Migration `0022_role_discovery_data_contract.sql` — columns on `role_contexts`, new tables `repo_engineering_signals`, `repo_role_alignment`, `role_probe_bank`.
2. TypeScript types — `RoleContextDocument`, `DomainCell`, `StoryRecord`, `ConflictRecord`, `DealbreakerRecord`, `RepoEngineeringSignals`, `RepoRoleAlignment` in `workers/api/src/types.ts`.
3. Synthesis prompt rewrite — new system prompt with RCD schema, field exemplars, bottom-up ordering rule, five failure modes.
4. Constrained decoding wiring — structured JSON output via `response_format: json_schema` or equivalent.
5. Gemma 4 12B verification pass — new module `workers/api/src/lib/roleAgent/verifyRcd.ts`.
6. `consumer_slice` derivation — writer that takes an RCD and emits the legacy `CandidatePersona` shape for backwards compatibility.
7. BDD: synthesis of a seeded 4-stakeholder interview produces a full RCD with all 6 domains × 4 stakeholders populated and zero unsupported quotes.

**Out of scope for Phase 1:** consumer rewrites, Pass 3, runtime rerank, BARS override generation, probe bank enrichment. Phase 1 is schema + synthesis only.

### Phase 2 — Culture consumer rewrite (RD-9 through RD-16)

**Goal:** Rewire the culture interview to read the RCD's `team_culture_profile`, `bars_overrides`, and `probe_bank_enrichment`.

1. `cultureRoleResolution.ts` — return the full Team Context from RCD instead of 4-keyword regex.
2. `cultureQuestionBank.ts` — `pickNextQuestion` takes team context; reads from `role_probe_bank` joined against `role_contexts`.
3. `cultureScorer.ts` — reads `bars_overrides` and applies per-dimension anchor deltas.
4. BARS override generation step at role setup time (Sonnet 4.6 offline call, recruiter-approved UI).
5. Probe bank enrichment step at role setup time (Sonnet 4.6 offline call, recruiter-approved UI).
6. Dealbreaker HITL gate wiring into the culture scoring output.
7. BDD: a seeded 4-stakeholder interview produces a team profile the culture agent reads, a BARS override recruiter-approved, and a probe bank the question selector pulls from.

### Phase 3 — Code review consumer rewrite (RD-17 through RD-19)

**Goal:** Rewire challenge generation, implementer, and scorer to read the RCD's Technical Context and Dispositional Context.

1. `challengeGeneration/prompts.ts` — read `technical_context` from RCD instead of 5 persona fields.
2. `implementerAgent.ts` — inject role context (codebase expectations, dispositional weights) into the implementer persona YAML resolution.
3. `scorerAgent.ts` — read dispositional context for per-dimension weight adjustments per ADR-032's 6-dimension rubric.
4. BDD: a challenge generated from a seeded RCD references specific Technical Context fields in its prompt, and the scorer applies the RCD-derived weights.

### Phase 4 — Repo understanding (RD-23, RD-24)

**Goal:** Ship the crawler Pass 3 + runtime role-fit rerank end-to-end.

1. `scripts/crawl-repos/pass3/run.ts` — Vertex AI Gemma 4 26B per-repo summarization.
2. `scripts/crawl-repos/pass3/persist.ts` — write `repo_engineering_signals` rows.
3. Cloudflare Queue consumer wiring — trigger Pass 3 when Pass 2 completes for a repo.
4. `workers/api/src/lib/repoDiscovery/roleFitRerank.ts` — Gemma 4 Worker handler reading RCD + signals, writing `repo_role_alignment`.
5. `repoDiscovery/discover.ts` — inject the rerank between `matchRepos` (stage 0) and the final ranked result.
6. `matchRepos.ts` — unchanged query, but return up to 20 candidates for stage-1 consumption.
7. Copilot tool (`workers/api/src/lib/copilot/tools/explainRepoForRole.ts`) — reads `repo_role_alignment.reasoning_json` for the recruiter drawer, per ADR-035 tool protocol.
8. BDD: running discovery on a seeded RCD returns a top-5 with per-candidate justification strings that reference specific RCD Technical Context fields, and a second discovery run hits the cache.

### Cross-cutting — Validation ladder setup

**Goal:** Make the staged validation ladder executable as soon as there's a first customer.

1. `docs/validation/rcd-face-validity.md` — E0 SME review template, CVR scoring protocol, job analysis mapping.
2. `workers/api/src/lib/validation/` — utilities for computing convergent bootstrap metrics at N=30–50.
3. `knowledge/outputs/role-discovery-data-contract.provenance.md` — updated as each validation stage completes.

---

## Related ADRs

- **[ADR-027](ADR-027-role-discovery-agent.md)** — extends. RCD replaces the flat persona this ADR introduced.
- **[ADR-028](ADR-028-multi-stakeholder-role-discovery.md)** — supersedes sections treating `CandidatePersona` as the canonical artifact. Multi-stakeholder flow is preserved; the output shape is upgraded.
- **[ADR-029](ADR-029-culture-interview-agent-architecture.md)** — extends. BARS overrides and probe bank enrichment wire into the FSM + scorer defined there.
- **[ADR-030](ADR-030-culture-profile-operationalization.md)** — extends. The 5-dimension culture profile becomes the team profile in the RCD.
- **[ADR-031](ADR-031-ai-hiring-compliance-architecture.md)** — extends. HITL dealbreaker gates are the consent-gate pattern applied to the scoring surface.
- **[ADR-032](ADR-032-code-review-research-integration.md)** — extends. Dispositional context feeds the 6-dimension scorer's weight adjustments.
- **[ADR-033](ADR-033-research-integration-strategy-and-guardrails.md)** — applies. The drift that motivated this ADR was flagged under the ADR-033 guardrail rule and recorded in the STRATEGY.md Decision Log before research prep began.
- **[ADR-034](ADR-034-challenge-authoring-system.md)** — extends. Challenge generation reads the RCD's Technical Context.
- **[ADR-035](ADR-035-global-copilot-agent.md)** — extends. New copilot tool `explain_repo_for_role` reads `repo_role_alignment.reasoning_json`.

---

## References

**Research:**
- Final brief: `knowledge/outputs/role-discovery-data-contract.md`
- Provenance: `knowledge/outputs/role-discovery-data-contract.provenance.md`
- Verification: `knowledge/outputs/role-discovery-data-contract-verification.md`
- Research plan: `knowledge/outputs/.plans/role-discovery-data-contract.md`
- Research files: `knowledge/outputs/role-discovery-data-contract-research-methodology.md` (R1, 18 sources), `-research-culture.md` (R2, 24), `-research-codereview.md` (R3, 25), `-research-validation.md` (R4, 17)

**Canonical sources (anchors for load-bearing claims):**
- Ritchie & Spencer (1994). *Qualitative Data Analysis for Applied Policy Research.* — framework analysis matrix
- Smith, Flowers & Larkin (2009). *Interpretative Phenomenological Analysis.* — evidence-anchor pattern
- Charmaz (2014). *Constructing Grounded Theory.* — three-tier coding
- Reynolds & Gutman (1988). *Laddering Theory, Method, Analysis, and Interpretation.* — Means-End Chain
- Cameron & Quinn (2006). *Diagnosing and Changing Organizational Culture.* — OCAI / CVF
- Heritage et al. (2014). *Validation of the Organizational Culture Assessment Instrument.* PLOS ONE. — OCAI Cronbach's α range .69–.83, Current-culture framing validity
- Edmondson (1999). *Psychological Safety and Learning Behavior in Work Teams.* — fifth culture signal
- Smith & Kendall (1963); Campion et al. (1997); Kell et al. (2017, ETS RR-17-28) — BARS foundations
- Sackett et al. (2022). *Revisiting Meta-Analytic Estimates of Validity.* — r_op=.42 for structured interviews, transportability anchor
- Hoffman (1999) — synthetic validity / transportability methodology
- Conway & Huffcutt (1997) — supervisor-peer ρ=.34, 89% source-unique variance
- Griggs v. Duke Power Co., 401 U.S. 424 (1971)
- Uniform Guidelines on Employee Selection Procedures, 29 CFR Part 1607
- EEOC v. iTutorGroup (2023) — $365,000 settlement, 200+ affected applicants
- Mobley v. Workday (2025) — conditionally certified ADEA class action (in active litigation as of 2026-04-10)
- EU AI Act, Annex III / Article 14 (applicable 2 August 2026)
- NYC Local Law 144 (Automated Employment Decision Tools)
- ColBERT: Khattab & Zaharia (2020) — offline/online retrieval split
- AIF: Asynchronous Inference Framework — decoupled preranking
- SWE-bench: Jimenez et al. (2024) — query-agnostic retrieval limits

**Implementation anchors (current state):**
- `migration/dersign-thinking.md` Part 8 — Knowledge State specification
- `workers/api/src/types.ts:223` — current `CandidatePersona`
- `workers/api/src/lib/roleAgentPrompts.ts` — current synthesis prompt
- `workers/api/src/lib/cultureRoleResolution.ts` — current 4-keyword regex
- `workers/api/src/lib/challengeGeneration/prompts.ts` — current 5-field persona read
- `workers/api/src/lib/repoDiscovery/matchRepos.ts` — current SQL CTE join
- `workers/api/scripts/crawl-repos/` — existing Pass 1 + Pass 2

**STRATEGY.md findings:** RD-1 through RD-24.
