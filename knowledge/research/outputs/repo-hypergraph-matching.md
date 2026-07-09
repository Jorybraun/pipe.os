# Source-Backed Repository PR Extraction and Hypergraph Matching

**Slug:** `repo-hypergraph-matching`  
**Date:** 2026-07-08  
**Scope:** How to semantically ingest real GitHub PRs and match them to candidate evidence using source-backed hypergraphs.  
**Status:** Final research brief

---

## Executive Summary

The research confirms the architectural direction already encoded in PIPE-OS: **immutable source evidence is the proof layer, source-backed hyperedge/context records are the semantic source of truth, and pairwise graph/search/match views are rebuildable projections.** [1, 2, 3]

Four findings shape the implementation:

1. **Repository-scale code understanding requires a stable, file-level intent layer.** Current retrieval and agent-based exploration are token-heavy and non-deterministic; symbolic-semantic indexing (AOCI) and Tree-Sitter-based knowledge graphs (Codebase-Memory, GraphGen4Code) provide structured, incrementally maintainable representations that LLMs can read without repeated file exploration. [4, 5, 6]
2. **Hypergraphs are better than pairwise graphs for multi-entity evidence.** Multiple recent RAG systems (HyperSU, HyperGraphRAG, Cog-RAG, Cross-Granularity HGRAG) demonstrate that hyperedges capture n-ary relations without fragmenting them into binary triples, reduce hallucination in hyperedge construction, and improve multi-hop retrieval. [7, 8, 9, 10]
3. **Anti-fake guardrails must be source-aware, not just factually correct.** ProvenanceGuard and SURE-RAG show that a claim can be factually true yet incorrectly attributed to the wrong source. Verification must decompose answers into atomic claims, route claims to source-specific evidence, and return a verdict such as supported / refuted / insufficient. [11, 12]
4. **Scoring for person-job / candidate-PR matching needs diagnostic reasoning labels.** PJB and the Malt skill-matching system decompose queries and documents into structured sections, use multi-parallel and serial reasoning taxonomies, and score alignment with multi-section transformers and contrastive learning. [13, 14]

The implementation wedge remains one real PR: parse it, build source spans and structural facts, convert them into source-backed context records, and prove the match explanation reconstructs to candidate and repo source spans.

---

## 1. Source-Backed PR Extraction

### 1.1 The problem with raw text or chunk retrieval

Large language models struggle with repository-scale code because raw text retrieval and agent-based exploration have three failure modes: (1) context window saturation and "context rot" degrade performance as more unrelated files are included; (2) critical architectural information is scattered across files and implicit; (3) agent exploration is non-deterministic, expensive, and inconsistent across runs. [4]

### 1.2 Symbolic-semantic indexing as a stable intent layer

AOCI (AI-Oriented Code Indexing) proposes a dual-layer file-level representation: a discrete tag layer (`[ABCDE-tag]`) encoding architectural layer, business module, importance, technical characteristics, and code scale; and a continuous semantic layer (`F:function | R:relations | A:API | S:synopsis`) describing each file's role, dependencies, public API, and summary. [4] The format is designed to be incrementally maintainable and stable across runs, which is exactly what a `RepoSnapshot` should provide: a systematic, LLM-readable blueprint rather than an ad-hoc view constructed at query time.

### 1.3 Tree-Sitter-based knowledge graphs for code structure

Codebase-Memory builds a persistent knowledge graph from Tree-Sitter ASTs across 66 languages, stored in a single SQLite file and exposed through MCP structural tools. It extracts nodes for `Project`, `Package`, `Folder`, `File`, `Module`, `Function`, `Method`, `Class`, `Interface`, `Enum`, `Type`, and `Route`; edges include `CALLS`, `IMPORTS`, `USAGES`, `USES_TYPE`, `IMPLEMENTS`, `INHERITS`, `DECORATES`, `HANDLES`, `THROWS`, `READS`, `WRITES`, `CONFIGURES`, `TESTS`, `FILE_CHANGES_WITH`, and `MEMBER_OF`. [5]

