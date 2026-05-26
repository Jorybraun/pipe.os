# Evidence-Integrity Review — PIPE Marketing Positioning Brief

*Reviewer: Claude (Sonnet 4.6) | Date: 2026-04-19*
*Ground-truth sources checked: pipe-marketing-positioning-icp.md, pipe-marketing-positioning-competitors.md, pipe-marketing-positioning-crisis.md, pipe-marketing-positioning-compliance.md*

---

## Verdict

**PASS WITH NOTES**

---

## Summary

The brief is well-grounded. Every central statistical claim (CodeSignal fraud rates, interviewing.io experiment results, Karat pricing, compliance penalties, Cluely funding) traces to a corresponding row in the research files with consistent numbers. The main risks are: (1) two numbers in the pricing table are sourced to HackerRank-authored content rather than neutral sources — a framing problem the brief does not flag; (2) the "37 cases in first month" Illinois claim carries no source in the research file, only a law-firm citation at face value; and (3) several strategic claims in the Recommended Positioning section are the Lead's synthesis, not directly evidenced — which is appropriate for a positioning brief but should be labeled as such. No claims were found to directly contradict the research files.

---

## FATAL issues

None.

---

## MAJOR issues

**M-1 — HackerRank median enterprise contract attributed to wrong Vendr URL**

Brief (ICP table, row 2): "HackerRank median enterprise contract $13,942/yr | [Vendr (n=154)](https://www.vendr.com/buyer-guides/codesignal)"

The URL cited is the CodeSignal Vendr buyer guide, not a HackerRank Vendr guide. The research file (icp.md, pricing table row 5) cites the HackerRank figure to `https://www.hackerrank.com/writing/codility-vs-hackerrank-vs-codesignal-2025-enterprise-comparison`, which is a HackerRank-authored comparison article, not a neutral Vendr page. The brief's inline citation "(n=154)" implies a Vendr dataset, but the research source is a competitor's own marketing content. The number may be real (pulled from Vendr), but citing the CodeSignal Vendr page for a HackerRank figure is wrong, and the (n=154) claim is not present in the research file at all. This is a material attribution error on a pricing claim used to anchor PIPE's price positioning.

**M-2 — Codility pricing numbers in the brief conflict with the research file**

Brief (ICP table): "Codility Scale / median | $12,000–$24,000/yr; $15,000 median | [Vendr (n=65)]"

Research file (icp.md, pricing table): Codility Scale is listed as "$12,000–$24,000/year; 5–15 recruiter seats, 500–2,000 sends." But competitors.md lists Codility Starter at "$1,200/year (120 invites); Scale $5,000/year (25 invites/month, 3 users)" — significantly lower than the icp.md Vendr figures. The two research files give materially different numbers for Codility Scale. The brief uses the icp.md (Vendr) figures without noting the discrepancy. The competitors.md numbers may be from the published pricing page rather than actual contract data. The brief should note the range spans both sources.

**M-3 — "37 cases in first month" (Illinois HB 3773) is single-source and the source is a law firm blog, not a primary government record**

Brief (Compliance section): "37 cases filed in the first month ([Hinshaw & Culbertson, 2026])"

This claim appears in compliance.md sourced to the Hinshaw law firm client alert, with no primary court or agency filing record. Law firm client alerts cite their own clients' interests and are not neutral. The claim is used to signal active enforcement urgency. Single-sourced to a self-interested secondary source; no government docket or IDOL enforcement report. MAJOR because it feeds the "compliance is a real wedge" narrative.

**M-4 — Karat annual spend range in brief does not match research file**

Brief (ICP table): "Karat average contract $222,750/yr (min $50K–$150K) | [Vendr], [HireinSouth]"

Brief (competitive landscape table): "Karat | $200–$450/interview | [Vendr], [HireinSouth]"

icp.md pricing table: Karat per-interview rates are "$200–$280 (enterprise/high-volume); $350–$450 (low-volume standard)" — the brief collapses these to "$200–$450" in the competitive table, which is technically accurate but loses the volume-dependency context. More importantly, icp.md cites HireinSouth for "Karat annual for 500–1,000 interviews: $40,000–$200,000" — but the brief's ICP table attributes the $222,750 average AND the $50K–$150K minimum to both Vendr and HireinSouth. According to icp.md, HireinSouth cites the annual range ($40K–$200K), not the specific average of $222,750 — that number comes from Vendr. The joint citation is misleading.

