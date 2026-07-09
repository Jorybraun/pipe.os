# Provenance: source-backed repo PR extraction and hypergraph matching

- **Date:** 2026-07-08
- **Rounds:** 3
- **Sources consulted:** 19
- **Sources accepted:** 19
- **Sources rejected:** 0
- **Verification:** PASS WITH NOTES
- **Plan:** `knowledge/research/outputs/.plans/repo-hypergraph-matching.md`
- **Research files:**
  - `knowledge/research/outputs/.drafts/repo-hypergraph-matching-research-hgnn.md`
  - `knowledge/research/outputs/.plans/repo-hypergraph-matching.md`

## Source accounting

### Local / project sources (3)
- PIPE-OS `knowledge/research/outputs/living-context-hyperedge-intake.md`
- PIPE-OS `knowledge/plan/living-context-repo-matching-plan.md`
- BRAIN `knowledge-base/wiki/pipe-living-context-matching.md`

### Academic papers read in full via alphaXiv MCP (11)
- AOCI (arXiv:2605.02421)
- Codebase-Memory (arXiv:2603.27277)
- GraphGen4Code (arXiv:2002.09440)
- Sphinx (arXiv:2601.04252)
- SWE-PRBench (arXiv:2603.26130)
- HyperSU (arXiv:2606.28351)
- HyperGraphRAG (arXiv:2503.21322)
- Cog-RAG (arXiv:2511.13201)
- Cross-Granularity HGRAG (arXiv:2508.11247)
- ProvenanceGuard (arXiv:2606.18037)
- SURE-RAG (arXiv:2605.03534)
- PJB (arXiv:2603.17386)
- Malt skill matching (arXiv:2409.12097)

### Web/tooling sources (3)
- Tree-Sitter documentation
- Semantic Code Indexing with AST and Tree-sitter for AI Agents (Medium)
- Multi-SWE-bench website

### Subagent outputs (1)
- `knowledge/research/outputs/.drafts/repo-hypergraph-matching-research-hgnn.md`

## Notes

- The 3 other subagents (`code-rep`, `provenance`, `scoring`) were launched with `subagent_explore` profile and did not have MCP access. They were relaunched with `subagent_general` but the Devin session lost track of them before completion. The evidence for the final brief was therefore gathered primarily by the main agent via `mcp_call_tool` on the alphaXiv and duckduckgo MCP servers.
- The `alphaxiv.get_paper_content` tool returns AI-generated paper reports, not raw PDF text. Claims are verified against these reports and the original paper abstracts/URLs are provided for direct inspection.
- Local sources are cited by file path; remote sources by URL.