This is directly relevant to the `repoSemanticGraph` builder pipeline: the `SourceArtifact` / `SourceArtifactVersion` / `SourceSpan` / `RepoSymbol` / `StructuralFact` types map closely to the Codebase-Memory node and edge types. For PIPE, the difference is semantic provenance: each structural fact must carry exact source offsets, commit SHA, and resolver version, and must be reconstructible from the immutable proof layer.

### 1.4 Code knowledge graphs from program analysis

GraphGen4Code demonstrates a toolkit that builds inter-procedural data- and control-flow graphs for 1.3 million Python files, producing 2 billion triples. It uses a language-neutral abstraction that captures actual program flow (not just token or AST similarity) and links code to documentation and forum discussions through shared label nodes. [6] The key design insight for PIPE is that **code can be represented as a graph of abstracted API calls and data flows**, which is more robust for matching than raw text or token embeddings.

### 1.5 PR diff analysis and benchmarks

Sphinx is a unified framework for LLM-driven PR review. It constructs a data pipeline that compares pseudo-modified code against actual merged code to generate review comments grounded in verifiable code modifications; it evaluates with a checklist-based benchmark rather than BLEU/ROUGE. [15] SWE-PRBench, meanwhile, provides 350 PRs with human-annotated ground-truth for evaluating AI code review quality. [16] Both reinforce the rule that PR-derived challenge packets must be built from **actual diffs, real merged code, and linked test/CI evidence**, not generated summaries.

### 1.6 Practical extraction toolchain

Tree-Sitter is the de facto incremental parser for building code graphs; it can produce concrete syntax trees and supports queries that extract symbols, classes, functions, imports, and references. [17, 18] For PR diff ingestion, the extraction pipeline should be:

- Fetch the PR metadata, diff, and changed files.
- Parse each changed file with Tree-Sitter to extract symbols, signatures, and call/control edges.
- Diff the AST-level changes (not just text hunks) to identify added/removed/modified symbols and structural facts.
- Build `SourceSpan` records for each diff hunk with line ranges, file path, base/head sides, and commit SHAs.
- Build `StructuralFact` and `SemanticAssertion` records from the changed symbols and their relationships, with source references to exact spans.
- Validate that every assertion can be reconstructed from the immutable source artifacts.

---

## 2. Hypergraph Matching

### 2.1 Why hypergraphs beat pairwise graphs

A standard graph captures only binary edges. A medical fact such as "Male hypertensive patients with serum creatinine 115–133 μmol/L are diagnosed with mild creatinine elevation" involves four entities and cannot be captured losslessly by binary triples. [8] The same issue appears in candidate evidence: a statement like "I redesigned order processing with Kafka after checkout latency spiked" relates person, action, mechanism, business object, failure mode, and time/context in one n-ary event. [1]

### 2.2 Hypergraph RAG for source-grounded n-ary relations

HyperGraphRAG stores knowledge as a hypergraph `G_H = (V, E_H)`, where each hyperedge `e_H` has natural-language text and a confidence score, and is stored in a bipartite graph connecting entities to hyperedges. Retrieval uses entity + hyperedge embeddings with relevance scores. [8]

HyperSU improves on this by constructing **source-grounded semantic-unit hyperedges** through an entity-aware minimum-description-length (MDL) optimization. It balances sentence-level semantic coherence and entity compactness, then performs clue-guided bidirectional retrieval over the hypergraph. On GraphRAG-Bench it achieves up to 14.7% relative accuracy improvement over graph-based and hypergraph-based baselines. [7]

Cog-RAG adds a **dual-hypergraph** structure: a theme hypergraph for global semantic scaffolds and an entity hypergraph for fine-grained relations, with a two-stage top-down retrieval that mirrors human reasoning. [9]

