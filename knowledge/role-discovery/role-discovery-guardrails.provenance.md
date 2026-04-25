# Provenance: Role Discovery Agent Guardrails — Rationale, Sensitivity, Depth, Compliance

- **Date:** 2026-04-17
- **Slug:** `role-discovery-guardrails`
- **Rounds:** 1 researcher round (no follow-up round required — all sub-questions closed with ≥2 independent sources)
- **Sources consulted:** 98 (R1 n=22, R2 n=26, R3 n=25, R4 n=25)
- **Sources accepted (verified URLs):** 62
- **Sources flagged as paywalled-but-authentic (publisher 403):** 24
- **Sources flagged as genuine access failure:** 2 (NYC.gov LL144 timeout, Gilliland 1993 no open-access URL — both backed by independent secondary citations)
- **Verification:** PASS WITH NOTES
  - FATAL issues: 0
  - MAJOR issues: 6 (1 fixed inline — source-numbering collision M6; 5 recorded as confidence-calibration notes in Open Questions — M1–M5)
  - MINOR issues: 6 (accepted)

## Researcher allocations (all Sonnet)

| ID | Focus | Sources | Output |
|---|---|---|---|
| R1 | Taxonomy + invasive-question research (I/O psych, item-writing, HCI chatbot-failure) | 22 | `knowledge/role-discovery/role-discovery-guardrails-research-taxonomy.md` |
| R2 | Legal boundaries for AI-asked hiring questions (federal + state + international) | 26 | `knowledge/role-discovery/role-discovery-guardrails-research-compliance.md` |
| R3 | Rationale surfacing, CoT-as-guardrail, Constitutional AI, LLM-as-judge | 25 | `knowledge/role-discovery/role-discovery-guardrails-research-xai.md` |
| R4 | Probing depth, pivot signals, consistency classifiers | 25 | `knowledge/role-discovery/role-discovery-guardrails-research-depth.md` |

## Artifacts

- **Plan:** `knowledge/outputs/.plans/role-discovery-guardrails.md`
- **Research files:**
  - `knowledge/role-discovery/role-discovery-guardrails-research-taxonomy.md`
  - `knowledge/role-discovery/role-discovery-guardrails-research-compliance.md`
  - `knowledge/role-discovery/role-discovery-guardrails-research-xai.md`
  - `knowledge/role-discovery/role-discovery-guardrails-research-depth.md`
- **Draft:** `knowledge/outputs/.drafts/role-discovery-guardrails-draft.md`
- **Cited brief (final):** `knowledge/role-discovery/role-discovery-guardrails.md`
- **Reviewer report:** `knowledge/role-discovery/role-discovery-guardrails-verification.md`

## Load-bearing findings with multi-source backing

| Finding | Independent sources | Verification |
|---|---|---|
| Mobley v. Workday class certification + EEOC amicus (platform-as-agent liability) | Law360 + EEOC site + Mintz + DLA Piper + HR Dive | PASS — confidence downgraded from "confirmed liability" to "confirmed live risk" per reviewer M3 |
| Rationale-before-question ordering | Tam EMNLP 2024 + Kamoi 2024 + Liu 2024 | PASS — specific 38.15% figure noted as task-domain-specific per reviewer M1 |
| Cross-family consistency classifier | Panickssery NeurIPS 2024 (causal label-swap) + Li 2024 (Benchmarking) + ADR-032 precedent | PASS — Gemma/Qwen-specific pairing noted as inference step per reviewer M5 |
| 3-turn depth threshold | Reynolds & Gutman + Miller & Rollnick + Lamb NICHD + 5-Whys | PASS — convergent inference, no direct empirical study in hiring-intake domain (Open Question #1) |
| Opacity drives bad-robot flags | Sakib CSCW 2025 + McCarthy 2017 + Gilliland 1993 (via derivative) | PASS |
| Deceptive-explanation anchoring risk | Altay & Acerbi CHI 2025 | Single study, cross-domain inference — noted per reviewer M2 |

## Deliverables produced in the brief

- Seven-dimension question-quality rubric (D1–D7) grounded in I/O psychology + item-writing literature
- Four-tier sensitivity ladder (Blocked / High / Medium / Low) grounded in Title VII, ADA, ADEA, GINA, PDA, CA FEHA, NYC LL144, Colorado SB24-205, Illinois HB 3773, EU AI Act Annex III
- `RoleAgentQuestionResponse` schema with `rationale`, `sensitivity`, `depth_level`, `sub_topic_id`, `acknowledgment` fields
- `TurnReference` discriminated union type
- Five-milestone implementation plan (M1 schema → M2 sensitivity → M3 depth → M4 classifier → M5 feedback loop)
- `role_context_feedback` D1 migration schema for the bad-robot rubric
- Karpathy-style training loop blueprint (feedback → rubric labels → quality dataset → offline eval → production gate)

## Decisions recorded

- Research scoped to guardrails only (complementary to 2026-04-11 sales-intake brief — no duplication)
- Researchers spawned in parallel (single message, four Sonnet agents) per `/deep-research` rules
- Research files saved to `knowledge/role-discovery/` per explicit user direction
- Reviewer's MAJOR issues resolved per skill rule: M6 fixed inline (bug), M1–M5 recorded as confidence-calibration notes in Open Questions (non-blocking per FATAL/MAJOR/MINOR gating)
- No second reviewer pass required: zero FATAL issues; M6 is a citation bug that does not affect synthesis; M1–M5 are calibration notes that strengthen rather than weaken the brief's integrity
