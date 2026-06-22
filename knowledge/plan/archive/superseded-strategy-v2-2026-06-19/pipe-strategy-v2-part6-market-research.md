# Pipe Strategy v2 — Part 6: Market Research Findings
*Relevant findings extracted from the original 100-Agent Research Swarm report, organized by topic and aligned to Pipe's actual system.*

---

## Reading guide

This document pulls the market research, competitive intelligence, and external findings from the original strategy report and organizes them as reference material. Unlike Parts 1–5, this is not implementation guidance — it's the **external context** that should inform decisions.

Every section includes: what the research found, where it applies to Pipe, and a candor note on whether the finding is still relevant given your current system state.

---

## 1. Developer Assessment Platform Landscape

### What the research captured

The developer assessment market has several established players and distinct approaches to the "how do we evaluate candidates" problem:

- **CodeSignal** — structured technical assessments with their "AI Interviewer" feature, which uses a phased calibration methodology (pilot → tuned → monitored → revision) and explicit "rubric lock" milestones. Emphasizes I-O psychology involvement in tuning.
- **HackerRank** — large-scale coding challenges, moving toward AI-assisted interview features
- **Codility** — similar structured-assessment model
- **Woven** — async take-home project-based evaluation
- **Sherlock AI** — specifically focused on AI-assisted coding interview scoring, with a behavioral-consistency rubric

### The Sherlock AI framework in detail

Sherlock's scoring framework is the closest public analog to what Pipe's implementation challenge scorer should do. Four signal areas:

| Signal area | Score range | What it measures |
|---|---|---|
| Reasoning & Decomposition | 0–3 | Does the candidate break down the problem, explain dependencies, and sequence their approach before coding? |
| Code Construction Process | 0–3 | How does the candidate actually write code — edit patterns, TDD cycles, commit granularity? |
| Adaptability Under Constraint Change | 0–2 | When requirements shift mid-task, does the candidate adapt coherently or spiral? |
| Debugging & Maintenance Awareness | 0–2 | Is debugging systematic (hypothesis-driven, tool-appropriate) or trial-and-error? |

The framework's standout insight for Pipe's "assessment IS the work" thesis: **AI collaboration is a signal, not a threat**. Sherlock explicitly distinguishes "AI used for planning" (acceptable) from "AI used for solution substitution" (flagged). This maps to Pipe's dev container telemetry — high AI acceptance rate without modification flags; paste events without typing preamble flag; exploratory AI use with human-led integration is the target pattern.

### The CodeSignal phased calibration model

CodeSignal describes their AI Interviewer calibration operationally: "We run a pilot to calibrate the AI agent: your reviewers score the same interviews, our I-O team compares and tunes, then we lock the rubric for consistent scoring."

This is a useful operational model for Pipe. The stages:

- **Pilot** — rubric development with heavy human involvement. Dual-scoring (expert + LLM) with active calibration.
- **Tuned** — initial Kappa validation, rubric locked for production release.
- **Monitored** — ongoing recruiter feedback with automated drift detection against a golden set.
- **Revision** — triggered by Kappa degradation or product requirement change; new pilot cycle begins.

Pipe's culture interview already operates roughly this way informally. Formalizing with explicit rubric-lock milestones and extending the discipline to code review and the forthcoming implementation scorer is part of the Phase 6 maturity work in Part 5.

### Relevance to Pipe

The Sherlock framework is **directly applicable** to the missing CODE_IMPLEMENTATION scorer. Part 3 and Part 4 integrate this specifically. The four dimensions and weight proposals (30/30/20/20) transfer as starting points for BARS rubric design. Expect iteration against real submissions before rubric lock.

The CodeSignal phased calibration model is **operationally useful** across all three of Pipe's LLM scoring surfaces (code review, culture, implementation). Integrate as the standard rubric maturity path.

### Candor note

Pipe's competitive positioning is *not* "yet another assessment platform." The three-entity graph matching, the role discovery with multi-stakeholder synthesis, and the candidate-as-living-graph model differentiate from everything listed above. The findings here are useful as technical reference for scoring methodology, not as a roadmap of what to copy.

---

## 2. Competency Ontology and Skills Taxonomies

### What the research captured

There is **no existing standard taxonomy for developer assessment signals** that maps cleanly to Pipe's multimodal signal types (conversational turn-taking in code review, telemetry-derived coding behaviors in implementation, structured narrative responses in culture interviews).

However, three frameworks offer relevant decomposition discipline:

**Core-O (Competence Reference Ontology)** — developed by Calhau et al. at Universiteit Twente, presented at FOIS 2024. Distinguishes six fundamental competence elements:

- **Competences** (holistic capability)
- **Skills** (productive abilities)
- **Knowledge** (factual/theoretical understanding)
- **Attitudes** (dispositional qualities)
- **Tasks** (goal-oriented activities)
- **Resources** (enabling tools/environments)
- **Artifacts** (produced outputs)

This decomposition is useful as a *vocabulary* for thinking clearly about what each sub-element represents. It's not a library you import; it's a conceptual framework that shapes field naming and type taxonomies.