Cross-Granularity HGRAG uses an entity-passage incidence matrix where entities are nodes and passages containing multiple entities are hyperedges, integrating fine-grained entity structure with coarse-grained passage semantics. It achieves up to 6× speedup over iterative methods. [10]

### 2.3 Implications for PIPE candidate-to-PR matching

The `SourceBackedContextAssertion` (or `ContextRecord`) in PIPE is the implementation analogue of a hyperedge: it connects N participants under one contextual relation (person, action, mechanism, problem, repo span, test, outcome) without reducing the meaning to pairwise edges. [1]

The matching engine should:

- Compile candidate atoms from source-backed context records, not from raw text or embeddings alone.
- Compile PR demands from `ChallengePacket` context records with source span references.
- Align candidate evidence and PR demands on shared concepts, problems, mechanisms, and business objects, not only on cosine similarity.
- Keep pairwise graph edges and match scores as projections; the hypergraph is the source of truth.

---

## 3. Anti-Fake Guardrails

### 3.1 The source-attribution problem

ProvenanceGuard identifies a failure mode it calls **cross-source conflation**: a claim may be factually true and supported by *some* evidence, yet attributed to the wrong source. For example, an agent might say "According to the patient's chart, empagliflozin reduced mortality" when that fact came from a trial abstract, not the chart. A source-blind verifier would mark the claim as supported; a source-aware verifier should reject the attribution. [11]

### 3.2 Source-aware verification pipeline

ProvenanceGuard consumes an MCP trace with evidence objects `(tool_i, source_i, text_i)`, decomposes the answer into atomic claims, routes each claim to the most relevant source using embedding centroids, and checks support with a DeBERTa NLI model. It also computes a token-alignment proxy from NLI attention; a claim with fewer than 70% supported non-stopword tokens is flagged. Literal values receive stricter checks. [11]

### 3.3 Evidence sufficiency

SURE-RAG frames the problem as evidence sufficiency verification: a claim-evidence pair can be supported, refuted, or **insufficient**. The latter is critical for matching: missing evidence should return `NEEDS_MORE_EVIDENCE` or `NO_ROLE_SAFE_CHALLENGE`, not a fabricated match. The model aggregates a claim-evidence matrix into coverage, relation strength, uncertainty, and retrieval-uncertainty features, then classifies the answer. [12]

### 3.4 Anti-fake in code-specific benchmarks

Sphinx and SWE-PRBench stress that PR review evaluation must be based on **real PR diffs, actual merged code, and test-grounded verification points**, not on human-authored comments or surface text similarity. [15, 16] Multi-SWE-bench selects repos by criteria such as >500 stars, continuous maintenance, CI/CD support, and linked PRs with test changes. [19] These benchmarks provide a concrete, reproducible standard for what counts as a valid challenge packet.

### 3.5 Required guardrails for PIPE

- **Immutable proof layer:** Every source span, artifact, and commit SHA is stored and versioned.
- **Source attribution check:** Every match claim must be traceable to both candidate source spans and repo source spans.
- **Sufficiency gate:** If evidence is missing, partial, or conflicting, the status must be `INSUFFICIENT` / `NEEDS_MORE_EVIDENCE` / `NO_ROLE_SAFE_CHALLENGE`.
- **No default fallbacks:** No generic repo, smallest PR, or default skill substitution.
- **Determinism:** Same inputs produce same outputs; backfills and extractions are idempotent.

---

## 4. Scoring and Alignment

### 4.1 Person-job matching as a reasoning-aware retrieval task

PJB (Person-Job Benchmark) formalizes person-job matching as a job-competency-driven retrieval task where full job descriptions are queries and full resumes are documents. It contains 297 JDs, 197,674 CVs, and 2,242 positive relevance judgments. Relevance is defined as job competency, not interview probability. [13]

