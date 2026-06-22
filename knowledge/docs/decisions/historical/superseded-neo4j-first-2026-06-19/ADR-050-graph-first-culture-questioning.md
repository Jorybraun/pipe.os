# ADR-050: Contextual Conversation-Graph Interviewing and Grounded Repo Matching

**Date:** 2026-06-10
**Status:** Proposed
**Deciders:** Jory Braun, Devin

---

## Context

The culture interview exists to build the candidate graph that drives repo matching for code review interviews. Three measured problems (data from a live session against the 1,746 ingested `RepoNode`s):

1. **Flat decomposition loses the data.** Resumes and answers decompose into context-free tags. Maya's real nodes include `kafka (expert)`, `python (expert)` — the situation, decisions, and outcomes in her answers are discarded. "We lose so much data like this."
2. **Similarity edges are noise at the current threshold.** At the matcher's 0.55 cutoff, *every* candidate node — rich or generic — connects to *all 1,746* repo nodes (similarity floor 0.73; the embedding space compresses everything into 0.73–0.87). Scores degenerate to node counting; top-5 spreads were 0.8–1.6%. Structure only appears at a tight cutoff: at ≥0.84, `kafka (expert)` has 1 edge, the Streamline narrative node has 22 (all async/streaming repos), `MSc from KTH` has 0.
3. **Questions don't build context.** Main questions are generative (PR #43) but planned per static culture dimensions; follow-up probes come from a fixed STAR template bank ("What actions did you take?") that produces generic answers → semantically empty nodes → meaningless edges.

Constraints: keep the FSM in `cultureInterviewState.ts` and the agent route contract; one planning LLM call per turn; no destructive change to existing `candidate_nodes` consumers.

---

## Decision

Decompose every answer (and the CV) into a **contextual semantic graph** — entities, actions, situations, reasons, and outcomes with typed edges — embed nodes *with their context*, materialize only **grounded** high-threshold edges into the repo graph, and plan each interview question by **walking the conversation graph** for missing context. Matching becomes structural traversal over those edges, not scalar scoring.

---

## Design

### 1. Contextual decomposition (the foundation)

Each answer's sentences break into a typed graph instead of flat tags:

> "At Streamline I rebuilt the ingestion layer, replacing RabbitMQ with Kafka because we needed ordered replay of clickstream data; p99 went 40ms→9ms"

```
(Maya) -[:DID]-> (Action: rebuilt ingestion layer) -[:AT]-> (Org: Streamline)
(Action) -[:REPLACED]-> (Tech: RabbitMQ)
(Action) -[:WITH]-> (Tech: Kafka)
(Action) -[:BECAUSE]-> (Reason: ordered replay of clickstream data)
(Action) -[:ACHIEVED]-> (Outcome: p99 40ms→9ms)
(Action) -[:IN_SITUATION]-> (Situation: high-throughput event ingestion)
```

Node types: `Action`, `Tech`, `Org`, `Person`, `Reason`, `Outcome`, `Situation`, plus existing `CulturalSignal`. Edge types: `DID`, `OBSERVED`, `WITH`, `REPLACED`, `BECAUSE`, `ACHIEVED`, `IN_SITUATION`, `AT`, `WITH_PERSON`.

**Embeddings carry context.** A `Tech` node embeds as its contextual phrase ("chose Kafka for ordered clickstream replay"), never the bare token ("kafka"). This is what creates separation in an embedding space that otherwise compresses everything to 0.73–0.87.

**Discard rule:** if a sentence yields no named entity, decision, or outcome ("worked with the team to solve problems"), nothing is stored. The graph only ever holds semantic value; the discard is itself the trigger to probe.

### 2. Grounded edge materialization (similarity is the mechanism, not the meaning)

Edges into the repo graph are written at ingest time as `(:CandidateNode)-[:SIMILAR_TO {grounding}]->(:RepoNode)`, only when BOTH:
- similarity clears a tight bar (calibrated start: ≥0.84, from the measured noise floor), AND
- the pair shares a concrete grounding: same named technology, same problem shape, or same architectural move (cheap LLM/lexical check over the two narratives).

Result: few, defensible edges, each explainable in one sentence ("her *replaced RabbitMQ with Kafka for ordered replay* connects to this repo's *Kafka async-messaging stack*"). No scores surface anywhere.

### 3. Question planning = walking the conversation graph

