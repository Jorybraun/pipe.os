# PIPE Business Requirements

## Core Value Proposition
Pipe delivers meaningfully better hiring outcomes by replacing resume parsing and generic rubrics with evidence-grounded, per-element matching on a living candidate graph. This reduces false negatives for qualified candidates and expensive mis-hires for companies.

## Key Business Goals
- **Auditable decisions:** Match reports with full evidence attribution (not opaque scores) that recruiters and hiring teams can trust and override.
- **Living profiles:** Candidate graphs accumulate signal over time across multiple interactions and data sources, enabling ongoing relationships rather than one-shot applications.
- **Structural richness:** Decomposition of roles (RCD), repos (Pass-3 sub-elements), and candidates into addressable sub-elements enables precise alignment that flat embeddings cannot achieve.
- **Compliance and defensibility:** Dealbreaker enforcement, compliance audit trails (Griggs, EEOC, NYC Local Law 144, EU AI Act), HITL gates where appropriate.
- **Scalable infrastructure:** Self-hosted Neo4j (~€25-50/mo) + Cloudflare stack for the next 18 months of operation.

## Target Users
- Recruiters and hiring teams at tech companies seeking high-signal developer hiring.
- Candidates who want their full professional signal (not just resume) to be considered.
- Engineering organizations that value auditable, explainable matching.

## Success Metrics (to be refined in Phase 6)
- Improved match quality (higher precision/recall vs legacy methods, validated via kappa studies and recruiter feedback).
- Reduced time-to-hire and mis-hire costs.
- Recruiter adoption of match reports over raw scores.
- Candidate engagement and profile depth growth over time.
- Infrastructure cost stability and performance at target scale.

## Constraints and Guardrails
- Legal defensibility of automated decisions is non-negotiable (no auto-fail on dealbreakers without human review where required).
- Cost sensitivity: lean operation, minimal active agents, prefer Codex lanes for implementation.
- Self-improving: The PIPE harness (recursive planning + Kanban swarm) must continuously improve its own plans, decomposition quality, and validation.
- No credentials in env for e2e; source from e2e/ folder.

## Market Context (from Part 6)
- Calibration studies (Kappa, QWK).
- ESCO skill standardization.
- Fairness/legal compliance research.
- Learning-to-rank infrastructure for future optimization.

**Last Updated:** 2026-05-28 (Synthesized from pipe-strategy-v2-part1 and part6-market-research after full knowledge/plan audit)
**Status:** Living document. Update with new market research, customer feedback, and business learnings. Prioritize before any feature work.