PJB introduces a diagnostic taxonomy:
- **Domain family:** Technical R&D, Product & Operations, HR/Admin/Finance, Sales & Market Support, Mechanical/Hardware, Project Management.
- **Reasoning type:**
  - *Parallel-only* — ≥3 explicit constraints, no serial depth.
  - *Hybrid-balanced* — explicit filtering + semantic inference.
  - *Serial-dominant* — multi-step reasoning across fields. [13]

This maps directly to the PIPE matching problem: role guardrails are explicit constraints, while candidate evidence alignment is semantic inference across source-backed context records.

### 4.2 Multi-section, cross-lingual skill matching

Malt's skill-matching system uses a two-tower neural retriever with independently trained project and freelancer towers. Each document section is encoded separately, section-type embeddings are added to preserve section identity, a transformer head learns global context, and a weighted-average pooling layer gives more weight to shorter, salient sections. Training uses contrastive learning with n-uplet InfoNCE loss and weak negatives. [14]

For PIPE, the analogous decomposition is: role guardrails (JD) and candidate evidence (resume/transcripts) are multi-section documents; repo challenge packets are multi-section evidence units. The scoring function should combine section-level and document-level evidence, not just one global embedding.

### 4.3 PIPE's scoring model

The existing PIPE-OS scoring model [2] already implements a multi-dimensional alignment:
- Pair score: 30% semantic narrative, 25% concept, 20% problem/mechanism, 15% domain/business object, 10% ownership/action.
- Final score: 40% candidate evidence, 20% role relevance, 15% specificity, 15% challenge quality, 10% validation/deepening.
- Diminishing returns from same-episode evidence: 100%, 35%, 0%.

This is consistent with the research: evidence alignment is a **set-level, multi-granularity, source-backed problem**, not a single vector similarity. The PJB reasoning taxonomy and Malt's section-weighted pooling provide empirical support for decomposing queries/documents into structured, weighted components.

---

## 5. Implications for PIPE Implementation

### 5.1 First milestone: one real PR end-to-end

The research and the existing PIPE plan converge on the same wedge: prove the full loop on one real GitHub PR before scaling the crawler. [1] The loop is:

1. Ingest immutable PR evidence (repo snapshot, commit SHAs, diff hunks, file contents, tests, manifests, CI config).
2. Extract source spans, symbols, structural facts, and episodes with Tree-Sitter and AST diffing.
3. Build `SourceBackedContextAssertion` / `ContextRecord` records with N participants and exact source references.
4. Build a `ChallengePacket` from those records.
5. Match against candidate source-backed context records.
6. Generate a match explanation with links back to candidate and repo source spans.

### 5.2 What to avoid

- LLM-generated summaries as the primary hyperedge construction method (causes hallucination and high indexing cost). [7]
- Pairwise graph simplification of n-ary relations (loses meaning). [8, 10]
- Source-blind factuality checks (misses cross-source conflation). [11]
- Binary answer-or-abstain without a true `INSUFFICIENT` state. [12]
- Single-embedding matching without section/reasoning decomposition. [13, 14]

### 5.3 Evaluation corpus

To prove the system works, create an expert-labeled evaluation corpus of candidate-PR pairs with the same structure as PJB: positive judgments based on job competency, diagnostic labels for reasoning type, and explicit source attributions for every supported claim. Metrics should include recall, precision, nDCG, guardrail violation rate, and determinism.

---

## 6. Open Questions

1. **What is the minimal set of tree-sitter queries and language grammars needed to support PIPE's initial language set (TypeScript, JavaScript, Python, Go, Rust, Java)?** Codebase-Memory supports 66 languages; PIPE should start with a hardcoded minimal set and expand. [5]
2. **How should `SourceBackedContextAssertion` represent code-specific relations (e.g., `CALLS`, `IMPORTS`, `TESTS`) without becoming a hard-coded semantic edge taxonomy?** ADR-043 already forbids hard-coded taxonomies, but code graphs have natural relation types. [1]
3. **How do we guarantee that a match explanation reconstructs to both candidate and repo source spans in a single verifier?** ProvenanceGuard and SURE-RAG provide the building blocks, but the cross-domain claim routing (person text vs. repo code) is not yet a solved problem. [11, 12]