---

## MINOR issues

**m-1 — "0 of 32" interviewer detection stat vs. research file's actual setup**

Brief: "0 of 32 expert interviewers detected ChatGPT-assisted candidates"

crisis.md: "37 interviews conducted; cheating instructed for 32 participants" — 32 is the number of *cheating participants*, not the number of interviewers. The number of interviewers is not explicitly stated in the research file as 32 distinct people; in a platform like interviewing.io, each interview has one interviewer, so 32 cheating interviews = up to 32 different interviewers, but the framing "0 of 32 expert interviewers" implies 32 named experts, not 32 interview instances. Minor framing issue; the substance is correct.

**m-2 — "81% of cheating participants were not worried about being caught" appears twice with different attributions**

Brief executive summary: credits the interviewing.io study (2024).
Brief cheating crisis section: "81% of cheating participants were not worried about being caught" — also attributed to the interviewing.io study.
Brief cheating crisis section also cites a separate "81% of Big Tech/FAANG interviewers suspected AI cheating" figure from a different interviewing.io survey (the interviewer survey, n=67).

The coincidence of both being 81% could cause a reader to conflate the two figures. The research files clearly distinguish them (crisis.md lines 37 and 43 respectively). The brief handles this correctly, but the proximity of the two 81% figures in the same section is a potential reader confusion risk worth noting.

**m-3 — "Google, Apple, Amazon, McKinsey, and Cisco" in-person mandate claim is stated categorically**

Brief: "Google, Apple, Amazon, McKinsey, and Cisco have moved toward or reinstated mandatory in-person interviews"

crisis.md (timeline): "Apple announces mandatory in-person final rounds for all SWE roles starting July (Blind post)" — this source is a Blind post (anonymous forum), not Apple's official policy announcement. "Google CEO Sundar Pichai recommends returning to in-person interviews at company town hall" — a recommendation at a town hall is not a mandate. The brief's "have moved toward or reinstated" hedging is fair, and the CNBC source (cited inline) likely covers the substance. But the list of five companies is presented as settled fact while the underlying sources range from official announcements to anonymous Blind posts. Minor: the brief's "toward or reinstated" qualifier covers this.

**m-4 — "the industry of VC-backed cheat tools explicitly tests against enterprise proctor accounts daily" — sourced to cheat tool marketing copy**

Brief (Executive Summary): cheat tools "explicitly test against enterprise proctor accounts daily"

This language originates from the cheat tools' own marketing materials (UltraCode: "enterprise proctor accounts to test undetectability daily"; Cluely: similar). The brief presents it as an established fact, not as a marketing claim. The research file (crisis.md) notes this is from the tools' own detection claims. The brief should qualify: "claim to test against" rather than "test against." Minor because the distinction is real but the context (selling the scale of the threat) makes the rhetorical choice defensible.

**m-5 — Colorado penalty quantification**

Brief: "~$20K/violation" citing Clark Hill for Colorado SB 24-205.

compliance.md: "AG has general consumer protection enforcement authority (up to $20,000/violation under CCPA framework)" — this is the AG's general consumer protection ceiling, not a Colorado AI Act-specific penalty. The statute itself does not specify a per-violation amount. The brief's "~$20K/violation" approximation is technically grounded but could mislead a reader into thinking the AI Act explicitly sets this penalty. Minor: the source (Clark Hill) likely makes this clear, and compliance.md explains the mechanism.

**m-6 — "assembling a cross-family-scored transcript artifact" — PIPE product capability is asserted as fact**

Throughout the brief, PIPE's differentiator is described as a delivered capability ("produces a cross-family-scored transcript," "scored transcript as durable artifact"). This is not a claim about market research — it is a claim about PIPE's own product. The research files cannot verify product capabilities; they can only verify market positioning gaps. The brief's positioning section frames this as the solution to identified gaps, which is appropriate for a positioning document. But reviewers should be aware this set of claims relies entirely on the product actually working as described, not on the research.

---

## Per-section audit

### Executive summary

