# Role Discovery + Repo Understanding Data Contract — Research Brief

**Date:** 2026-04-10
**Slug:** `role-discovery-data-contract`
**Plan:** `knowledge/outputs/.plans/role-discovery-data-contract.md`
**Research files:** R1 (methodology), R2 (culture), R3 (codereview), R4 (validation) — all in `knowledge/outputs/role-discovery-data-contract-research-*.md`
**Target deliverable:** Input to ADR-036 (Role Discovery + Repo Understanding Data Contract)
**Status:** Cited version — verifier pass complete, awaiting reviewer (T7)

---

## Executive Summary

Two drifts in the PIPE platform need to be closed at the same time, with one coherent data contract. On the interview side, the Role Discovery agent is doing the design-thinking work correctly in real time (six domains, laddering via Means-End Chain Theory, multi-stakeholder variants per ADR-028), but the synthesis step collapses all of that depth into an 8-field `CandidatePersona` that every downstream consumer reads in preference to the persisted Knowledge State. On the repo side, the crawler has produced a rich deterministic substrate (`qualified_repos`, `repo_skills`, `repo_constructs`, `repo_sample_prs`) but nothing in the platform reasons over it with a role in mind — `matchRepos.ts` is a SQL CTE keyword join. This brief proposes a single architectural move — co-designed schemas and a versioned contract — that fixes both halves together so they cannot drift apart again.

The core recommendation is structural. The Role Context Document (RCD) becomes a **per-stakeholder × per-domain matrix** whose cells contain laddering chains (`attribute_quote` → `consequence` → `value`), with a derived `consumer_slice` replacing the flat `CandidatePersona`. This is grounded in the framework analysis method [R1-S4] [R1-S17] crossed with IPA's evidence-anchor pattern [R1-S5] and Reynolds & Gutman's laddering directionality [R1-S6]. The Repo Understanding Contract (RUC) becomes a **two-stage pipeline**: an offline Pass 3 writes role-agnostic `repo_engineering_signals` (Claude Haiku 4.5, queue consumer, amortized once per repo); a runtime Worker reads the RCD's structured `technical_context` and the top-N signals rows to write cached `repo_role_alignment` records (score + `justification_json`) on Workers AI Gemma 4. This architecture is supported by the two-stage retrieval literature [R3-S18] [R3-S21] [R3-S22].

