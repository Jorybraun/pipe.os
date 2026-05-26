# R4 Research — Multi-Stakeholder Aggregation & Validation Methodology

**Researcher:** R4 (Sonnet 4.6)
**Date:** 2026-04-10
**Plan file:** `knowledge/outputs/.plans/role-discovery-data-contract.md`
**Task IDs covered:** T4 (Q3 + Q10)
**Output file:** `knowledge/outputs/role-discovery-data-contract-research-validation.md`

---

## Q3 — Multi-Stakeholder Aggregation

**Question restated:** What does the psychometric literature on multi-source assessment say about preserving versus aggregating conflicting stakeholder views across PIPE's four interviewee types (HIRING_MANAGER, TEAM_MEMBER, INTERNAL_RECRUITER, EXTERNAL_RECRUITER)? When should disagreements be preserved as distinct data points, when should they aggregate, and what weighting schemes hold up empirically?

---

### 3.1 The core finding: different rater sources measure partially different things

Conway and Huffcutt's 1997 meta-analysis of multisource performance ratings is the primary anchor for this question [R4-S1]. Across subordinate, supervisor, peer, and self-ratings, they found:

- Mean inter-rater reliability within source: supervisors = .50, peers = .37, subordinates = .30
- Cross-source correlations: supervisor–peer = ρ .34; supervisor–self = ρ .22; subordinate–supervisor = ρ .22; subordinate–self = ρ .14

The supervisor–peer correlation of .34, uncorrected, means that a supervisor and a peer rating the same person on the same dimension share roughly 11–12% of variance. The remaining 88–89% is unique to the rater source. Conway and Huffcutt explicitly noted that inter-rater reliability tended to be *lower* for managerial and higher-complexity jobs — exactly the roles PIPE assesses. This low convergence does not mean ratings are invalid: it means each source genuinely observes different behavioral facets [R4-S1].

Viswesvaran, Schmidt, and Ones (2002) add the crucial decomposition [R4-S2]. Using 90 years of studies, they found that a general performance factor accounts for roughly 60% of variance in performance ratings at the construct level — but that halo effects inflate within-rater (same-source) correlations substantially (supervisory intrarater: 33% inflation; peer intrarater: 63% inflation). After correcting for halo and measurement error, peer and supervisory ratings of different dimensions correlated near 1.00, suggesting the *same underlying constructs* are being assessed by different sources, but the surface-level disagreement arises because different sources observe different behavioral samples and weight the same behaviors differently [R4-S2]. This has a critical implication: raw score disagreement between a hiring manager and a team member is not noise to be averaged away — it is signal about which behaviors each source observed.

The Frontiers study on multi-source assessment for development (2018) tested this formally using CFA across rater groups [R4-S3]. Correlations among individual dyads ranged from 0.10 to 0.41 — idiosyncratic (rater-perspective) variance dominated convergent trait variance. The scalar invariance tests that are required before mean comparisons are valid failed for 3 of 14 competencies, meaning mean aggregation was statistically inappropriate for those dimensions. For the remaining 11 competencies, scalar invariance held, and aggregation was justified. The study's bottom line: aggregation is only defensible when scalar invariance has been established through CFA; absent that test, combining sources produces a number that measures neither source accurately [R4-S3].

---

### 3.2 When disagreement is signal, not noise

Atwater, Waldman and colleagues (summarized in the APA 15-question evidence review [R4-S4]) identified four explanatory mechanisms for cross-source disagreement:

1. **Selective behavioral observation** — supervisors see upward-management behavior; peers see collaboration behavior; subordinates see direction-giving. Each source has a different behavioral sample.
2. **Sampling bias** — raters have unequal opportunities to observe the ratee.
3. **Differential importance weighting** — the same observed behavior is rated differently because sources have different criteria for what counts.
4. **Linguistic/frame-of-reference effects** — question wording triggers different interpretive frames for different role positions.

Of these, mechanisms 1 and 3 are directly relevant to PIPE. A HIRING_MANAGER asking "does this person have the judgment to own scope?" observes different behaviors than a TEAM_MEMBER asking "will this person create or absorb friction?" Both are measuring something real, and the difference between them is meaningful.

Dierdorff and Morgeson (2007) extend this with job analysis data from 20,000+ incumbents across 98 occupations [R4-S5]. Consensus on work role requirements systematically decreased as requirements became more molar (tasks → responsibilities → traits), and consensus was *lower* in highly interdependent and autonomous occupational contexts. Software engineering is the textbook case of high interdependence and autonomy. The implication: when PIPE collects role descriptions from a hiring manager and a team member, genuine disagreement at the "traits and culture" level is expected and carries legitimate information about how different parts of the team experience the role — not error to be suppressed.