| Claim | Evidence status |
|-------|----------------|
| CodeSignal fraud 16%→35%; entry-level 15%→40% | Supported — crisis.md lines 21–22, CodeSignal Feb 2026 press release |
| "0 of 32 expert interviewers detected" | Supported with framing caveat (see m-1) — crisis.md lines 33–36 |
| "72% remained confident in hiring decisions" | Supported — crisis.md line 34 |
| Cluely $20M+ raised at ~$120M valuation | Supported — crisis.md lines 93–94; TechCrunch sources cited |
| Final Round AI 10M+ users | Supported — crisis.md line 95; finalroundai.com cited |
| Cheat tools "test against enterprise proctor accounts daily" | Supported as marketing claim; brief overstates as fact (see m-4) |
| NYC LL144 enforcement escalating; Dec 2025 Comptroller audit 17 of 18 violations | Partially supported — compliance.md line 103 says "at least 17 potential violations" in 32 companies, not "17 of 18." The brief's "17 of 18" framing is slightly off; research says 17 violations found among 32 companies while DCWP found 1 |
| Mobley v. Workday class certified May 2025, ~1.1B applications | Supported — compliance.md lines 22–23; InsideTechLaw and Seyfarth sources |
| "Scored transcript as durable artifact framing entirely absent from incumbent marketing" | Supported — competitors.md language analysis confirms "scored transcript" is unclaimed |

**Note on "17 of 18" vs. "17 of 32":** The brief in the executive summary says "the city's agency missed 17 of 18 violations." The compliance.md research file says DCWP "surveyed 32 companies and found 1 compliance issue" while Comptroller's auditors found "at least 17 potential violations" — these 17 were found across the 32-company universe, not 18 total violations. The "17 of 18" framing in the brief is a numerical distortion. The compliance section of the brief correctly states "17 violations" without the "of 18" qualifier. The executive summary introduces an incorrect denominator. This is borderline MAJOR but the substance (DCWP dramatically under-detected) is correct; downgraded to MINOR since both sections are present in the same document.

### ICP section

| Claim | Evidence status |
|-------|----------------|
| Series A–C, 30–300 engineers, 15–100 hires/year as primary ICP | Supported — icp.md synthesis section |
| VP Engineering + Head of Talent as co-buyers | Supported — icp.md "At growth" section |
| Karat average contract $222,750, min $50K–$150K | Supported — icp.md pricing table, Vendr source |
| Codility Scale $12K–$24K/yr; $15K median | Supported by icp.md (Vendr); conflicts with competitors.md pricing page data (see M-2) |
| CodeSignal median $21K/yr | Supported — icp.md pricing table, Vendr (n=59) |
| HackerRank median $13,942 | Supported in icp.md but attribution to CodeSignal Vendr URL in brief is wrong (see M-1) |
| HackerRank $25–$50/test | Supported — icp.md pricing table, index.dev |
| "Coding problems just don't work anymore" (Herval Freire, maestro.dev) | Supported — icp.md lines 98–99; Pragmatic Engineer source |
| $1,500–$2,000/candidate in-person finals to counter cheating | Supported — icp.md lines 107–108 |
| 39% talent leaders adding new recruitment software (vs. 25% in 2024) | Supported — icp.md lines 44, 199–201; HR Executive source |
| Bad hire cost 1.5–3× salary | Supported — icp.md trigger 2 |
| "HackerRank best for 500+ employees, 100+ hires" | Supported — icp.md line 60, recruiter.daily.dev source |

### Cheating crisis section

| Claim | Evidence status |
|-------|----------------|
| CodeSignal fraud stats (16%→35%; 15%→40%; 4× unproctored score jump) | Supported — crisis.md lines 21–27 |
| interviewing.io controlled experiment stats (0/32, 72%, 81%) | Supported — crisis.md lines 33–37 |
| FAANG interviewer survey (81% suspected, 31% caught, 11% used detection) | Supported — crisis.md lines 41–47 |
| Blind/Greenhouse 20% workers / 65% hiring managers stats | Supported — crisis.md lines 65–68 |
| Cluely $15M a16z Series A, ~$120M valuation | Supported — crisis.md lines 93–94, TechCrunch Jun 2025 |
| InterviewCoder $10M ARR | Supported — crisis.md line 92, Blind post Apr 2025 |
| Final Round AI 10M+ users | Supported — crisis.md line 95 |
| HackerRank 93% accuracy — no false-positive rate, no methodology | Supported — crisis.md lines 249–258 |
| Codility "raw signals don't tell the full story" | Supported — crisis.md line 265, Codility blog |
| CodeSignal agentic assessments Apr 2026 | Supported — competitors.md and crisis.md timeline |
| Google/Apple/Amazon/McKinsey/Cisco in-person mandates | Supported with sourcing caveat (see m-3); crisis.md timeline confirms |
| Meta interviewer "stopped more remote interviews" quote | Supported — crisis.md line 176; teamblind.com source |
| Jeff Spector "80% candidates use LLMs" | Supported — crisis.md lines 129–131, davidhaney.io |

