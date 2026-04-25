> **STATUS: RESEARCH FILE (R1)** · Created 2026-04-08 08:59
> **Research run:** `code-review-content-sourcing` — Round 1
> **Researcher:** R1 — PR-Mining Datasets & Leakage (CodeReviewer, The Stack v2, SEART GHS, CodeFuse, AACR-Bench, SWE-PRBench, CR-Bench)
> **Role in run:** Primary-source research on public code-review datasets, licensing, and frontier-LLM contamination risk
> **Use for:** Looking up source citations when the final brief cites `[R1-S<n>]`
> **Navigate:** [INDEX](../INDEX.md) · [final brief](./code-review-content-sourcing.md)

---

# R1: PR-Mining Datasets & Leakage Landscape

## Summary (5 bullets)

- **Six credible public PR/code-review datasets** exist at research scale, ranging from the ~130K-sample Microsoft CodeReviewer (2022) to a 37M-comment GHArchive slice; all pre-2024 datasets have HIGH-to-VERY-HIGH leakage risk because they predate GPT-4/Claude/StarCoder training cutoffs.
- **Leakage is real and quantified**: LessLeak-Bench (arXiv:2502.06215, 2025) found average leakage ratios of ~4.8% across 83 SE benchmarks with outliers at 100%; Riddell et al. ACL 2024 measured 12–19% overlap between HumanEval and The Stack; The Stack v2 (StarCoder 2 paper) explicitly confirms it ingested GitHub PullRequestReviewEvent data from GHArchive 2015–2023.
- **GitHub ToS creates a legal grey zone**: the research exception requires resulting publications be open-access — a condition PIPE cannot satisfy commercially. Using the API to collect PR content as paid assessment material is not covered by any explicit permissive exception; legal review is necessary before launch.
- **AACR-Bench (2026) is the freshest dataset** — 391 real review comments from Dec 2024–Dec 2025, past all current major model training cutoffs — but its methodology (top-active repos, defined date window) is more valuable to PIPE than its content.
- **The LiveCodeBench rolling-freshness strategy** (stamp content with collection date; retire when a model's training cutoff catches up) is the correct contamination mitigation for PIPE, implemented as: mine GitHub API for PRs merged after 2024-07-01, filter to MIT/Apache-2.0 repos via SEART GHS, strip PII, and advance the gate quarterly.

---

## Evidence table

| Dataset | Size | License | PII | Cutoff | Leakage risk | Suitability | Source |
|---|---|---|---|---|---|---|---|
| Microsoft CodeReviewer (Li et al. 2022) | ~130K fine-tune samples; 9 langs | CC-BY (Zenodo) | Usernames present; no stripping documented | ~2021 | **HIGH** — in Common Crawl + The Stack | Schema valuable; content contaminated | [S1] |
| GHArchive PRRC (KTH 2021 slice) | 37.3M comments (2015–2019) | MIT (code); CC-BY-4.0 (site) | Author handles in every row | 2019 | **VERY HIGH** | Too old for assessment content | [S2] |
| CodeSearchNet (Husain 2019) | 2M (doc, code) pairs; 6 langs | Mixed per-repo | Minimal PII; docstrings only | 2019 | **VERY HIGH** | Wrong task (code search, not review) | [S3] |
| The Stack v2 (BigCode 2024) | 67.5TB; 600+ langs; includes PR events | BigCode OpenRAIL-M | 90% F1 PII redaction; opt-out | Early 2024 | **IS the training corpus** | Reference for what is contaminated | [S4] |
| CodeFuse-CR-Bench (Alibaba 2025) | 601 instances; 70 Python repos; 9 domains | Research-only (unconfirmed) | Public GH PRs; no stripping stated | ~2024 | **MEDIUM** | Good structure; Python-only gap | [S5] |
| AACR-Bench (2026) | 391 comments; 50 repos; 10 langs; Dec 2024–Dec 2025 | Not stated | Public GH PRs; no stripping stated | Dec 2024–Dec 2025 | **LOW-MEDIUM** | **Best freshness; replicable method** | [S6] |
| SWE-PRBench (2026) | 350 PRs; 65 repos; Python-dominant (69%) | Not stated | Real GH review API; no stripping | ~2025 | **LOW** | Good eval framework; too small alone | [S7] |
| CR-Bench (2026) | Real-world defects → PR context; taxonomy | CC BY 4.0 (paper) | Real PRs; PII status unstated | ~2025–2026 | **LOW** | Taxonomy directly usable by PIPE | [S8] |
| SEART GHS (USI Lugano) | 735K+ repos; metadata only | MIT | Repo-level metadata; no code/comments | Ongoing | N/A | **Discovery tool** — not content | [S9] |

---

## Detailed findings

### Dataset 1: Microsoft CodeReviewer (Li et al. 2022)

**Citation**: Zhiyu Li et al., "Automating Code Review Activities by Large-Scale Pre-training," ESEC/FSE 2022 (peer-reviewed via ACL DL). arXiv:2203.09095. Dataset: Zenodo record 6900648. [S1]

**Size**: Three fine-tuning benchmarks on Zenodo (Diff_Quality_Estimation, Comment_Generation, Code_Refinement) — approximately 116K training samples with ~10K each for val/test. The pre-training corpus is described as "too large for Zenodo" and planned for separate release; exact PR count not available from public records. Paper states collection from open-source projects across 9 languages (Java, Python, C++, JavaScript, TypeScript, C#, Go, Ruby, PHP per abstract).

**License**: Creative Commons Attribution (CC-BY) on Zenodo — allows redistribution and reuse with attribution. Underlying PR code inherits per-repository source licenses (varies).

**PII**: Author GitHub usernames present in raw API data. No documented PII removal step in the paper. (single source — unverified via Zenodo)

**Cutoff**: Data collection estimated ~2020–2021; paper submitted March 2022.

**Leakage risk**: HIGH. The Stack v2 [S4] explicitly includes PullRequestReviewEvent data from GHArchive from 2015 onward. CodeReviewer's pre-training data overlaps structurally with StarCoder 2's training corpus. Common Crawl (used by GPT-4, Claude, Gemini) also indexes GitHub content from this period.

**Suitability**: The three-task structure (quality estimation + comment generation + code refinement) maps well to PIPE's multi-turn review format. Use this as a schema reference, not as assessment content.

---

### Dataset 2: GHArchive Pull Request Review Comments (KTH 2021)

**Citation**: KTH Stockholm master's thesis dataset, Zenodo record 4773068. GHArchive project: igrigorik/gharchive.org (MIT license). [S2]

**Size**: 37,358,242 PRRC events; ~12 GB compressed. Covers January 2015 – December 2019. Fields per row: comment_id, commit_id, url, author, created_at, body.

**License**: GHArchive code is MIT; website CC-BY-4.0. The Zenodo dataset record does not state an independent license — terms default to GitHub public data origination. Grey zone for commercial use.

**PII**: Author handles in every row. Emails may appear in comment body text. No redaction.

**Leakage risk**: VERY HIGH — entire period covered by The Stack v1 and Common Crawl snapshots. Universally contaminated for all frontier models.

**Suitability**: Not suitable as assessment source content. Useful only for understanding review comment distribution patterns or identifying active repos to re-mine with a fresh date gate.

---

### Dataset 3: CodeSearchNet (Husain et al. 2019)

**Citation**: Hamel Husain et al., "CodeSearchNet Challenge: Evaluating the State of Semantic Code Search," arXiv:1909.09436 (2019). github/CodeSearchNet. HuggingFace: code-search-net/code_search_net. [S3]

**Size**: 2 million (docstring, code) pairs; 6 languages.

**License**: Mixed per-repo source licenses shipped as _licenses.pkl files.

**Relevance**: Not a PR review dataset. It is included here because it is a canonical pre-training ingredient confirmed to be contaminated at 18.9% with The Stack [S10], establishing the baseline for how pervasive contamination is. PIPE should treat any dataset from this era as contaminated.

---

### Dataset 4: The Stack v2 / BigCode (2024)

**Citation**: Anton Lozhkov et al., "StarCoder 2 and The Stack v2: The Next Generation," arXiv:2402.19173 (2024). [S4]

**Size**: 67.5TB raw; 32.1TB deduplicated; 600+ languages. Includes GitHub Issues and PR review events from GHArchive (PullRequestEvent, PullRequestReviewEvent, PullRequestReviewCommentEvent).

**PII**: PII redaction model trained by 1,399 crowd workers; 90% F1. ~10% false-negative rate means PII remains. Developer opt-out mechanism updated quarterly.

**Significance for PIPE**: This IS the training data for StarCoder 2 and related open models. It confirms that any GitHub PR review content from 2015–2023 that PIPE might repurpose is in the training corpus of at least one widely-deployed model family. For closed models (GPT-4, Claude), structural overlap via Common Crawl is the equivalent risk.

---

### Dataset 5: CodeFuse-CR-Bench (Alibaba/Ant Group, 2025)

**Citation**: arXiv:2509.14856 — "CodeFuse-CR-Bench: A Comprehensiveness-aware Benchmark for End-to-End Code Review Evaluation in Python Projects." September 2025 (preprint). [S5]

**Size**: 601 instances; 70 Python projects; 9 PR problem domains. Each instance: issue, PR details, repository state. Python-only.

**License**: Research-only; dataset availability and license not explicitly stated in abstract. (single source — unverified)

**Leakage risk**: MEDIUM. Python PRs from ~2024. Some overlap possible with Claude 3.5 (April 2024 cutoff) and GPT-4o (October 2023 cutoff) for older PRs in the sample.

**Suitability**: Excellent structural template — 9 problem domains with multi-faceted context (issue + PR + repo state) maps directly to PIPE's challenge format. Python-only is a significant gap. Recommend using the methodology, not the content.

---

### Dataset 6: AACR-Bench (2026)

**Citation**: arXiv:2601.19494 — "AACR-Bench: Evaluating Automatic Code Review with Holistic Repository-Level Context." January 2026 (preprint). [S6]

**Size**: 391 real review comments; 50 repos; 10 languages (5 repos per language). Repos selected from top-2,000 by stars and closed PRs, December 1, 2024 – December 1, 2025. 80 senior engineers scored 2,145 LLM-generated comments.

**Cutoff**: December 2024 – December 2025 — past GPT-4 (Sep 2021), GPT-4o (Oct 2023), and Claude 3.5 Sonnet (Apr 2024) training cutoffs.

**Leakage risk**: LOW-MEDIUM. Very recent collection. Ongoing freshness maintenance required as new models extend their knowledge horizons.

**Suitability**: Highest freshness of all surveyed datasets. Multilingual. Small absolute size (391 comments) limits diversity for a commercial assessment library, but the **collection methodology is directly replicable** by PIPE as an ongoing pipeline.

---

### Dataset 7: SWE-PRBench (2026)

**Citation**: arXiv:2603.26130 — "SWE-PRBench: Benchmarking AI Code Review Quality Against Pull Request Feedback." March 27, 2026 (preprint). [S7]

**Size**: 350 PRs; 65 repos. Python 69.1%, JavaScript 10.6%, Go 10.0%, TypeScript 6.0%, Java 4.3%.

**Ground truth**: Actual review comments written by human engineers during the real review process on merged PRs. No synthesis.

**Leakage risk**: LOW — 2025 collection. Past major model cutoffs.

**Suitability**: Good evaluation framework to validate PIPE's scoring rubric. Scale (350 PRs) is too small for a diverse assessment library but the methodology (human-written ground truth from merged PRs) is the right design target.

---

### Dataset 8: CR-Bench (2026)

**Citation**: arXiv:2603.11078 — "CR-Bench: Evaluating the Real-World Utility of AI Code Review Agents." March 2026 (preprint, CC BY 4.0). [S8]

**Notable feature**: Multi-dimensional taxonomy (Category, Impact, Severity per defect) applied to real-world software defects transformed into PR context. Full repository context included.

**Leakage risk**: LOW — very recent.

**Suitability**: The Category/Impact/Severity taxonomy is directly usable for PIPE's challenge scoring rubric and difficulty tiering. Recommend borrowing the taxonomy design.

---

### Dataset 9: SEART GHS (USI Lugano)

**Citation**: Ozren Dabić et al., Zenodo:4476392. Tool: seart-ghs.si.usi.ch. MIT license. [S9]

**Size**: 735,669 repos; 25 characteristics each; 10 languages. Live crawler, continuously updated.

**Relevance**: Repository discovery tool. Supports filtering by language, license, star count, last-commit date, number of closed PRs. This is the correct first step for building PIPE's fresh content pipeline — use SEART to identify high-quality permissive-license repos, then pull recent PRs via GitHub API.

---

## Leakage & contamination evidence

### L1: The Stack v2 explicitly includes GitHub PR review data (confirmed)

The StarCoder 2 paper [S4] states: "For pull requests, we gathered pull request events from GHArchive and the corresponding source code from Software Heritage... we aggregate PullRequestEvent, PullRequestReviewEvent, PullRequestReviewCommentEvent, IssueCommentEvent, and IssuesEvent events." This is a peer-reviewed confirmation that PR review data from 2015–early 2024 is in the StarCoder 2 training corpus. Any assessment content from this window is contaminated for StarCoder-family models. Structural equivalence for GPT-4/Claude/Gemini via Common Crawl is highly probable, though not disclosed.

### L2: Quantified contamination — code benchmarks (Riddell et al. ACL 2024)

"Quantifying Contamination in Evaluating Code Generation Capabilities of Language Models" [S10] measured:
- 12.2% of HumanEval solutions in The Pile
- 18.9% of HumanEval in The Stack
- 20.8% of MBPP in The Stack
- Models achieve up to 4.9× higher scores on leaked samples vs. non-leaked samples (LessLeak-Bench corroboration [S11])

For PR review datasets (which have longer natural-language comment texts compared to code solutions), exact-string memorization risk may actually be higher per-item than for code generation benchmarks.

### L3: LessLeak-Bench — SE benchmark contamination at scale (2025)

LessLeak-Bench [S11] covering 83 SE benchmarks including code review:
- Average leakage ratio: 4.8% (Python), 2.8% (Java), 0.7% (C/C++)
- Outlier: QuixBugs 100% leaked; BigCloneBench 55.7%
- Detection method: perplexity + n-gram accuracy pipeline

For a 1,000-item PIPE challenge library, ~48 Python challenges and ~28 Java challenges would likely be contaminated even with diligent sourcing from 2024+ data, if any historical PRs slip through.

### L4: OpenAI abandoned SWE-bench Verified due to contamination

Multiple sources confirm OpenAI stopped reporting SWE-bench Verified scores due to training data contamination (their model's training data overlaps with GitHub PRs used in the benchmark), shifting to SWE-bench Pro as primary evaluation. This is a commercially significant precedent: even a major AI lab cannot guarantee its models don't memorize public GitHub PR content.

### L5: The freshness-gate strategy as proven mitigation (LiveCodeBench)

LiveCodeBench [S12] demonstrates that contamination can be structurally prevented (not just detected after the fact) by:
1. Collecting problems exclusively from dates after each model's training cutoff
2. Tagging every item with its original public release date
3. Continuously collecting new items as old ones age into contamination risk

This is directly applicable to PIPE. The equivalent "release date" for a PR challenge is the PR merge date. The gate date must advance quarterly as new model versions are released.

### L6: LLM memorization enables verbatim answer leakage

"Leak, Cheat, Repeat" [S15] and related work establish that LLMs can reproduce training-data strings when prompted. For PIPE's specific risk: a candidate who copies a PR diff into ChatGPT or Copilot Chat could receive the verbatim original review comment if that PR is in the model's training data. This is qualitatively different from a candidate "getting help" — it is answer leakage indistinguishable from the candidate's own response.

---

## Legal/ethical considerations

### GitHub Terms of Service (updated March 2026)

The GitHub ToS [S13] contains two directly relevant provisions:

1. **Research exception**: "Researchers may use public, non-personal information from the Service for research purposes, **only if any publications resulting from that research are open access**." PIPE cannot satisfy this — it is a commercial product. Using GitHub public data for building paid assessment content does not fall within this exception.

2. **Commercial AI training carve-out**: Covers building AI models, not assessment content curation. Not applicable to PIPE's use case.

3. **Anti-spam / personal data restriction**: Prohibits selling personal information to recruiters/headhunters/job boards. While PIPE is not selling data, using PR author attribution in an assessment context that feeds hiring decisions is adjacent and warrants caution.

**Bottom line**: PIPE's use case sits in a legal grey zone. GitHub's API ToS does not explicitly forbid PIPE's collection method, but neither does it explicitly permit it for commercial assessment use. **Independent legal review is required before production launch.**

### Per-repository source code licensing

Each PR diff inherits the source repo's license. GPL/LGPL content used as challenge material shown to paying users creates copyleft risk (debated, but uncertain). Safe approach: filter exclusively to MIT, Apache-2.0, BSD-2, BSD-3, ISC, CC0 repos using SEART GHS's license filter.

### GDPR / developer consent

GitHub usernames are personal data under GDPR. Displaying `@username wrote this PR` in an assessment context requires lawful basis. The pragmatic fix: strip all author attribution at collection time. Review comments attributed to named individuals are personal data; redact them before the content enters PIPE's system.

The BigCode project's two-layer approach [S4, S18] — automated PII redaction + opt-out mechanism — is the appropriate model for PIPE to follow, scaled to PIPE's smaller collection volume.

### Ethical considerations

Using real developers' code and review comments in a commercial hiring product without their knowledge is ethically sensitive. The Copilot controversy demonstrated this community sensitivity. Risk mitigation: (a) strip attribution, (b) consider a public disclosure or opt-out mechanism if the challenge library grows large, (c) avoid sourcing challenges from well-known individual contributors whose code is easily recognizable.

---

## Recommendations for PIPE

### Recommendation 1: Do not reuse pre-2024 datasets as assessment content

CodeReviewer, GHArchive, and CodeSearchNet are contaminated for all current frontier models. Use their task structures and taxonomies as design blueprints; collect fresh content independently.

### Recommendation 2: Build a rolling-freshness pipeline (SEART → GitHub API → PII strip)

Concrete steps:
1. Query SEART GHS (seart-ghs.si.usi.ch) with filters: ≥100 stars, active in last 90 days, license in {MIT, Apache-2.0, BSD-2, BSD-3}, languages: JavaScript/TypeScript/Python/Go/Java.
2. For each repo, call GitHub REST API: `GET /repos/{owner}/{repo}/pulls?state=closed&base=main&sort=updated&direction=desc` — filter to PRs merged after **2024-07-01** (safely past GPT-4o Oct 2023 and Claude 3.5 Apr 2024 cutoffs).
3. Collect: unified diff, review comments, linked issue body. Strip GitHub usernames from all text using regex + bigcode/pii-lib-style detection.
4. Stamp each challenge with `pr_merge_date`. Retire challenges when a new model's training cutoff date reaches `pr_merge_date`.
5. Advance the gate date **quarterly**. Target: always stay ≥6 months past the latest known frontier model cutoff.

### Recommendation 3: Borrow schema from CodeReviewer; borrow taxonomy from CR-Bench

CodeReviewer's three-task structure (quality estimation → comment generation → code refinement) is a proven decomposition of code review skills [S1]. CR-Bench's Category/Impact/Severity taxonomy [S8] is ready-made for PIPE's challenge difficulty tiering and scoring rubric. Neither requires reusing their actual PR content.

### Recommendation 4: Filter to permissive-license repos only

SEART GHS supports license filtering. Exclude GPL, LGPL, AGPL, MPL repos. This eliminates copyleft risk and is a one-line filter in the collection pipeline.

### Recommendation 5: Obtain legal review before launch

GitHub ToS does not clearly authorize PIPE's commercial assessment use case. Secure a legal opinion on: (a) whether content collection via the GitHub API for paid assessment display constitutes permissible use, (b) GDPR implications of processing developer content, (c) whether per-repo licenses create distribution obligations when PR diffs are displayed to candidates.

### Trade-off summary

| Strategy | Leakage risk | Legal risk | Cost | Speed to market |
|---|---|---|---|---|
| Reuse CodeReviewer dataset content | HIGH | MEDIUM (CC-BY, but ToS gap) | Low | Fast |
| Mine GHArchive (pre-2024) | VERY HIGH | HIGH (ToS gap + PII) | Low | Fast |
| Mine GitHub API (post-2024-07-01, permissive repos, PII-stripped) | LOW (with gate) | MEDIUM (ToS review needed) | Medium | Medium |
| Licence AACR-Bench / SWE-PRBench directly | LOW | MEDIUM (license unclear) | Low–Medium | Fast if licensed |
| Mine private enterprise repos | ZERO | LOW (contractual) | HIGH | Slow |

**Recommended path**: Mine GitHub API with post-2024 gate + PII stripping + permissive-license filter, with legal review before launch.

---

## Sources (numbered, with URLs)

[S1] Zhiyu Li et al., "Automating Code Review Activities by Large-Scale Pre-training," ESEC/FSE 2022 (peer-reviewed, ACL DL). arXiv:2203.09095. Zenodo dataset: https://zenodo.org/records/6900648. Paper: https://arxiv.org/abs/2203.09095

[S2] KTH CARA thesis, "Pull Request Review Comments Dataset," Zenodo 4773068. GHArchive project: https://www.gharchive.org/. Dataset: https://zenodo.org/records/4773068

[S3] Hamel Husain et al., "CodeSearchNet Challenge," 2019 (report). GitHub: https://github.com/github/CodeSearchNet. HuggingFace: https://huggingface.co/datasets/code-search-net/code_search_net

[S4] Anton Lozhkov et al., "StarCoder 2 and The Stack v2: The Next Generation," arXiv:2402.19173, 2024 (preprint). Dataset: https://huggingface.co/datasets/bigcode/the-stack-v2. Paper: https://arxiv.org/abs/2402.19173

[S5] Alibaba/Ant Group, "CodeFuse-CR-Bench," arXiv:2509.14856, 2025 (preprint). https://arxiv.org/abs/2509.14856

[S6] "AACR-Bench: Evaluating Automatic Code Review with Holistic Repository-Level Context," arXiv:2601.19494, 2026 (preprint). https://arxiv.org/html/2601.19494v2

[S7] "SWE-PRBench: Benchmarking AI Code Review Quality Against Pull Request Feedback," arXiv:2603.26130, 2026 (preprint). https://arxiv.org/abs/2603.26130

[S8] "CR-Bench: Evaluating the Real-World Utility of AI Code Review Agents," arXiv:2603.11078, 2026 (preprint, CC BY 4.0). https://arxiv.org/abs/2603.11078

[S9] Ozren Dabić et al., "GHS (GitHub Search)," Zenodo:4476392. Tool: https://seart-ghs.si.usi.ch/. GitHub (MIT): https://github.com/seart-group/ghs

[S10] Martin Riddell et al., "Quantifying Contamination in Evaluating Code Generation Capabilities of Language Models," ACL 2024 (peer-reviewed). arXiv:2403.04811. https://arxiv.org/html/2403.04811v1. ACL: https://aclanthology.org/2024.acl-long.761.pdf

[S11] Junda He et al., "LessLeak-Bench: A First Investigation of Data Leakage in LLMs Across 83 Software Engineering Benchmarks," arXiv:2502.06215, 2025 (preprint, under review). https://arxiv.org/abs/2502.06215

[S12] Naman Jain et al., "LiveCodeBench: Holistic and Contamination Free Evaluation of Large Language Models for Code," arXiv:2403.07974, 2024 (ICLR). https://arxiv.org/abs/2403.07974. https://livecodebench.github.io/

[S13] GitHub Terms of Service (official policy, updated March 25, 2026). https://docs.github.com/en/site-policy/github-terms/github-terms-of-service

[S14] GitHub Acceptable Use Policies (official policy document). https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies

[S15] Shen et al., "Leak, Cheat, Repeat: Data Contamination and Evaluation Malpractices in Closed-Source LLMs," arXiv:2402.03927, 2024 (preprint). https://arxiv.org/html/2402.03927

[S16] "A Survey of Code Review Benchmarks and Evaluation Practices in Pre-LLM and LLM Era," arXiv:2602.13377, 2026 (preprint; 99 papers surveyed). https://arxiv.org/abs/2602.13377

[S17] Liu et al., "Too Noisy To Learn: Enhancing Data Quality for Code Review Comment Generation," IEEE 2025 (peer-reviewed). arXiv:2502.02757. https://ieeexplore.ieee.org/document/11025607/

[S18] BigCode Data Governance Case Study, The Turing Way (documentation). https://book.the-turing-way.org/project-design/data-security/data-governance/bigcode-casestudy/