The supporting research answers the eight remaining questions in a way that lets the ADR be written without guessing. Team-culture signals collapse to five dimensions (OCAI's four archetypes plus psychological safety [R2-S7] [R2-S10]) used to profile the *team* rather than to score the *candidate*. BARS anchor calibration is done with a universal base rubric plus per-dimension text overrides derived from the RCD's laddering chains, preserving cross-candidate comparability while satisfying the Uniform Guidelines content-validity standard [R2-S11] [R2-S15]. Probe generation is hybrid static (role-setup-time enrichment, not per-candidate dynamic), which is the only design that survives the EU AI Act Article 14 interpretability requirement and NYC Local Law 144 auditability rule [R2-S16] [R2-S17]. Dealbreakers propagate as an auto-flag-then-HITL gate, never auto-fail — the legal record (Griggs v. Duke Power [R2-S18], EEOC v. iTutorGroup [R2-S20], Mobley v. Workday [R2-S21], EU AI Act Article 14) is unambiguous that automated hard-rejection without human review is indefensible. Multi-stakeholder disagreement is preserved, not averaged — supervisor–peer correlations run at only ρ = .34 [R4-S1], meaning 89 % of rating variance is source-unique and genuinely informative. Validation at PIPE's early-customer volumes uses a staged evidence ladder from pre-deployment content validity through transportability analysis to late-stage criterion-suggestive evidence — built on the SIOP Principles' explicit endorsement of synthetic validity and transportability for small employers [R4-S13] [R4-S14] [R4-S17].

The full specification of both halves, their shared versioning contract, and the open questions the research could not resolve are below.

---

## Half 1 — The Role Context Document

### 1.1 Schema design: the framework-matrix pattern

The failure mode in PIPE's current synthesis step is a known pattern in qualitative research. Sixty years of methodology — grounded theory [R1-S1] [R1-S2], framework analysis [R1-S4] [R1-S17], interpretative phenomenological analysis [R1-S5] — has converged on the same structural answer: rich interview data must land in a schema that *preserves directionality and source provenance*, not in a schema that flattens them to lists. Each tradition contributes a different necessary piece.

**Grounded theory** provides three-level abstraction: open codes (raw transcript labels), axial codes (directional relationships between open codes), selective codes (a core category grounded in axial linkages). The critical property Charmaz [R1-S2] calls out explicitly is *abstraction closure prevention*: moving directly from open codes to final output without preserving axial linkages is the error mode PIPE has committed. The PIPE `CandidatePersona.mustHaveSkills: ["Kafka"]` synthesis is grounded-theory's abstraction-collapse mistake made at prompt-boundary scale.

**Framework analysis** provides the matrix artifact itself: rows = cases (stakeholders), columns = themes (six domains), cells = evidence-anchored summaries. Gale et al. (2013 [R1-S4]) document that framework analysis is specifically superior to thematic analysis when the research question requires comparison across cases and a predefined analytical framework exists. PIPE has four interviewee types (ADR-028) and six predefined domains — this is the canonical framework-analysis case. The matrix is the first-class artifact; any flattened view is derived.

**Interpretative phenomenological analysis** contributes the evidence-anchor requirement: every claim must be paired with a verbatim quote plus a turn reference. Smith, Flowers & Larkin (2009 [R1-S5]) document this as the mechanism that prevents researcher projection — the quote proves the theme was in the data, not imported from the analyst's prior expectations. Applied to LLM synthesis: the quote-plus-turn pairing is what makes automated verification possible downstream.

**Means-End Chain Theory** [R1-S6] contributes the laddering structure itself: attribute → consequence → value, strictly directional, with consequences further subdivided into functional (operational) versus psychosocial (identity/belief). The implication matrix Reynolds & Gutman specify is built *bottom-up from attributes*, never top-down from values. A synthesis prompt that starts from "what values does this team care about?" will project generic values rather than extract team-specific ones.

These four traditions compose into a single recommended schema. The matrix is the outer shell (framework analysis); the cells carry laddering chains (Means-End Chain); every node is evidence-anchored with a verbatim quote and turn reference (IPA); directional axial links between open codes within a cell capture the grounded-theory consequence linkages.

#### Recommended schema sketch

```json
{
  "role_context_document": {
    "version": "1.0",
    "rcd_version": 1,
    "pipeline_id": "...",
    "produced_at": "ISO-8601",

    "interview_summary": {
      "turn_count": 22,
      "stakeholders_interviewed": ["HIRING_MANAGER", "TEAM_MEMBER"],
      "domain_coverage": {
        "Why": "COMPLETE", "Work": "COMPLETE", "Team": "PARTIAL",
        "Bar": "COMPLETE", "Codebase": "COMPLETE", "Process": "PARTIAL"
      }
    },

    // Primary artifact — per-stakeholder × per-domain matrix
    "domain_matrix": {
      "HIRING_MANAGER": {
        "Codebase": {
          "summary": "...",
          "laddering_chains": [
            {
              "attribute": "Kafka",
              "attribute_quote": "We use Kafka to decouple services so teams ship independently",
              "attribute_turn": 7,
              "consequence": "Teams ship independently; blast radius contained",
              "consequence_type": "FUNCTIONAL",
              "value": "Patient safety through fault containment",
              "value_implication": "Assess on-call judgment and failure-mode reasoning",
              "energy_signal": "HIGH"
            }
          ],
          "open_codes": ["event-driven", "service-isolation", "HIPAA"],
          "axial_links": [
            { "from": "event-driven", "to": "service-isolation", "rel": "ENABLES" }
          ],
          "domain_value": "Reliability as patient-safety constraint",
          "primary_authority": "HIRING_MANAGER"
        },
        "Why":  { /* same structure */ },
        "Work": { /* same structure */ },
        "Team": { /* same structure */ },
        "Bar":  { /* same structure */ },
        "Process": { /* same structure */ }
      },
      "TEAM_MEMBER": {
        // Same six-domain structure, separate cells
      }
    },

    // Cross-stakeholder conflict record (first-class, not averaged)
    "conflicts": [
      {
        "domain": "Team",
        "field": "collaboration_style",
        "hm_claim": "async-first, no synchronous standups",
        "hm_quote": "...",
        "hm_turn": 12,
        "tm_claim": "ad-hoc Slack interruptions, high synchronous load",
        "tm_quote": "...",
        "tm_turn": 9,
        "resolution": "UNRESOLVED",
        "scoring_note": "Use team member's account as ground truth for day-to-day culture"
      }
    ],

    // Structured technical context — direct input to runtime repo rerank
    "technical_context": {
      "architecture_style": "microservice",
      "testing_culture": "integration_heavy",
      "pr_size_band": "medium",
      "review_culture": "rigorous",
      "complexity_tolerance": "medium"
    },

    // Team-culture profile (five signals — R2 §Q2)
    "team_culture_profile": {
      "clan": 3,
      "adhocracy": 4,
      "market": 2,
      "hierarchy": 1,
      "psychological_safety": 5,
      "source_stakeholder": "TEAM_MEMBER"
    },

    // BARS anchor overrides (per-dimension, per-level text — R2 §Q4)
    "bars_overrides": {
      "ownership": {
        "5": {
          "anchor": "Pushes back on product managers when the spec conflicts with on-call reliability; example from interview turn 14",
          "evidence_source": "HIRING_MANAGER.Bar.laddering_chains[0]"
        }
      }
    },

    // Probe bank enrichment (role-setup-time only, not per-candidate — R2 §Q5)
    "probe_bank_enrichment": [
      {
        "dimension": "conflict_handling",
        "probe_text": "Tell me about a time a launch deadline conflicted with reliability concerns you had.",
        "evidence_chain": "HIRING_MANAGER.Bar.laddering_chains[0]",
        "probe_id": "pe_001"
      }
    ],

    // Dealbreakers with HITL gate metadata (R2 §Q9)
    "dealbreakers": [
      {
        "criterion": "Must have HIPAA compliance experience",
        "source": { "stakeholder_type": "HIRING_MANAGER", "evidence_quote": "...", "turn": 3 },
        "job_relatedness_note": "Role handles PHI for clinical workflows; non-compliance creates regulatory risk",
        "job_relatedness_strength": "HIGH",
        "gate_type": "HITL"
      }
    ],
    "red_flags": [
      {
        "criterion": "Only worked in synchronous Scrum environments",
        "source": { "stakeholder_type": "TEAM_MEMBER", "evidence_quote": "...", "turn": 11 },
        "gate_type": "ADVISORY"
      }
    ],

    // Derived consumer slice (replaces CandidatePersona — convenience object)
    "consumer_slice": {
      "seniority": "SENIOR",
      "archetype": "PLATFORM_ENGINEER",
      "must_have_skills": ["Kafka", "Go", "HIPAA-constrained systems"],
      "nice_to_have_skills": ["Kubernetes", "OpenTelemetry"],
      "disposition": ["async-preferred", "high-ownership"],
      "bar_values": ["patient-safety-reliability", "independent-team-shipping"]
    },

    // Validation metadata — required for criterion studies (R4 §Q10)
    "validation_metadata": {
      "rcd_version": 1,
      "bars_version": 1,
      "customer_id": "...",
      "effective_from": "ISO-8601"
    }
  }
}
```

The critical design principle: `consumer_slice` is **derived** from `domain_matrix` at write time, not the primary artifact. Downstream consumers that need only the flat slice read `consumer_slice`. Consumers that need laddering depth (challenge generation, BARS calibration, culture probe selection, repo alignment scoring) read the relevant `domain_matrix` cells directly. The Knowledge State never goes dead again because the richest schema is primary and the flat slice is computed.

### 1.2 Synthesis prompting: preserving laddering chains across the prompt boundary

A correct schema with a defective prompt produces a correctly-shaped but semantically flat artifact — exactly the current `CandidatePersona` failure repeated at larger scale. The synthesis prompt is the mechanism by which the `domain_matrix` schema either works or doesn't.

The core failure mechanism is compression. The current synthesis prompt asks "what skills does this role require?" and the LLM produces skills, discarding motivational context because the output schema has no field for it. The solution is not better natural-language instructions in the prompt; it is a schema that makes the chain structure mandatory and a prompt-level ordering constraint that forces the model to extract bottom-up.

The research supports a three-layer pattern [R1-S9] [R1-S13] [R1-S15]:

**Layer 1 — Schema-grounded extraction with exemplar injection.** The synthesis prompt provides the full `domain_matrix` schema with field descriptions and a worked exemplar for one domain/stakeholder cell. The PARSE system (2024 [R1-S9]) demonstrates that schema optimization — specifically adding detailed field descriptions and structural reorganization — accounts for 89 % of extraction accuracy improvement (34 % from description enhancement + 55 % from structural reorganization). Field-level exemplars reduce the model's degrees of freedom: instead of deciding what "consequence" means, the model pattern-matches against the exemplar. Healthcare extraction evidence reinforces this: LoRA-finetuned Llama-3.1 8B achieved 90 % exact-match accuracy against human annotators when given explicit field descriptions aligned to domain knowledge [R1-S10]. A missing-person intelligence extraction pipeline achieved 96.97 % key-field completeness with schema constraints and F1 = 0.8664 versus 0.2578 for deterministic rule-based extraction [R1-S11].

The bottom-up ordering instruction is load-bearing and must be in the system prompt, not the schema description. For each `laddering_chains[]` entry, the model writes `attribute_quote` first (verbatim from the transcript), then derives `consequence`, then derives `value` — in that strict order. Reversing the order (writing `value` first, then finding supporting quotes) is the failure mode that produces post-hoc rationalization rather than genuine extraction. This is grounded in Reynolds & Gutman's [R1-S6] own analysis procedure: the implication matrix is built bottom-up from attributes to values, never top-down.

**Layer 2 — Constrained JSON via API structured output.** For the offline synthesis model (Claude Sonnet 4.6 via the Anthropic API per CLAUDE.md routing), the `response_format: { type: "json_schema" }` parameter provides schema compliance as a floor at zero additional latency. JSONSchemaBench (2025 [R1-S15]) evaluated six frameworks across 10,000 real-world schemas: Guidance achieved the highest compliance rate, and constrained decoding improved task accuracy by ~4 % even for tasks with minimal structure. Workers AI Gemma 4 does not expose grammar-constrained decoding on the public binding — this means any runtime synthesis step running on Workers AI must achieve schema compliance through prompt design alone. For PIPE, the recommendation is that full synthesis (writing the `domain_matrix`) happens offline on Sonnet 4.6 after the interview completes, not at runtime on Workers AI.

**Layer 3 — Verification pass targeting evidence anchoring.** A second LLM call — Claude Haiku 4.5 is appropriate given the offline, non-latency-sensitive nature — receives the synthesized `domain_matrix` and the raw transcript. It checks that each `laddering_chains[]` node has an `attribute_quote` that is a verbatim substring of the transcript, that each `consequence` is derivable from the quoted turn alone, and that every `energy_signal: "HIGH"` marking has a lexical anchor (explicit urgency markers, repetition, hedging). The PARSE SCOPE system [R1-S9] demonstrated 92 % error reduction on first retry using this pattern. Self-Refine [R1-S13] reports 20 % absolute improvement across seven tasks, but the ART paper (2024 [R1-S14]) cautions that unconditional self-critique can degrade output quality — the resolution is conditional refinement: refine only when the verification pass flags a specific grounding failure.

#### Failure modes the synthesis step must guard against

1. **Value projection** — the model fills `value: "developer productivity"` because that is common in software engineering, not because this team said it. Guard: the bottom-up schema ordering prevents `value` from being written before `attribute_quote`.
2. **Consequence genericization** — the model fills `consequence: "faster development"` instead of "teams in the clinical workflow can hot-patch without a full deploy cycle." Guard: the verification pass checks that `consequence` text shares at least one key entity with the `attribute_quote`.
3. **Energy signal inflation** — the model marks everything as `HIGH` because the prompt framing treated the interview as high-stakes. Guard: require at least one verbatim lexical marker ("critical," "always," "non-negotiable," "last time we did it wrong...") before allowing `HIGH`.
4. **Domain coverage collapse** — the model produces rich output for domains the interview covered deeply and thin output for domains that were lightly discussed. Guard: the `domain_coverage` field requires a completeness assessment; `PARTIAL` flags trigger explicit acknowledgement rather than empty arrays.
5. **Stakeholder averaging on the first pass** — if the model receives all stakeholder transcripts at once, it will synthesize across them rather than per-stakeholder. Guard: run synthesis per-stakeholder independently, then run a separate aggregation step that produces `conflicts[]` by comparing per-stakeholder outputs (Tier 2 in §1.3 below).

### 1.3 Multi-stakeholder aggregation: preserve disagreement as signal

The default assumption in PIPE's current synthesis — average across stakeholders — is not supportable by the psychometric literature. Conway and Huffcutt (1997 [R4-S1]) meta-analyzed cross-source correlations across subordinate, supervisor, peer, and self-ratings and found supervisor–peer correlation of ρ = .34 at the rating level. Eleven percent shared variance, eighty-nine percent source-unique. Viswesvaran, Schmidt, and Ones (2005 [R4-S2]) showed that after correcting for halo and measurement error, the *construct-level* correlations rise toward 1.00 — meaning different sources are targeting the same underlying construct but observing different behavioral samples and weighting observations differently. The practical implication is that raw-score disagreement is **not noise**. It is signal about which behaviors each source can actually see.

Dierdorff and Morgeson's (2007 [R4-S5]) job analysis study of 20,000+ incumbents across 98 occupations found that consensus on work role requirements systematically decreases as requirements become more molar (tasks → responsibilities → traits) and that consensus is lower in highly interdependent and autonomous occupational contexts. Software engineering is the textbook case of high interdependence and autonomy. Genuine disagreement at the "traits and culture" level between a hiring manager and a team member is *expected* and carries legitimate information about how different parts of the team experience the role.

The Frontiers in Psychology (2018 [R4-S3]) CFA study tested formally whether cross-source ratings could legitimately be aggregated using scalar invariance tests. For 3 of 14 competencies, invariance failed — meaning mean aggregation was statistically inappropriate for those dimensions. For the remaining 11, invariance held and aggregation was justified. The takeaway: aggregation is defensible only when invariance has been established; absent that test, combining sources produces a number that measures neither source accurately.

The RAND/UCLA Appropriateness Method (RAM) — used in medical guideline development for multi-stakeholder consensus — operationalizes this principle: disagreement is treated as its own category, not a midpoint to compute. Panelist ratings that cluster at extremes (some at 8, some at 4) are flagged as "uncertain" rather than averaged to 6 [R4-S7] [R4-S8]. The Delphi method similarly preserves minority justifications rather than silencing them through convergence pressure. A 2020 systematic review of these methods warns that "the Delphi method can inadvertently constrain nuance; in pursuit of consensus, responses may converge toward statistical averages or generalized statements, obscuring conditional logic and domain-specific caveats" [R4-S10]. PIPE's synthesis step faces the same risk.

#### Three-tier aggregation scheme

Based on this evidence, the RCD uses a three-tier scheme for cross-stakeholder data:

**Tier 1 — Domain-authoritative fields.** For fields where one stakeholder type has clear observational authority, the schema anchors to that source but stores all others as supplementary. Each domain cell carries `primary_authority: "HIRING_MANAGER" | "TEAM_MEMBER" | "RECRUITER"`. Smither, London and Reilly's (2005 [R4-S6]) meta-analysis of 24 longitudinal studies showed that direct-report (subordinate) ratings carried the largest effect sizes for improvement (d = .24), which maps onto PIPE's context: the TEAM_MEMBER perspective carries the most signal about daily working reality; HIRING_MANAGER carries scope and stakes signal; recruiters carry the least irreplaceable information. The domain assignments: HIRING_MANAGER is authoritative on `Why` and `Bar`, TEAM_MEMBER on `Team` and `Process`, Codebase/Work can go either direction with explicit provenance.

**Tier 2 — Shared-domain fields with `conflicts[]` record.** For fields where multiple sources have legitimate claims, the schema preserves per-source answers *without collapse*, plus a top-level `conflicts[]` array entry when answers differ substantively. The downstream scoring agent reads all per-source values plus the conflict flag and treats them as separate evidence.

**Tier 3 — Aggregated summary fields with explicit formula.** For fields where genuine consensus is expected (job title, tech stack, obvious must-haves), aggregation is allowed but the formula is explicit: `aggregated: true, formula: "weighted_mean([HM: .50, TM: .30, IR: .10, ER: .10])"`. Downstream consumers know what they are reading.

When `conflicts[]` flags a critical field (e.g., "degree of autonomy expected"), the scoring agent reads both per-source values directly, weights the culture/collaboration interpretation toward TEAM_MEMBER, weights the scope/authority interpretation toward HIRING_MANAGER, and surfaces the conflict to the recruiter for manual review. This is consistent with the RAM principle that disagreement is itself an informative category, not a problem to solve by arithmetic [R4-S7].

### 1.4 Team-culture signal set: five dimensions, not fifty

The temptation with culture taxonomies is to proliferate dimensions. HireVue surfaces a competency panel per Liff et al. (2024 [R2-S1]); Plum claims 10 Talents across three domains (no published validation [R2-S4]); Pymetrics measures 91 cognitive/emotional/social traits across nine categories [R2-S8]; Culture Amp's engagement taxonomy carries 10 factors [R2-S5]. The research on which of these differentiate teams versus simply proliferate is thin but directionally clear: **a minimal construct set validated against job satisfaction or performance outcomes outperforms large-dimension taxonomies**.

The strongest empirical anchor is the OCAI's Competing Values Framework validation [R2-S7]. Four culture archetypes — Clan, Adhocracy, Market, Hierarchy — with Cronbach's α of .69–.83 depending on archetype and framing (Current vs Ideal culture). A critical caveat from the same validation study: the *Ideal culture* framing (the version used in Harver's candidate-facing assessment [R2-S6]) showed *no significant relationship with job satisfaction*, while the *Current culture* framing did. Harver uses the ideal-culture framing as a candidate screen anyway. This is a validity concern PIPE should not replicate. Use OCAI signals to profile the *team* (Current culture framing, hiring-manager and team-member reporting on what the team is actually like), not to score the *candidate*.

The fifth signal is psychological safety, independently validated and well-established as team-differentiating [R2-S10]. Psychological safety predicts team performance in ways OCAI's four archetypes do not capture.

The recommended set:

| Signal | Construct | Source | α / Evidence |
|---|---|---|---|
| Clan affinity | Family-like, collaborative, consensus-oriented | OCAI/CVF [R2-S7] | α = .69–.83 (range across archetypes, Current-culture framing) |
| Adhocracy affinity | Risk-taking, entrepreneurial, ambiguity-tolerant | OCAI/CVF [R2-S7] | (same range) |
| Market affinity | Results-driven, competitive, delivery-focused | OCAI/CVF [R2-S7] | (same range) |
| Hierarchy affinity | Structured, process-valuing, predictability-seeking | OCAI/CVF [R2-S7] | (same range) |
| Psychological safety | Voice, interpersonal risk, challenging authority without punishment | Edmondson; Project Aristotle [R2-S10] | Qualitative (Google) |

*Note: Heritage et al. 2014 report reliability as a range across the four archetypes (.69–.83) under Current-culture framing. Per-archetype alpha values are not independently broken out in the research file and should be verified against the primary source before the ADR specifies per-dimension thresholds.*

Excluded: Plum's 10 Talents (no independent validation), Pymetrics' 91 traits (data-hungry calibration infeasible at MVP scale), Lattice's competencies (post-hire only, not a pre-hire tool [R2-S9]). Culture Amp's 10 engagement factors are useful as *input* to the Role Discovery interview's team-domain probes but not as candidate-facing dimensions.

The `team_culture_profile` lives in the RCD as a 1–5 priority scale per signal, scored from the Role Discovery interview's `Team` domain. Per-stakeholder scores are preserved rather than averaged (per §1.3).

### 1.5 BARS anchor calibration: universal base plus RCD-derived overrides

The question is whether PIPE's BARS rubrics (6-dimension code review per ADR-032, 5-dimension culture per ADR-029) should carry team-specific anchors, or stay universal. The evidence converges on a hybrid.

Smith and Kendall (1963) created BARS specifically because generic rating scales produced unacceptable rater idiosyncrasy, and their solution was anchor points grounded in critical incidents from the *specific* job role. The critical incidents technique with Kell et al.'s (2017 [R2-S11]) "retranslation" step — incidents that SMEs cannot classify to the same scale point with ≥80 % agreement are dropped — is the mechanism that makes role-specific BARS psychometrically sound. Kell's ETS Research Report RR-17-28 also shows crowdsourced critical-incident generation produces anchors of sufficient quality, which solves the cost problem that has historically blocked per-role BARS development.

Campion, Palmer, and Campion (1997 [R2-S2]) identified 15 structural elements of interviews and concluded that BARS is one of the strongest contributors to reliability and validity. Levashina, Hartwell, Morgeson, and Campion's (2014 [R2-S14]) comprehensive review confirmed that "behaviorally anchored rating scales tend to increase the reliability and predictive validity of structured interview scores and may decrease bias against protected groups." The medical-education BARS study [R2-S13] provides the counter-note: inter-rater reliability ranged from ICC 0.256–0.529 across eight domains when BARS validated for one population was applied to another without recalibration. Role-level calibration is genuinely necessary; anchors do not transfer freely.

The legal evidence is unambiguous. The Uniform Guidelines on Employee Selection Procedures (29 CFR Part 1607 [R2-S15]) require job analysis before BARS development, and content validity is achievable when anchors are grounded in a documented role analysis — which is exactly what the RCD provides. Generic anchors applied across all roles are *weaker* under the Uniform Guidelines, not stronger, because they cannot demonstrate content validity for any specific role. The EU AI Act Article 14 [R2-S16] requires human overseers to "correctly interpret the high-risk AI system's output," which a documented calibration process (anchors derived from job analysis, override mechanism explained) satisfies more readily than a black-box universal rubric.

#### Three alternatives evaluated

**Alternative A — Universal rubric, no calibration.** Inter-rater reliability moderate if rubric is well-designed (~r = .72 per Liff 2024 [R2-S1]); criterion validity low (no role-grounded anchors); legal defensibility weak (cannot demonstrate content validity per role); EU AI Act acceptable only if oversight mechanisms exist. *Not sufficient for production.*

**Alternative B — Fully custom BARS per role.** Inter-rater reliability high when SME panels complete retranslation [R2-S11]; criterion validity strongest; legal defensibility strongest; cost prohibitive (20–40 SME hours per role, infeasible at MVP scale). *Appropriate standard for regulated industries, not for MVP SaaS.*

**Alternative C — Universal base rubric + RCD anchor overrides.** Universal BARS dimensions provide cross-role comparability (a Uniform Guidelines concern); the RCD provides per-dimension text overrides for anchor levels ("what does excellent look like *on this team*?"); overrides derive from the RCD's laddering chains (value layer per Means-End Chain). Inter-rater reliability maintained at base level with modest improvement expected from grounded anchors; content validity achievable via documented overrides; EU AI Act human overseer can understand and audit the override logic; cost low (one additional synthesis step). **Recommended.**

#### Implementation

The `bars_overrides` field in the RCD is a nested object keyed by rubric dimension and score level (1–5). Each override is a string (the anchor text) with an `evidence_source` pointer back to the laddering chain in the `domain_matrix` that grounded it. An override is only written when the Role Discovery transcript contains at least one concrete behavioral example for that dimension/level; otherwise the override is null and the universal anchor is used. This operationalizes Kell's retranslation standard: anchors without evidence are dropped rather than fabricated.

### 1.6 Probe generation: static bank with role-setup-time enrichment

The question here is whether PIPE's culture interview agent should dynamically generate per-candidate probes from the RCD, keep a static probe bank, or do something in between. ADR-029 currently uses a static bank; the research decisively supports *enriching* that bank at role-setup time rather than generating per-candidate.

Campion et al. (1997 [R2-S2]) explicitly include "limit prompting, follow-up questioning, and elaboration on questions" as a structural element, on the argument that allowing interviewers to probe differently across candidates introduces differential treatment. The recommended pattern is pre-specified probes applied uniformly — not probes generated on the fly. Levashina et al. (2014 [R2-S14]) reviewed three structuring approaches (no probing / pre-specified consistent probes / adaptive probing) and the meta-analytic evidence favors pre-specified consistent probes over both extremes.

The legal evidence is overlapping and specific. Under EU AI Act Article 14 [R2-S16], the human overseer must be able to "correctly interpret the high-risk AI system's output." If each candidate receives a different set of AI-generated probes, the scoring panel cannot normalize across candidates — the overseer cannot determine whether candidate A's lower score reflects actual performance or an easier probe set. The Act's audit-trail logging requirement is similarly incompatible with fully dynamic probes unless every generated probe, the model version, and the context inputs are logged per candidate, producing a per-candidate audit artifact that varies across every interview.

NYC Local Law 144 (effective July 2023 [R2-S17]) requires annual bias audits of AEDTs with public disclosure of impact ratios by protected category. A bias audit is only computable if candidates are assessed on a comparable basis. Dynamic per-candidate probes are effectively unauditable under LL 144 — auditors cannot isolate whether differential pass rates reflect candidate quality or probe difficulty.

#### Three alternatives evaluated

**Alternative A — Fully dynamic AI-generated probes.** Highest quality, lowest consistency, unauditable under LL 144, difficult to defend under Article 14, weakest legal defensibility. *Not recommended.*

**Alternative B — Static bank, no team-specific weighting.** Moderate quality, highest consistency, straightforward auditability. *Defensible but leaves role-context signal on the table — current ADR-029 state.*

**Alternative C — Static bank + role-setup-time enrichment.** The universal bank contains baseline probes per dimension; the RCD synthesis step writes *additional* static probes grounded in specific laddering chains, stored as a versioned artifact. All candidates interviewing for the same role receive the same enriched bank. Quality high, consistency high, auditability preserved. **Recommended.**

#### Audit-trail design

Each role's enriched probe bank is stored in D1 as a versioned artifact. A proposed table shape:

```sql
CREATE TABLE role_probe_bank (
  role_id         TEXT NOT NULL,
  probe_id        TEXT NOT NULL,
  dimension       TEXT NOT NULL,       -- which BARS dimension this probe addresses
  probe_text      TEXT NOT NULL,       -- the question text
  source          TEXT NOT NULL,       -- 'universal_bank' | 'rcd_enriched'
  evidence_chain  TEXT,                -- if enriched: pointer to RCD laddering chain
  created_at      TEXT NOT NULL,
  bank_version    INTEGER NOT NULL,    -- bumps when RCD is updated
  PRIMARY KEY (role_id, probe_id)
);
```

When a candidate is assessed, the session logs which `bank_version` was active. Bias audits compare outcomes across candidates assessed under the same `bank_version`, satisfying LL 144 comparability. The audit trail contains: probe bank version, dimension mapping, evidence chain reference, scoring rubric version [R2-S16] [R2-S17]. Enriched probes should be treated as immutable once the first candidate has been assessed under them.

### 1.7 Dealbreaker propagation: HITL gate, never auto-fail

The legal evidence base for automated hard-fail decisions in hiring is unambiguous: auto-fail is indefensible, HITL gates are the compliant alternative, and advisory-only is acceptable but sacrifices operational value.

**Griggs v. Duke Power Co., 401 U.S. 424 (1971)** [R2-S18] established the disparate impact doctrine: neutral employment practices with a discriminatory effect violate Title VII even without discriminatory intent. The business necessity defense requires the employer to demonstrate the selection procedure is "demonstrably a reasonable measure of job performance." This is the legal standard any dealbreaker mechanism must meet. A dealbreaker grounded in documented regulatory requirements (e.g., "must have HIPAA compliance experience" for a role handling PHI) is defensible; "no culture fit" is not.

**Uniform Guidelines 29 CFR Part 1607** [R2-S15] operationalize adverse impact via the four-fifths (80 %) rule: a selection rate for any protected group less than 80 % of the highest-selected group's rate is evidence of adverse impact. The rule applies to each step in a sequential selection process. If a dealbreaker operates as an automated gate, it is independently subject to adverse-impact analysis. An auto-fail gate with no human review cannot demonstrate individualized assessment — exactly the mechanism Griggs requires.

**EEOC v. iTutorGroup (2023)** [R2-S20] — the EEOC's first successful AI hiring discrimination settlement — is structurally identical to an auto-fail dealbreaker gate. iTutorGroup's software automatically rejected female applicants age 55+ and male applicants age 60+; 200+ affected applicants; $365,000 settlement plus 5+ years of EEOC monitoring. The EEOC's legal finding: **it is immaterial that the software made the rejection "automatically" — intentional programming of the filter is itself discriminatory intent**. Any auto-fail dealbreaker in PIPE that correlates with a protected characteristic reproduces this mechanism.

**Mobley v. Workday (2025)** [R2-S21] — conditionally certified as a nationwide ADEA class action — is still in active litigation as of 2026-04-10; the cited secondary analysis is a Norton Rose Fulbright client alert, not an appellate opinion. The certification ruling itself is procedural rather than a final liability finding, but the court's certification analysis indicates the direction of the exposure: (a) AI vendors may be directly liable as employer "agents" under the theories that survived the motion, (b) the scale of AI hiring decisions creates class-action exposure that individual claims did not, and (c) employers using the vendor's tool are not automatically insulated from co-liability. The practical implication for PIPE is the same regardless of how the merits finally resolve: the vendor (PIPE) and the customer should assume shared exposure for automated screening outcomes and design around that assumption.

**EU AI Act Annex III / Article 14** [R2-S16] classifies recruitment AI as high-risk (applicable from 2 August 2026) and requires that natural persons be able to "halt, suspend, or override" outputs, remain aware of automation-bias tendencies, and ensure "no AI tool should make final placement, rejection, or evaluation decisions without a qualified human in the loop." A pure auto-fail mechanism is non-compliant with Article 14 on its face.

**EEOC 2024–2028 Strategic Enforcement Plan** [R2-S22] explicitly prioritizes AI-assisted automatic rejection as an enforcement focus for the next four years. The prior-administration origin of the SEP is acknowledged (current EEOC posture may evolve [R2-S24]), but the underlying statutes (Title VII, ADEA, Uniform Guidelines) are case law and statutory, not SEP guidance — they don't move.

#### Recommendation

**Auto-flag-then-HITL gate for `dealbreakers`; advisory display for `red_flags`.** The distinction matters: dealbreakers represent conditions the employer identified as disqualifying in the Role Discovery interview and warrant workflow friction; red flags are concerns that warrant investigation but are not automatic disqualifiers. Applying HITL only to dealbreakers keeps the friction proportionate.

The gate design:

1. Role Discovery synthesis produces `dealbreakers[]` with `criterion`, `source` (stakeholder + evidence quote + turn), `job_relatedness_note` (the laddering chain evidence connecting the criterion to work outcomes), `job_relatedness_strength` ∈ {HIGH, MEDIUM, LOW}, and `gate_type` (defaulting to HITL).
2. When a candidate's assessment triggers a dealbreaker, the recruiter sees: the dealbreaker text, the source stakeholder, the job-relatedness note, and a mandatory disposition action (Advance / Reject / Override Dealbreaker with Reason).
3. The disposition action is logged with timestamp, recruiter ID, and required free-text reason on override.
4. The logged disposition is the audit-trail artifact for EEOC and LL 144 purposes.

The `job_relatedness_note` field is the critical legal protection: it pre-populates the business necessity documentation the employer would need to defend against a disparate impact challenge. If the Role Discovery interview did not yield a job-relatedness chain for a dealbreaker (e.g., "we just don't hire people from outside fintech" with no consequence-level elaboration), the system flags the dealbreaker as `job_relatedness_strength: LOW` and requires the recruiter to confirm independent documentation of business necessity before the gate is active.

**Auto-fail** should only be implemented when the dealbreaker is a documented regulatory compliance requirement (OFAC, security clearance) with the regulation citation stored in the `job_relatedness_note`. This is a narrow exception — not a general mechanism.

---

## Half 2 — The Repo Understanding Contract

### 2.1 What signals matter beyond skill keywords

PIPE's current `matchRepos.ts` is a SQL CTE join on `qualified_repos ← repo_skills ← repo_constructs` with hard filters plus weighted scoring on skill-keyword hits. It reads `persona.mustHaveSkills[]` — a flat array of strings — and matches against `repo_skills`. The richest role signal the matching layer sees today is a keyword list. The MSR (Mining Software Repositories) and empirical software engineering literature identifies nine codebase-shape signals that empirically differentiate repos for challenge-relevance purposes, organized in three tiers of extractability [R3-S3] [R3-S4] [R3-S5] [R3-S6] [R3-S8] [R3-S9] [R3-S10].

#### Tier 1 — Git/GitHub metadata, extractable from existing PIPE schema today

Five signals can be computed *right now* from what the crawler already stores, requiring only aggregation SQL:

1. **`test_touch_rate`** — fraction of sample PRs with `test_touched = true`. The 2023 DORA State of DevOps report [R3-S8] identifies code review and test culture as significant correlates of engineering performance band. A repo where <10 % of PRs touch tests signals a different challenge context than one where >60 % do. This is the single highest-value addition available without new crawling.
2. **`mean_changed_files` / `p90_changed_files`** — mean and p90 of changed-file counts from `repo_sample_prs`. The Gousios et al. 2022 multi-language study of 845,316 PRs across 100 projects found that "pull request size and composition do not relate to time-to-merge" [R3-S4] — a negative result that overturns industry intuition. But PR size is still a useful *work-unit culture* signal: it describes whether the team ships fine-grained feature slices or broad cross-cutting changes. Directly computable.
3. **`issue_link_rate`** — fraction of PRs with `issue_resolution_link`. Proxies for whether the team practices systematic issue tracking; high rates signal environments where "fix a tracked regression" challenge scenarios will be realistic. Directly computable.
4. **`complexity_band`** — already measured in Pass 2. The MSR complexity literature [R3-S5] uses average cyclomatic complexity as a proxy for architectural legacy; PIPE stores the repo-level mean.
5. **SWE-bench eligibility flag** — already computed in Pass 2. Signals repos suitable for realistic bug-fixing challenges.

#### Tier 2 — Needs Pass 2 additions

Four signals need new crawler work:

6. **`architecture_style`** ∈ {monolith, layered_service, microservice, library, unknown}. Detectable from static signals well-studied in the microservice detection literature [R3-S5]: count of Dockerfiles, presence of `kubernetes/*.yaml`, service-directory patterns in the repo tree, multiple independent entry points. Heuristic, no LLM needed.
7. **`review_density`** (mean reviewers per PR) — not currently stored, extractable via the GitHub PR reviews API. Kalliamvakou et al. (MSR 2015) [R3-S3] identified reviewer count as a correlate of code-review culture maturity. Engineering constraint: at 20 PRs × 5,000 repos = 100,000 API calls, pagination and rate limiting must be planned.
8. **`commit_cadence`** (commits/month trailing 6 months) — extractable via the GitHub commits API. Bus-factor literature [R3-S9] treats authorship concentration as a knowledge-silo risk metric with bearing on what "ownership" means on a challenge.
9. **`satd_density`** — self-admitted technical debt (TODO/FIXME/HACK density per 1000 SLOC). The technical debt prediction literature [R3-S10] uses this signal reliably. Regex pass on source files; Pass 2 already clones repos so the incremental cost is a file scan.

#### Tier 3 — Not extractable at MVP scale

Dynamic analysis, true runtime coupling, actual test coverage percentages, and semantic architecture inference from code graphs require either running the code or expensive LLM passes over raw source. Deferred to post-MVP.

#### Ranked signal list

| Signal | Extractability | Empirical source | PIPE mapping |
|---|---|---|---|
| `test_touch_rate` | Aggregate existing `repo_sample_prs.test_touched` | DORA 2023 [R3-S8] | **Stored today** |
| `mean_changed_files` / `p90_changed_files` | Aggregate existing `changed_file_count` | Gousios et al. 2022 [R3-S4] | **Stored today** |
| `issue_link_rate` | Aggregate existing `issue_resolution_link` | Kalliamvakou et al. 2015 [R3-S3] | **Stored today** |
| `complexity_band` | Pass 2 already measures | MSR complexity literature [R3-S5] | **Stored today** |
| SWE-bench eligibility | Pass 2 already tags | SWE-bench [R3-S19] | **Stored today** |
| `architecture_style` | Pass 2 heuristic (Dockerfile count, service dirs) | Verano Merino et al. 2022 [R3-S5] | Needs Pass 2 addition |
| `review_density` | GitHub PR reviews API at crawl time | Kalliamvakou et al. 2015 [R3-S3] | Needs Pass 2 addition |
| `commit_cadence` | GitHub commits API | Bus-factor literature [R3-S9] | Needs Pass 2 addition |
| `satd_density` | Regex pass on cloned source | Ren et al. 2020 [R3-S10] | Needs Pass 2 addition |

### 2.2 How competitors do this (and why none of them do)

None of the six assessment platforms surveyed — HackerRank, CodeSignal, Codility, Woven, Karat, Greenhouse — expose anything resembling automated matching over a structured team-context document. All collapse to one of three patterns:

**Taxonomy-based role filtering** (HackerRank [R3-S1] [R3-S2], Codility [R3-S13]). The recruiter filters a challenge library by job role and skill taxonomy. The matching signal is a tag on a challenge. No team-specific configuration; no derivation from recruiter intake.

**Pre-built frameworks validated by I/O psychologists** (CodeSignal [R3-S11] [R3-S12]). Role-specific assessment bundles claim I/O psychology validation, but no criterion validity evidence is published. The matching signal is a pre-built bundle selected by role category + seniority + language.

**Human-configured work simulation** (Woven [R3-S14], Karat [R3-S15]). Discovery call → staff choose scenarios per client engagement → human scoring. Matching signal is human curated, not algorithmic. Woven claims 96 % retention, Karat "extensively tests interview questions," but neither publishes criterion validity studies.

**None** of the platforms publishes a public architectural description of an automated algorithmic matching pipeline. None publish evidence that role-tailored content improves hiring signal over a random sample from the same difficulty band. PIPE's approach — structured RCD → AI rerank → per-repo auditable justification — is architecturally novel in this competitive space. The gap between what a design-thinking interview captures and what any existing platform consumes (a role dropdown) is the exact gap PIPE's matching layer is designed to cross.

The recommended matching-layer interface:

```
Input:  RoleContextDocument { technical_context, seniority_band, bars_overrides, team_culture_profile }
Stage 1 (SQL hard filter): qualified_repos WHERE stack overlaps mustHaveSkills AND seniority band matches
Stage 2 (AI rerank):       foreach candidate repo, score(repo_engineering_signals, rcd.technical_context) → alignment_score
Output: TopN repos with justification_json — each describing which signals matched and why
```

The key distinguisher is the per-repo justification — the auditable artifact that distinguishes PIPE from every competitor in this category ("matched because: same Go microservice architecture, high test-touch rate consistent with HIPAA-sensitive context the recruiter mentioned, p90 PR size 380 lines matches stated preference").

### 2.3 The 3rd AI pass architecture: two-stage, not one

This is the single most load-bearing architectural question in the research run. Three alternatives were evaluated.

**Alternative A — Offline-only per-repo summarization.** An LLM reads each repo's substrate once and writes a role-agnostic engineering narrative, reused across every role that queries it. Supported by the hierarchical repository summarization literature [R3-S16] [R3-S17] and by ColBERT's offline document precomputation principle [R3-S18]. **Pros**: amortized cost; consistent judgments; compatible with Cloudflare Queue + D1 write-once infrastructure. **Cons**: a summary written without a role in mind may not expose the dimensions relevant to a specific role, and SWE-bench evidence indicates that query-agnostic retrieval (BM25) recovers the oracle file set at meaningfully limited rates even with large context windows [R3-S19] (reported ~40 % in the research file; the specific figure should be reconfirmed against the primary paper before it is quoted in the ADR). The summary cannot reason about "does this repo's review culture match the HIPAA-constrained environment the recruiter described?" *Verdict: right for signal extraction, wrong as the sole step.*

**Alternative B — Runtime-only per-(role × repo) alignment.** A cross-encoder reranker that jointly encodes role and repo at query time. Supported by rec-sys reranking literature [R3-S21] — cross-encoders are more accurate than bi-encoders at relevance judgment. **Pros**: maximum alignment accuracy; no staleness. **Cons**: token burn at every role creation event (250 LLM calls per month just for repo matching if a recruiter creates 5 roles and evaluates top-50 SQL candidates); latency at discovery time infeasible on Cloudflare's 30-second Worker timeout for 50 pairs inline; judgment inconsistency across sampled runs; no caching possible unless role context is exactly identical (rare). *Verdict: right shape for a reranking step, wrong if applied over the full candidate set without pre-filtering.*

**Alternative C — Two-stage: offline per-repo signals + runtime per-(role × repo) rerank.** The IR literature's standard architecture for systems that must balance cost, latency, and relevance accuracy. Supported by ColBERT's offline/online split [R3-S18], the precomputation/caching research [R3-S20] (27–58 % latency reduction), and the AIF asynchronous inference framework [R3-S22]: "interaction-independent components... can be decoupled from the sequential pipeline and precomputed asynchronously." **Recommended.**

The specific call for PIPE:

1. **Pass 3 (offline, background queue consumer, Claude Haiku 4.5)** processes each repo's `repo_sample_prs` metadata + `repo_constructs` + Pass 2 signals *once*. Writes one `repo_engineering_signals` row per repo, role-agnostic. Triggered as a Cloudflare Queue consumer when Pass 2 completes for a repo. Refresh on re-crawl. Estimated token cost: ~500 tokens per repo × 5,000 repos = 2.5M tokens, one-time. At Haiku 4.5 pricing this is under $5 total per library refresh. Haiku 4.5 is the right model per CLAUDE.md routing (offline batch, cost-sensitive).

2. **Runtime rerank Worker (Gemma 4 on Workers AI)** runs at role-creation time (or lazily at first match request). Takes the RCD's `technical_context` fields plus the top-N SQL candidates' `repo_engineering_signals` rows and produces `repo_role_alignment` rows with score + `justification_json`. The runtime model only judges fit, not extracts signals from raw metadata — so context is small (~200 tokens per pair × 20 candidate pairs = 4,000 tokens per role). Gemma 4 on Workers AI is effectively free at this volume and Workers-native. Results cached by `(role_id, repo_id)` and invalidated on RCD or repo signal version change.

3. **SQL Stage (existing `matchRepos.ts`)** is unchanged as the first-pass hard filter. Stack overlap and seniority band filtering stay in D1 before any AI calls.

The full pipeline: SQL hard filter → Pass 3 signals lookup → runtime role-fit rerank → ranked list with justifications.

This mirrors ColBERT's offline/online split exactly [R3-S18]: document encoding is precomputed (engineering signals), query encoding happens once (RCD read), and the interaction (alignment score) is computed cheaply at query time because both sides are pre-summarized. AIF [R3-S22] provides the modern justification: precomputing item-side features reduces redundant real-time computation, allowing the online stage to focus exclusively on interaction-dependent computation.

### 2.4 D1 schema sketches

#### `repo_engineering_signals` (one row per repo, written by Pass 3, role-agnostic)

```sql
CREATE TABLE repo_engineering_signals (
  repo_id           TEXT NOT NULL PRIMARY KEY,  -- FK to qualified_repos.id

  -- Architecture signals (Pass 2 heuristics + Pass 3 LLM judgment)
  architecture_style TEXT NOT NULL,   -- 'monolith' | 'layered_service' | 'microservice' | 'library' | 'unknown'
  service_count      INTEGER,         -- for microservice style

  -- PR behavior signals (aggregated from repo_sample_prs, no LLM needed)
  mean_changed_files REAL,
  p90_changed_files  REAL,
  test_touch_rate    REAL,            -- fraction of sample PRs with test_touched = true
  issue_link_rate    REAL,            -- fraction with issue_resolution_link

  -- Code review culture
  mean_reviewers_per_pr REAL,

  -- Code health signals
  complexity_band    TEXT NOT NULL,   -- 'low' | 'medium' | 'high'
  satd_density       REAL,            -- TODO/FIXME/HACK per 1000 SLOC
  test_style         TEXT,            -- 'unit_only' | 'integration_heavy' | 'e2e_present' | 'minimal' | 'unknown'

  -- LLM-generated structured narrative (Pass 3 output, used as context for runtime rerank)
  engineering_narrative TEXT,         -- 200-400 word structured description
  narrative_version  INTEGER NOT NULL DEFAULT 1,

  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
```

#### `repo_role_alignment` (one row per (role × repo), written by runtime Worker, role-specific, cached)

```sql
CREATE TABLE repo_role_alignment (
  id              TEXT NOT NULL PRIMARY KEY,
  role_id         TEXT NOT NULL,      -- FK to pipeline/role record
  repo_id         TEXT NOT NULL,      -- FK to qualified_repos.id

  alignment_score REAL NOT NULL,      -- 0.0 – 1.0
  rank_position   INTEGER,            -- rank among candidates for this role

  justification_json TEXT NOT NULL,   -- [{"dimension":"architecture","signal":"microservice","verdict":"matches role's async-first Go description"}, ...]

  rcd_version     INTEGER NOT NULL,   -- increments when RCD changes; invalidates on mismatch
  signals_version INTEGER NOT NULL,   -- mirrors repo_engineering_signals.narrative_version

  created_at      TEXT NOT NULL,
  expires_at      TEXT                -- NULL = permanent until version change
);

CREATE UNIQUE INDEX repo_role_alignment_role_repo ON repo_role_alignment(role_id, repo_id);
CREATE INDEX repo_role_alignment_by_role ON repo_role_alignment(role_id, alignment_score DESC);
```

The `rcd_version` + `signals_version` pair is the cache invalidation contract. When either bumps, cached rows become stale; they are recomputed on next query rather than proactively invalidated. This gives lazy invalidation with deterministic staleness bounds.

---

## Cross-cutting — Validation methodology at PIPE's volumes

Role-tailored assessment only sells if PIPE can show a skeptical customer or regulator that the tailoring produces better hiring signal than the current universal-rubric + SQL-keyword baseline. The research on validation methodology at <500 candidates per quarter is unambiguous: **local concurrent criterion studies are not feasible at this scale**, and PIPE must use a staged evidence ladder drawn from content validity, transportability analysis, synthetic validity, and quasi-experimental alternatives [R4-S11] [R4-S13] [R4-S14] [R4-S15] [R4-S16] [R4-S17].

### 3.1 Why local criterion studies don't work

Traditional concurrent criterion validity studies require N ≈ 85 to detect r = .30 with power = .80 at α = .05 two-tailed, or N ≈ 193 to detect r = .20 at the same power [R4-S11]. Early PIPE customers at 50–200 hires per quarter accumulate maybe 20–40 *hires* per 6-month engagement, and post-hire performance criterion data typically requires 6–12 months of on-the-job tenure for reliable supervisor ratings. The criterion dataset grows so slowly that local validity coefficients are uninterpretable until year two at the earliest.

Sackett et al.'s 2022 meta-analysis placed structured interview validity at r_op = .42 (80 % credibility interval: .18–.66) [R4-S12]. Role-tailored interviews are expected to land in the upper half of that interval, but demonstrating it locally at <500 candidates per quarter is not feasible through direct criterion measurement. The evidence strategy has to be different.

### 3.2 The evidence ladder

| Threshold | Evidence available | Label |
|---|---|---|
| 0 candidates | Job analysis (the RCD itself) + SME content validity review + expert review of BARS anchors | **Pre-deployment face validity** |
| 30–50 candidates | + Convergent validity with independent structured interview rater (bootstrapped 95% CI); adverse impact check (four-fifths, N permitting) | **Construct validity triangle** |
| 100–200 candidates | + Transportability analysis comparing RCD job profiles to published validity database; synthetic validity estimate per predictor–criterion pair | **Transportability case** |
| 300–500 candidates | + Concurrent validity study with 6-month manager-rated performance; interrupted time series or non-equivalent groups quasi-experiment | **Criterion-suggestive evidence** |

This ladder is grounded in:

**Synthetic validity** [R4-S14] — the strongest direct test of synthetic validity's accuracy. Using 4,725 incumbents and 619 supervisors across 11 job families and 27 job components, synthetic and traditional criterion-related validity coefficients were highly correlated, supporting synthetic validation as a legitimate alternative for small organizations. The SIOP 2018 Principles explicitly endorse synthetic validation "especially applicable for smaller businesses where the employer has difficulty obtaining a large enough sample of subjects for a technically adequate validation study (about 100)" [R4-S13]. The RCD's six-domain decomposition maps directly onto the job component structure synthetic validation requires — this is not accidental; the methods are designed to compose.

**Transportability analysis** [R4-S15] [R4-S13] — validity generalization applied to a specific test–job pairing, using job analysis evidence to document similarity between the local job and jobs in the published validity database. Hoffman demonstrated this with physical ability tests across 95 jobs: PAQ-based cluster analysis produced five job families; 95 % SME agreement between statistical and rational family assignment; transportability inferences defended without separate local validity studies. For PIPE, the Role Discovery interview is itself the job analysis data collection instrument — the RCD is the transportability input.

**Quasi-experimental alternatives** [R4-S16]. Two designs work at PIPE's volumes: within-organization A/B comparison (customer uses PIPE for some roles and a prior process for others, n = 50 per arm produces ~0.40–0.50 power for d = .25 — low but not zero); and pre-post interrupted time series within one organization (3–4 pre-deployment cohorts vs. 3–4 post-deployment cohorts). Neither produces a validity coefficient; both produce credible directional evidence at low N.

**SIOP 2023 AI assessment guidance** [R4-S17] explicitly accepts construct validity triangulation — content + convergent/discriminant + face + fairness — as a legitimate partial substitute when criterion data are scarce. Fairness monitoring at N < 50 per subgroup requires pooling across customers, which is a cross-cutting obligation PIPE must design from launch.

### 3.3 The versioning precondition

None of the above is interpretable unless the RCD and the RUC carry version metadata per candidate cohort. If the RCD schema changes between Month 1 and Month 6, any criterion coefficient computed at Month 6 is measuring a mixture of two different assessment configurations. Similarly, if `repo_engineering_signals` are refreshed mid-study, the alignment scores from Month 3 are no longer comparable to Month 6 scores — cross-cohort quasi-experimental comparisons become confounded.

The `validation_metadata` field on the RCD (see §1.1) and the `rcd_version` + `signals_version` fields on `repo_role_alignment` (see §2.4) are the concrete mechanism. Both are cheap and non-optional. Without them, the entire evidence ladder in §3.2 is uninterpretable.

### 3.4 Protocol sketch

The per-customer protocol unfolds in four phases:

**Month 0 (pre-deployment):** Run Role Discovery with all available stakeholders. Document the RCD with full `validation_metadata`. Recruit 3–5 software engineering SMEs to review challenge content and BARS anchors against the RCD. Record any adverse-impact monitoring baseline from existing hiring data if available.

**Months 1–3 (first candidate cohort):** All candidates also complete a 5-item structured behavioral interview conducted by an independent person (not the PIPE AI) — the convergent validity reference measure. At N = 30, run bootstrapped Pearson correlation between PIPE scores and independent interview scores with 95 % CI.

**Months 3–6 (accumulation):** At N = 100, run transportability analysis by comparing the RCD job profile per dimension to the published validity database [R4-S12] using SME similarity ratings. Compute synthetic validity per BARS dimension. Begin 6-month performance criterion collection protocol using validated 3-item performance measure.

**Month 6+ (criterion-suggestive):** When ≥ 50 hired candidates have reached 6-month tenure, run Pearson criterion coefficient with 95 % CI. If a matched comparator group exists, run the quasi-experimental comparison on 12-month retention.

Pooled-customer adverse-impact monitoring runs quarterly regardless of individual-customer data volume.

---

## Open Questions

The research could not resolve several questions cleanly. These belong in ADR-036's "Open Questions" section and become STRATEGY.md Open Questions rows:

1. **No published study directly tests laddering-chain preservation across an LLM prompt boundary.** Reynolds & Gutman's [R1-S6] analysis framework was designed for human coders, not LLMs. The three-layer synthesis prompt pattern is assembled from adjacent literatures (healthcare extraction, qualitative analysis automation, schema-guided generation) rather than from a direct empirical test of attribute → consequence → value chain preservation in LLM output. PIPE should run an internal eval measuring chain preservation across a sample of Role Discovery transcripts.

2. **Energy signal detection is weakly grounded.** IPA's "linguistic noting" [R1-S5] is a human practice with no published LLM equivalent. The `energy_signal: HIGH` field in the proposed schema is justified by the plan's specification, but there is no peer-reviewed evidence for LLM accuracy at detecting interview-level urgency signals. Treat as low-confidence until internal validation.

3. **Pass 3 LLM output stability is untested.** The two-stage architecture assumes Haiku 4.5's per-repo summaries are stable across re-runs. The hierarchical summarization literature [R3-S16] [R3-S17] does not directly address LLM output stability for structured field extraction. Needs empirical measurement: run Pass 3 3× on a sample of 20 repos and measure field-level agreement for `architecture_style`, `test_style`, `engineering_narrative` key entities.

4. **No criterion validity evidence that role-tailored challenge content improves hiring signal over universal banks** — across the entire industry, not just PIPE [R3-S1] [R3-S11] [R3-S13] [R3-S14] [R3-S15]. The assumption that tailoring helps is theoretically grounded in content validity (challenges should resemble the actual job) but empirically untested at production scale. This is the gap the Q10 evidence ladder is designed to begin filling.

5. **Probe bank enrichment quality is unvalidated.** The Q5 recommendation (static bank + synthesis-time enrichment) is grounded in first principles from Campion (1997) [R2-S2] and EU/US legal analysis, but no empirical study was found that measures quality improvement from enriched vs. universal probes. Internal validation question.

6. **`job_relatedness_strength` scoring for dealbreakers is not standardized.** The Q9 recommendation assigns a `HIGH | MEDIUM | LOW` field to each dealbreaker, but no psychometric or legal standard defines the thresholds. The synthesis agent needs a rubric; the Uniform Guidelines' "job-related" standard [R2-S15] is the legal anchor but does not produce a continuous score.

7. **OCAI Ideal-culture vs. Current-culture framing.** The PLOS ONE OCAI validation [R2-S7] found that ideal-culture scores show *no significant relationship with job satisfaction*, while current-culture scores do. Harver uses the ideal-culture framing in candidate assessment anyway [R2-S6], which is a validity concern PIPE should not replicate. The recommendation is to use OCAI to profile the *team* (current-culture framing), not to score the *candidate* — but the boundary cases (when is a candidate question implicitly "ideal" framing?) deserve design attention.

8. **EEOC enforcement posture may shift.** The 2024–2028 Strategic Enforcement Plan [R2-S22] prioritizes AI hiring enforcement, but this was finalized under the prior administration. A 2025 legal-news report [R2-S24] noted "EEOC backs away from disparate impact theory in hiring algorithm case" — unconfirmed single source. PIPE should design for the legal floor (Griggs, Uniform Guidelines, EU AI Act Article 14 — statutory and case law, not SEP guidance), not the ceiling.

9. **Multi-stakeholder aggregation literature is analogous but not identical to PIPE's use case.** The 360-degree feedback and RAND/UCLA literature assesses a *known individual*; PIPE's sources define an *unknown future hire*. The Q3 recommendation is a direct inference from adjacent literature, not an empirically tested claim in PIPE's exact setting.

10. **Recruiter perspective weighting has no empirical anchor.** The Q3 recommendation to weight recruiters low on culture/team specifics and higher on role-family comparisons is reasonable but single-source in that exact form. Treat as a first draft to refine with internal data.

11. **Pooled-customer adverse-impact monitoring at launch is unspecified.** The SIOP 2023 AI guidance [R4-S17] requires cross-customer pooling at small N, but the operational mechanism (data residency, privacy-preserving aggregation, reporting cadence) is not addressed by the research and needs PIPE-specific design.

---

## Sources

### R1 — Qualitative methodology & synthesis prompting

[R1-S1] Glaser, B.G. & Strauss, A.L. (1967). *The Discovery of Grounded Theory: Strategies for Qualitative Research*. Aldine Publishing Company. [Classic text, library access]

[R1-S2] Charmaz, K. (2006/2014). *Constructing Grounded Theory: A Practical Guide Through Qualitative Analysis* (2nd ed.). SAGE Publications. https://www.researchgate.net/publication/224927524 [verified]

[R1-S3] Braun, V. & Clarke, V. (2006). "Using Thematic Analysis in Psychology." *Qualitative Research in Psychology*, 3(2), 77–101. https://en.wikipedia.org/wiki/Thematic_analysis [verified — Wikipedia summary page]

[R1-S4] Gale, N.K., Heath, G., Cameron, E., Rashid, S., & Redwood, S. (2013). "Using the framework method for the analysis of qualitative data in multi-disciplinary health research." *BMC Medical Research Methodology*, 13, 117. https://pmc.ncbi.nlm.nih.gov/articles/PMC3848812/ [verified]

[R1-S5] Smith, J.A., Flowers, P., & Larkin, M. (2009). *Interpretative Phenomenological Analysis: Theory, Method and Research*. SAGE Publications. https://www.simplypsychology.org/interpretative-phenomenological-analysis.html [verified — summary page]

[R1-S6] Reynolds, T.J. & Gutman, J. (1988). "Laddering Theory, Method, Analysis, and Interpretation." *Journal of Advertising Research*, 28(1), 11–31. https://www.tandfonline.com/doi/abs/10.1080/00218499.1988.12467766 [URL dead as of 2026-04-10 — 403 error]

[R1-S7] Quirkos (2021). "Open and Axial Coding in Qualitative Software." Quirkos Blog. https://www.quirkos.com/blog/post/open-and-axial-coding-qualitative-software/ [not verified]

[R1-S8] Adams, G., Fabbri, A., Ladhak, F., Lehman, E., & Elhadad, N. (2023). "From Sparse to Dense: GPT-4 Summarization with Chain of Density Prompting." *Proceedings of the 4th New Frontiers in Summarization Workshop* (ACL NewSum 2023). https://aclanthology.org/2023.newsum-1.7/ [verified]

[R1-S9] PARSE Authors (2024). "PARSE: LLM Driven Schema Optimization for Reliable Entity Extraction." arXiv:2510.08623. https://arxiv.org/html/2510.08623v1 [verified]

[R1-S10] Nature Scientific Reports (2025). "Human Level Information Extraction from Clinical Reports with Finetuned Language Models." *Scientific Reports*, 15, Article 1804. https://www.nature.com/articles/s41598-025-28767-z [URL redirects — 303 status]

[R1-S11] Guardian Authors (2026). "LLM-Based Schema-Guided Extraction and Validation of Missing-Person Intelligence." arXiv:2604.06571. https://arxiv.org/html/2604.06571 [verified]

[R1-S12] Talent Management Research Authors (2024). "Reconciling Methodological Paradigms: LLMs as Novice Qualitative Research Assistants in Talent Management Research." arXiv:2408.11043. https://arxiv.org/html/2408.11043v1 [not verified]

[R1-S13] Madaan, A., et al. (2023). "Self-Refine: Iterative Refinement with Self-Feedback." *Proceedings of NeurIPS 2023*. https://arxiv.org/abs/2303.17651 [not verified]

[R1-S14] ART Authors (2024). "The ART of LLM Refinement: Ask, Refine, and Trust." *Proceedings of NAACL 2024*. https://aclanthology.org/2024.naacl-long.327.pdf [not verified]

[R1-S15] JSONSchemaBench Authors (2025). "JSONSchemaBench: A Rigorous Benchmark of Structured Outputs for Language Models." arXiv:2501.10868. https://arxiv.org/html/2501.10868v1 [not verified]

[R1-S16] ACL Authors (2024). "Automating the Information Extraction from Semi-Structured Interview Transcripts." *Proceedings of The Web Conference 2024*. https://arxiv.org/pdf/2403.04819 [not verified]

[R1-S17] Ritchie, J. & Spencer, L. (1994). "Qualitative data analysis for applied policy research." In Bryman, A. & Burgess, R.G. (Eds.), *Analyzing Qualitative Data* (pp. 173–194). Routledge. https://www.researchgate.net/publication/267678963 [verified — ResearchGate]

[R1-S18] Willison, S. (2025). "Structured data extraction from unstructured content using LLM schemas." Simon Willison's Weblog, February 28, 2025. https://simonwillison.net/2025/Feb/28/llm-schemas/ [not verified]

### R2 — Culture platforms, BARS, probes, dealbreaker legal

[R2-S1] Liff, J.P., Mondragon, N.I., et al. (2024). "Psychometric Properties of Automated Video Interview Competency Assessments." *Journal of Applied Psychology*, 109(6), 921–948. https://pubmed.ncbi.nlm.nih.gov/38270989/ [verified]

[R2-S2] Campion, M.A., Palmer, D.K., & Campion, J.E. (1997). "A Review of Structure in the Selection Interview." *Personnel Psychology*, 50(3), 655–702. https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.1997.tb00709.x [not verified]

[R2-S3] HireVue (2019). "HireVue Delivers Game-Based Assessments for Measuring Job-related Emotional Intelligence." PR Newswire, October 8, 2019. https://www.prnewswire.com/news-releases/hirevue-delivers-game-based-assessments-for-measuring-job-related-emotional-intelligence-300942583.html [not verified]

[R2-S4] Plum (n.d.). "The Science Behind Plum: Using I/O Psychology to Predict Leadership Potential." Plum.io. https://www.plum.io/plum-science [not verified]

[R2-S5] Culture Amp (n.d.). "The Science Behind Our Engagement Surveys." Culture Amp Support. https://support.cultureamp.com/en/articles/7048329-the-science-behind-our-engagement-surveys [not verified]

[R2-S6] Harver (n.d.). "Cultural Fit Assessment." Harver Assessments. https://harver.com/assessments/cultural-fit-assessment/ [not verified]

[R2-S7] Heritage, B., Pollock, C., & Roberts, L. (2014). "Validation of the Organizational Culture Assessment Instrument." *PLOS ONE*, 9(3), e92879. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0092879 [verified — note: authors are Heritage et al., not Quinn & Spreitzer]

[R2-S8] Pymetrics (2021). "Pymetrics Q&A One-Pager." Berkeley Law, May 2021. https://www.law.berkeley.edu/wp-content/uploads/2021/07/Pymetrics-QA_one-pager_May_2021_FINAL-1.pdf [not verified]

[R2-S9] Lattice (n.d.). "Lattice Performance Management Platform." Lattice. https://lattice.com/platform/performance [not verified]

[R2-S10] Google re:Work (2012–2016). "Project Aristotle — Psychological Safety." Leaderfactor summary. https://www.leaderfactor.com/learn/psychological-safety-in-teams [not verified]

[R2-S11] Kell, H.J., Martín-Raugh, M.P., et al. (2017). "Exploring Methods for Developing Behaviorally Anchored Rating Scales for Evaluating Structured Interview Performance." *ETS Research Report Series*, RR-17-28. https://eric.ed.gov/?id=EJ1168380 [verified]

[R2-S12] Landy, F.J., Farr, J.L., et al. (1980). [Secondary source via AIHR summary]. "Performance appraisal review." https://www.aihr.com/blog/behaviorally-anchored-rating-scale/ [not verified — secondary source]

[R2-S13] PMC Authors (2022). "Reliability of the Behaviorally Anchored Rating Scale (BARS) for assessing non-technical skills of medical students in simulated scenarios." *PMC*. https://pmc.ncbi.nlm.nih.gov/articles/PMC9090385/ [not verified]

[R2-S14] Levashina, J., Hartwell, C.J., Morgeson, F.P., & Campion, M.A. (2014). "The Structured Employment Interview: Narrative and Quantitative Review of the Research Literature." *Personnel Psychology*, 67(1), 241–293. https://onlinelibrary.wiley.com/doi/abs/10.1111/peps.12052 [not verified]

[R2-S15] EEOC et al. (1978). "Uniform Guidelines on Employee Selection Procedures." 29 CFR Part 1607. https://www.eeoc.gov/laws/guidance/questions-and-answers-clarify-and-provide-common-interpretation-uniform-guidelines [not verified]

[R2-S16] European Parliament and Council (2024). "Regulation (EU) 2024/1689 — EU AI Act." Annex III (High-Risk AI Systems) and Article 14 (Human Oversight). https://artificialintelligenceact.eu/high-level-summary/ [verified — summary page]

[R2-S17] NYC Council / DCWP (2021/2023). "Automated Employment Decision Tools (AEDT)." NYC Local Law 144. https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page [timeout — unable to verify as of 2026-04-10]

[R2-S18] U.S. Supreme Court (1971). *Griggs v. Duke Power Co.*, 401 U.S. 424. https://supreme.justia.com/cases/federal/us/401/424/ [URL dead as of 2026-04-10 — 403 error]

[R2-S19] Criteria Corp (n.d.). "Legal Issues Relating to Pre-Employment Testing." Criteria Corp Resources. https://www.criteriacorp.com/resources/definitive-guide-validity-of-preemployment-tests/what-are-the-legal-issues-relating-pre [not verified]

[R2-S20] EEOC (2023). "iTutorGroup to Pay $365,000 to Settle EEOC Discriminatory Hiring Suit." EEOC Press Release, August 8, 2023. https://www.eeoc.gov/newsroom/itutorgroup-pay-365000-settle-eeoc-discriminatory-hiring-suit [verified]

[R2-S21] Norton Rose Fulbright (2025). "Mobley v. Workday, Inc. — Class Certification of AI Hiring ADEA Claim." Inside Tech Law Blog, June 2025. https://www.insidetechlaw.com/blog/2025/06/workday-ai-lawsuit-receives-the-greenlight-to-proceed-as-a-class-action [not verified]

[R2-S22] EEOC (2023). "Strategic Enforcement Plan, Fiscal Years 2024–2028." EEOC.gov, September 18, 2023. https://www.eeoc.gov/strategic-enforcement-plan-fiscal-years-2024-2028 [verified]

[R2-S23] Illinois General Assembly (2020/2026). "Artificial Intelligence Video Interview Act (AIVIA)." 820 ILCS 42. https://www.ilga.gov/Legislation/ILCS/Articles?ActID=4015&ChapterID=68&Print=True [not verified]

[R2-S24] New England Biz Law Update (2025). "EEOC backs away from disparate impact theory in hiring algorithm case." October 8, 2025. https://newenglandbizlawupdate.com/2025/10/08/eeoc-backs-away-from-disparate-impact-theory-in-hiring-algorithm-case/ [verified — single-source legal news blog]

### R3 — Codebase signals, competitor pairing, 3rd AI pass architecture

[R3-S1] HackerRank (2025). "Codility vs HackerRank vs CodeSignal: 2025 Enterprise Showdown." HackerRank Writing, 2025. https://www.hackerrank.com/writing/codility-vs-hackerrank-vs-codesignal-2025-enterprise-comparison [not verified]

[R3-S2] HackerRank (2024). "New Role-based Developer Skill Assessments." HackerRank Blog, 2024. https://www.hackerrank.com/blog/new-role-based-assessments/ [not verified]

[R3-S3] Kalliamvakou, E., Gousios, G., Blincoe, K., Singer, L., German, D.M., & Damian, D. (2015). "Wait For It: Determinants of Pull Request Evaluation Latency on GitHub." *Proceedings of MSR 2015*. https://cmustrudel.github.io/papers/msr15.pdf [PDF binary — unable to verify text, but URL resolves]

[R3-S4] Kudrjavets, G., Nagappan, N., & Rastogi, A. (2022). "Do Small Code Changes Merge Faster? A Multi-Language Empirical Investigation." arXiv:2203.05045. https://arxiv.org/abs/2203.05045 [verified — note: authors are Kudrjavets et al., not Gousios et al.]

[R3-S5] Verano Merino, M., et al. (2022). "From Monolith to Microservices: Architecture Detection." arXiv:2204.11844. https://arxiv.org/pdf/2204.11844 [not verified]

[R3-S6] ICSE-SEIP Authors (2024). "Productive Coverage: Improving the Actionability of Code Coverage." *Proceedings of ICSE-SEIP 2024*. https://dl.acm.org/doi/10.1145/3639477.3639733 [not verified]

[R3-S7] Liu, T., et al. (2024). "RepoBench: Benchmarking Repository-Level Code Auto-Completion Systems." *Proceedings of ICLR 2024*. https://openreview.net/forum?id=pPjZIOuQuF [not verified]

[R3-S8] DORA / Google (2023). "2023 DORA State of DevOps Report (Code Reviews and Team Health)." Code Climate summary. https://codeclimate.com/blog/2023-dora-state-of-devops [not verified]

[R3-S9] Ricca, F., et al. (2015). "Assessing the Bus Factor of Git Repositories." *Proceedings of MSR 2015*. https://www.researchgate.net/publication/272794507_Assessing_the_Bus_Factor_of_Git_Repositories [not verified]

[R3-S10] Ren, X., et al. (2020). "Predicting Technical Debt from Commit Contents: Reproduction of a Baseline Study and Directions for Future Research." *Software Quality Journal*, 28, 1039–1068. https://link.springer.com/article/10.1007/s11219-020-09520-3 [not verified]

[R3-S11] CodeSignal (2024). "The Unique Role of Assessment Design Engineers at CodeSignal." CodeSignal Engineering Blog, 2024. https://codesignal.com/blog/engineering/the-unique-role-of-assessment-design-engineers-at-codesignal/ [not verified]

[R3-S12] CodeSignal (2024). "Role-Based Simulations: CodeSignal Skills Platform." CodeSignal Industry Page. https://codesignal.com/industry/ [not verified]

[R3-S13] Codility (2024). "The Codility Task Library." Codility Support Documentation. https://support.codility.com/hc/en-us/articles/360043827713-The-Codility-Task-Library [not verified]

[R3-S14] Woven Teams (2024). "Interview Coding Challenges for Technical Assessment of High-Performing Engineers." Woven Teams Blog, 2024. https://www.woventeams.com/post/interview-coding-challenges-for-technical-assessment-of-high-performing-engineers/ [not verified]

[R3-S15] Karat (2024). "What do Karat technical interviews measure?" Karat Blog, 2024. https://karat.com/blog/post/what-do-karat-technical-interviews-measure/ [not verified]

[R3-S16] Makharev, N., et al. (2025). "Code Summarization Beyond Function Level." arXiv:2502.16704. https://arxiv.org/pdf/2502.16704 [PDF binary — unable to verify text, but URL resolves]

[R3-S17] Liu, J., et al. (2025). "Hierarchical Repository-Level Code Summarization for Business Applications." arXiv:2501.07857. https://arxiv.org/abs/2501.07857 [not verified]

[R3-S18] Khattab, O. & Zaharia, M. (2020). "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT." *Proceedings of SIGIR 2020*. https://arxiv.org/abs/2004.12832 [verified]

[R3-S19] Jimenez, C.E., et al. (2024). "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?" *Proceedings of ICLR 2024*. https://arxiv.org/abs/2310.06770 [verified]

[R3-S20] CEUR-WS Authors (2025). "On Precomputation and Caching in Information Retrieval Experiments with Pipeline Architectures." arXiv:2504.09984. https://arxiv.org/html/2504.09984 [not verified]

[R3-S21] Pinecone (2024). "Rerankers and Two-Stage Retrieval." Pinecone Learn Series on RAG. https://www.pinecone.io/learn/series/rag/rerankers/ [not verified]

[R3-S22] Kou, Z., et al. (2025). "AIF: Asynchronous Inference Framework for Cost-Effective Pre-Ranking." arXiv:2511.12934. https://arxiv.org/abs/2511.12934 [not verified]

[R3-S23] ServiceNow (2023). "RepoFusion: Training Code Models to Understand Your Repository." arXiv:2306.10998. https://arxiv.org/abs/2306.10998 [not verified]

[R3-S24] Zampetti, F., et al. (2021). "Pull Request Decision Explained: An Empirical Overview." arXiv:2105.13970. https://arxiv.org/abs/2105.13970 [not verified]

[R3-S25] Towards Data Science (2024). "Multi-Stage Approach to Building Recommender Systems." Engineering blog, 2024. https://towardsdatascience.com/multi-stage-approach-to-building-recommender-systems-71a31e58ecb4/ [not verified]

### R4 — Multi-stakeholder aggregation, validation methodology

[R4-S1] Conway, J.M. & Huffcutt, A.I. (1997). "Psychometric Properties of Multisource Performance Ratings: A Meta-Analysis of Subordinate, Supervisor, Peer, and Self-Ratings." *Human Performance*, 10(4), 331–360. https://www.semanticscholar.org/paper/Psychometric-properties-of-multisource-performance-Conway-Huffcutt/c798424f1d91bef236e23962df6be79d0bb92f55 [Semantic Scholar page blank — unable to verify]

[R4-S2] Viswesvaran, C., Schmidt, F.L., & Ones, D.S. (2005). "Is There a General Factor in Ratings of Job Performance? A Meta-Analytic Framework for Disentangling Substantive and Error Influences." *Journal of Applied Psychology*, 90(1), 108–131. https://pubmed.ncbi.nlm.nih.gov/15641893/ [not verified]

[R4-S3] Batista-Foguet, J.M., Saris, W., Boyatzis, R., Serlavós, R., & Velasco Moreno, P. (2018). "Multisource Assessment for Development Purposes: Revisiting the Methodology of Data Analysis." *Frontiers in Psychology*, 9, 2646. https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.02646/full [verified]

[R4-S4] Bracken, D.W. & Rose, D.S. (2011). "When Does 360-Degree Feedback Create Behavior Change? And How Would We Know It When It Does?" *Industrial and Organizational Psychology*, 4(1), 8–16. https://www.apa.org/pubs/journals/features/cpb-64-3-157.pdf [not verified]

[R4-S5] Dierdorff, E.C. & Morgeson, F.P. (2007). "Consensus in Work Role Requirements: The Influence of Discrete Occupational Context on Role Expectations." *Journal of Applied Psychology*, 92(5), 1228–1241. https://pubmed.ncbi.nlm.nih.gov/17845082/ [not verified]

[R4-S6] Smither, J.W., London, M., & Reilly, R.R. (2005). "Does Performance Improve Following Multisource Feedback? A Theoretical Model, Meta-Analysis, and Review of Empirical Findings." *Personnel Psychology*, 58(1), 33–66. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2005.514_1.x [not verified]

[R4-S7] Fitch, K., Bernstein, S.J., Aguilar, M.D., Burnand, B., LaCalle, J.R., Lazaro, P., van het Loo, M., McDonnell, J., Vader, J., & Kahan, J.P. (2001). *RAND/UCLA Appropriateness Method User's Manual*. RAND Corporation, MR-1269. https://www.rand.org/pubs/monograph_reports/MR1269.html [not verified]

[R4-S8] PMC Authors (2022). "Planning and Reporting Effective Web-Based RAND/UCLA Appropriateness Method Panels." *PMC*, PMC9463617. https://pmc.ncbi.nlm.nih.gov/articles/PMC9463617/ [not verified]

[R4-S9] RAND (2023). "Delphi Method — RAND 2023 Commentary." RAND Commentary, October 2023. https://www.rand.org/pubs/commentary/2023/10/generating-evidence-using-the-delphi-method.html [not verified]

[R4-S10] McMillan, S.S., King, M., & Tully, M.P. (2020). "Delphi, non-RAND modified Delphi, RAND/UCLA appropriateness method and a novel group awareness and consensus methodology for consensus measurement: A systematic literature review." *Current Medical Research and Opinion*, 36(10), 1731–1739. https://www.tandfonline.com/doi/full/10.1080/03007995.2020.1816946 [not verified]

[R4-S11] Schmidt, F.L. & Hunter, J.E. (via SIOP 2018 Principles). General principles from validity generalization literature. https://www.houstontx.gov/hr/hrfiles/classified_testing/siop_principles.pdf [not verified]

[R4-S12] Sackett, P.R., Zhang, C., Berry, C.M., & Lievens, F. (2022). "Revisiting Meta-Analytic Estimates of Validity in Personnel Selection: Addressing Systematic Overcorrection for Restriction of Range." *Journal of Applied Psychology*, 107(11), 2040–2068. https://www.master-hr.com/insights/insights-from-sackett-et-al-2023/ [not verified — summary page]

[R4-S13] SIOP (2018). *Principles for the Validation and Use of Personnel Selection Procedures* (5th ed.). Society for Industrial and Organizational Psychology. https://www.houstontx.gov/hr/hrfiles/classified_testing/siop_principles.pdf [not verified]

[R4-S14] Johnson, J.W. & Carter, G.W. (2010). "Validating Synthetic Validation: Comparing Traditional and Synthetic Validity Coefficients." *Personnel Psychology*, 63(3), 755–795. https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.2010.01186.x [URL dead as of 2026-04-10 — 403 error]

[R4-S15] Hoffman, C.C. (1999). "Generalizing Physical Ability Test Validity: A Case Study Using Test Transportability, Validity Generalization, and Construct-Related Validation Evidence." *Personnel Psychology*, 52(4), 1019–1041. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.1999.tb00188.x [not verified]

[R4-S16] Shadish, W.R., Cook, T.D., & Campbell, D.T. (2002). *Experimental and Quasi-Experimental Designs for Generalized Causal Inference*. Houghton Mifflin. https://www.semanticscholar.org/paper/Experimental-and-Quasi-Experimental-Designs-for-Shadish-Cook/4e950e026f5199219facb36d1886c3d096944f43 [not verified]

[R4-S17] SIOP (2023). *Considerations and Recommendations for the Validation and Use of AI-Based Assessments for Employee Selection*. SIOP Statement, January 2023. https://www.siop.org/post/siop-releases-recommendations-for-ai-based-assessments/ [verified]

---

## Verifier Notes

### URL verification summary

**Total sources:** 84 across four research files (R1: 18, R2: 24, R3: 25, R4: 17)

**Verified:** 15 sources successfully fetched and confirmed matching claimed content
- R1-S4 (Gale et al. 2013 framework method)
- R1-S8 (Adams et al. Chain of Density)
- R1-S9 (PARSE schema optimization)
- R1-S11 (Guardian missing-person extraction)
- R2-S1 (Liff et al. 2024 video interview psychometrics)
- R2-S11 (Kell et al. 2017 BARS ETS report)
- R2-S16 (EU AI Act summary page)
- R2-S20 (EEOC iTutorGroup settlement)
- R2-S22 (EEOC Strategic Enforcement Plan)
- R2-S24 (New England Biz Law blog — single source)
- R3-S18 (ColBERT Khattab & Zaharia)
- R3-S19 (SWE-bench Jimenez et al.)
- R4-S3 (Frontiers in Psychology 2018 multisource)
- R4-S17 (SIOP 2023 AI assessment guidance)
- Plus R1-S2, R1-S3, R1-S5, R1-S17 (verified via summary/ResearchGate pages)

**Dead links (403 or timeout):** 4
- R1-S6 (Reynolds & Gutman laddering — Taylor & Francis 403 error)
- R2-S17 (NYC Local Law 144 DCWP page — timeout after 60s)
- R2-S18 (Griggs v. Duke Power Justia page — 403 error)
- R4-S14 (Johnson & Carter 2010 Wiley — 403 error)

**Redirected:** 1
- R1-S10 (Nature Scientific Reports — 303 redirect, not followed to final destination)

**PDF binaries (unverifiable via text extraction):** 2
- R3-S3 (Kalliamvakou MSR 2015 PDF)
- R3-S16 (Makharev code summarization PDF)

**Unable to verify (blank page or insufficient content):** 1
- R4-S1 (Conway & Huffcutt Semantic Scholar page returned blank)

**Not verified (not sampled in verification batch):** 61 sources across vendor documentation, arXiv preprints, Wiley/Springer paywalled journals, and secondary summaries

### Citation accuracy issues flagged

1. **R2-S7 attribution mismatch:** Draft cites "Quinn & Spreitzer 2014" but the verified source is **Heritage, Pollock & Roberts 2014**. Heritage et al. *validated* the OCAI (which Cameron & Quinn developed), but are not Quinn themselves. Citation marker preserved but corrected in Sources section.

2. **R3-S4 attribution mismatch:** Draft cites "Gousios et al. 2022" but the verified arXiv paper is authored by **Kudrjavets, Nagappan & Rastogi 2022**. Citation marker preserved but corrected in Sources section.

3. No broken `[R#-S#]` markers detected — all inline citations resolve to existing source entries in the research files.

### Unsourced claims

No major claims in the draft body lack citation markers. The Lead Researcher systematically marked every substantive claim with `[R#-S#]` references.

---

*End of cited brief. Ready for T7 reviewer pass.*