**ESCO (European Skills, Competences, Qualifications and Occupations)** — provides practical vocabulary for developer skills. Defines specific skills like "developing software prototypes," "debugging software," "defining technical requirements," "developing creative ideas," "adapting to changes." The EU maintains ESCO as the reference skill taxonomy for occupational classification.

Useful for Pipe: ESCO IDs give you a standardized tag set for ~500 developer skills without having to invent them. Sub-element Skill nodes can reference ESCO IDs where they exist and extend with Pipe-specific terms where they don't. Reduces extraction prompt burden (the LLM can be told "prefer ESCO skill names when applicable") and enables interoperability with HR information systems that speak ESCO.

Core-O's critique of ESCO is worth noting: ESCO conflates skill with knowledge (classifying "Java programming" as knowledge rather than skill), and lacks explicit task/resource/artifact distinctions. For Pipe's telemetry-driven scoring, this matters — knowing Java syntax (knowledge) versus effectively applying it under time pressure with AI assistance (skill manifestation in a specific task context with particular resources) are different competence elements that should be scored separately.

**IT Skills Ontology (Técnico Lisboa)** — formalizes relations between technologies: "is framework of," "has framework," "is library of," "has library," "used with," "similar to." For Pipe's repo matching, these relations enable competence groupings (React and Vue as "similar to" frontend frameworks, both "used with" JavaScript/TypeScript, both have component libraries).

This structural knowledge is what underpins skill adjacency modeling. The hand-curated `skill_adjacency` table in Part 3 and Part 5 is Pipe's pragmatic implementation of these relation types.

### The IEEE/ACM software engineering competency models

The research noted these exist but are insufficient for Pipe's needs — they address educational outcomes and curriculum coverage, not the behavioral telemetry and conversational signals that AI-native interviews generate. They're useful as reference for what dimensions to cover, not as operational taxonomies.

### Relevance to Pipe

Core-O's decomposition discipline shapes the **sub-element type taxonomy across all three entities in Pipe**. Experience, Project, Skill, CulturalSignal, TechnicalDemonstration, WorkingStyle — these reflect Core-O's distinctions (competence / skill / knowledge / attitude / task / resource / artifact) adapted to Pipe's specific domain.

ESCO is **practically useful** as a reference vocabulary for the Skill sub-element. Sub-element records carry an optional `esco_id` field pointing to the ESCO URI when the skill has a standard entry. Extraction prompts mention ESCO as a preference.

IT Skills Ontology is **directly operationalized** in the hand-curated `skill_adjacency` table covering the top ~50 framework groupings.

### Candor note

The original strategy document recommended "adopting Core-O as the ontological backbone" as foundational work. This was misleading — you already have RCD with sophisticated decomposition for roles, and the work is extending that pattern to candidates rather than adopting a new framework. Core-O provides vocabulary discipline; it's not a migration target.

---

## 3. LLM-as-Judge and Calibration Methodology

### What the research captured

