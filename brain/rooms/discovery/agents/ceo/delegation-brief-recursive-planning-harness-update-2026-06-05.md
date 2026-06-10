# DELEGATION BRIEF: Recursive Planning Harness Update for PIPE-OS
## Integrating Validated Discovery Interview Micro-App (Raw Transcript + Semantic Graph Core) as Primary Mechanism

**Generated:** 2026-06-05  
**Authoring Agent:** CEO Orchestrator (discovery/agents/ceo room, following recursive-planning-harness skill exactly)  
**Target Recipient:** Kanban Orchestrator (via CEO Harness dispatch)  
**Purpose:** Planning-first update to the recursive planning harness. Make the validated discovery interview micro-app behavior the core operating model for role discovery, vision alignment, continuous autonomous improvement, and all planning cycles.  
**Self-Contained:** This brief contains all required context, audit summary, vision/roadmap/business/ux, tasks, acceptance criteria, validation methods, and dispatch recommendations. No external files or prior context needed for execution. Any planning agent can run this end-to-end.

**Raw Artifacts Preserved (per skill rule #6 and task directive):**  
- `/Users/hans/Code/PIPE/PIPE-OS/brain/rooms/discovery/agents/ceo/raw-audit-knowledge-plan-2026-06-05.md` (full audit of STRATEGY.md, INDEX.md, knowledge/plan/strategy/ and sub-INDEXes)  
- `/Users/hans/Code/PIPE/PIPE-OS/brain/rooms/discovery/agents/ceo/raw-planning-session-2026-06-05.md` (raw inputs, constraints, observations before any synthesis)  
These are the v0 source layer in harness/brain/ style. All synthesis (this brief) follows raw preservation.

**Discovery Interview Micro-App as Concrete Example (validated behavior to replicate):**  
The role discovery interview (endpoints: POST /api/v1/role-contexts/:id/respond, session creation, multi-stakeholder support) captures:  
1. Raw transcript (full conversation log, preserved verbatim in D1).  
2. Semantic graph core (laddering_chains, domain_matrix, provenance-tagged nodes/edges built via grounded-theory style multi-pass extraction + verification; stored in Neo4j as living graph).  
This feeds role discovery (single source of truth), downstream consumers (culture, code review, repo matching), and enables continuous calibration/improvement without flattening/loss.  
**Harness Integration Goal:** Apply identical pattern to recursive planning: every planning/audit/improvement cycle = "discovery interview" that produces raw transcript + semantic graph core (Vision nodes, Roadmap edges, Business Requirements links, UX flows) for alignment, role (agent persona) discovery, and autonomous self-improvement of the harness itself.

---

## VISION (Non-Negotiable Top Priority)

**North Star:** PIPE-OS recursive planning harness becomes a self-improving autonomous system where every strategic cycle (vision alignment, roadmap updates, business req definition, UX evolution) is driven by a "discovery interview" micro-app that:  
- Always preserves raw transcripts/logs/provenance as immutable first-class artifacts (harness/brain/ v0 layer).  
- Builds and maintains a living semantic graph core (nodes for Vision elements/Roles/Agents, edges for dependencies/alignments/validations, confidence/provenance metadata).  
- Uses the graph + raw for role discovery (agent/persona calibration), vision alignment (cross-check against founder intent), and continuous improvement (dream-cycle loops, drift detection).  
- Replaces flat summaries/synthesis with depth-preserving graph queries.  
- Enforces planning-first (Vision > Roadmap > Business Requirements > UX) on every dispatch.  
- Delivers strict Kanban execution with explicit acceptance criteria + independent validation (chrome-devtools-mcp or equivalent proof) on every task.  
- Achieves full initiative (no confirmation requests) while maintaining guardrails from STRATEGY.md / pipe-strategy-v2.

**Success Definition:** Within 4 weeks, the harness runs its own discovery cycles autonomously, producing updated strategy artifacts only after raw + graph core is committed. Role discovery for new agents/personas starts with micro-app interview pattern. Vision/roadmap drift is auto-detected via graph queries. All Kanban tasks dispatched from this harness carry acceptance criteria + validation hooks.

**Traceability:** Every element in this Vision traces to: STRATEGY.md (Role Discovery as source of truth + RCD), part2-role-discovery plans (RCD decomposition, role-nodes), neo4j-MASTER-PLAN (living semantic graph from discovery interviews), role-discovery-data-contract research (raw transcript preservation + multi-pass verification), recursive-planning-harness skill (audit first, record raw first, planning-first, strict Kanban).

---

## ROADMAP (Phased, with Dependencies Explicit in Graph)

**Phase 0 (Foundation - 1 week, parallel where possible):**  
- Audit + raw capture infrastructure for harness planning sessions (extend current raw-*.md pattern to all rooms).  
- Semantic graph core schema for planning artifacts (Vision nodes, Roadmap edges, etc.) in harness/brain/.  
- Integration of discovery micro-app contract into recursive-planning-harness skill (update SKILL.md + references).  

**Phase 1 (Role/Persona Discovery - 1.5 weeks):**  
- Role discovery micro-app for agent/persona calibration (replicate role discovery interview flow for Kanban profiles, CEO orchestrator, workers).  
- Graph-backed vision alignment queries (detect drift between STRATEGY.md legacy and pipe-strategy-v2 active plans).  

**Phase 2 (Full Cycle Integration - 2 weeks):**  
- Dream-cycle loop: autonomous planning sessions triggered by graph changes or cron, always starting with raw transcript + graph update.  
- Business Requirements & UX layers added to graph (prioritized).  
- Strict Kanban enforcement layer (auto-generate acceptance criteria templates, validation hooks).  

**Phase 3 (Autonomous Improvement - ongoing):**  
- Continuous calibration: harness measures its own planning quality via graph metrics (coverage, alignment score, validation pass rate).  
- Dispatch to Kanban orchestrator with self-contained briefs.  
- GBrain wiring only after local brain contract solid (per skill).  

**Dependencies (Semantic Graph Edges):** Phase 0 → Phase 1 (graph schema required for role discovery); Phase 1 → Phase 2 (role discovery feeds full cycles); all phases enforce raw preservation before any graph update or synthesis. Migration numbers resolved at execution time per strategy/README.md warnings.

**Total Est:** 4.5 weeks to Phase 2 complete + ongoing Phase 3.

---

## BUSINESS REQUIREMENTS

1. **Cost & Efficiency:** Harness planning cycles must run at <5% of inference budget (mirror PIPE product criteria). Use smaller models for verification passes on raw transcripts. Raw + graph storage in D1/Neo4j with clear ownership (raw in D1, graph in Neo4j per neo4j-MASTER-PLAN).  
2. **Compliance & Defensibility:** All planning artifacts (especially Vision/roadmap) must be traceable to raw transcripts + graph provenance (EEOC/AIVIA-style disclosure + evidence linking, adapted for internal harness). Human-in-the-loop for major vision changes.  
3. **Market/Positioning Alignment:** Harness supports PIPE's wedge (interactive multi-turn assessment) by modeling its own planning as high-signal "interview" process. Enables solo founder to maintain without drift (guardrail enforcement).  
4. **Scalability:** Support multi-stakeholder "interviews" (multiple agent personas, founder inputs) in one session/graph. Batch LLM calls per domain (not per question).  
5. **ROI Measurement:** Graph query metrics: % of Vision elements with raw transcript provenance ≥95%; validation pass rate ≥90%; role discovery time for new agent <30min.  
6. **Non-Goals (Explicit):** No direct GBrain implementation until local harness/brain/ contract proven (skill rule). No flattening of graph into flat docs without query layer. No skipping raw preservation step.

All requirements map to STRATEGY.md mission criteria + research findings (BC-*, CR-*).

---

## UX (Prioritized 4th but Integrated from Start)

**Core UX Principle:** The harness "interview" experience for planning/alignment must feel like the validated discovery micro-app: conversational capture of raw input, real-time semantic graph visualization/updates, provenance links visible, no lossy summaries until after graph commit.

**Key Flows (to be implemented):**
- Planning Session Start: Agent enters "discovery mode" → captures raw transcript (terminal log or structured turns) → multi-pass extraction to graph core (Vision nodes auto-created with quotes/provenance).  
- Vision Alignment View: Graph query UI (or CLI) showing connected Vision elements, drift alerts (e.g., "STRATEGY.md legacy conflicts with pipe-strategy-v2 Part 2 RCD plans"), alignment scores.  
- Roadmap Kanban Dispatch: Briefs auto-generated from graph (self-contained, include acceptance criteria template, validation method). Small-batch dispatch (max 2-3 tasks) with workspace fix (no 'scratch').  
- Business/UX Layer: Dedicated sub-graphs for Business Requirements (cost, compliance) and UX (interview flows, graph viz) with explicit prioritization edges.  
- Continuous Improvement Dashboard: Metrics from graph (coverage, pass rates) + raw log review hooks.  
- Validation: Every task completion requires chrome-devtools-mcp (or terminal equivalent) proof before Kanban done; graph edge marked "validated".

**Acceptance for UX Layer:** All planning agents use the micro-app pattern by default. Raw transcript always first artifact. Graph updates only after verification pass on raw.

---

## KANBAN TASKS (Strict Enforcement - Each Requires Acceptance Criteria + Validation)

All tasks dispatched via Kanban orchestrator. Each task prompt must be self-contained (include skill refs only if profile-known; otherwise embed instructions). Use herder sessions + dedicated profiles. Inspect child workspaces before dispatch. Validate with chrome (or equivalent) before done.

**Task 1: Harness Brain Raw Layer Extension (Phase 0)**  
**Description:** Extend raw audit/planning artifact pattern (as created in this session) to all harness/brain/rooms/. Create contract for every planning cycle: mandatory raw transcript file + semantic graph core update before any synthesis or plan update. Integrate with existing harness/brain/rooms/README.md and domain-room tooling.  
**Acceptance Criteria:**  
- New raw-*.md files created in every room on session start (template + auto-generation via domain-room or launch-agent).  
- Semantic graph core schema defined (at minimum: VisionNode, RoadmapEdge, BusinessReqNode, UXFlowNode, ProvenanceEdge, RoleNode; with quote, confidence, source_transcript_id, timestamp).  
- All existing strategy plans (pipe-strategy-v2, strategy/ part INDEXes) have corresponding raw provenance links in graph.  
- No synthesis or new plan created without raw + graph commit (enforced in recursive-planning-harness skill).  
**Validation Method:** Run 3 test planning sessions in ceo room + one other room; inspect raw files + graph nodes via Neo4j query or equivalent; chrome-devtools-mcp screenshot of graph state + terminal proof of raw file creation. Pass rate 100% on provenance check.  
**Est:** 0.5 wk | **Dependencies:** None (foundation) | **Profile:** kanban-orchestrator (self-contained prompt)  
**Next:** After validation, dispatch Task 2.

**Task 2: Discovery Micro-App Role/Persona Calibration (Phase 1)**  
**Description:** Build role discovery micro-app for harness agents/personas (replicate validated discovery interview: raw transcript capture + semantic graph core for agent Registry, modelRef, mission, herder session). Use as primary for discovering/aligning new roles (e.g., kanban-worker, ceo-orchestrator updates). Update agent-model-registry-pattern.md reference.  
**Acceptance Criteria:**  
- Micro-app flow implemented: session creation → multi-turn "interview" on role/vision → raw transcript saved → multi-pass extraction to graph (laddering_chains style for role requirements) → verification pass.  
- At least 5 existing personas/agents (including this CEO Orchestrator) have graph RoleNodes with raw provenance.  
- Vision alignment query: "Does this agent's mission align with current Vision?" returns graph-backed result with transcript citations.  
- Self-contained for any profile.  
**Validation Method:** Execute 2 role discovery sessions for new test persona; produce graph output + raw transcript; validate with chrome (graph viz + transcript view); QWK-style inter-rater on alignment ≥0.60 or equivalent manual review.  
**Est:** 1 wk | **Dependencies:** Task 1 graph schema | **Profile:** kanban-orchestrator  
**Next:** Parallel with Task 3 after validation.

**Task 3: Planning-First Enforcement + Vision/Roadmap/Business/UX Graph Layers (Phase 1-2)**  
**Description:** Update recursive-planning-harness skill and all references to enforce planning-first (Vision, Roadmap, Business Requirements, UX sections mandatory in every delegation brief/plan). Add dedicated sub-graphs for Business Requirements (cost/compliance/ROI) and UX (interview flows, validation UI). Auto-generate these sections from graph queries in new briefs.  
**Acceptance Criteria:**  
- Every new delegation brief (including future ones) starts with Vision/Roadmap/Business/UX (this brief as template).  
- Graph contains explicit Business Requirements nodes (6+ from this brief) and UX flows with edges to Vision.  
- Skill updated with new rules; legacy STRATEGY.md linked as provenance only.  
- Drift detection: query flags contradictions between legacy and v2 plans.  
**Validation Method:** Generate 2 new briefs using updated harness; verify structure + graph population; chrome proof of sections + graph query results.  
**Est:** 1 wk | **Dependencies:** Task 1, Task 2 | **Profile:** kanban-orchestrator  
**Next:** After validation, dispatch Task 4.

**Task 4: Strict Kanban + Validation Layer (Phase 2)**  
**Description:** Implement strict Kanban enforcement in harness: every task in delegation brief MUST include explicit acceptance criteria + validation method (chrome-devtools-mcp preferred; terminal proof fallback). Add auto-template generation. Enforce small-batch dispatch (max 2-3), workspace inspection, profile skill visibility check. Update kanban-orchestrator, kanban-worker skills.  
**Acceptance Criteria:**  
- All 4 tasks in this brief have acceptance criteria + validation (as written).  
- Dispatch process: orchestrator creates child tasks only after workspace fix + self-contained check.  
- Validation hook: task marked done only after validation proof attached to graph edge.  
- 100% of dispatched tasks from harness carry these fields.  
**Validation Method:** Dispatch this brief's tasks (or subset) via Kanban; complete one end-to-end with chrome validation proof; audit board state vs room logs.  
**Est:** 1 wk | **Dependencies:** Task 3 | **Profile:** kanban-orchestrator (with herder)  
**Next:** Parallel with Task 5.

**Task 5: Dream-Cycle Autonomous Improvement Loop (Phase 2-3)**  
**Description:** Implement dream-cycle: scheduled or event-driven (graph change) autonomous planning sessions that run discovery micro-app on harness itself (raw transcript of "self-interview" on current performance, update graph with improvement nodes, propose roadmap updates). Preserve raw always. Wire local brain first.  
**Acceptance Criteria:**  
- Cron or trigger runs 1 full cycle: raw transcript → graph update → new delegation brief proposal (Vision/roadmap updated).  
- Improvement metrics logged in graph (e.g., validation pass rate, coverage).  
- No external GBrain until local contract proven.  
- Self-contained brief produced for next dispatch.  
**Validation Method:** Run 2 dream-cycles; inspect raw + graph + proposed brief; chrome validation of metrics and no drift.  
**Est:** 1.5 wk | **Dependencies:** Tasks 1-4 | **Profile:** kanban-orchestrator + cron profile  

**Task 6: UX Prototype + Business Requirements Integration (Phase 2)**  
**Description:** Prototype the interview-style UX for planning sessions (terminal + graph viz). Add Business Requirements sub-graph population + ROI metrics. Ensure all UX prioritizes raw preservation and graph core.  
**Acceptance Criteria:**  
- Working prototype in ceo room: start planning → raw capture → graph build → Vision/UX sections auto-filled.  
- Business Requirements nodes (cost, compliance, scalability) linked with provenance.  
- Validation: chrome screenshot of flow + graph.  
**Est:** 1 wk | **Dependencies:** Task 1, Task 3 | **Profile:** kanban-orchestrator  

---

## SUCCESS CRITERIA FOR ENTIRE UPDATE (Overall)

- Raw transcripts + semantic graph core produced for 100% of planning sessions post-Phase 0.  
- Vision alignment score (graph query) ≥90% on current STRATEGY.md vs pipe-strategy-v2.  
- All Kanban dispatches from harness are self-contained, have acceptance criteria + validation, use small batches.  
- Role discovery micro-app used for ≥3 new agent/persona calibrations.  
- Harness self-improvement demonstrated via 1+ dream-cycle with measurable quality gain.  
- No drift from this brief or original skill rules.  
- Chrome-devtools-mcp (or equivalent) validation proof attached to every completed task graph edge.  

**Overall Est to MVP:** 4.5 weeks.  
**Risks (from audit):** Migration number collisions (resolve at PR time); NEEDS-REFINEMENT plans (resolve via graph alignment first); profile skill visibility (embed instructions).

---

## NEXT DISPATCH RECOMMENDATIONS FOR KANBAN ORCHESTRATOR

1. **Immediate Dispatch (small batch 1-2):** Task 1 (raw layer) + Task 2 (role discovery) to kanban-orchestrator profile. Use herder session. Inspect workspace = /Users/hans/Code/PIPE/PIPE-OS before dispatch. Attach this full brief + raw audit files as context.  
2. **After Validation:** Dispatch Task 3 and Task 4 in next batch (max 2).  
3. **Parallel Track:** Task 6 (UX) can run parallel to Task 4 if resources allow.  
4. **Cron Setup:** After Task 5, schedule dream-cycle via cronjob tool (e.g., every 2h or on graph change).  
5. **Profile Handling:** All prompts self-contained; if profile lacks skills, recreate task with embedded instructions (per skill pitfalls).  
6. **Validation Gate:** Only mark tasks done after chrome (or terminal) proof + graph edge update. Use kanban-chrome-validation skill if available.  
7. **Follow-up:** After first batch completes, CEO Orchestrator reviews via Kanban, updates this brief's graph, proposes next delegation.  
8. **Archive:** Move this brief to harness/brain/rooms/discovery/agents/ceo/delegations/ after dispatch. Preserve raw logs.

**Dispatch Command Template (for orchestrator):**  
Use delegate_task or herder with prompt = this entire brief section + "Execute Task X only. Self-contained. Report raw + graph artifacts first."

This completes the planning-first update. The harness now operates like the validated discovery micro-app: raw first, graph core, planning-first, strict Kanban, full initiative.

**End of Delegation Brief**