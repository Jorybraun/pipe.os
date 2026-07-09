# Verification: repo-hypergraph-matching

**Date:** 2026-07-08

## Source URL verification

All 11 external URLs were checked with `curl -I`. All returned HTTP 200:
- https://arxiv.org/abs/2605.02421 (AOCI)
- https://arxiv.org/abs/2603.27277 (Codebase-Memory)
- https://arxiv.org/abs/2002.09440 (GraphGen4Code)
- https://arxiv.org/abs/2606.28351 (HyperSU)
- https://arxiv.org/abs/2503.21322 (HyperGraphRAG)
- https://arxiv.org/abs/2606.18037 (ProvenanceGuard)
- https://arxiv.org/abs/2605.03534 (SURE-RAG)
- https://arxiv.org/abs/2603.17386 (PJB)
- https://arxiv.org/abs/2409.12097 (Malt skill matching)
- https://tree-sitter.github.io/tree-sitter/
- https://multi-swe-bench.github.io/

Local file references were checked by reading the files directly.

## FATAL findings

None.

## MAJOR findings

1. **Subagent evidence gap.** Three of four research subagents failed to deliver files. The missing angles (code representation, provenance, scoring) were covered by the main agent directly, but the workload was not parallelized as planned. Future research runs should use `subagent_general` with pre-approved MCP permissions from the start.

2. **AI-generated paper summaries.** `alphaxiv.get_paper_content` returns an AI-generated intermediate report, not the raw PDF. Critical claims have been verified against the returned report, but the original papers should be read for any downstream implementation work.

## MINOR findings

1. The research file `knowledge/research/outputs/.drafts/repo-hypergraph-matching-research-hgnn.md` contains only abstracts for papers beyond the 4-5 that were read in depth. It was used to triangulate the paper landscape, not as a primary source.

2. The Medium article on Tree-Sitter is a secondary source; it is acceptable for tooling context but not for primary claims.

## Conclusion

**PASS.** The final brief is well-sourced, internally consistent, and all external URLs are live. The subagent failures were mitigated by direct MCP-based research.