The research established that achieving substantial agreement between LLM scorers and human experts (Cohen's κ ≥ 0.60) requires careful prompt engineering and temperature tuning, with optimal settings varying by evaluation theme:

- Domain-specific competencies: Temperature = 0.9, top-p = 0.9
- Domain-general constructs: Temperature = 1.1, top-p = 0.8

Even with optimization, only moderate agreement (κ = 0.55) was achieved for domain-general constructs. This highlights fundamental limitations in LLM evaluation of broad behavioral attributes — you can't prompt-engineer your way to perfect agreement on fuzzy dimensions, which is why dimensions vary in their intrinsic difficulty.

### The Kappa framework

**Cohen's Kappa** is the standard measure for two-rater agreement beyond chance. For Pipe, this means single-LLM vs. single-human-expert agreement. Interpretation:

| κ Range | Agreement Level | Action |
|---|---|---|
| < 0.20 | None | Dimension requires fundamental redesign |
| 0.21–0.40 | Fair | Prompt engineering, additional examples needed |
| 0.41–0.60 | Moderate | Acceptable for initial deployment, monitor for drift |
| 0.61–0.80 | Substantial | Production-ready with confidence weighting |
| > 0.80 | Almost perfect | Gold standard, can be used for calibration targets |

**Fleiss' Kappa** extends Cohen's for multi-rater scenarios. For Pipe, this is relevant when evaluating LLM scorer ensembles against human expert panels.

**Weighted Kappa** (quadratic weighting) is appropriate for ordinal scales like 1–5 BARS ratings, where disagreement by 1 level matters less than disagreement by 3 levels.

### The "Rubric Is All You Need" study

This study on LLM-based code evaluation provides critical empirical guidance: **detailed rubrics with clear scoring criteria produce usable evaluations; vague instructions like "rate the quality" yield inconsistent results**. 

This validates Pipe's heavy investment in BARS anchors (ADR-032 for code review, `COMPETENCY_BARS_RUBRICS` for culture). The rubric detail is the single most important factor in scoring consistency.

The study also introduced a **Leniency metric** — measuring automated evaluation strictness relative to expert human assessments. LLMs tend to be more lenient than human scorers on average (higher scores for equivalent work). Tracking Leniency alongside Kappa gives a more complete picture: high Kappa with high Leniency means the LLM is consistent with humans in *ranking* but not in *absolute calibration*.

The study compared three evaluation techniques:

- **Complete Rubric Evaluation** (single agent, full rubric) — simple, works when rubric is well-designed
- **Pointwise Rubric Evaluation** (individual criterion checking) — more controllable but more expensive
- **Ensembling Method Evaluation** (majority voting across multiple evaluations) — variance reduction at cost multiplier

Finding: **question-specific rubrics substantially outperform question-agnostic rubrics**. For Pipe, this means per-role BARS overrides (which RCD captures via `bars_overrides`) are methodologically sound, not over-engineering.

### The QWK target

Pipe's culture scoring currently uses **Quadratic Weighted Kappa** with a 0.55 floor and 0.60 aspirational target (tracked as BC-19 in STRATEGY). QWK is a specialization of weighted Kappa using quadratic distance weights, appropriate for ordinal BARS scales.

QWK and Cohen's κ answer slightly different questions. QWK measures agreement on ordinal-scale ratings with disagreement penalty scaled by distance. Cohen's κ measures categorical agreement corrected for chance. For Pipe's BARS ratings (1–5 ordinal), QWK is the right primary metric. Cohen's κ on binary recruiter thumbs-up/thumbs-down feedback is a complementary signal for tracking overall match quality acceptance.

### Ground truth versus judgment dimensions

The research and Pipe's implementation both distinguish:

- **Ground-truth-scorable dimensions** — dimensions where a correct answer exists. Issue identification in code review (bugs are either identified or missed), prioritization accuracy, revision evaluation. Can use deterministic effectiveness metrics alongside BARS.
- **Judgment-based dimensions** — dimensions where reasonable experts disagree. Reasoning & Explanation Quality, Question Formation, AI Direction. Require human-LLM agreement studies and ongoing validity monitoring.

This distinction determines scoring pipeline architecture. Pipe's code review scorer architecture already respects this (Scorer A for ground-truth dimensions, Scorer B for judgment dimensions per ADR-032).

### Relevance to Pipe

The Kappa framework is **methodologically aligned** with Pipe's existing QWK target. Adding Cohen's κ for recruiter-LLM agreement tracking (on thumbs-up/down) and eventual Fleiss' κ for multi-rater validation fits naturally.

The "Rubric Is All You Need" finding **validates the BARS investment** across code review, culture, and the forthcoming implementation scorer. The Leniency metric is a useful supplementary signal to add to calibration dashboards.

Formal expert panel study (5–10 senior engineers trained to inter-expert κ ≥ 0.80, then 100+ double-scored sessions per dimension) is **deferred**, not abandoned. It's a significant resource commitment and the right time to invest is when the product has volume and real hiring outcomes to validate against. Until then, recruiter-feedback-driven informal calibration does the job.

### Candor note

LLM-as-judge quality has ceilings. The 0.55 moderate agreement on domain-general constructs is not a Pipe-specific limitation; it's a finding about the fundamental limits of AI evaluation for fuzzy behavioral attributes. Accept that cultural scoring will always have more judgment-variance than code review scoring, and design the HITL gate accordingly.

---

## 4. Multi-LLM Ensemble and Variance Reduction

### What the research captured

The research on LLM-as-judge reliability indicates that **averaging 3 scorer outputs per dimension reduces variance more effectively than single specialists**, particularly for no-ground-truth dimensions where scorer disagreement is inherently higher.

Proposed "parallel diverse" architecture: deploy 3 Gemma 4 26B instances per dimension with varied prompts (emphasis framing, example selection), use median aggregation with moderator synthesis when inter-scorer range exceeds 1.5 points on a 5-point scale.

### The CoMAI framework

CoMAI (which appeared in Pipe's research base) provides cross-criterion interference mitigation through explicit debate protocol. Scorers produce initial scores, then critique each other's reasoning, then revise. This reduces cases where one dimension's evaluation contaminates another's.

Latency cost of the debate protocol is 5–7×, which is why the original strategy suggested deferring CoMAI until post-scaling.

### Cost implications

Three scorers per dimension means **3× LLM cost per assessment**. For a culture interview that already runs 11 calls (5 competency + 5 profile + synthesis), ensemble scoring would make this 31 calls. At Gemma's token costs, this adds up quickly.

### Relevance to Pipe

The ensemble pattern is **methodologically sound** but **cost-prohibitive at current stage**. Pipe's single-scorer QWK already meets the 0.55 floor. Adding 3× cost for variance reduction when current calibration is adequate is premature.

### Candor note

The original strategy recommended "parallel diverse" architecture as a priority. This was miscalibrated to Pipe's stage. The right time for ensemble scoring is when:

- Single-scorer QWK consistently fails to hit the 0.60 aspirational target despite prompt iteration
- Per-candidate assessment cost is a small fraction of revenue per hire
- Volume justifies the infrastructure for variance analysis across scorer outputs

Until then, defer. The existing single-scorer QWK with rubric refinement is the better investment.

---

## 5. Fairness, Legal Compliance, and Regulatory Landscape

### What the research captured

AI-driven hiring decisions are increasingly regulated. The relevant frameworks and laws:

**US regulatory landscape:**

- **Equal Employment Opportunity Commission (EEOC)** — federal enforcement of employment discrimination laws. Uniform Guidelines on Employee Selection Procedures (UGESP) require validation evidence for selection tools with disparate impact.
- **Griggs v. Duke Power Co. (1971)** — foundational Supreme Court case establishing that selection criteria must be job-related and consistent with business necessity when they produce disparate impact.
- **NYC Local Law 144 (effective July 2023)** — requires bias audits of "automated employment decision tools" (AEDTs) used in NYC hiring. Annual independent audits, candidate notification of AI use, posting of bias audit results. Prohibits certain uses of AEDTs without bias audit compliance.
- **Illinois Artificial Intelligence Video Interview Act (2020)** — requires notification, consent, and data retention limits for video interview AI analysis.

**EU regulatory landscape:**

- **EU AI Act (effective 2024, enforcement rolling through 2026)** — classifies AI systems used in recruitment and employment as **high-risk**. Requires:
  - Article 14: human oversight (HITL gates)
  - Article 15: accuracy, robustness, cybersecurity
  - Article 17: quality management systems
  - Article 13: transparency and provision of information to users
  - Article 9: classification of biometric data as special category requiring explicit consent
- **GDPR** — general data protection including Article 22 (right not to be subject to solely automated decisions), Article 9 (special category data including biometric data).

**Canadian regulatory landscape:**

- **Artificial Intelligence and Data Act (AIDA)** — part of proposed federal Bill C-27, classifies high-impact AI systems similarly to EU AI Act. Still in legislative process as of the research date.

### Fairness metrics

The research covers three fairness metrics from the algorithmic fairness literature:

**Demographic Parity (Statistical Parity)** — equal selection rates across protected groups. Simplest metric, but can conflict with accuracy if base rates differ legitimately.

**Conditional Statistical Parity** — equal selection rates when controlling for legitimate job-related features. The EARN Fairness framework identified this as the preferred metric for most stakeholder-centered fairness operationalization. Directly applicable to Pipe's context where skill requirements are legitimate but demographic characteristics must not influence matching outcomes.

**Equalized Odds** — equal true positive rates AND equal false positive rates across groups. Stricter than demographic parity. For Pipe, this means: among candidates who would succeed in a role, all groups have equal match probability; among candidates who would fail, all groups have equal rejection probability.

**Adversarial Debiasing** — training approach where an adversarial component attempts to predict protected attributes from the model's internal representations while the main model tries to maximize accuracy and minimize adversarial success. Removes protected attribute information from the signal. High implementation complexity; deferred in Pipe's sequencing.

### How Pipe's architecture is already aligned

Several existing architectural decisions in Pipe are directly motivated by these regulatory frameworks:

**Dealbreakers never auto-fail** (Griggs / UGESP / EU AI Act Art 14). They raise `hitlReviewRequired: true` instead. A pattern-matched dealbreaker triggers human review, not automatic disqualification. This is legally defensible because the human is in the decision loop.

**Culture question bank is finite, recruiter-approved, and versioned** (NYC Local Law 144 / EU AI Act Art 14). Every probe traces to `role_probe_bank` with `source='rcd_enriched'` and `rcd_version`. Per-candidate dynamic probe generation is explicitly forbidden — every question the candidate hears was approved for this role before the interview.

**HITL gates throughout scoring surfaces** (EU AI Act Art 14). Culture scores are not visible to candidates until recruiter review; code review scores same. The candidate-facing sanitized report strips `reasoning`, `evidenceQuotes`, `confidence`, `rawScore`, `dispositionalWeight`, `barsOverrideApplied`, `dealbreakerFlags`, `hitlReviewRequired`, `orgBenchmark` before exposure.

**Compliance audit trail** with 7-year retention. `culture_compliance_audit` is append-only with 13 event types (consent_shown, consent_given, consent_declined, alternative_requested, interview_started, interview_completed, scoring_complete, review_started, review_confirmed, review_overridden, review_flagged, deletion_requested, deletion_fulfilled). Actor attribution (candidate / recruiter / system) with EEOC-aligned retention.

**Dealbreaker records carry `job_relatedness_note` and `job_relatedness_strength`** (Griggs). The job-relatedness justification is captured at RCD synthesis time, not post-hoc. This is the audit trail for why a specific dealbreaker is a legitimate selection criterion.

**Clerk-based recruiter authentication with append-only decision records** — decisions are attributable. Overrides are logged with `overrideRecommendation` and `reviewNotes`.

### What Pipe doesn't yet have but will need

**Formal bias audit** (NYC Local Law 144) — annual independent audit required if any candidates are NYC-based or the platform operates as an AEDT for NYC employers. Includes disparate impact analysis across protected categories.

**Candidate AI-use notification** (NYC Local Law 144, EU AI Act, several US state laws) — explicit disclosure to candidates that AI is used in their evaluation. Currently Pipe has consent flows for culture interview and keystroke-adjacent telemetry, but not a unified AI-use disclosure surface.

**Protected attribute collection and monitoring** — to compute disparate impact, you need protected attribute data. Collection is optional at candidate intake (with explicit purpose specification and consent); monitoring is computed on consented populations. Pipe currently has no mechanism for this.

**GDPR Article 22 compliance surface** — the right not to be subject to solely automated decisions. Pipe's HITL gates are the correct architectural response, but the candidate-facing explanation of "a human makes the final decision" needs product UI.

**Data Subject Access Requests (GDPR)** — candidates can request access to all data held about them, including processing logic. Candidate-facing profile view plus data export are the product surface for this.

**Right to erasure (GDPR)** — candidate-initiated deletion propagates through the candidate graph, assessment records, audit trails. The 7-year compliance audit retention is a known exception that requires candidate disclosure.

### Relevance to Pipe

**Existing architecture is defensible** for current regulatory surface. HITL gates, finite approved question banks, job-relatedness notes on dealbreakers, compliance audit trails — these are not Pipe-specific inventions but are directly responsive to the regulatory framework.

**What requires investment** as the platform scales: disparate impact monitoring infrastructure (protected attribute collection with consent, selection rate analysis across groups, automated alerting on statistical parity divergence), candidate AI-use disclosure UX (unified "AI was used in evaluating your application" notification with link to methodology), GDPR subject rights tooling (access requests, erasure with retention exceptions).

### Candor note

**Compliance is not a deferred concern.** It's a constraint throughout. The research integrates it across all five strategy documents because regulatory scrutiny is arriving, not hypothetical. NYC Local Law 144 enforcement has begun. EU AI Act rolling enforcement is ongoing. Pipe's architecture is well-positioned, but the product UX layer (candidate notification, rights exercise, audit visibility) needs deliberate attention.

**Don't over-engineer fairness tooling before you have signal.** Disparate impact analysis requires volume — hundreds of matches across roles with protected attribute data — to produce statistically meaningful conclusions. Monitoring infrastructure should be built now; formal bias audit activities activate when volume justifies.

---

## 6. Reliability Patterns for LLM Pipelines

### What the research captured

LLM API failures are operational realities to engineer around, not bugs to eliminate. The research established several patterns as standard practice for resilient LLM pipelines:

**Error classification.** Three categories with distinct recovery strategies:

- **TRANSIENT** (429, 500, 502, 503) — retry with exponential backoff
- **DEGRADED** (context length exceeded, content filter) — switch to fallback model
- **PERMANENT** (401, 400, 422) — fail immediately, no retry

**Retry with exponential backoff.** Provider-specific tuning based on failure characteristics:

- Vertex AI MaaS quota-based rate limits: base_delay=2s, max_delay=120s, max_retries=5, jitter=1s
- Workers AI cold-start resource exhaustion (3050 errors): base_delay=30s fixed, max_delay=300s, max_retries=3
- Standard HTTP transient failures: conventional exponential backoff with jitter

**Circuit breaker pattern.** Three states (CLOSED / OPEN / HALF-OPEN). Separate breakers per provider with asymmetric thresholds reflecting observed reliability patterns. When a circuit opens, fast-fail requests rather than hammering a degraded service.

**Retry budget.** Finite number of retries per *candidate* rather than per *step*. 5 retries per step, 20 total per pipeline run. Exhausted budgets escalate to dead-letter queue rather than permanent failure.

**Idempotency.** Client-generated keys (UUID) with TTL-based response caching. Prevents duplicate processing on network retries. Combined with per-entity serialization (Durable Objects pattern) for race-condition safety.

**Partial materialization.** Preserving intermediate state (embeddings, extracted profiles) across failures so retries resume from the first failed step rather than restarting from scratch. Critical for expensive pipeline steps like LLM extraction that should never be recomputed unnecessarily.

**Dead-letter queues.** Structured failure taxonomy beyond opaque "failed" status. Captures failed_step, error_type classification, error_code, retry_count, retry_exhausted, checkpoint_preserved flag, recovery_endpoint for manual retry, recruiter-friendly error_message.

### Observability patterns

**OpenTelemetry gen_ai semantic conventions** — structured capture of LLM call attributes: `gen_ai.request.model`, `gen_ai.request.max_tokens`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reason`. Standardized vocabulary for cross-provider observability.

**Sampling strategy** — 100% for development, 5–10% for production success (cost management), 100% tail-based for errors, 100% for high-token requests (cost anomaly detection).

**Span hierarchy** reflecting business process structure. Enables diagnostic drill-down when a recruiter sees a failure.

### Relevance to Pipe

**Directly applicable** to Pipe's pipeline reliability work. ADR-040 dual-layer storage addresses ground-truth preservation but doesn't shield LLM calls from transient failures. Part 5 integrates retry, circuit breakers, idempotency, partial materialization, heartbeats, and DLQ as [ACTIVE] work.

**OpenTelemetry integration** via `@microlabs/otel-cf-workers` is the right path for Cloudflare Workers observability. Export to Axiom or Grafana Cloud via Cloudflare Destinations. Not urgent but high-ROI once in place.

### Candor note

These are hygiene patterns, not innovations. The research captured standard practice because Pipe's original strategy lacked it. Implementation is straightforward; the only reason it isn't fully in place is prioritization.

---

## 7. Hybrid Retrieval and Matching Architecture

### What the research captured

For systems combining structured (SQL-based skill matching) and unstructured (vector similarity) retrieval, three fusion strategies:

**Late fusion** — independent retrieval, score combination with learned weights. Most compatible with split storage architectures (D1 + Vectorize, in Pipe's case). Requires: score normalization to common scale, learned weight optimization via logistic regression on feedback outcomes, explicit score exposure for transparency.

**Early fusion** — joint embedding space representing both structured features and unstructured features in a unified vector. Requires re-architecting the storage layer. Offers end-to-end gradient-based optimization of the matching function against hire outcomes — potentially highest-ceiling approach once sufficient training data is available.

**Cascade** — structured filtering first, then vector rerank within filtered set. Simpler than late fusion, but misses cases where semantic similarity compensates for skill adjacency gaps.

### Learning-to-rank

For matching quality optimization over time, the research covered three ranking objectives:

- **Pointwise** — predict absolute relevance scores. Poor for Pipe because no absolute ground-truth relevance score exists.
- **Pairwise** — learn to rank match A over match B given recruiter feedback. Good fit for Pipe's thumbs-up/down feedback mechanism. BPR (Bayesian Personalized Ranking) loss is the standard pairwise approach.
- **Listwise** — optimize full ranking using NDCG. Best theoretical approach; requires full-ranking feedback collection that Pipe doesn't have yet.

Recommendation: start with pairwise BPR when feedback volume crosses ~50 events/month threshold. Transition to listwise LambdaMART as volume grows.

### Skill adjacency modeling

The React-to-Vue example: systematic exclusion of adjacent-skill candidates from strict skill matching. Solutions:

- **Skill competence groups** — hand-curated groupings ("frontend framework competence" subsuming React, Vue, Angular, Svelte)
- **BGE fine-tuning** — skill-specific embedding space where cosine similarity measures substitutability. Positive pairs (documented alternatives), negative pairs (unrelated domains), hard negatives (superficially similar but functionally distinct).
- **SQL query relaxation** — threshold-based coverage instead of strict `must_hits = must_total`.

### Relevance to Pipe

**Late fusion is already Pipe's architecture** (D1 SQL + Vectorize ANN blended via cosineWeight). The research validates this choice.

**Hand-curated skill adjacency** is [ACTIVE] priority. Hand curation covers 80% of value at 2% of effort compared to BGE fine-tuning. Part 3 and Part 5.

**Pairwise learning-to-rank with recruiter feedback** is [DEFERRED] — infrastructure in place for data collection, model training when volume justifies.

**Early fusion** is [DEFERRED] — late fusion has headroom; revisit if architecture tops out.

### Candor note

The research's recommendations here are standard industrial practice. Nothing novel. What matters is sequencing: Pipe already has the right primary architecture (late fusion), the work is populating it properly (decomposition, sub-element-level matching, populated vector signal slots) rather than switching strategies.

---

## 8. Automated Video Interview Research (Computational Psychometrics)

### What the research captured

Fisher Phillips published a comprehensive review on computational psychometrics for automated video interviews covering validity, fairness, and legal considerations. Key findings:

**Unified competency models exist in personnel selection literature** but are industry-agnostic. They capture general behavioral dimensions applicable across roles (conscientiousness, cognitive ability, interpersonal skills) but don't capture the granular technical behaviors that distinguish software engineering performance.

**Automated video interviews evoke less favorable candidate reactions** than traditional interviews or videoconference interviews. Primary drivers: lower social presence, candidate uncertainty about how they're being evaluated, perceived lack of opportunity to ask clarifying questions or read interviewer reactions.

**Validity evidence for AVIs is mixed.** Some studies show predictive validity for specific constructs; others show no improvement over resume screening. Quality depends heavily on implementation — rubric detail, training data, validation methodology.

**Bias risks are real but mitigable.** Documented concerns: differential treatment of non-native English speakers (ASR accuracy), cultural differences in nonverbal behavior interpretation, appearance-based judgments from facial analysis. Mitigations: rubric-driven evaluation rather than free-form LLM judgment, finite question banks, HITL review, transparency in methodology.

### Relevance to Pipe

**Pipe's culture interview is text-based, not video-based.** This sidesteps several AVI bias risks (appearance-based judgment, facial analysis concerns, ASR language bias) but retains the "lower social presence" candidate experience concern.

**The candidate-reaction research is relevant to screener UX.** If automated screening feels clinical or evaluative rather than profile-building and candidate-advocating, completion rates suffer. Part 4's framing of Mode 1 screening as candidate profile-building (not hiring gatekeeping) is directly responsive to this finding.

**Rubric-driven evaluation with finite question banks** is already Pipe's architecture for culture. This approach is validated by AVI research as the primary bias mitigation.

### Candor note

Pipe is not an AVI platform. The research on AVI bias and candidate reactions informs the *screener design philosophy* but doesn't create direct requirements. If Pipe ever adds video modality (voice is already present in some flows; video would be additional), the AVI research becomes much more directly applicable.

---

## 9. ATS and Resume Parsing Industry State

### What the research captured

Applicant tracking system (ATS) resume parsing has several documented failure modes:

- **~75% of resumes fail ATS screening** due to parsing engine limitations. Primary issues: complex formatting, non-standard section headers, font variations, graphics.
- **Modern AI parsers achieve 90%+ F1 scores** on precision and recall using pipelines of: parsing engine → named-entity recognition → classification.
- **Scanned document OCR** reaches 95%+ character accuracy with preprocessing (deskewing, noise reduction, contrast enhancement, binarization).
- **Structured parsing** (semantic section detection: contact, experience with company/role/date, skills, education) outperforms raw text extraction for downstream LLM processing.

Extraction library comparison:

- **pdf-parse (npm)** — fast, pure JS, no dependencies. Fails on scanned PDFs, poor table extraction, no OCR. Baseline only for Cloudflare Workers (no Python runtime).
- **unstructured (Python)** — excellent layout detection, table extraction, metadata. Requires Python service.
- **marker (Python)** — SOTA academic document parsing, formula handling, multi-column. Newer, less production-hardened.
- **Azure Document Intelligence** — production OCR + layout + table extraction, SLA. Commercial cost, vendor lock-in.
- **Tesseract** — mature open-source OCR. Requires image preprocessing.

Pipe's Cloudflare Workers environment (JavaScript/V8 isolates, no Python runtime) eliminates `unstructured` and `marker` as direct dependencies. Recommended hybrid: pdf-parse for standard PDFs (80% case, <100ms), Azure Document Intelligence for failures (20% case, pay-per-use).

### Relevance to Pipe

**Useful reference** for the parsing layer, but **not the leverage point** for matching quality. Part 4's central thesis is that resumes are thin artifacts regardless of parsing quality; the screener and enrichment are where real candidate signal comes from.

Parsing improvements are [DEFERRED] relative to decomposition and screener work. If resume parsing failures become a user-visible issue (candidates report "my resume didn't upload right"), parsing fallback to OCR becomes priority. Until then, baseline pdf-parse with graceful degradation is adequate.

### Candor note

The original strategy framed resume parsing robustness as Phase 0 priority. This was miscalibrated. Resume parsing is a baseline capability, not a strategic differentiator. Pipe's differentiation is downstream: decomposition, screener, enrichment, per-element matching. Getting parsing to "good enough" and moving on is the right call.

---

## 10. Competitive Positioning Signal

### What the research captured

The research implicitly mapped Pipe's competitive positioning by reviewing existing platforms:

**Traditional ATS-style platforms** (Workday, Greenhouse, Lever) — focused on workflow management, not candidate evaluation quality. Matching is keyword-based. Assessment is outsourced to other tools.

**Structured assessment platforms** (HackerRank, CodeSignal, Codility) — focus on one assessment type (typically coding challenges) with scoring. Not living candidate profiles; transactional interactions.

**Project-based evaluation** (Woven, Karat) — longer-form async assessments with human review. Higher signal, lower volume, higher cost per candidate.

**AI interviewer products** (HireVue, Modern Hire, Sherlock AI) — automated behavioral interview with AI evaluation. Typically video-based. Facing regulatory headwinds (NYC Local Law 144, EU AI Act).

**General-purpose sourcing platforms** (LinkedIn Recruiter, Gem) — candidate discovery without rich evaluation. Matching is keyword + recruiter judgment.

Pipe's positioning relative to these:

- **Richer role understanding** than any above (RCD with multi-stakeholder synthesis, laddering chains, team-specific BARS)
- **Living candidate profile** across roles and time — none of the above maintain this
- **Multi-modal evaluation** (code review conversation, implementation with telemetry, culture interview) integrated into a single candidate graph
- **Graph-based matching with evidence attribution** — none of the above do per-element matching with audit trails
- **Text-based primary modality** — sidesteps AVI-specific regulatory and bias concerns

### Relevance to Pipe

Pipe's moat is the **integrated system** — RCD quality + candidate decomposition + living graph + evidence-structured matching + HITL compliance. Any individual piece has equivalents in the market; the combination does not.

The go-to-market implication: Pipe is not selling "better coding assessment" or "better AI interviewer." Pipe is selling "we understand this role, we understand this candidate, we show you why they fit, we let you override when you know better." The product narrative is about *justified matching* with *auditable evidence*, not about AI doing the work.

### Candor note

Competitive positioning is a product/marketing concern, not an engineering one. The research here is directional, not prescriptive. The architecture serves the positioning rather than being derived from it.

---

## 11. What the Research Got Wrong (and Why)

### The research was written without visibility into what Pipe had built

This is the meta-finding that emerged through the strategy work. The original 100-Agent Research Swarm assumed Pipe was at an earlier stage than it actually is:

- Treated RCD as research-pending when it was already production
- Treated Pass 3 repo crawler as future work when all three passes were built
- Treated candidate ingestion as a thin 10-step pipeline when it's actually an 11-step pipeline with dual-layer storage per ADR-040
- Treated competency ontology as foundational work when RCD already had sophisticated decomposition for roles
- Treated fairness as a later-phase concern when regulatory compliance (HITL gates, finite question banks, never-auto-fail dealbreakers, audit trails) was already architecturally baked in

The original strategy documents faithfully synthesized the research against these assumptions, producing recommendations that were internally coherent but misaligned with Pipe's actual state.

### Specific research recommendations that were revised or dropped

**Built a unified competency signal ontology from scratch.** Revised. RCD exists; the work is applying RCD's treatment to candidates and consuming it downstream.

**Fragmentation of signals across three JSON shapes requiring unification.** Revised. The three JSON shapes exist but are not the primary problem; the primary problem is that structured signals in those shapes aren't being consumed.

**SQL-based matching needs vector recall bolted on.** Revised. Vector-native is already primary; SQL is the guardrail.

**Implementer agent pushback intensity calibration as near-future work.** Revised. UAR migration is the real near-future work; pushback calibration is a minor tuning layer on top.

**Keystroke biometrics for cheating detection.** Dropped. GDPR Article 9 complexity outweighs the 1–8% EER gain documented in research.

**Adversarial debiasing.** Deferred. Monitoring first.

**Multi-LLM ensemble scoring at 3× cost.** Deferred. Single-scorer QWK adequate at current stage.

**Real-time affect detection adapting culture interview.** Deferred. Bias risk from adaptive probing; validate static version first.

**BGE fine-tuning for skill adjacency.** Deferred. Hand-curated adjacency table covers 80% of value.

**Early fusion joint embedding.** Deferred. Late fusion has headroom.

**Learning-to-rank model training.** Deferred. Data infrastructure now, model later.

**KV cache compression for long-horizon agents.** Deferred. Gated on Workers AI capability exposure.

### Specific research recommendations preserved

**Sherlock AI framework for implementation challenge scoring.** Directly applicable, integrated into Part 3 and Part 4.

**Core-O decomposition discipline.** Vocabulary adopted for sub-element type taxonomy.

**ESCO skill vocabulary.** Referenced as optional `esco_id` field on Skill sub-elements.

**"Rubric Is All You Need" finding on detailed rubric investment.** Validates existing BARS anchor investment; Leniency metric added to calibration dashboards.

**CodeSignal phased calibration model** (pilot → tuned → monitored → revision). Formalized as rubric maturity path across all scoring surfaces.

**Cohen's / Fleiss' Kappa.** Added alongside existing QWK as supplementary agreement metrics.

**Retry, circuit breaker, idempotency, partial materialization, heartbeats, DLQ.** [ACTIVE] reliability work in Part 5.

**OpenTelemetry gen_ai conventions.** Target for observability maturity.

**IT Skills Ontology relation types.** Informs hand-curated skill_adjacency table structure.

**Fairness framework** (conditional statistical parity, equal opportunity, equalized odds). Integrated as ongoing compliance constraint throughout.

**Legal and regulatory landscape** (NYC Local Law 144, EU AI Act, EEOC/UGESP, Griggs, GDPR). Aligned with Pipe's existing architecture; identifies compliance surfaces still needed.

### Candor note

This section exists because honest strategy documents should identify their own blind spots. The original research was valuable — it surfaced real findings from external sources and established grounding for decisions. Its limitation was lacking visibility into current state. Future strategy work should start from current state assessment before commissioning research.

---

## 12. How to Use This Document

This is reference material, not a plan. The plan is Parts 1–5.

**When writing new strategy documents:** consult this for external grounding on methodology, compliance, competitive context. Cite findings to justify architectural decisions.

**When designing new features:** check the relevant section for prior art. Screener design consults AVI research (§8). New scoring surfaces consult Kappa methodology (§3). Fairness work consults the legal landscape (§5).

**When justifying decisions to stakeholders:** the research base here provides citations for why specific patterns are adopted or rejected. "We defer ensemble scoring because current QWK is adequate and the 3× cost isn't justified at stage" is more defensible when it cites the research explicitly.

**When reassessing deferred items:** the deferred list has explicit reasons for deferral. As product state changes (volume reaches threshold X, regulatory inquiry arrives, cost anomaly surfaces), the deferral rationale gets reviewed.

**When new research arrives:** integrate into this document rather than letting it scatter. This is the living external-context reference.

---

## Research sources referenced

The original 100-Agent Research Swarm report aggregated ~60–90 sources. Primary authoritative sources that carry through:

- Calhau et al. (2024), Core-O Competence Reference Ontology, FOIS 2024
- ESCO (European Skills, Competences, Qualifications and Occupations) framework, EU Commission
- IT Skills Ontology (Técnico Lisboa)
- Sherlock AI scoring rubric documentation
- CodeSignal AI Interviewer methodology publications
- "Rubric Is All You Need" LLM-based code evaluation study
- Fisher Phillips review on computational psychometrics for AVIs
- EEOC Uniform Guidelines on Employee Selection Procedures
- Griggs v. Duke Power Co. (1971)
- NYC Local Law 144 (AEDT bias audits, effective July 2023)
- EU AI Act (2024, enforcement rolling)
- GDPR Articles 9, 13, 14, 15, 17, 22
- EARN Fairness Framework
- TypeNet LSTM keystroke biometrics (referenced; parked for Pipe)
- OpenTelemetry gen_ai semantic conventions specification
- Panickssery (2024) on cross-family consistency classifiers

Citations in the original research report used parenthetical "(Source)" markers that weren't machine-resolvable. Where specific claims are load-bearing for architectural decisions, the original research should be consulted directly; this document summarizes rather than replaces.

---

*End of Part 6. End of Pipe Strategy v2.*
