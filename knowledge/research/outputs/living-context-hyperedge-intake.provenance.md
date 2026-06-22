# Provenance: Living Context Hyperedge Intake

- **Date:** 2026-06-19
- **Status:** Research intake provenance
- **Final deliverable:** `knowledge/research/outputs/living-context-hyperedge-intake.md`
- **Plan integration:** `knowledge/plan/living-context-repo-matching-plan.md`

## Local BRAIN Sources Read

Primary local paths inspected:

- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/papers/2606.17856.pdf` - FlowRAG
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/papers/2606.14275.pdf` - WikiKV
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/papers/2602.23370.pdf` - semantic chunking
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/papers/2606.16881.pdf` - SGM-SLAM
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/papers/2606.09090.pdf` - Context Rot
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/papers/searchswarm-full.md`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/papers/decomposer-full.md`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/papers/scaffoldagent-full.md`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/papers/hgnet-full.md`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/papers/hisr-full.md`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/conversation-transcripts/session-2026-06-19-brain-building.md`
- `/Users/hans/Code/AGENT/BRAIN/research/knowledge-graph-construction/*.md`

## Caveats

- The local HISR PDF was not present in BRAIN during this pass. HISR was read
  from the local `hisr-full.md` extraction, raw transcript excerpts, and the
  arXiv abstract metadata at `https://arxiv.org/abs/2606.20162`.
- The `knowledge-base/wiki` notes were treated as secondary notes, not source of
  truth.
- The `research/knowledge-graph-construction` files were treated as secondary
  researcher reports, not accepted design requirements.
- This provenance file does not claim the research intake is an accepted ADR.
  It records why the intake exists and what evidence informed it.

## Resulting Repository Changes

- Added the research intake note.
- Updated the active living-context plan to make N-participant source-backed
  context assertions canonical and subject/predicate/object triples a
  compatibility projection.
- Archived pending static taxonomy work items that conflicted with ADR-043:
  skill adjacency tables and ESCO-as-preferred-vocabulary work.
