> **STATUS: DRAFT** · Created 2026-04-22
> **Research run:** `embedding-validation`
> **Scope:** How to validate that BGE-large-en-v1.5 embeddings correctly discriminate candidate→repo→role fit in PIPE's triangulation pipeline.
> **Out of scope:** Model selection (BGE vs. E5 vs. OpenAI), fine-tuning strategy, multi-modal resume parsing.
> **Navigate:** [INDEX](../INDEX.md)

---

# Validating Embedding-Based Triangulation for Candidate-Repo-Role Matching

**Synthesis of architecture review, synthetic test design, and production risk analysis** · 2026-04-22

> This document answers the question: "We have BGE embeddings and a weighted combinator. How do we know it isn't guessing?"

---

## Executive summary

PIPE's triangulation pipeline (`triangulateMatch`) blends four signals: `role_repo_alignment`, `candidate_repo_fit`, `role_candidate_cosine`, and `skill_coverage`. The embedding signal (`role_candidate_cosine`) was unblocked in April 2026 by the dual-layer architecture (D1 ground-truth vectors + Vectorize ANN). **But the weights are uncalibrated hypotheses, and the embedding model's error rate for recruiting-specific matching is unknown.**

BGE-large-en-v1.5 is a strong general-purpose bi-encoder trained on MSMARCO and similar semantic-similarity corpora. It reliably captures **domain/topic similarity** (React fintech candidate ↔ React fintech role) but cannot encode **fine-grained skill presence** (GraphQL mentioned vs. Apollo Client only), **situational fit** (company stage, challenge type), or **quality ranking** (candidate #3 vs. #4 may differ by 0.02 — noise, not signal).

The research converges on a **two-phase validation protocol**:

1. **Synthetic sniff test (2 hours, zero real data)** — Controlled fixtures with known properties. If "React fintech senior" does not score highest on "React fintech repo," the vector space is broken before any real resume is touched.
2. **Recruiter feedback calibration (ongoing, N=100 minimum)** — Treat recruiter thumbs-up/thumbs-down on matches as ground-truth labels. Regress weights quarterly against the label distribution.

Three red flags must be monitored from day one:

- **Dynamic range collapse:** If same-domain and cross-domain pairs differ by <0.05 cosine, the signal is too noisy to use in the combinator.
- **Prefix sensitivity:** BGE-large-en-v1.5 uses asymmetric indexing (query prefix for search, no prefix for documents). PIPE currently treats role/candidate/repo all as "documents" (no prefix). If we later add a query-side prefix for search, the vector space splits unless all entities are re-indexed consistently.
- **Sparse profile penalty:** Candidates with short GitHub bios or sparse resumes occupy a different region of the vector space than candidates with dense `repo_searchable_profile` synthesis. This is a distributional shift, not a bug — but it means scores are not comparable across candidate types.

**The plumbing is right. The weights are guesses. The validation is missing. Both gaps are fixable with the protocol below.**

---

## Part 1 — What BGE embeddings can and cannot do for recruiting

### 1.1 What BGE-large-en-v1.5 was trained for

BGE (BAAI General Embedding) models are bi-encoders trained with a contrastive objective on billions of text pairs. The training corpus includes:
- MSMARCO (passage retrieval: query → relevant passage)
- NQ (Natural Questions)
- Various synthetic contrastive pairs from large language models

The optimization target is **semantic relevance**: given a query, rank passages that are topically and semantically related. This is not the same as **skill matching** or **job fit**.

**What this means for PIPE:**
- A candidate profile that says "built payment flows at fintech startup using React" will embed near a role that says "Senior Frontend Engineer — fintech, React, payment systems." The model has seen millions of similar pairs during training.
- The same candidate will embed *far* from "Junior Python data analyst, pandas, matplotlib." Domain and topic are strongly encoded.
- But if the candidate says "Apollo Client" and the role says "GraphQL," the match is **uncertain.** The model may or may not know Apollo Client → GraphQL. It was not trained on a tech-stack taxonomy.

### 1.2 The four capability boundaries

| Capability | Will BGE do it? | Evidence / reasoning |
|---|---|---|
| **Domain/topic discrimination** | **Yes.** Strong signal for broad domains (frontend, backend, ML, DevOps). | Training on MSMARCO etc. optimizes for topical relevance. Empirical: BGE-large is SOTA or near-SOTA on BEIR retrieval benchmarks. |
| **Fine-grained skill matching** | **Maybe.** Depends on whether skill names co-occur frequently in training data. | No explicit skill taxonomy in training. "React" and "TypeScript" co-occur often → strong link. "Apollo Client" and "GraphQL" co-occur less → weaker link. |
| **Situational fit** (company stage, team topology, growth trajectory) | **No.** These are not semantic properties encoded in the vector space. | BGE encodes *what* text is about, not *how* someone works. A candidate who "thrived in zero-to-one fintech" and one who "maintained legacy bank infrastructure" may embed similarly if both mention "fintech" and "React." |
| **Quality ranking** (candidate A is better than candidate B) | **Dangerous.** Small cosine differences (<0.05) are typically noise. | Bi-encoders produce relative rankings, not absolute quality scores. The difference between 0.72 and 0.74 is not statistically meaningful without calibration data. |

### 1.3 The sparse-profile problem

PIPE's candidate ingestion produces two text variants:
- **Raw GitHub bio / resume text** — often 50–200 words, sparse.
- **`repo_searchable_profile`** — a dense, structured synthesis (400–600 words) produced by the Candidate Discovery agent.

These two variants can produce **different embedding directions** for the same candidate. The dense synthesis usually embeds "better" (more context for the model to attend to), but it also means:
- A candidate scored via raw bio is not comparable to a candidate scored via synthesized profile.
- The vector space has a **bimodal distribution**: sparse profiles cluster tightly near the origin (shorter texts produce smaller-magnitude vectors), dense profiles spread further out.

**Implication:** Never compare `role_candidate_cosine` across candidates who were embedded from different text sources. PIPE is standardizing on `repo_searchable_profile` for all candidates — this is correct, but the backfill of existing candidates must be re-embedded.

### 1.4 The query-prefix asymmetry trap

BGE-large-en-v1.5 has an asymmetric convention:
- **Document side** (what gets indexed): plain text, no prefix.
- **Query side** (what searches the index): prefix with `Represent this sentence for searching relevant passages: `

PIPE currently embeds roles, candidates, and repos all as **documents** (no prefix). This is correct for the Vectorize ANN indices, because all three are "documents" in a shared space.

But if PIPE later adds a **text query search** (recruiter types "Find me a React engineer" and we embed that as a query vector), the prefix must be applied. **If any existing document-side vectors are accidentally prefixed, the shared space breaks.** All three entity types must use the exact same preprocessing pipeline.

**Guardrail:** The embedding function (`embedAndUpsertCandidate`, `buildAndStoreRoleEmbedding`, `vectorizeAndMark`) must share a single `preprocessForEmbedding` utility that applies the prefix only when explicitly told `side: 'query'`. Default is `side: 'document'`.

---

## Part 2 — The synthetic sniff test (controlled fixtures)

### 2.1 Why synthetic first

Real candidate data is noisy, sparse, and unlabeled. A synthetic audit with **known properties** tells you whether the vector space is structurally sound before you waste time arguing about whether a particular real candidate is a "good" match.

If "React fintech senior" does not score highest on "React fintech repo," the embedding space is broken — no amount of real data will fix it.

### 2.2 Fixture design

Create **5 candidates**, **5 repos**, and **3 roles** with deliberately orthogonal properties:

**Candidates:**
| ID | Domain | Stack | Seniority | Situational notes |
|---|---|---|---|---|
| C1 | Fintech | React, TypeScript, payment flows | Senior | Zero-to-one startup experience |
| C2 | Fintech | React, TypeScript, design systems | Senior | Mature B2C feature factory |
| C3 | ML/AI | Python, PyTorch, LLM fine-tuning | Staff | Research-heavy, papers published |
| C4 | DevOps/Platform | Terraform, K8s, AWS | Junior | Small team, limited scope |
| C5 | Mobile | Swift, iOS, HealthKit | Senior | Health tech, regulated environment |

**Repos:**
| ID | Domain | Stack | Complexity |
|---|---|---|---|
| R1 | Fintech | React payment UI, TypeScript, Prisma | Mid (15k SLOC) |
| R2 | ML/AI | Python training pipeline, PyTorch, wandb | Senior (50k SLOC) |
| R3 | DevOps | Terraform modules, K8s manifests, Helm | Junior (3k SLOC) |
| R4 | E-commerce | Generic React/Node shop, no specialization | Mid (20k SLOC) |
| R5 | Health | Swift health app, HealthKit, CoreData | Senior (40k SLOC) |

**Roles:**
| ID | Description |
|---|---|
| L1 | Senior Frontend Engineer — fintech, React/TypeScript, payment systems |
| L2 | Staff ML Engineer — PyTorch, LLM fine-tuning, production ML pipelines |
| L3 | Platform Engineer — Terraform, K8s, AWS infrastructure |

### 2.3 Expected behavior (the "sniff test")

For each candidate, compute `role_candidate_cosine` against each role, and `candidate_repo_cosine` against each repo. The ranking should obey these rules:

| Pair | Expected rank | Why |
|---|---|---|
| C1 ↔ L1 | **Top** | Exact domain + stack match |
| C1 ↔ R1 | **Top** | Exact domain + stack match |
| C3 ↔ L2 | **Top** | Exact domain + stack match |
| C3 ↔ R2 | **Top** | Exact domain + stack match |
| C5 ↔ R5 | **Top** | Exact domain + stack match |
| C1 ↔ L2 | **Bottom** | Frontend vs. ML — orthogonal domains |
| C3 ↔ R1 | **Bottom** | ML vs. frontend — orthogonal domains |
| C4 ↔ R4 | **Bottom** | DevOps vs. generic e-commerce |
| C1 ↔ C2 | **High similarity** | Same domain + stack, different situational details |
| C1 ↔ R4 | **Mid** | Same stack (React), different domain (fintech vs. generic e-commerce) |

**Inversions to flag:**
- C1 scores higher on R5 (Swift health) than on R1 (React fintech) → **BROKEN**
- C3 scores higher on R1 than on R2 → **BROKEN**
- C4 scores higher on R2 than on R3 → **BROKEN**

### 2.4 Running the test

**Option A — Local Xenova (self-contained, slower):**
Use `@xenova/transformers` with `Xenova/bge-large-en-v1.5` to embed all fixtures locally. No API calls, runs offline on Mac. ~2–5 seconds per embedding on M-series CPU.

**Option B — Cloudflare Workers AI (fast, production-identical):**
Call `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/baai/bge-large-en-v1.5`. Returns the exact same model used in production. Fast but requires API token.

**Script output format:**
```
Candidate-Repo Matrix (cosine similarity):
        R1     R2     R3     R4     R5
C1     0.82   0.31   0.28   0.61   0.22
C2     0.79   0.33   0.27   0.59   0.21
C3     0.29   0.85   0.35   0.30   0.25
C4     0.25   0.34   0.78   0.32   0.27
C5     0.24   0.26   0.29   0.28   0.81

Inversions detected: 0/20
Dynamic range (max - min per row): 0.54, 0.58, 0.50, 0.51, 0.57
Signal quality: STRONG (all > 0.40)
```

### 2.5 Interpreting results

| Dynamic range (max - min per row) | Verdict |
|---|---|
| > 0.40 | Strong signal. Embeddings are discriminating. Proceed to real-data validation. |
| 0.20 – 0.40 | Weak signal. Same-domain vs. cross-domain pairs are separable but noisy. Consider adding domain keywords to `repo_searchable_profile` or switching to a larger model (BGE-m3). |
| < 0.20 | Broken. The vector space is not discriminating. Debug: wrong model? Wrong prefix? Wrong text preprocessing? |

| Inversion count (out of 20 same-domain vs. cross-domain pairs) | Verdict |
|---|---|
| 0 | Perfect. Rare, but possible. |
| 1–2 | Acceptable. The signal is real but noisy. |
| 3–5 | Concerning. The embedding space may have unexpected structure (e.g., "senior" and "staff" keywords dominate over domain). |
| > 5 | Broken. Do not use for ranking. |

---

## Part 3 — Real-world validation via recruiter feedback

### 3.1 The criterion problem

There is no published study that validates embedding-based candidate ranking against on-the-job software engineer performance. The closest analogues are:
- LinkedIn's two-tower BERT for job recommendation (optimized for apply-rate, not hire-quality).
- Indeed / ZipRecruiter matching (proprietary, no public validation data).
- Academic work on resume-job matching (typically small corpora, JD-candidate pairs, not repo-mediated triangulation).

**PIPE cannot solve the criterion problem at launch.** But it can solve a weaker, actionable version: **do recruiter judgments correlate with the triangulated score?**

### 3.2 `match_feedback` as ground truth

ADR-040 introduced the `match_feedback` table:
- `feedback_type`: `thumbs_up | thumbs_down | override`
- `override_repo_id`: recruiter's manual pick if they disagree
- `notes`: free-text reason

This is the cheapest, highest-fidelity label available. A thumbs-down on a match with `triangulated_score = 0.91` is a strong signal that the weights are wrong for that (role, candidate) pair.

### 3.3 Calibration protocol

**Phase 1 — Baseline (weeks 1–4, N=50–100 matches with feedback):**
1. Run the pipeline with the current `hybrid` preset (0.25 / 0.35 / 0.20 / 0.20).
2. Show recruiters the match + reasoning fold-out. Ask for thumbs-up/down.
3. Compute: **what fraction of thumbs-up matches have `triangulated_score > 0.70`? What fraction of thumbs-down matches have `triangulated_score > 0.70`?**
4. If the false-positive rate (thumbs-down but score > 0.70) is >30%, the weights are miscalibrated.

**Phase 2 — Weight regression (month 2–3, N=200+):**
1. Treat `thumbs_up = 1`, `thumbs_down = 0` as binary labels.
2. Grid-search or logistic-regress the four weights to maximize AUC-ROC on the labeled set.
3. Constrain: `w_role_repo + w_candidate + w_cosine + w_skills = 1.0`, all ≥ 0.
4. Produce a new preset (e.g., `hybrid-v2`) and A/B test against `hybrid`.

**Phase 3 — Quarterly recalibration (ongoing):**
1. Re-run regression on the trailing 90 days of feedback.
2. Flag weight drift >0.05 as a signal that the candidate population or role mix has shifted.

### 3.4 Minimum viable sample sizes

| Goal | Minimum N | Why |
|---|---|---|
| Detect if weights are directionally wrong | 30 | Law of large numbers kicks in for binary proportions. |
| Recalibrate weights with confidence | 100 | Logistic regression with 4 features needs ~25 samples per feature. |
| Validate a new preset vs. old | 200 | A/B test with 80% power at 5% significance for a 10% lift in thumbs-up rate. |
| Subgroup analysis (per role domain) | 500+ | Per-domain weight tuning requires enough samples per domain. |

---

## Part 4 — Metrics, thresholds, and red flags

### 4.1 Metrics to track

| Metric | How to compute | Target | What it tells you |
|---|---|---|---|
| **Dynamic range** | `max(cosine) - min(cosine)` per query | > 0.40 | Whether the embedding space discriminates at all. |
| **Inversion rate** | Count of cross-domain pairs outranking same-domain pairs | < 10% | Whether domain is the primary axis of variation. |
| **Recruiter precision@k** | Fraction of top-k matches that get thumbs-up | > 70% at k=5 | Whether the combinator ranks "good" matches at the top. |
| **Recruiler recall@k** | Fraction of all thumbs-up matches that appear in top-k | > 60% at k=10 | Whether good matches aren't buried. |
| **Score-discordance rate** | Fraction of thumbs-down matches with score > 0.70 | < 30% | Whether high scores mean high quality. |
| **Embedding-drift score** | Cosine between old and new embeddings of the same text (sample monthly) | > 0.99 | Whether model updates or prefix changes have shifted the vector space. |

### 4.2 Thresholds for the combinator

The `triangulated_band` field (`strong | moderate | weak | mismatch`) needs empirically validated thresholds. Until calibration data exists, use these conservative defaults:

| Band | Score range | Interpretation |
|---|---|---|
| `strong` | ≥ 0.75 | All four signals agree. Safe to surface without review. |
| `moderate` | 0.55 – 0.74 | Most signals align. Surface with reasoning fold-out; recruiter reviews. |
| `weak` | 0.35 – 0.54 | Mixed signals. Do not auto-surface; manual review only. |
| `mismatch` | < 0.35 | Signals disagree or are absent. Hide from recruiter. |

**These are starting hypotheses.** They must be replaced with empirical cutoffs derived from the recruiter feedback distribution within 60 days of launch.

### 4.3 Red flags that require immediate action

| Red flag | What to check | Action |
|---|---|---|
| **Dynamic range < 0.20** | Are all embeddings near-identical? | Check for duplicate text, empty profiles, or wrong model. Re-embed with longer, more diverse text. |
| **Inversion rate > 25%** | Is seniority swamping domain? | Inspect the text being embedded. If "senior" and "staff" appear in every profile, the model may be ranking by seniority keyword frequency. Add more domain-specific content. |
| **Score-discordance > 40%** | Are high scores consistently wrong? | The weights are miscalibrated. Run emergency weight regression on all feedback. |
| **Embedding-drift < 0.95** | Did the model or prefix change? | Freeze the model version. Re-embed all entities if the vector space has shifted. |
| **Recruiter override rate > 30%** | Are recruiters consistently picking different repos? | The repo matching signal is broken. Check `role_repo_alignment` and `candidate_repo_fit` distributions separately. |

### 4.4 What NOT to measure

| Bad metric | Why it's misleading |
|---|---|
| **Mean cosine** | A mean of 0.65 tells you nothing about whether the ranking is correct. |
| **Cosine vs. human rating correlation (Pearson r)** | Cosine is not interval-scaled. A 0.72 vs. 0.74 difference is not twice as meaningful as 0.62 vs. 64. Use rank correlation (Kendall's τ) instead. |
| **Accuracy** | There is no binary "correct" label for a match. Precision@k and AUC are the right tools. |
| **Embedding reconstruction loss** | This measures autoencoder quality, not retrieval quality. Irrelevant for bi-encoders. |

---

## Direct Implications for PIPE

1. **Run the synthetic sniff test before accepting any real candidate.** It takes 2 hours and catches vector-space breakage before it touches user data. Add it to the pre-launch checklist.

2. **Standardize on `repo_searchable_profile` as the single source of truth for candidate embedding text.** Mixed text sources (raw bio vs. synthesized profile) create a bimodal distribution that makes scores incomparable.

3. **Lock the embedding preprocessing pipeline.** One shared `preprocessForEmbedding` function. Default `side: 'document'`. Query prefix applied only for explicit text queries. Document the convention in ADR-040.

4. **Treat `match_feedback` as the primary validation instrument.** The table exists but is worthless without recruiter engagement. Add a UI nudge ("Was this match helpful? 👍 👎") to every match card. Without labels, weight calibration is impossible.

5. **Replace the band thresholds with empirical cutoffs within 60 days.** The current 0.75/0.55/0.35 cutoffs are guesses. Compute the score distributions for thumbs-up vs. thumbs-down matches and set cutoffs at the intersection points.

6. **Add embedding-drift monitoring.** Monthly sample: re-embed 10 historical profiles. If cosine(old, new) < 0.99, alert. This catches model version changes, prefix accidents, and preprocessing drift.

---

## Open Questions / Gaps

1. **BGE vs. BGE-M3 for recruiting.** BGE-M3 supports multi-linguality and longer contexts (8192 tokens), but its English-only performance is slightly worse than BGE-large on BEIR. For PIPE's primarily English corpus, is the longer context worth the accuracy trade-off? Untested.

2. **Fine-tuning feasibility.** If the synthetic sniff test shows weak signal, fine-tuning BGE on a small labeled corpus (even N=50 recruiter-labeled pairs) can improve discrimination by 10–20%. But fine-tuning requires ML infrastructure PIPE does not yet have. Deferred until N=500 feedback labels.

3. **Multi-lingual candidate profiles.** If a candidate's resume is in Spanish and the role description is in English, BGE-large may still align them (it has some cross-lingual capability from MS MARCO training), but BGE-M3 would be significantly better. PIPE's current pipeline assumes English. Multi-lingual support is unscoped.

4. **The role-repo embedding signal.** `role_repo_alignment` is computed by `roleFitRerank` (LLM-based), not embedding-based. Should role-repo also have an embedding cosine signal? A separate research brief on dual embedding spaces (role-repo vs. role-candidate) may be needed.

5. **Real-time embedding update latency.** When a recruiter edits a role description, `role_contexts.embedding_json` is stale until re-embedded. How stale is acceptable? The current best-effort fire-and-forget model means updates are asynchronous. No SLA is defined.

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| E1 | BGE-large-en-v1.5 is trained on MSMARCO, NQ, and synthetic contrastive pairs for semantic relevance | BAAI / Hugging Face model card | 2024 | Vendor documentation | Strong |
| E2 | BGE-large is SOTA or near-SOTA on BEIR retrieval benchmarks | BEIR leaderboard (public) | 2024 | Public benchmark | Strong |
| E3 | Bi-encoders encode topical/domain similarity well but struggle with fine-grained taxonomy relations (e.g., Apollo Client → GraphQL) | General IR literature; no direct study on this pair | — | Inference from architecture | Moderate |
| E4 | Small cosine differences (<0.05) in bi-encoder spaces are typically noise, not signal | Standard IR practice; see BEIR evaluation protocols | — | Industry standard | Strong |
| E5 | LinkedIn's two-tower BERT optimizes for apply-rate, not hire-quality | LinkedIn Engineering blog | 2023 | Engineering blog | Strong |
| E6 | Logistic regression for weight calibration needs ~25 samples per feature | Statistical power heuristics (rule of thumb) | — | Statistical practice | Moderate |
| E7 | BGE-large uses asymmetric query/document prefixing; documents get no prefix, queries get "Represent this sentence..." | BAAI model card, official examples | 2024 | Vendor documentation | Strong |
| E8 | Fine-tuning BGE on small labeled corpora (N=50–200) can improve task-specific discrimination by 10–20% | General embedding fine-tuning literature | — | Inference from architecture | Moderate |
| E9 | BGE-M3 supports 8192-token contexts and 100+ languages but underperforms BGE-large on English-only BEIR | BGE-M3 paper / model card | 2024 | Vendor documentation | Strong |

---

## Sources

1. [BAAI General Embedding (BGE) — Hugging Face model card](https://huggingface.co/BAAI/bge-large-en-v1.5) — Vendor documentation, 2024.
2. [BEIR Benchmark Leaderboard](https://eval.ai/web/challenges/challenge-page/1897/leaderboard) — Public benchmark, 2024.
3. [LinkedIn: Building and Deploying LLMs for Skills Extraction at Scale](https://www.zenml.io/llmops-database/building-and-deploying-large-language-models-for-skills-extraction-at-scale) — Engineering blog, 2023.
4. [BGE-M3: Multi-lingual, Multi-functionality, Multi-granularity text embeddings](https://arxiv.org/abs/2402.03216) — Peer-reviewed paper, 2024.
5. [PIPE ADR-040: Meaning-Based Candidate-Repo-Role Triangulation](../docs/decisions/current/ADR-040-meaning-based-triangulation.md) — Internal ADR, 2026-04-22.
6. [PIPE Dual-Layer Embedding Handoff](../knowledge/outputs/.plans/dual-layer-embedding-handoff.md) — Internal handoff, 2026-04-22.
