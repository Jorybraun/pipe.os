# Research Plan: source-backed repo PR extraction and hypergraph matching

**Slug:** `repo-hypergraph-matching`  
**Date:** 2026-07-10  
**Workflow:** Deep research (Feynman)  
**Scope:** How to semantically ingest real GitHub PRs and match them to candidate evidence using source-backed hypergraphs.

---

## Key questions

1. **Source-backed PR extraction:** What are proven methods for extracting artifacts, source spans, symbols, structural facts, episodes, and assertions from a GitHub PR diff without fabricating evidence?
2. **Hypergraph matching:** How can hyperedges / source-backed context records represent multi-participant meaning and improve candidate-to-PR alignment compared to pairwise or embedding-only approaches?
3. **Anti-fake guardrails:** What evaluation methods, benchmarks, or design patterns prove a matching system does not hallucinate evidence, PRs, repos, or candidate skills?
4. **Scoring and alignment:** What is the state of the art in scoring semantic/narrative/concept/provenance correspondence for evidence alignment?

## Evidence needed

- Academic papers (arXiv) on hypergraphs, semantic extraction, source-grounded retrieval, and evidence-based matching.
- Primary sources on code representation: tree-sitter, code2vec, graph neural networks for code, PR diff analysis.
- Real-world benchmarks: SWE-bench, Multi-SWE-bench, SWE-Bench++ selection criteria and anti-patterns.
- Tooling: alphaXiv, DuckDuckGo, and existing PIPE-OS/BRAIN research outputs.

## Scale decision

**Direct search with parallel MCP calls.** The question is broad but we have four clear sub-questions. We will run parallel `alphaxiv.discover_papers` and `duckduckgo.research` calls for each sub-question, then fetch the top 1–2 papers per question. No subagents needed; the MCP tools return ranked and summarized content.

## Task ledger

- [x] Create plan
- [ ] Gather evidence: source-backed PR extraction
- [ ] Gather evidence: hypergraph matching
- [ ] Gather evidence: anti-fake guardrails
- [ ] Gather evidence: scoring and alignment
- [ ] Draft synthesis
- [ ] Cite and verify
- [ ] Deliver final brief + provenance

## Verification log

- Sources will be verified via `duckduckgo.fetch` and `alphaxiv.get_paper_content`/`answer_pdf_queries`.
- Reject: SEO listicles, undated/no-author sources, unverifiable claims.
- Mark inferences as inferences.

## Decision log

- Decision: Use local `knowledge/research/outputs/` as the output directory, consistent with existing PIPE-OS research outputs.
- Decision: Focus on arXiv/primary sources and high-quality technical docs, not vendor blogs.