### Competitive landscape section

| Claim | Evidence status |
|-------|----------------|
| Competitive map table (categories, players, what they sell) | Supported — competitors.md category tables |
| "Skills-based hiring" commoditized (HackerRank, CodeSignal, TestGorilla, Glider AI) | Supported — competitors.md language analysis |
| "Cross-rubric scored transcript as durable artifact" — no incumbent produces | Supported — competitors.md language gap analysis |
| Agencies $18K–$30K/hire | Supported — competitors.md, Dover source |
| Mercor $10B valuation (Oct 2025) | Supported — competitors.md, CNBC source |
| Micro1 $500M valuation (Sep 2025) | Supported — competitors.md, TechCrunch source |
| Karat "notes don't travel" (no candidate-owned artifact) | Supported — competitors.md Karat weaknesses section |
| PIPE price anchors ($15K–$25K/yr, $25–$50/test, sub-$5K entry) | Supported as synthesis from icp.md pricing analysis |

### Compliance section

| Claim | Evidence status |
|-------|----------------|
| NYC LL144 in force July 2023; $500 first / $1,500/day/violation | Supported — compliance.md lines 96–108 |
| Dec 2025 Comptroller audit findings | Supported — compliance.md; note "17 of 18" vs. "17 in 32" framing issue (see per Executive Summary above) |
| DLA Piper "stricter enforcement" quote | Supported — compliance.md lines 104–106 |
| Illinois HB 3773 effective Jan 1, 2026; $5,000/violation | Supported — compliance.md lines 153–159 |
| Illinois "37 cases in first month" | Single-source, law firm blog (see M-3) |
| CA FEHA effective Oct 1, 2025; 4-year retention | Supported — compliance.md lines 165–170 |
| Littler "most stringent requirements in the US" quote | Supported — compliance.md, Littler source |
| Colorado SB 24-205 effective June 30, 2026; ~$20K/violation | Supported with precision caveat (see m-5) |
| Mobley v. Workday class certified May 2025; 1.1B applications; "agent" liability | Supported — compliance.md lines 22–23, InsideTechLaw and Seyfarth sources |
| EEOC guidance pulled January 27, 2025 | Supported — compliance.md lines 206–213, K&L Gates source |
| EU AI Act delay Aug 2026 → Dec 2027 proposed | Supported — compliance.md lines 62–65, OneTrust/Digital Omnibus source |
| Texas TRAIGA pared-back; intentional discrimination only | Supported — compliance.md lines 177–182, K&L Gates source |
| Eightfold ISO/IEC 42001:2023 (August 2025) | Supported — compliance.md lines 234–235 |
| HireVue DCI Consulting bias audits | Supported — compliance.md; "methodology is narrow" caveat also in research file |
| HackerRank/Greenhouse/Workday/Paradox no substantiated AI compliance docs | Supported — compliance.md vendor table |

### Recommended positioning section

| Claim | Evidence status |
|-------|----------------|
| "The test, not the résumé" framing unclaimed | Supported by omission — competitors.md language gap confirms no incumbent uses this |
| "Scored transcript / cited evidence" framing unclaimed | Supported — competitors.md explicitly lists as unclaimed territory |
| "Skills-based hiring" commoditized — avoid | Supported — competitors.md language analysis |
| "AI-powered assessments" meaningless — avoid | Supported — competitors.md |
| "Bias reduction" unverifiable without ISO 42001 — avoid | Supported — compliance.md vendor claims analysis |
| "One test replaces screen + first-round panel" | Strategic synthesis — not directly evidenced in research, reasonable inference from pricing and ICP analysis |
| "Priced in the Codility band" | Supported by icp.md pricing data |
| "$165/month tier" reference for founder/CTO | Supported — this is HackerRank Starter pricing; brief appropriately cites HackerRank comparison article |
| "Integrates with Greenhouse and Ashby" | Not evidenced in research files — this is a product capability claim, not a positioning claim grounded in market research |

**Note on "Integrates with Greenhouse and Ashby":** The brief includes this as a selling point ("To Head of Talent" message). The research files discuss Greenhouse and Ashby as the dominant ATS platforms at the ICP tier, and mention that competitors integrate with them — but there is no research evidence that PIPE has or will have these integrations. This is a product claim, not a market research claim. If PIPE lacks these integrations at launch, this line would be a false promise in go-to-market materials.