The planner's input each turn is the conversation graph itself (plus CV-derived nodes). Its instruction: find the highest-value missing context and ask for it, quoting the candidate:

- `Action` without `BECAUSE` → "You replaced RabbitMQ — what forced that decision?"
- `Action` without `ACHIEVED` → ask for the outcome
- `Outcome` without `DID` (claimed result, unclear ownership) → ask what part was theirs
- Dense region already covered → move to an untouched area of their experience (CV nodes with no conversation edges yet)

The opener is seeded from the CV graph when it exists (deepen the weakest valuable region) and falls back to the bank only for an empty graph. The STAR probe template bank is deleted; a probe happens only when the discard rule fired, is LLM-written, and quotes the candidate's words. One probe max per question.

Assessment rides on the same structure: `BECAUSE` edges show judgment, `DID` vs `OBSERVED` show ownership, `ACHIEVED` edges show impact — the scorer reads the graph rather than driving the questions.

### 4. Stopping

Stop when decomposition stops adding new material (consecutive turns yielding only discards/duplicates), within the existing min/max turn safety caps. No coverage thresholds, no question budget as the primary stop.

### 5. Structural matching (downstream)

Repo selection for code review = traversal: prefer the repo whose grounded edges to this candidate span **multiple distinct regions** (stack + architectural pattern + problem domain), not the repo with the most edges into one generic cluster. The pick is explained by listing its edges. The standalone path must pass the same candidate graph (today it falls back to smallest-PR selection — known gap).

### 6. Follow-up (explicitly out of scope here)

A recruiter-facing graph visualization (expandable conversation/candidate graph, cross-candidate view) — captured as the product goal this data model enables; not part of this ADR's implementation.

---

## Alternatives Considered

### Option A — Contextual conversation graph + grounded edges (chosen)
- **Pros:** No data loss from answers; embeddings that discriminate; few explainable edges; questions provably build context; assessment and matching read the same structure.
- **Cons:** Decomposition becomes load-bearing (extraction quality, one more LLM pass per turn); new node/edge vocabulary to maintain; grounding check adds latency at ingest.

### Option B — Coverage-summary planner (the previous draft of this ADR)
- **Pros:** Simpler planner input.
- **Cons:** Flattens the graph into counts/confidence before the planner sees it — discards exactly the semantics that matter; keeps scoring as the optimization target. Rejected on review.

### Option C — Raise the similarity threshold only, keep flat decomposition
- **Pros:** One-line change.
- **Cons:** Measured dead end: flat tags like `kafka (expert)` get 1 edge and `MSc` gets 0 at the tight threshold — without contextual nodes there is nothing left to connect.

---

## Rationale

The measurements close the argument: edge quality is bounded by node semantics, and node semantics are bounded by what the conversation extracts. Tightening thresholds without contextual decomposition starves the graph (Option C); summarizing the graph for the planner discards the signal (Option B). Making the conversation itself produce the contextual graph is the only path where every layer — questioning, assessment, edges, matching, and the future visualization — consumes the same structure.

---

## Consequences

### Positive
- Answers stop being flattened into tags; the "p99 40ms→9ms because ordered replay" context survives into the graph.
- Edges become sparse and explainable; matching becomes traversal with sentence-level justifications instead of opaque scores.
- Probes can no longer be generic: they are generated from a specific missing edge and quote the candidate.

### Negative / Trade-offs
- Two LLM passes per turn (decompose + plan) instead of one; mitigate by combining into a single structured call if latency demands.
- The 0.84 bar and grounding check are new tunables; miscalibration starves or floods the edge set.
- Existing flat `candidate_nodes` consumers need a compatibility view until migrated.

### Risks
- Extraction misses entities → over-probing; capped at one probe per question, with discard-rate telemetry.
- Embedding-model compression limits separation even with context → contextual phrases are the mitigation we control; model swap is the escape hatch.
- Edge vocabulary sprawl → start with the fixed set above; new edge types require an ADR amendment.

---

## Follow-up

- Implement contextual decomposition schema + extraction (foundation, first).
- Grounded edge materialization at ingest (`SIMILAR_TO` with grounding property, ≥0.84 + grounding check).
- Planner walks the conversation graph; delete STAR probe bank lookups.
- Structural multi-region repo pick; pass candidate graph through the standalone path.
- Graph visualization for recruiters (candidate graph + cross-candidate view) — separate design.
