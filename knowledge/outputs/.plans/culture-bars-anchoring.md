# Research Plan: Culture/Behavioral BARS + Anchoring

**Slug:** `culture-bars-anchoring`
**Date:** 2026-04-08
**Lead:** Claude Opus 4.6 (1M)
**Parent plan:** `knowledge/STRATEGY.md` — extends BC-2, BC-4, BC-5, BC-19, BC-38

---

## Core question

How do we construct Hodges-compliant, behaviorally-anchored rating scales (BARS) for PIPE's 5 behavioral competencies and 5 culture dimensions, with 3-shot L/M/H calibration exemplars per dimension, that can hit QWK ≥ 0.60 under LLM scoring?

## Context — why this research is justified

The 2026-04-07 behavioral/culture brief (`knowledge/outputs/behavioral-culture-interview-agent.md`) delivered 48 sources but only a **single generic 5-point BARS template** (§6.2) applied to every question — specificity-of-STAR-response. The code-review brief (2026-04-08) delivered **6 dimensions × 5 concrete observable-behavior anchors**, grounded in Hodges + practitioner literature. The culture pillar has no parallel artifact.

STRATEGY.md Phase 1 "Next concrete action" names the code-review BARS YAML as the first deliverable. This research produces the equivalent *inputs* for a culture BARS YAML.

Additionally, the behavioral brief carries a load-bearing **[UNSOURCED] Maurer 2002** claim on BARS equalizing rater quality. This research resolves that.

## Sub-questions

1. **Anchor-writing methodology for soft skills.** What is the rigorous protocol for deriving Hodges-compliant behavioral anchors for *soft-skill* dimensions (not clinical OSCE)? Smith & Kendall retranslation? Critical Incident Technique? How are level descriptors kept observable and non-evaluative? How is verbosity bias mitigated at the anchor level?

2. **Per-competency published anchors.** For ownership, collaboration, learning orientation, conflict handling, self-awareness: what validated anchor language exists in competency frameworks (Lominger / Korn Ferry, SHL UCF, DDI, Hogan, NEO-PI work-style facets, published IO validation studies)?

3. **Per-culture-dimension anchor sources.** For autonomy preference, risk tolerance, collaboration style, work pace, feedback orientation: what validated instruments (OCAI, Denison, GLOBE, Cameron & Quinn, Hofstede, Big Five work facets) supply anchor language? Which dimensions lack good instrument backing and must be anchored from practitioner sources?

4. **3-shot calibration exemplar protocol.** How are L/M/H exemplars constructed for LLM scoring prompts in the IO / AI-judge / educational-rubric literature? What are the documented failure modes (exemplar anchoring effect, length bias, generic-to-specific collapse)?

5. **Reality Monitoring + STAR specificity as anchor elements.** How do episodic-specificity NLP signals operationalize as observable anchor components, not just scoring bonuses?

6. **QWK / κ benchmarks per BARS design.** What reliability numbers do *published* behavioral BARS achieve with LLM judges? What's the realistic ceiling to target pre-calibration?

## Strategy

**4 parallel researchers, 1 round expected, up to 2.**

| ID | Owner | Dimension | Scope (disjoint) |
|---|---|---|---|
| R1 | researcher | **IO psych BARS methodology** | Smith & Kendall retranslation, CIT, Hodges translation to soft skills, anchor-writing rules, verbosity-bias mitigation, source the [UNSOURCED] Maurer 2002 claim. NO competency-specific content. |
| R2 | researcher | **Competency frameworks + published BARS** | Lominger, Korn Ferry, SHL UCF, DDI, Hogan, academic validation studies — ownership / collaboration / learning orientation / conflict handling / self-awareness. NO culture dimensions. NO methodology theory. |
| R3 | researcher | **Culture dimension instruments** | OCAI, Denison, GLOBE, Cameron & Quinn, Hofstede, Big Five work facets — autonomy / risk / collaboration style / pace / feedback. NO behavioral competencies. NO methodology theory. |
| R4 | researcher | **LLM judge calibration + exemplars** | 3-shot L/M/H exemplar protocol, CoMAI, EasyMED, Llama-4 Maverick QWK, Reality Monitoring operationalization, κ benchmarks for LLM-scored behavioral interviews. NO competency content. |

## Acceptance criteria

- [ ] Each of the 10 dimensions (5 behavioral + 5 culture) has ≥ 2 independent sources supplying anchor language, OR an explicit "no validated source found — derive from practitioner literature" finding with named practitioner sources
- [ ] Anchor-writing methodology produces an operational protocol (not just "write observable behaviors")
- [ ] 3-shot exemplar construction has an operational protocol with cited failure modes
- [ ] QWK / κ benchmark range is established from ≥ 3 published studies
- [ ] Every critical claim has ≥ 2 independent sources; no load-bearing [UNSOURCED] tags
- [ ] The [UNSOURCED] Maurer 2002 claim from the parent brief is either sourced or explicitly removed
- [ ] All URLs verified during verifier pass

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | R1 | BARS methodology for soft-skill anchoring | todo | `culture-bars-anchoring-research-methodology.md` |
| T2 | R2 | Published competency BARS (5 behavioral) | todo | `culture-bars-anchoring-research-competencies.md` |
| T3 | R3 | Culture-dimension instruments (5 culture) | todo | `culture-bars-anchoring-research-culture-dimensions.md` |
| T4 | R4 | LLM judge calibration + 3-shot exemplars | todo | `culture-bars-anchoring-research-calibration.md` |
| T5 | Lead | Synthesize draft | todo | `.drafts/culture-bars-anchoring-draft.md` |
| T6 | verifier | Cite + verify URLs | todo | `culture-bars-anchoring.md` |
| T7 | reviewer | Evidence integrity check | todo | `culture-bars-anchoring-verification.md` |
| T8 | Lead | Deliver + provenance | todo | `culture-bars-anchoring.provenance.md` |

## Verification log

| Item | Method | Status | Evidence |
|---|---|---|---|
| Maurer 2002 claim | researcher R1 | pending | — |
| QWK ≥ 0.60 achievability | researcher R4 | pending | — |
| Per-dimension source coverage | Lead review after R2 + R3 | pending | — |
| All URLs resolve | verifier pass | pending | — |
| No single-source critical claims | reviewer pass | pending | — |

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-08 | Research scope = BARS inputs only, NOT the YAML rubric itself | Keep research reusable; YAML is a separate execution step where anchor language is reviewed line-by-line |
| 2026-04-08 | 5 behavioral + 5 culture dimensions locked to existing brief §6.3 and `knowledge/culture/dimensions/` | Do not redesign the dimension set in this loop — that would re-open BC-39 |
| 2026-04-08 | All researchers on Sonnet 4.6 | Founder directive: use Sonnet, not Opus, for researcher subagents |

## Out of scope (explicit)

- Writing the YAML rubric file (separate execution step)
- Redefining the 5 behavioral or 5 culture dimensions
- Re-running the core validity literature (covered in the 2026-04-07 brief)
- EU AI Act / AIVIA compliance (covered in BC-28/30, separate track)
- Probe generator design (BC-11/12/13, separate track)