---

## Sources

[1] PIPE-OS `living-context-hyperedge-intake.md` — source-backed hypergraph rationale, three-layer model, and design inference. `file:///Users/hans/Code/PIPE/PIPE-OS/knowledge/research/outputs/living-context-hyperedge-intake.md`

[2] PIPE-OS `living-context-repo-matching-plan.md` — deterministic candidate-to-PR matching, scoring model, eligibility thresholds. `file:///Users/hans/Code/PIPE/PIPE-OS/knowledge/plan/living-context-repo-matching-plan.md`

[3] BRAIN `pipe-living-context-matching.md` — no-fake invariant, one-real-PR wedge, `SourceBackedContextAssertion` as hyperedge analogue. `file:///Users/hans/Code/AGENT/BRAIN/knowledge-base/wiki/pipe-living-context-matching.md`

[4] AOCI: Symbolic-Semantic Indexing for Practical Repository-Scale Code Understanding with LLMs (arXiv:2605.02421). `https://arxiv.org/abs/2605.02421`

[5] Codebase-Memory: Tree-Sitter-Based Knowledge Graphs for LLM Code Exploration via MCP (arXiv:2603.27277). `https://arxiv.org/abs/2603.27277`

[6] A Toolkit for Generating Code Knowledge Graphs (arXiv:2002.09440). `https://arxiv.org/abs/2002.09440`

[7] HyperSU: Corpus-Driven Semantic-Unit Hypergraph for Retrieval-Augmented Generation (arXiv:2606.28351). `https://arxiv.org/abs/2606.28351`

[8] HyperGraphRAG: Retrieval-Augmented Generation via Hypergraph-Structured Knowledge Representation (arXiv:2503.21322). `https://arxiv.org/abs/2503.21322`

[9] Cog-RAG: Cognitive-Inspired Dual-Hypergraph with Theme Alignment Retrieval-Augmented Generation (arXiv:2511.13201). `https://arxiv.org/abs/2511.13201`

[10] Cross-Granularity Hypergraph Retrieval-Augmented Generation for Multi-hop Question Answering (arXiv:2508.11247). `https://arxiv.org/abs/2508.11247`

[11] ProvenanceGuard: Source-Aware Factuality Verification for MCP-Based LLM Agents (arXiv:2606.18037). `https://arxiv.org/abs/2606.18037`

[12] SURE-RAG: Sufficiency and Uncertainty-Aware Evidence Verification for Selective Retrieval-Augmented Generation (arXiv:2605.03534). `https://arxiv.org/abs/2605.03534`

[13] PJB: A Reasoning-Aware Benchmark for Person-Job Retrieval (arXiv:2603.17386). `https://arxiv.org/abs/2603.17386`

[14] Skill matching at scale: freelancer-project alignment for efficient multilingual candidate retrieval (arXiv:2409.12097). `https://arxiv.org/abs/2409.12097`

[15] Sphinx: Benchmarking and Modeling for LLM-Driven Pull Request Review (arXiv:2601.04252). `https://arxiv.org/abs/2601.04252`

[16] SWE-PRBench: Benchmarking AI Code Review Quality Against Pull Request Feedback (arXiv:2603.26130). `https://arxiv.org/abs/2603.26130`

[17] Tree-Sitter — incremental parsing system for programming tools. `https://tree-sitter.github.io/tree-sitter/`

[18] Semantic Code Indexing with AST and Tree-sitter for AI Agents. `https://medium.com/@email2dineshkuppan/semantic-code-indexing-with-ast-and-tree-sitter-for-ai-agents-part-1-of-3-eb5237ba687a`

[19] Multi-SWE-bench — multilingual benchmark for code repair. `https://multi-swe-bench.github.io/`