Smither, London et al. (2005) meta-analysis across 24 longitudinal studies reinforced that "different rater sources conceptualize performance in a similar manner" at the construct level, but that effect sizes for performance improvement after multisource feedback were small: d = .24 (direct reports, unweighted), d = .12 (peers), d = .14 (supervisors), d = .00 (self) — all decreasing substantially when weighted by sample size [R4-S6]. The asymmetry across sources suggests that *each source type holds different information*, and that the subordinate (direct report) perspective carries the most developmental signal. Translating to PIPE: the TEAM_MEMBER perspective carries the most signal about daily working reality; the HIRING_MANAGER perspective carries scope and stakes signal; recruiter perspectives carry the least irreplaceable information.

---

### 3.3 The RAND/UCLA Appropriateness Method: a structured protocol for preserving disagreement

The RAND/UCLA Appropriateness Method (RAM) is the gold standard for multi-stakeholder consensus aggregation in medical guideline development [R4-S7]. It uses a 9-point scale, with decisions categorized by the combination of (a) median rating and (b) inter-rater disagreement. The standard classification rules, as described in the RAM literature and NCBI documentation, are:

- **Appropriate**: median ≥ 7, no disagreement (IQR ≤ 3, centered above the neutral region)
- **Inappropriate**: median ≤ 3, no disagreement
- **Uncertain**: median 4–6, *or* any distribution showing disagreement regardless of median

The critical design principle is that **disagreement is treated as its own category, not as a signal to average**. When panelists in different roles disagree (clinician vs. administrator vs. patient advocate), the RAM records the disagreement as "uncertain" rather than computing a mean that satisfies no one's actual view. The method explicitly calls for qualitative discussion of areas of disagreement before final re-rating — preserving the minority position as structured data before re-convergence is attempted [R4-S7].

The PMC review of web-based RAM panels (2022) adds: the method's threshold for agreement uses the interpercentile range adjusted for symmetry (IPRAS) — disagreement is flagged when the interpercentile range exceeds the IPRAS for a given rating distribution, not simply when the IQR exceeds a fixed threshold [R4-S8]. This asymmetric sensitivity means a split of "all clinicians rate 8, all administrators rate 4" is detected as disagreement even though the median might land in the 6 range.

The RAM does not apply differential weighting by stakeholder role in its standard form. All panelists' ratings carry equal arithmetic weight. The substantive difference it enforces is *separation by role before the joint rating round* — ensuring each group's views are captured independently before cross-role discussion is introduced. This separation-then-structured-reconciliation design is the principle PIPE should borrow.

---

### 3.4 The Delphi method: preserving minority views

Classic Delphi methodology [R4-S9] makes a comparable design choice: panelists who fall outside the IQR are asked to justify their position before the next round. Their minority view is preserved in the output, not discarded. The mathematical aggregation of the Delphi method (as opposed to behavioural/face-to-face consensus) is specifically designed to avoid the minority silencing that happens in unstructured group discussion. PIPE's synthesis agent faces the same risk: if it simply averages across stakeholders, minority perspectives from team members who dissent from the hiring manager's framing will vanish.

A 2020 systematic literature review comparing Delphi and RAND/UCLA variants found that "the Delphi method can inadvertently constrain nuance; in pursuit of consensus, responses may converge toward statistical averages or generalized statements, obscuring conditional logic and domain-specific caveats" [R4-S10]. This is exactly the failure mode PIPE must avoid.

---

### 3.5 Weighting schemes: what holds up empirically

Three weighting approaches have been studied:

**Equal weighting across all sources.** The default in most 360-degree systems. Conway and Huffcutt's data show supervisors have the highest reliability (.50) and subordinates the lowest (.30), so equal weighting discards known reliability differences [R4-S1]. Empirically, however, differential weighting by source rarely outperforms equal weighting in predictive accuracy studies — the gains are small and context-dependent. The argument for equal weighting is therefore more operational (simplicity, auditability) than empirical (accuracy).

**Reliability-weighted aggregation.** Weights each source's contribution proportionally to its within-source inter-rater reliability. Supervisor inputs count more than subordinate inputs. Supported weakly by Conway and Huffcutt's reliability differentials [R4-S1]. Not yet definitively shown to outperform equal weighting in predictive criterion studies.

