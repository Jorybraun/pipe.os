# PIPE Vision

**North Star:** A knowledge graph substrate where candidates, roles, and repos are decomposed into semantically-rich sub-elements, each carrying its own embedding and structured properties, with relationships modeled as first-class edges. Matching happens at the sub-element level and aggregates into per-requirement scores with full evidence traceability. The aggregate score remains for legacy consumers, but the **match report — not the match score — is the primary output**.

## Product Thesis
Pipe is an AI-native developer hiring platform that reasons about fit through structured decomposition of three entity types — candidates, roles, and repos — and triangulates matches using semantic similarity, structured signals, and evidence-grounded LLM reasoning. Matching is not keyword overlap or whole-entity embedding; it is per-element alignment with evidence attribution.

The product exists because hiring decisions made on resume parsing and generic rubrics cause real harm — to candidates filtered out on surface features and to companies making expensive mistakes. Pipe's bet is that you can do meaningfully better by capturing structural richness at ingestion, maintaining candidate profiles as living graphs that grow through multiple data sources over time, and producing auditable match reports that hiring teams can trust and override.

## Core Commitments
- **Candidates are not applications; they are ongoing relationships.** A resume is a seed, not a profile. Real candidate signal comes from structured screening conversations, public data enrichment, and performance on authentic work. The candidate's profile deepens over months and across roles. This requires a substrate that supports temporal layering, provenance tracking, and accumulating evidence.
- **Roles are not job descriptions; they are synthesis artifacts.** The Role Context Document (RCD) captures a hiring team's actual intent through a structured discovery interview — multi-stakeholder perspectives, laddering chains (attribute → consequence → value), dealbreakers with job-relatedness notes, BARS anchor overrides calibrated to this specific team.
- **Repos are not keyword-tagged lists; they are decomposed engineering artifacts.** The three-pass crawler produces rich Pass-3 narratives with labeled fields (language, domain, architecture, seniority signal, test culture, challenge surfaces). The work ahead is exposing the sub-elements as addressable nodes rather than concatenating them into a single blob.

## Target Architecture
- Self-hosted Neo4j Community Edition on a VPS for the decomposed entity graph.
- Cloudflare Workers for API surface, authentication, job orchestration, etc.
- D1 for transactional operational data.
- R2 for resume blobs and media.
- Workers AI for embedding generation and model routing.
- The match report with evidence attribution is the primary output.

## Entity Lifecycle (Candidate)
Intake → Enrichment → Loose match → Screening (graph construction) → Deeper validation (code review + implementation challenges) → Ongoing relationship (graph persists and grows).

This vision drives every downstream design decision in the roadmap and requirements.

**Architecture:** See `docs/architecture/README.md` + `operating-cadence.png` for the canonical 24/7 orchestrator, agent registry, document validation gate, operating cadence, and swarm dispatch model.

**Last Updated:** 2026-06-05 (Integrated target autonomous architecture diagram)
**Status:** Living document — update recursively as research and learnings evolve.