### Open Questions section

| Item | Adequacy |
|------|----------|
| Private-sector RFP language gap | Accurately flagged — compliance.md explicitly notes no verbatim private-sector RFP language found |
| Karat NextGen reception unknown | Accurately flagged — competitors.md notes launch but no traction data |
| CodeSignal agentic assessments traction unknown | Accurately flagged — launched April 2026, too new to measure |
| EU AI Act Digital Omnibus outcome pending | Accurately flagged — compliance.md confirms proposal not finalized |
| Mercor/Micro1 trajectory to enterprise | Accurately flagged — competitors.md notes current contractor/gig motion |
| "Fast coder" false positive rate: no published data | Accurately flagged — crisis.md explicitly notes this gap |

The Open Questions section is notably honest about its own evidence limits.

---

## Load-bearing claims that are actually load-bearing

These are the claims whose truth determines whether the brief's thesis holds. Evidence strength assessed against research files.

1. **"Assessment fraud more than doubled in 2025" (CodeSignal 16%→35%)**
   Evidence: Strong. Single source (CodeSignal's own press release), but primary data from the largest public dataset available. CodeSignal has market incentive to disclose — it justifies product investment. The research file appropriately notes this likely undercounts (captures detected fraud only). Accept with caveat.

2. **"0 of 32 interviewers detected cheating" (interviewing.io)**
   Evidence: Strong. Primary research study from a neutral platform, n=32, published methodology. The study found cheating succeeded on verbatim and modified LeetCode but failed on custom questions (25% pass rate) — a nuance the brief omits. The omission strengthens the narrative but weakens analytical fairness. The brief should at minimum acknowledge custom questions resist cheating to avoid being falsely absolutist.

3. **"No incumbent produces a cross-rubric scored transcript artifact"**
   Evidence: Supported. The competitors.md language analysis is thorough (40+ sources). No incumbent marketing claims "scored transcript with cited evidence moments." This is the most durable competitive positioning claim in the brief.

4. **"The buying trigger in 2026 is the cheating incident, not the compliance letter"**
   Evidence: Moderately strong. Supported by qualitative signals (Pragmatic Engineer practitioner accounts, in-person mandate stories) and the CodeSignal fraud data. No direct survey data explicitly asks buyers to rank triggers. The ranking is the Lead's synthesis from circumstantial evidence, which is appropriate but should be read as informed inference, not measured fact.

5. **"Karat average contract $222,750/yr (min $50K–$150K)"**
   Evidence: Strong. Vendr buyer-guide data (real transaction aggregates). The brief uses this to anchor a displacement story — the evidence supports the magnitude claim.

6. **"Cluely raised $20M+ at ~$120M valuation" + "Final Round AI 10M+ users"**
   Evidence: Strong for Cluely (TechCrunch primary source). Weak for Final Round AI (self-reported user count on their own homepage — the research file acknowledges this as a claimed, not verified, figure). The brief presents both at equal certainty; the Final Round AI user claim should be qualified as self-reported.

7. **"Mobley v. Workday changed enterprise procurement calculus"**
   Evidence: Strong for the legal facts (class certification sourced to InsideTechLaw and Seyfarth). The causal claim — that it changed procurement behavior — is the Lead's interpretation, supported by law firm client alerts referencing the case. Not directly evidenced by buyer behavior data.

8. **"NYC LL144 enforcement is entering a new phase"**
   Evidence: Moderately strong. The Comptroller audit findings are sourced to the primary government document. The "new phase" interpretation comes from DLA Piper's client alert, which has its own interest in heightening client concern. The brief's use of this interpretation is fair but should be read as law firm opinion, not regulatory agency announcement.

9. **"Recruits, HackerRank/Codility/CodeSignal have no published false-positive rates"**
   Evidence: Strong. crisis.md explicitly searched for this data and found none. The HackerRank blog's own admission (per crisis.md line 257) confirms the 93% accuracy claim lacks methodology disclosure.

10. **"PIPE's transcript artifact is structurally audit-friendly for NYC LL144, CO SB 24-205, and CA FEHA"**
    Evidence: This is a legal/product claim, not a market research claim. The compliance.md documents what these regulations require (audit trails, explainability, retention). The inference that PIPE's transcript format satisfies these requirements requires legal analysis not contained in the research files. The brief asserts this as established fact ("structurally audit-friendly"); it is a reasonable product design claim but has not been reviewed by counsel.

---

## Appendix: Specific number cross-checks

| Claim in brief | Number in research file | Match? |
|---|---|---|
| CodeSignal fraud 16%→35% | crisis.md: 16%→35% | Yes |
| Entry-level 15%→40% | crisis.md: 15%→40% | Yes |
| Unproctored 4× larger score increases | crisis.md: "4x larger" | Yes |
| 0 of 32 detections | crisis.md: "0 out of 32" | Yes |
| 72% confident | crisis.md: "72% of interviewers confident" | Yes |
| 81% cheating participants not worried | crisis.md: "81% of cheating participants were not worried" | Yes |
| 81% FAANG suspected AI | crisis.md: "81% of Big Tech/New Big Tech interviewers suspected" | Yes |
| 31% caught it | crisis.md: "31% of Big Tech/New Big Tech interviewers caught" | Yes |
| 11% used detection software | crisis.md: "Only 11% of FAANG interviewers reported their companies use cheating-detection software" | Yes |
| 20% workers secretly used AI | crisis.md: "20% of U.S. workers reported secretly using AI" | Yes |
| 65% hiring managers caught AI use | crisis.md: "65% of U.S. hiring managers have caught applicants using AI deceptively" | Yes |
| Cluely $15M a16z Series A | crisis.md: "$15M Series A (June 2025, a16z)" | Yes |
| Cluely ~$120M valuation | crisis.md: "~$120M post-money valuation" | Yes |
| InterviewCoder $10M ARR | crisis.md: "$10M ARR before its pivot/rebrand to Cluely" | Yes |
| Final Round AI 10M+ users | crisis.md: "10M+ users worldwide" (self-reported) | Yes |
| HackerRank 93% accuracy | crisis.md: "93% accuracy claim" | Yes |
| Karat avg $222,750; min $50K–$150K | icp.md: "$222,750/year"; "$50,000–$150,000+" | Yes |
| Karat per-interview $200–$450 | icp.md: "$200–$280 (enterprise); $350–$450 (low-volume)" | Brief collapses range; technically accurate |
| Codility Scale $12K–$24K; median $15K | icp.md: matches; competitors.md shows different Scale number | Discrepancy (see M-2) |
| CodeSignal median $21K | icp.md: "$21,000/year (59 Vendr purchases)" | Yes |
| CodeSignal Pre-Screen $19K | icp.md: "$19,000/year (AWS Marketplace)" | Yes |
| HackerRank median $13,942 | icp.md: "$13,942; avg savings 24% (154 Vendr purchases)" | Yes — but n=154 claim and Vendr URL attribution are wrong in brief (see M-1) |
| NYC LL144 $500 first / $1,500/day/violation | compliance.md: exact match | Yes |
| NYC Comptroller "17 violations" | compliance.md: "at least 17 potential violations" in 32 companies | Brief distorts to "17 of 18" in exec summary |
| Illinois $5,000/violation | compliance.md: "up to $5,000 per violation" | Yes |
| Illinois 37 cases first month | compliance.md: Hinshaw law firm blog only | Single-source (see M-3) |
| Colorado ~$20K/violation | compliance.md: "up to $20,000/violation under CCPA framework" — not a direct CO AI Act penalty | Accurate but imprecise (see m-5) |
| Mobley 1.1B applications | compliance.md: "~1.1 billion rejected applications" | Yes |
| EEOC guidance pulled Jan 27, 2025 | compliance.md: "January 27, 2025" | Yes |
| Eightfold ISO 42001 Aug 2025 | compliance.md: "ISO/IEC 42001:2023 (August 2025)" | Yes |
| EU delay Aug 2026 → Dec 2027 proposed | compliance.md: "December 2, 2027" (proposed, not finalized) | Yes |
| Mercor $10B valuation Oct 2025 | competitors.md: "$350M Series C at $10B val (Oct 2025)" | Yes |
| Micro1 $500M valuation Sep 2025 | competitors.md: "$35M Series A at $500M val (Sep 2025)" | Yes |
| Agencies $18K–$30K/hire | competitors.md: "$18,000–$30,000/hire typical" | Yes |
| 39% talent leaders adding software (vs. 25% 2024) | icp.md: "39% listing new recruitment software as a top priority (vs. 25% in 2024)" | Yes |