**Role-authority weighting with preserved disagreement record.** This is the design recommended by the APA evidence review [R4-S4]: treat each rater source as carrying *domain-specific authority*, weight accordingly for specific field types, but preserve the full per-source record for fields where sources have conflicting authority. Concretely: HIRING_MANAGER carries authoritative weight on scope and stakes (the "why" and "bar" domains in PIPE's six-domain framework); TEAM_MEMBER carries authoritative weight on team culture, collaboration patterns, and day-to-day working reality (the "team" and "process" domains); recruiters carry low independent weight but high connective weight (they have interviewed many similar roles and can flag anomalies). Self-report is not collected in PIPE's design.

The empirical basis for this domain-specific authority view comes from Smither et al. (2005), where direct report (subordinate) ratings showed larger effects than supervisor ratings for improvement, and from the Frontiers (2018) CFA work showing scalar invariance held per dimension — meaning that for some competency dimensions, sources genuinely diverge in a construct-level way that justifies treating them separately [R4-S3, R4-S6].

---

### 3.6 Recommendation: structure-preserving aggregation with conflict flags

**The aggregation scheme PIPE should implement has three tiers:**

**Tier 1 — Domain-authoritative fields (aggregate within domain, preserve source).**
Fields where one stakeholder type has clear observational authority are anchored by that source but include all others as supplementary. The schema should store `primary_authority: "HIRING_MANAGER"` on scope/stakes fields and `primary_authority: "TEAM_MEMBER"` on culture/collaboration fields, alongside the per-source raw text and rating.

**Tier 2 — Shared-domain fields (preserve per-source, flag disagreement).**
For fields where multiple sources have legitimate claims (e.g., "what does success look like in the first 90 days?"), the schema stores per-source answers *without collapse*, plus a structured `conflict_flag: true` when answers are substantively different. The downstream scorer reads all per-source values plus the conflict flag and treats them as separate evidence, not as a single average.

**Tier 3 — Aggregated summary fields (explicit computation).**
Fields where genuine consensus is expected (e.g., job title, tech stack, obvious must-haves) can be aggregated as a computed field, but the aggregation formula must be explicit (e.g., `"senior_signal": weighted_mean([HM: .50, TM: .30, IR: .10, ER: .10])`) so downstream consumers know what they are reading.

**What the scorer should do when stakeholders conflict on a critical signal:**

When `conflict_flag: true` is set on a critical field (e.g., "degree of autonomy expected"), the scoring agent should:
1. Read both per-source values directly — not the averaged value.
2. Weight the culture/collaboration interpretation toward TEAM_MEMBER.
3. Weight the scope/authority interpretation toward HIRING_MANAGER.
4. Flag to the recruiter that the conflict exists and that assessment calibration may need manual review.

This is consistent with the RAND/UCLA principle that disagreement is itself an informative category, not a problem to be resolved by arithmetic [R4-S7].

---

### RCD + RUC implications for Q3

**Role Context Document (RCD):** The schema must include per-stakeholder sections for each of the six domains, with a top-level `conflicts[]` array listing fields where source views diverged substantively. Flat fields that aggregate without preserving source identity should be marked as `aggregated: true` with an explicit formula. The `conflicts[]` array becomes a first-class field the scoring agent reads, not a debug artifact.

**Repo Understanding Contract (RUC):** The RUC is not directly affected by multi-stakeholder aggregation — repos don't have multiple stakeholder sources. However, the `repo_role_alignment` table should accept the full RCD (including per-source fields and conflict flags) rather than just a flattened persona slice, so that alignment scoring can use the richer team context rather than an averaged signal.

---

## Q10 — Validation Methodology for Role-Tailored Assessment

**Question restated:** What validation methodologies are tractable at low-to-moderate hiring volumes (<500 candidates per quarter, PIPE's realistic early-customer range)? The goal is a validation protocol that produces credible evidence of improved hiring signal within the first 3–6 months of a customer engagement — without the sample sizes traditional concurrent-validity studies demand.

---

### 10.1 The core problem: criterion validity at small N is severely underpowered

Traditional concurrent criterion validity studies require large samples to detect moderate validity coefficients at acceptable power. The standard guideline from selection research practice (derived from Schmidt and Hunter validity generalization literature and referenced by SIOP 2018 Principles) is that a sample of 100 produces a 95% confidence interval around a true r = .30 that spans roughly ±.20 — wide enough to include zero [R4-S11]. For organizations hiring 500 candidates per quarter, a concurrent study accumulates ~125 candidates in a single quarter, barely above the minimum threshold and only if performance criterion data are available, which typically requires 6–12 months of on-the-job tenure for reliable supervisor ratings. At 50–100 candidates per quarter, local concurrent studies are simply not feasible as primary evidence [R4-S11].

Sackett et al.'s 2022 revised meta-analysis placed structured interview validity at r_op = .42 (80% credibility interval: .18–.66) [R4-S12]. The width of that credibility interval reflects genuine between-study variability, not just sampling error — situational specificity matters. Role-tailored interviews with role-specific anchors are expected to land in the upper half of that credibility interval, but demonstrating this locally at <500 candidates per quarter requires alternative evidence strategies [R4-S12].

---

### 10.2 Validity generalization: the strongest available substitute

Validity generalization (VG) allows inference from the published literature to a specific local application when the predictor construct, criterion construct, and job family are sufficiently similar [R4-S13]. The SIOP 2018 Principles explicitly recognize VG as an acceptable alternative to local criterion validity studies for small employers: "smaller businesses where the employer has difficulty obtaining a large enough sample of subjects for a technically adequate validation study (about 100)" can rely on published validity generalization estimates [R4-S13].

The condition for applying VG is that the predictor and criterion in the VG database must be plausibly similar to the local tool and local criterion. For PIPE's role-tailored assessment:
- The base predictor (structured behavioral interview / code review BARS rubric) maps onto published structured interview validity literature (r_op ≈ .42).
- The criterion (software engineer job performance) maps onto the software engineering job performance criterion space studied in the structured interview meta-analysis literature.
- The tailoring (role-specific anchors, team-specific probes) is a *modification* not documented in the VG base — this is the gap that role-specific validation evidence needs to fill.

The practical implication: PIPE can claim VG-based validity for the *base* assessment structure, then needs incremental evidence only for the *tailored delta* — a much more tractable problem [R4-S13].

---

### 10.3 Synthetic validity: the right tool when job analysis data are available

Synthetic validity (job component validity) builds a validity estimate from the known predictor–criterion relationship for individual job components, assembled from published literature, rather than from a local study [R4-S14]. Johnson and Carter (2010) conducted the most direct test of synthetic validity's accuracy: using job analysis data from 4,725 incumbents and 619 supervisors across 11 job families and 27 job components, they computed synthetic validity coefficients and compared them to traditional criterion-related validity coefficients obtained from a concurrent study of 1,926 incumbents [R4-S14]. Synthetic and traditional coefficients were highly correlated, supporting the claim that synthetic validation is a legitimate alternative to local criterion studies — particularly for small organizations or novel job configurations.

The SIOP guideline specifically states: "Synthetic validation procedures are especially applicable for smaller businesses where the employer has difficulty obtaining a large enough sample of subjects for a technically adequate validation study (about 100)" [R4-S13]. Synthetic validity requires:
1. A thorough job analysis identifying the key job components (in PIPE's terms: the six domains — why, work, team, bar, codebase, process).
2. A published predictor–job component validity matrix linking each predictor construct (e.g., code review precision, communication clarity) to the relevant job components.
3. A job requirements matrix expressing this specific role's profile across those components.

The Role Context Document is, in effect, the input to a job requirements matrix. This is not accidental — synthetic validity was designed for exactly this use case. The RCD's domain decomposition maps directly onto the job component structure synthetic validation requires.

---

### 10.4 Transportability analysis: bridging from published studies to local application

Transportability analysis (Hoffman, 1999; SIOP 2018 Principles) is the validity generalization approach applied to a specific test–job pairing, using job analysis evidence to document similarity between the local job and the jobs in the VG database [R4-S15]. The procedure: (a) collect job analysis data for the local job, (b) compare the local job profile to job profiles in the validity database, (c) if job profiles are sufficiently similar (operationalized via subject matter expert judgment or statistical distance), claim the published validity estimate is transportable.

Hoffman (1999) demonstrated this with physical ability tests across 95 jobs at a utility company: PAQ-based cluster analysis produced five job families; 95% of SME agreement between statistical and rational family assignment; transportability inferences defended without conducting separate local validity studies [R4-S15]. The methodological lesson is that transportability analysis requires: a structured job analysis, a documented similarity judgment, and SME ratification — none of which require a local criterion dataset.

For PIPE: the Role Discovery interview is itself the job analysis data collection instrument. A Role Context Document that records the role's six-domain profile in structured format is the input for a transportability similarity comparison against published validity studies of software engineering role assessment. This requires no criterion data from the customer — only structured role analysis output.

---

### 10.5 Quasi-experimental alternatives for early-stage customers

Shadish, Cook, and Campbell (2002) identify several quasi-experimental designs that produce credible causal inference without randomization [R4-S16]. Two are tractable at PIPE's volumes:

**Within-organization A/B comparison (non-equivalent groups design).** If a customer uses PIPE for some roles and a prior process for others during the same period, comparison of 6-month or 12-month retention and performance outcomes across the two groups constitutes a quasi-experiment. With n=50 in each arm and a plausible effect size of d=.25 (mid-range of structured interview validity advantage), statistical power is approximately 0.40–0.50 — low, but not zero, and sufficient for directional inference. The threat is selection bias in which roles use PIPE vs. not; this must be documented and addressed.

**Pre–post interrupted time series within one organization.** Before PIPE deployment: document prior hiring process and outcomes (retention at 12 months, manager-rated performance at 6 months). After PIPE deployment: track same criteria. With 3–4 pre-deployment cohorts and 3–4 post-deployment cohorts, interrupted time series can detect change if the effect is large enough. This design works best when organizational conditions are stable across the transition [R4-S16].

Neither design is the gold standard. Neither produces a validity coefficient. But both produce credible directional evidence at low N — exactly what a skeptical customer or regulator needs at 3–6 months.

---

### 10.6 Construct validity triangulation: the evidence package at <100 candidates

When N is below 50, criterion validity evidence is not obtainable at any useful precision. The SIOP 2018 Principles and the SIOP 2023 AI assessment guidance both accept construct validity evidence — triangulated from multiple non-criterion sources — as a legitimate partial substitute [R4-S13, R4-S17]. The required evidence types for a construct validity case are:

1. **Content validity** — documented job analysis showing that assessed dimensions map onto job-relevant knowledge, skills, abilities, and other characteristics (KSAOs). PIPE's six-domain Role Discovery interview, with structured RCD output and explicit mapping to BARS dimensions, constitutes this. Requires SME review of the domain-to-BARS mapping (minimum 3–5 software engineering SMEs per job family, per SIOP content validity guidance).

2. **Convergent/discriminant validity** — scores on PIPE's assessment should correlate with scores on other measures of the same construct (e.g., structured interview data from an independent assessor) and should *not* correlate with irrelevant constructs (e.g., demographic variables that shouldn't predict engineering performance). Even at N=30, a Pearson correlation with an independent structured interview score can be computed with bootstrap confidence intervals.

3. **Fairness/measurement invariance** — the SIOP 2023 guidance for AI-based assessments explicitly requires testing that scores are not systematically biased against protected groups. At small N, this requires either (a) pooling data across customers to test measurement invariance at the aggregate level, or (b) commissioning a synthetic validation study using existing published invariance literature for structured interviews [R4-S17].

4. **Face and expert validity** — software engineering SMEs review challenge content and BARS anchors, confirming they reflect real-world engineering work at the described seniority level. This is the cheapest and fastest form of validity evidence and should be the *first* evidence collected before any candidate data exist.

The combination of (1) + (4) is available at zero candidates. Adding (2) requires N ≥ 30. The quasi-experimental designs in §10.5 add criterion-suggestive evidence at N ≥ 50.

---

### 10.7 What counts as "credible evidence" at <500 candidates per quarter

Drawing on the above literature, PIPE can define credible evidence at four thresholds:

| Threshold | Evidence available | Label |
|---|---|---|
| 0 candidates | Job analysis + SME content validity + expert review of BARS anchors | **Pre-deployment face validity** |
| 30–50 candidates | + Convergent validity with independent structured interview rater (r ≥ .25, bootstrapped 95% CI excludes 0); adverse impact analysis (4/5ths rule, N permitting) | **Construct validity triangle** |
| 100–200 candidates | + Transportability analysis comparing RCD job profiles to published validity database; synthetic validity estimate for each predictor–criterion pair | **Transportability case** |
| 300–500 candidates | + Concurrent validity study with 6-month manager-rated performance criterion; interrupted time series or non-equivalent groups quasi-experiment | **Criterion-suggestive evidence** |

This staged accumulation mirrors the SIOP 2018 and 2023 guidance that "evidence should accumulate over time" and that organizations are not expected to have criterion validity evidence before deployment, provided they have documented job analysis and content validity justification [R4-S13, R4-S17].

The key constraint: at each threshold, adverse impact monitoring must be active. The four-fifths (80%) rule under the Uniform Guidelines requires that each subgroup's selection rate be ≥ 80% of the highest group's rate. This monitoring is required regardless of whether a local criterion validity study exists, and at small N it must be done by pooling across customers (not within a single customer's dataset).

---

### 10.8 Sample size estimate for the criterion-suggestive threshold

To detect r = .30 (a plausible role-tailored vs. universal assessment advantage) with power = .80 at two-tailed α = .05, the required N is approximately 85 (from standard correlation power tables). To detect r = .20 with the same power, N ≈ 193. For PIPE's early customers at 50–200 hires per quarter, the realistic within-customer N over a 6-month engagement is 100–400 total candidates, of which perhaps 20–40 are hired. The criterion dataset (post-hire performance at 6 months) will therefore grow slowly. This is why the transportability + construct validity triangle approach is the right focus for the first 6 months, with criterion study design documented and instrumented from day one so evidence accumulates in a usable form.

---

### 10.9 Practical protocol sketch for PIPE

**Month 0 (pre-deployment for each new customer):**
- Run Role Discovery interview with all available stakeholders (HIRING_MANAGER + TEAM_MEMBER minimum).
- Document RCD in structured JSON; map each BARS dimension to six-domain job analysis output.
- Recruit 3–5 software engineering SMEs (can be early users or advisory board) to review challenge content and BARS anchors against the RCD.
- Record any adverse impact monitoring baseline from existing hiring data if available.

**Months 1–3 (first candidate cohort):**
- All candidates also complete a 5-item structured behavioral interview conducted by an independent person (not the PIPE AI) — this is the convergent validity reference measure.
- After N=30 candidates: run bootstrapped Pearson correlation between PIPE scores and independent interview scores; compute 95% CI.
- Document results as "construct validity evidence, Month 3 snapshot."

**Months 3–6 (accumulation phase):**
- At N=100 candidates: run transportability analysis. Pull the RCD job profile for each dimension, compare to published validity database (Sackett et al. 2022 structured interview estimates) using SME similarity ratings.
- Compute synthetic validity estimate for each BARS dimension using the predictor–job component matrix.
- Document as "transportability case."
- Begin 6-month performance criterion collection protocol: supervisor-rated performance at 6 months post-hire using validated 3-item performance measure.

**Month 6+ (criterion-suggestive threshold):**
- When ≥ 50 hired candidates have reached 6-month tenure: run Pearson criterion-related validity coefficient with 95% CI.
- If a matched comparator group (roles that used prior process) exists: run quasi-experimental comparison on retention at 12 months.
- Report: `r_criterion = [X], 95% CI [Y, Z]; N = [n], prior-process comparator N = [n2]`.

**Ongoing:**
- Pool data across customers to test measurement invariance for protected subgroups.
- Track 4/5ths rule at each assessment stage per quarter.
- Record all calibration decisions in the Decision Log per ADR-033 guardrail.

---

### RCD + RUC implications for Q10

**Role Context Document (RCD):** The RCD must include a `validation_metadata` section recording: which customer, which RCD version was in effect during each candidate cohort, which BARS version was used, and when the RCD was last updated. Without this metadata, it is impossible to track which assessment configuration a criterion validity coefficient actually measures. Version-locked RCDs are not just best practice — they are what makes the criterion study interpretable.

**Repo Understanding Contract (RUC):** The RUC's two-stage architecture (offline `repo_engineering_signals` + runtime `repo_role_alignment`) must similarly record which RCD version and which engineering signal version was in effect for each alignment decision. If signals are updated, the alignment scores are no longer comparable across time — invalidating any quasi-experimental comparison. Versioning the RUC is a validation precondition.

---

## Contradictions

1. **Conway & Huffcutt (low inter-source convergence) vs. Viswesvaran, Schmidt & Ones (construct-level convergence near 1.00).** Conway and Huffcutt found supervisor–peer correlation of only ρ = .34 at the rating level [R4-S1]. Viswesvaran et al. found that *construct-level* (error-corrected) ratings correlated near 1.00 [R4-S2]. These are not actually contradictory: raw ratings diverge substantially due to observation sampling and halo error, but the underlying construct being measured is the same. The practical resolution for PIPE is to preserve per-source raw data (where observation sampling differences are real) while recognizing that the underlying construct target is shared.

2. **Equal weighting (practically robust) vs. reliability-differential weighting (theoretically superior).** Conway and Huffcutt's reliability differences support weighting supervisors more heavily, but the empirical advantage of differential over equal weighting is small and not consistently replicated [R4-S1]. The Frontiers (2018) study found some dimensions where sources genuinely diverge in a construct-level way, making neither simple weighting scheme appropriate — domain-specific authority weighting is the resolution [R4-S3].

3. **SIOP endorsement of synthetic validity vs. limited empirical tests.** Johnson and Carter (2010) is the strongest direct test of synthetic validity accuracy, but it was conducted with a large sample for calibration (1,926 incumbents) [R4-S14]. The claim that synthetic validity applies at small N (< 100 per job family) rests on the 2018 SIOP Principles policy statement [R4-S13] more than on direct empirical demonstration at those volumes. This remains a genuine gap.

---

## Known gaps

1. **No published research specifically addresses multi-stakeholder aggregation in the PIPE use case** — where stakeholders are providing role-*definition* data (not candidate assessment data). The 360-degree feedback and RAND/UCLA literature is analogous but not identical: their sources assess a known individual; PIPE's sources define an unknown future hire. The gap is a direct inference, not an empirically tested claim.

2. **Weighting schemes for recruiter perspectives (INTERNAL vs. EXTERNAL) have no empirical anchor.** The literature addresses supervisor, peer, and subordinate weights in performance assessment. Recruiter perspectives in role-definition contexts are not studied as such. The recommendation here to weight recruiters low on culture and team specifics and higher on role-family comparisons is reasonable but (single source — unverified) in that exact form.

3. **Sample size estimates in §10.7 are derived from standard correlation power tables, not from hiring-specific bootstrap simulations** that account for range restriction, criterion measurement error, and inter-rater reliability of the criterion measure. Real required Ns for PIPE's setting are likely 20–30% higher than the table values suggest.

4. **The staged validation protocol in §10.9 has not been tested as an integrated system.** Each individual element (SME content validity, convergent validity, transportability, quasi-experimental) is supported by literature, but the claim that they combine into a coherent cumulative evidence package is an inference.

5. **Adverse impact monitoring at N < 50 per subgroup** is not interpretable with the 4/5ths rule alone. At N=10 per subgroup, a selection rate difference of one person triggers a violation. PIPE needs a pooled-customer adverse impact protocol from launch; this is not addressed by the individual-customer validation protocol here.

---

## Sources

| ID | Citation | Year | Type | Strength |
|---|---|---|---|---|
| R4-S1 | Conway, J.M. & Huffcutt, A.I. "Psychometric Properties of Multisource Performance Ratings: A meta-Analysis of Subordinate, Supervisor, Peer, and Self-Ratings." *Human Performance*, 10(4), 331–360. | 1997 | Peer-reviewed meta-analysis | High — foundational meta-analysis, widely replicated |
| R4-S2 | Viswesvaran, C., Schmidt, F.L., & Ones, D.S. "Is There a General Factor in Ratings of Job Performance?" *Journal of Applied Psychology*, 90(1), 108–131. | 2005 | Peer-reviewed meta-analysis | High — 90 years of data, major variance decomposition |
| R4-S3 | Multisource Assessment for Development Purposes: Revisiting the Methodology of Data Analysis. *Frontiers in Psychology*, 9, 2646. | 2018 | Peer-reviewed empirical study | High — CFA methodology, direct aggregation criteria |
| R4-S4 | Bracken, D.W., & Rose, D.S. "When Does 360-Degree Feedback Create Behavior Change? And How Would We Know It When It Does?" *Industrial and Organizational Psychology*, 4(1), 8–16. (and the associated APA 15-questions evidence review, *Journal of Consulting and Clinical Psychology*). | 2011 | Peer-reviewed / practice evidence review | Moderate — good evidence synthesis, less rigorous than meta-analysis |
| R4-S5 | Dierdorff, E.C. & Morgeson, F.P. "Consensus in Work Role Requirements: The Influence of Discrete Occupational Context on Role Expectations." *Journal of Applied Psychology*, 92(5), 1228–1241. | 2007 | Peer-reviewed empirical study | High — large N (20,000+ incumbents), 98 occupations |
| R4-S6 | Smither, J.W., London, M., & Reilly, R.R. "Does Performance Improve Following Multisource Feedback? A Theoretical Model, Meta-Analysis, and Review of Empirical Findings." *Personnel Psychology*, 58(1), 33–66. | 2005 | Peer-reviewed meta-analysis | High — 24 longitudinal studies, effect sizes reported by source |
| R4-S7 | RAND/UCLA Appropriateness Method User's Manual (Fitch et al., 2001). RAND Corporation, MR1269. | 2001 | Official methodological manual (RAND) | High — definitive specification of the RAM method |
| R4-S8 | Planning and Reporting Effective Web-Based RAND/UCLA Appropriateness Method Panels. *PMC / NCBI*, PMC9463617. | 2022 | Peer-reviewed systematic review | Moderate — methodological guidance, not primary empirical |
| R4-S9 | Delphi Method. Wikipedia synthesis of Linstone & Turoff (1975) and subsequent literature, plus RAND 2023 commentary. | 2023 | Encyclopedia / reference synthesis | Moderate — useful overview, secondary |
| R4-S10 | "Delphi, non-RAND modified Delphi, RAND/UCLA appropriateness method and a novel group awareness and consensus methodology for consensus measurement: a systematic literature review." *Current Medical Research and Opinion*, 36(10). | 2020 | Peer-reviewed systematic review | High — direct comparison of methods, identifies failure modes |
| R4-S11 | Schmidt, F.L. & Hunter, J.E. General principles from validity generalization literature; referenced via SIOP 2018 Principles and Criteria Corp overview. | 2018 | SIOP professional standards (peer-reviewed basis) | High — consensus professional standard |
| R4-S12 | Sackett, P.R., Zhang, C., Berry, C.M., & Lievens, F. "Revisiting Meta-Analytic Estimates of Validity in Personnel Selection." *Journal of Applied Psychology*, 107(11), 2040–2068. | 2022 | Peer-reviewed meta-analysis | High — landmark revision of selection validity estimates |
| R4-S13 | SIOP (2018). *Principles for the Validation and Use of Personnel Selection Procedures* (5th ed.). Society for Industrial and Organizational Psychology. | 2018 | Professional standards document | High — authoritative SIOP standard, legally referenced |
| R4-S14 | Johnson, J.W. & Carter, G.W. "Validating Synthetic Validation: Comparing Traditional and Synthetic Validity Coefficients." *Personnel Psychology*, 63(3), 755–795. | 2010 | Peer-reviewed empirical study | High — direct accuracy test of synthetic validity |
| R4-S15 | Hoffman, C.C. "Generalizing Physical Ability Test Validity: A Case Study Using Test Transportability, Validity Generalization, and Construct-Related Validation Evidence." *Personnel Psychology*, 52(4), 1019–1041. | 1999 | Peer-reviewed case study | Moderate — influential methodology demonstration, single domain |
| R4-S16 | Shadish, W.R., Cook, T.D., & Campbell, D.T. *Experimental and Quasi-Experimental Designs for Generalized Causal Inference.* Houghton Mifflin, Boston. | 2002 | Academic textbook (peer-reviewed basis) | High — definitive treatment of quasi-experimental design |
| R4-S17 | SIOP (2023). *Considerations and Recommendations for the Validation and Use of AI-Based Assessments for Employee Selection.* SIOP Statement, January 2023. | 2023 | Professional standards / guidance document | High — specific to AI-based hiring tools, recent |

---

## Numbered Sources List

1. [Conway & Huffcutt 1997 (Semantic Scholar abstract)](https://www.semanticscholar.org/paper/Psychometric-properties-of-multisource-performance-Conway-Huffcutt/c798424f1d91bef236e23962df6be79d0bb92f55) — Peer-reviewed meta-analysis, *Human Performance*.
2. [Viswesvaran, Schmidt & Ones 2005 (PubMed)](https://pubmed.ncbi.nlm.nih.gov/15641893/) — Peer-reviewed meta-analysis, *Journal of Applied Psychology*.
3. [Frontiers in Psychology 2018 — Multisource Assessment for Development](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.02646/full) — Peer-reviewed empirical, CFA methodology.
4. [APA 15 Questions on 360-Degree Feedback (PDF)](https://www.apa.org/pubs/journals/features/cpb-64-3-157.pdf) — Practice evidence review, *Journal of Consulting and Clinical Psychology*.
5. [Dierdorff & Morgeson 2007 — Consensus in Work Role Requirements (PubMed)](https://pubmed.ncbi.nlm.nih.gov/17845082/) — Peer-reviewed empirical, *Journal of Applied Psychology*.
6. [Smither, London & Reilly 2005 (Wiley)](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2005.514_1.x) — Peer-reviewed meta-analysis, *Personnel Psychology*.
7. [RAND/UCLA Appropriateness Method User's Manual](https://www.rand.org/pubs/monograph_reports/MR1269.html) — RAND monograph, official methodological specification.
8. [PMC 2022 — Web-Based RAND/UCLA Panels](https://pmc.ncbi.nlm.nih.gov/articles/PMC9463617/) — Peer-reviewed systematic review.
9. [Delphi Method — RAND 2023 Commentary](https://www.rand.org/pubs/commentary/2023/10/generating-evidence-using-the-delphi-method.html) — RAND institutional commentary.
10. [Delphi/RAND/UCLA Systematic Review 2020 (Tandfonline)](https://www.tandfonline.com/doi/full/10.1080/03007995.2020.1816946) — Peer-reviewed systematic review.
11. [SIOP Principles 2018 (Houston TX mirror)](https://www.houstontx.gov/hr/hrfiles/classified_testing/siop_principles.pdf) — SIOP professional standards.
12. [Sackett et al. 2022 — Revisiting Meta-Analytic Estimates (master-hr.com summary)](https://www.master-hr.com/insights/insights-from-sackett-et-al-2023/) — Summary of peer-reviewed meta-analysis.
13. [SIOP 2018 Principles — synthetic validity guidance (Criteria Corp summary)](https://www.criteriacorp.com/resources/definitive-guide-validity-of-preemployment-tests/validity-pre-employment-tests) — Secondary summary of SIOP principles.
14. [Johnson & Carter 2010 — Validating Synthetic Validation (Wiley)](https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.2010.01186.x) — Peer-reviewed empirical, *Personnel Psychology*.
15. [Hoffman 1999 — Test Transportability (Wiley)](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.1999.tb00188.x) — Peer-reviewed case study, *Personnel Psychology*.
16. [Shadish, Cook & Campbell 2002 (Semantic Scholar)](https://www.semanticscholar.org/paper/Experimental-and-Quasi-Experimental-Designs-for-Shadish-Cook/4e950e026f5199219facb36d1886c3d096944f43) — Definitive textbook.
17. [SIOP 2023 AI Assessment Guidance (SIOP press release)](https://www.siop.org/post/siop-releases-recommendations-for-ai-based-assessments/) — SIOP professional guidance.
